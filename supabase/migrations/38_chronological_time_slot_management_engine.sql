-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 38: RESTORE 9 HOURLY TIME SLOTS ENGINE
-- ====================================================================

-- 1. Repair Morning Slot 1 and convert any 00:00-23:59 template into Morning Slot 1 (08:00 AM - 09:00 AM)
DO $$
BEGIN
    -- Repair any slot named 'Morning Slot 1' or with 00:00:00 start_time to be 08:00:00 - 09:00:00
    UPDATE public.slots
    SET start_time = '08:00:00'::TIME,
        end_time = '09:00:00'::TIME,
        name = 'Morning Slot 1',
        status = 'active',
        disabled_by = NULL,
        disabled_at = NULL,
        cancellation_reason = NULL
    WHERE name ~* 'Morning Slot 1'
       OR id = 'd1eebc99-9c0b-4ef8-bb6d-6bb9bd380a66'::UUID
       OR (start_time = '00:00:00'::TIME AND end_time >= '23:50:00'::TIME);

    -- Clear cancelled status on occurrences for 08:00 AM - 09:00 AM slots
    UPDATE public.slot_occurrences
    SET status = 'scheduled',
        is_booking_enabled = true,
        cancellation_reason = NULL,
        disabled_reason = NULL
    WHERE slot_id IN (
        SELECT id FROM public.slots WHERE start_time = '08:00:00'::TIME AND end_time = '09:00:00'::TIME
    );
END $$;

-- 2. Clean up any obsolete lunch break slots (12:00:00 to 13:00:00)
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN (
        SELECT id FROM public.slots
        WHERE start_time = '12:00:00'::TIME AND end_time = '13:00:00'::TIME
    ) LOOP
        IF EXISTS (SELECT 1 FROM public.bookings WHERE slot_id = rec.id) OR
           EXISTS (SELECT 1 FROM public.slot_occurrences WHERE slot_id = rec.id) THEN
            UPDATE public.slots 
            SET status = 'disabled', 
                cancellation_reason = 'Lunch break period (12:00 PM - 01:00 PM)' 
            WHERE id = rec.id;
        ELSE
            DELETE FROM public.slots WHERE id = rec.id;
        END IF;
    END LOOP;
END $$;

-- 3. Idempotently upsert the 9 standard hourly operational slot templates for all active rooms
DO $$
DECLARE
    v_lib RECORD;
    v_room RECORD;
    v_slot_names TEXT[] := ARRAY[
        'Morning Slot 1',
        'Morning Slot 2',
        'Late Morning Slot',
        'Midday Slot',
        'Afternoon Session 1',
        'Afternoon Session 2',
        'Afternoon Session 3',
        'Evening Slot 1',
        'Evening Slot 2'
    ];
    v_starts TIME[] := ARRAY[
        '08:00:00'::TIME,
        '09:00:00'::TIME,
        '10:00:00'::TIME,
        '11:00:00'::TIME,
        '13:00:00'::TIME,
        '14:00:00'::TIME,
        '15:00:00'::TIME,
        '16:00:00'::TIME,
        '17:00:00'::TIME
    ];
    v_ends TIME[] := ARRAY[
        '09:00:00'::TIME,
        '10:00:00'::TIME,
        '11:00:00'::TIME,
        '12:00:00'::TIME,
        '14:00:00'::TIME,
        '15:00:00'::TIME,
        '16:00:00'::TIME,
        '17:00:00'::TIME,
        '18:00:00'::TIME
    ];
    i INT;
    v_existing_id UUID;
BEGIN
    FOR v_lib IN SELECT id FROM public.libraries LOOP
        FOR v_room IN SELECT id FROM public.rooms WHERE library_id = v_lib.id LOOP
            FOR i IN 1..9 LOOP
                -- Find if slot template exists for start_time & end_time
                SELECT id INTO v_existing_id
                FROM public.slots
                WHERE library_id = v_lib.id
                  AND room_id = v_room.id
                  AND start_time = v_starts[i]
                  AND end_time = v_ends[i]
                LIMIT 1;

                IF v_existing_id IS NOT NULL THEN
                    UPDATE public.slots
                    SET name = v_slot_names[i],
                        status = 'active',
                        disabled_by = NULL,
                        disabled_at = NULL,
                        cancellation_reason = NULL
                    WHERE id = v_existing_id;
                ELSE
                    INSERT INTO public.slots (library_id, room_id, name, start_time, end_time, status)
                    VALUES (v_lib.id, v_room.id, v_slot_names[i], v_starts[i], v_ends[i], 'active');
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;
END $$;

