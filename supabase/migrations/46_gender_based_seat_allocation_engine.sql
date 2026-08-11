-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 46: GENDER-BASED SEAT ALLOCATION & ACCESS CONTROL
-- ====================================================================

-- 1. ADD COLUMN gender_group TO public.seats WITH CONTROLLED VALUE CONSTRAINT
ALTER TABLE public.seats 
ADD COLUMN IF NOT EXISTS gender_group TEXT NOT NULL DEFAULT 'boys';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'seats_gender_group_check'
    ) THEN
        ALTER TABLE public.seats 
        ADD CONSTRAINT seats_gender_group_check 
        CHECK (gender_group IN ('boys', 'girls'));
    END IF;
END $$;

-- 2. ADD COLUMN gender TO public.profiles WITH CONTROLLED VALUE CONSTRAINT
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS gender TEXT DEFAULT 'boys';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'profiles_gender_check'
    ) THEN
        ALTER TABLE public.profiles 
        ADD CONSTRAINT profiles_gender_check 
        CHECK (gender IN ('boys', 'girls', 'male', 'female'));
    END IF;
END $$;

-- Normalize any NULL or invalid values
UPDATE public.seats 
SET gender_group = 'boys' 
WHERE gender_group IS NULL OR gender_group NOT IN ('boys', 'girls');

UPDATE public.profiles 
SET gender = 'boys' 
WHERE gender IS NULL OR gender NOT IN ('boys', 'girls', 'male', 'female');

-- Index for high-performance seat filtering by gender group
CREATE INDEX IF NOT EXISTS idx_seats_gender_group ON public.seats(gender_group);
CREATE INDEX IF NOT EXISTS idx_profiles_gender ON public.profiles(gender);


-- 3. ADMIN RPC: UPDATE SEAT GENDER GROUP WITH ACTIVE ALLOCATION CHECK
CREATE OR REPLACE FUNCTION public.update_seat_gender_group(
    p_seat_id UUID,
    p_gender_group TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_caller_role TEXT;
    v_clean_group TEXT := LOWER(TRIM(p_gender_group));
    v_seat_number TEXT;
    v_active_booking_count INTEGER := 0;
BEGIN
    -- Check caller authorization
    IF v_caller_id IS NOT NULL THEN
        SELECT LOWER(role::text) INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;
        IF v_caller_role NOT IN ('admin', 'super_admin', 'librarian', 'senior_librarian') THEN
            RETURN jsonb_build_object(
                'success', false,
                'status_code', 'NOT_AUTHORIZED',
                'message', 'Admin or Librarian privileges required.'
            );
        END IF;
    END IF;

    -- Validate input gender group
    IF v_clean_group NOT IN ('boys', 'girls') THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'INVALID_GENDER_GROUP',
            'message', 'Gender group must be either "boys" or "girls".'
        );
    END IF;

    -- Get seat number
    SELECT seat_number INTO v_seat_number FROM public.seats WHERE id = p_seat_id;
    IF v_seat_number IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'SEAT_NOT_FOUND',
            'message', 'Seat not found.'
        );
    END IF;

    -- Check for active bookings/reservations/occupancies for this seat
    SELECT COUNT(*) INTO v_active_booking_count
    FROM public.bookings
    WHERE seat_id = p_seat_id
      AND booking_date >= CURRENT_DATE
      AND status IN ('confirmed', 'awaiting_check_in', 'checked_in', 'active', 'checkout_pending');

    IF v_active_booking_count > 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'ACTIVE_ALLOCATION_CONFLICT',
            'message', format('Seat %s has an active allocation and cannot be reassigned until it is resolved.', v_seat_number)
        );
    END IF;

    -- Update seat group
    UPDATE public.seats
    SET gender_group = v_clean_group,
        updated_at = NOW()
    WHERE id = p_seat_id;

    RETURN jsonb_build_object(
        'success', true,
        'status_code', 'SUCCESS',
        'message', format('Seat %s successfully reassigned to %s.', v_seat_number, UPPER(v_clean_group)),
        'seat_id', p_seat_id,
        'gender_group', v_clean_group
    );
END;
$$;


