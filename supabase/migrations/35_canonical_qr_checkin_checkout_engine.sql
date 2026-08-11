-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 35: CANONICAL QR CHECK-IN, MANUAL CHECK-IN & CHECKOUT ENGINE
-- ====================================================================

-- 1. Ensure Table Columns & Constraints
ALTER TABLE public.check_in_logs ADD COLUMN IF NOT EXISTS seat_id UUID;
ALTER TABLE public.check_in_logs ADD COLUMN IF NOT EXISTS library_id UUID;
ALTER TABLE public.check_in_logs ADD COLUMN IF NOT EXISTS slot_id UUID;
ALTER TABLE public.check_in_logs ADD COLUMN IF NOT EXISTS slot_occurrence_id UUID;
ALTER TABLE public.check_in_logs ADD COLUMN IF NOT EXISTS check_in_method TEXT DEFAULT 'qr';
ALTER TABLE public.check_in_logs ADD COLUMN IF NOT EXISTS checkout_method TEXT DEFAULT 'manual';
ALTER TABLE public.check_in_logs ADD COLUMN IF NOT EXISTS scan_nonce UUID;
ALTER TABLE public.check_in_logs ADD COLUMN IF NOT EXISTS override_used BOOLEAN DEFAULT FALSE;
ALTER TABLE public.check_in_logs ADD COLUMN IF NOT EXISTS override_reason TEXT;

-- Verify Unique Index on qr_token
CREATE UNIQUE INDEX IF NOT EXISTS bookings_qr_token_unique
ON public.bookings(qr_token)
WHERE qr_token IS NOT NULL;

-- Backfill missing qr_token ONLY for active confirmed bookings without replacing valid tokens
UPDATE public.bookings
SET qr_token = 'SS-' || UPPER(SUBSTRING(MD5(GEN_RANDOM_UUID()::TEXT || CLOCK_TIMESTAMP()::TEXT) FROM 1 FOR 8)) || '-' || UPPER(SUBSTRING(MD5(id::TEXT) FROM 1 FOR 3))
WHERE qr_token IS NULL AND status IN ('confirmed', 'checked_in');


-- 2. Atomic QR Check-In RPC: check_in_booking_by_qr(p_qr_token, p_scan_nonce)
DROP FUNCTION IF EXISTS public.check_in_booking_by_qr CASCADE;

