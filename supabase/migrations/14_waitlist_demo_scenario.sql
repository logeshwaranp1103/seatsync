-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 14: WAITING LIST DEMO SCENARIO (waitlist-demo-001)
-- ====================================================================

-- 1. Add safe test-data columns
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_test_data BOOLEAN DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS test_scenario_id TEXT;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS is_test_data BOOLEAN DEFAULT false;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS test_scenario_id TEXT;

ALTER TABLE public.waitlist_entries ADD COLUMN IF NOT EXISTS is_test_data BOOLEAN DEFAULT false;
ALTER TABLE public.waitlist_entries ADD COLUMN IF NOT EXISTS test_scenario_id TEXT;

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS is_test_data BOOLEAN DEFAULT false;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS test_scenario_id TEXT;

CREATE INDEX IF NOT EXISTS idx_profiles_test_scenario ON public.profiles(test_scenario_id);
CREATE INDEX IF NOT EXISTS idx_bookings_test_scenario ON public.bookings(test_scenario_id);
CREATE INDEX IF NOT EXISTS idx_waitlist_test_scenario ON public.waitlist_entries(test_scenario_id);

-- 2. Reset Waitlist Demo Scenario Function
CREATE OR REPLACE FUNCTION public.reset_waitlist_demo_scenario()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_demo_id TEXT := 'waitlist-demo-001';
BEGIN
    DELETE FROM public.notifications WHERE test_scenario_id = v_demo_id OR is_test_data = true;
    DELETE FROM public.waitlist_entries WHERE test_scenario_id = v_demo_id OR is_test_data = true;
    DELETE FROM public.bookings WHERE test_scenario_id = v_demo_id OR is_test_data = true;
    DELETE FROM public.profiles WHERE test_scenario_id = v_demo_id OR is_test_data = true;

    INSERT INTO public.activity_logs (action, affected_record, notes, user_role)
    VALUES ('DEMO_RESET', v_demo_id, 'Reset demo scenario data', 'admin');

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Waiting List Demo records removed. Genuine records unchanged.'
    );
END;
$$;

-- 3. Prepare Waitlist Demo Scenario Function
CREATE OR REPLACE FUNCTION public.prepare_waitlist_demo_scenario(p_include_waitlist_queue BOOLEAN DEFAULT true)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_demo_id TEXT := 'waitlist-demo-001';
    v_demo_date DATE := ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata') + INTERVAL '1 day')::DATE;
    v_lib_id UUID;
    v_room_id UUID;
    v_slot_id UUID;
    v_seat_rec RECORD;
    v_student_id UUID;
    v_idx INTEGER := 1;
    v_bookings_created INTEGER := 0;
    v_waitlist_created INTEGER := 0;
    v_dept_list TEXT[] := ARRAY['Computer Science & Engineering', 'Information Technology', 'AI & Data Science', 'Electronics & Communication'];
    v_dept TEXT;