-- 4. ADMIN RPC: BULK UPDATE SEAT GENDER GROUPS
CREATE OR REPLACE FUNCTION public.bulk_update_seat_gender_group(
    p_seat_ids UUID[],
    p_gender_group TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clean_group TEXT := LOWER(TRIM(p_gender_group));
    v_seat_id UUID;
    v_updated_count INTEGER := 0;
    v_conflict_count INTEGER := 0;
    v_single_res JSONB;
BEGIN
    IF v_clean_group NOT IN ('boys', 'girls') THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Gender group must be either "boys" or "girls".'
        );
    END IF;

    FOREACH v_seat_id IN ARRAY p_seat_ids LOOP
        v_single_res := public.update_seat_gender_group(v_seat_id, v_clean_group);
        IF (v_single_res->>'success')::boolean THEN
            v_updated_count := v_updated_count + 1;
        ELSE
            v_conflict_count := v_conflict_count + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'updated_count', v_updated_count,
        'conflict_count', v_conflict_count,
        'message', format('Successfully updated %s seats to %s (%s skipped due to active allocations).', v_updated_count, UPPER(v_clean_group), v_conflict_count)
    );
END;
$$;


-- 5. UPDATE create_seat_booking RPC WITH GENDER VALIDATION
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
    v_seat RECORD;
    v_occurrence_id UUID;
    v_occurrence_status TEXT;
    v_seat_status TEXT;
    v_seat_gender_group TEXT;
    v_student_gender_group TEXT;
    v_existing_booking_count INTEGER := 0;
    v_seat_number TEXT;
    v_slot_name TEXT;
    v_booking_code TEXT;
    v_qr_token TEXT;
    v_booking_id UUID;
BEGIN
    IF v_student_id IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated request. Please sign in.';
    END IF;

    SELECT * INTO v_profile FROM public.profiles WHERE id = v_student_id;
    IF v_profile.id IS NULL THEN
        RAISE EXCEPTION 'User profile not found. Please complete your profile.';
    END IF;

    IF COALESCE(v_profile.status, 'active') IN ('blocked', 'suspended') THEN
        RAISE EXCEPTION 'Account restricted. You cannot book seats at this time.';
    END IF;

    -- Normalize student gender group
    IF LOWER(COALESCE(v_profile.gender, 'boys')) IN ('female', 'girls', 'girl') THEN
        v_student_gender_group := 'girls';
    ELSE
        v_student_gender_group := 'boys';
    END IF;

    -- Fetch seat record & gender group
    SELECT status, seat_number, gender_group INTO v_seat FROM public.seats WHERE id = p_seat_id;
    IF v_seat.status IS NULL THEN
        RAISE EXCEPTION 'Selected seat does not exist.';
    END IF;

    IF v_seat.status = 'maintenance' THEN
        RAISE EXCEPTION 'Seat % is currently under maintenance.', v_seat.seat_number;
    END IF;

    v_seat_gender_group := LOWER(COALESCE(v_seat.gender_group, 'boys'));

    -- CORE RULE SECURITY ENFORCEMENT: GENDER MATCH CHECK
    IF v_seat_gender_group != v_student_gender_group THEN
        RAISE EXCEPTION 'This seat is not allocated to your group.';
    END IF;

    -- Ensure slot occurrence exists
    v_occurrence_id := public.ensure_slot_occurrence(p_library_id, p_room_id, p_slot_id, p_booking_date);
    
    SELECT status INTO v_occurrence_status FROM public.slot_occurrences WHERE id = v_occurrence_id;
    IF v_occurrence_status = 'cancelled' THEN
        RAISE EXCEPTION 'This slot is cancelled by the administrator for the selected date.';
    END IF;

    -- Verify no double booking for same student on same slot and date
    SELECT COUNT(*) INTO v_existing_booking_count
    FROM public.bookings
    WHERE student_id = v_student_id
      AND booking_date = p_booking_date
      AND (slot_id = p_slot_id OR slot_occurrence_id = v_occurrence_id)
      AND status IN ('confirmed', 'checked_in', 'awaiting_check_in');

    IF v_existing_booking_count > 0 THEN
        RAISE EXCEPTION 'You already hold an active reservation for this time slot.';
    END IF;

    -- Generate codes and secure QR token
    v_booking_code := 'BK-' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || CLOCK_TIMESTAMP()::TEXT) FROM 1 FOR 8));
    v_qr_token := 'QR-' || UPPER(SUBSTRING(MD5(GEN_RANDOM_UUID()::TEXT || CLOCK_TIMESTAMP()::TEXT) FROM 1 FOR 16));

    SELECT name INTO v_slot_name FROM public.slots WHERE id = p_slot_id;

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
    ) RETURNING id INTO v_booking_id;

    RETURN jsonb_build_object(
        'success', true,
        'id', v_booking_id,
        'booking_code', v_booking_code,
        'student_id', v_student_id,
        'student_name', v_profile.full_name,
        'student_email', v_profile.email,
        'seat_id', p_seat_id,
        'seat_number', v_seat.seat_number,
        'seat_gender_group', v_seat_gender_group,
        'slot_id', p_slot_id,
        'slot_name', v_slot_name,
        'booking_date', p_booking_date,
        'status', 'confirmed',
        'qr_token', v_qr_token,
        'created_at', NOW()
    );