CREATE OR REPLACE FUNCTION public.check_in_booking_by_qr(
    p_qr_token TEXT,
    p_scan_nonce UUID
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
    v_checkin_start TIME;
BEGIN
    -- Authorization & Staff check
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

    IF v_staff_profile.id IS NULL OR LOWER(v_staff_profile.role::text) NOT IN ('librarian', 'senior_librarian', 'staff', 'admin', 'super_admin') THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'STAFF_NOT_AUTHORIZED',
            'message', 'Access denied. Staff or Librarian role required.'
        );
    END IF;

    -- Nonce check to prevent replay attacks
    IF p_scan_nonce IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM public.scan_nonces WHERE id = p_scan_nonce OR nonce = p_scan_nonce::text) THEN
            RETURN jsonb_build_object(
                'success', false,
                'status_code', 'NONCE_REUSED',
                'message', 'This scan request has already been processed.'
            );
        END IF;
    END IF;

    -- STEP 5: FETCH DIRECTLY FROM PUBLIC.BOOKINGS FIRST (Without preliminary filters)
    SELECT * INTO v_booking
    FROM public.bookings
    WHERE qr_token = v_clean_token
       OR id::text = v_clean_token
       OR UPPER(booking_code) = UPPER(v_clean_token)
    LIMIT 1;

    IF v_booking.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'BOOKING_NOT_FOUND',
            'message', 'No booking matches this QR token.'
        );
    END IF;

    -- LOCK BOOKING ROW FOR UPDATE
    SELECT b.* INTO v_booking
    FROM public.bookings b
    WHERE b.id = v_booking.id
    FOR UPDATE OF b;

    SELECT * INTO v_student FROM public.profiles WHERE id = v_booking.student_id;
    SELECT * INTO v_seat FROM public.seats WHERE id = v_booking.seat_id;
    SELECT * INTO v_slot FROM public.slots WHERE id = v_booking.slot_id;
    SELECT * INTO v_room FROM public.rooms WHERE id = v_booking.room_id;
    SELECT * INTO v_floor FROM public.floors WHERE id = v_booking.floor_id;
    SELECT * INTO v_library FROM public.libraries WHERE id = v_booking.library_id;

    -- VALIDATIONS & PRECISE ERROR CODES
    IF COALESCE(v_student.status, 'active') IN ('blocked', 'suspended') THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'STUDENT_BLOCKED',
            'message', 'Student account is suspended or blocked.'
        );
    END IF;

    IF v_booking.status::text = 'checked_in' THEN
        RETURN jsonb_build_object(
            'success', true,
            'already_checked_in', true,
            'status_code', 'ALREADY_CHECKED_IN',
            'message', 'Student is already checked in.',
            'booking', jsonb_build_object(
                'id', v_booking.id,
                'booking_code', v_booking.booking_code,
                'student_name', COALESCE(v_student.full_name, 'Student'),
                'seat_number', COALESCE(v_seat.seat_number, 'S-01'),
                'checked_in_at', v_booking.checked_in_at
            )
        );
    END IF;

    IF v_booking.status::text IN ('checked_out', 'completed') THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'ALREADY_CHECKED_OUT',
            'message', 'Student has already checked out.'
        );
    END IF;

    IF v_booking.status::text = 'cancelled' THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'BOOKING_CANCELLED',
            'message', 'This booking was cancelled.'
        );
    END IF;

    IF v_booking.booking_date != v_kolkata_today THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'WRONG_DATE',
            'message', 'This pass is valid on ' || TO_CHAR(v_booking.booking_date, 'DD-MM-YYYY') || '.'
        );
    END IF;

    v_checkin_start := v_slot.start_time - INTERVAL '15 minutes';
    IF v_kolkata_now_time < v_checkin_start THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'TOO_EARLY',
            'message', 'Check-in opens at ' || TO_CHAR(v_checkin_start, 'HH12:MI AM') || '.'
        );
    ELSIF v_kolkata_now_time > v_slot.end_time THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'GRACE_PERIOD_EXPIRED',
            'message', 'The check-in window for this slot has expired.'
        );
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

    -- Insert Check-in Log
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
            scan_nonce,
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
            'qr',
            'qr',
            p_scan_nonce,
            'QR Pass Check-In Verified',
            NOW()
        );
    EXCEPTION WHEN OTHERS THEN NULL; END;

    -- Student Notification
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
        VALUES (v_staff_id, v_booking.id, 'BOOKING_CHECKIN_QR', jsonb_build_object('method', 'qr', 'nonce', p_scan_nonce), NOW());
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
            'seat_number', COALESCE(v_seat.seat_number, 'S-01'),
            'floor_name', COALESCE(v_floor.name, 'Ground Floor'),
            'room_name', COALESCE(v_room.name, 'Main Reading Hall'),
            'library_name', COALESCE(v_library.name, 'Central Library'),
            'slot_name', COALESCE(v_slot.name, 'Time Slot'),
            'slot_time', TO_CHAR(v_slot.start_time, 'HH12:MI AM') || ' – ' || TO_CHAR(v_slot.end_time, 'HH12:MI AM'),
            'booking_date', v_booking.booking_date,
            'status', 'checked_in',
            'checked_in_at', NOW()
        )
    );
END;
$$;


