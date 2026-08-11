-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 18: STRICT FIFO WAITLIST ENGINE
-- ====================================================================

-- 1. Safely add waitlist_status enum values if missing
DO $$ BEGIN
    ALTER TYPE waitlist_status ADD VALUE IF NOT EXISTS 'offered';
    ALTER TYPE waitlist_status ADD VALUE IF NOT EXISTS 'accepted';
    ALTER TYPE waitlist_status ADD VALUE IF NOT EXISTS 'rejected';
    ALTER TYPE waitlist_status ADD VALUE IF NOT EXISTS 'ineligible';
    ALTER TYPE waitlist_status ADD VALUE IF NOT EXISTS 'cancelled_by_library';
EXCEPTION WHEN OTHERS THEN null;
END $$;

-- 2. Add offer tracking columns to waitlist_entries
ALTER TABLE public.waitlist_entries
    ADD COLUMN IF NOT EXISTS offered_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS offer_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS offered_seat_id UUID REFERENCES public.seats(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- 3. Partial Unique Index: Prevent duplicate active waitlist entries per student/room/slot/date
DROP INDEX IF EXISTS public.idx_unique_active_waitlist_entry;
CREATE UNIQUE INDEX idx_unique_active_waitlist_entry
ON public.waitlist_entries (student_id, room_id, slot_id, booking_date)
WHERE status IN ('waiting', 'allocated');

-- 4. Queue Ordering Index for fast FIFO query
CREATE INDEX IF NOT EXISTS idx_waitlist_fifo_queue
ON public.waitlist_entries (room_id, slot_id, booking_date, created_at, id);

-- ====================================================================
-- FUNCTION: CALCULATE DYNAMIC QUEUE POSITION FOR WAITLIST ENTRY
-- ====================================================================
DROP FUNCTION IF EXISTS public.get_student_waitlist_position(uuid);

CREATE OR REPLACE FUNCTION public.get_student_waitlist_position(p_waitlist_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_target RECORD;
    v_pos INTEGER := 0;
BEGIN
    SELECT room_id, slot_id, booking_date, created_at, id, status
    INTO v_target
    FROM public.waitlist_entries
    WHERE id = p_waitlist_id;

    IF v_target IS NULL THEN
        RETURN 0;
    END IF;

    IF v_target.status::text NOT IN ('waiting', 'offered', 'allocated') THEN
        RETURN 0;
    END IF;

    -- Count waiting/offered entries strictly ahead in queue order (created_at ASC, id ASC)
    SELECT COUNT(*) + 1 INTO v_pos
    FROM public.waitlist_entries
    WHERE room_id = v_target.room_id
      AND slot_id = v_target.slot_id
      AND booking_date = v_target.booking_date
      AND status::text IN ('waiting', 'offered', 'allocated')
      AND (created_at, id) < (v_target.created_at, v_target.id);

    RETURN COALESCE(v_pos, 1);
END;
$$;

-- ====================================================================
-- ENHANCED JOIN WAITLIST RPC FUNCTION
-- ====================================================================
DROP FUNCTION IF EXISTS public.join_waitlist(uuid, uuid, uuid, date, text);
DROP FUNCTION IF EXISTS public.join_waitlist(uuid, uuid, uuid, date);

CREATE OR REPLACE FUNCTION public.join_waitlist(
    p_library_id UUID,
    p_room_id UUID,
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
    v_user_status account_status;
    v_slot_status slot_status;
    v_room_status room_status;
    v_existing_waitlist UUID;
    v_existing_booking UUID;
    v_restriction_res JSONB;
    v_queue_pos INTEGER;
    v_new_waitlist_id UUID;
    v_idempotent_resp JSONB;
    v_result JSONB;
BEGIN
    -- A. Idempotency Check
    IF p_idempotency_key IS NOT NULL THEN
        SELECT response_payload INTO v_idempotent_resp
        FROM public.idempotency_keys
        WHERE idempotency_key = p_idempotency_key;

        IF v_idempotent_resp IS NOT NULL THEN
            RETURN v_idempotent_resp;
        END IF;
    END IF;

    -- B. Verify Authentication
    IF v_student_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required to join waiting list.';
    END IF;

    -- C. Verify Student Account Standing
    SELECT status INTO v_user_status FROM public.profiles WHERE id = v_student_id;
    IF v_user_status IS NULL OR v_user_status != 'active' THEN
        RAISE EXCEPTION 'Your account status prevents joining waitlists.';
    END IF;

    -- D. Check Active Restrictions
    v_restriction_res := public.check_user_restriction_status(v_student_id);
    IF (v_restriction_res->>'restricted')::boolean = true THEN
        RAISE EXCEPTION 'Cannot join waitlist: account restricted due to policy violation (%s)', v_restriction_res->>'reason';
    END IF;

    -- E. Verify Room & Slot Status
    SELECT status INTO v_room_status FROM public.rooms WHERE id = p_room_id;
    IF v_room_status IS NULL OR v_room_status != 'active' THEN
        RAISE EXCEPTION 'Reading room is closed or inactive.';
    END IF;

    SELECT status INTO v_slot_status FROM public.slots WHERE id = p_slot_id;
    IF v_slot_status IS NULL OR v_slot_status != 'active' THEN
        RAISE EXCEPTION 'Time slot is disabled or cancelled.';
    END IF;

    -- F. Verify Student Doesn't Already Hold Confirmed Booking for Same Slot
    SELECT id INTO v_existing_booking
    FROM public.bookings
    WHERE student_id = v_student_id
      AND room_id = p_room_id
      AND slot_id = p_slot_id
      AND booking_date = p_booking_date
      AND status::text IN ('confirmed', 'awaiting_check_in', 'checked_in');

    IF v_existing_booking IS NOT NULL THEN
        RAISE EXCEPTION 'You already have an active booking for this room and slot.';
    END IF;

    -- G. Verify No Active Duplicate Waitlist Entry
    SELECT id INTO v_existing_waitlist
    FROM public.waitlist_entries
    WHERE student_id = v_student_id
      AND room_id = p_room_id
      AND slot_id = p_slot_id
      AND booking_date = p_booking_date
      AND status::text IN ('waiting', 'offered', 'allocated');

    IF v_existing_waitlist IS NOT NULL THEN
        RAISE EXCEPTION 'You are already in the waiting list queue for this room and slot.';
    END IF;

    -- H. Insert Waitlist Entry
    INSERT INTO public.waitlist_entries (
        student_id,
        library_id,
        room_id,
        slot_id,
        booking_date,
        status,
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
        'waiting'::waitlist_status,
        (p_booking_date::text || ' 23:59:59')::timestamptz,
        NOW(),
        NOW()
    )
    RETURNING id INTO v_new_waitlist_id;

    -- I. Calculate Dynamic Queue Position
    v_queue_pos := public.get_student_waitlist_position(v_new_waitlist_id);

    -- J. Store Queue Position on Row for quick display
    UPDATE public.waitlist_entries
    SET queue_position = v_queue_pos
    WHERE id = v_new_waitlist_id;

    -- K. Notification & Outbox Event
    INSERT INTO public.notification_outbox (
        recipient_id,
        type,
        title,
        message,
        priority,
        payload
    )
    VALUES (
        v_student_id,
        'WAITLIST_JOINED',
        'Added to Waiting List Queue (Position #' || v_queue_pos || ')',
        'You have joined the queue for ' || p_booking_date || '. You will be notified if a seat is offered to you.',
        'NORMAL',
        jsonb_build_object('waitlist_id', v_new_waitlist_id, 'queue_position', v_queue_pos)
    );

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
        'You have joined the queue for ' || p_booking_date || '. You will be notified if a seat is offered to you.',
        'NORMAL'
    );

    v_result := jsonb_build_object(
        'success', true,
        'waitlist_id', v_new_waitlist_id,
        'queue_position', v_queue_pos,
        'status', 'waiting'
    );

    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO public.idempotency_keys (idempotency_key, user_id, action, response_payload)
        VALUES (p_idempotency_key, v_student_id, 'join_waitlist', v_result)
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN v_result;
END;
$$;

-- ====================================================================
-- PROMOTE NEXT WAITLISTED STUDENT RPC FUNCTION (STRICT FIFO & OFFER HOLD)
-- ====================================================================
DROP FUNCTION IF EXISTS public.promote_next_waitlisted_student(uuid, uuid, date, uuid);
DROP FUNCTION IF EXISTS public.promote_next_waitlisted_student(uuid, uuid, date);

CREATE OR REPLACE FUNCTION public.promote_next_waitlisted_student(
    p_room_id UUID,
    p_slot_id UUID,
    p_booking_date DATE,
    p_released_seat_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_wait_entry RECORD;
    v_target_seat RECORD;
    v_policy_expiry_mins INTEGER := 5;
    v_offer_expires_at TIMESTAMptz;
    v_hold_booking_id UUID;
    v_promoted_count INTEGER := 0;
    v_student_status account_status;
    v_restriction_res JSONB;
    v_existing_booking UUID;
BEGIN
    -- 1. Fetch Waitlist Offer Expiry duration from library policy (default: 5 mins)
    SELECT COALESCE(waitlist_expiration_minutes, 5) INTO v_policy_expiry_mins
    FROM public.booking_policies bp
    JOIN public.rooms r ON r.library_id = bp.library_id
    WHERE r.id = p_room_id
    LIMIT 1;

    IF v_policy_expiry_mins IS NULL OR v_policy_expiry_mins <= 0 THEN
        v_policy_expiry_mins := 5;
    END IF;

    -- 2. Find Available Seat in Room
    IF p_released_seat_id IS NOT NULL THEN
        SELECT id, seat_number INTO v_target_seat
        FROM public.seats
        WHERE id = p_released_seat_id
          AND status::text = 'available'
          AND NOT EXISTS (
              SELECT 1 FROM public.bookings b
              WHERE b.seat_id = p_released_seat_id
                AND b.booking_date = p_booking_date
                AND b.slot_id = p_slot_id
                AND b.status::text IN ('confirmed', 'awaiting_check_in', 'checked_in')
          )
        FOR UPDATE;
    ELSE
        SELECT s.id, s.seat_number INTO v_target_seat
        FROM public.seats s
        WHERE s.room_id = p_room_id
          AND s.status::text = 'available'
          AND NOT EXISTS (
              SELECT 1 FROM public.bookings b
              WHERE b.seat_id = s.id
                AND b.booking_date = p_booking_date
                AND b.slot_id = p_slot_id
                AND b.status::text IN ('confirmed', 'awaiting_check_in', 'checked_in')
          )
        ORDER BY s.seat_number ASC
        LIMIT 1
        FOR UPDATE;
    END IF;

    IF v_target_seat IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'No available seat found in room.');
    END IF;

    -- 3. Loop through waiting queue strictly in FIFO order (created_at ASC, id ASC) using FOR UPDATE SKIP LOCKED
    FOR v_wait_entry IN
        SELECT w.*
        FROM public.waitlist_entries w
        WHERE w.room_id = p_room_id
          AND w.slot_id = p_slot_id
          AND w.booking_date = p_booking_date
          AND w.status::text = 'waiting'
        ORDER BY w.created_at ASC, w.id ASC
        FOR UPDATE OF w SKIP LOCKED
    LOOP
        -- Re-validate student eligibility
        SELECT status INTO v_student_status FROM public.profiles WHERE id = v_wait_entry.student_id;
        v_restriction_res := public.check_user_restriction_status(v_wait_entry.student_id);

        SELECT id INTO v_existing_booking
        FROM public.bookings
        WHERE student_id = v_wait_entry.student_id
          AND booking_date = p_booking_date
          AND slot_id = p_slot_id
          AND status::text IN ('confirmed', 'awaiting_check_in', 'checked_in');

        -- If student is ineligible, mark entry as 'ineligible' and skip to next candidate
        IF v_student_status IS NULL OR v_student_status != 'active' OR
           (v_restriction_res->>'restricted')::boolean = true OR
           v_existing_booking IS NOT NULL THEN
            UPDATE public.waitlist_entries
            SET status = 'ineligible'::waitlist_status,
                updated_at = NOW()
            WHERE id = v_wait_entry.id;

            CONTINUE;
        END IF;

        -- Candidate is ELIGIBLE! Create Seat Hold & Expiring Offer
        v_offer_expires_at := NOW() + (v_policy_expiry_mins || ' minutes')::INTERVAL;

        -- Create Exclusive Hold Booking (status = awaiting_check_in with seat hold source)
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
        SELECT
            'BK-HOLD-' || UPPER(SUBSTRING(gen_random_uuid()::text FROM 1 FOR 6)),
            v_wait_entry.student_id,
            v_wait_entry.library_id,
            r.floor_id,
            p_room_id,
            v_target_seat.id,
            p_slot_id,
            p_booking_date,
            'awaiting_check_in'::booking_status,
            'waitlist_exclusive_offer',
            'SS-HOLD-' || UPPER(SUBSTRING(gen_random_uuid()::text FROM 1 FOR 10)),
            NOW(),
            NOW()
        FROM public.rooms r WHERE r.id = p_room_id
        RETURNING id INTO v_hold_booking_id;

        -- Update Waitlist Entry Status to 'offered'
        UPDATE public.waitlist_entries
        SET status = 'offered'::waitlist_status,
            offered_at = NOW(),
            offer_expires_at = v_offer_expires_at,
            offered_seat_id = v_target_seat.id,
            allocated_booking_id = v_hold_booking_id,
            updated_at = NOW()
        WHERE id = v_wait_entry.id;

        -- Outbox & Notifications for Offered Student
        INSERT INTO public.notification_outbox (
            recipient_id,
            type,
            title,
            message,
            priority,
            payload
        )
        VALUES (
            v_wait_entry.student_id,
            'WAITLIST_OFFER_CREATED',
            'Seat Available! Offer Expires in ' || v_policy_expiry_mins || ' Mins',
            'A seat (' || v_target_seat.seat_number || ') is now available! Please accept your offer before it expires.',
            'HIGH',
            jsonb_build_object(
                'waitlist_id', v_wait_entry.id,
                'seat_number', v_target_seat.seat_number,
                'expires_at', v_offer_expires_at
            )
        );

        INSERT INTO public.notifications (
            recipient_id,
            type,
            title,
            message,
            priority
        )
        VALUES (
            v_wait_entry.student_id,
            'WAITLIST_OFFER_CREATED',
            'Seat Available! Offer Expires in ' || v_policy_expiry_mins || ' Mins',
            'A seat (' || v_target_seat.seat_number || ') is now available! Please accept your offer before it expires.',
            'HIGH'
        );

        -- Log Activity
        INSERT INTO public.activity_logs (
            actor_id, actor_role, action, entity_type, entity_id, description
        )
        VALUES (
            v_wait_entry.student_id, 'student', 'WAITLIST_OFFER_CREATED', 'waitlist_entry', v_wait_entry.id,
            'Offered Seat ' || v_target_seat.seat_number || ' to student ' || v_wait_entry.student_id
        );

        v_promoted_count := 1;
        EXIT; -- Single seat offered to top candidate
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'promoted_count', v_promoted_count,
        'seat_number', v_target_seat.seat_number
    );
END;
$$;

-- ====================================================================
-- ACCEPT WAITLIST OFFER RPC FUNCTION
-- ====================================================================
DROP FUNCTION IF EXISTS public.accept_waitlist_offer CASCADE;
DROP FUNCTION IF EXISTS public.accept_waitlist_offer(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.accept_waitlist_offer(uuid) CASCADE;

CREATE OR REPLACE FUNCTION public.accept_waitlist_offer(
    p_waitlist_id UUID,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_student_id UUID := auth.uid();
    v_wait_entry RECORD;
    v_booking_id UUID;
    v_booking_code TEXT;
    v_seat_number TEXT;
    v_idempotent_resp JSONB;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL THEN
        SELECT response_payload INTO v_idempotent_resp
        FROM public.idempotency_keys
        WHERE idempotency_key = p_idempotency_key;

        IF v_idempotent_resp IS NOT NULL THEN RETURN v_idempotent_resp; END IF;
    END IF;

    SELECT w.*, s.seat_number
    INTO v_wait_entry
    FROM public.waitlist_entries w
    LEFT JOIN public.seats s ON s.id = w.offered_seat_id
    WHERE w.id = p_waitlist_id FOR UPDATE OF w;

    IF v_wait_entry IS NULL THEN
        RAISE EXCEPTION 'Waitlist offer record not found.';
    END IF;

    IF v_student_id IS NOT NULL AND v_wait_entry.student_id != v_student_id THEN
        RAISE EXCEPTION 'You are not authorized to accept this waitlist offer.';
    END IF;

    IF v_wait_entry.status::text NOT IN ('offered', 'allocated') THEN
        IF v_wait_entry.status::text = 'accepted' THEN
            RETURN jsonb_build_object(
                'success', true,
                'booking_id', v_wait_entry.allocated_booking_id,
                'status', 'confirmed',
                'message', 'Offer already accepted.'
            );
        END IF;
        RAISE EXCEPTION 'This waitlist entry is not currently in an active offer state (status: %).', v_wait_entry.status;
    END IF;

    -- Check Expiration
    IF v_wait_entry.offer_expires_at IS NOT NULL AND v_wait_entry.offer_expires_at <= NOW() THEN
        -- Mark as expired
        UPDATE public.waitlist_entries
        SET status = 'expired'::waitlist_status, updated_at = NOW()
        WHERE id = p_waitlist_id;

        -- Cancel seat hold
        IF v_wait_entry.allocated_booking_id IS NOT NULL THEN
            UPDATE public.bookings SET status = 'expired'::booking_status, cancellation_reason = 'Offer expired' WHERE id = v_wait_entry.allocated_booking_id;
        END IF;

        -- Promote next student
        PERFORM public.promote_next_waitlisted_student(v_wait_entry.room_id, v_wait_entry.slot_id, v_wait_entry.booking_date, v_wait_entry.offered_seat_id);

        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'OFFER_EXPIRED',
            'message', 'This seat offer has expired. The seat has been offered to the next student in line.'
        );
    END IF;

    v_booking_id := v_wait_entry.allocated_booking_id;

    -- Convert Seat Hold Booking to Confirmed Booking
    IF v_booking_id IS NOT NULL THEN
        v_booking_code := 'BK-' || UPPER(SUBSTRING(gen_random_uuid()::text FROM 1 FOR 8));
        UPDATE public.bookings
        SET status = 'confirmed'::booking_status,
            booking_code = v_booking_code,
            booking_source = 'waitlist_offer_accepted',
            updated_at = NOW()
        WHERE id = v_booking_id;
    END IF;

    -- Update Waitlist Status to 'accepted'
    UPDATE public.waitlist_entries
    SET status = 'accepted'::waitlist_status,
        updated_at = NOW()
    WHERE id = p_waitlist_id;

    -- Outbox Notification
    INSERT INTO public.notification_outbox (
        recipient_id, type, title, message, priority, payload
    )
    VALUES (
        v_wait_entry.student_id,
        'WAITLIST_OFFER_ACCEPTED',
        'Reservation Confirmed from Waitlist!',
        'Your waitlist offer for Seat ' || COALESCE(v_seat_number, 'A-101') || ' has been confirmed.',
        'HIGH',
        jsonb_build_object('booking_id', v_booking_id, 'booking_code', v_booking_code)
    );

    v_result := jsonb_build_object(
        'success', true,
        'booking_id', v_booking_id,
        'booking_code', v_booking_code,
        'seat_number', COALESCE(v_seat_number, 'A-101'),
        'status', 'confirmed'
    );

    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO public.idempotency_keys (idempotency_key, user_id, action, response_payload)
        VALUES (p_idempotency_key, v_wait_entry.student_id, 'accept_waitlist_offer', v_result)
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN v_result;
END;
$$;

-- ====================================================================
-- REJECT WAITLIST OFFER RPC FUNCTION
-- ====================================================================
DROP FUNCTION IF EXISTS public.reject_waitlist_offer CASCADE;
DROP FUNCTION IF EXISTS public.reject_waitlist_offer(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.reject_waitlist_offer(uuid) CASCADE;

CREATE OR REPLACE FUNCTION public.reject_waitlist_offer(
    p_waitlist_id UUID,
    p_reason TEXT DEFAULT 'Rejected by student'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_student_id UUID := auth.uid();
    v_wait_entry RECORD;
    v_result JSONB;
BEGIN
    SELECT * INTO v_wait_entry
    FROM public.waitlist_entries
    WHERE id = p_waitlist_id FOR UPDATE;

    IF v_wait_entry IS NULL THEN
        RAISE EXCEPTION 'Waitlist offer record not found.';
    END IF;

    IF v_student_id IS NOT NULL AND v_wait_entry.student_id != v_student_id THEN
        RAISE EXCEPTION 'You are not authorized to reject this offer.';
    END IF;

    IF v_wait_entry.status::text = 'rejected' THEN
        RETURN jsonb_build_object('success', true, 'status', 'rejected', 'message', 'Offer already rejected.');
    END IF;

    -- Mark status as 'rejected'
    UPDATE public.waitlist_entries
    SET status = 'rejected'::waitlist_status,
        rejection_reason = p_reason,
        updated_at = NOW()
    WHERE id = p_waitlist_id;

    -- Cancel hold booking
    IF v_wait_entry.allocated_booking_id IS NOT NULL THEN
        UPDATE public.bookings
        SET status = 'cancelled'::booking_status, cancellation_reason = 'Waitlist offer rejected by student'
        WHERE id = v_wait_entry.allocated_booking_id;
    END IF;

    -- Trigger promotion for next student in line
    PERFORM public.promote_next_waitlisted_student(v_wait_entry.room_id, v_wait_entry.slot_id, v_wait_entry.booking_date, v_wait_entry.offered_seat_id);

    v_result := jsonb_build_object('success', true, 'status', 'rejected');
    RETURN v_result;
END;
$$;

-- ====================================================================
-- EXPIRE WAITLIST OFFERS BATCH WORKER RPC
-- ====================================================================
DROP FUNCTION IF EXISTS public.expire_waitlist_offers_batch();

CREATE OR REPLACE FUNCTION public.expire_waitlist_offers_batch()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rec RECORD;
    v_expired_count INTEGER := 0;
BEGIN
    FOR v_rec IN
        SELECT w.id, w.student_id, w.room_id, w.slot_id, w.booking_date, w.offered_seat_id, w.allocated_booking_id
        FROM public.waitlist_entries w
        WHERE w.status::text IN ('offered', 'allocated')
          AND w.offer_expires_at IS NOT NULL
          AND w.offer_expires_at <= NOW()
        FOR UPDATE OF w SKIP LOCKED
    LOOP
        -- Mark as expired
        UPDATE public.waitlist_entries
        SET status = 'expired'::waitlist_status, updated_at = NOW()
        WHERE id = v_rec.id;

        -- Cancel hold booking
        IF v_rec.allocated_booking_id IS NOT NULL THEN
            UPDATE public.bookings
            SET status = 'expired'::booking_status, cancellation_reason = 'Waitlist offer response timeout'
            WHERE id = v_rec.allocated_booking_id;
        END IF;

        -- Send expiration notification
        INSERT INTO public.notification_outbox (recipient_id, type, title, message, priority)
        VALUES (
            v_rec.student_id,
            'WAITLIST_OFFER_EXPIRED',
            'Waitlist Seat Offer Expired',
            'Your seat claim offer expired because it was not accepted within the time limit.',
            'NORMAL'
        );

        INSERT INTO public.notifications (recipient_id, type, title, message, priority)
        VALUES (
            v_rec.student_id,
            'WAITLIST_OFFER_EXPIRED',
            'Waitlist Seat Offer Expired',
            'Your seat claim offer expired because it was not accepted within the time limit.',
            'NORMAL'
        );

        -- Promote next student
        PERFORM public.promote_next_waitlisted_student(v_rec.room_id, v_rec.slot_id, v_rec.booking_date, v_rec.offered_seat_id);

        v_expired_count := v_expired_count + 1;
    END LOOP;

    RETURN v_expired_count;
END;
$$;