END;
$$;


-- 6. UPDATE allocate_walk_in_seat RPC WITH GENDER VALIDATION
CREATE OR REPLACE FUNCTION public.allocate_walk_in_seat(
    p_student_id UUID,
    p_seat_id TEXT,
    p_slot_occurrence_id UUID DEFAULT NULL,
    p_slot_id TEXT DEFAULT NULL,
    p_booking_date DATE DEFAULT NULL,
    p_instant_check_in BOOLEAN DEFAULT TRUE,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_staff_id UUID := auth.uid();
    v_staff_profile RECORD;
    v_student RECORD;
    v_seat RECORD;
    v_occurrence RECORD;
    v_slot RECORD;
    v_room RECORD;
    v_floor RECORD;
    v_library RECORD;
    v_occurrence_id UUID := p_slot_occurrence_id;
    v_target_date DATE := COALESCE(p_booking_date, CURRENT_DATE);
    v_target_slot_id UUID;
    v_target_seat_id UUID;
    v_existing_booking_count INTEGER := 0;
    v_booking_code TEXT;
    v_qr_token TEXT;
    v_booking_id UUID;
    v_student_gender_group TEXT;
    v_seat_gender_group TEXT;
    v_result JSONB;
BEGIN
    -- 1. Validate Authenticated Staff/Librarian User
    IF v_staff_id IS NULL THEN
        SELECT id, full_name, role, status INTO v_staff_profile 
        FROM public.profiles 
        WHERE LOWER(role::text) IN ('librarian', 'senior_librarian', 'admin', 'super_admin') 
        LIMIT 1;
        
        IF v_staff_profile.id IS NOT NULL THEN
            v_staff_id := v_staff_profile.id;
        ELSE
            RETURN jsonb_build_object(
                'success', false,
                'status_code', 'STAFF_NOT_AUTHORIZED',
                'message', 'Staff authentication required.'
            );
        END IF;
    ELSE
        SELECT id, full_name, role, status INTO v_staff_profile 
        FROM public.profiles 
        WHERE id = v_staff_id;
    END IF;

    -- 2. Validate Student Profile & Gender Group
    SELECT * INTO v_student FROM public.profiles WHERE id = p_student_id;
    IF v_student.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'STUDENT_NOT_FOUND',
            'message', 'No active student profile found.'
        );
    END IF;

    IF LOWER(v_student.role::text) != 'student' OR COALESCE(v_student.status, 'active') IN ('blocked', 'suspended') THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'STUDENT_BLOCKED',
            'message', 'Student account is suspended or blocked.'
        );
    END IF;

    IF LOWER(COALESCE(v_student.gender, 'boys')) IN ('female', 'girls', 'girl') THEN
        v_student_gender_group := 'girls';
    ELSE
        v_student_gender_group := 'boys';
    END IF;

    -- 3. Resolve & Lock Seat Record
    SELECT * INTO v_seat FROM public.seats 
    WHERE id::text = p_seat_id OR UPPER(seat_number) = UPPER(p_seat_id)
    LIMIT 1;

    IF v_seat.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'SEAT_NOT_FOUND',
            'message', 'Specified seat not found.'
        );
    END IF;

    v_target_seat_id := v_seat.id;
    v_seat_gender_group := LOWER(COALESCE(v_seat.gender_group, 'boys'));

    -- CORE RULE SECURITY ENFORCEMENT: WALK-IN GENDER MATCH CHECK
    IF v_seat_gender_group != v_student_gender_group THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'GENDER_MISMATCH',
            'message', 'This seat is not allocated to the selected student''s group.'
        );
    END IF;

    -- Resolve room, floor, library
    SELECT * INTO v_room FROM public.rooms WHERE id = v_seat.room_id;
    SELECT * INTO v_floor FROM public.floors WHERE id = v_room.floor_id;
    SELECT * INTO v_library FROM public.libraries WHERE id = v_room.library_id;

    -- Resolve Slot ID
    IF p_slot_id IS NOT NULL THEN
        SELECT id INTO v_target_slot_id FROM public.slots WHERE id::text = p_slot_id OR name = p_slot_id LIMIT 1;
    END IF;

    IF v_target_slot_id IS NULL THEN
        SELECT id INTO v_target_slot_id FROM public.slots WHERE library_id = v_library.id LIMIT 1;
    END IF;

    -- Ensure Slot Occurrence
    IF v_occurrence_id IS NULL THEN
        v_occurrence_id := public.ensure_slot_occurrence(v_library.id, v_room.id, v_target_slot_id, v_target_date);
    END IF;

    -- Check seat conflicts
    SELECT COUNT(*) INTO v_existing_booking_count
    FROM public.bookings
    WHERE seat_id = v_target_seat_id
      AND booking_date = v_target_date
      AND (slot_id = v_target_slot_id OR slot_occurrence_id = v_occurrence_id)
      AND status IN ('confirmed', 'checked_in', 'awaiting_check_in');

    IF v_existing_booking_count > 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 'SEAT_ALREADY_BOOKED',
            'message', format('Seat %s is already allocated for this time slot.', v_seat.seat_number)
        );
    END IF;

    -- Generate Codes
    v_booking_code := 'BK-' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || CLOCK_TIMESTAMP()::TEXT) FROM 1 FOR 8));
    v_qr_token := 'QR-' || UPPER(SUBSTRING(MD5(GEN_RANDOM_UUID()::TEXT || CLOCK_TIMESTAMP()::TEXT) FROM 1 FOR 16));

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
        checked_in_at,
        created_by,
        is_cancellable,
        idempotency_key,
        created_at,
        updated_at
    ) VALUES (
        v_booking_code,
        v_student.id,
        v_library.id,
        v_floor.id,
        v_room.id,
        v_target_seat_id,
        v_target_slot_id,
        v_occurrence_id,
        v_target_date,
        CASE WHEN p_instant_check_in THEN 'checked_in' ELSE 'confirmed' END,
        'librarian_walk_in',
        v_qr_token,
        CASE WHEN p_instant_check_in THEN NOW() ELSE NULL END,
        v_staff_id,
        FALSE,
        p_idempotency_key,
        NOW(),
        NOW()
    ) RETURNING id INTO v_booking_id;

    RETURN jsonb_build_object(
        'success', true,
        'status_code', 'SUCCESS',
        'message', format('Walk-In seat %s allocated successfully.', v_seat.seat_number),
        'booking', jsonb_build_object(
            'id', v_booking_id,
            'booking_code', v_booking_code,
            'student_id', v_student.id,
            'student_name', v_student.full_name,
            'registration_number', v_student.registration_number,
            'department', v_student.department,
            'seat_id', v_target_seat_id,
            'seat_number', v_seat.seat_number,
            'seat_gender_group', v_seat_gender_group,
            'room_name', v_room.name,
            'floor_name', v_floor.name,
            'library_name', v_library.name,
            'booking_date', v_target_date,
            'status', CASE WHEN p_instant_check_in THEN 'checked_in' ELSE 'confirmed' END,
            'checked_in_at', CASE WHEN p_instant_check_in THEN NOW() ELSE NULL END,
            'created_at', NOW()
        )
    );
