-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 36: SEAT INVENTORY & MAINTENANCE ENGINE
-- ====================================================================

-- 1. Ensure Table Columns & Foreign Keys on public.seats & public.seat_maintenance
ALTER TABLE public.seats ADD COLUMN IF NOT EXISTS library_id UUID;
ALTER TABLE public.seats ADD COLUMN IF NOT EXISTS floor_id UUID;
ALTER TABLE public.seats ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

ALTER TABLE public.seat_maintenance ADD COLUMN IF NOT EXISTS issue_type TEXT;
ALTER TABLE public.seat_maintenance ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.seat_maintenance ADD COLUMN IF NOT EXISTS severity TEXT DEFAULT 'medium';
ALTER TABLE public.seat_maintenance ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'reported';
ALTER TABLE public.seat_maintenance ADD COLUMN IF NOT EXISTS reported_by UUID;
ALTER TABLE public.seat_maintenance ADD COLUMN IF NOT EXISTS reported_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.seat_maintenance ADD COLUMN IF NOT EXISTS assigned_to UUID;
ALTER TABLE public.seat_maintenance ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE public.seat_maintenance ADD COLUMN IF NOT EXISTS expected_resolution_at TIMESTAMPTZ;
ALTER TABLE public.seat_maintenance ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE public.seat_maintenance ADD COLUMN IF NOT EXISTS resolved_by UUID;
ALTER TABLE public.seat_maintenance ADD COLUMN IF NOT EXISTS resolution_notes TEXT;

-- Drop NOT NULL constraint on legacy column reason if present
ALTER TABLE public.seat_maintenance ALTER COLUMN reason DROP NOT NULL;

-- Backfill missing columns from legacy names if present
UPDATE public.seat_maintenance
SET issue_type = COALESCE(issue_type, category, 'General Maintenance'),
    description = COALESCE(description, reason, 'Flagged for maintenance'),
    severity = COALESCE(severity, priority, 'medium'),
    reported_by = COALESCE(reported_by, created_by),
    resolved_by = COALESCE(resolved_by, completed_by),
    resolved_at = COALESCE(resolved_at, completed_at)
WHERE issue_type IS NULL OR description IS NULL;

-- Backfill seat library_id and floor_id from rooms if missing
UPDATE public.seats s
SET room_id = s.room_id
WHERE s.room_id IS NOT NULL;

UPDATE public.seats s
SET floor_id = r.floor_id,
    library_id = r.library_id
FROM public.rooms r
WHERE s.room_id = r.id AND (s.floor_id IS NULL OR s.library_id IS NULL);

-- Create Partial Unique Index preventing multiple active unresolved maintenance records for the same seat
CREATE UNIQUE INDEX IF NOT EXISTS one_active_maintenance_per_seat
ON public.seat_maintenance(seat_id)
WHERE status IN ('reported', 'in_progress');


-- 2. RPC: get_seat_inventory()
DROP FUNCTION IF EXISTS public.get_seat_inventory CASCADE;

