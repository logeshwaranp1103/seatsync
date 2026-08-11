-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 33: SECURE ENTRY QR SCAN ENGINE & BACKFILL
-- ====================================================================

-- 0. Ensure pgcrypto extension if available
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

-- 1. Ensure unique partial index on public.bookings (qr_token)
CREATE UNIQUE INDEX IF NOT EXISTS bookings_qr_token_unique
ON public.bookings (qr_token)
WHERE qr_token IS NOT NULL;

-- 2. Idempotent Backfill for active bookings with missing QR tokens using built-in MD5 + UUID
UPDATE public.bookings
SET qr_token = 'QR-' || UPPER(SUBSTRING(MD5(GEN_RANDOM_UUID()::TEXT || CLOCK_TIMESTAMP()::TEXT) FROM 1 FOR 16))
WHERE qr_token IS NULL
  AND status IN ('confirmed', 'checked_in', 'awaiting_check_in');

-- 3. Update create_seat_booking to generate secure qr_token automatically using built-in MD5 + UUID
CREATE OR REPLACE FUNCTION public.create_seat_booking(
    p_library_id UUID,
    p_floor_id UUID,
    p_room_id UUID,
    p_seat_id UUID,
    p_slot_id UUID,
    p_booking_date DATE,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_student_id UUID := auth.uid();
    v_profile public.profiles%ROWTYPE;
    v_occurrence_id UUID;
    v_occurrence_status TEXT;
    v_seat_status TEXT;
    v_existing_booking_count INTEGER := 0;
    v_seat_number TEXT;
    v_slot_name TEXT;
    v_booking_code TEXT;
    v_qr_token TEXT;
    v_booking_id UUID;
    v_new_booking JSONB;
BEGIN
    IF v_student_id IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated request. Please sign in.';
    END IF;

    SELECT * INTO v_profile FROM public.profiles WHERE id = v_student_id;
    IF v_profile.id IS NULL THEN
        RAISE EXCEPTION 'User profile not found. Please complete your profile.';
    END IF;

    IF COALESCE(v_profile.status, 'active') IN ('blocked', 'suspended') THEN
        RAISE EXCEPTION 'Account restricted. You cannot book seats at this time.';
    END IF;

    -- Ensure slot occurrence exists
    v_occurrence_id := public.ensure_slot_occurrence(p_library_id, p_room_id, p_slot_id, p_booking_date);
    
    SELECT status INTO v_occurrence_status FROM public.slot_occurrences WHERE id = v_occurrence_id;
    IF v_occurrence_status = 'cancelled' THEN
        RAISE EXCEPTION 'This slot is cancelled by the administrator for the selected date.';
    END IF;

    -- Verify seat availability
    SELECT status, seat_number INTO v_seat_status, v_seat_number FROM public.seats WHERE id = p_seat_id;
    IF v_seat_status = 'maintenance' THEN
        RAISE EXCEPTION 'Seat % is currently under maintenance.', v_seat_number;
    END IF;

    -- Verify no double booking for same student on same slot and date
    SELECT COUNT(*) INTO v_existing_booking_count
    FROM public.bookings
    WHERE student_id = v_student_id
      AND booking_date = p_booking_date
      AND (slot_id = p_slot_id OR slot_occurrence_id = v_occurrence_id)
      AND status IN ('confirmed', 'checked_in', 'awaiting_check_in');

    IF v_existing_booking_count > 0 THEN
        RAISE EXCEPTION 'You already hold an active reservation for this time slot.';
    END IF;

    -- Generate codes and secure QR token using standard PostgreSQL built-ins (MD5 + UUID)
    v_booking_code := 'BK-' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || CLOCK_TIMESTAMP()::TEXT) FROM 1 FOR 8));
    v_qr_token := 'QR-' || UPPER(SUBSTRING(MD5(GEN_RANDOM_UUID()::TEXT || CLOCK_TIMESTAMP()::TEXT) FROM 1 FOR 16));

    SELECT name INTO v_slot_name FROM public.slots WHERE id = p_slot_id;

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
        qr_token,
        idempotency_key,
        created_at,
        updated_at
    ) VALUES (
        v_booking_code,
        v_student_id,
        p_library_id,
        p_floor_id,
        p_room_id,
        p_seat_id,
        p_slot_id,
        v_occurrence_id,
        p_booking_date,
        'confirmed',
        'online',
        v_qr_token,
        p_idempotency_key,
        NOW(),
        NOW()
    ) RETURNING id INTO v_booking_id;

    SELECT jsonb_build_object(
        'id', b.id,
        'booking_code', b.booking_code,
        'student_id', b.student_id,
        'student_name', v_profile.full_name,
        'student_email', v_profile.email,
        'seat_id', b.seat_id,
        'seat_number', v_seat_number,
        'slot_id', b.slot_id,
        'slot_name', v_slot_name,
        'booking_date', b.booking_date,
        'status', b.status,
        'qr_token', b.qr_token,
        'created_at', b.created_at
    ) INTO v_new_booking
    FROM public.bookings b WHERE b.id = v_booking_id;

    RETURN v_new_booking;