END;
$$;


-- 7. DATABASE-LEVEL RLS POLICY FOR SEATS: GENDER VISIBILITY ENFORCEMENT
DROP POLICY IF EXISTS "Authenticated active users can read seats" ON public.seats;
DROP POLICY IF EXISTS "Gender filtered seat visibility for active users" ON public.seats;

CREATE POLICY "Gender filtered seat visibility for active users"
ON public.seats FOR SELECT TO authenticated
USING (
    public.is_librarian_or_admin()
    OR (
        public.is_active_user() AND (
            gender_group IS NULL OR
            LOWER(gender_group) = CASE 
                WHEN LOWER(COALESCE((SELECT gender FROM public.profiles WHERE id = auth.uid()), 'boys')) IN ('female', 'girls', 'girl') THEN 'girls'
                ELSE 'boys'
            END
        )
    )
);


-- 8. UPDATE get_live_seat_statuses RPC TO RETURN gender_group
CREATE OR REPLACE FUNCTION public.get_live_seat_statuses(
    p_room_id UUID DEFAULT NULL,
    p_slot_id UUID DEFAULT NULL,
    p_booking_date DATE DEFAULT NULL,
    p_library_id UUID DEFAULT NULL,
    p_floor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now_kolkata TIMESTAMPTZ := CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata';
    v_date DATE := COALESCE(p_booking_date, v_now_kolkata::DATE);
    v_slot_id UUID := p_slot_id;
    v_matched_slot_ids UUID[];
    v_seats_json JSONB;
BEGIN
    IF v_slot_id IS NOT NULL THEN
        SELECT ARRAY_AGG(id) INTO v_matched_slot_ids
        FROM public.slots
        WHERE name = (SELECT name FROM public.slots WHERE id = v_slot_id);
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'seat_id', seat_data.id,
            'seat_number', seat_data.seat_number,
            'seat_type', COALESCE(seat_data.seat_type, 'Standard'),
            'gender_group', COALESCE(seat_data.gender_group, 'boys'),
            'has_power_socket', COALESCE(seat_data.has_power_socket, true),
            'is_accessible', COALESCE(seat_data.is_accessible, false),
            'status', seat_data.computed_status,
            'color', CASE seat_data.computed_status
                WHEN 'occupied' THEN '#EF4444'
                WHEN 'reserved' THEN '#F59E0B'
                WHEN 'available' THEN '#22C55E'
                ELSE '#94A3B8'
            END,
            'booking', CASE WHEN seat_data.booking_id IS NOT NULL THEN jsonb_build_object(
                'id', seat_data.booking_id,
                'booking_code', seat_data.booking_code,
                'status', seat_data.booking_status,
                'checked_in_at', seat_data.checked_in_at,
                'student_name', COALESCE(seat_data.full_name, 'Student'),
                'registration_number', COALESCE(seat_data.registration_number, 'N/A')
            ) ELSE NULL END,
            'maintenance', CASE WHEN seat_data.maint_id IS NOT NULL THEN jsonb_build_object(
                'id', seat_data.maint_id,
                'category', seat_data.maint_category,
                'reason', seat_data.maint_reason,
                'priority', seat_data.maint_priority,
                'status', seat_data.maint_status,
                'started_at', seat_data.maint_started_at
            ) ELSE NULL END
        ) ORDER BY seat_data.seat_number
    ), '[]'::jsonb)
    INTO v_seats_json
    FROM (
        SELECT 
            s.id,
            s.seat_number,
            s.seat_type,
            s.gender_group,
            s.has_power_socket,
            s.is_accessible,
            b.id AS booking_id,
            b.booking_code,
            b.status AS booking_status,
            b.checked_in_at,
            p.full_name,
            p.registration_number,
            sm.id AS maint_id,
            sm.category AS maint_category,
            sm.reason AS maint_reason,
            sm.priority AS maint_priority,
            sm.status AS maint_status,
            sm.started_at AS maint_started_at,
            CASE
                WHEN s.status = 'disabled' OR COALESCE(r.status::text, 'active') != 'active' THEN 'inactive'
                WHEN s.status = 'maintenance' OR sm.id IS NOT NULL THEN 'maintenance'
                WHEN b.status = 'checked_in' AND b.checked_in_at IS NOT NULL AND b.checked_out_at IS NULL THEN 'occupied'
                WHEN b.status IN ('confirmed', 'awaiting_check_in') AND b.checked_in_at IS NULL THEN 'reserved'
                ELSE 'available'
            END AS computed_status
        FROM public.seats s
        JOIN public.rooms r ON r.id = s.room_id
        JOIN public.floors f ON f.id = r.floor_id
        LEFT JOIN public.seat_maintenance sm ON sm.seat_id = s.id AND (sm.status IS DISTINCT FROM 'Resolved' AND sm.completed_at IS NULL)
        LEFT JOIN public.bookings b ON b.seat_id = s.id AND b.booking_date = v_date AND (v_matched_slot_ids IS NULL OR b.slot_id = ANY(v_matched_slot_ids)) AND b.status IN ('confirmed', 'awaiting_check_in', 'checked_in')
        LEFT JOIN public.profiles p ON p.id = b.student_id
        WHERE (p_room_id IS NULL OR s.room_id = p_room_id)
          AND (p_floor_id IS NULL OR r.floor_id = p_floor_id)
          AND (p_library_id IS NULL OR r.library_id = p_library_id)
    ) seat_data;

    RETURN v_seats_json;
END;
$$;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION public.update_seat_gender_group(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_update_seat_gender_group(UUID[], TEXT) TO authenticated;
