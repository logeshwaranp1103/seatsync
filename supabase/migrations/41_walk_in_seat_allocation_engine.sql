-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 41: WALK-IN SEAT ALLOCATION & PROTECTION ENGINE
-- ====================================================================

-- 1. Ensure Table Columns in public.seats and public.bookings
ALTER TABLE public.seats ADD COLUMN IF NOT EXISTS is_walk_in_only BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS booking_source TEXT NOT NULL DEFAULT 'student_online';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id);
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS is_cancellable BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. Mark Seats S-41 through S-50 as Walk-In Reserved Only
UPDATE public.seats
SET is_walk_in_only = TRUE
WHERE UPPER(seat_number) IN ('S-41', 'S-42', 'S-43', 'S-44', 'S-45', 'S-46', 'S-47', 'S-48', 'S-49', 'S-50')
   OR seat_number ~ '^S-(4[1-9]|50)$';

UPDATE public.seats
SET is_walk_in_only = FALSE
WHERE UPPER(seat_number) NOT IN ('S-41', 'S-42', 'S-43', 'S-44', 'S-45', 'S-46', 'S-47', 'S-48', 'S-49', 'S-50')
  AND NOT (seat_number ~ '^S-(4[1-9]|50)$');


-- 3. Atomic Walk-In Seat Allocation RPC: allocate_walk_in_seat
DROP FUNCTION IF EXISTS public.allocate_walk_in_seat CASCADE;

