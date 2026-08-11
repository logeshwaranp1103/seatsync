-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 34: COMPLETE CHECK-IN, CHECKOUT & REALTIME ENGINE
-- ====================================================================

-- 1. Extend check_in_logs table columns for complete auditing
ALTER TABLE public.check_in_logs ADD COLUMN IF NOT EXISTS seat_id UUID;
ALTER TABLE public.check_in_logs ADD COLUMN IF NOT EXISTS library_id UUID;
ALTER TABLE public.check_in_logs ADD COLUMN IF NOT EXISTS slot_id UUID;
ALTER TABLE public.check_in_logs ADD COLUMN IF NOT EXISTS slot_occurrence_id UUID;
ALTER TABLE public.check_in_logs ADD COLUMN IF NOT EXISTS override_used BOOLEAN DEFAULT FALSE;
ALTER TABLE public.check_in_logs ADD COLUMN IF NOT EXISTS override_reason TEXT;

-- 2. Lookup Booking by QR RPC
DROP FUNCTION IF EXISTS public.lookup_booking_by_qr CASCADE;

CREATE OR REPLACE FUNCTION public.lookup_booking_by_qr(
    p_qr_token TEXT
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
    v_extracted_token TEXT;
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
    v_eligibility_code TEXT := 'ELIGIBLE';
    v_eligibility_msg TEXT := 'Ready for check-in.';
BEGIN
    IF v_staff_id IS NULL THEN
        RETURN jsonb_build_object('valid', false, 'status_code', 'staff_not_authorized', 'message', 'Staff authentication required.');
    END IF;

    SELECT id, full_name, role, status INTO v_staff_profile FROM public.profiles WHERE id = v_staff_id;
    IF v_staff_profile.id IS NULL OR v_staff_profile.role NOT IN ('librarian', 'staff', 'admin') THEN
        RETURN jsonb_build_object('valid', false, 'status_code', 'staff_not_authorized', 'message', 'Staff authorization required.');
    END IF;

    -- Extract token if URI or JSON passed
    IF v_clean_token LIKE 'seatsync://entry?%' THEN
        v_extracted_token := COALESCE(SUBSTRING(v_clean_token FROM '[?&]token=([^&]+)'), v_clean_token);
    ELSIF v_clean_token LIKE '{"%' THEN
        BEGIN
            v_extracted_token := COALESCE((v_clean_token::jsonb)->>'token', v_clean_token);
        EXCEPTION WHEN OTHERS THEN
            v_extracted_token := v_clean_token;
        END;
    ELSE
        v_extracted_token := v_clean_token;
    END IF;

    -- LOOKUP FIRST with flexible token/id/code matching
    SELECT b.* INTO v_booking
    FROM public.bookings b
    WHERE b.qr_token = v_extracted_token
       OR b.qr_token = v_clean_token
       OR b.id::text = v_clean_token
       OR b.id::text = v_extracted_token
       OR b.id::text = REPLACE(v_clean_token, '-ENTRY', '')
       OR b.id::text = REPLACE(v_extracted_token, '-ENTRY', '')
       OR UPPER(b.booking_code) = UPPER(v_clean_token)
       OR UPPER(b.booking_code) = UPPER(v_extracted_token);

    IF v_booking.id IS NULL THEN
        RETURN jsonb_build_object(
            'valid', false,
            'status_code', 'booking_not_found',
            'message', 'No booking matches this QR token.'
        );
    END IF;

    SELECT * INTO v_student FROM public.profiles WHERE id = v_booking.student_id;
    SELECT * INTO v_seat FROM public.seats WHERE id = v_booking.seat_id;
    SELECT * INTO v_slot FROM public.slots WHERE id = v_booking.slot_id;
    SELECT * INTO v_room FROM public.rooms WHERE id = v_booking.room_id;
    SELECT * INTO v_floor FROM public.floors WHERE id = v_booking.floor_id;
    SELECT * INTO v_library FROM public.libraries WHERE id = v_booking.library_id;

    -- VALIDATE SECOND
    IF COALESCE(v_student.status, 'active') IN ('blocked', 'suspended') THEN
        v_eligibility_code := 'STUDENT_BLOCKED';
        v_eligibility_msg := 'Student account is suspended or blocked.';
    ELSIF v_booking.status::text = 'checked_in' THEN
        v_eligibility_code := 'ALREADY_CHECKED_IN';
        v_eligibility_msg := 'Student is already checked in.';
    ELSIF v_booking.status::text IN ('checked_out', 'completed') THEN
        v_eligibility_code := 'ALREADY_CHECKED_OUT';
        v_eligibility_msg := 'Student has already checked out.';
    ELSIF v_booking.status::text = 'cancelled' THEN
        v_eligibility_code := 'BOOKING_CANCELLED';
        v_eligibility_msg := 'This booking was cancelled.';
    ELSIF v_booking.booking_date != v_kolkata_today THEN
        v_eligibility_code := 'WRONG_DATE';
        v_eligibility_msg := 'This pass is valid for ' || TO_CHAR(v_booking.booking_date, 'DD-MM-YYYY') || '.';
    ELSE
        v_checkin_start := v_slot.start_time - INTERVAL '15 minutes';
        IF v_kolkata_now_time < v_checkin_start THEN
            v_eligibility_code := 'TOO_EARLY';
            v_eligibility_msg := 'Check-in opens at ' || TO_CHAR(v_checkin_start, 'HH12:MI AM') || '.';
        ELSIF v_kolkata_now_time > v_slot.end_time THEN
            v_eligibility_code := 'GRACE_PERIOD_EXPIRED';
            v_eligibility_msg := 'The check-in period for this slot has ended.';
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'valid', (v_eligibility_code IN ('ELIGIBLE', 'ALREADY_CHECKED_IN')),
        'status_code', v_eligibility_code,
        'message', v_eligibility_msg,
        'booking', jsonb_build_object(
            'id', v_booking.id,
            'booking_code', v_booking.booking_code,
            'student_id', v_student.id,
            'student_name', COALESCE(v_student.full_name, 'Student'),
            'registration_number', COALESCE(v_student.registration_number, v_student.department, 'N/A'),
            'email', v_student.email,
            'seat_id', v_seat.id,
            'seat_number', COALESCE(v_seat.seat_number, 'S-01'),
            'room_name', COALESCE(v_room.name, 'Reading Hall'),
            'floor_name', COALESCE(v_floor.name, 'Ground Floor'),
            'library_name', COALESCE(v_library.name, 'Central Library'),
            'slot_id', v_slot.id,
            'slot_name', COALESCE(v_slot.name, 'Time Slot'),
            'slot_time', TO_CHAR(v_slot.start_time, 'HH12:MI AM') || ' – ' || TO_CHAR(v_slot.end_time, 'HH12:MI AM'),
            'booking_date', v_booking.booking_date,
            'status', v_booking.status,
            'qr_token', v_booking.qr_token,
            'checked_in_at', v_booking.checked_in_at,
            'checked_out_at', v_booking.checked_out_at
        )
    );
