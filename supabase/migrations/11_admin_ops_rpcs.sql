-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 11: ADMIN OPERATIONAL CONTROL RPC FUNCTIONS
-- ====================================================================

-- 1. SET USER ACCOUNT STATUS (BLOCK/SUSPEND/REINSTATE)
CREATE OR REPLACE FUNCTION public.set_user_account_status(
    p_user_id UUID,
    p_status account_status,
    p_reason TEXT DEFAULT NULL,
    p_cancel_future_bookings BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_admin_id UUID := auth.uid();
    v_target RECORD;
    v_cancelled_bookings INTEGER := 0;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Only administrators can change user account standing.';
    END IF;

    IF p_user_id = v_admin_id THEN
        RAISE EXCEPTION 'Administrators cannot alter their own account status.';
    END IF;

    SELECT * INTO v_target FROM public.profiles WHERE id = p_user_id FOR UPDATE;
    IF v_target IS NULL THEN
        RAISE EXCEPTION 'Target user profile not found.';
    END IF;

    -- Update Profile Status
    UPDATE public.profiles
    SET status = p_status,
        blocked_reason = CASE WHEN p_status = 'blocked' THEN p_reason ELSE blocked_reason END,
        blocked_at = CASE WHEN p_status = 'blocked' THEN NOW() ELSE blocked_at END,
        blocked_by = CASE WHEN p_status = 'blocked' THEN v_admin_id ELSE blocked_by END,
        no_show_count = CASE WHEN p_status = 'active' THEN 0 ELSE no_show_count END,
        updated_at = NOW()
    WHERE id = p_user_id;

    -- Optionally cancel active future reservations if blocked
    IF p_status IN ('blocked', 'suspended') AND p_cancel_future_bookings THEN
        WITH cancelled_rows AS (
            UPDATE public.bookings
            SET status = 'cancelled',
                cancelled_at = NOW(),
                cancelled_by = v_admin_id,
                cancellation_reason = 'Account status changed to ' || p_status::text || ': ' || COALESCE(p_reason, 'Admin action')
            WHERE student_id = p_user_id
              AND status IN ('confirmed', 'awaiting_check_in')
            RETURNING id
        )
        SELECT COUNT(*) INTO v_cancelled_bookings FROM cancelled_rows;

        -- Cancel waiting list entries
        UPDATE public.waitlist_entries
        SET status = 'cancelled',
            updated_at = NOW()
        WHERE student_id = p_user_id
          AND status = 'waiting';
    END IF;

    -- Send notification to user
    INSERT INTO public.notifications (
        recipient_id,
        type,
        title,
        message,
        priority
    )
    VALUES (
        p_user_id,
        'ACCOUNT_STATUS_CHANGED',
        'Account Status Updated: ' || UPPER(p_status::text),
        'Your library account status has been set to ' || UPPER(p_status::text) || '. ' || COALESCE('Reason: ' || p_reason, ''),
        'URGENT'
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
        v_admin_id,
        'admin',
        'SET_USER_STATUS',
        'profile',
        p_user_id,
        'Admin set status of ' || v_target.full_name || ' to ' || p_status::text
    );

    RETURN jsonb_build_object(
        'success', true,
        'user_id', p_user_id,
        'status', p_status,
        'cancelled_bookings', v_cancelled_bookings
    );
END;
$$;


-- 2. DISABLE SLOT (CANCEL SLOT & AFFECTED BOOKINGS)
CREATE OR REPLACE FUNCTION public.disable_slot(
    p_slot_id UUID,
    p_reason TEXT DEFAULT 'Slot disabled by library administrator'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_admin_id UUID := auth.uid();
    v_slot RECORD;
    v_affected_bookings INTEGER := 0;
    v_booking_record RECORD;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Only administrators can disable time slots.';
    END IF;

    SELECT * INTO v_slot FROM public.slots WHERE id = p_slot_id FOR UPDATE;
    IF v_slot IS NULL THEN
        RAISE EXCEPTION 'Slot not found.';
    END IF;

    -- Update slot status
    UPDATE public.slots
    SET status = 'disabled',
        cancellation_reason = p_reason,
        disabled_by = v_admin_id,
        disabled_at = NOW(),
        updated_at = NOW()
    WHERE id = p_slot_id;

    -- Cancel all active bookings for this slot
    FOR v_booking_record IN
        SELECT b.id, b.student_id, b.booking_code, s.seat_number
        FROM public.bookings b
        JOIN public.seats s ON s.id = b.seat_id
        WHERE b.slot_id = p_slot_id
          AND b.status IN ('confirmed', 'awaiting_check_in')
    LOOP
        UPDATE public.bookings
        SET status = 'slot_cancelled',
            cancelled_at = NOW(),
            cancelled_by = v_admin_id,
            cancellation_reason = p_reason,
            updated_at = NOW()
        WHERE id = v_booking_record.id;

        -- Notify affected students
        INSERT INTO public.notifications (
            recipient_id,
            type,
            title,
            message,
            priority
        )
        VALUES (
            v_booking_record.student_id,
            'SLOT_CANCELLED',
            'Time Slot Disabled — Booking ' || v_booking_record.booking_code,
            'Your booking for Seat ' || v_booking_record.seat_number || ' was cancelled because the time slot was disabled. Reason: ' || p_reason,
            'URGENT'
        );

        v_affected_bookings := v_affected_bookings + 1;
    END LOOP;

    -- Cancel waiting list entries
    UPDATE public.waitlist_entries
    SET status = 'cancelled', updated_at = NOW()
    WHERE slot_id = p_slot_id AND status = 'waiting';

    -- Audit Log
    INSERT INTO public.activity_logs (
        actor_id, actor_role, action, entity_type, entity_id, description
    )
    VALUES (
        v_admin_id, 'admin', 'DISABLE_SLOT', 'slot', p_slot_id, 'Disabled slot ' || v_slot.name || '. Reason: ' || p_reason
    );

    RETURN jsonb_build_object(
        'success', true,
        'slot_id', p_slot_id,
        'affected_bookings', v_affected_bookings
    );
END;
$$;


-- 3. SET ROOM STATUS (CLOSE/OPEN ROOM)
CREATE OR REPLACE FUNCTION public.set_room_status(
    p_room_id UUID,
    p_status room_status,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_admin_id UUID := auth.uid();
    v_room RECORD;
BEGIN
    IF NOT public.is_librarian_or_admin() THEN
        RAISE EXCEPTION 'Only staff or administrators can update room status.';
    END IF;

    SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
    IF v_room IS NULL THEN
        RAISE EXCEPTION 'Room not found.';
    END IF;

    UPDATE public.rooms
    SET status = p_status,
        closure_reason = CASE WHEN p_status = 'temporarily_closed' THEN p_reason ELSE closure_reason END,
        closed_at = CASE WHEN p_status = 'temporarily_closed' THEN NOW() ELSE closed_at END,
        closed_by = CASE WHEN p_status = 'temporarily_closed' THEN v_admin_id ELSE closed_by END,
        updated_at = NOW()
    WHERE id = p_room_id;

    RETURN jsonb_build_object(
        'success', true,
        'room_id', p_room_id,
        'status', p_status
    );
END;
$$;


-- 4. SET SEAT MAINTENANCE
CREATE OR REPLACE FUNCTION public.set_seat_maintenance(
    p_seat_id UUID,
    p_reason TEXT,
    p_category TEXT DEFAULT 'Broken Frame / Cushion',
    p_priority TEXT DEFAULT 'Medium'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_staff_id UUID := auth.uid();
    v_seat RECORD;
    v_ticket_id UUID;
BEGIN
    IF NOT public.is_librarian_or_admin() THEN
        RAISE EXCEPTION 'Only staff or administrators can mark seat maintenance.';
    END IF;

    SELECT * INTO v_seat FROM public.seats WHERE id = p_seat_id FOR UPDATE;
    IF v_seat IS NULL THEN
        RAISE EXCEPTION 'Seat not found.';
    END IF;

    -- Update seat status
    UPDATE public.seats
    SET status = 'maintenance',
        maintenance_reason = p_reason,
        updated_at = NOW()
    WHERE id = p_seat_id;

    -- Insert maintenance ticket
    INSERT INTO public.seat_maintenance (
        seat_id,
        category,
        reason,
        priority,
        status,
        created_by
    )
    VALUES (
        p_seat_id,
        p_category,
        p_reason,
        p_priority,
        'In progress',
        v_staff_id
    )
    RETURNING id INTO v_ticket_id;

    RETURN jsonb_build_object(
        'success', true,
        'seat_id', p_seat_id,
        'ticket_id', v_ticket_id,
        'status', 'maintenance'
    );
END;
$$;
