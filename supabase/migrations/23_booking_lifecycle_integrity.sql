-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 23: BOOKING LIFECYCLE & DATA INTEGRITY OVERHAUL
-- ====================================================================

-- 1. PREVIEW & DIAGNOSTIC AUDIT (NON-DESTRUCTIVE READ-ONLY PREVIEW)
DO $$
DECLARE
    v_early_checkin_count INTEGER;
    v_missing_qr_count INTEGER;
    v_unattended_past_count INTEGER;
BEGIN
    -- Count future bookings checked in early
    SELECT COUNT(*) INTO v_early_checkin_count
    FROM public.bookings
    WHERE status = 'checked_in'
      AND booking_date > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE;

    -- Count confirmed bookings missing QR tokens
    SELECT COUNT(*) INTO v_missing_qr_count
    FROM public.bookings
    WHERE status IN ('confirmed', 'awaiting_check_in')
      AND (qr_token IS NULL OR qr_token = '');

    -- Count past unattended confirmed bookings
    SELECT COUNT(*) INTO v_unattended_past_count
    FROM public.bookings
    WHERE status = 'confirmed'
      AND booking_date < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE;

    RAISE NOTICE '=== SEATSYNC DIAGNOSTIC AUDIT PREVIEW ===';
    RAISE NOTICE 'Future bookings checked-in early: %', v_early_checkin_count;
    RAISE NOTICE 'Confirmed bookings missing QR tokens: %', v_missing_qr_count;
    RAISE NOTICE 'Past unattended confirmed bookings needing no_show: %', v_unattended_past_count;
END;
$$;


-- 2. SCHEMA COLUMNS & SECURITY TABLE PREPARATION
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS qr_token TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS checked_in_by UUID;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS checked_out_at TIMESTAMPTZ;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS checked_out_by UUID;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS booking_source TEXT DEFAULT 'online';

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    target_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    event_type TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS action TEXT;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS affected_record TEXT;

CREATE TABLE IF NOT EXISTS public.no_show_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID REFERENCES public.bookings(id) ON DELETE CASCADE,
    student_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    booking_date DATE,
    slot_id UUID REFERENCES public.slots(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.no_show_records ADD COLUMN IF NOT EXISTS booking_date DATE;
ALTER TABLE public.no_show_records ADD COLUMN IF NOT EXISTS date DATE;
ALTER TABLE public.no_show_records ADD COLUMN IF NOT EXISTS slot_id UUID;
ALTER TABLE public.no_show_records ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE public.no_show_records ADD COLUMN IF NOT EXISTS recorded_by UUID;

CREATE TABLE IF NOT EXISTS public.idempotency_keys (
    idempotency_key TEXT PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id),
    action TEXT NOT NULL,
    response_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);


-- 3. DATA REPAIR & BACKFILL EXECUTION

-- A. Preserve audit log & revert future bookings checked in early back to confirmed
INSERT INTO public.audit_logs (actor_id, event_type, metadata)
SELECT 
    checked_in_by,
    'REVERT_EARLY_CHECKIN',
    jsonb_build_object(
        'booking_id', id,
        'student_id', student_id,
        'booking_date', booking_date,
        'invalid_checked_in_at', checked_in_at,
        'invalid_checked_in_by', checked_in_by,
        'reverted_at', NOW()
    )
FROM public.bookings
WHERE status = 'checked_in'
  AND booking_date > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE;

UPDATE public.bookings
SET status = 'confirmed',
    checked_in_at = NULL,
    checked_in_by = NULL,
    updated_at = NOW()
WHERE status = 'checked_in'
  AND booking_date > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE;


-- B. Backfill missing secure QR tokens for active confirmed bookings
UPDATE public.bookings
SET qr_token = 'QR-' || encode(gen_random_bytes(16), 'hex'),
    updated_at = NOW()
WHERE status IN ('confirmed', 'awaiting_check_in')
  AND (qr_token IS NULL OR qr_token = '');


-- C. Convert past unattended confirmed bookings to no_show & record no_show_records
INSERT INTO public.no_show_records (booking_id, student_id, booking_date, slot_id)
SELECT id, student_id, booking_date, slot_id
FROM public.bookings
WHERE status = 'confirmed'
  AND booking_date < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE
