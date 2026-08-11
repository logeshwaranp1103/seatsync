-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 47: AIRTIGHT ATOMIC BOOKING ENGINE
-- ====================================================================

-- 1. Ensure Public Read Access on Metadata Tables for both authenticated and anon roles
DROP POLICY IF EXISTS "Public read seats" ON public.seats;
CREATE POLICY "Public read seats" ON public.seats FOR SELECT TO authenticated, anon USING (true);

DROP POLICY IF EXISTS "Public read slots" ON public.slots;
CREATE POLICY "Public read slots" ON public.slots FOR SELECT TO authenticated, anon USING (true);

DROP POLICY IF EXISTS "Public read rooms" ON public.rooms;
CREATE POLICY "Public read rooms" ON public.rooms FOR SELECT TO authenticated, anon USING (true);

DROP POLICY IF EXISTS "Public read floors" ON public.floors;
CREATE POLICY "Public read floors" ON public.floors FOR SELECT TO authenticated, anon USING (true);

DROP POLICY IF EXISTS "Public read libraries" ON public.libraries;
CREATE POLICY "Public read libraries" ON public.libraries FOR SELECT TO authenticated, anon USING (true);

-- 2. Drop legacy indexes
DROP INDEX IF EXISTS public.idx_unique_student_active_slot_booking;
DROP INDEX IF EXISTS public.idx_unique_active_seat_booking;
DROP INDEX IF EXISTS public.idx_bookings_active_occurrence_seat;

-- 3. STRICT UNIQUE INDEX: ONE SEAT PER DATE + SLOT
-- Guarantees that ONE seat (e.g. S-01) for ONE date and ONE time slot
-- can ONLY have ONE active reservation across ALL students.
CREATE UNIQUE INDEX idx_unique_active_seat_booking
ON public.bookings (seat_id, booking_date, slot_id)
WHERE status IN ('confirmed', 'awaiting_check_in', 'checked_in');

-- 4. STRICT UNIQUE INDEX: ONE SLOT BOOKING PER STUDENT PER DATE + SLOT
-- Guarantees that a student cannot book multiple seats in the exact same time slot on the same day.
CREATE UNIQUE INDEX idx_unique_student_active_slot_booking
ON public.bookings (student_id, booking_date, slot_id)
WHERE status IN ('confirmed', 'awaiting_check_in', 'checked_in');

-- 5. Partial Unique Index on public.bookings (slot_occurrence_id, seat_id)
CREATE UNIQUE INDEX idx_bookings_active_occurrence_seat 
ON public.bookings (slot_occurrence_id, seat_id) 
WHERE slot_occurrence_id IS NOT NULL 
  AND status IN ('confirmed', 'awaiting_check_in', 'checked_in');