-- 4. Deduplicate any duplicate slots with same (library_id, room_id, start_time, end_time)
DO $$
DECLARE
    r RECORD;
    v_canonical_id UUID;
    v_dup_id UUID;
    v_dup_occ RECORD;
    v_b RECORD;
    v_canon_occ_id UUID;
    i INT;
BEGIN
    FOR r IN (
        SELECT library_id, room_id, start_time, end_time, array_agg(id ORDER BY created_at ASC, id ASC) AS ids
        FROM public.slots
        WHERE library_id IS NOT NULL AND room_id IS NOT NULL
        GROUP BY library_id, room_id, start_time, end_time
        HAVING COUNT(*) > 1
    ) LOOP
        v_canonical_id := r.ids[1];

        FOR i IN 2..array_length(r.ids, 1) LOOP
            v_dup_id := r.ids[i];

            FOR v_dup_occ IN (
                SELECT * FROM public.slot_occurrences WHERE slot_id = v_dup_id
            ) LOOP
                SELECT id INTO v_canon_occ_id
                FROM public.slot_occurrences
                WHERE library_id = v_dup_occ.library_id
                  AND room_id = v_dup_occ.room_id
                  AND slot_id = v_canonical_id
                  AND occurrence_date = v_dup_occ.occurrence_date
                LIMIT 1;

                IF v_canon_occ_id IS NOT NULL THEN
                    FOR v_b IN (SELECT * FROM public.bookings WHERE slot_occurrence_id = v_dup_occ.id) LOOP
                        IF EXISTS (
                            SELECT 1 FROM public.bookings 
                            WHERE student_id = v_b.student_id 
                              AND booking_date = v_b.booking_date 
                              AND slot_id = v_canonical_id
                              AND status IN ('confirmed', 'checked_in', 'awaiting_check_in')
                              AND id <> v_b.id
                        ) THEN
                            UPDATE public.bookings 
                            SET status = 'cancelled',
                                cancellation_reason = 'Deduplicated duplicate slot booking',
                                slot_occurrence_id = v_canon_occ_id,
                                slot_id = v_canonical_id
                            WHERE id = v_b.id;
                        ELSE
                            UPDATE public.bookings
                            SET slot_occurrence_id = v_canon_occ_id,
                                slot_id = v_canonical_id
                            WHERE id = v_b.id;
                        END IF;
                    END LOOP;

                    UPDATE public.check_in_logs
                    SET slot_occurrence_id = v_canon_occ_id
                    WHERE slot_occurrence_id = v_dup_occ.id;

                    BEGIN
                        UPDATE public.waitlist_entries
                        SET slot_occurrence_id = v_canon_occ_id
                        WHERE slot_occurrence_id = v_dup_occ.id;
                    EXCEPTION WHEN OTHERS THEN NULL;
                    END;

                    DELETE FROM public.slot_occurrences WHERE id = v_dup_occ.id;
                ELSE
                    UPDATE public.slot_occurrences
                    SET slot_id = v_canonical_id
                    WHERE id = v_dup_occ.id;
                END IF;
            END LOOP;

            FOR v_b IN (SELECT * FROM public.bookings WHERE slot_id = v_dup_id) LOOP
                SELECT id INTO v_canon_occ_id
                FROM public.slot_occurrences
                WHERE library_id = v_b.library_id
                  AND room_id = v_b.room_id
                  AND slot_id = v_canonical_id
                  AND occurrence_date = v_b.booking_date
                LIMIT 1;

                IF EXISTS (
                    SELECT 1 FROM public.bookings 
                    WHERE student_id = v_b.student_id 
                      AND booking_date = v_b.booking_date 
                      AND slot_id = v_canonical_id
                      AND status IN ('confirmed', 'checked_in', 'awaiting_check_in')
                      AND id <> v_b.id
                ) THEN
                    UPDATE public.bookings 
                    SET status = 'cancelled',
                        cancellation_reason = 'Deduplicated duplicate slot booking',
                        slot_occurrence_id = COALESCE(v_canon_occ_id, slot_occurrence_id),
                        slot_id = v_canonical_id
                    WHERE id = v_b.id;
                ELSE
                    UPDATE public.bookings
                    SET slot_occurrence_id = COALESCE(v_canon_occ_id, slot_occurrence_id),
                        slot_id = v_canonical_id
                    WHERE id = v_b.id;
                END IF;
            END LOOP;

            DELETE FROM public.slots WHERE id = v_dup_id;
        END LOOP;
    END LOOP;