ON CONFLICT DO NOTHING;

UPDATE public.profiles p
SET no_show_count = COALESCE(p.no_show_count, 0) + sub.past_cnt,
    updated_at = NOW()
FROM (
    SELECT student_id, COUNT(*) AS past_cnt
    FROM public.bookings
    WHERE status = 'confirmed'
      AND booking_date < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE
    GROUP BY student_id
) sub
WHERE p.id = sub.student_id;

UPDATE public.bookings
SET status = 'no_show',
    cancellation_reason = 'Unattended reservation auto-expired to no-show',
    updated_at = NOW()
WHERE status = 'confirmed'
  AND booking_date < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE;


-- 4. PARTIAL UNIQUE INDEXES & CONSTRAINTS

-- Partial Unique Index 1: One active booking per seat + date + slot occurrence
DROP INDEX IF EXISTS idx_unique_active_seat_booking;
CREATE UNIQUE INDEX idx_unique_active_seat_booking
ON public.bookings(seat_id, slot_id, booking_date)
WHERE status IN ('confirmed', 'checked_in', 'awaiting_check_in');

-- Partial Unique Index 2: Unique non-null QR tokens
DROP INDEX IF EXISTS idx_unique_non_null_qr_token;
CREATE UNIQUE INDEX idx_unique_non_null_qr_token
ON public.bookings(qr_token)
WHERE qr_token IS NOT NULL;

-- Partial Unique Index 3: Unique non-null Idempotency Keys
DROP INDEX IF EXISTS idx_unique_non_null_idempotency_key;
CREATE UNIQUE INDEX idx_unique_non_null_idempotency_key
ON public.bookings(idempotency_key)
WHERE idempotency_key IS NOT NULL;


