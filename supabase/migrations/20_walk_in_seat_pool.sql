-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 20: DEDICATED WALK-IN SEAT POOL (S-41 TO S-50)
-- ====================================================================

-- 1. Add allocation_mode column to seats table
ALTER TABLE public.seats
    ADD COLUMN IF NOT EXISTS allocation_mode TEXT NOT NULL DEFAULT 'online';

ALTER TABLE public.seats
    DROP CONSTRAINT IF EXISTS check_allocation_mode;

ALTER TABLE public.seats
    ADD CONSTRAINT check_allocation_mode CHECK (allocation_mode IN ('online', 'walk_in_only'));

-- Index for allocation mode queries
CREATE INDEX IF NOT EXISTS idx_seats_allocation_mode
ON public.seats (room_id, allocation_mode, status);

-- 2. Configure S-01..S-40 as online and S-41..S-50 as walk_in_only for Main Reading Room
UPDATE public.seats
SET allocation_mode = 'online'
WHERE seat_number ~ '^S-(0[1-9]|[1-3][0-9]|40)$';

DO $$
DECLARE
    v_room_id UUID;
    v_library_id UUID;
    i INT;
    s_num TEXT;
BEGIN
    SELECT r.id, r.library_id INTO v_room_id, v_library_id
    FROM public.rooms r
    WHERE r.name ILIKE '%Main Quiet Reading%' OR r.name ILIKE '%Ground Floor%'
    LIMIT 1;

    IF v_room_id IS NULL THEN
        SELECT id, library_id INTO v_room_id, v_library_id FROM public.rooms LIMIT 1;
    END IF;

    IF v_room_id IS NOT NULL THEN
        FOR i IN 41..50 LOOP
            s_num := 'S-' || i;
            INSERT INTO public.seats (room_id, seat_number, status, allocation_mode, has_power_socket, is_accessible)
            VALUES (v_room_id, s_num, 'available', 'walk_in_only', true, false)
            ON CONFLICT (room_id, seat_number) DO UPDATE
            SET allocation_mode = 'walk_in_only';
        END LOOP;
    END IF;
END $$;

-- ====================================================================
-- RPC FUNCTION: GET WALK-IN SEATS FOR DESK ALLOCATION
-- ====================================================================
DROP FUNCTION IF EXISTS public.get_walk_in_available_seats(uuid, date, uuid);