END;
$$;


-- 3. Lookup Bookings for Manual Check-In RPC
DROP FUNCTION IF EXISTS public.lookup_booking_for_manual_checkin CASCADE;

CREATE OR REPLACE FUNCTION public.lookup_booking_for_manual_checkin(
    p_identifier TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_staff_id UUID := auth.uid();
    v_clean TEXT := TRIM(COALESCE(p_identifier, ''));
    v_extracted TEXT := REPLACE(v_clean, '-ENTRY', '');
    v_kolkata_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE;
    v_kolkata_now TIME := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::TIME;
    v_candidates JSONB;
BEGIN
    IF v_staff_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Staff authentication required.', 'matches', '[]'::jsonb);
    END IF;

    IF v_clean = '' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Please enter a booking code, registration number, or email.', 'matches', '[]'::jsonb);
    END IF;

    SELECT jsonb_agg(
        jsonb_build_object(
            'id', b.id,
            'booking_code', b.booking_code,
            'student_id', p.id,
            'student_name', COALESCE(p.full_name, 'Student'),
            'registration_number', COALESCE(p.registration_number, p.department, 'N/A'),
            'email', p.email,
            'seat_id', s.id,
            'seat_number', COALESCE(s.seat_number, 'S-01'),
            'room_name', COALESCE(r.name, 'Reading Hall'),
            'floor_name', COALESCE(fl.name, 'Ground Floor'),
            'library_name', COALESCE(l.name, 'Central Library'),
            'slot_name', COALESCE(sl.name, 'Time Slot'),
            'slot_time', TO_CHAR(sl.start_time, 'HH12:MI AM') || ' – ' || TO_CHAR(sl.end_time, 'HH12:MI AM'),
            'booking_date', b.booking_date,
            'status', b.status,
            'checked_in_at', b.checked_in_at,
            'checked_out_at', b.checked_out_at,
            'eligibility_code', CASE
                WHEN COALESCE(p.status, 'active') IN ('blocked', 'suspended') THEN 'STUDENT_BLOCKED'
                WHEN b.status::text = 'checked_in' THEN 'ALREADY_CHECKED_IN'
                WHEN b.status::text IN ('checked_out', 'completed') THEN 'ALREADY_CHECKED_OUT'
                WHEN b.status::text = 'cancelled' THEN 'BOOKING_CANCELLED'
                WHEN b.booking_date != v_kolkata_today THEN 'WRONG_DATE'
                WHEN v_kolkata_now < (sl.start_time - INTERVAL '15 minutes') THEN 'TOO_EARLY'
                WHEN v_kolkata_now > sl.end_time THEN 'GRACE_PERIOD_EXPIRED'
                ELSE 'ELIGIBLE'
            END,
            'eligibility_message', CASE
                WHEN COALESCE(p.status, 'active') IN ('blocked', 'suspended') THEN 'Account suspended.'
                WHEN b.status::text = 'checked_in' THEN 'Already checked in.'
                WHEN b.status::text IN ('checked_out', 'completed') THEN 'Already checked out.'
                WHEN b.status::text = 'cancelled' THEN 'Booking cancelled.'
                WHEN b.booking_date != v_kolkata_today THEN 'Valid for ' || TO_CHAR(b.booking_date, 'DD-MM-YYYY') || '.'
                WHEN v_kolkata_now < (sl.start_time - INTERVAL '15 minutes') THEN 'Check-in opens at ' || TO_CHAR(sl.start_time - INTERVAL '15 minutes', 'HH12:MI AM') || '.'
                WHEN v_kolkata_now > sl.end_time THEN 'Check-in period ended.'
                ELSE 'Ready for check-in.'
            END
        )
    ) INTO v_candidates
    FROM public.bookings b
    JOIN public.profiles p ON p.id = b.student_id
    JOIN public.seats s ON s.id = b.seat_id
    JOIN public.slots sl ON sl.id = b.slot_id
    LEFT JOIN public.rooms r ON r.id = b.room_id
    LEFT JOIN public.floors fl ON fl.id = b.floor_id
    LEFT JOIN public.libraries l ON l.id = b.library_id
    WHERE UPPER(b.booking_code) = UPPER(v_clean)
       OR b.qr_token = v_clean
       OR b.id::text = v_clean
       OR b.id::text = v_extracted
       OR UPPER(p.registration_number) = UPPER(v_clean)
       OR LOWER(p.email) = LOWER(v_clean)
       OR p.department ILIKE v_clean;

    IF v_candidates IS NULL OR jsonb_array_length(v_candidates) = 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'No booking record found matching identifier: ' || v_clean,
            'matches', '[]'::jsonb
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Matching bookings found.',
        'matches', v_candidates
    );