-- 5. ATOMIC CREATE BOOKING RPC WITH OVERLAP PREVENTION & IDEMPOTENCY
DROP FUNCTION IF EXISTS public.create_booking(UUID, UUID, UUID, DATE, UUID, UUID, UUID, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.create_booking(UUID, UUID, UUID, DATE, UUID, UUID, UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.create_booking(UUID, UUID, UUID, DATE, UUID, UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.create_booking(UUID, UUID, UUID, DATE) CASCADE;

CREATE OR REPLACE FUNCTION public.create_booking(
    p_student_id UUID DEFAULT NULL,
    p_seat_id UUID DEFAULT NULL,
    p_slot_id UUID DEFAULT NULL,
    p_booking_date DATE DEFAULT NULL,
    p_library_id UUID DEFAULT NULL,
    p_floor_id UUID DEFAULT NULL,
    p_room_id UUID DEFAULT NULL,
    p_booking_source TEXT DEFAULT 'online',
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_student_id UUID := COALESCE(p_student_id, auth.uid());
    v_booking_id UUID;
    v_booking_code TEXT;
    v_qr_token TEXT;
    v_existing_resp JSONB;
    v_seat_number TEXT;
    v_allocation_mode TEXT;
    v_user_status TEXT;
    v_requested_slot RECORD;
    v_overlap_count INTEGER;
    v_now_date DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE;
BEGIN
    -- Idempotency Guard
    IF p_idempotency_key IS NOT NULL THEN
        SELECT response_payload INTO v_existing_resp
        FROM public.idempotency_keys
        WHERE idempotency_key = p_idempotency_key;

        IF v_existing_resp IS NOT NULL THEN
            RETURN v_existing_resp;
        END IF;
    END IF;

    IF v_student_id IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED: Authentication required to make a reservation.';
    END IF;

    -- Validate Student Status
    SELECT status INTO v_user_status FROM public.profiles WHERE id = v_student_id;
    IF v_user_status IN ('blocked', 'suspended', 'inactive') THEN
        RAISE EXCEPTION 'USER_BLOCKED: Student account is blocked or suspended.';
    END IF;

    -- Validate Date (No past bookings)
    IF p_booking_date < v_now_date THEN
        RAISE EXCEPTION 'INVALID_DATE: Reservations cannot be made for past dates.';
    END IF;

    -- Fetch Seat & Allocation Mode
    SELECT seat_number, COALESCE(allocation_mode, 'online') INTO v_seat_number, v_allocation_mode
    FROM public.seats WHERE id = p_seat_id;

    IF v_allocation_mode = 'walk_in_only' THEN
        RAISE EXCEPTION 'SEAT_NOT_AVAILABLE_FOR_ONLINE_BOOKING: Seat % is reserved exclusively for desk walk-in allocation.', v_seat_number;
    END IF;

    -- Fetch Requested Slot Start/End Time
    SELECT id, name, start_time, end_time INTO v_requested_slot
    FROM public.slots WHERE id = p_slot_id;

    -- Overlapping Active Booking Check (Actual Start/End Timestamp Comparison)
    SELECT COUNT(*) INTO v_overlap_count
    FROM public.bookings b
    JOIN public.slots s ON s.id = b.slot_id
    WHERE b.student_id = v_student_id
      AND b.booking_date = p_booking_date
      AND b.status IN ('confirmed', 'checked_in', 'awaiting_check_in')
      AND (s.start_time < v_requested_slot.end_time AND s.end_time > v_requested_slot.start_time);

    IF v_overlap_count > 0 THEN
        RAISE EXCEPTION 'STUDENT_OVERLAP: You already have an active reservation for an overlapping time slot on this date.';
    END IF;

    -- Generate Codes & Tokens
    v_booking_id := uuid_generate_v4();
    v_booking_code := 'BK-' || UPPER(SUBSTRING(v_booking_id::text FROM 1 FOR 8));
    v_qr_token := 'QR-' || encode(gen_random_bytes(16), 'hex');

    -- Insert Booking Atomically
    INSERT INTO public.bookings (
        id,
        booking_code,
        qr_token,
        student_id,
        library_id,
        floor_id,
        room_id,
        seat_id,
        slot_id,
        booking_date,
        status,
        booking_source,
        idempotency_key,
        created_at,
        updated_at
    ) VALUES (
        v_booking_id,
        v_booking_code,
        v_qr_token,
        v_student_id,
        p_library_id,
        p_floor_id,
        p_room_id,
        p_seat_id,
        p_slot_id,
        p_booking_date,
        'confirmed',
        p_booking_source,
        p_idempotency_key,
        NOW(),
        NOW()
    );

    v_existing_resp := jsonb_build_object(
        'success', true,
        'booking_id', v_booking_id,
        'booking_code', v_booking_code,
        'qr_token', v_qr_token,
        'seat_number', v_seat_number,
        'booking_date', p_booking_date,
        'status', 'confirmed'
    );

    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO public.idempotency_keys (idempotency_key, user_id, action, response_payload)
        VALUES (p_idempotency_key, v_student_id, 'create_booking', v_existing_resp)
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN v_existing_resp;
EXCEPTION
    WHEN unique_violation THEN
        RAISE EXCEPTION 'SEAT_ALREADY_RESERVED: This seat has just been reserved by another student. Please select another seat.';
END;
$$;


-- 6. ATOMIC TIMEZONE-AWARE CHECK-IN RPC (ASIA/KOLKATA)
DROP FUNCTION IF EXISTS public.confirm_booking_check_in(UUID, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.confirm_booking_check_in(UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.confirm_booking_check_in(UUID) CASCADE;

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
    v_slot RECORD;
    v_now_kolkata TIMESTAMPTZ := CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata';
    v_today_kolkata DATE := v_now_kolkata::DATE;
    v_now_time TIME := v_now_kolkata::TIME;
    v_window_start TIME;
    v_window_end TIME;
    v_response JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL THEN
        SELECT response_payload INTO v_response
        FROM public.idempotency_keys
        WHERE idempotency_key = p_idempotency_key;

        IF v_response IS NOT NULL THEN RETURN v_response; END IF;
    END IF;

    -- Lock Booking Record
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
            'checked_in_at', v_booking.checked_in_at
        );
        RETURN v_response;
    END IF;

    IF v_booking.status IN ('cancelled', 'slot_cancelled', 'no_show', 'expired') THEN
        RAISE EXCEPTION 'INVALID_STATUS: Cannot check-in a cancelled or expired booking.';
    END IF;

    -- Validate Booking Date (Asia/Kolkata)
    IF v_booking.booking_date != v_today_kolkata THEN
        RAISE EXCEPTION 'INVALID_CHECKIN_DATE: Check-in is available only on the booking date (%).', v_booking.booking_date;
    END IF;

    -- Fetch Slot Window
    SELECT name, start_time, end_time INTO v_slot FROM public.slots WHERE id = v_booking.slot_id;

    v_window_start := (v_slot.start_time - INTERVAL '15 minutes')::TIME;
    v_window_end := (v_slot.start_time + INTERVAL '15 minutes')::TIME;

    IF v_now_time < v_window_start THEN
        RAISE EXCEPTION 'CHECKIN_NOT_OPEN: Check-in has not opened yet. Check-in opens 15 minutes before slot start time (%).', v_slot.start_time;
    END IF;

    IF v_now_time > v_window_end THEN
        RAISE EXCEPTION 'GRACE_PERIOD_EXPIRED: The check-in grace period has expired for this slot.';
    END IF;

    -- Update Booking Status Atomically
    UPDATE public.bookings
    SET status = 'checked_in',
        checked_in_at = NOW(),
        checked_in_by = v_staff_id,
        updated_at = NOW()
    WHERE id = p_booking_id;

    -- Record Check-In Log
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
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN v_response;
END;
$$;


-- 7. BATCH PROCESS NO-SHOWS RPC (IDEMPOTENT EXPIRED BOOKINGS PROCESSOR)
DROP FUNCTION IF EXISTS public.process_no_shows_batch CASCADE;

CREATE OR REPLACE FUNCTION public.process_no_shows_batch()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now_kolkata TIMESTAMPTZ := CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata';
    v_today_date DATE := v_now_kolkata::DATE;
    v_now_time TIME := v_now_kolkata::TIME;
    v_rec RECORD;
    v_processed_count INTEGER := 0;
BEGIN
    FOR v_rec IN
        SELECT b.id, b.student_id, b.seat_id, b.room_id, b.slot_id, b.booking_date, s.start_time
        FROM public.bookings b
        JOIN public.slots s ON s.id = b.slot_id
        WHERE b.status = 'confirmed'
          AND (
            b.booking_date < v_today_date OR
            (b.booking_date = v_today_date AND v_now_time > (s.start_time + INTERVAL '15 minutes')::TIME)
          )
        FOR UPDATE OF b
    LOOP
        -- Update booking status to no_show
        UPDATE public.bookings
        SET status = 'no_show',
            cancellation_reason = 'No-show grace period expired without check-in',
            updated_at = NOW()
        WHERE id = v_rec.id;

        -- Record no_show entry
        INSERT INTO public.no_show_records (booking_id, student_id, booking_date, slot_id)
        VALUES (v_rec.id, v_rec.student_id, v_rec.booking_date, v_rec.slot_id)
        ON CONFLICT DO NOTHING;

        -- Update profile no_show_count
        UPDATE public.profiles
        SET no_show_count = COALESCE(no_show_count, 0) + 1,
            updated_at = NOW()
        WHERE id = v_rec.student_id;

        -- Outbox Notification
        INSERT INTO public.notification_outbox (
            recipient_id, type, title, message, priority
        ) VALUES (
            v_rec.student_id,
            'NO_SHOW_EXPIRED',
            'Reservation Marked No-Show',
            'Your reservation for ' || v_rec.booking_date || ' was marked no-show because check-in was not completed within the grace period.',
            'HIGH'
        );

        -- FIFO Waitlist Auto Promotion if applicable
        PERFORM public.promote_next_waitlisted_student(v_rec.room_id, v_rec.slot_id, v_rec.booking_date, v_rec.seat_id);

        v_processed_count := v_processed_count + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'processed_count', v_processed_count,
        'timestamp', NOW()
    );
END;
$$;


-- 8. SUPABASE REALTIME PUBLICATION ENABLEMENT
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'bookings'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings;
    END IF;
END;
$$;
