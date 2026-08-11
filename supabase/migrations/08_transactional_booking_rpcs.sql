-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 08: TRANSACTIONAL BOOKING RPC FUNCTIONS
-- ====================================================================

-- 1. CREATE BOOKING RPC FUNCTION
CREATE OR REPLACE FUNCTION public.create_booking(
    p_library_id UUID,
    p_floor_id UUID,
    p_room_id UUID,
    p_seat_id UUID,
    p_slot_id UUID,
    p_booking_date DATE,
    p_booking_source TEXT DEFAULT 'online'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_student_id UUID := auth.uid();
    v_user_status account_status;
    v_room_status room_status;
    v_seat_status seat_status;
    v_slot_status slot_status;
    v_seat_number TEXT;
    v_slot_name TEXT;
    v_new_booking_id UUID;
    v_booking_code TEXT;
    v_qr_token TEXT;
    v_existing_seat_booking UUID;
    v_existing_student_booking UUID;
BEGIN
    -- A. Verify authentication & student account status
    IF v_student_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required to make a booking.';
    END IF;

    SELECT status INTO v_user_status FROM public.profiles WHERE id = v_student_id;
    IF v_user_status IS NULL OR v_user_status != 'active' THEN
        RAISE EXCEPTION 'Your account status (%) prevents booking seats.', COALESCE(v_user_status::text, 'blocked');
    END IF;

    -- B. Verify Room Status
    SELECT status INTO v_room_status FROM public.rooms WHERE id = p_room_id;
    IF v_room_status IS NULL OR v_room_status != 'active' THEN
        RAISE EXCEPTION 'The selected reading room is currently closed or inactive.';
    END IF;

    -- C. Verify Seat Status & Lock Row
    SELECT status, seat_number INTO v_seat_status, v_seat_number 
    FROM public.seats 
    WHERE id = p_seat_id FOR UPDATE;
    
    IF v_seat_status IS NULL OR v_seat_status = 'maintenance' OR v_seat_status = 'disabled' THEN
        RAISE EXCEPTION 'Seat % is currently under maintenance or disabled.', COALESCE(v_seat_number, 'selected');
    END IF;

    -- D. Verify Slot Status
    SELECT status, name INTO v_slot_status, v_slot_name 
    FROM public.slots 
    WHERE id = p_slot_id;
    
    IF v_slot_status IS NULL OR v_slot_status != 'active' THEN
        RAISE EXCEPTION 'The selected time slot (%) is cancelled or disabled.', COALESCE(v_slot_name, 'slot');
    END IF;

    -- E. Lock & Check for conflicting seat bookings
    SELECT id INTO v_existing_seat_booking
    FROM public.bookings
    WHERE seat_id = p_seat_id
      AND booking_date = p_booking_date
      AND slot_id = p_slot_id
      AND status IN ('confirmed', 'awaiting_check_in', 'checked_in')
    FOR UPDATE;

    IF v_existing_seat_booking IS NOT NULL THEN
        RAISE EXCEPTION 'Seat % is already booked for % during %.', v_seat_number, p_booking_date, v_slot_name;
    END IF;

    -- F. Check for student double booking during same date & slot
    SELECT id INTO v_existing_student_booking
    FROM public.bookings
    WHERE student_id = v_student_id
      AND booking_date = p_booking_date
      AND slot_id = p_slot_id
      AND status IN ('confirmed', 'awaiting_check_in', 'checked_in');

    IF v_existing_student_booking IS NOT NULL THEN
        RAISE EXCEPTION 'You already hold an active reservation for this time slot (%).', v_slot_name;
    END IF;

    -- G. Generate Booking Code & QR Token
    v_booking_code := 'BK-' || UPPER(SUBSTRING(gen_random_uuid()::text FROM 1 FOR 8));
    v_qr_token := 'SS-' || UPPER(SUBSTRING(gen_random_uuid()::text FROM 1 FOR 12));

    -- H. Insert Booking Record
    INSERT INTO public.bookings (
        booking_code,
        student_id,
        library_id,
        floor_id,
        room_id,
        seat_id,
        slot_id,
        booking_date,
        status,
        booking_source,
        qr_token,
        created_at,
        updated_at
    )
    VALUES (
        v_booking_code,
        v_student_id,
        p_library_id,
        p_floor_id,
        p_room_id,
        p_seat_id,
        p_slot_id,
        p_booking_date,
        'confirmed',
        p_booking_source,
        v_qr_token,
        NOW(),
        NOW()
    )
    RETURNING id INTO v_new_booking_id;

    -- I. Insert Student Notification
    INSERT INTO public.notifications (
        recipient_id,
        type,
        title,
        message,
        priority,
        related_entity_type,
        related_entity_id
    )
    VALUES (
        v_student_id,
        'BOOKING_CONFIRMED',
        'Reservation Confirmed — Seat ' || v_seat_number,
        'Your reservation for Seat ' || v_seat_number || ' on ' || p_booking_date || ' (' || v_slot_name || ') is confirmed.',
        'NORMAL',
        'booking',
        v_new_booking_id
    );

    -- J. Log Activity
    INSERT INTO public.activity_logs (
        actor_id,
        actor_role,
        action,
        entity_type,
        entity_id,
        description
    )
    VALUES (
        v_student_id,
        'student',
        'CREATE_BOOKING',
        'booking',
        v_new_booking_id,
        'Student created booking ' || v_booking_code || ' for Seat ' || v_seat_number
    );

    RETURN jsonb_build_object(
        'success', true,
        'booking_id', v_new_booking_id,
        'booking_code', v_booking_code,
        'seat_number', v_seat_number,
        'slot_name', v_slot_name,
        'booking_date', p_booking_date,
        'qr_token', v_qr_token
    );
END;
$$;


-- 2. CANCEL BOOKING RPC FUNCTION
CREATE OR REPLACE FUNCTION public.cancel_booking(
    p_booking_id UUID,
    p_reason TEXT DEFAULT 'Cancelled by user'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_booking RECORD;
    v_seat_number TEXT;
    v_is_staff BOOLEAN;
BEGIN
    SELECT b.*, s.seat_number INTO v_booking
    FROM public.bookings b
    JOIN public.seats s ON s.id = b.seat_id
    WHERE b.id = p_booking_id FOR UPDATE;

    IF v_booking IS NULL THEN
        RAISE EXCEPTION 'Booking not found.';
    END IF;

    v_is_staff := public.is_librarian_or_admin();

    IF v_booking.student_id != v_actor_id AND NOT v_is_staff THEN
        RAISE EXCEPTION 'You are not authorized to cancel this booking.';
    END IF;

    IF v_booking.status IN ('cancelled', 'completed', 'slot_cancelled', 'expired') THEN
        RAISE EXCEPTION 'Booking is already %.', v_booking.status;
    END IF;

    -- Update booking
    UPDATE public.bookings
    SET status = 'cancelled',
        cancelled_at = NOW(),
        cancelled_by = v_actor_id,
        cancellation_reason = p_reason,
        updated_at = NOW()
    WHERE id = p_booking_id;

    -- Send notification to student
    INSERT INTO public.notifications (
        recipient_id,
        type,
        title,
        message,
        priority,
        related_entity_type,
        related_entity_id
    )
    VALUES (
        v_booking.student_id,
        'BOOKING_CANCELLED',
        'Reservation Cancelled — Seat ' || v_booking.seat_number,
        'Your booking ' || v_booking.booking_code || ' for Seat ' || v_booking.seat_number || ' has been cancelled. Reason: ' || p_reason,
        'HIGH',
        'booking',
        p_booking_id
    );

    -- Log Activity
    INSERT INTO public.activity_logs (
        actor_id,
        actor_role,
        action,
        entity_type,
        entity_id,
        description
    )
    VALUES (
        v_actor_id,
        CASE WHEN v_is_staff THEN 'staff' ELSE 'student' END,
        'CANCEL_BOOKING',
        'booking',
        p_booking_id,
        'Booking ' || v_booking.booking_code || ' cancelled. Reason: ' || p_reason
    );

    -- Trigger waitlist auto-allocation for released slot
    PERFORM public.allocate_next_waitlisted_student(v_booking.room_id, v_booking.slot_id, v_booking.booking_date);

    RETURN jsonb_build_object(
        'success', true,
        'booking_id', p_booking_id,
        'status', 'cancelled'
    );
END;
$$;
