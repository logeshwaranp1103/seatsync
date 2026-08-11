-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 09: WAITLIST & AUTO-ALLOCATION RPC FUNCTIONS
-- ====================================================================

-- 1. JOIN WAITLIST RPC FUNCTION
CREATE OR REPLACE FUNCTION public.join_waitlist(
    p_library_id UUID,
    p_room_id UUID,
    p_slot_id UUID,
    p_booking_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_student_id UUID := auth.uid();
    v_user_status account_status;
    v_slot_status slot_status;
    v_room_status room_status;
    v_existing_waitlist UUID;
    v_queue_pos INTEGER;
    v_new_waitlist_id UUID;
BEGIN
    IF v_student_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required to join waiting list.';
    END IF;

    SELECT status INTO v_user_status FROM public.profiles WHERE id = v_student_id;
    IF v_user_status IS NULL OR v_user_status != 'active' THEN
        RAISE EXCEPTION 'Your account status prevents joining waitlists.';
    END IF;

    SELECT status INTO v_room_status FROM public.rooms WHERE id = p_room_id;
    IF v_room_status IS NULL OR v_room_status != 'active' THEN
        RAISE EXCEPTION 'This reading room is closed.';
    END IF;

    SELECT status INTO v_slot_status FROM public.slots WHERE id = p_slot_id;
    IF v_slot_status IS NULL OR v_slot_status != 'active' THEN
        RAISE EXCEPTION 'This time slot is disabled or cancelled.';
    END IF;

    -- Check if student already in waitlist
    SELECT id INTO v_existing_waitlist
    FROM public.waitlist_entries
    WHERE student_id = v_student_id
      AND room_id = p_room_id
      AND slot_id = p_slot_id
      AND booking_date = p_booking_date
      AND status = 'waiting';

    IF v_existing_waitlist IS NOT NULL THEN
        RAISE EXCEPTION 'You are already in the waiting list queue for this room and slot.';
    END IF;

    -- Calculate next queue position
    SELECT COALESCE(MAX(queue_position), 0) + 1 INTO v_queue_pos
    FROM public.waitlist_entries
    WHERE room_id = p_room_id
      AND slot_id = p_slot_id
      AND booking_date = p_booking_date
      AND status = 'waiting';

    INSERT INTO public.waitlist_entries (
        student_id,
        library_id,
        room_id,
        slot_id,
        booking_date,
        status,
        queue_position,
        expires_at,
        created_at,
        updated_at
    )
    VALUES (
        v_student_id,
        p_library_id,
        p_room_id,
        p_slot_id,
        p_booking_date,
        'waiting',
        v_queue_pos,
        (p_booking_date::text || ' 23:59:59')::timestamptz,
        NOW(),
        NOW()
    )
    RETURNING id INTO v_new_waitlist_id;

    -- Notification
    INSERT INTO public.notifications (
        recipient_id,
        type,
        title,
        message,
        priority
    )
    VALUES (
        v_student_id,
        'WAITLIST_JOINED',
        'Added to Waiting List Queue (Position #' || v_queue_pos || ')',
        'You have joined the queue for ' || p_booking_date || '. You will be auto-allocated a seat if a cancellation occurs.',
        'NORMAL'
    );

    RETURN jsonb_build_object(
        'success', true,
        'waitlist_id', v_new_waitlist_id,
        'queue_position', v_queue_pos
    );
END;
$$;


-- 2. AUTO-ALLOCATE NEXT WAITLISTED STUDENT RPC FUNCTION
CREATE OR REPLACE FUNCTION public.allocate_next_waitlisted_student(
    p_room_id UUID,
    p_slot_id UUID,
    p_booking_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_wait_entry RECORD;
    v_available_seat RECORD;
    v_booking_res JSONB;
    v_allocated_count INTEGER := 0;
BEGIN
    -- Loop through oldest waiting entries for room/slot/date
    FOR v_wait_entry IN
        SELECT w.*, p.status AS user_status
        FROM public.waitlist_entries w
        JOIN public.profiles p ON p.id = w.student_id
        WHERE w.room_id = p_room_id
          AND w.slot_id = p_slot_id
          AND w.booking_date = p_booking_date
          AND w.status = 'waiting'
          AND p.status = 'active'
        ORDER BY w.created_at ASC
        FOR UPDATE OF w
    LOOP
        -- Find an unreserved, available seat in room
        SELECT s.id, s.seat_number INTO v_available_seat
        FROM public.seats s
        WHERE s.room_id = p_room_id
          AND s.status = 'available'
          AND NOT EXISTS (
              SELECT 1 FROM public.bookings b
              WHERE b.seat_id = s.id
                AND b.booking_date = p_booking_date
                AND b.slot_id = p_slot_id
                AND b.status IN ('confirmed', 'awaiting_check_in', 'checked_in')
          )
        ORDER BY s.seat_number ASC
        LIMIT 1;

        EXIT WHEN v_available_seat IS NULL;

        -- Create booking for candidate
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
            qr_token
        )
        SELECT
            'BK-' || UPPER(SUBSTRING(gen_random_uuid()::text FROM 1 FOR 8)),
            v_wait_entry.student_id,
            v_wait_entry.library_id,
            r.floor_id,
            p_room_id,
            v_available_seat.id,
            p_slot_id,
            p_booking_date,
            'confirmed',
            'waitlist_auto_allocation',
            'SS-' || UPPER(SUBSTRING(gen_random_uuid()::text FROM 1 FOR 12))
        FROM public.rooms r WHERE r.id = p_room_id
        RETURNING id INTO v_booking_res;

        -- Update waitlist entry
        UPDATE public.waitlist_entries
        SET status = 'allocated',
            allocated_booking_id = (v_booking_res->>'id')::UUID,
            updated_at = NOW()
        WHERE id = v_wait_entry.id;

        -- Notify student
        INSERT INTO public.notifications (
            recipient_id,
            type,
            title,
            message,
            priority
        )
        VALUES (
            v_wait_entry.student_id,
            'WAITLIST_ALLOCATED',
            'Waitlist Seat Allocated! Seat ' || v_available_seat.seat_number,
            'A seat became available and has been auto-allocated to you for ' || p_booking_date || '.',
            'HIGH'
        );

        v_allocated_count := v_allocated_count + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'allocated_count', v_allocated_count
    );
END;
$$;
