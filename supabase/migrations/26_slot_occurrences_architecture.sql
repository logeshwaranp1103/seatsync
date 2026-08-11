-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 26: SLOT OCCURRENCES ARCHITECTURE & BOOKINGS INTEGRATION
-- ====================================================================

-- 1. Ensure columns and constraints exist on public.slot_occurrences
ALTER TABLE public.slot_occurrences
    ADD COLUMN IF NOT EXISTS capacity_override INTEGER,
    ADD COLUMN IF NOT EXISTS is_booking_enabled BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cancelled_by UUID,
    ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
    ADD COLUMN IF NOT EXISTS created_by UUID;

-- Set default status to 'scheduled' if null
UPDATE public.slot_occurrences SET status = 'scheduled' WHERE status IS NULL;
ALTER TABLE public.slot_occurrences ALTER COLUMN status SET DEFAULT 'scheduled';

-- Ensure unique constraint on (library_id, room_id, slot_id, occurrence_date)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'slot_occurrences_unique_occurrence'
    ) THEN
        ALTER TABLE public.slot_occurrences
            ADD CONSTRAINT slot_occurrences_unique_occurrence 
            UNIQUE (library_id, room_id, slot_id, occurrence_date);
    END IF;
EXCEPTION WHEN OTHERS THEN
    -- Index fallback
    CREATE UNIQUE INDEX IF NOT EXISTS idx_slot_occurrences_unique ON public.slot_occurrences (library_id, room_id, slot_id, occurrence_date);
END $$;


-- 2. Add slot_occurrence_id foreign key column to public.bookings
ALTER TABLE public.bookings
    ADD COLUMN IF NOT EXISTS slot_occurrence_id UUID REFERENCES public.slot_occurrences(id);

-- Partial unique index to prevent double-booking at database level
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_active_occurrence_seat 
    ON public.bookings (slot_occurrence_id, seat_id) 
    WHERE status IN ('confirmed', 'checked_in', 'awaiting_check_in');


-- 3. Idempotent Backfill of Existing Bookings to public.slot_occurrences
INSERT INTO public.slot_occurrences (
    library_id,
    room_id,
    slot_id,
    occurrence_date,
    status,
    is_booking_enabled,
    created_at,
    updated_at
)
SELECT DISTINCT
    b.library_id,
    b.room_id,
    b.slot_id,
    b.booking_date,
    CASE 
        WHEN b.booking_date < CURRENT_DATE THEN 'completed'
        WHEN b.booking_date = CURRENT_DATE THEN 'active'
        ELSE 'scheduled'
    END AS status,
    true,
    NOW(),
    NOW()
FROM public.bookings b
WHERE b.library_id IS NOT NULL 
  AND b.room_id IS NOT NULL 
  AND b.slot_id IS NOT NULL 
  AND b.booking_date IS NOT NULL
ON CONFLICT (library_id, room_id, slot_id, occurrence_date) DO NOTHING;

-- Link existing booking rows to their corresponding slot_occurrence_id
UPDATE public.bookings b
SET slot_occurrence_id = so.id
FROM public.slot_occurrences so
WHERE b.library_id = so.library_id
  AND b.room_id = so.room_id
  AND b.slot_id = so.slot_id
  AND b.booking_date = so.occurrence_date
  AND b.slot_occurrence_id IS NULL;


-- 4. Atomic Occurrence Helper Function: ensure_slot_occurrence()
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
    DO UPDATE SET
        updated_at = NOW()
    RETURNING id INTO v_occurrence_id;

    RETURN v_occurrence_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_slot_occurrence(UUID, UUID, UUID, DATE) TO authenticated, anon;


