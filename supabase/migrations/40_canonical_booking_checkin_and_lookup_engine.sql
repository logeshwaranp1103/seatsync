-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 40: CANONICAL BOOKING CHECK-IN & LOOKUP ENGINE
-- ====================================================================

-- 1. Ensure Table Columns in public.check_in_logs and public.bookings
ALTER TABLE public.check_in_logs ADD COLUMN IF NOT EXISTS seat_id UUID;
ALTER TABLE public.check_in_logs ADD COLUMN IF NOT EXISTS library_id UUID;
ALTER TABLE public.check_in_logs ADD COLUMN IF NOT EXISTS slot_id UUID;
ALTER TABLE public.check_in_logs ADD COLUMN IF NOT EXISTS slot_occurrence_id UUID;
ALTER TABLE public.check_in_logs ADD COLUMN IF NOT EXISTS check_in_method TEXT DEFAULT 'qr';
ALTER TABLE public.check_in_logs ADD COLUMN IF NOT EXISTS checkout_method TEXT DEFAULT 'manual';
ALTER TABLE public.check_in_logs ADD COLUMN IF NOT EXISTS scan_nonce UUID;

-- 2. Atomic, Idempotent Check-In RPC: check_in_booking
DROP FUNCTION IF EXISTS public.check_in_booking CASCADE;

