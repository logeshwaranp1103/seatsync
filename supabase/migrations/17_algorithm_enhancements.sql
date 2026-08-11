-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 17: ALGORITHM ENHANCEMENTS & PRODUCTION SCHEMAS
-- ====================================================================

-- 1. Idempotency Keys Table
CREATE TABLE IF NOT EXISTS public.idempotency_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key TEXT UNIQUE NOT NULL,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    response_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_idempotency_key ON public.idempotency_keys(idempotency_key);


-- 2. Notification Outbox Table (Transactional Notification Engine)
CREATE TABLE IF NOT EXISTS public.notification_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    priority TEXT DEFAULT 'NORMAL',
    payload JSONB DEFAULT '{}'::jsonb,
    status TEXT CHECK (status IN ('pending', 'delivered', 'failed')) DEFAULT 'pending',
    retry_count INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_outbox_status_priority ON public.notification_outbox(status, priority, created_at);

-- 3. User Restrictions Table (Sliding-Window Penalty Management)
CREATE TABLE IF NOT EXISTS public.user_restrictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    restriction_type TEXT NOT NULL CHECK (restriction_type IN ('booking_blocked', 'waitlist_blocked', 'account_suspended')),
    reason TEXT NOT NULL,
    no_show_count INTEGER DEFAULT 0,
    starts_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_restrictions_active ON public.user_restrictions(user_id, is_active, expires_at);

-- 4. Rate Limiting Buckets Table
CREATE TABLE IF NOT EXISTS public.user_rate_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    ip_address TEXT,
    action TEXT NOT NULL,
    request_count INTEGER DEFAULT 1,
    window_start TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, action, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_user_action ON public.user_rate_limits(user_id, action, window_start);

-- 5. Scan Nonces Table (Secure QR Replay Prevention)
CREATE TABLE IF NOT EXISTS public.scan_nonces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nonce TEXT UNIQUE NOT NULL,
    booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
    scanned_by UUID REFERENCES public.profiles(id),
    scanned_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scan_nonces_nonce ON public.scan_nonces(nonce);

-- Enable RLS on new tables
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_restrictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_nonces ENABLE ROW LEVEL SECURITY;

-- RLS Policies for new tables
DROP POLICY IF EXISTS "Users can read own idempotency keys" ON public.idempotency_keys;
CREATE POLICY "Users can read own idempotency keys" ON public.idempotency_keys FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "System can insert idempotency keys" ON public.idempotency_keys;
CREATE POLICY "System can insert idempotency keys" ON public.idempotency_keys FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Users can read own outbox notifications" ON public.notification_outbox;
CREATE POLICY "Users can read own outbox notifications" ON public.notification_outbox FOR SELECT USING (auth.uid() = recipient_id OR public.is_librarian_or_admin());

DROP POLICY IF EXISTS "System can manage notification outbox" ON public.notification_outbox;
CREATE POLICY "System can manage notification outbox" ON public.notification_outbox FOR ALL USING (true);

DROP POLICY IF EXISTS "Users can read own restrictions" ON public.user_restrictions;
CREATE POLICY "Users can read own restrictions" ON public.user_restrictions FOR SELECT USING (auth.uid() = user_id OR public.is_librarian_or_admin());

DROP POLICY IF EXISTS "Staff can manage restrictions" ON public.user_restrictions;
CREATE POLICY "Staff can manage restrictions" ON public.user_restrictions FOR ALL USING (public.is_librarian_or_admin());

DROP POLICY IF EXISTS "Staff can view scan nonces" ON public.scan_nonces;
CREATE POLICY "Staff can view scan nonces" ON public.scan_nonces FOR SELECT USING (public.is_librarian_or_admin());

DROP POLICY IF EXISTS "System can insert scan nonces" ON public.scan_nonces;
CREATE POLICY "System can insert scan nonces" ON public.scan_nonces FOR INSERT WITH CHECK (true);