CREATE OR REPLACE FUNCTION public.get_seat_inventory(
    p_library_id UUID DEFAULT NULL,
    p_floor_id UUID DEFAULT NULL,
    p_room_id UUID DEFAULT NULL,
    p_search TEXT DEFAULT NULL,
    p_maintenance_status TEXT DEFAULT NULL
)
RETURNS TABLE (
    seat_id UUID,
    seat_number TEXT,
    seat_type TEXT,
    library_id UUID,
    library_name TEXT,
    floor_id UUID,
    floor_name TEXT,
    room_id UUID,
    room_name TEXT,
    has_power_outlet BOOLEAN,
    is_accessible BOOLEAN,
    seat_is_active BOOLEAN,
    operational_status TEXT,
    maintenance_id UUID,
    maintenance_status TEXT,
    issue_type TEXT,
    issue_description TEXT,
    severity TEXT,
    reported_at TIMESTAMPTZ,
    reported_by UUID,
    reported_by_name TEXT,
    assigned_to UUID,
    assigned_to_name TEXT,
    expected_resolution_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    resolution_notes TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.id AS seat_id,
        s.seat_number,
        COALESCE(s.seat_type, 'Standard Study Desk') AS seat_type,
        s.library_id,
        COALESCE(l.name, 'Central Library') AS library_name,
        s.floor_id,
        COALESCE(fl.name, 'Ground Floor') AS floor_name,
        s.room_id,
        COALESCE(r.name, 'Main Reading Hall') AS room_name,
        COALESCE(s.has_power_socket, false) AS has_power_outlet,
        COALESCE(s.is_accessible, false) AS is_accessible,
        COALESCE(s.is_active, true) AS seat_is_active,
        CASE
            WHEN COALESCE(s.is_active, true) = FALSE THEN 'inactive'
            WHEN sm.id IS NOT NULL AND sm.status IN ('reported', 'in_progress') THEN 'maintenance'
            ELSE 'available'
        END AS operational_status,
        sm.id AS maintenance_id,
        sm.status AS maintenance_status,
        sm.issue_type,
        sm.description AS issue_description,
        sm.severity,
        sm.reported_at,
        sm.reported_by,
        p_rep.full_name AS reported_by_name,
        sm.assigned_to,
        p_ass.full_name AS assigned_to_name,
        sm.expected_resolution_at,
        sm.resolved_at,
        sm.resolution_notes
    FROM public.seats s
    LEFT JOIN public.rooms r ON r.id = s.room_id
    LEFT JOIN public.floors fl ON fl.id = s.floor_id
    LEFT JOIN public.libraries l ON l.id = s.library_id
    LEFT JOIN LATERAL (
        SELECT *
        FROM public.seat_maintenance m
        WHERE m.seat_id = s.id
        ORDER BY (
            CASE WHEN m.status IN ('reported', 'in_progress') THEN 1 ELSE 2 END
        ), m.created_at DESC
        LIMIT 1
    ) sm ON TRUE
    LEFT JOIN public.profiles p_rep ON p_rep.id = sm.reported_by
    LEFT JOIN public.profiles p_ass ON p_ass.id = sm.assigned_to
    WHERE (p_library_id IS NULL OR s.library_id = p_library_id)
      AND (p_floor_id IS NULL OR s.floor_id = p_floor_id)
      AND (p_room_id IS NULL OR s.room_id = p_room_id)
      AND (p_search IS NULL OR s.seat_number ILIKE '%' || p_search || '%' OR COALESCE(sm.issue_type, '') ILIKE '%' || p_search || '%')
      AND (p_maintenance_status IS NULL OR (
          CASE
              WHEN p_maintenance_status = 'maintenance' THEN sm.status IN ('reported', 'in_progress')
              WHEN p_maintenance_status = 'available' THEN COALESCE(s.is_active, true) = TRUE AND (sm.id IS NULL OR sm.status = 'resolved')
              WHEN p_maintenance_status = 'inactive' THEN COALESCE(s.is_active, true) = FALSE
              ELSE sm.status = p_maintenance_status
          END
      ))
    ORDER BY s.seat_number ASC;
END;
$$;


-- 3. RPC: report_seat_maintenance()
DROP FUNCTION IF EXISTS public.report_seat_maintenance CASCADE;

CREATE OR REPLACE FUNCTION public.report_seat_maintenance(
    p_seat_id UUID,
    p_issue_type TEXT,
    p_description TEXT,
    p_severity TEXT DEFAULT 'medium',
    p_expected_resolution_at TIMESTAMPTZ DEFAULT NULL,
    p_assigned_to UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_staff_id UUID := auth.uid();
    v_staff_profile RECORD;
    v_seat RECORD;
    v_new_id UUID := gen_random_uuid();
    v_active_maint RECORD;
    v_desc TEXT := COALESCE(TRIM(p_description), 'Seat reported for maintenance');
BEGIN
    IF v_staff_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Authentication required.');
    END IF;

    SELECT id, full_name, role INTO v_staff_profile FROM public.profiles WHERE id = v_staff_id;
    IF v_staff_profile.id IS NULL OR LOWER(v_staff_profile.role::text) NOT IN ('librarian', 'senior_librarian', 'staff', 'admin', 'super_admin') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Access denied. Staff or Librarian role required.');
    END IF;

    SELECT * INTO v_seat FROM public.seats WHERE id = p_seat_id;
    IF v_seat.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Seat record not found.');
    END IF;

    -- Check for existing unresolved active maintenance
    SELECT * INTO v_active_maint
    FROM public.seat_maintenance
    WHERE seat_id = p_seat_id AND status IN ('reported', 'in_progress')
    LIMIT 1;

    IF v_active_maint.id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Seat already has an active maintenance issue (' || COALESCE(v_active_maint.issue_type, 'Unresolved Issue') || ').'
        );
    END IF;

    -- Insert into public.seat_maintenance (Populate both description & reason for backward compatibility)
    INSERT INTO public.seat_maintenance (
        id,
        seat_id,
        issue_type,
        description,
        reason,
        severity,
        status,
        reported_by,
        reported_at,
        assigned_to,
        expected_resolution_at,
        created_at,
        updated_at
    ) VALUES (
        v_new_id,
        p_seat_id,
        COALESCE(TRIM(p_issue_type), 'General Maintenance'),
        v_desc,
        v_desc,
        LOWER(COALESCE(p_severity, 'medium')),
        'reported',
        v_staff_id,
        NOW(),
        p_assigned_to,
        p_expected_resolution_at,
        NOW(),
        NOW()
    );

    -- Update seat status enum if applicable
    BEGIN
        UPDATE public.seats SET status = 'maintenance' WHERE id = p_seat_id;
    EXCEPTION WHEN OTHERS THEN NULL; END;

    -- Audit Log
    BEGIN
        INSERT INTO public.audit_logs (actor_id, target_id, event_type, metadata, created_at)
        VALUES (v_staff_id, v_new_id, 'SEAT_MAINTENANCE_REPORTED', jsonb_build_object('seat_id', p_seat_id, 'severity', p_severity), NOW());
    EXCEPTION WHEN OTHERS THEN NULL; END;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Maintenance issue reported successfully.',
        'maintenance_id', v_new_id
    );