CREATE OR REPLACE FUNCTION public.check_in_booking(
    p_booking_id UUID,
    p_method TEXT DEFAULT 'manual',
    p_scanned_payload TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_staff_id UUID := auth.uid();
    v_staff_profile RECORD;
    v_booking RECORD;
    v_student RECORD;
    v_slot RECORD;
    v_seat RECORD;
    v_room RECORD;
    v_floor RECORD;
    v_library RECORD;
    v_kolkata_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE;
    v_kolkata_now_time TIME := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::TIME;
    v_checkin_start TIME;
    v_assigned_lib_count INTEGER := 0;
    v_checkin_method TEXT := LOWER(TRIM(COALESCE(p_method, 'manual')));
BEGIN
    -- 1. Validate Authenticated Staff/Librarian User
    IF v_staff_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'STAFF_NOT_AUTHORIZED',
            'message', 'Staff authentication required.'
        );
    END IF;

    SELECT id, full_name, role, status INTO v_staff_profile 
    FROM public.profiles 
    WHERE id = v_staff_id;

    IF v_staff_profile.id IS NULL OR LOWER(v_staff_profile.role::text) NOT IN ('librarian', 'senior_librarian', 'staff', 'admin', 'super_admin', 'support_staff') THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'STAFF_NOT_AUTHORIZED',
            'message', 'Access denied. Staff or Librarian role required.'
        );
    END IF;

    -- 2. LOCK TARGET BOOKING ROW FOR UPDATE
    SELECT b.* INTO v_booking
    FROM public.bookings b
    WHERE b.id = p_booking_id
    FOR UPDATE OF b;

    IF v_booking.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'BOOKING_NOT_FOUND',
            'message', 'Booking not found.'
        );
    END IF;

    -- 3. Confirm Librarian Library Authorization
    IF LOWER(v_staff_profile.role::text) IN ('librarian', 'senior_librarian', 'staff', 'support_staff') THEN
        SELECT COUNT(*) INTO v_assigned_lib_count
        FROM public.staff_assignments
        WHERE staff_id = v_staff_id AND library_id = v_booking.library_id;

        IF v_assigned_lib_count = 0 AND EXISTS (SELECT 1 FROM public.staff_assignments WHERE staff_id = v_staff_id) THEN
            RETURN jsonb_build_object(
                'success', false,
                'status_code', 'WRONG_LIBRARY',
                'message', 'This booking belongs to another library.'
            );
        END IF;
    END IF;

    -- 4. Fetch Joined Entities
    SELECT * INTO v_student FROM public.profiles WHERE id = v_booking.student_id;
    SELECT * INTO v_seat FROM public.seats WHERE id = v_booking.seat_id;
    SELECT * INTO v_slot FROM public.slots WHERE id = v_booking.slot_id;
    SELECT * INTO v_room FROM public.rooms WHERE id = v_booking.room_id;
    SELECT * INTO v_floor FROM public.floors WHERE id = v_booking.floor_id;
    SELECT * INTO v_library FROM public.libraries WHERE id = v_booking.library_id;

    -- 5. REVALIDATE ELIGIBILITY

    -- 5a. Student account status
    IF COALESCE(v_student.status, 'active') IN ('blocked', 'suspended') THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'STUDENT_BLOCKED',
            'message', 'Student account is blocked.'
        );
    END IF;

    -- 5b. Seat status
    IF v_seat.status::text = 'maintenance' OR EXISTS (
        SELECT 1 FROM public.seat_maintenance 
        WHERE seat_id = v_booking.seat_id AND status != 'Resolved'
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'SEAT_MAINTENANCE',
            'message', 'Seat is under maintenance.'
        );
    END IF;

    -- 5c. Slot master or occurrence status
    IF v_slot.status::text = 'inactive' OR (v_slot.is_active IS FALSE) THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'SLOT_CANCELLED',
            'message', 'Slot was cancelled.'
        );
    END IF;

    IF v_booking.slot_occurrence_id IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM public.slot_occurrences WHERE id = v_booking.slot_occurrence_id AND status = 'cancelled') THEN
            RETURN jsonb_build_object(
                'success', false,
                'status_code', 'SLOT_CANCELLED',
                'message', 'Slot was cancelled.'
            );
        END IF;
    END IF;

    -- 5d. Check booking status (Idempotency & invalid states)
    IF v_booking.status::text = 'checked_in' THEN
        RETURN jsonb_build_object(
            'success', true,
            'already_checked_in', true,
            'status_code', 'ALREADY_CHECKED_IN',
            'message', 'Student is already checked in.',
            'booking', jsonb_build_object(
                'id', v_booking.id,
                'booking_code', v_booking.booking_code,
                'student_id', v_student.id,
                'student_name', COALESCE(v_student.full_name, 'Student'),
                'registration_number', COALESCE(v_student.registration_number, v_student.department, 'N/A'),
                'seat_number', COALESCE(v_seat.seat_number, 'S-01'),
                'floor_name', COALESCE(v_floor.name, 'Ground Floor'),
                'room_name', COALESCE(v_room.name, 'Main Reading Hall'),
                'library_name', COALESCE(v_library.name, 'Central Library'),
                'slot_name', COALESCE(v_slot.name, 'Time Slot'),
                'slot_time', TO_CHAR(v_slot.start_time, 'HH12:MI AM') || ' – ' || TO_CHAR(v_slot.end_time, 'HH12:MI AM'),
                'booking_date', v_booking.booking_date,
                'status', 'checked_in',
                'checked_in_at', v_booking.checked_in_at
            )
        );
    END IF;

    IF v_booking.status::text = 'cancelled' THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'BOOKING_CANCELLED',
            'message', 'Booking was cancelled.'
        );
    END IF;

    IF v_booking.status::text IN ('checked_out', 'completed') THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'BOOKING_EXPIRED',
            'message', 'Booking has expired.'
        );
    END IF;

    IF v_booking.status::text = 'no_show' THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'NO_SHOW',
            'message', 'Booking is marked as no-show.'
        );
    END IF;

    -- 5e. Booking date check (Asia/Kolkata)
    IF v_booking.booking_date > v_kolkata_today THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'CHECKIN_NOT_STARTED',
            'message', 'Check-in window has not started.'
        );
    ELSIF v_booking.booking_date < v_kolkata_today THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'BOOKING_EXPIRED',
            'message', 'Booking has expired.'
        );
    END IF;

    -- 5f. Time window check (Asia/Kolkata) with 15-minute grace start
    v_checkin_start := v_slot.start_time - INTERVAL '15 minutes';
    IF v_kolkata_now_time < v_checkin_start THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'CHECKIN_NOT_STARTED',
            'message', 'Check-in window has not started.'
        );
    ELSIF v_kolkata_now_time > v_slot.end_time THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'GRACE_PERIOD_EXPIRED',
            'message', 'Check-in grace period has expired.'
        );
    END IF;

    -- 6. ATOMIC UPDATE
    UPDATE public.bookings
    SET
        status = 'checked_in',
        checked_in_at = NOW(),
        checked_in_by = v_staff_id,
        updated_at = NOW()
    WHERE id = v_booking.id;

    -- 7. Insert Single Check-in Log Entry
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
            v_booking.id,
            v_booking.student_id,
            v_staff_id,
            v_booking.seat_id,
            v_booking.library_id,
            v_booking.slot_id,
            v_booking.slot_occurrence_id,
            'check_in',
            v_checkin_method,
            v_checkin_method,
            'Desk Check-In Verified (' || v_checkin_method || ')',
            NOW()
        );
    EXCEPTION WHEN OTHERS THEN NULL; END;

    -- 8. Create Student Notification
    BEGIN
        INSERT INTO public.notifications (
            recipient_id,
            title,
            message,
            type,
            reference_id,
            created_at
        ) VALUES (
            v_booking.student_id,
            '✓ Seat Check-In Verified',
            'You are checked in at seat ' || COALESCE(v_seat.seat_number, 'assigned') || ' for ' || COALESCE(v_slot.name, 'your slot') || '.',
            'check_in',
            v_booking.id,
            NOW()
        );
    EXCEPTION WHEN OTHERS THEN NULL; END;

    -- 9. Insert Audit Log
    BEGIN
        INSERT INTO public.audit_logs (actor_id, target_id, event_type, metadata, created_at)
        VALUES (v_staff_id, v_booking.id, 'BOOKING_CHECKIN', jsonb_build_object('method', v_checkin_method, 'scanned_payload', p_scanned_payload), NOW());
    EXCEPTION WHEN OTHERS THEN NULL; END;

    RETURN jsonb_build_object(
        'success', true,
        'status_code', 'SUCCESS',
        'message', 'Check-in Successful',
        'booking', jsonb_build_object(
            'id', v_booking.id,
            'booking_code', v_booking.booking_code,
            'student_id', v_student.id,
            'student_name', COALESCE(v_student.full_name, 'Student'),
            'registration_number', COALESCE(v_student.registration_number, v_student.department, 'N/A'),
            'department', COALESCE(v_student.department, 'N/A'),
            'seat_number', COALESCE(v_seat.seat_number, 'S-01'),
            'floor_name', COALESCE(v_floor.name, 'Ground Floor'),
            'room_name', COALESCE(v_room.name, 'Main Reading Hall'),
            'library_name', COALESCE(v_library.name, 'Central Library'),
            'slot_name', COALESCE(v_slot.name, 'Time Slot'),
            'slot_time', TO_CHAR(v_slot.start_time, 'HH12:MI AM') || ' – ' || TO_CHAR(v_slot.end_time, 'HH12:MI AM'),
            'start_time', TO_CHAR(v_slot.start_time, 'HH12:MI AM'),
            'end_time', TO_CHAR(v_slot.end_time, 'HH12:MI AM'),
            'booking_date', v_booking.booking_date,
            'status', 'checked_in',
            'checked_in_at', NOW()
        )
    );