-- ====================================================================
-- FUNCTION: CHECK USER RESTRICTION STATUS
-- ====================================================================
CREATE OR REPLACE FUNCTION public.check_user_restriction_status(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_restriction RECORD;
BEGIN
    SELECT * INTO v_restriction
    FROM public.user_restrictions
    WHERE user_id = p_user_id
      AND is_active = true
      AND expires_at > NOW()
    ORDER BY expires_at DESC
    LIMIT 1;

    IF v_restriction IS NOT NULL THEN
        RETURN jsonb_build_object(
            'restricted', true,
            'reason', v_restriction.reason,
            'restriction_type', v_restriction.restriction_type,
            'expires_at', v_restriction.expires_at
        );
    END IF;

    RETURN jsonb_build_object('restricted', false);
END;
$$;

-- ====================================================================
-- FUNCTION: CHECK RATE LIMIT
-- ====================================================================
CREATE OR REPLACE FUNCTION public.check_rate_limit(
    p_user_id UUID,
    p_action TEXT,
    p_max_requests INTEGER DEFAULT 10,
    p_window_seconds INTEGER DEFAULT 60
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_window_start TIMESTAMPTZ := date_trunc('minute', NOW());
    v_count INTEGER;
BEGIN
    SELECT request_count INTO v_count
    FROM public.user_rate_limits
    WHERE user_id = p_user_id
      AND action = p_action
      AND window_start = v_window_start;

    IF v_count IS NULL THEN
        INSERT INTO public.user_rate_limits (user_id, action, request_count, window_start)
        VALUES (p_user_id, p_action, 1, v_window_start)
        ON CONFLICT (user_id, action, window_start)
        DO UPDATE SET request_count = public.user_rate_limits.request_count + 1;
        RETURN true;
    ELSIF v_count >= p_max_requests THEN
        RETURN false;
    ELSE
        UPDATE public.user_rate_limits
        SET request_count = request_count + 1
        WHERE user_id = p_user_id
          AND action = p_action
          AND window_start = v_window_start;
        RETURN true;
    END IF;
END;
$$;

-- ====================================================================
-- ENHANCED CREATE BOOKING RPC FUNCTION (WITH IDEMPOTENCY & RESTRICTIONS)
-- ====================================================================
CREATE OR REPLACE FUNCTION public.create_booking(
    p_library_id UUID,
    p_floor_id UUID,
    p_room_id UUID,
    p_seat_id UUID,
    p_slot_id UUID,
    p_booking_date DATE,
    p_booking_source TEXT DEFAULT 'online',
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
    v_restriction_res JSONB;
    v_room_status room_status;
    v_seat_status seat_status;
    v_slot_status slot_status;
    v_seat_number TEXT;
    v_slot_name TEXT;
    v_slot_start TIME;
    v_slot_end TIME;
    v_new_booking_id UUID;
    v_booking_code TEXT;
    v_qr_token TEXT;
    v_existing_seat_booking UUID;
    v_existing_student_booking UUID;
    v_idempotent_resp JSONB;
    v_result JSONB;
    v_tomorrow_date DATE := (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE + INTERVAL '1 day';
BEGIN
    -- 1. Idempotency Check
    IF p_idempotency_key IS NOT NULL THEN
        SELECT response_payload INTO v_idempotent_resp
        FROM public.idempotency_keys
        WHERE idempotency_key = p_idempotency_key;

        IF v_idempotent_resp IS NOT NULL THEN
            RETURN v_idempotent_resp;
        END IF;
    END IF;

    -- 2. Verify authentication & student account status
    IF v_student_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required to make a booking.';
    END IF;

    -- 3. Rate limiting check
    IF NOT public.check_rate_limit(v_student_id, 'create_booking', 5, 60) THEN
        RAISE EXCEPTION 'Booking attempt rate limit exceeded. Please wait a minute before retrying.';
    END IF;

    SELECT status INTO v_user_status FROM public.profiles WHERE id = v_student_id;
    IF v_user_status IS NULL OR v_user_status != 'active' THEN
        RAISE EXCEPTION 'Your account status (%) prevents booking seats.', COALESCE(v_user_status::text, 'blocked');
    END IF;

    -- 4. Check active restrictions
    v_restriction_res := public.check_user_restriction_status(v_student_id);
    IF (v_restriction_res->>'restricted')::boolean = true THEN
        RAISE EXCEPTION 'Booking restricted due to policy violation: %', v_restriction_res->>'reason';
    END IF;

    -- 5. Validate Room Status
    SELECT status INTO v_room_status FROM public.rooms WHERE id = p_room_id;
    IF v_room_status IS NULL OR v_room_status != 'active' THEN
        RAISE EXCEPTION 'The selected reading room is currently closed or inactive.';
    END IF;

    -- 6. Lock Seat & Validate Physical Condition
    SELECT status, seat_number INTO v_seat_status, v_seat_number 
    FROM public.seats 
    WHERE id = p_seat_id FOR UPDATE;
    
    IF v_seat_status IS NULL OR v_seat_status = 'maintenance' OR v_seat_status = 'disabled' THEN
        RAISE EXCEPTION 'Seat % is currently under maintenance or disabled.', COALESCE(v_seat_number, 'selected');
    END IF;

    -- 7. Validate Slot Status & Time Range
    SELECT status, name, start_time, end_time INTO v_slot_status, v_slot_name, v_slot_start, v_slot_end
    FROM public.slots 
    WHERE id = p_slot_id;
    
    IF v_slot_status IS NULL OR v_slot_status != 'active' THEN
        RAISE EXCEPTION 'The selected time slot (%) is cancelled or disabled.', COALESCE(v_slot_name, 'slot');
    END IF;

    -- 8. Lock & Check for conflicting seat bookings
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

    -- 9. Check for student double booking during same date & slot
    SELECT id INTO v_existing_student_booking
    FROM public.bookings
    WHERE student_id = v_student_id
      AND booking_date = p_booking_date
      AND slot_id = p_slot_id
      AND status IN ('confirmed', 'awaiting_check_in', 'checked_in');

    IF v_existing_student_booking IS NOT NULL THEN
        RAISE EXCEPTION 'You already hold an active reservation for this time slot (%).', v_slot_name;
    END IF;

    -- 10. Generate Identifiers
    v_booking_code := 'BK-' || UPPER(SUBSTRING(gen_random_uuid()::text FROM 1 FOR 8));
    v_qr_token := 'SS-' || UPPER(SUBSTRING(gen_random_uuid()::text FROM 1 FOR 12));

    -- 11. Insert Booking Record
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

    -- 12. Transactional Notification Outbox Entry
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
        'BOOKING_CONFIRMED',
        'Reservation Confirmed — Seat ' || v_seat_number,
        'Your reservation for Seat ' || v_seat_number || ' on ' || p_booking_date || ' (' || v_slot_name || ') is confirmed.',
        'NORMAL',
        jsonb_build_object('booking_id', v_new_booking_id, 'booking_code', v_booking_code)
    );

    -- 13. Also insert direct notification for instant UI update
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

    -- 14. Append-Only Audit Log
    INSERT INTO public.activity_logs (
        actor_id,
        actor_role,
        action,
        entity_type,
        entity_id,
        description,
        metadata
    )
    VALUES (
        v_student_id,
        'student',
        'CREATE_BOOKING',
        'booking',
        v_new_booking_id,
        'Student created booking ' || v_booking_code || ' for Seat ' || v_seat_number,
        jsonb_build_object('slot_id', p_slot_id, 'booking_date', p_booking_date)
    );

    v_result := jsonb_build_object(
        'success', true,
        'booking_id', v_new_booking_id,
        'booking_code', v_booking_code,
        'seat_number', v_seat_number,
        'slot_name', v_slot_name,
        'booking_date', p_booking_date,
        'qr_token', v_qr_token
    );

    -- Store Idempotency Response
    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO public.idempotency_keys (idempotency_key, user_id, action, response_payload)
        VALUES (p_idempotency_key, v_student_id, 'create_booking', v_result)
        ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    RETURN v_result;
END;
$$;

-- ====================================================================
-- WAITLIST OFFER ACCEPTANCE & EXPIRATION RPC FUNCTIONS
-- ====================================================================
DROP FUNCTION IF EXISTS public.accept_waitlist_offer(UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.accept_waitlist_offer(UUID) CASCADE;
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
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL THEN
        SELECT response_payload INTO v_result
        FROM public.idempotency_keys
        WHERE idempotency_key = p_idempotency_key;

        IF v_result IS NOT NULL THEN RETURN v_result; END IF;
    END IF;

    SELECT * INTO v_wait_entry
    FROM public.waitlist_entries
    WHERE id = p_waitlist_id FOR UPDATE;

    IF v_wait_entry IS NULL OR v_wait_entry.student_id != v_student_id THEN
        RAISE EXCEPTION 'Waitlist offer not found or unauthorized.';
    END IF;

    IF v_wait_entry.status != 'allocated' THEN
        RAISE EXCEPTION 'Waitlist entry is not currently in allocated state (%).', v_wait_entry.status;
    END IF;

    IF v_wait_entry.expires_at < NOW() THEN
        UPDATE public.waitlist_entries SET status = 'expired', updated_at = NOW() WHERE id = p_waitlist_id;
        RAISE EXCEPTION 'This waitlist offer has expired.';
    END IF;

    v_booking_id := v_wait_entry.allocated_booking_id;

    UPDATE public.waitlist_entries
    SET status = 'allocated', updated_at = NOW()
    WHERE id = p_waitlist_id;

    v_result := jsonb_build_object(
        'success', true,
        'booking_id', v_booking_id,
        'status', 'confirmed'
    );

    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO public.idempotency_keys (idempotency_key, user_id, action, response_payload)
        VALUES (p_idempotency_key, v_student_id, 'accept_waitlist_offer', v_result)
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN v_result;
END;
$$;

DROP FUNCTION IF EXISTS public.reject_waitlist_offer(UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.reject_waitlist_offer(UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.reject_waitlist_offer(
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
    v_result JSONB;
BEGIN
    SELECT * INTO v_wait_entry
    FROM public.waitlist_entries
    WHERE id = p_waitlist_id FOR UPDATE;

    IF v_wait_entry IS NULL OR v_wait_entry.student_id != v_student_id THEN
        RAISE EXCEPTION 'Waitlist entry not found.';
    END IF;

    UPDATE public.waitlist_entries
    SET status = 'cancelled', updated_at = NOW()
    WHERE id = p_waitlist_id;

    -- Cancel allocated hold booking if present
    IF v_wait_entry.allocated_booking_id IS NOT NULL THEN
        UPDATE public.bookings
        SET status = 'cancelled', cancellation_reason = 'Offer rejected by student'
        WHERE id = v_wait_entry.allocated_booking_id;
    END IF;

    -- Trigger allocation for next student
    PERFORM public.allocate_next_waitlisted_student(v_wait_entry.room_id, v_wait_entry.slot_id, v_wait_entry.booking_date);

    v_result := jsonb_build_object('success', true, 'status', 'rejected');
    RETURN v_result;
END;
$$;

-- ====================================================================
-- ENHANCED NO-SHOW PROCESSOR WITH FOR UPDATE SKIP LOCKED
-- ====================================================================
CREATE OR REPLACE FUNCTION public.process_no_shows_batch()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count INTEGER := 0;
    v_today DATE := (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE;
    v_grace_mins INTEGER := 15;
    v_rec RECORD;
    v_no_shows_threshold INTEGER := 3;
BEGIN
    FOR v_rec IN
        SELECT b.id, b.student_id, b.seat_id, b.room_id, b.slot_id, b.booking_date, s.start_time, s.name AS slot_name
        FROM public.bookings b
        JOIN public.slots s ON s.id = b.slot_id
        WHERE b.booking_date = v_today
          AND b.status IN ('confirmed', 'awaiting_check_in')
          AND (NOW() AT TIME ZONE 'Asia/Kolkata')::TIME > (s.start_time + (v_grace_mins || ' minutes')::INTERVAL)
        FOR UPDATE OF b SKIP LOCKED
    LOOP
        -- Mark booking as no_show
        UPDATE public.bookings
        SET status = 'no_show', updated_at = NOW()
        WHERE id = v_rec.id;

        -- Record no-show penalty log
        INSERT INTO public.no_show_records (student_id, booking_id, reason, created_at)
        VALUES (v_rec.student_id, v_rec.id, '15-minute check-in grace period expired', NOW())
        ON CONFLICT DO NOTHING;

        -- Increment student no_show_count in profiles
        UPDATE public.profiles
        SET no_show_count = COALESCE(no_show_count, 0) + 1, updated_at = NOW()
        WHERE id = v_rec.student_id;

        -- Check if student exceeded threshold and auto-restrict
        IF (SELECT no_show_count FROM public.profiles WHERE id = v_rec.student_id) >= v_no_shows_threshold THEN
            INSERT INTO public.user_restrictions (
                user_id,
                restriction_type,
                reason,
                starts_at,
                expires_at,
                is_active
            )
            VALUES (
                v_rec.student_id,
                'booking_blocked',
                'Automated restriction: Exceeded 3 no-show penalties in sliding window',
                NOW(),
                NOW() + INTERVAL '7 days',
                true
            )
            ON CONFLICT DO NOTHING;
        END IF;

        -- Transactional Notification Outbox Entry
        INSERT INTO public.notification_outbox (
            recipient_id,
            type,
            title,
            message,
            priority
        )
        VALUES (
            v_rec.student_id,
            'NO_SHOW_PENALTY',
            'Reservation Marked No-Show',
            'Your reservation for ' || v_rec.slot_name || ' was released as the 15-minute check-in grace period expired.',
            'HIGH'
        );

        -- Trigger waitlist promotion
        PERFORM public.allocate_next_waitlisted_student(v_rec.room_id, v_rec.slot_id, v_rec.booking_date);

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

-- ====================================================================
-- SYSTEM ANALYTICS SUMMARY RPC FUNCTION
-- ====================================================================
CREATE OR REPLACE FUNCTION public.get_system_analytics_summary()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total_seats INTEGER;
    v_total_bookings INTEGER;
    v_checked_in_bookings INTEGER;
    v_cancelled_bookings INTEGER;
    v_no_show_bookings INTEGER;
    v_waitlist_total INTEGER;
    v_waitlist_allocated INTEGER;
    v_occupancy_rate NUMERIC;
    v_completion_rate NUMERIC;
    v_no_show_rate NUMERIC;
    v_cancellation_rate NUMERIC;
    v_waitlist_conversion_rate NUMERIC;
BEGIN
    SELECT COUNT(*) INTO v_total_seats FROM public.seats WHERE status != 'disabled';
    SELECT COUNT(*) INTO v_total_bookings FROM public.bookings;
    SELECT COUNT(*) INTO v_checked_in_bookings FROM public.bookings WHERE status IN ('checked_in', 'completed');
    SELECT COUNT(*) INTO v_cancelled_bookings FROM public.bookings WHERE status IN ('cancelled', 'slot_cancelled');
    SELECT COUNT(*) INTO v_no_show_bookings FROM public.bookings WHERE status = 'no_show';
    SELECT COUNT(*) INTO v_waitlist_total FROM public.waitlist_entries;
    SELECT COUNT(*) INTO v_waitlist_allocated FROM public.waitlist_entries WHERE status = 'allocated';

    v_occupancy_rate := CASE WHEN v_total_seats > 0 THEN ROUND((v_checked_in_bookings::NUMERIC / v_total_seats::NUMERIC) * 100, 1) ELSE 0 END;
    v_completion_rate := CASE WHEN v_total_bookings > 0 THEN ROUND((v_checked_in_bookings::NUMERIC / v_total_bookings::NUMERIC) * 100, 1) ELSE 0 END;
    v_no_show_rate := CASE WHEN v_total_bookings > 0 THEN ROUND((v_no_show_bookings::NUMERIC / v_total_bookings::NUMERIC) * 100, 1) ELSE 0 END;
    v_cancellation_rate := CASE WHEN v_total_bookings > 0 THEN ROUND((v_cancelled_bookings::NUMERIC / v_total_bookings::NUMERIC) * 100, 1) ELSE 0 END;
    v_waitlist_conversion_rate := CASE WHEN v_waitlist_total > 0 THEN ROUND((v_waitlist_allocated::NUMERIC / v_waitlist_total::NUMERIC) * 100, 1) ELSE 0 END;

    RETURN jsonb_build_object(
        'total_seats', COALESCE(v_total_seats, 0),
        'total_bookings', COALESCE(v_total_bookings, 0),
        'checked_in_bookings', COALESCE(v_checked_in_bookings, 0),
        'cancelled_bookings', COALESCE(v_cancelled_bookings, 0),
        'no_show_bookings', COALESCE(v_no_show_bookings, 0),
        'occupancy_rate', v_occupancy_rate,
        'completion_rate', v_completion_rate,
        'no_show_rate', v_no_show_rate,
        'cancellation_rate', v_cancellation_rate,
        'waitlist_conversion_rate', v_waitlist_conversion_rate
    );
END;
$$;