-- 3. Lookup Bookings for Manual Check-In RPC: lookup_booking_for_manual_checkin()
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
        RETURN jsonb_build_object('success', false, 'status_code', 'STAFF_NOT_AUTHORIZED', 'message', 'Staff authentication required.', 'matches', '[]'::jsonb);
    END IF;

    IF v_clean = '' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Please enter a booking code, registration number, or email.', 'matches', '[]'::jsonb);
    END IF;

    SELECT jsonb_agg(
        jsonb_build_object(
            'booking_id', b.id,
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
            'start_time', TO_CHAR(sl.start_time, 'HH12:MI AM'),
            'end_time', TO_CHAR(sl.end_time, 'HH12:MI AM'),
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
            'status_code', 'BOOKING_NOT_FOUND',
            'message', 'No booking record found matching identifier: ' || v_clean,
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


-- 4. Manual Check-In Action RPC: check_in_booking_manually()
DROP FUNCTION IF EXISTS public.check_in_booking_manually CASCADE;

CREATE OR REPLACE FUNCTION public.check_in_booking_manually(
    p_booking_id UUID,
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
        RETURN jsonb_build_object('success', false, 'status_code', 'STAFF_NOT_AUTHORIZED', 'message', 'Staff sign-in required.');
    END IF;

    SELECT id, full_name, role, status INTO v_staff_profile FROM public.profiles WHERE id = v_staff_id;
    IF v_staff_profile.id IS NULL OR LOWER(v_staff_profile.role::text) NOT IN ('librarian', 'senior_librarian', 'staff', 'admin', 'super_admin') THEN
        RETURN jsonb_build_object('success', false, 'status_code', 'STAFF_NOT_AUTHORIZED', 'message', 'Access denied. Staff role required.');
    END IF;

    -- LOCK BOOKING ROW FOR UPDATE
    SELECT b.* INTO v_booking
    FROM public.bookings b
    WHERE b.id = p_booking_id
    FOR UPDATE OF b;

    IF v_booking.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'status_code', 'BOOKING_NOT_FOUND', 'message', 'Booking record not found.');
    END IF;

    SELECT * INTO v_student FROM public.profiles WHERE id = v_booking.student_id;
    SELECT * INTO v_seat FROM public.seats WHERE id = v_booking.seat_id;
    SELECT * INTO v_slot FROM public.slots WHERE id = v_booking.slot_id;
    SELECT * INTO v_room FROM public.rooms WHERE id = v_booking.room_id;
    SELECT * INTO v_floor FROM public.floors WHERE id = v_booking.floor_id;
    SELECT * INTO v_library FROM public.libraries WHERE id = v_booking.library_id;

    IF COALESCE(v_student.status, 'active') IN ('blocked', 'suspended') THEN
        RETURN jsonb_build_object('success', false, 'status_code', 'STUDENT_BLOCKED', 'message', 'Student account is suspended or blocked.');
    END IF;

    IF v_booking.status::text = 'checked_in' THEN
        RETURN jsonb_build_object(
            'success', true,
            'already_checked_in', true,
            'status_code', 'ALREADY_CHECKED_IN',
            'message', 'Student is already checked in.',
            'booking', jsonb_build_object(
                'id', v_booking.id,
                'booking_code', v_booking.booking_code,
                'student_name', COALESCE(v_student.full_name, 'Student'),
                'checked_in_at', v_booking.checked_in_at
            )
        );
    END IF;

    IF v_booking.status::text IN ('checked_out', 'completed') THEN
        RETURN jsonb_build_object('success', false, 'status_code', 'ALREADY_CHECKED_OUT', 'message', 'Student has already checked out.');
    END IF;

    IF v_booking.status::text = 'cancelled' THEN
        RETURN jsonb_build_object('success', false, 'status_code', 'BOOKING_CANCELLED', 'message', 'This booking was cancelled.');
    END IF;

    -- Time/Date Window check & Override logic
    IF v_booking.booking_date != v_kolkata_today THEN
        IF v_override_text != '' THEN
            v_is_override := TRUE;
        ELSE
            RETURN jsonb_build_object('success', false, 'status_code', 'WRONG_DATE', 'message', 'This pass is valid on ' || TO_CHAR(v_booking.booking_date, 'DD-MM-YYYY') || '. Override reason required.');
        END IF;
    END IF;

    v_checkin_start := v_slot.start_time - INTERVAL '15 minutes';
    IF v_kolkata_now_time < v_checkin_start THEN
        IF v_override_text != '' THEN
            v_is_override := TRUE;
        ELSE
            RETURN jsonb_build_object('success', false, 'status_code', 'TOO_EARLY', 'message', 'Check-in opens at ' || TO_CHAR(v_checkin_start, 'HH12:MI AM') || '. Override reason required.');
        END IF;
    ELSIF v_kolkata_now_time > v_slot.end_time THEN
        IF v_override_text != '' THEN
            v_is_override := TRUE;
        ELSE
            RETURN jsonb_build_object('success', false, 'status_code', 'GRACE_PERIOD_EXPIRED', 'message', 'The check-in window for this slot has expired. Override reason required.');
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
            check_in_method,
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
            'manual',
            'manual',
            CASE WHEN v_is_override THEN 'Manual Override Check-In: ' || v_override_text ELSE 'Manual Desk Check-In Verified' END,
            v_is_override,
            v_override_text,
            NOW()
        );
    EXCEPTION WHEN OTHERS THEN NULL; END;

    -- Student Notification
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
        VALUES (v_staff_id, v_booking.id, 'BOOKING_CHECKIN_MANUAL', jsonb_build_object('method', 'manual', 'override', v_is_override, 'reason', v_override_text), NOW());
    EXCEPTION WHEN OTHERS THEN NULL; END;

    RETURN jsonb_build_object(
        'success', true,
        'status_code', 'SUCCESS',
        'message', 'Manual Check-in Successful',
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
            'checked_in_at', NOW()
        )
    );