-- 6. Atomic Helper: ensure_slot_occurrence
CREATE OR REPLACE FUNCTION public.ensure_slot_occurrence(
    p_library_id UUID,
    p_room_id UUID,
    p_slot_id UUID,
    p_occurrence_date DATE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_occurrence_id UUID;
    v_status TEXT;
BEGIN
    v_status := CASE 
        WHEN p_occurrence_date < CURRENT_DATE THEN 'completed'
        WHEN p_occurrence_date = CURRENT_DATE THEN 'active'
        ELSE 'scheduled'
    END;

    INSERT INTO public.slot_occurrences (
        library_id,
        room_id,
        slot_id,
        occurrence_date,
        status,
        is_booking_enabled,
        created_at,
        updated_at
    ) VALUES (
        p_library_id,
        p_room_id,
        p_slot_id,
        p_occurrence_date,
        v_status,
        true,
        NOW(),
        NOW()
    )
    ON CONFLICT (library_id, room_id, slot_id, occurrence_date) 
    DO UPDATE SET updated_at = NOW()
    RETURNING id INTO v_occurrence_id;

    RETURN v_occurrence_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_slot_occurrence(UUID, UUID, UUID, DATE) TO authenticated, anon;

-- 7. Atomic Booking RPC: create_seat_booking
DROP FUNCTION IF EXISTS public.create_seat_booking CASCADE;

CREATE OR REPLACE FUNCTION public.create_seat_booking(
    p_library_id UUID,
    p_floor_id UUID,
    p_room_id UUID,
    p_seat_id UUID,
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
    v_profile public.profiles%ROWTYPE;
    v_occurrence_id UUID;
    v_occurrence_status TEXT;
    v_seat_status TEXT;
    v_seat_gender_group TEXT;
    v_maint_count INTEGER := 0;
    v_existing_booking_count INTEGER := 0;
    v_seat_number TEXT;
    v_slot_name TEXT;
    v_booking_code TEXT;
    v_qr_token TEXT;
    v_booking_id UUID;
BEGIN
    -- 1. Validate authenticated user
    IF v_student_id IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated request. Please sign in.';
    END IF;

    -- 2. Fetch student profile & permissions
    SELECT * INTO v_profile FROM public.profiles WHERE id = v_student_id;
    IF v_profile.id IS NULL THEN
        RAISE EXCEPTION 'User profile not found. Please complete your registration.';
    END IF;

    IF v_profile.status = 'blocked' THEN
        RAISE EXCEPTION 'Your SeatSync account is blocked. Please contact the library administrator.';
    END IF;

    IF v_profile.status = 'suspended' THEN
        RAISE EXCEPTION 'Your SeatSync account is suspended. Access temporarily restricted.';
    END IF;

    IF v_profile.role != 'student' THEN
        RAISE EXCEPTION 'Only students can create seat bookings.';
    END IF;

    -- 3. Obtain or create matching slot occurrence
    v_occurrence_id := public.ensure_slot_occurrence(p_library_id, p_room_id, p_slot_id, p_booking_date);

    -- Check if slot occurrence is cancelled or disabled
    SELECT status INTO v_occurrence_status FROM public.slot_occurrences WHERE id = v_occurrence_id;
    IF v_occurrence_status IN ('cancelled', 'disabled') THEN
        RAISE EXCEPTION 'This slot occurrence has been cancelled or disabled by an administrator.';
    END IF;

    -- 4. Check seat status, gender group, and maintenance restrictions
    SELECT s.status, s.seat_number, s.gender_group INTO v_seat_status, v_seat_number, v_seat_gender_group
    FROM public.seats s 
    WHERE s.id = p_seat_id;

    IF v_seat_status IS NULL THEN
        RAISE EXCEPTION 'Seat not found in database.';
    END IF;

    IF v_seat_status IN ('disabled', 'inactive') THEN
        RAISE EXCEPTION 'Seat % is currently disabled.', v_seat_number;
    END IF;

    SELECT COUNT(*)::INTEGER INTO v_maint_count
    FROM public.seat_maintenance sm
    WHERE sm.seat_id = p_seat_id 
      AND (sm.status IS DISTINCT FROM 'Resolved' AND sm.completed_at IS NULL);

    IF v_seat_status = 'maintenance' OR v_maint_count > 0 THEN
        RAISE EXCEPTION 'Seat % is currently under maintenance.', v_seat_number;
    END IF;

    -- Enforce student gender vs seat gender group
    IF v_profile.gender IS NOT NULL AND v_seat_gender_group IS NOT NULL THEN
        IF (LOWER(v_profile.gender) IN ('female', 'girls', 'girl') AND LOWER(v_seat_gender_group) NOT IN ('female', 'girls', 'girl')) OR
           (LOWER(v_profile.gender) NOT IN ('female', 'girls', 'girl') AND LOWER(v_seat_gender_group) IN ('female', 'girls', 'girl')) THEN
            RAISE EXCEPTION 'Seat % is not allocated to your group.', v_seat_number;
        END IF;
    END IF;

    -- 5. Prevent student from booking multiple seats in the same date & slot
    SELECT COUNT(*)::INTEGER INTO v_existing_booking_count
    FROM public.bookings b
    WHERE b.student_id = v_student_id
      AND b.booking_date = p_booking_date
      AND b.slot_id = p_slot_id
      AND b.status IN ('confirmed', 'checked_in', 'awaiting_check_in');

    IF v_existing_booking_count > 0 THEN
        RAISE EXCEPTION 'You already have an active booking for this time slot.';
    END IF;

    -- 6. Generate Booking Code & QR Token
    v_booking_code := 'BK-' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT) FROM 1 FOR 8));
    v_qr_token := 'QR-' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || v_booking_code) FROM 1 FOR 16));

    -- 7. Insert booking atomically into public.bookings & public.slot_occurrences
    -- (Caught by partial unique index idx_unique_active_seat_booking if double booked)
    BEGIN
        INSERT INTO public.bookings (
            booking_code,
            student_id,
            library_id,
            floor_id,
            room_id,
            seat_id,
            slot_id,
            slot_occurrence_id,
            booking_date,
            status,
            booking_source,
            qr_token,
            idempotency_key,
            created_at,
            updated_at
        ) VALUES (
            v_booking_code,
            v_student_id,
            p_library_id,
            p_floor_id,
            p_room_id,
            p_seat_id,
            p_slot_id,
            v_occurrence_id,
            p_booking_date,
            'confirmed',
            'online',
            v_qr_token,
            p_idempotency_key,
            NOW(),
            NOW()
        )
        RETURNING id INTO v_booking_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'This seat was just reserved by another student. Please select another seat.';
    END;

    -- Fetch slot name for response
    SELECT name INTO v_slot_name FROM public.slots WHERE id = p_slot_id;

    -- 8. Create Notification for Student
    BEGIN
        INSERT INTO public.notifications (
            recipient_id,
            type,
            title,
            message,
            is_read,
            created_at
        ) VALUES (
            v_student_id,
            'booking_confirmation',
            'Seat Reservation Confirmed',
            'Your booking for Seat ' || v_seat_number || ' (' || COALESCE(v_slot_name, 'Slot') || ') on ' || p_booking_date || ' is confirmed. Code: ' || v_booking_code,
            false,
            NOW()
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    RETURN jsonb_build_object(
        'success', true,
        'booking_id', v_booking_id,
        'booking_code', v_booking_code,
        'qr_token', v_qr_token,
        'seat_number', v_seat_number,
        'slot_name', COALESCE(v_slot_name, 'Slot'),
        'booking_date', p_booking_date,
        'message', 'Seat reserved successfully.'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_seat_booking(UUID, UUID, UUID, UUID, UUID, DATE, TEXT) TO authenticated, anon;