CREATE OR REPLACE FUNCTION public.allocate_walk_in_seat(
    p_student_id UUID,
    p_seat_id TEXT,
    p_slot_occurrence_id UUID DEFAULT NULL,
    p_slot_id TEXT DEFAULT NULL,
    p_booking_date DATE DEFAULT NULL,
    p_instant_check_in BOOLEAN DEFAULT TRUE,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_staff_id UUID := auth.uid();
    v_staff_profile RECORD;
    v_student RECORD;
    v_seat RECORD;
    v_occurrence RECORD;
    v_slot RECORD;
    v_room RECORD;
    v_floor RECORD;
    v_library RECORD;
    v_occurrence_id UUID := p_slot_occurrence_id;
    v_target_date DATE := p_booking_date;
    v_target_slot_id UUID;
    v_target_seat_id UUID;
    v_existing_booking_count INTEGER := 0;
    v_existing_student_booking INTEGER := 0;
    v_booking_code TEXT;
    v_qr_token TEXT;
    v_booking_id UUID;
    v_assigned_lib_count INTEGER := 0;
    v_result JSONB;
BEGIN
    -- 1. Validate Authenticated Librarian/Staff User
    IF v_staff_id IS NULL THEN
        -- Fallback to first librarian profile if unauthenticated in dev/test
        SELECT id, full_name, role, status INTO v_staff_profile 
        FROM public.profiles 
        WHERE LOWER(role::text) IN ('librarian', 'senior_librarian', 'admin', 'super_admin') 
        LIMIT 1;
        
        IF v_staff_profile.id IS NOT NULL THEN
            v_staff_id := v_staff_profile.id;
        ELSE
            RETURN jsonb_build_object(
                'success', false,
                'status_code', 'STAFF_NOT_AUTHORIZED',
                'message', 'Staff authentication required.'
            );
        END IF;
    ELSE
        SELECT id, full_name, role, status INTO v_staff_profile 
        FROM public.profiles 
        WHERE id = v_staff_id;
    END IF;

    -- 2. Validate Student Profile (Role must be student and status active)
    SELECT * INTO v_student FROM public.profiles WHERE id = p_student_id;
    IF v_student.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'STUDENT_NOT_FOUND',
            'message', 'No active student profile found.'
        );
    END IF;

    IF LOWER(v_student.role::text) != 'student' OR COALESCE(v_student.status, 'active') IN ('blocked', 'suspended') THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'STUDENT_BLOCKED',
            'message', 'Student account is suspended or blocked.'
        );
    END IF;

    -- 3. Resolve Walk-In Seat (by UUID or seat_number)
    IF p_seat_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        v_target_seat_id := p_seat_id::UUID;
        SELECT * INTO v_seat FROM public.seats WHERE id = v_target_seat_id FOR UPDATE;
    ELSE
        SELECT * INTO v_seat FROM public.seats WHERE UPPER(seat_number) = UPPER(p_seat_id) LIMIT 1 FOR UPDATE;
        IF v_seat.id IS NOT NULL THEN
            v_target_seat_id := v_seat.id;
        END IF;
    END IF;

    IF v_seat.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'SEAT_NOT_FOUND',
            'message', 'Selected walk-in seat record not found.'
        );
    END IF;

    IF v_seat.status::text = 'maintenance' OR EXISTS (
        SELECT 1 FROM public.seat_maintenance WHERE seat_id = v_target_seat_id AND status != 'Resolved'
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'SEAT_UNDER_MAINTENANCE',
            'message', 'Seat ' || v_seat.seat_number || ' is currently under maintenance.'
        );
    END IF;

    -- 4. Resolve Slot (by UUID or slot code/name)
    IF p_slot_id IS NOT NULL THEN
        IF p_slot_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            v_target_slot_id := p_slot_id::UUID;
        ELSE
            SELECT id INTO v_target_slot_id FROM public.slots WHERE UPPER(name) = UPPER(p_slot_id) OR UPPER(id::text) = UPPER(p_slot_id) LIMIT 1;
        END IF;
    END IF;

    -- 5. Confirm Slot Occurrence or ensure occurrence
    IF v_occurrence_id IS NOT NULL THEN
        SELECT * INTO v_occurrence FROM public.slot_occurrences WHERE id = v_occurrence_id;
        IF v_occurrence.id IS NOT NULL THEN
            v_target_date := v_occurrence.date;
            v_target_slot_id := v_occurrence.slot_id;
        END IF;
    END IF;

    IF v_target_slot_id IS NOT NULL AND v_target_date IS NOT NULL AND v_occurrence_id IS NULL THEN
        v_occurrence_id := public.ensure_slot_occurrence(v_seat.room_id, v_seat.room_id, v_target_slot_id, v_target_date);
        SELECT * INTO v_occurrence FROM public.slot_occurrences WHERE id = v_occurrence_id;
    END IF;

    IF v_target_date IS NULL THEN
        v_target_date := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE;
    END IF;

    SELECT * INTO v_slot FROM public.slots WHERE id = COALESCE(v_target_slot_id, v_occurrence.slot_id);
    IF v_slot.id IS NULL THEN
        SELECT * INTO v_slot FROM public.slots WHERE status = 'active' LIMIT 1;
    END IF;

    SELECT * INTO v_room FROM public.rooms WHERE id = v_seat.room_id;
    SELECT * INTO v_floor FROM public.floors WHERE id = v_room.floor_id;
    SELECT * INTO v_library FROM public.libraries WHERE id = v_room.library_id;

    -- 6. CONCURRENCY & CONFLICT CHECK
    SELECT COUNT(*) INTO v_existing_booking_count
    FROM public.bookings
    WHERE seat_id = v_target_seat_id
      AND booking_date = v_target_date
      AND (
        (v_occurrence_id IS NOT NULL AND slot_occurrence_id = v_occurrence_id) OR
        (v_slot.id IS NOT NULL AND slot_id = v_slot.id)
      )
      AND status IN ('confirmed', 'checked_in', 'awaiting_check_in');

    IF v_existing_booking_count > 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'SEAT_ALREADY_BOOKED',
            'message', 'Seat ' || v_seat.seat_number || ' is already booked for this slot.'
        );
    END IF;

    -- Check if student already has active booking for same slot & date
    SELECT COUNT(*) INTO v_existing_student_booking
    FROM public.bookings
    WHERE student_id = p_student_id
      AND booking_date = v_target_date
      AND (
        (v_occurrence_id IS NOT NULL AND slot_occurrence_id = v_occurrence_id) OR
        (v_slot.id IS NOT NULL AND slot_id = v_slot.id)
      )
      AND status IN ('confirmed', 'checked_in', 'awaiting_check_in');

    IF v_existing_student_booking > 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'STUDENT_DOUBLE_BOOKING',
            'message', 'This student already holds an active booking for this time slot.'
        );
    END IF;

    -- Generate Codes
    v_booking_code := 'BK-' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || CLOCK_TIMESTAMP()::TEXT) FROM 1 FOR 8));
    v_qr_token := 'QR-' || UPPER(SUBSTRING(MD5(GEN_RANDOM_UUID()::TEXT || CLOCK_TIMESTAMP()::TEXT) FROM 1 FOR 16));

    -- 7. ATOMIC INSERT BOOKING
    INSERT INTO public.bookings (
        booking_code,
        student_id,
        library_id,
        floor_id,
        room_id,
        seat_id,
        slot_id,
        slot_occurrence_id,
        booking_date,
        status,
        booking_source,
        created_by,
        is_cancellable,
        qr_token,
        checked_in_at,
        checked_in_by,
        idempotency_key,
        created_at,
        updated_at
    ) VALUES (
        v_booking_code,
        p_student_id,
        v_room.library_id,
        v_room.floor_id,
        v_seat.room_id,
        v_target_seat_id,
        v_slot.id,
        v_occurrence_id,
        v_target_date,
        CASE WHEN p_instant_check_in THEN 'checked_in' ELSE 'confirmed' END,
        'librarian_walk_in',
        v_staff_id,
        FALSE,
        v_qr_token,
        CASE WHEN p_instant_check_in THEN NOW() ELSE NULL END,
        CASE WHEN p_instant_check_in THEN v_staff_id ELSE NULL END,
        p_idempotency_key,
        NOW(),
        NOW()
    ) RETURNING id INTO v_booking_id;

    -- 8. If Instant Check-in requested -> Insert Check-in Log
    IF p_instant_check_in THEN
        BEGIN
            INSERT INTO public.check_in_logs (
                booking_id,
                student_id,
                librarian_id,
                seat_id,
                library_id,
                slot_id,
                slot_occurrence_id,
                action,
                method,
                check_in_method,
                notes,
                created_at
            ) VALUES (
                v_booking_id,
                p_student_id,
                v_staff_id,
                v_target_seat_id,
                v_room.library_id,
                v_slot.id,
                v_occurrence_id,
                'check_in',
                'manual',
                'manual',
                'Walk-In Instant Check-In Verified by ' || COALESCE(v_staff_profile.full_name, 'Librarian'),
                NOW()
            );
        EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;

    -- 9. Student Notification
    BEGIN
        INSERT INTO public.notifications (
            recipient_id,
            title,
            message,
            type,
            reference_id,
            created_at
        ) VALUES (
            p_student_id,
            'Walk-In Seat Allocated',
            'Seat ' || v_seat.seat_number || ' at ' || COALESCE(v_library.name, 'Main Library') || ' has been allocated to you by librarian ' || COALESCE(v_staff_profile.full_name, 'Staff') || '.' || CASE WHEN p_instant_check_in THEN ' Pass activated instantly.' ELSE '' END || ' Note: This desk allocation is non-cancellable.',
            'booking_confirmation',
            v_booking_id,
            NOW()
        );
    EXCEPTION WHEN OTHERS THEN NULL; END;

    -- 10. Audit Log Entry
    BEGIN
        INSERT INTO public.audit_logs (actor_id, target_id, event_type, metadata, created_at)
        VALUES (v_staff_id, v_booking_id, 'WALK_IN_SEAT_ALLOCATED', jsonb_build_object(
            'booking_code', v_booking_code,
            'student_id', p_student_id,
            'seat_number', v_seat.seat_number,
            'instant_check_in', p_instant_check_in
        ), NOW());
    EXCEPTION WHEN OTHERS THEN NULL; END;

    -- 11. RETURN CREATED BOOKING JSON
    RETURN jsonb_build_object(
        'success', true,
        'status_code', 'SUCCESS',
        'message', 'Walk-In seat ' || v_seat.seat_number || ' successfully allocated!',
        'booking', jsonb_build_object(
            'id', v_booking_id,
            'booking_code', v_booking_code,
            'student_id', p_student_id,
            'student_name', COALESCE(v_student.full_name, 'Student'),
            'registration_number', COALESCE(v_student.registration_number, v_student.department, 'N/A'),
            'department', COALESCE(v_student.department, 'N/A'),
            'seat_id', v_target_seat_id,
            'seat_number', v_seat.seat_number,
            'room_name', COALESCE(v_room.name, 'Reading Hall'),
            'floor_name', COALESCE(v_floor.name, 'Ground Floor'),
            'library_name', COALESCE(v_library.name, 'Central Library'),
            'slot_name', COALESCE(v_slot.name, 'Time Slot'),
            'slot_time', TO_CHAR(v_slot.start_time, 'HH12:MI AM') || ' – ' || TO_CHAR(v_slot.end_time, 'HH12:MI AM'),
            'booking_date', v_target_date,
            'booking_source', 'librarian_walk_in',
            'created_by', v_staff_id,
            'allocated_by_name', COALESCE(v_staff_profile.full_name, 'Librarian'),
            'is_cancellable', false,
            'status', CASE WHEN p_instant_check_in THEN 'checked_in' ELSE 'confirmed' END,
            'checked_in_at', CASE WHEN p_instant_check_in THEN NOW() ELSE NULL END,
            'created_at', NOW()
        )
    );
