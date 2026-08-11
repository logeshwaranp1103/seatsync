-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 22: LIBRARIAN OPERATIONAL REPAIR & QR STATE MACHINE
-- ====================================================================

-- 1. LIBRARIAN OPERATIONAL SLOT SNAPSHOT RPC
CREATE OR REPLACE FUNCTION public.get_librarian_slot_snapshot(
    p_library_id UUID DEFAULT NULL,
    p_room_id UUID DEFAULT NULL,
    p_booking_date DATE DEFAULT NULL,
    p_slot_id UUID DEFAULT NULL
)
RETURNS TABLE (
    seat_id UUID,
    seat_number TEXT,
    allocation_mode TEXT,
    physical_status TEXT,
    power_outlet BOOLEAN,
    near_window BOOLEAN,
    computed_state TEXT,
    booking_id UUID,
    booking_code TEXT,
    booking_status TEXT,
    booking_source TEXT,
    student_id UUID,
    student_name TEXT,
    student_registration_number TEXT,
    student_email TEXT,
    slot_id UUID,
    slot_name TEXT,
    start_time TIME,
    end_time TIME,
    booking_date DATE,
    created_at TIMESTAMPTZ,
    checked_in_at TIMESTAMPTZ,
    checked_out_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.id AS seat_id,
        s.seat_number,
        COALESCE(s.allocation_mode, 'online') AS allocation_mode,
        COALESCE(s.status, 'available') AS physical_status,
        COALESCE(s.has_power_socket, false) AS power_outlet,
        COALESCE(s.is_accessible, false) AS near_window,
        CASE 
            WHEN s.status = 'maintenance' THEN 'maintenance'
            WHEN b.status = 'checked_in' THEN 'occupied'
            WHEN w.id IS NOT NULL THEN 'held'
            WHEN b.status IN ('confirmed', 'awaiting_check_in') THEN 'reserved'
            ELSE 'available'
        END AS computed_state,
        b.id AS booking_id,
        b.booking_code,
        b.status AS booking_status,
        b.booking_source,
        b.student_id,
        COALESCE(p.full_name, 'Student') AS student_name,
        COALESCE(p.registration_number, '24AD042') AS student_registration_number,
        COALESCE(p.email, '') AS student_email,
        b.slot_id,
        COALESCE(sl.name, 'Slot') AS slot_name,
        sl.start_time,
        sl.end_time,
        b.booking_date,
        b.created_at,
        b.checked_in_at,
        b.checked_out_at
    FROM public.seats s
    LEFT JOIN public.bookings b ON b.seat_id = s.id 
        AND (p_booking_date IS NULL OR b.booking_date = p_booking_date)
        AND (p_slot_id IS NULL OR b.slot_id = p_slot_id)
        AND b.status IN ('confirmed', 'awaiting_check_in', 'checked_in')
    LEFT JOIN public.profiles p ON p.id = b.student_id
    LEFT JOIN public.slots sl ON sl.id = COALESCE(b.slot_id, p_slot_id)
    LEFT JOIN public.waitlist_entries w ON w.slot_id = p_slot_id 
        AND w.date_str = p_booking_date::text 
        AND w.status = 'waiting'
        AND w.id IS NULL -- Placeholder hold check
    WHERE (p_room_id IS NULL OR s.room_id = p_room_id)
    ORDER BY 
        CASE 
            WHEN s.seat_number ~ '^S-[0-9]+$' THEN CAST(SUBSTRING(s.seat_number FROM 3) AS INT)
            ELSE 999
        END,
        s.seat_number ASC;
END;
$$;


-- 2. READ-ONLY QR PASS VERIFICATION RPC (ZERO MUTATION)
CREATE OR REPLACE FUNCTION public.verify_qr_pass_token(
    p_token TEXT,
    p_library_id UUID DEFAULT NULL,
    p_operating_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clean_token TEXT;
    v_booking RECORD;
    v_slot RECORD;
    v_now_time TIME := CURRENT_TIME;
    v_checkin_window_start TIME;
    v_checkin_window_end TIME;
    v_status_code TEXT;
    v_message TEXT;
BEGIN
    v_clean_token := UPPER(TRIM(p_token));
    IF v_clean_token IS NULL OR v_clean_token = '' THEN
        RETURN jsonb_build_object(
            'valid', false,
            'status_code', 'INVALID_INPUT',
            'message', 'Please enter or scan a valid QR token or Booking Reference.'
        );
    END IF;

    -- Lookup booking by exact booking_code, qr_token, booking ID, or student registration_number
    SELECT b.*, s.seat_number, p.full_name AS student_name, p.registration_number AS student_reg, p.email AS student_email, p.status AS user_status, l.name AS library_name
    INTO v_booking
    FROM public.bookings b
    JOIN public.seats s ON s.id = b.seat_id
    JOIN public.profiles p ON p.id = b.student_id
    JOIN public.libraries l ON l.id = b.library_id
    WHERE (
        UPPER(b.booking_code) = v_clean_token OR
        b.qr_token = p_token OR
        b.id::text = p_token OR
        UPPER(p.registration_number) = v_clean_token
    )
    ORDER BY b.created_at DESC
    LIMIT 1;

    IF v_booking IS NULL THEN
        RETURN jsonb_build_object(
            'valid', false,
            'status_code', 'BOOKING_NOT_FOUND',
            'message', 'Booking record not found. Confirm the booking reference or ask the student to refresh their latest QR pass.'
        );
    END IF;

    -- Fetch slot times
    SELECT name, start_time, end_time INTO v_slot FROM public.slots WHERE id = v_booking.slot_id;

    -- Check 1: Already checked in
    IF v_booking.status = 'checked_in' THEN
        RETURN jsonb_build_object(
            'valid', true,
            'status_code', 'CHECKED_IN',
            'message', 'Student has already checked in for this session.',
            'booking', jsonb_build_object(
                'id', v_booking.id,
                'bookingCode', v_booking.booking_code,
                'seatNumber', v_booking.seat_number,
                'studentName', v_booking.student_name,
                'studentRegistrationNumber', v_booking.student_reg,
                'bookingDate', v_booking.booking_date,
                'status', v_booking.status,
                'checkedInAt', v_booking.checked_in_at
            )
        );
    END IF;

    -- Check 2: Cancelled or Expired
    IF v_booking.status IN ('cancelled', 'slot_cancelled', 'no_show', 'expired') THEN
        RETURN jsonb_build_object(
            'valid', false,
            'status_code', 'EXPIRED_OR_CANCELLED',
            'message', 'Reservation has been cancelled or has expired.',
            'booking', jsonb_build_object(
                'id', v_booking.id,
                'bookingCode', v_booking.booking_code,
                'seatNumber', v_booking.seat_number,
                'studentName', v_booking.student_name,
                'status', v_booking.status
            )
        );
    END IF;

    -- Check 3: Library mismatch
    IF p_library_id IS NOT NULL AND v_booking.library_id != p_library_id THEN
        RETURN jsonb_build_object(
            'valid', false,
            'status_code', 'WRONG_LIBRARY',
            'message', 'This reservation is for ' || v_booking.library_name || ', not your currently selected library desk.',
            'booking', jsonb_build_object(
                'id', v_booking.id,
                'bookingCode', v_booking.booking_code,
                'libraryName', v_booking.library_name
            )
        );
    END IF;

    -- Check 4: Date check (Tomorrow vs Today)
    IF v_booking.booking_date > p_operating_date THEN
        RETURN jsonb_build_object(
            'valid', false,
            'status_code', 'TOO_EARLY',
            'message', 'Valid reservation — check-in not open yet. Check-in opens 15 minutes before the slot on ' || v_booking.booking_date || '.',
            'booking', jsonb_build_object(
                'id', v_booking.id,
                'bookingCode', v_booking.booking_code,
                'seatNumber', v_booking.seat_number,
                'studentName', v_booking.student_name,
                'studentRegistrationNumber', v_booking.student_reg,
                'bookingDate', v_booking.booking_date,
                'slotName', v_slot.name,
                'slotTime', v_slot.start_time || ' – ' || v_slot.end_time,
                'status', 'confirmed'
            )
        );
    END IF;

    IF v_booking.booking_date < p_operating_date THEN
        RETURN jsonb_build_object(
            'valid', false,
            'status_code', 'EXPIRED',
            'message', 'Reservation date (' || v_booking.booking_date || ') has passed.',
            'booking', jsonb_build_object(
                'id', v_booking.id,
                'bookingCode', v_booking.booking_code,
                'status', 'expired'
            )
        );
    END IF;

    -- Check-in window (15 minutes before slot start)
    v_checkin_window_start := (v_slot.start_time - INTERVAL '15 minutes')::time;
    v_checkin_window_end := (v_slot.start_time + INTERVAL '30 minutes')::time;

    IF v_now_time < v_checkin_window_start THEN
        RETURN jsonb_build_object(
            'valid', false,
            'status_code', 'TOO_EARLY',
            'message', 'Valid reservation — check-in not open yet. Check-in opens 15 minutes before slot start time (' || v_slot.start_time || ').',
            'booking', jsonb_build_object(
                'id', v_booking.id,
                'bookingCode', v_booking.booking_code,
                'seatNumber', v_booking.seat_number,
                'studentName', v_booking.student_name,
                'studentRegistrationNumber', v_booking.student_reg,
                'bookingDate', v_booking.booking_date,
                'slotName', v_slot.name,
                'status', 'confirmed'
            )
        );
    END IF;

    -- Valid & Ready for Check-in!
    RETURN jsonb_build_object(
        'valid', true,
        'status_code', 'BOOKING_FOUND_READY',
        'message', 'Pass Validated • Ready for Check-In',
        'booking', jsonb_build_object(
            'id', v_booking.id,
            'bookingCode', v_booking.booking_code,
            'seatNumber', v_booking.seat_number,
            'studentName', v_booking.student_name,
            'studentRegistrationNumber', v_booking.student_reg,
            'bookingDate', v_booking.booking_date,
            'slotName', v_slot.name,
            'slotTime', v_slot.start_time || ' – ' || v_slot.end_time,
            'status', 'confirmed'
        )
    );
END;
$$;


-- 3. ATOMIC CHECK-IN RPC (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.confirm_booking_check_in(
    p_booking_id UUID,
    p_scan_nonce TEXT DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_staff_id UUID := auth.uid();
    v_booking RECORD;
    v_response JSONB;
BEGIN
    -- Idempotency check
    IF p_idempotency_key IS NOT NULL THEN
        SELECT response_payload INTO v_response
        FROM public.idempotency_keys
        WHERE idempotency_key = p_idempotency_key;

        IF v_response IS NOT NULL THEN
            RETURN v_response;
        END IF;
    END IF;

    -- Lock booking record
    SELECT b.*, s.seat_number, p.full_name AS student_name, p.registration_number AS student_reg
    INTO v_booking
    FROM public.bookings b
    JOIN public.seats s ON s.id = b.seat_id
    JOIN public.profiles p ON p.id = b.student_id
    WHERE b.id = p_booking_id
    FOR UPDATE OF b;

    IF v_booking IS NULL THEN
        RAISE EXCEPTION 'BOOKING_NOT_FOUND: Booking record not found.';
    END IF;

    IF v_booking.status = 'checked_in' THEN
        v_response := jsonb_build_object(
            'success', true,
            'message', 'Student has already checked in.',
            'booking_id', v_booking.id,
            'booking_code', v_booking.booking_code,
            'seat_number', v_booking.seat_number,
            'student_name', v_booking.student_name,
            'checked_in_at', v_booking.checked_in_at
        );
        RETURN v_response;
    END IF;

    IF v_booking.status IN ('cancelled', 'slot_cancelled', 'no_show', 'expired') THEN
        RAISE EXCEPTION 'INVALID_STATUS: Cannot check-in a cancelled or expired booking.';
    END IF;

    -- Commit check-in
    UPDATE public.bookings
    SET status = 'checked_in',
        checked_in_at = NOW(),
        checked_in_by = v_staff_id,
        updated_at = NOW()
    WHERE id = p_booking_id;

    -- Record check-in log
    INSERT INTO public.check_in_logs (
        booking_id,
        student_id,
        librarian_id,
        check_in_time,
        method,
        status
    ) VALUES (
        p_booking_id,
        v_booking.student_id,
        v_staff_id,
        NOW(),
        'qr',
        'success'
    );

    v_response := jsonb_build_object(
        'success', true,
        'message', 'Entry confirmed successfully.',
        'booking_id', v_booking.id,
        'booking_code', v_booking.booking_code,
        'seat_number', v_booking.seat_number,
        'student_name', v_booking.student_name,
        'checked_in_at', NOW()
    );

    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO public.idempotency_keys (idempotency_key, user_id, action, response_payload)
        VALUES (p_idempotency_key, v_staff_id, 'confirm_booking_check_in', v_response)
        ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    RETURN v_response;
END;
$$;