END;
$$;


-- 3. Lookup Booking by ID / Booking Code / QR Token RPC: lookup_booking_by_identifier
DROP FUNCTION IF EXISTS public.lookup_booking_by_identifier CASCADE;

CREATE OR REPLACE FUNCTION public.lookup_booking_by_identifier(
    p_identifier TEXT,
    p_librarian_library_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clean TEXT := TRIM(COALESCE(p_identifier, ''));
    v_booking RECORD;
    v_student RECORD;
    v_slot RECORD;
    v_seat RECORD;
    v_room RECORD;
    v_floor RECORD;
    v_library RECORD;
    v_kolkata_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE;
    v_kolkata_now TIME := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::TIME;
    v_eligibility_code TEXT := 'ELIGIBLE';
    v_eligibility_msg TEXT := 'Eligible for check-in.';
    v_is_eligible BOOLEAN := TRUE;
BEGIN
    IF v_clean = '' THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'MISSING_IDENTIFIER',
            'message', 'Please enter a Booking ID or code.'
        );
    END IF;

    -- Query public.bookings by id, booking_code, or qr_token
    SELECT b.* INTO v_booking
    FROM public.bookings b
    WHERE b.id::text = v_clean
       OR UPPER(b.booking_code) = UPPER(v_clean)
       OR b.qr_token = v_clean
    LIMIT 1;

    IF v_booking.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'BOOKING_NOT_FOUND',
            'message', 'Booking not found'
        );
    END IF;

    -- Join profiles, seats, slots, rooms, floors, libraries
    SELECT * INTO v_student FROM public.profiles WHERE id = v_booking.student_id;
    SELECT * INTO v_seat FROM public.seats WHERE id = v_booking.seat_id;
    SELECT * INTO v_slot FROM public.slots WHERE id = v_booking.slot_id;
    SELECT * INTO v_room FROM public.rooms WHERE id = v_booking.room_id;
    SELECT * INTO v_floor FROM public.floors WHERE id = v_booking.floor_id;
    SELECT * INTO v_library FROM public.libraries WHERE id = v_booking.library_id;

    -- Check Library assignment if specified
    IF p_librarian_library_id IS NOT NULL AND v_booking.library_id != p_librarian_library_id THEN
        v_is_eligible := FALSE;
        v_eligibility_code := 'WRONG_LIBRARY';
        v_eligibility_msg := 'This booking belongs to another library';
    ELSIF COALESCE(v_student.status, 'active') IN ('blocked', 'suspended') THEN
        v_is_eligible := FALSE;
        v_eligibility_code := 'STUDENT_BLOCKED';
        v_eligibility_msg := 'Student account is blocked';
    ELSIF v_seat.status::text = 'maintenance' OR EXISTS (SELECT 1 FROM public.seat_maintenance WHERE seat_id = v_booking.seat_id AND status != 'Resolved') THEN
        v_is_eligible := FALSE;
        v_eligibility_code := 'SEAT_MAINTENANCE';
        v_eligibility_msg := 'Seat is under maintenance';
    ELSIF v_slot.status::text = 'inactive' OR (v_slot.is_active IS FALSE) OR (v_booking.slot_occurrence_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.slot_occurrences WHERE id = v_booking.slot_occurrence_id AND status = 'cancelled')) THEN
        v_is_eligible := FALSE;
        v_eligibility_code := 'SLOT_CANCELLED';
        v_eligibility_msg := 'Slot was cancelled';
    ELSIF v_booking.status::text = 'checked_in' THEN
        v_is_eligible := FALSE;
        v_eligibility_code := 'ALREADY_CHECKED_IN';
        v_eligibility_msg := 'Student is already checked in';
    ELSIF v_booking.status::text = 'cancelled' THEN
        v_is_eligible := FALSE;
        v_eligibility_code := 'BOOKING_CANCELLED';
        v_eligibility_msg := 'Booking was cancelled';
    ELSIF v_booking.status::text IN ('checked_out', 'completed') THEN
        v_is_eligible := FALSE;
        v_eligibility_code := 'BOOKING_EXPIRED';
        v_eligibility_msg := 'Booking has expired';
    ELSIF v_booking.status::text = 'no_show' THEN
        v_is_eligible := FALSE;
        v_eligibility_code := 'NO_SHOW';
        v_eligibility_msg := 'Booking is marked as no-show';
    ELSIF v_booking.booking_date > v_kolkata_today THEN
        v_is_eligible := FALSE;
        v_eligibility_code := 'CHECKIN_NOT_STARTED';
        v_eligibility_msg := 'No eligible booking found for today';
    ELSIF v_booking.booking_date < v_kolkata_today THEN
        v_is_eligible := FALSE;
        v_eligibility_code := 'BOOKING_EXPIRED';
        v_eligibility_msg := 'Booking has expired';
    ELSIF v_kolkata_now < (v_slot.start_time - INTERVAL '15 minutes') THEN
        v_is_eligible := FALSE;
        v_eligibility_code := 'CHECKIN_NOT_STARTED';
        v_eligibility_msg := 'Check-in window has not started';
    ELSIF v_kolkata_now > v_slot.end_time THEN
        v_is_eligible := FALSE;
        v_eligibility_code := 'GRACE_PERIOD_EXPIRED';
        v_eligibility_msg := 'Check-in grace period has expired';
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'status_code', 'SUCCESS',
        'message', 'Booking found.',
        'is_eligible', v_is_eligible,
        'eligibility_code', v_eligibility_code,
        'eligibility_message', v_eligibility_msg,
        'booking', jsonb_build_object(
            'id', v_booking.id,
            'booking_code', v_booking.booking_code,
            'student_id', v_student.id,
            'student_name', COALESCE(v_student.full_name, 'Student'),
            'registration_number', COALESCE(v_student.registration_number, v_student.department, 'N/A'),
            'department', COALESCE(v_student.department, 'N/A'),
            'avatar_url', v_student.avatar_url,
            'seat_id', v_seat.id,
            'seat_number', COALESCE(v_seat.seat_number, 'S-01'),
            'room_name', COALESCE(v_room.name, 'Main Reading Hall'),
            'floor_name', COALESCE(v_floor.name, 'Ground Floor'),
            'library_name', COALESCE(v_library.name, 'Central Library'),
            'library_id', v_booking.library_id,
            'slot_name', COALESCE(v_slot.name, 'Time Slot'),
            'slot_time', TO_CHAR(v_slot.start_time, 'HH12:MI AM') || ' – ' || TO_CHAR(v_slot.end_time, 'HH12:MI AM'),
            'start_time', TO_CHAR(v_slot.start_time, 'HH12:MI AM'),
            'end_time', TO_CHAR(v_slot.end_time, 'HH12:MI AM'),
            'booking_date', v_booking.booking_date,
            'status', v_booking.status,
            'checked_in_at', v_booking.checked_in_at
        )
    );