END;
$$;


-- 4. Atomic Check-In RPC: check_in_booking()
DROP FUNCTION IF EXISTS public.check_in_booking CASCADE;

CREATE OR REPLACE FUNCTION public.check_in_booking(
    p_booking_id UUID,
    p_method TEXT DEFAULT 'manual',
    p_qr_token TEXT DEFAULT NULL,
    p_scan_nonce UUID DEFAULT NULL,
    p_override_reason TEXT DEFAULT NULL
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
    v_is_override BOOLEAN := FALSE;
    v_override_text TEXT := TRIM(COALESCE(p_override_reason, ''));
BEGIN
    IF v_staff_id IS NULL THEN
        RETURN jsonb_build_object('valid', false, 'status_code', 'staff_not_authorized', 'message', 'Unauthenticated request. Staff sign-in required.');
    END IF;

    SELECT id, full_name, role, status INTO v_staff_profile FROM public.profiles WHERE id = v_staff_id;
    IF v_staff_profile.id IS NULL OR v_staff_profile.role NOT IN ('librarian', 'staff', 'admin') THEN
        RETURN jsonb_build_object('valid', false, 'status_code', 'staff_not_authorized', 'message', 'Access denied. Staff role required.');
    END IF;

    -- Nonce check
    IF p_scan_nonce IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM public.scan_nonces WHERE id = p_scan_nonce OR nonce = p_scan_nonce::text) THEN
            RETURN jsonb_build_object('valid', false, 'status_code', 'nonce_reused', 'message', 'Scan request already processed.');
        END IF;
    END IF;

    -- LOCK BOOKING ROW
    SELECT b.* INTO v_booking
    FROM public.bookings b
    WHERE b.id = p_booking_id
    FOR UPDATE OF b;

    IF v_booking.id IS NULL THEN
        RETURN jsonb_build_object('valid', false, 'status_code', 'booking_not_found', 'message', 'Booking record not found.');
    END IF;

    SELECT * INTO v_student FROM public.profiles WHERE id = v_booking.student_id;
    SELECT * INTO v_seat FROM public.seats WHERE id = v_booking.seat_id;
    SELECT * INTO v_slot FROM public.slots WHERE id = v_booking.slot_id;
    SELECT * INTO v_room FROM public.rooms WHERE id = v_booking.room_id;
    SELECT * INTO v_floor FROM public.floors WHERE id = v_booking.floor_id;
    SELECT * INTO v_library FROM public.libraries WHERE id = v_booking.library_id;

    -- Validations
    IF COALESCE(v_student.status, 'active') IN ('blocked', 'suspended') THEN
        RETURN jsonb_build_object('valid', false, 'status_code', 'student_blocked', 'message', 'Student account is blocked or suspended.');
    END IF;

    IF v_booking.status::text = 'checked_in' THEN
        RETURN jsonb_build_object(
            'valid', true,
            'already_checked_in', true,
            'status_code', 'already_checked_in',
            'message', 'Student is already checked in.',
            'booking_id', v_booking.id,
            'student_name', COALESCE(v_student.full_name, 'Student'),
            'checked_in_at', v_booking.checked_in_at
        );
    END IF;

    IF v_booking.status::text IN ('checked_out', 'completed') THEN
        RETURN jsonb_build_object('valid', false, 'status_code', 'already_checked_out', 'message', 'Student has already checked out.');
    END IF;

    IF v_booking.status::text = 'cancelled' THEN
        RETURN jsonb_build_object('valid', false, 'status_code', 'booking_cancelled', 'message', 'This booking was cancelled.');
    END IF;

    -- Time/Date Window check & Override logic
    IF v_booking.booking_date != v_kolkata_today THEN
        IF v_override_text != '' THEN
            v_is_override := TRUE;
        ELSE
            RETURN jsonb_build_object('valid', false, 'status_code', 'wrong_date', 'message', 'This pass is valid on ' || TO_CHAR(v_booking.booking_date, 'DD-MM-YYYY') || '. Override reason required.');
        END IF;
    END IF;

    v_checkin_start := v_slot.start_time - INTERVAL '15 minutes';
    IF v_kolkata_now_time < v_checkin_start THEN
        IF v_override_text != '' THEN
            v_is_override := TRUE;
        ELSE
            RETURN jsonb_build_object('valid', false, 'status_code', 'too_early', 'message', 'Check-in opens at ' || TO_CHAR(v_checkin_start, 'HH12:MI AM') || '. Override reason required.');
        END IF;
    ELSIF v_kolkata_now_time > v_slot.end_time THEN
        IF v_override_text != '' THEN
            v_is_override := TRUE;
        ELSE
            RETURN jsonb_build_object('valid', false, 'status_code', 'grace_period_expired', 'message', 'The check-in window for this slot has expired. Override reason required.');
        END IF;
    END IF;

    -- ATOMIC UPDATE
    UPDATE public.bookings
    SET
        status = 'checked_in',
        checked_in_at = NOW(),
        checked_in_by = v_staff_id,
        updated_at = NOW()
    WHERE id = v_booking.id;

    -- Record Nonce
    IF p_scan_nonce IS NOT NULL THEN
        BEGIN
            INSERT INTO public.scan_nonces (id, nonce, booking_id, scanned_by, scanned_at)
            VALUES (p_scan_nonce, p_scan_nonce::text, v_booking.id, v_staff_id, NOW());
        EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;

    -- Check-in Log Entry
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
            notes,
            override_used,
            override_reason,
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
            COALESCE(p_method, 'manual'),
            CASE WHEN v_is_override THEN 'Override Check-In: ' || v_override_text ELSE 'Check-In Completed' END,
            v_is_override,
            v_override_text,
            NOW()
        );
    EXCEPTION WHEN OTHERS THEN NULL; END;

    -- Notification to Student
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

    -- Audit Log Entry
    BEGIN
        INSERT INTO public.audit_logs (actor_id, target_id, event_type, metadata, created_at)
        VALUES (v_staff_id, v_booking.id, 'BOOKING_CHECKIN', jsonb_build_object('method', p_method, 'override', v_is_override, 'reason', v_override_text), NOW());
    EXCEPTION WHEN OTHERS THEN NULL; END;

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