END;
$$;


-- 4. Update Booking Cancellation RPC to Enforce Non-Cancellable Protection
DROP FUNCTION IF EXISTS public.cancel_seat_booking CASCADE;

CREATE OR REPLACE FUNCTION public.cancel_seat_booking(
    p_booking_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_booking RECORD;
    v_user_profile RECORD;
BEGIN
    IF v_user_id IS NULL THEN
        SELECT id INTO v_user_id FROM public.profiles WHERE LOWER(role::text) IN ('admin', 'librarian') LIMIT 1;
    END IF;

    SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
    IF v_booking.id IS NULL THEN
        RAISE EXCEPTION 'Booking record not found.';
    END IF;

    -- ENFORCE NON-CANCELLABLE WALK-IN PROTECTION
    IF v_booking.booking_source = 'librarian_walk_in' OR v_booking.is_cancellable IS FALSE THEN
        RAISE EXCEPTION 'This librarian walk-in allocation cannot be cancelled.';
    END IF;

    IF v_booking.status::text IN ('cancelled', 'checked_out', 'completed') THEN
        RAISE EXCEPTION 'This booking is already %.', v_booking.status;
    END IF;

    -- Update booking status to cancelled
    UPDATE public.bookings
    SET
        status = 'cancelled',
        cancelled_at = NOW(),
        cancelled_by = v_user_id,
        cancellation_reason = COALESCE(p_reason, 'Cancelled by user'),
        updated_at = NOW()
    WHERE id = p_booking_id;

    -- Audit log
    BEGIN
        INSERT INTO public.audit_logs (actor_id, target_id, event_type, metadata, created_at)
        VALUES (v_user_id, p_booking_id, 'BOOKING_CANCELLED', jsonb_build_object('reason', p_reason), NOW());
    EXCEPTION WHEN OTHERS THEN NULL; END;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Booking cancelled successfully.',
        'booking_id', p_booking_id
    );
END;
$$;

-- 5. Security Grants
GRANT EXECUTE ON FUNCTION public.allocate_walk_in_seat(UUID, TEXT, UUID, TEXT, DATE, BOOLEAN, TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.cancel_seat_booking(UUID, TEXT) TO authenticated, anon;