BEGIN
    -- 1. Reset existing demo data safely
    PERFORM public.reset_waitlist_demo_scenario();

    -- 2. Resolve Library, Room & Slot
    SELECT id INTO v_lib_id FROM public.libraries LIMIT 1;
    IF v_lib_id IS NULL THEN
        INSERT INTO public.libraries (id, name, location, description)
        VALUES ('11111111-1111-1111-1111-111111111111', 'Central University Library', 'Main Campus', 'Primary Academic Library')
        RETURNING id INTO v_lib_id;
    END IF;

    SELECT id INTO v_room_id FROM public.rooms WHERE library_id = v_lib_id LIMIT 1;
    IF v_room_id IS NULL THEN
        INSERT INTO public.rooms (id, library_id, name, floor_name, capacity)
        VALUES ('22222222-2222-2222-2222-222222222222', v_lib_id, 'Ground Floor Main Reading Room', 'Ground Floor', 40)
        RETURNING id INTO v_room_id;
    END IF;

    SELECT id INTO v_slot_id FROM public.slots LIMIT 1;
    IF v_slot_id IS NULL THEN
        INSERT INTO public.slots (id, library_id, room_id, name, start_time, end_time)
        VALUES ('33333333-3333-3333-3333-333333333333', v_lib_id, v_room_id, 'Afternoon Slot 1', '14:00:00', '15:00:00')
        RETURNING id INTO v_slot_id;
    END IF;

    -- 3. Ensure 40 seats exist (A-01 through A-40)
    FOR i IN 1..40 LOOP
        INSERT INTO public.seats (id, room_id, seat_number, seat_type, has_power_socket, is_accessible, status)
        VALUES (
            gen_random_uuid(),
            v_room_id,
            'A-' || LPAD(i::text, 2, '0'),
            CASE WHEN i <= 20 THEN 'Quiet Study' ELSE 'Group Discussion' END,
            (i % 2 = 0),
            (i % 4 = 0),
            'available'
        )
        ON CONFLICT (room_id, seat_number) DO NOTHING;
    END LOOP;

    -- 4. Create 40 mock profiles and confirmed bookings
    FOR v_seat_rec IN SELECT id, seat_number FROM public.seats WHERE room_id = v_room_id ORDER BY seat_number LIMIT 40 LOOP
        v_dept := v_dept_list[(v_idx % 4) + 1];
        v_student_id := gen_random_uuid();

        INSERT INTO public.profiles (
            id, full_name, email, registration_number, department, role, account_status, is_test_data, test_scenario_id
        )
        VALUES (
            v_student_id,
            'Demo Student ' || LPAD(v_idx::text, 2, '0'),
            'demo.student' || LPAD(v_idx::text, 2, '0') || '@example.invalid',
            'DEMO' || LPAD(v_idx::text, 3, '0'),
            v_dept,
            'student',
            'active',
            true,
            v_demo_id
        );

        INSERT INTO public.bookings (
            booking_code, qr_token, student_id, library_id, room_id, seat_id, slot_id, booking_date, status, is_test_data, test_scenario_id
        )
        VALUES (
            'BK-DEMO-' || LPAD(v_idx::text, 3, '0'),
            'SS-DEMO-' || LPAD(v_idx::text, 3, '0'),
            v_student_id,
            v_lib_id,
            v_room_id,
            v_seat_rec.id,
            v_slot_id,
            v_demo_date,
            'confirmed',
            true,
            v_demo_id
        );

        v_bookings_created := v_bookings_created + 1;
        v_idx := v_idx + 1;
    END LOOP;

    -- 5. Optional 5 mock waitlist entries (Position 1..5)
    IF p_include_waitlist_queue THEN
        FOR w IN 1..5 LOOP
            v_dept := v_dept_list[(w % 4) + 1];
            v_student_id := gen_random_uuid();

            INSERT INTO public.profiles (
                id, full_name, email, registration_number, department, role, account_status, is_test_data, test_scenario_id
            )
            VALUES (
                v_student_id,
                'Waiting Demo Student ' || LPAD(w::text, 2, '0'),
                'waiting.demo' || LPAD(w::text, 2, '0') || '@example.invalid',
                'WAIT' || LPAD(w::text, 3, '0'),
                v_dept,
                'student',
                'active',
                true,
                v_demo_id
            );

            INSERT INTO public.waitlist_entries (
                student_id, library_id, room_id, slot_id, booking_date, queue_position, status, is_test_data, test_scenario_id
            )
            VALUES (
                v_student_id,
                v_lib_id,
                v_room_id,
                v_slot_id,
                v_demo_date,
                w,
                'waiting',
                true,
                v_demo_id
            );

            v_waitlist_created := v_waitlist_created + 1;
        END LOOP;
    END IF;

    -- 6. Log audit action
    INSERT INTO public.activity_logs (action, affected_record, notes, user_role)
    VALUES ('DEMO_PREPARED', v_demo_id, 'Prepared 40 seats + 5 waitlist queue demo', 'admin');

    RETURN jsonb_build_object(
        'success', true,
        'scenario_id', v_demo_id,
        'demo_date', v_demo_date,
        'bookings_created', v_bookings_created,
        'waitlist_created', v_waitlist_created,
        'message', 'Demo prepared: 40 seats reserved and ' || v_waitlist_created || ' students added to waiting list.'
    );
END;
$$;