END;
$$;


-- 5. Atomic Checkout RPC: check_out_booking(p_booking_id, p_method)
DROP FUNCTION IF EXISTS public.check_out_booking CASCADE;

CREATE OR REPLACE FUNCTION public.check_out_booking(
    p_booking_id UUID,
    p_method TEXT DEFAULT 'manual'
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
        RETURN jsonb_build_object('success', false, 'status_code', 'STAFF_NOT_AUTHORIZED', 'message', 'Staff authentication required.');
    END IF;

    SELECT id, full_name, role, status INTO v_staff_profile FROM public.profiles WHERE id = v_staff_id;
    IF v_staff_profile.id IS NULL OR LOWER(v_staff_profile.role::text) NOT IN ('librarian', 'senior_librarian', 'staff', 'admin', 'super_admin') THEN
        RETURN jsonb_build_object('success', false, 'status_code', 'STAFF_NOT_AUTHORIZED', 'message', 'Access denied.');
    END IF;

    -- LOCK BOOKING ROW FOR UPDATE
    SELECT b.* INTO v_booking
    FROM public.bookings b
    WHERE b.id = p_booking_id
    FOR UPDATE OF b;

    IF v_booking.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'status_code', 'BOOKING_NOT_FOUND', 'message', 'Booking record not found.');
    END IF;

    IF v_booking.status::text IN ('checked_out', 'completed') THEN
        RETURN jsonb_build_object('success', false, 'status_code', 'ALREADY_CHECKED_OUT', 'message', 'This booking has already been checked out.');
    END IF;

    IF v_booking.status::text != 'checked_in' THEN
        RETURN jsonb_build_object('success', false, 'status_code', 'NOT_CHECKED_IN', 'message', 'Student is not currently checked in.');
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

    -- Insert Checkout Log
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
            checkout_method,
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
            COALESCE(p_method, 'manual'),
            'Seat Released & Checkout Completed',
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
        'status_code', 'SUCCESS',
        'message', 'Checkout Completed Successfully',
        'booking', jsonb_build_object(
            'id', v_booking.id,
            'booking_code', v_booking.booking_code,
            'student_name', COALESCE(v_student.full_name, 'Student'),
            'seat_number', COALESCE(v_seat.seat_number, 'S-01'),
            'checked_out_at', NOW()
        )
    );
END;
$$;


-- 6. Current Occupants RPC: get_current_occupants()
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
    check_in_method TEXT,
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
        COALESCE(l_log.log_method, 'qr') AS check_in_method,
        b.checked_in_at,
        ROUND(EXTRACT(EPOCH FROM (NOW() - b.checked_in_at)) / 60)::INTEGER AS time_occupied_minutes
    FROM public.bookings b
    JOIN public.profiles p ON p.id = b.student_id
    JOIN public.seats s ON s.id = b.seat_id
    JOIN public.slots sl ON sl.id = b.slot_id
    LEFT JOIN public.rooms r ON r.id = b.room_id
    LEFT JOIN public.floors fl ON fl.id = b.floor_id
    LEFT JOIN LATERAL (
        SELECT l.check_in_method AS log_method FROM public.check_in_logs l
        WHERE l.booking_id = b.id AND l.action = 'check_in' 
        ORDER BY l.created_at DESC LIMIT 1
    ) l_log ON TRUE
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


-- 7. SECURITY GRANTS
GRANT EXECUTE ON FUNCTION public.check_in_booking_by_qr(TEXT, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.lookup_booking_for_manual_checkin(TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.check_in_booking_manually(UUID, TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.check_out_booking(UUID, TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_current_occupants(UUID, UUID, UUID, UUID, DATE) TO authenticated, anon;