END $$;

-- 5. Add unique constraint uq_slots_library_room_time if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_slots_library_room_time'
    ) THEN
        ALTER TABLE public.slots 
        ADD CONSTRAINT uq_slots_library_room_time 
        UNIQUE (library_id, room_id, start_time, end_time);
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Constraint uq_slots_library_room_time could not be added: %', SQLERRM;
END $$;

-- 6. Re-create get_student_slot_availability and get_student_slots RPCs returning real database capacity counts
DROP FUNCTION IF EXISTS public.get_student_slot_availability(UUID, DATE, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.get_student_slots(UUID, UUID, DATE) CASCADE;
DROP FUNCTION IF EXISTS public.get_student_slots CASCADE;

CREATE OR REPLACE FUNCTION public.get_student_slot_availability(
    p_library_id UUID DEFAULT NULL,
    p_booking_date DATE DEFAULT NULL,
    p_room_id UUID DEFAULT NULL
)
RETURNS TABLE (
    slot_id UUID,
    slot_occurrence_id UUID,
    slot_name TEXT,
    start_time TIME,
    end_time TIME,
    occurrence_date DATE,
    effective_status TEXT,
    is_booking_enabled BOOLEAN,
    disabled_at TIMESTAMPTZ,
    disabled_by UUID,
    disabled_by_name TEXT,
    disabled_reason TEXT,
    physical_total_seats INT,
    operational_seats INT,
    reserved_seats INT,
    available_seats INT,
    maintenance_seats INT,
    blocked_seats INT,
    waitlist_count INT,
    current_student_has_reservation BOOLEAN,
    current_student_booking_id UUID,
    current_student_booking_status TEXT,
    current_student_waitlist_position INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
    v_student_id UUID := auth.uid();
    v_target_date DATE := COALESCE(p_booking_date, (CURRENT_DATE + INTERVAL '1 day')::DATE);
    v_lib_id UUID := p_library_id;
    v_room_id UUID := p_room_id;
    v_slot_rec RECORD;
BEGIN
    IF v_lib_id IS NULL THEN
        SELECT id INTO v_lib_id FROM public.libraries LIMIT 1;
    END IF;
    IF v_room_id IS NULL THEN
        SELECT id INTO v_room_id FROM public.rooms WHERE library_id = v_lib_id LIMIT 1;
    END IF;

    FOR v_slot_rec IN 
        SELECT s.id, s.library_id, s.room_id FROM public.slots s
        WHERE (s.library_id = v_lib_id OR v_lib_id IS NULL)
          AND (s.room_id = v_room_id OR v_room_id IS NULL)
          AND (s.status::text = 'active')
          AND NOT (s.start_time = '00:00:00'::TIME AND s.end_time >= '23:50:00'::TIME)
          AND NOT (s.start_time = '12:00:00'::TIME AND s.end_time = '13:00:00'::TIME)
    LOOP
        PERFORM public.ensure_slot_occurrence(
            v_slot_rec.library_id,
            v_slot_rec.room_id,
            v_slot_rec.id,
            v_target_date
        );
    END LOOP;

    RETURN QUERY
    WITH student_seats AS (
        SELECT 
            st.id AS seat_id,
            st.status AS seat_status
        FROM public.seats st
        WHERE (st.library_id = v_lib_id OR v_lib_id IS NULL)
          AND (st.room_id = v_room_id OR v_room_id IS NULL)
          AND COALESCE(st.is_active, true) IS TRUE
          AND COALESCE(st.is_walk_in_only, false) IS FALSE
          AND (st.allocation_mode IS NULL OR st.allocation_mode <> 'walk_in_only')
    ),
    seat_counts AS (
        SELECT 
            COUNT(*)::INT AS total_physical,
            COUNT(CASE WHEN sm.seat_id IS NOT NULL OR ss.seat_status = 'maintenance' THEN 1 END)::INT AS maint_count
        FROM student_seats ss
        LEFT JOIN public.seat_maintenance sm 
            ON sm.seat_id = ss.seat_id 
           AND sm.status IN ('reported', 'in_progress')
    ),
    slot_bookings AS (
        SELECT 
            COALESCE(b.slot_occurrence_id, so_match.id) AS occurrence_id,
            b.slot_id,
            COUNT(DISTINCT b.seat_id)::INT AS active_booking_count,
            MAX(CASE WHEN b.student_id = v_student_id THEN b.id::text END)::uuid AS student_booking_id,
            MAX(CASE WHEN b.student_id = v_student_id THEN b.status::text END) AS student_booking_status
        FROM public.bookings b
        JOIN student_seats ss ON ss.seat_id = b.seat_id
        LEFT JOIN public.slot_occurrences so_match 
            ON so_match.slot_id = b.slot_id 
           AND so_match.occurrence_date = b.booking_date 
           AND (so_match.library_id = v_lib_id OR v_lib_id IS NULL)
        WHERE b.booking_date = v_target_date
          AND b.status::text IN ('confirmed', 'awaiting_check_in', 'checked_in')
        GROUP BY COALESCE(b.slot_occurrence_id, so_match.id), b.slot_id
    ),
    slot_waitlist AS (
        SELECT 
            w.slot_id,
            COALESCE(w.slot_occurrence_id, so_match.id) AS occurrence_id,
            COUNT(CASE WHEN w.status::text = 'waiting' THEN 1 END)::INT AS wait_count,
            MIN(CASE WHEN w.student_id = v_student_id AND w.status::text = 'waiting' THEN w.queue_position END)::INT AS student_pos
        FROM public.waitlist_entries w
        LEFT JOIN public.slot_occurrences so_match 
            ON so_match.slot_id = w.slot_id 
           AND so_match.occurrence_date = w.booking_date 
           AND (so_match.library_id = v_lib_id OR v_lib_id IS NULL)
        WHERE w.booking_date = v_target_date
        GROUP BY w.slot_id, COALESCE(w.slot_occurrence_id, so_match.id)
    )
    SELECT
        sl.id AS slot_id,
        so.id AS slot_occurrence_id,
        sl.name AS slot_name,
        sl.start_time,
        sl.end_time,
        COALESCE(so.occurrence_date, v_target_date) AS occurrence_date,
        CASE
            WHEN sl.status::text = 'disabled' THEN 'globally_disabled'
            WHEN so.status = 'cancelled' THEN 'cancelled'
            WHEN so.status = 'disabled' OR so.is_booking_enabled IS FALSE THEN 'disabled'
            ELSE 'active'
        END AS effective_status,
        (sl.status::text = 'active' AND COALESCE(so.is_booking_enabled, true) IS TRUE AND COALESCE(so.status, 'active') NOT IN ('cancelled', 'disabled')) AS is_booking_enabled,
        COALESCE(so.disabled_at, sl.disabled_at) AS disabled_at,
        COALESCE(so.disabled_by, sl.disabled_by) AS disabled_by,
        COALESCE(p.full_name, 'System Administrator') AS disabled_by_name,
        CASE
            WHEN sl.status::text = 'disabled' THEN COALESCE(sl.cancellation_reason, 'Globally disabled by administrator')
            WHEN so.status = 'cancelled' OR so.is_booking_enabled IS FALSE THEN COALESCE(so.cancellation_reason, so.disabled_reason, 'Cancelled by administrator')
            ELSE NULL
        END AS disabled_reason,
        COALESCE(sc.total_physical, 40) AS physical_total_seats,
        GREATEST(0, COALESCE(sc.total_physical, 40) - COALESCE(sc.maint_count, 0)) AS operational_seats,
        COALESCE(sb.active_booking_count, 0) AS reserved_seats,
        GREATEST(0, (COALESCE(sc.total_physical, 40) - COALESCE(sc.maint_count, 0)) - COALESCE(sb.active_booking_count, 0)) AS available_seats,
        COALESCE(sc.maint_count, 0) AS maintenance_seats,
        0 AS blocked_seats,
        COALESCE(sw.wait_count, 0) AS waitlist_count,
        (sb.student_booking_id IS NOT NULL) AS current_student_has_reservation,
        sb.student_booking_id AS current_student_booking_id,
        sb.student_booking_status AS current_student_booking_status,
        sw.student_pos AS current_student_waitlist_position
    FROM public.slots sl
    CROSS JOIN seat_counts sc
    LEFT JOIN public.slot_occurrences so 
        ON so.slot_id = sl.id 
       AND (so.library_id = v_lib_id OR v_lib_id IS NULL) 
       AND (so.room_id = v_room_id OR v_room_id IS NULL) 
       AND so.occurrence_date = v_target_date
    LEFT JOIN public.profiles p 
        ON p.id = COALESCE(so.disabled_by, sl.disabled_by)
    LEFT JOIN slot_bookings sb 
        ON (sb.occurrence_id = so.id OR (sb.slot_id = sl.id AND so.id IS NULL))
    LEFT JOIN slot_waitlist sw 
        ON (sw.occurrence_id = so.id OR (sw.slot_id = sl.id AND so.id IS NULL))
    WHERE (sl.library_id = v_lib_id OR v_lib_id IS NULL)
      AND (sl.room_id = v_room_id OR v_room_id IS NULL)
      AND sl.status::text = 'active'
      AND NOT (sl.start_time = '00:00:00'::TIME AND sl.end_time >= '23:50:00'::TIME)
      AND NOT (sl.start_time = '12:00:00'::TIME AND sl.end_time = '13:00:00'::TIME)
    ORDER BY sl.start_time ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_student_slot_availability(UUID, DATE, UUID) TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.get_student_slots(
    p_library_id UUID DEFAULT NULL,
    p_room_id UUID DEFAULT NULL,
    p_booking_date DATE DEFAULT NULL
)
RETURNS TABLE (
    slot_id UUID,
    slot_occurrence_id UUID,
    slot_name TEXT,
    start_time TIME,
    end_time TIME,
    occurrence_date DATE,
    effective_status TEXT,
    is_booking_enabled BOOLEAN,
    disabled_at TIMESTAMPTZ,
    disabled_by UUID,
    disabled_by_name TEXT,
    disabled_reason TEXT,
    physical_total_seats INT,
    operational_seats INT,
    reserved_seats INT,
    available_seats INT,
    maintenance_seats INT,
    blocked_seats INT,
    waitlist_count INT,
    has_student_booking BOOLEAN,
    student_booking_status TEXT,
    current_student_has_reservation BOOLEAN,
    current_student_booking_id UUID,
    current_student_booking_status TEXT,
    current_student_waitlist_position INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
    RETURN QUERY
    SELECT 
        a.slot_id,
        a.slot_occurrence_id,
        a.slot_name,
        a.start_time,
        a.end_time,
        a.occurrence_date,
        a.effective_status,
        a.is_booking_enabled,
        a.disabled_at,
        a.disabled_by,
        a.disabled_by_name,
        a.disabled_reason,
        a.physical_total_seats,
        a.operational_seats,
        a.reserved_seats,
        a.available_seats,
        a.maintenance_seats,
        a.blocked_seats,
        a.waitlist_count,
        a.current_student_has_reservation AS has_student_booking,
        a.current_student_booking_status AS student_booking_status,
        a.current_student_has_reservation,
        a.current_student_booking_id,
        a.current_student_booking_status,
        a.current_student_waitlist_position
    FROM public.get_student_slot_availability(p_library_id, p_booking_date, p_room_id) a;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_student_slots(UUID, UUID, DATE) TO authenticated, anon;