CREATE OR REPLACE FUNCTION public.get_walk_in_available_seats(
    p_room_id UUID,
    p_booking_date DATE,
    p_slot_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_agg(
        jsonb_build_object(
            'id', s.id,
            'seat_number', s.seat_number,
            'allocation_mode', s.allocation_mode,
            'physical_status', s.status,
            'has_power_socket', COALESCE(s.has_power_socket, true),
            'is_accessible', COALESCE(s.is_accessible, false),
            'computed_status', CASE
                WHEN s.status = 'maintenance' THEN 'maintenance'
                WHEN b.id IS NOT NULL AND b.status::text IN ('checked_in', 'active') THEN 'checked_in'
                WHEN b.id IS NOT NULL THEN 'allocated'
                ELSE 'available'
            END,
            'active_booking', CASE WHEN b.id IS NOT NULL THEN jsonb_build_object(
                'id', b.id,
                'booking_code', b.booking_code,
                'student_id', b.student_id,
                'status', b.status,
                'booking_source', b.booking_source
            ) ELSE NULL END
        )
        ORDER BY s.seat_number ASC
    ) INTO v_result
    FROM public.seats s
    LEFT JOIN public.bookings b ON b.seat_id = s.id 
                               AND b.booking_date = p_booking_date 
                               AND b.slot_id = p_slot_id
                               AND b.status::text IN ('confirmed', 'awaiting_check_in', 'checked_in', 'active')
    WHERE (p_room_id IS NULL OR s.room_id = p_room_id)
      AND s.allocation_mode = 'walk_in_only';

    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- ====================================================================
-- RPC FUNCTION: ATOMIC WALK-IN SEAT ALLOCATION
-- ====================================================================
DROP FUNCTION IF EXISTS public.allocate_walk_in_seat(uuid, uuid, uuid, date, boolean, text, text);

CREATE OR REPLACE FUNCTION public.allocate_walk_in_seat(
    p_student_id UUID,
    p_seat_id UUID,
    p_slot_id UUID,
    p_booking_date DATE,
    p_perform_instant_check_in BOOLEAN DEFAULT TRUE,
    p_idempotency_key TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_seat RECORD;
    v_existing_booking RECORD;
    v_booking_id UUID;
    v_booking_code TEXT;
    v_initial_status TEXT;
    v_student_name TEXT;
    v_student_reg TEXT;
    v_slot_name TEXT;
    v_slot_time TEXT;
BEGIN
    -- 1. Idempotency Check
    IF p_idempotency_key IS NOT NULL AND p_idempotency_key <> '' THEN
        SELECT id, booking_code, status INTO v_existing_booking
        FROM public.bookings
        WHERE idempotency_key = p_idempotency_key;

        IF FOUND THEN
            RETURN jsonb_build_object(
                'success', true,
                'is_idempotent', true,
                'booking_id', v_existing_booking.id,
                'booking_code', v_existing_booking.booking_code,
                'status', v_existing_booking.status,
                'message', 'Idempotent transaction returned existing walk-in allocation.'
            );
        END IF;
    END IF;

    -- 2. Verify Seat Allocation Mode
    SELECT id, seat_number, room_id, status, allocation_mode INTO v_seat
    FROM public.seats
    WHERE id = p_seat_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'SEAT_NOT_FOUND: Target seat does not exist.';
    END IF;

    IF v_seat.allocation_mode <> 'walk_in_only' THEN
        RAISE EXCEPTION 'INVALID_ALLOCATION_MODE: Seat % is an online-only seat. Walk-in desk can only allocate walk_in_only pool seats.', v_seat.seat_number;
    END IF;

    IF v_seat.status = 'maintenance' THEN
        RAISE EXCEPTION 'SEAT_UNDER_MAINTENANCE: Seat % is under physical maintenance.', v_seat.seat_number;
    END IF;

    -- 3. Verify Seat Availability for Slot
    SELECT id INTO v_existing_booking
    FROM public.bookings
    WHERE seat_id = p_seat_id
      AND booking_date = p_booking_date
      AND slot_id = p_slot_id
      AND status::text IN ('confirmed', 'awaiting_check_in', 'checked_in', 'active')
    FOR UPDATE;

    IF FOUND THEN
        RAISE EXCEPTION 'SEAT_ALREADY_ALLOCATED: Seat % is already allocated for this time slot.', v_seat.seat_number;
    END IF;

    -- 4. Check Student Overlap
    SELECT id INTO v_existing_booking
    FROM public.bookings
    WHERE student_id = p_student_id
      AND booking_date = p_booking_date
      AND slot_id = p_slot_id
      AND status::text IN ('confirmed', 'awaiting_check_in', 'checked_in', 'active');

    IF FOUND THEN
        RAISE EXCEPTION 'STUDENT_ALREADY_HAS_RESERVATION: Student already has a booking for this slot.';
    END IF;

    -- 5. Fetch Profile & Slot Details
    SELECT full_name, registration_number INTO v_student_name, v_student_reg
    FROM public.profiles
    WHERE id = p_student_id;

    SELECT name, start_time || ' - ' || end_time INTO v_slot_name, v_slot_time
    FROM public.slots
    WHERE id = p_slot_id;

    -- 6. Generate Booking Code & Initial Status
    v_booking_code := 'WK-' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT) FROM 1 FOR 6));
    v_initial_status := CASE WHEN p_perform_instant_check_in THEN 'checked_in' ELSE 'confirmed' END;
    v_booking_id := gen_random_uuid();

    -- 7. Insert Booking Record
    INSERT INTO public.bookings (
        id,
        booking_code,
        student_id,
        seat_id,
        slot_id,
        booking_date,
        status,
        booking_source,
        idempotency_key,
        check_in_time,
        created_at
    ) VALUES (
        v_booking_id,
        v_booking_code,
        p_student_id,
        p_seat_id,
        p_slot_id,
        p_booking_date,
        v_initial_status::public.booking_status,
        'walk_in',
        p_idempotency_key,
        CASE WHEN p_perform_instant_check_in THEN NOW() ELSE NULL END,
        NOW()
    );

    RETURN jsonb_build_object(
        'success', true,
        'booking_id', v_booking_id,
        'booking_code', v_booking_code,
        'seat_number', v_seat.seat_number,
        'student_name', COALESCE(v_student_name, 'Student'),
        'slot_name', COALESCE(v_slot_name, 'Slot'),
        'booking_date', p_booking_date,
        'status', v_initial_status,
        'booking_source', 'walk_in',
        'checked_in_at', CASE WHEN p_perform_instant_check_in THEN NOW() ELSE NULL END
    );
END;
$$;