END;
$$;


-- 4. Lookup Bookings by Register Number / College ID RPC: lookup_bookings_by_register_number
DROP FUNCTION IF EXISTS public.lookup_bookings_by_register_number CASCADE;

CREATE OR REPLACE FUNCTION public.lookup_bookings_by_register_number(
    p_register_number TEXT,
    p_librarian_library_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clean TEXT := TRIM(COALESCE(p_register_number, ''));
    v_student RECORD;
    v_kolkata_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE;
    v_kolkata_now TIME := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::TIME;
    v_candidates JSONB;
BEGIN
    IF v_clean = '' THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'MISSING_REGISTER_NUMBER',
            'message', 'Please enter a student register number or college ID.',
            'matches', '[]'::jsonb
        );
    END IF;

    -- Step 1: Find student in public.profiles using actual registration_number column
    SELECT * INTO v_student
    FROM public.profiles
    WHERE UPPER(registration_number) = UPPER(v_clean)
    LIMIT 1;

    IF v_student.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'STUDENT_NOT_FOUND',
            'message', 'Student register number not found',
            'matches', '[]'::jsonb
        );
    END IF;

    -- Step 2: Use matched profile UUID to query public.bookings.student_id for today's bookings
    SELECT jsonb_agg(
        jsonb_build_object(
            'id', b.id,
            'booking_code', b.booking_code,
            'student_id', v_student.id,
            'student_name', COALESCE(v_student.full_name, 'Student'),
            'registration_number', COALESCE(v_student.registration_number, v_student.department, 'N/A'),
            'department', COALESCE(v_student.department, 'N/A'),
            'avatar_url', v_student.avatar_url,
            'seat_id', s.id,
            'seat_number', COALESCE(s.seat_number, 'S-01'),
            'room_name', COALESCE(r.name, 'Reading Hall'),
            'floor_name', COALESCE(fl.name, 'Ground Floor'),
            'library_name', COALESCE(l.name, 'Central Library'),
            'library_id', b.library_id,
            'slot_name', COALESCE(sl.name, 'Time Slot'),
            'slot_time', TO_CHAR(sl.start_time, 'HH12:MI AM') || ' – ' || TO_CHAR(sl.end_time, 'HH12:MI AM'),
            'start_time', TO_CHAR(sl.start_time, 'HH12:MI AM'),
            'end_time', TO_CHAR(sl.end_time, 'HH12:MI AM'),
            'booking_date', b.booking_date,
            'status', b.status,
            'checked_in_at', b.checked_in_at,
            'is_eligible', CASE
                WHEN p_librarian_library_id IS NOT NULL AND b.library_id != p_librarian_library_id THEN FALSE
                WHEN COALESCE(v_student.status, 'active') IN ('blocked', 'suspended') THEN FALSE
                WHEN s.status::text = 'maintenance' OR EXISTS (SELECT 1 FROM public.seat_maintenance WHERE seat_id = b.seat_id AND status != 'Resolved') THEN FALSE
                WHEN sl.status::text = 'inactive' OR (sl.is_active IS FALSE) OR (b.slot_occurrence_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.slot_occurrences WHERE id = b.slot_occurrence_id AND status = 'cancelled')) THEN FALSE
                WHEN b.status::text = 'checked_in' THEN FALSE
                WHEN b.status::text = 'cancelled' THEN FALSE
                WHEN b.status::text IN ('checked_out', 'completed') THEN FALSE
                WHEN b.status::text = 'no_show' THEN FALSE
                WHEN b.booking_date != v_kolkata_today THEN FALSE
                WHEN v_kolkata_now < (sl.start_time - INTERVAL '15 minutes') THEN FALSE
                WHEN v_kolkata_now > sl.end_time THEN FALSE
                ELSE TRUE
            END,
            'eligibility_code', CASE
                WHEN p_librarian_library_id IS NOT NULL AND b.library_id != p_librarian_library_id THEN 'WRONG_LIBRARY'
                WHEN COALESCE(v_student.status, 'active') IN ('blocked', 'suspended') THEN 'STUDENT_BLOCKED'
                WHEN s.status::text = 'maintenance' OR EXISTS (SELECT 1 FROM public.seat_maintenance WHERE seat_id = b.seat_id AND status != 'Resolved') THEN 'SEAT_MAINTENANCE'
                WHEN sl.status::text = 'inactive' OR (sl.is_active IS FALSE) OR (b.slot_occurrence_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.slot_occurrences WHERE id = b.slot_occurrence_id AND status = 'cancelled')) THEN 'SLOT_CANCELLED'
                WHEN b.status::text = 'checked_in' THEN 'ALREADY_CHECKED_IN'
                WHEN b.status::text = 'cancelled' THEN 'BOOKING_CANCELLED'
                WHEN b.status::text IN ('checked_out', 'completed') THEN 'BOOKING_EXPIRED'
                WHEN b.status::text = 'no_show' THEN 'NO_SHOW'
                WHEN b.booking_date != v_kolkata_today THEN 'NO_ELIGIBLE_BOOKING'
                WHEN v_kolkata_now < (sl.start_time - INTERVAL '15 minutes') THEN 'CHECKIN_NOT_STARTED'
                WHEN v_kolkata_now > sl.end_time THEN 'GRACE_PERIOD_EXPIRED'
                ELSE 'ELIGIBLE'
            END,
            'eligibility_message', CASE
                WHEN p_librarian_library_id IS NOT NULL AND b.library_id != p_librarian_library_id THEN 'This booking belongs to another library'
                WHEN COALESCE(v_student.status, 'active') IN ('blocked', 'suspended') THEN 'Student account is blocked'
                WHEN s.status::text = 'maintenance' OR EXISTS (SELECT 1 FROM public.seat_maintenance WHERE seat_id = b.seat_id AND status != 'Resolved') THEN 'Seat is under maintenance'
                WHEN sl.status::text = 'inactive' OR (sl.is_active IS FALSE) OR (b.slot_occurrence_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.slot_occurrences WHERE id = b.slot_occurrence_id AND status = 'cancelled')) THEN 'Slot was cancelled'
                WHEN b.status::text = 'checked_in' THEN 'Student is already checked in'
                WHEN b.status::text = 'cancelled' THEN 'Booking was cancelled'
                WHEN b.status::text IN ('checked_out', 'completed') THEN 'Booking has expired'
                WHEN b.status::text = 'no_show' THEN 'Booking is marked as no-show'
                WHEN b.booking_date != v_kolkata_today THEN 'No eligible booking found for today'
                WHEN v_kolkata_now < (sl.start_time - INTERVAL '15 minutes') THEN 'Check-in window has not started'
                WHEN v_kolkata_now > sl.end_time THEN 'Check-in grace period has expired'
                ELSE 'Eligible for check-in.'
            END
        ) ORDER BY b.created_at DESC
    ) INTO v_candidates
    FROM public.bookings b
    JOIN public.seats s ON s.id = b.seat_id
    JOIN public.slots sl ON sl.id = b.slot_id
    LEFT JOIN public.rooms r ON r.id = b.room_id
    LEFT JOIN public.floors fl ON fl.id = b.floor_id
    LEFT JOIN public.libraries l ON l.id = b.library_id
    WHERE b.student_id = v_student.id
      AND b.booking_date = v_kolkata_today;

    IF v_candidates IS NULL OR jsonb_array_length(v_candidates) = 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'NO_ELIGIBLE_BOOKING',
            'message', 'No eligible booking found for this student.',
            'matches', '[]'::jsonb
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'status_code', 'SUCCESS',
        'message', 'Matching bookings found.',
        'matches', v_candidates
    );
END;
$$;


-- 5. Security Grants
GRANT EXECUTE ON FUNCTION public.check_in_booking(UUID, TEXT, TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.lookup_booking_by_identifier(TEXT, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.lookup_bookings_by_register_number(TEXT, UUID) TO authenticated, anon;