-- 5. Atomic Booking RPC Function: create_seat_booking()
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
    v_maint_count INTEGER := 0;
    v_existing_booking_count INTEGER := 0;
    v_seat_number TEXT;
    v_slot_name TEXT;
    v_booking_code TEXT;
    v_qr_token TEXT;
    v_booking_id UUID;
    v_new_booking JSONB;
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

    IF v_profile.registration_number IS NULL OR v_profile.registration_number = '' THEN
        RAISE EXCEPTION 'Registration number is missing. Please complete your profile before booking.';
    END IF;

    -- 3. Obtain or create matching slot occurrence
    v_occurrence_id := public.ensure_slot_occurrence(p_library_id, p_room_id, p_slot_id, p_booking_date);

    -- Check if slot occurrence is cancelled or disabled
    SELECT status INTO v_occurrence_status FROM public.slot_occurrences WHERE id = v_occurrence_id;
    IF v_occurrence_status IN ('cancelled', 'disabled') THEN
        RAISE EXCEPTION 'This slot occurrence has been cancelled or disabled by an administrator.';
    END IF;

    -- 4. Check seat status and maintenance restrictions
    SELECT s.status, s.seat_number INTO v_seat_status, v_seat_number 
    FROM public.seats s 
    WHERE s.id = p_seat_id AND s.room_id = p_room_id;

    IF v_seat_status IS NULL THEN
        RAISE EXCEPTION 'Seat not found in specified room.';
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

    -- 5. Prevent student from booking multiple seats in the same slot occurrence
    SELECT COUNT(*)::INTEGER INTO v_existing_booking_count
    FROM public.bookings b
    WHERE b.student_id = v_student_id
      AND b.slot_occurrence_id = v_occurrence_id
      AND b.status IN ('confirmed', 'checked_in', 'awaiting_check_in');

    IF v_existing_booking_count > 0 THEN
        RAISE EXCEPTION 'You already have an active booking for this time slot occurrence.';
    END IF;

    -- 6. Generate Booking Code & QR Token
    v_booking_code := 'BK-' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT) FROM 1 FOR 8));
    v_qr_token := 'QR-' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || v_booking_code) FROM 1 FOR 16));

    -- 7. Insert booking atomically (caught by partial unique index if double booked)
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
            user_id,
            title,
            message,
            type,
            is_read,
            created_at
        ) VALUES (
            v_student_id,
            'Seat Reservation Confirmed',
            'Your booking for Seat ' || v_seat_number || ' (' || COALESCE(v_slot_name, 'Slot') || ') on ' || p_booking_date || ' is confirmed. Code: ' || v_booking_code,
            'booking_confirmation',
            false,
            NOW()
        );
    EXCEPTION WHEN OTHERS THEN /* non-blocking notification failure */ END;

    -- 9. Create Audit Log Entry
    BEGIN
        INSERT INTO public.audit_logs (
            actor_id,
            target_id,
            event_type,
            metadata
        ) VALUES (
            v_student_id,
            v_booking_id,
            'STUDENT_BOOKING_CREATED',
            jsonb_build_object(
                'booking_code', v_booking_code,
                'seat_number', v_seat_number,
                'slot_occurrence_id', v_occurrence_id,
                'booking_date', p_booking_date
            )
        );
    EXCEPTION WHEN OTHERS THEN /* non-blocking audit failure */ END;

    -- Return JSON payload
    SELECT jsonb_build_object(
        'success', true,
        'booking_id', b.id,
        'booking_code', b.booking_code,
        'student_id', b.student_id,
        'seat_id', b.seat_id,
        'seat_number', v_seat_number,
        'slot_id', b.slot_id,
        'slot_occurrence_id', b.slot_occurrence_id,
        'booking_date', b.booking_date,
        'status', b.status,
        'qr_token', b.qr_token,
        'created_at', b.created_at
    ) INTO v_new_booking
    FROM public.bookings b
    WHERE b.id = v_booking_id;

    RETURN v_new_booking;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_seat_booking(UUID, UUID, UUID, UUID, UUID, DATE, TEXT) TO authenticated;


-- 6. Live Occupancy RPC: get_slot_occurrence_occupancy()
DROP FUNCTION IF EXISTS public.get_slot_occurrence_occupancy CASCADE;

