-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 29: ADMIN SLOT MANAGEMENT & CANCELLATION ENGINE
-- ====================================================================

-- 1. Ensure columns exist on public.slots
ALTER TABLE public.slots
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS disabled_by UUID REFERENCES public.profiles(id);

UPDATE public.slots SET is_active = true WHERE is_active IS NULL;

-- 2. Ensure columns exist on public.slot_occurrences
ALTER TABLE public.slot_occurrences
    ADD COLUMN IF NOT EXISTS is_booking_enabled BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS disabled_by UUID REFERENCES public.profiles(id),
    ADD COLUMN IF NOT EXISTS disabled_reason TEXT,
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES public.profiles(id),
    ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

UPDATE public.slot_occurrences SET is_booking_enabled = true WHERE is_booking_enabled IS NULL;


-- 3. Atomic Date-Specific Slot Cancellation RPC: cancel_slot_occurrence()
DROP FUNCTION IF EXISTS public.cancel_slot_occurrence CASCADE;

CREATE OR REPLACE FUNCTION public.cancel_slot_occurrence(
    p_slot_id UUID,
    p_library_id UUID,
    p_room_id UUID,
    p_occurrence_date DATE,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_admin_id UUID := auth.uid();
    v_clean_reason TEXT := NULLIF(TRIM(p_reason), '');
    v_occurrence_id UUID;
    v_slot_name TEXT;
    v_start_time TIME;
    v_end_time TIME;
    v_affected_bookings_count INTEGER := 0;
    v_booking_rec RECORD;
    v_occurrence_json JSONB;
BEGIN
    -- 1. Authenticate administrator
    IF v_admin_id IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated request. Administrator login required.';
    END IF;

    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Access denied. Only authorized administrators can cancel time slots.';
    END IF;

    -- 2. Validate mandatory cancellation reason
    IF v_clean_reason IS NULL THEN
        RAISE EXCEPTION 'Cancellation reason is required. Please state why this slot occurrence is being cancelled.';
    END IF;

    -- 3. Fetch slot details
    SELECT name, start_time, end_time INTO v_slot_name, v_start_time, v_end_time
    FROM public.slots WHERE id = p_slot_id;

    IF v_slot_name IS NULL THEN
        RAISE EXCEPTION 'Specified time slot definition not found.';
    END IF;

    -- 4. Find or create the slot occurrence record for this date
    v_occurrence_id := public.ensure_slot_occurrence(p_library_id, p_room_id, p_slot_id, p_occurrence_date);

    -- Lock and update the slot occurrence
    UPDATE public.slot_occurrences
    SET
        status = 'cancelled',
        is_booking_enabled = false,
        cancelled_at = NOW(),
        cancelled_by = v_admin_id,
        cancellation_reason = v_clean_reason,
        disabled_at = NOW(),
        disabled_by = v_admin_id,
        disabled_reason = v_clean_reason,
        updated_at = NOW()
    WHERE id = v_occurrence_id;

    -- 5. Cancel affected active bookings
    FOR v_booking_rec IN
        SELECT b.id, b.student_id, b.booking_code
        FROM public.bookings b
        WHERE (b.slot_occurrence_id = v_occurrence_id OR (b.slot_id = p_slot_id AND b.booking_date = p_occurrence_date AND b.room_id = p_room_id))
          AND b.status IN ('confirmed', 'checked_in', 'awaiting_check_in')
    LOOP
        v_affected_bookings_count := v_affected_bookings_count + 1;

        UPDATE public.bookings
        SET
            status = 'cancelled',
            cancelled_at = NOW(),
            cancelled_by = v_admin_id,
            cancellation_reason = v_clean_reason,
            updated_at = NOW()
        WHERE id = v_booking_rec.id;

        -- Create student notification
        BEGIN
            INSERT INTO public.notifications (
                recipient_id,
                type,
                title,
                message,
                priority,
                related_entity_type,
                related_entity_id,
                is_read,
                created_at
            ) VALUES (
                v_booking_rec.student_id,
                'slot_cancelled',
                'Slot Cancelled by Administrator',
                'Your booking (' || v_booking_rec.booking_code || ') for ' || v_slot_name || ' on ' || p_occurrence_date || ' was cancelled by the administrator. Reason: ' || v_clean_reason,
                'high',
                'booking',
                v_booking_rec.id,
                false,
                NOW()
            );
        EXCEPTION WHEN OTHERS THEN /* non-blocking notification failure */ END;
    END LOOP;

    -- 6. Record Audit Log
    BEGIN
        INSERT INTO public.audit_logs (
            actor_id,
            target_id,
            event_type,
            metadata,
            created_at
        ) VALUES (
            v_admin_id,
            v_occurrence_id,
            'SLOT_OCCURRENCE_CANCELLED',
            jsonb_build_object(
                'slot_id', p_slot_id,
                'slot_name', v_slot_name,
                'occurrence_date', p_occurrence_date,
                'reason', v_clean_reason,
                'affected_bookings_count', v_affected_bookings_count
            ),
            NOW()
        );
    EXCEPTION WHEN OTHERS THEN /* non-blocking audit failure */ END;

    -- Return JSON summary
    SELECT jsonb_build_object(
        'success', true,
        'slot_occurrence_id', so.id,
        'slot_id', p_slot_id,
        'slot_name', v_slot_name,
        'occurrence_date', so.occurrence_date,
        'status', so.status,
        'is_booking_enabled', so.is_booking_enabled,
        'cancellation_reason', so.cancellation_reason,
        'cancelled_at', so.cancelled_at,
        'cancelled_by', so.cancelled_by,
        'affected_bookings_count', v_affected_bookings_count
    ) INTO v_occurrence_json
    FROM public.slot_occurrences so
    WHERE so.id = v_occurrence_id;

    RETURN v_occurrence_json;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_slot_occurrence(UUID, UUID, UUID, DATE, TEXT) TO authenticated;


-- 4. Date-Specific Slot Re-enabling RPC: enable_slot_occurrence()
DROP FUNCTION IF EXISTS public.enable_slot_occurrence CASCADE;

CREATE OR REPLACE FUNCTION public.enable_slot_occurrence(
    p_slot_occurrence_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_admin_id UUID := auth.uid();
    v_occurrence_date DATE;
    v_slot_id UUID;
    v_status TEXT;
    v_occurrence_json JSONB;
BEGIN
    IF v_admin_id IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated request. Administrator login required.';
    END IF;

    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Access denied. Only authorized administrators can enable time slots.';
    END IF;

    SELECT occurrence_date, slot_id INTO v_occurrence_date, v_slot_id
    FROM public.slot_occurrences WHERE id = p_slot_occurrence_id;

    IF v_occurrence_date IS NULL THEN
        RAISE EXCEPTION 'Slot occurrence record not found.';
    END IF;

    v_status := CASE 
        WHEN v_occurrence_date < CURRENT_DATE THEN 'completed'
        WHEN v_occurrence_date = CURRENT_DATE THEN 'active'
        ELSE 'scheduled'
    END;

    UPDATE public.slot_occurrences
    SET
        status = v_status,
        is_booking_enabled = true,
        disabled_at = NULL,
        disabled_by = NULL,
        disabled_reason = NULL,
        cancelled_at = NULL,
        cancelled_by = NULL,
        cancellation_reason = NULL,
        updated_at = NOW()
    WHERE id = p_slot_occurrence_id;

    -- Record Audit Log
    BEGIN
        INSERT INTO public.audit_logs (
            actor_id,
            target_id,
            event_type,
            metadata,
            created_at
        ) VALUES (
            v_admin_id,
            p_slot_occurrence_id,
            'SLOT_OCCURRENCE_ENABLED',
            jsonb_build_object('occurrence_id', p_slot_occurrence_id, 'date', v_occurrence_date),
            NOW()
        );
    EXCEPTION WHEN OTHERS THEN /* non-blocking */ END;

    SELECT jsonb_build_object(
        'success', true,
        'slot_occurrence_id', so.id,
        'occurrence_date', so.occurrence_date,
        'status', so.status,
        'is_booking_enabled', so.is_booking_enabled
    ) INTO v_occurrence_json
    FROM public.slot_occurrences so
    WHERE so.id = p_slot_occurrence_id;

    RETURN v_occurrence_json;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enable_slot_occurrence(UUID) TO authenticated;


-- 5. Master Slot Global Disable RPC: disable_master_slot()
CREATE OR REPLACE FUNCTION public.disable_master_slot(
    p_slot_id UUID,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_admin_id UUID := auth.uid();
    v_clean_reason TEXT := NULLIF(TRIM(p_reason), '');
BEGIN
    IF v_admin_id IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated request.';
    END IF;

    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Access denied. Only authorized administrators can disable master slots.';
    END IF;

    IF v_clean_reason IS NULL THEN
        RAISE EXCEPTION 'Reason is required for global slot disable.';
    END IF;

    UPDATE public.slots
    SET
        is_active = false,
        disabled_at = NOW(),
        disabled_by = v_admin_id,
        cancellation_reason = v_clean_reason,
        updated_at = NOW()
    WHERE id = p_slot_id;

    RETURN jsonb_build_object('success', true, 'slot_id', p_slot_id, 'is_active', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.disable_master_slot(UUID, TEXT) TO authenticated;


-- 6. Master Slot Global Enable RPC: enable_master_slot()
CREATE OR REPLACE FUNCTION public.enable_master_slot(
    p_slot_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_admin_id UUID := auth.uid();
BEGIN
    IF v_admin_id IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated request.';
    END IF;

    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Access denied. Only authorized administrators can enable master slots.';
    END IF;

    UPDATE public.slots
    SET
        is_active = true,
        disabled_at = NULL,
        disabled_by = NULL,
        cancellation_reason = NULL,
        updated_at = NOW()
    WHERE id = p_slot_id;

    RETURN jsonb_build_object('success', true, 'slot_id', p_slot_id, 'is_active', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.enable_master_slot(UUID) TO authenticated;


-- 7. Student Slot Availability RPC: get_student_slots()
DROP FUNCTION IF EXISTS public.get_student_slots CASCADE;

CREATE OR REPLACE FUNCTION public.get_student_slots(
    p_library_id UUID,
    p_room_id UUID,
    p_booking_date DATE
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
    has_student_booking BOOLEAN,
    student_booking_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_student_id UUID := auth.uid();
BEGIN
    RETURN QUERY
    SELECT
        sl.id AS slot_id,
        so.id AS slot_occurrence_id,
        sl.name AS slot_name,
        sl.start_time,
        sl.end_time,
        COALESCE(so.occurrence_date, p_booking_date) AS occurrence_date,
        CASE
            WHEN sl.is_active IS FALSE OR sl.status::text = 'disabled' THEN 'globally_disabled'
            WHEN so.status = 'cancelled' THEN 'cancelled'
            WHEN so.status = 'disabled' OR so.is_booking_enabled IS FALSE THEN 'disabled'
            ELSE 'active'
        END AS effective_status,
        (sl.is_active IS NOT FALSE AND COALESCE(so.is_booking_enabled, true) IS TRUE AND COALESCE(so.status, 'active') NOT IN ('cancelled', 'disabled')) AS is_booking_enabled,
        COALESCE(so.disabled_at, sl.disabled_at) AS disabled_at,
        COALESCE(so.disabled_by, sl.disabled_by) AS disabled_by,
        COALESCE(p.full_name, 'System Administrator') AS disabled_by_name,
        COALESCE(so.cancellation_reason, so.disabled_reason, sl.cancellation_reason) AS disabled_reason,
        (b.id IS NOT NULL) AS has_student_booking,
        b.status::text AS student_booking_status
    FROM public.slots sl
    LEFT JOIN public.slot_occurrences so 
        ON so.slot_id = sl.id 
       AND so.library_id = p_library_id 
       AND so.room_id = p_room_id 
       AND so.occurrence_date = p_booking_date
    LEFT JOIN public.profiles p 
        ON p.id = COALESCE(so.disabled_by, sl.disabled_by)
    LEFT JOIN public.bookings b 
        ON (b.slot_occurrence_id = so.id OR (b.slot_id = sl.id AND b.booking_date = p_booking_date AND b.room_id = p_room_id))
       AND b.student_id = v_student_id
       AND b.status IN ('confirmed', 'checked_in', 'awaiting_check_in', 'cancelled')
    WHERE sl.library_id = p_library_id OR sl.room_id = p_room_id OR sl.library_id IS NOT NULL
    ORDER BY sl.start_time ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_student_slots(UUID, UUID, DATE) TO authenticated, anon;


-- 8. Admin Slot Occurrences RPC: get_admin_slot_occurrences()
DROP FUNCTION IF EXISTS public.get_admin_slot_occurrences CASCADE;

CREATE OR REPLACE FUNCTION public.get_admin_slot_occurrences(
    p_library_id UUID,
    p_room_id UUID,
    p_occurrence_date DATE
)
RETURNS TABLE (
    slot_id UUID,
    slot_occurrence_id UUID,
    slot_name TEXT,
    start_time TIME,
    end_time TIME,
    occurrence_date DATE,
    master_is_active BOOLEAN,
    occurrence_status TEXT,
    is_booking_enabled BOOLEAN,
    disabled_at TIMESTAMPTZ,
    disabled_by UUID,
    disabled_by_name TEXT,
    cancellation_reason TEXT,
    active_bookings_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        sl.id AS slot_id,
        so.id AS slot_occurrence_id,
        sl.name AS slot_name,
        sl.start_time,
        sl.end_time,
        COALESCE(so.occurrence_date, p_occurrence_date) AS occurrence_date,
        COALESCE(sl.is_active, true) AS master_is_active,
        COALESCE(so.status, 'scheduled') AS occurrence_status,
        COALESCE(so.is_booking_enabled, true) AS is_booking_enabled,
        COALESCE(so.disabled_at, so.cancelled_at, sl.disabled_at) AS disabled_at,
        COALESCE(so.disabled_by, so.cancelled_by, sl.disabled_by) AS disabled_by,
        COALESCE(p.full_name, 'System Administrator') AS disabled_by_name,
        COALESCE(so.cancellation_reason, so.disabled_reason, sl.cancellation_reason) AS cancellation_reason,
        COUNT(DISTINCT CASE WHEN b.status IN ('confirmed', 'checked_in', 'awaiting_check_in') THEN b.id END)::INTEGER AS active_bookings_count
    FROM public.slots sl
    LEFT JOIN public.slot_occurrences so 
        ON so.slot_id = sl.id 
       AND so.library_id = p_library_id 
       AND so.room_id = p_room_id 
       AND so.occurrence_date = p_occurrence_date
    LEFT JOIN public.profiles p 
        ON p.id = COALESCE(so.disabled_by, so.cancelled_by, sl.disabled_by)
    LEFT JOIN public.bookings b 
        ON (b.slot_occurrence_id = so.id OR (b.slot_id = sl.id AND b.booking_date = p_occurrence_date AND b.room_id = p_room_id))
    WHERE sl.library_id = p_library_id OR sl.room_id = p_room_id OR sl.library_id IS NOT NULL
    GROUP BY sl.id, so.id, sl.name, sl.start_time, sl.end_time, so.occurrence_date, sl.is_active, so.status, so.is_booking_enabled, so.disabled_at, so.cancelled_at, sl.disabled_at, so.disabled_by, so.cancelled_by, sl.disabled_by, p.full_name, so.cancellation_reason, so.disabled_reason, sl.cancellation_reason
    ORDER BY sl.start_time ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_slot_occurrences(UUID, UUID, DATE) TO authenticated, anon;