-- 5. Atomic Checkout RPC: check_out_booking()
DROP FUNCTION IF EXISTS public.check_out_booking CASCADE;

CREATE OR REPLACE FUNCTION public.check_out_booking(
    p_booking_id UUID,
    p_method TEXT DEFAULT 'manual',
    p_override_reason TEXT DEFAULT NULL
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
    v_seat RECORD;
    v_slot RECORD;
BEGIN
    IF v_staff_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'status_code', 'staff_not_authorized', 'message', 'Staff authentication required.');
    END IF;

    SELECT id, full_name, role, status INTO v_staff_profile FROM public.profiles WHERE id = v_staff_id;
    IF v_staff_profile.id IS NULL OR v_staff_profile.role NOT IN ('librarian', 'staff', 'admin') THEN
        RETURN jsonb_build_object('success', false, 'status_code', 'staff_not_authorized', 'message', 'Access denied.');
    END IF;

    -- LOCK BOOKING ROW
    SELECT b.* INTO v_booking
    FROM public.bookings b
    WHERE b.id = p_booking_id
    FOR UPDATE OF b;

    IF v_booking.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'status_code', 'booking_not_found', 'message', 'Booking record not found.');
    END IF;

    IF v_booking.status::text IN ('checked_out', 'completed') THEN
        RETURN jsonb_build_object('success', false, 'status_code', 'already_checked_out', 'message', 'This booking has already been checked out.');
    END IF;

    IF v_booking.status::text != 'checked_in' THEN
        RETURN jsonb_build_object('success', false, 'status_code', 'not_checked_in', 'message', 'Student is not currently checked in.');
    END IF;

    SELECT * INTO v_student FROM public.profiles WHERE id = v_booking.student_id;
    SELECT * INTO v_seat FROM public.seats WHERE id = v_booking.seat_id;
    SELECT * INTO v_slot FROM public.slots WHERE id = v_booking.slot_id;

    -- ATOMIC UPDATE
    UPDATE public.bookings
    SET
        status = 'checked_out',
        checked_out_at = NOW(),
        checked_out_by = v_staff_id,
        updated_at = NOW()
    WHERE id = v_booking.id;

    -- Insert/Update Check-in Log
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
            'checkout',
            COALESCE(p_method, 'manual'),
            'Checkout Completed',
            NOW()
        );
    EXCEPTION WHEN OTHERS THEN NULL; END;

    -- Notification to Student
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
            '✓ Seat Checkout Completed',
            'You have successfully checked out of seat ' || COALESCE(v_seat.seat_number, 'assigned') || '. Thank you!',
            'checkout',
            v_booking.id,
            NOW()
        );
    EXCEPTION WHEN OTHERS THEN NULL; END;

    -- Audit Log Entry
    BEGIN
        INSERT INTO public.audit_logs (actor_id, target_id, event_type, metadata, created_at)
        VALUES (v_staff_id, v_booking.id, 'BOOKING_CHECKOUT', jsonb_build_object('method', p_method), NOW());
    EXCEPTION WHEN OTHERS THEN NULL; END;

    RETURN jsonb_build_object(
        'success', true,
        'status_code', 'success',
        'message', 'Checkout Completed Successfully',
        'booking_id', v_booking.id,
        'booking_code', v_booking.booking_code,
        'student_id', v_student.id,
        'student_name', COALESCE(v_student.full_name, 'Student'),
        'seat_number', COALESCE(v_seat.seat_number, 'S-01'),
        'checked_out_at', NOW()
    );
