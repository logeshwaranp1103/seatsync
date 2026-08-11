-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 10: CHECK-IN & CHECK-OUT RPC FUNCTIONS
-- ====================================================================

-- 1. CHECK-IN BOOKING RPC FUNCTION
CREATE OR REPLACE FUNCTION public.check_in_booking(
    p_identifier TEXT,
    p_method TEXT DEFAULT 'qr'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_staff_id UUID := auth.uid();
    v_booking RECORD;
BEGIN
    IF NOT public.is_librarian_or_admin() THEN
        RAISE EXCEPTION 'Only authorized library staff can process desk check-ins.';
    END IF;

    -- Lookup booking by code, QR token, or student registration number
    SELECT b.*, s.seat_number, p.full_name AS student_name, p.status AS user_status
    INTO v_booking
    FROM public.bookings b
    JOIN public.seats s ON s.id = b.seat_id
    JOIN public.profiles p ON p.id = b.student_id
    WHERE (
        b.booking_code = UPPER(p_identifier) OR
        b.qr_token = p_identifier OR
        b.id::text = p_identifier OR
        p.registration_number = p_identifier
    )
    AND b.status IN ('confirmed', 'awaiting_check_in')
    ORDER BY b.created_at DESC
    LIMIT 1
    FOR UPDATE OF b;

    IF v_booking IS NULL THEN
        RAISE EXCEPTION 'No active pending reservation found for identifier "%".', p_identifier;
    END IF;

    IF v_booking.user_status != 'active' THEN
        RAISE EXCEPTION 'Student account is blocked or suspended.';
    END IF;

    -- Update booking status to checked_in
    UPDATE public.bookings
    SET status = 'checked_in',
        checked_in_at = NOW(),
        checked_in_by = v_staff_id,
        updated_at = NOW()
    WHERE id = v_booking.id;

    -- Insert Check-in Log
    INSERT INTO public.check_in_logs (
        booking_id,
        student_id,
        librarian_id,
        action,
        method,
        notes
    )
    VALUES (
        v_booking.id,
        v_booking.student_id,
        v_staff_id,
        'check_in',
        p_method,
        'Desk verified by staff'
    );

    -- Notify Student
    INSERT INTO public.notifications (
        recipient_id,
        type,
        title,
        message,
        priority
    )
    VALUES (
        v_booking.student_id,
        'CHECK_IN_SUCCESS',
        'Check-In Verified — Seat ' || v_booking.seat_number,
        'Welcome! Desk check-in verified at ' || TO_CHAR(NOW(), 'HH:MI AM') || '.',
        'NORMAL'
    );

    -- Audit Log
    INSERT INTO public.activity_logs (
        actor_id,
        actor_role,
        action,
        entity_type,
        entity_id,
        description
    )
    VALUES (
        v_staff_id,
        'staff',
        'CHECK_IN',
        'booking',
        v_booking.id,
        'Checked in student ' || v_booking.student_name || ' for Seat ' || v_booking.seat_number
    );

    RETURN jsonb_build_object(
        'success', true,
        'booking_id', v_booking.id,
        'booking_code', v_booking.booking_code,
        'seat_number', v_booking.seat_number,
        'student_name', v_booking.student_name,
        'checked_in_at', NOW()
    );
END;
$$;


-- 2. CHECK-OUT BOOKING RPC FUNCTION
CREATE OR REPLACE FUNCTION public.check_out_booking(
    p_booking_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_staff_id UUID := auth.uid();
    v_booking RECORD;
BEGIN
    IF NOT public.is_librarian_or_admin() THEN
        RAISE EXCEPTION 'Only authorized staff can process check-outs.';
    END IF;

    SELECT b.*, s.seat_number, p.full_name AS student_name
    INTO v_booking
    FROM public.bookings b
    JOIN public.seats s ON s.id = b.seat_id
    JOIN public.profiles p ON p.id = b.student_id
    WHERE b.id = p_booking_id FOR UPDATE OF b;

    IF v_booking IS NULL THEN
        RAISE EXCEPTION 'Booking not found.';
    END IF;

    IF v_booking.status != 'checked_in' THEN
        RAISE EXCEPTION 'Booking must be in checked_in status to checkout.';
    END IF;

    UPDATE public.bookings
    SET status = 'completed',
        checked_out_at = NOW(),
        checked_out_by = v_staff_id,
        updated_at = NOW()
    WHERE id = p_booking_id;

    INSERT INTO public.check_in_logs (
        booking_id,
        student_id,
        librarian_id,
        action,
        method,
        notes
    )
    VALUES (
        p_booking_id,
        v_booking.student_id,
        v_staff_id,
        'check_out',
        'manual',
        'Desk released upon checkout'
    );

    -- Auto-allocate next waitlist student for released desk space
    PERFORM public.allocate_next_waitlisted_student(v_booking.room_id, v_booking.slot_id, v_booking.booking_date);

    RETURN jsonb_build_object(
        'success', true,
        'booking_id', p_booking_id,
        'status', 'completed'
    );
END;
$$;