CREATE OR REPLACE FUNCTION public.get_slot_occurrence_occupancy(
    p_library_id UUID DEFAULT NULL,
    p_occurrence_date DATE DEFAULT NULL,
    p_room_id UUID DEFAULT NULL,
    p_slot_occurrence_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now_kolkata TIMESTAMPTZ := CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata';
    v_date DATE := COALESCE(p_occurrence_date, v_now_kolkata::DATE);
    v_occurrences_json JSONB;
BEGIN
    SELECT COALESCE(jsonb_agg(occ_data), '[]'::jsonb)
    INTO v_occurrences_json
    FROM (
        SELECT
            so.id AS slot_occurrence_id,
            so.occurrence_date,
            so.status AS occurrence_status,
            so.is_booking_enabled,
            sl.id AS slot_id,
            sl.name AS slot_name,
            sl.start_time,
            sl.end_time,
            l.id AS library_id,
            l.name AS library_name,
            r.id AS room_id,
            r.name AS room_name,
            COUNT(DISTINCT s.id)::INTEGER AS total_seats,
            COUNT(DISTINCT CASE WHEN s.status = 'maintenance' OR sm.id IS NOT NULL THEN s.id END)::INTEGER AS maintenance_seats,
            GREATEST(0, COUNT(DISTINCT CASE WHEN s.status != 'disabled' THEN s.id END) - COUNT(DISTINCT CASE WHEN s.status = 'maintenance' OR sm.id IS NOT NULL THEN s.id END))::INTEGER AS operational_seats,
            COUNT(DISTINCT CASE WHEN b.status = 'checked_in' AND b.checked_in_at IS NOT NULL AND b.checked_out_at IS NULL THEN b.seat_id END)::INTEGER AS occupied_seats,
            COUNT(DISTINCT CASE WHEN b.status IN ('confirmed', 'awaiting_check_in') AND b.checked_in_at IS NULL THEN b.seat_id END)::INTEGER AS reserved_seats,
            GREATEST(0,
                (COUNT(DISTINCT CASE WHEN s.status != 'disabled' THEN s.id END) - COUNT(DISTINCT CASE WHEN s.status = 'maintenance' OR sm.id IS NOT NULL THEN s.id END)) -
                COUNT(DISTINCT CASE WHEN b.status = 'checked_in' AND b.checked_in_at IS NOT NULL AND b.checked_out_at IS NULL THEN b.seat_id END) -
                COUNT(DISTINCT CASE WHEN b.status IN ('confirmed', 'awaiting_check_in') AND b.checked_in_at IS NULL THEN b.seat_id END)
            )::INTEGER AS available_seats,
            COUNT(DISTINCT CASE WHEN b.status IN ('confirmed', 'awaiting_check_in') AND b.checked_in_at IS NULL THEN b.seat_id END)::INTEGER AS awaiting_check_in,
            CASE 
                WHEN (COUNT(DISTINCT CASE WHEN s.status != 'disabled' THEN s.id END) - COUNT(DISTINCT CASE WHEN s.status = 'maintenance' OR sm.id IS NOT NULL THEN s.id END)) > 0 
                THEN ROUND((COUNT(DISTINCT CASE WHEN b.status = 'checked_in' AND b.checked_in_at IS NOT NULL AND b.checked_out_at IS NULL THEN b.seat_id END)::NUMERIC / 
                            (COUNT(DISTINCT CASE WHEN s.status != 'disabled' THEN s.id END) - COUNT(DISTINCT CASE WHEN s.status = 'maintenance' OR sm.id IS NOT NULL THEN s.id END))::NUMERIC) * 100, 1)
                ELSE 0 
            END AS occupancy_percentage
        FROM public.slot_occurrences so
        JOIN public.slots sl ON sl.id = so.slot_id
        JOIN public.libraries l ON l.id = so.library_id
        JOIN public.rooms r ON r.id = so.room_id
        JOIN public.seats s ON s.room_id = r.id
        LEFT JOIN public.seat_maintenance sm ON sm.seat_id = s.id AND (sm.status IS DISTINCT FROM 'Resolved' AND sm.completed_at IS NULL)
        LEFT JOIN public.bookings b ON b.slot_occurrence_id = so.id 
          AND b.seat_id = s.id 
          AND b.status IN ('confirmed', 'awaiting_check_in', 'checked_in')
        WHERE (p_library_id IS NULL OR so.library_id = p_library_id)
          AND (so.occurrence_date = v_date)
          AND (p_room_id IS NULL OR so.room_id = p_room_id)
          AND (p_slot_occurrence_id IS NULL OR so.id = p_slot_occurrence_id)
        GROUP BY so.id, so.occurrence_date, so.status, so.is_booking_enabled, sl.id, sl.name, sl.start_time, sl.end_time, l.id, l.name, r.id, r.name
        ORDER BY sl.start_time ASC, r.name ASC
    ) occ_data;

    RETURN v_occurrences_json;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_slot_occurrence_occupancy(UUID, DATE, UUID, UUID) TO authenticated, anon;


-- 7. Protected Reserved Students List RPC: get_reserved_students_for_occurrence()
DROP FUNCTION IF EXISTS public.get_reserved_students_for_occurrence CASCADE;

CREATE OR REPLACE FUNCTION public.get_reserved_students_for_occurrence(
    p_slot_occurrence_id UUID
)
RETURNS TABLE (
    booking_id UUID,
    booking_code TEXT,
    student_id UUID,
    student_name TEXT,
    registration_number TEXT,
    department TEXT,
    seat_id UUID,
    seat_number TEXT,
    booking_date DATE,
    slot_name TEXT,
    start_time TIME,
    end_time TIME,
    booking_status TEXT,
    checked_in_at TIMESTAMPTZ,
    checked_out_at TIMESTAMPTZ,
    qr_token TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Security Check: Only Librarians & Admins can access private student list
    IF NOT public.is_librarian_or_admin() THEN
        RAISE EXCEPTION 'Access denied. Reserved student list is restricted to authorized librarians and administrators.';
    END IF;

    RETURN QUERY
    SELECT
        b.id AS booking_id,
        b.booking_code,
        b.student_id,
        COALESCE(p.full_name, 'Student') AS student_name,
        COALESCE(p.registration_number, 'N/A') AS registration_number,
        COALESCE(p.department, 'N/A') AS department,
        b.seat_id,
        COALESCE(s.seat_number, 'S-01') AS seat_number,
        b.booking_date,
        COALESCE(sl.name, 'Slot') AS slot_name,
        sl.start_time,
        sl.end_time,
        CASE 
            WHEN b.status = 'checked_in' AND b.checked_out_at IS NULL THEN 'Present / Occupied'
            WHEN b.status IN ('confirmed', 'awaiting_check_in') AND b.checked_in_at IS NULL THEN 'Reserved / Awaiting Check-In'
            ELSE b.status::text
        END AS booking_status,
        b.checked_in_at,
        b.checked_out_at,
        b.qr_token
    FROM public.bookings b
    JOIN public.profiles p ON p.id = b.student_id
    JOIN public.seats s ON s.id = b.seat_id
    JOIN public.slot_occurrences so ON so.id = b.slot_occurrence_id
    JOIN public.slots sl ON sl.id = so.slot_id
    WHERE b.slot_occurrence_id = p_slot_occurrence_id
      AND b.status IN ('confirmed', 'awaiting_check_in', 'checked_in')
    ORDER BY s.seat_number ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_reserved_students_for_occurrence(UUID) TO authenticated;
