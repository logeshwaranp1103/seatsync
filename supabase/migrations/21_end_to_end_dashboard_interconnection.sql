-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 21: END-TO-END DASHBOARD INTERCONNECTION & SUPABASE PERSISTENCE REPAIR
-- ====================================================================

-- 1. AUTH-TO-PROFILE TRIGGER & REPAIR FUNCTION
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    full_name,
    email,
    registration_number,
    role,
    status,
    no_show_count,
    created_at,
    updated_at
  ) VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'registration_number', NEW.raw_user_meta_data->>'college_id', '24AD042'),
    'student', -- Default role for self-registered accounts
    'active',
    0,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    updated_at = NOW();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Backfill missing profile rows for existing auth.users
INSERT INTO public.profiles (id, full_name, email, registration_number, role, status, created_at, updated_at)
SELECT 
  u.id,
  COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
  u.email,
  COALESCE(u.raw_user_meta_data->>'registration_number', u.raw_user_meta_data->>'college_id', '24AD042'),
  'student',
  'active',
  NOW(),
  NOW()
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;


-- 2. SCHEMA COLUMN SANITY & IDEMPOTENCY TABLE
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS qr_token TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS booking_source TEXT DEFAULT 'online';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS checked_in_by UUID;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS checked_out_at TIMESTAMPTZ;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS checked_out_by UUID;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

CREATE TABLE IF NOT EXISTS public.idempotency_keys (
    idempotency_key TEXT PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id),
    action TEXT NOT NULL,
    response_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);


-- 3. CANONICAL BOOKING CONSTRAINTS & PARTIAL UNIQUE INDEXES
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_seat_booking
ON public.bookings(seat_id, slot_id, booking_date)
WHERE status IN ('confirmed', 'checked_in', 'awaiting_check_in');

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_student_booking
ON public.bookings(student_id, slot_id, booking_date)
WHERE status IN ('confirmed', 'checked_in', 'awaiting_check_in');


-- 3. ATOMIC STUDENT BOOKING RPC (SECURITY DEFINER)
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
    v_student_id UUID;
    v_student_role TEXT;
    v_student_status TEXT;
    v_student_name TEXT;
    v_student_reg TEXT;
    v_student_email TEXT;
    
    v_seat_status TEXT;
    v_allocation_mode TEXT;
    v_seat_number TEXT;
    v_room_name TEXT;
    v_library_name TEXT;
    v_slot_name TEXT;
    v_slot_start TIME;
    v_slot_end TIME;
    
    v_existing_booking_id UUID;
    v_new_booking_id UUID;
    v_booking_code TEXT;
    v_response JSONB;
BEGIN
    -- Step 1: Validate session context
    v_student_id := auth.uid();
    IF v_student_id IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED: Authenticated session is required to create a booking.';
    END IF;

    -- Step 2: Idempotency Key Lock Check
    IF p_idempotency_key IS NOT NULL THEN
        SELECT response_payload INTO v_response
        FROM public.idempotency_keys
        WHERE idempotency_key = p_idempotency_key;

        IF v_response IS NOT NULL THEN
            RETURN v_response;
        END IF;
    END IF;

    -- Step 3: Validate student profile & status
    SELECT role, status, full_name, registration_number, email
    INTO v_student_role, v_student_status, v_student_name, v_student_reg, v_student_email
    FROM public.profiles
    WHERE id = v_student_id;

    IF v_student_status = 'restricted' OR v_student_status = 'suspended' THEN
        RAISE EXCEPTION 'ACCOUNT_BLOCKED: Student account is restricted from creating bookings due to policy violation.';
    END IF;

    -- Step 4: Validate Seat & Allocation Mode
    SELECT status, allocation_mode, seat_number
    INTO v_seat_status, v_allocation_mode, v_seat_number
    FROM public.seats
    WHERE id = p_seat_id
    FOR UPDATE;

    IF v_seat_status = 'maintenance' THEN
        RAISE EXCEPTION 'SEAT_MAINTENANCE: Seat % is currently under maintenance.', v_seat_number;
    END IF;

    IF v_allocation_mode = 'walk_in_only' THEN
        RAISE EXCEPTION 'WALK_IN_ONLY_SEAT: Seat % is reserved exclusively for desk walk-in allocation.', v_seat_number;
    END IF;

    -- Step 5: Check Student Overlap in same slot & date
    SELECT id INTO v_existing_booking_id
    FROM public.bookings
    WHERE student_id = v_student_id
      AND slot_id = p_slot_id
      AND booking_date = p_booking_date
      AND status IN ('confirmed', 'checked_in', 'awaiting_check_in')
    LIMIT 1;

    IF v_existing_booking_id IS NOT NULL THEN
        RAISE EXCEPTION 'STUDENT_OVERLAP: You already have an active reservation for this slot on %.', p_booking_date;
    END IF;

    -- Step 6: Check Seat Concurrent Double Booking
    SELECT id INTO v_existing_booking_id
    FROM public.bookings
    WHERE seat_id = p_seat_id
      AND slot_id = p_slot_id
      AND booking_date = p_booking_date
      AND status IN ('confirmed', 'checked_in', 'awaiting_check_in')
    LIMIT 1;

    IF v_existing_booking_id IS NOT NULL THEN
        RAISE EXCEPTION 'SEAT_ALREADY_BOOKED: Seat % is already reserved for this slot.', v_seat_number;
    END IF;

    -- Step 7: Resolve Labels & Slot Details
    SELECT name, start_time, end_time INTO v_slot_name, v_slot_start, v_slot_end FROM public.slots WHERE id = p_slot_id;
    SELECT name INTO v_room_name FROM public.rooms WHERE id = p_room_id;
    SELECT name INTO v_library_name FROM public.libraries WHERE id = p_library_id;

    v_booking_code := 'BK-' || UPPER(SUBSTRING(MD5(RANDOM()::text) FROM 1 FOR 6));

    -- Step 8: Commit Booking Record
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
        idempotency_key,
        created_at
    ) VALUES (
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
        p_idempotency_key,
        NOW()
    )
    RETURNING id INTO v_new_booking_id;

    -- Step 9: Transactional Notification Outbox
    INSERT INTO public.notification_outbox (
        recipient_id,
        type,
        title,
        message,
        priority,
        payload
    ) VALUES (
        v_student_id,
        'BOOKING_CONFIRMED',
        'Seat Reservation Confirmed',
        'Your reservation for seat ' || v_seat_number || ' on ' || p_booking_date || ' (' || v_slot_name || ') has been confirmed.',
        'NORMAL',
        jsonb_build_object('booking_id', v_new_booking_id, 'seat_number', v_seat_number)
    );

    v_response := jsonb_build_object(
        'success', true,
        'booking_id', v_new_booking_id,
        'booking_code', v_booking_code,
        'student_id', v_student_id,
        'student_name', v_student_name,
        'student_registration_number', v_student_reg,
        'seat_id', p_seat_id,
        'seat_number', v_seat_number,
        'room_name', v_room_name,
        'library_name', v_library_name,
        'slot_id', p_slot_id,
        'slot_name', v_slot_name,
        'booking_date', p_booking_date,
        'status', 'confirmed',
        'booking_source', p_booking_source,
        'created_at', NOW()
    );

    -- Step 10: Store Idempotency Response
    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO public.idempotency_keys (idempotency_key, user_id, action, response_payload)
        VALUES (p_idempotency_key, v_student_id, 'create_booking', v_response)
        ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    RETURN v_response;