END;
$$;


-- 4. RPC: update_seat_maintenance()
DROP FUNCTION IF EXISTS public.update_seat_maintenance CASCADE;

CREATE OR REPLACE FUNCTION public.update_seat_maintenance(
    p_maintenance_id UUID,
    p_status TEXT,
    p_severity TEXT DEFAULT NULL,
    p_assigned_to UUID DEFAULT NULL,
    p_expected_resolution_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_staff_id UUID := auth.uid();
    v_maint RECORD;
BEGIN
    IF v_staff_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Authentication required.');
    END IF;

    SELECT * INTO v_maint FROM public.seat_maintenance WHERE id = p_maintenance_id FOR UPDATE;
    IF v_maint.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Maintenance record not found.');
    END IF;

    UPDATE public.seat_maintenance
    SET
        status = COALESCE(p_status, status),
        severity = COALESCE(p_severity, severity),
        assigned_to = COALESCE(p_assigned_to, assigned_to),
        expected_resolution_at = COALESCE(p_expected_resolution_at, expected_resolution_at),
        started_at = CASE WHEN p_status = 'in_progress' AND started_at IS NULL THEN NOW() ELSE started_at END,
        updated_at = NOW()
    WHERE id = p_maintenance_id;

    -- Audit Log
    BEGIN
        INSERT INTO public.audit_logs (actor_id, target_id, event_type, metadata, created_at)
        VALUES (v_staff_id, p_maintenance_id, 'SEAT_MAINTENANCE_UPDATED', jsonb_build_object('status', p_status), NOW());
    EXCEPTION WHEN OTHERS THEN NULL; END;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Maintenance status updated to ' || p_status || '.'
    );
END;
$$;


-- 5. RPC: resolve_seat_maintenance()
DROP FUNCTION IF EXISTS public.resolve_seat_maintenance CASCADE;

