-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 24: LIVE LIBRARY OCCUPANCY REAL DATA ENGINE
-- ====================================================================

-- 1. GET LIVE OCCUPANCY SNAPSHOT RPC FUNCTION
DROP FUNCTION IF EXISTS public.get_live_occupancy_snapshot(UUID, UUID, UUID, UUID, DATE) CASCADE;
DROP FUNCTION IF EXISTS public.get_live_occupancy_snapshot(UUID, UUID, UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.get_live_occupancy_snapshot(UUID, UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.get_live_occupancy_snapshot CASCADE;

CREATE OR REPLACE FUNCTION public.get_live_occupancy_snapshot(
    p_library_id UUID DEFAULT NULL,
    p_floor_id UUID DEFAULT NULL,
    p_room_id UUID DEFAULT NULL,
    p_slot_id UUID DEFAULT NULL,
    p_booking_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now_kolkata TIMESTAMPTZ := CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata';
    v_date DATE := COALESCE(p_booking_date, v_now_kolkata::DATE);
    v_time TIME := v_now_kolkata::TIME;
    v_library_id UUID := p_library_id;
    v_slot_id UUID := p_slot_id;
    v_slot_name TEXT := 'Current Slot';
    v_slot_active BOOLEAN := true;
    v_total_seats INTEGER := 0;
    v_active_seats INTEGER := 0;
    v_maintenance_seats INTEGER := 0;
    v_operational_seats INTEGER := 0;
    v_occupied_seats INTEGER := 0;
    v_reserved_seats INTEGER := 0;
    v_available_seats INTEGER := 0;
    v_pct NUMERIC := 0;
    v_floors_json JSONB := '[]'::jsonb;
    v_rooms_json JSONB := '[]'::jsonb;
    v_slots_json JSONB := '[]'::jsonb;
    v_slot_occurrence_id UUID := NULL;
BEGIN
    -- Determine default Library ID if not provided
    IF v_library_id IS NULL THEN
        SELECT id INTO v_library_id FROM public.libraries LIMIT 1;
    END IF;

    -- Determine active Slot ID & Slot Occurrence if not provided
    IF v_slot_id IS NULL THEN
        SELECT s.id, s.name, so.id INTO v_slot_id, v_slot_name, v_slot_occurrence_id
        FROM public.slots s
        LEFT JOIN public.slot_occurrences so ON so.slot_id = s.id AND so.occurrence_date = v_date
        WHERE (s.library_id = v_library_id OR s.library_id IS NULL)
          AND (s.status IS DISTINCT FROM 'cancelled' AND s.status IS DISTINCT FROM 'disabled')
          AND (so.status IS NULL OR (so.status IS DISTINCT FROM 'cancelled' AND so.status IS DISTINCT FROM 'disabled'))
          AND (v_time >= s.start_time AND v_time <= s.end_time)
        ORDER BY s.start_time ASC
        LIMIT 1;

        -- Fallback to first available slot if none active right now
        IF v_slot_id IS NULL THEN
            SELECT id, name INTO v_slot_id, v_slot_name 
            FROM public.slots 
            WHERE (library_id = v_library_id OR library_id IS NULL)
              AND status IS DISTINCT FROM 'cancelled'
            ORDER BY start_time LIMIT 1;
            
            v_slot_active := false;
        END IF;
    ELSE
        SELECT s.name, so.id INTO v_slot_name, v_slot_occurrence_id
        FROM public.slots s
        LEFT JOIN public.slot_occurrences so ON so.slot_id = s.id AND so.occurrence_date = v_date
        WHERE s.id = v_slot_id;

        -- Check slot active state
        IF EXISTS (
            SELECT 1 FROM public.slots s
            LEFT JOIN public.slot_occurrences so ON so.slot_id = s.id AND so.occurrence_date = v_date
            WHERE s.id = v_slot_id 
              AND (s.status IN ('disabled', 'cancelled') OR so.status IN ('disabled', 'cancelled'))
        ) THEN
            v_slot_active := false;
        END IF;
    END IF;

    -- Aggregate Overall Capacity Metrics for selected Slot
    SELECT 
        COUNT(DISTINCT s.id)::INTEGER,
        COUNT(DISTINCT CASE WHEN s.status != 'disabled' AND COALESCE(r.status::text, 'active') = 'active' THEN s.id END)::INTEGER,
        COUNT(DISTINCT CASE WHEN s.status = 'maintenance' OR sm.id IS NOT NULL THEN s.id END)::INTEGER
    INTO v_total_seats, v_active_seats, v_maintenance_seats
    FROM public.seats s
    JOIN public.rooms r ON r.id = s.room_id
    JOIN public.floors f ON f.id = r.floor_id
    LEFT JOIN public.seat_maintenance sm ON sm.seat_id = s.id AND (sm.status IS DISTINCT FROM 'Resolved' AND sm.completed_at IS NULL)
    WHERE (v_library_id IS NULL OR f.library_id = v_library_id)
      AND (p_floor_id IS NULL OR f.id = p_floor_id)
      AND (p_room_id IS NULL OR r.id = p_room_id);

    v_total_seats := COALESCE(v_total_seats, 0);
    v_active_seats := COALESCE(v_active_seats, 0);
    v_maintenance_seats := COALESCE(v_maintenance_seats, 0);
    v_operational_seats := GREATEST(0, v_active_seats - v_maintenance_seats);

    -- Occupied Seats: Checked-in bookings with checked_in_at IS NOT NULL and checked_out_at IS NULL
    SELECT COUNT(DISTINCT b.seat_id)::INTEGER
    INTO v_occupied_seats
    FROM public.bookings b
    JOIN public.rooms r ON r.id = b.room_id
    JOIN public.floors f ON f.id = r.floor_id
    WHERE b.booking_date = v_date
      AND b.slot_id = v_slot_id
      AND b.status = 'checked_in'
      AND b.checked_in_at IS NOT NULL
      AND b.checked_out_at IS NULL
      AND (v_library_id IS NULL OR f.library_id = v_library_id)
      AND (p_floor_id IS NULL OR f.id = p_floor_id)
      AND (p_room_id IS NULL OR r.id = p_room_id);

    v_occupied_seats := COALESCE(v_occupied_seats, 0);

    -- Reserved Seats: Confirmed or awaiting_check_in bookings not checked in
    SELECT COUNT(DISTINCT b.seat_id)::INTEGER
    INTO v_reserved_seats
    FROM public.bookings b
    JOIN public.rooms r ON r.id = b.room_id
    JOIN public.floors f ON f.id = r.floor_id
    WHERE b.booking_date = v_date
      AND b.slot_id = v_slot_id
      AND b.status IN ('confirmed', 'awaiting_check_in')
      AND b.checked_in_at IS NULL
      AND (v_library_id IS NULL OR f.library_id = v_library_id)
      AND (p_floor_id IS NULL OR f.id = p_floor_id)
      AND (p_room_id IS NULL OR r.id = p_room_id);

    v_reserved_seats := COALESCE(v_reserved_seats, 0);
    v_available_seats := GREATEST(0, v_operational_seats - v_occupied_seats - v_reserved_seats);

    -- Occupancy Percentage
    IF v_operational_seats > 0 THEN
        v_pct := ROUND((v_occupied_seats::NUMERIC / v_operational_seats::NUMERIC) * 100, 1);
    ELSE
        v_pct := 0;
    END IF;

    -- Floor-wise Breakdown JSON
    SELECT COALESCE(jsonb_agg(floor_data), '[]'::jsonb)
    INTO v_floors_json
    FROM (
        SELECT 
            f.id AS floor_id,
            f.name AS floor_name,
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
            CASE 
                WHEN (COUNT(DISTINCT CASE WHEN s.status != 'disabled' THEN s.id END) - COUNT(DISTINCT CASE WHEN s.status = 'maintenance' OR sm.id IS NOT NULL THEN s.id END)) > 0 
                THEN ROUND((COUNT(DISTINCT CASE WHEN b.status = 'checked_in' AND b.checked_in_at IS NOT NULL AND b.checked_out_at IS NULL THEN b.seat_id END)::NUMERIC / 
                            (COUNT(DISTINCT CASE WHEN s.status != 'disabled' THEN s.id END) - COUNT(DISTINCT CASE WHEN s.status = 'maintenance' OR sm.id IS NOT NULL THEN s.id END))::NUMERIC) * 100, 1)
                ELSE 0 
            END AS occupancy_percentage
        FROM public.floors f
        JOIN public.rooms r ON r.floor_id = f.id
        JOIN public.seats s ON s.room_id = r.id
        LEFT JOIN public.seat_maintenance sm ON sm.seat_id = s.id AND (sm.status IS DISTINCT FROM 'Resolved' AND sm.completed_at IS NULL)
        LEFT JOIN public.bookings b ON b.seat_id = s.id AND b.booking_date = v_date AND b.slot_id = v_slot_id
        WHERE (v_library_id IS NULL OR f.library_id = v_library_id)
          AND (p_floor_id IS NULL OR f.id = p_floor_id)
          AND (p_room_id IS NULL OR r.id = p_room_id)
        GROUP BY f.id, f.name
        ORDER BY f.name
    ) floor_data;

    -- Room-wise Breakdown JSON
    SELECT COALESCE(jsonb_agg(room_data), '[]'::jsonb)
    INTO v_rooms_json
    FROM (
        SELECT 
            f.id AS floor_id,
            f.name AS floor_name,
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
            CASE 
                WHEN (COUNT(DISTINCT CASE WHEN s.status != 'disabled' THEN s.id END) - COUNT(DISTINCT CASE WHEN s.status = 'maintenance' OR sm.id IS NOT NULL THEN s.id END)) > 0 
                THEN ROUND((COUNT(DISTINCT CASE WHEN b.status = 'checked_in' AND b.checked_in_at IS NOT NULL AND b.checked_out_at IS NULL THEN b.seat_id END)::NUMERIC / 
                            (COUNT(DISTINCT CASE WHEN s.status != 'disabled' THEN s.id END) - COUNT(DISTINCT CASE WHEN s.status = 'maintenance' OR sm.id IS NOT NULL THEN s.id END))::NUMERIC) * 100, 1)
                ELSE 0 
            END AS occupancy_percentage
        FROM public.rooms r
        JOIN public.floors f ON f.id = r.floor_id
        JOIN public.seats s ON s.room_id = r.id
        LEFT JOIN public.seat_maintenance sm ON sm.seat_id = s.id AND (sm.status IS DISTINCT FROM 'Resolved' AND sm.completed_at IS NULL)
        LEFT JOIN public.bookings b ON b.seat_id = s.id AND b.booking_date = v_date AND b.slot_id = v_slot_id
        WHERE (v_library_id IS NULL OR f.library_id = v_library_id)
          AND (p_floor_id IS NULL OR f.id = p_floor_id)
          AND (p_room_id IS NULL OR r.id = p_room_id)
        GROUP BY f.id, f.name, r.id, r.name
        ORDER BY f.name, r.name
    ) room_data;

    -- Slot-wise Breakdown JSON across ALL daily slots
    SELECT COALESCE(jsonb_agg(slot_data), '[]'::jsonb)
    INTO v_slots_json
    FROM (
        SELECT 
            sl.id AS slot_id,
            sl.name AS slot_name,
            sl.start_time,
            sl.end_time,
            CASE 
                WHEN (so.status IN ('disabled', 'cancelled') OR sl.status IN ('disabled', 'cancelled')) THEN 'disabled'
                WHEN v_date = v_now_kolkata::DATE AND v_time >= sl.start_time AND v_time <= sl.end_time THEN 'active'
                WHEN v_date = v_now_kolkata::DATE AND v_time > sl.end_time THEN 'past'
                ELSE 'upcoming'
            END AS slot_state,
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
            CASE 
                WHEN (COUNT(DISTINCT CASE WHEN s.status != 'disabled' THEN s.id END) - COUNT(DISTINCT CASE WHEN s.status = 'maintenance' OR sm.id IS NOT NULL THEN s.id END)) > 0 
                THEN ROUND((COUNT(DISTINCT CASE WHEN b.status = 'checked_in' AND b.checked_in_at IS NOT NULL AND b.checked_out_at IS NULL THEN b.seat_id END)::NUMERIC / 
                            (COUNT(DISTINCT CASE WHEN s.status != 'disabled' THEN s.id END) - COUNT(DISTINCT CASE WHEN s.status = 'maintenance' OR sm.id IS NOT NULL THEN s.id END))::NUMERIC) * 100, 1)
                ELSE 0 
            END AS occupancy_percentage
        FROM public.slots sl
        CROSS JOIN public.seats s
        JOIN public.rooms r ON r.id = s.room_id
        JOIN public.floors f ON f.id = r.floor_id
        LEFT JOIN public.slot_occurrences so ON so.slot_id = sl.id AND so.occurrence_date = v_date
        LEFT JOIN public.seat_maintenance sm ON sm.seat_id = s.id AND (sm.status IS DISTINCT FROM 'Resolved' AND sm.completed_at IS NULL)
        LEFT JOIN public.bookings b ON b.seat_id = s.id AND b.booking_date = v_date AND b.slot_id = sl.id
        WHERE (sl.library_id = v_library_id OR sl.library_id IS NULL)
          AND (v_library_id IS NULL OR f.library_id = v_library_id)
          AND (p_floor_id IS NULL OR f.id = p_floor_id)
          AND (p_room_id IS NULL OR r.id = p_room_id)
        GROUP BY sl.id, sl.name, sl.start_time, sl.end_time, so.status, sl.status
        ORDER BY sl.start_time ASC
    ) slot_data;

    RETURN jsonb_build_object(
        'library_id', v_library_id,
        'slot_occurrence_id', v_slot_occurrence_id,
        'slot_id', v_slot_id,
        'slot_name', v_slot_name,
        'slot_active', v_slot_active,
        'booking_date', v_date,
        'total_seats', v_total_seats,
        'operational_seats', v_operational_seats,
        'occupied_seats', v_occupied_seats,
        'reserved_seats', v_reserved_seats,
        'available_seats', v_available_seats,
        'maintenance_seats', v_maintenance_seats,
        'awaiting_check_in', v_reserved_seats,
        'checked_in_count', v_occupied_seats,
        'occupancy_percentage', v_pct,
        'floors', v_floors_json,
        'rooms', v_rooms_json,
        'slots', v_slots_json,
        'timestamp', NOW()
    );
END;
$$;


-- 2. GET CURRENT CHECKED-IN OCCUPANTS RPC FUNCTION
DROP FUNCTION IF EXISTS public.get_current_occupants(UUID, UUID, UUID, UUID, DATE) CASCADE;
DROP FUNCTION IF EXISTS public.get_current_occupants(UUID, UUID, UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.get_current_occupants CASCADE;

CREATE OR REPLACE FUNCTION public.get_current_occupants(
    p_library_id UUID DEFAULT NULL,
    p_floor_id UUID DEFAULT NULL,
    p_room_id UUID DEFAULT NULL,
    p_slot_id UUID DEFAULT NULL,
    p_booking_date DATE DEFAULT NULL
)
RETURNS TABLE (
    booking_id UUID,
    booking_code TEXT,
    student_id UUID,
    student_name TEXT,
    registration_number TEXT,
    seat_id UUID,
    seat_number TEXT,
    room_id UUID,
    room_name TEXT,
    floor_id UUID,
    floor_name TEXT,
    slot_id UUID,
    slot_name TEXT,
    checked_in_at TIMESTAMPTZ,
    time_occupied_minutes INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now_kolkata TIMESTAMPTZ := CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata';
    v_date DATE := COALESCE(p_booking_date, v_now_kolkata::DATE);
    v_slot_id UUID := p_slot_id;
BEGIN
    IF v_slot_id IS NULL THEN
        SELECT s.id INTO v_slot_id
        FROM public.slots s
        WHERE v_now_kolkata::TIME >= s.start_time AND v_now_kolkata::TIME <= s.end_time
        LIMIT 1;

        IF v_slot_id IS NULL THEN
            SELECT id INTO v_slot_id FROM public.slots ORDER BY start_time LIMIT 1;
        END IF;
    END IF;

    RETURN QUERY
    SELECT 
        b.id AS booking_id,
        b.booking_code,
        b.student_id,
        COALESCE(p.full_name, 'Student') AS student_name,
        COALESCE(p.registration_number, 'N/A') AS registration_number,
        b.seat_id,
        COALESCE(s.seat_number, 'S-01') AS seat_number,
        b.room_id,
        COALESCE(r.name, 'Reading Room') AS room_name,
        b.floor_id,
        COALESCE(f.name, 'Ground Floor') AS floor_name,
        b.slot_id,
        COALESCE(sl.name, 'Slot') AS slot_name,
        b.checked_in_at,
        GREATEST(0, ROUND(EXTRACT(EPOCH FROM (NOW() - b.checked_in_at)) / 60)::INTEGER) AS time_occupied_minutes
    FROM public.bookings b
    JOIN public.profiles p ON p.id = b.student_id
    JOIN public.seats s ON s.id = b.seat_id
    JOIN public.rooms r ON r.id = b.room_id
    JOIN public.floors f ON f.id = r.floor_id
    JOIN public.slots sl ON sl.id = b.slot_id
    WHERE b.booking_date = v_date
      AND (v_slot_id IS NULL OR b.slot_id = v_slot_id)
      AND b.status = 'checked_in'
      AND b.checked_in_at IS NOT NULL
      AND b.checked_out_at IS NULL
      AND (p_library_id IS NULL OR f.library_id = p_library_id)
      AND (p_floor_id IS NULL OR f.id = p_floor_id)
      AND (p_room_id IS NULL OR r.id = p_room_id)
    ORDER BY b.checked_in_at DESC;
END;
$$;


-- 3. GET LIVE SEAT STATUSES RPC FUNCTION (ALLOW OPTIONAL ROOM / FLOOR / LIBRARY)
DROP FUNCTION IF EXISTS public.get_live_seat_statuses(UUID, UUID, DATE, UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.get_live_seat_statuses(UUID, UUID, DATE) CASCADE;
DROP FUNCTION IF EXISTS public.get_live_seat_statuses CASCADE;

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
    v_seats_json JSONB;
BEGIN
    IF v_slot_id IS NULL THEN
        SELECT s.id INTO v_slot_id
        FROM public.slots s
        WHERE v_now_kolkata::TIME >= s.start_time AND v_now_kolkata::TIME <= s.end_time
        LIMIT 1;

        IF v_slot_id IS NULL THEN
            SELECT id INTO v_slot_id FROM public.slots ORDER BY start_time LIMIT 1;
        END IF;
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'seat_id', seat_data.id,
            'seat_number', seat_data.seat_number,
            'seat_type', COALESCE(seat_data.seat_type, 'Standard'),
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
        LEFT JOIN public.bookings b ON b.seat_id = s.id 
          AND b.booking_date = v_date 
          AND b.slot_id = v_slot_id 
          AND b.status IN ('confirmed', 'awaiting_check_in', 'checked_in')
        LEFT JOIN public.profiles p ON p.id = b.student_id
        WHERE (p_room_id IS NULL OR s.room_id = p_room_id)
          AND (p_floor_id IS NULL OR f.id = p_floor_id)
          AND (p_library_id IS NULL OR f.library_id = p_library_id)
    ) seat_data;

    RETURN v_seats_json;
END;
$$;


-- 4. RLS GRANTS & PERMISSIONS
GRANT EXECUTE ON FUNCTION public.get_live_occupancy_snapshot(UUID, UUID, UUID, UUID, DATE) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_current_occupants(UUID, UUID, UUID, UUID, DATE) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_live_seat_statuses(UUID, UUID, DATE, UUID, UUID) TO authenticated, anon;