END;
$$;


-- 4. OPERATIONAL JOINED BOOKINGS RPC FOR STAFF & ADMIN
CREATE OR REPLACE FUNCTION public.get_operational_bookings(
    p_library_id UUID DEFAULT NULL,
    p_booking_date DATE DEFAULT NULL,
    p_slot_id UUID DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    booking_code TEXT,
    student_id UUID,
    student_name TEXT,
    student_registration_number TEXT,
    student_email TEXT,
    library_id UUID,
    library_name TEXT,
    room_id UUID,
    room_name TEXT,
    seat_id UUID,
    seat_number TEXT,
    slot_id UUID,
    slot_name TEXT,
    start_time TIME,
    end_time TIME,
    booking_date DATE,
    booking_source TEXT,
    status TEXT,
    created_at TIMESTAMPTZ,
    checked_in_at TIMESTAMPTZ,
    checked_out_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        b.id,
        b.booking_code,
        b.student_id,
        COALESCE(p.full_name, 'Student') AS student_name,
        COALESCE(p.registration_number, '24AD042') AS student_registration_number,
        COALESCE(p.email, '') AS student_email,
        b.library_id,
        COALESCE(l.name, 'Main Library') AS library_name,
        b.room_id,
        COALESCE(r.name, 'Quiet Reading Room') AS room_name,
        b.seat_id,
        COALESCE(s.seat_number, 'S-01') AS seat_number,
        b.slot_id,
        COALESCE(sl.name, 'Slot') AS slot_name,
        sl.start_time,
        sl.end_time,
        b.booking_date,
        b.booking_source,
        b.status,
        b.created_at,
        b.checked_in_at,
        b.checked_out_at
    FROM public.bookings b
    LEFT JOIN public.profiles p ON p.id = b.student_id
    LEFT JOIN public.seats s ON s.id = b.seat_id
    LEFT JOIN public.rooms r ON r.id = b.room_id
    LEFT JOIN public.libraries l ON l.id = b.library_id
    LEFT JOIN public.slots sl ON sl.id = b.slot_id
    WHERE (p_library_id IS NULL OR b.library_id = p_library_id)
      AND (p_booking_date IS NULL OR b.booking_date = p_booking_date)
      AND (p_slot_id IS NULL OR b.slot_id = p_slot_id)
    ORDER BY b.created_at DESC;
END;
$$;


-- 5. REALTIME PUBLICATION CONFIGURATION
DO $$
BEGIN
    -- Safely add tables to supabase_realtime publication
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.seats;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.waitlist_entries;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.seat_maintenance;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.notification_outbox;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.slot_occurrences;
    END IF;
EXCEPTION WHEN OTHERS THEN
    -- Ignore duplicate table addition errors
    NULL;
END;
$$;