CREATE OR REPLACE FUNCTION public.resolve_seat_maintenance(
    p_maintenance_id UUID,
    p_resolution_notes TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_staff_id UUID := auth.uid();
    v_staff_profile RECORD;
    v_maint RECORD;
    v_clean_notes TEXT := TRIM(COALESCE(p_resolution_notes, ''));
BEGIN
    IF v_staff_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Authentication required.');
    END IF;

    IF v_clean_notes = '' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Resolution notes are required.');
    END IF;

    SELECT id, full_name, role INTO v_staff_profile FROM public.profiles WHERE id = v_staff_id;
    IF v_staff_profile.id IS NULL OR LOWER(v_staff_profile.role::text) NOT IN ('librarian', 'senior_librarian', 'staff', 'admin', 'super_admin') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Access denied. Librarian role required.');
    END IF;

    SELECT * INTO v_maint FROM public.seat_maintenance WHERE id = p_maintenance_id FOR UPDATE;
    IF v_maint.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Maintenance record not found.');
    END IF;

    IF v_maint.status = 'resolved' THEN
        RETURN jsonb_build_object('success', true, 'message', 'Maintenance issue was already resolved.');
    END IF;

    UPDATE public.seat_maintenance
    SET
        status = 'resolved',
        resolved_at = NOW(),
        resolved_by = v_staff_id,
        resolution_notes = v_clean_notes,
        updated_at = NOW()
    WHERE id = p_maintenance_id;

    -- Update seat status back to available if no other unresolved maintenance exists
    IF NOT EXISTS (SELECT 1 FROM public.seat_maintenance WHERE seat_id = v_maint.seat_id AND id != p_maintenance_id AND status IN ('reported', 'in_progress')) THEN
        BEGIN
            UPDATE public.seats SET status = 'available' WHERE id = v_maint.seat_id;
        EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;

    -- Audit Log
    BEGIN
        INSERT INTO public.audit_logs (actor_id, target_id, event_type, metadata, created_at)
        VALUES (v_staff_id, p_maintenance_id, 'SEAT_MAINTENANCE_RESOLVED', jsonb_build_object('seat_id', v_maint.seat_id, 'notes', v_clean_notes), NOW());
    EXCEPTION WHEN OTHERS THEN NULL; END;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Seat maintenance issue resolved and seat returned to service.'
    );
END;
$$;


-- 6. RPC: add_new_seat()
DROP FUNCTION IF EXISTS public.add_new_seat CASCADE;

CREATE OR REPLACE FUNCTION public.add_new_seat(
    p_library_id UUID,
    p_floor_id UUID,
    p_room_id UUID,
    p_seat_number TEXT,
    p_seat_type TEXT,
    p_has_power_socket BOOLEAN DEFAULT FALSE,
    p_is_accessible BOOLEAN DEFAULT FALSE,
    p_allocation_mode TEXT DEFAULT 'online'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_staff_id UUID := auth.uid();
    v_clean_num TEXT := UPPER(TRIM(COALESCE(p_seat_number, '')));
    v_new_id UUID := gen_random_uuid();
    v_mode TEXT := COALESCE(p_allocation_mode, 'online');
BEGIN
    IF v_staff_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Authentication required.');
    END IF;

    IF v_clean_num = '' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Seat number is required.');
    END IF;

    IF v_mode NOT IN ('online', 'walk_in_only') THEN
        v_mode := 'online';
    END IF;

    IF EXISTS (SELECT 1 FROM public.seats WHERE room_id = p_room_id AND UPPER(seat_number) = v_clean_num) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Seat number ' || v_clean_num || ' already exists in this room.');
    END IF;

    INSERT INTO public.seats (
        id,
        library_id,
        floor_id,
        room_id,
        seat_number,
        seat_type,
        has_power_socket,
        is_accessible,
        is_active,
        status,
        allocation_mode,
        created_at,
        updated_at
    ) VALUES (
        v_new_id,
        p_library_id,
        p_floor_id,
        p_room_id,
        v_clean_num,
        COALESCE(p_seat_type, 'Standard Study Desk'),
        COALESCE(p_has_power_socket, false),
        COALESCE(p_is_accessible, false),
        true,
        'available',
        v_mode,
        NOW(),
        NOW()
    );

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Seat ' || v_clean_num || ' added successfully.',
        'seat_id', v_new_id
    );
END;
$$;


-- 7. SECURITY GRANTS & REALTIME PUBLICATION
GRANT EXECUTE ON FUNCTION public.get_seat_inventory(UUID, UUID, UUID, TEXT, TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.report_seat_maintenance(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.update_seat_maintenance(UUID, TEXT, TEXT, UUID, TIMESTAMPTZ) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.resolve_seat_maintenance(UUID, TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.add_new_seat(UUID, UUID, UUID, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT) TO authenticated, anon;
