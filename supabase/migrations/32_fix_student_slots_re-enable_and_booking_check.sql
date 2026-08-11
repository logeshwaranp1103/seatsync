-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 32: FIX STUDENT SLOTS RE-ENABLE & ACTIVE BOOKINGS FILTER
-- ====================================================================

-- 1. Fix get_student_slots RPC so has_student_booking only checks active bookings
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
        CASE
            WHEN sl.is_active IS FALSE OR sl.status::text = 'disabled' THEN COALESCE(sl.cancellation_reason, 'Globally disabled by administrator')
            WHEN so.status = 'cancelled' OR so.is_booking_enabled IS FALSE THEN COALESCE(so.cancellation_reason, so.disabled_reason, 'Cancelled by administrator')
            ELSE NULL
        END AS disabled_reason,
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
       AND b.status IN ('confirmed', 'checked_in', 'awaiting_check_in')
    WHERE sl.library_id = p_library_id OR sl.room_id = p_room_id OR sl.library_id IS NOT NULL
    ORDER BY sl.start_time ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_student_slots(UUID, UUID, DATE) TO authenticated, anon;