END;
$$;


-- 6. Get Current Occupants RPC: get_current_occupants()
DROP FUNCTION IF EXISTS public.get_current_occupants CASCADE;

CREATE OR REPLACE FUNCTION public.get_current_occupants(
    p_library_id UUID DEFAULT NULL,
    p_floor_id UUID DEFAULT NULL,
    p_room_id UUID DEFAULT NULL,
    p_slot_id UUID DEFAULT NULL,
    p_booking_date DATE DEFAULT NULL
)
RETURNS TABLE (
    booking_id UUID,
    booking_code TEXT,
    student_id UUID,
    student_name TEXT,
    registration_number TEXT,
    student_email TEXT,
    seat_id UUID,
    seat_number TEXT,
    room_id UUID,
    room_name TEXT,
    floor_id UUID,
    floor_name TEXT,
    slot_id UUID,
    slot_name TEXT,
    checked_in_at TIMESTAMPTZ,
    time_occupied_minutes INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        b.id AS booking_id,
        b.booking_code,
        p.id AS student_id,
        COALESCE(p.full_name, 'Student') AS student_name,
        COALESCE(p.registration_number, p.department, 'N/A') AS registration_number,
        p.email AS student_email,
        s.id AS seat_id,
        COALESCE(s.seat_number, 'S-01') AS seat_number,
        r.id AS room_id,
        COALESCE(r.name, 'Main Reading Hall') AS room_name,
        fl.id AS floor_id,
        COALESCE(fl.name, 'Ground Floor') AS floor_name,
        sl.id AS slot_id,
        COALESCE(sl.name, 'Time Slot') AS slot_name,
        b.checked_in_at,
        ROUND(EXTRACT(EPOCH FROM (NOW() - b.checked_in_at)) / 60)::INTEGER AS time_occupied_minutes
    FROM public.bookings b
    JOIN public.profiles p ON p.id = b.student_id
    JOIN public.seats s ON s.id = b.seat_id
    JOIN public.slots sl ON sl.id = b.slot_id
    LEFT JOIN public.rooms r ON r.id = b.room_id
    LEFT JOIN public.floors fl ON fl.id = b.floor_id
    WHERE b.status::text = 'checked_in'
      AND b.checked_in_at IS NOT NULL
      AND b.checked_out_at IS NULL
      AND (p_library_id IS NULL OR b.library_id = p_library_id)
      AND (p_floor_id IS NULL OR b.floor_id = p_floor_id)
      AND (p_room_id IS NULL OR b.room_id = p_room_id)
      AND (p_slot_id IS NULL OR b.slot_id = p_slot_id)
      AND (p_booking_date IS NULL OR b.booking_date = p_booking_date)
    ORDER BY b.checked_in_at DESC;
END;
$$;

-- 7. Grant execution privileges
GRANT EXECUTE ON FUNCTION public.lookup_booking_by_qr(TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.lookup_booking_for_manual_checkin(TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.check_in_booking(UUID, TEXT, TEXT, UUID, TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.check_out_booking(UUID, TEXT, TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_current_occupants(UUID, UUID, UUID, UUID, DATE) TO authenticated, anon;