END;
$$;


-- 4. Secure Entry QR Scan RPC: scan_entry_qr()
DROP FUNCTION IF EXISTS public.scan_entry_qr CASCADE;

CREATE OR REPLACE FUNCTION public.scan_entry_qr(
    p_qr_token TEXT,
    p_scan_nonce UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_staff_id UUID := auth.uid();
    v_staff_profile RECORD;
    v_clean_token TEXT := TRIM(COALESCE(p_qr_token, ''));
    v_booking RECORD;
    v_student RECORD;
    v_slot RECORD;
    v_seat RECORD;
    v_room RECORD;
    v_floor RECORD;
    v_library RECORD;
    v_kolkata_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE;
    v_kolkata_now_time TIME := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::TIME;
    v_checkin_window_start TIME;
    v_assigned_lib_count INTEGER := 0;
BEGIN
    -- 1. Validate Authenticated Staff/Librarian/Admin User
    IF v_staff_id IS NULL THEN
        RETURN jsonb_build_object(
            'valid', false,
            'status_code', 'staff_not_authorized',
            'message', 'Unauthenticated request. Staff or librarian sign-in required.'
        );
    END IF;

    SELECT id, full_name, role, status INTO v_staff_profile
    FROM public.profiles WHERE id = v_staff_id;

    IF v_staff_profile.id IS NULL OR v_staff_profile.role NOT IN ('librarian', 'staff', 'admin') THEN
        RETURN jsonb_build_object(
            'valid', false,
            'status_code', 'staff_not_authorized',
            'message', 'Access denied. Only authorized library staff or administrators can perform entry check-in scans.'
        );
    END IF;

    -- 2. Validate Scanned Token format
    IF v_clean_token = '' THEN
        RETURN jsonb_build_object(
            'valid', false,
            'status_code', 'invalid_qr',
            'message', 'Invalid QR code format. Please scan a valid SeatSync Entry Pass.'
        );
    END IF;

    -- 3. Prevent Replay Attacks using scan_nonces if nonce supplied
    IF p_scan_nonce IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM public.scan_nonces WHERE id = p_scan_nonce OR nonce = p_scan_nonce::text) THEN
            RETURN jsonb_build_object(
                'valid', false,
                'status_code', 'nonce_reused',
                'message', 'This QR scan request has already been processed.'
            );
        END IF;
    END IF;

    -- 4. LOOKUP FIRST: Find booking record by exact qr_token, id, or booking_code
    SELECT b.* INTO v_booking
    FROM public.bookings b
    WHERE b.qr_token = v_clean_token
       OR b.id::text = v_clean_token
       OR UPPER(b.booking_code) = UPPER(v_clean_token)
    FOR UPDATE OF b;

    IF v_booking.id IS NULL THEN
        RETURN jsonb_build_object(
            'valid', false,
            'status_code', 'booking_not_found',
            'message', 'No booking matches this QR token. Please confirm booking reference or ask student to refresh pass.'
        );
    END IF;

    -- 5. Staff Library Assignment Check (Admins bypass, staff/librarians check assigned libraries)
    IF v_staff_profile.role IN ('librarian', 'staff') THEN
        SELECT COUNT(*) INTO v_assigned_lib_count
        FROM public.staff_assignments
        WHERE staff_id = v_staff_id AND library_id = v_booking.library_id;

        IF v_assigned_lib_count = 0 AND EXISTS (SELECT 1 FROM public.staff_assignments WHERE staff_id = v_staff_id) THEN
            RETURN jsonb_build_object(
                'valid', false,
                'status_code', 'staff_not_authorized',
                'message', 'You are not assigned to duty in the library where this seat is reserved.'
            );
        END IF;
    END IF;

    -- 6. Fetch Joined Entities (Student, Seat, Slot, Room, Floor, Library)
    SELECT * INTO v_student FROM public.profiles WHERE id = v_booking.student_id;
    SELECT * INTO v_seat FROM public.seats WHERE id = v_booking.seat_id;
    SELECT * INTO v_slot FROM public.slots WHERE id = v_booking.slot_id;
    SELECT * INTO v_room FROM public.rooms WHERE id = v_booking.room_id;
    SELECT * INTO v_floor FROM public.floors WHERE id = v_booking.floor_id;
    SELECT * INTO v_library FROM public.libraries WHERE id = v_booking.library_id;

    -- 7. VALIDATE SECOND (Exact structured errors):
    
    -- 7a. Account Status
    IF COALESCE(v_student.status, 'active') IN ('blocked', 'suspended') THEN
        RETURN jsonb_build_object(
            'valid', false,
            'status_code', 'student_blocked',
            'message', 'Student account is currently suspended or blocked from library access.',
            'booking_id', v_booking.id,
            'student_name', COALESCE(v_student.full_name, 'Student')
        );
    END IF;

    -- 7b. Slot Master or Occurrence Cancellation
    IF v_slot.is_active IS FALSE THEN
        RETURN jsonb_build_object(
            'valid', false,
            'status_code', 'slot_cancelled',
            'message', 'This time slot has been globally disabled by the administrator.',
            'booking_id', v_booking.id
        );
    END IF;

    IF v_booking.slot_occurrence_id IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM public.slot_occurrences WHERE id = v_booking.slot_occurrence_id AND status = 'cancelled') THEN
            RETURN jsonb_build_object(
                'valid', false,
                'status_code', 'slot_cancelled',
                'message', 'This time slot occurrence was cancelled by the administrator. Reason: ' || COALESCE(v_booking.cancellation_reason, 'Maintenance'),
                'booking_id', v_booking.id
            );
        END IF;
    END IF;

    -- 7c. Booking Cancellation Status
    IF v_booking.status::text = 'cancelled' THEN
        RETURN jsonb_build_object(
            'valid', false,
            'status_code', 'booking_cancelled',
            'message', 'This booking was cancelled. ' || CASE WHEN v_booking.cancellation_source = 'admin_slot' THEN 'Reason: ' || COALESCE(v_booking.cancellation_reason, 'Admin Cancellation') ELSE 'Cancelled by student.' END,
            'booking_id', v_booking.id
        );
    END IF;

    -- 7d. Already Checked Out
    IF v_booking.status::text IN ('checked_out', 'completed') THEN
        RETURN jsonb_build_object(
            'valid', false,
            'status_code', 'already_checked_out',
            'message', 'This student has already checked out of this reservation at ' || COALESCE(TO_CHAR(v_booking.checked_out_at, 'HH12:MI AM'), 'earlier') || '.',
            'booking_id', v_booking.id
        );
    END IF;

    -- 7e. Already Checked In
    IF v_booking.status::text = 'checked_in' THEN
        RETURN jsonb_build_object(
            'valid', true,
            'already_checked_in', true,
            'status_code', 'already_checked_in',
            'message', 'This student is already checked in.',
            'booking_id', v_booking.id,
            'booking_code', v_booking.booking_code,
            'student_id', v_student.id,
            'student_name', COALESCE(v_student.full_name, 'Student'),
            'registration_number', COALESCE(v_student.registration_number, v_student.department, 'N/A'),
            'seat_number', COALESCE(v_seat.seat_number, 'S-01'),
            'slot_name', COALESCE(v_slot.name, 'Time Slot'),
            'slot_time', TO_CHAR(v_slot.start_time, 'HH12:MI AM') || ' – ' || TO_CHAR(v_slot.end_time, 'HH12:MI AM'),
            'booking_date', v_booking.booking_date,
            'checked_in_at', v_booking.checked_in_at
        );
    END IF;

    -- 7f. Booking Date Check (Asia/Kolkata date)
    IF v_booking.booking_date != v_kolkata_today THEN
        RETURN jsonb_build_object(
            'valid', false,
            'status_code', 'wrong_date',
            'message', 'This QR pass is valid on ' || TO_CHAR(v_booking.booking_date, 'DD-MM-YYYY') || '.',
            'booking_id', v_booking.id,
            'booking_date', v_booking.booking_date,
            'today_date', v_kolkata_today
        );
    END IF;

    -- 7g. Check-In Window (Too Early check - 15 mins window)
    v_checkin_window_start := v_slot.start_time - INTERVAL '15 minutes';
    IF v_kolkata_now_time < v_checkin_window_start THEN
        RETURN jsonb_build_object(
            'valid', false,
            'status_code', 'too_early',
            'message', 'Check-in opens at ' || TO_CHAR(v_checkin_window_start, 'HH12:MI AM') || ' (15 minutes prior to slot).',
            'booking_id', v_booking.id,
            'slot_start_time', TO_CHAR(v_slot.start_time, 'HH12:MI AM')
        );
    END IF;

    -- 7h. Grace Period Check (Past slot end time)
    IF v_kolkata_now_time > v_slot.end_time THEN
        RETURN jsonb_build_object(
            'valid', false,
            'status_code', 'grace_period_expired',
            'message', 'The check-in grace period for this slot (' || TO_CHAR(v_slot.end_time, 'HH12:MI AM') || ') has expired.',
            'booking_id', v_booking.id
        );
    END IF;

    -- 8. ATOMIC CHECK-IN EXECUTION
    
    -- Record nonce
    IF p_scan_nonce IS NOT NULL THEN
        BEGIN
            INSERT INTO public.scan_nonces (id, nonce, booking_id, scanned_by, scanned_at)
            VALUES (p_scan_nonce, p_scan_nonce::text, v_booking.id, v_staff_id, NOW());
        EXCEPTION WHEN OTHERS THEN /* proceed */ END;
    END IF;

    -- Update booking status
    UPDATE public.bookings
    SET
        status = 'checked_in',
        checked_in_at = NOW(),
        checked_in_by = v_staff_id,
        updated_at = NOW()
    WHERE id = v_booking.id;

    -- Insert into check_in_logs
    BEGIN
        INSERT INTO public.check_in_logs (
            booking_id,
            student_id,
            librarian_id,
            action,
            method,
            notes,
            created_at
        ) VALUES (
            v_booking.id,
            v_booking.student_id,
            v_staff_id,
            'check_in',
            'qr',
            'Entry QR scan check-in completed',
            NOW()
        );
    EXCEPTION WHEN OTHERS THEN /* non-blocking */ END;

    -- Audit log
    BEGIN
        INSERT INTO public.audit_logs (
            actor_id,
            target_id,
            event_type,
            metadata,
            created_at
        ) VALUES (
            v_staff_id,
            v_booking.id,
            'ENTRY_QR_CHECKIN',
            jsonb_build_object(
                'booking_code', v_booking.booking_code,
                'student_id', v_booking.student_id,
                'seat_id', v_booking.seat_id,
                'slot_id', v_booking.slot_id,
                'scanned_at', NOW()
            ),
            NOW()
        );
    EXCEPTION WHEN OTHERS THEN /* non-blocking */ END;

    -- 9. Return Structured Success Card Details
    RETURN jsonb_build_object(
        'valid', true,
        'status_code', 'success',
        'message', 'Check-in Successful',
        'booking_id', v_booking.id,
        'booking_code', v_booking.booking_code,
        'student_id', v_student.id,
        'student_name', COALESCE(v_student.full_name, 'Student'),
        'registration_number', COALESCE(v_student.registration_number, v_student.department, 'N/A'),
        'seat_number', COALESCE(v_seat.seat_number, 'S-01'),
        'floor_name', COALESCE(v_floor.name, 'Ground Floor'),
        'room_name', COALESCE(v_room.name, 'Main Reading Hall'),
        'library_name', COALESCE(v_library.name, 'Central Library'),
        'slot_name', COALESCE(v_slot.name, 'Time Slot'),
        'start_time', TO_CHAR(v_slot.start_time, 'HH12:MI AM'),
        'end_time', TO_CHAR(v_slot.end_time, 'HH12:MI AM'),
        'slot_time', TO_CHAR(v_slot.start_time, 'HH12:MI AM') || ' – ' || TO_CHAR(v_slot.end_time, 'HH12:MI AM'),
        'booking_date', v_booking.booking_date,
        'status', 'checked_in',
        'checked_in_at', NOW()
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.scan_entry_qr(TEXT, UUID) TO authenticated, anon;
