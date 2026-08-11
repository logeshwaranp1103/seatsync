-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 19: SLOT OCCURRENCE WAITLIST CATEGORIZATION
-- ====================================================================

-- 1. Create slot_occurrences table to represent unambiguous slot date instances
CREATE TABLE IF NOT EXISTS public.slot_occurrences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    library_id UUID REFERENCES public.libraries(id) ON DELETE CASCADE,
    room_id UUID REFERENCES public.rooms(id) ON DELETE CASCADE,
    slot_id UUID REFERENCES public.slots(id) ON DELETE CASCADE,
    occurrence_date DATE NOT NULL,
    start_at TIMESTAMPTZ,
    end_at TIMESTAMPTZ,
    status TEXT DEFAULT 'active',
    capacity INTEGER DEFAULT 40,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_library_room_slot_date UNIQUE (library_id, room_id, slot_id, occurrence_date)
);

-- 2. Add slot_occurrence_id column to waitlist_entries
ALTER TABLE public.waitlist_entries
    ADD COLUMN IF NOT EXISTS slot_occurrence_id UUID REFERENCES public.slot_occurrences(id) ON DELETE SET NULL;

-- 3. Required Indexes
CREATE INDEX IF NOT EXISTS idx_slot_occurrences_library_date
ON public.slot_occurrences (library_id, occurrence_date, start_at);

CREATE INDEX IF NOT EXISTS idx_waitlist_occurrence_status_order
ON public.waitlist_entries (slot_id, booking_date, status, created_at, id);

-- ====================================================================
-- RPC FUNCTION: GET WAITLIST SLOT SUMMARY FOR DATE & LIBRARY
-- ====================================================================
DROP FUNCTION IF EXISTS public.get_waitlist_slot_summary(uuid, date, uuid);
DROP FUNCTION IF EXISTS public.get_waitlist_slot_summary(uuid, date);

CREATE OR REPLACE FUNCTION public.get_waitlist_slot_summary(
    p_library_id UUID,
    p_selected_date DATE,
    p_room_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_room_id UUID := p_room_id;
    v_slots_result JSONB;
BEGIN
    IF v_room_id IS NULL THEN
        SELECT id INTO v_room_id
        FROM public.rooms
        WHERE library_id = p_library_id AND status = 'active'
        LIMIT 1;
    END IF;

    -- Ensure slot occurrences exist for date
    INSERT INTO public.slot_occurrences (library_id, room_id, slot_id, occurrence_date, capacity)
    SELECT p_library_id, COALESCE(v_room_id, r.id), s.id, p_selected_date, COALESCE(s.capacity, 40)
    FROM public.slots s
    CROSS JOIN public.rooms r
    WHERE r.library_id = p_library_id
    ON CONFLICT (library_id, room_id, slot_id, occurrence_date) DO NOTHING;

    -- Aggregate metrics per slot occurrence
    SELECT jsonb_agg(
        jsonb_build_object(
            'slot_occurrence_id', COALESCE(so.id, gen_random_uuid()),
            'slot_id', s.id,
            'slot_name', s.name,
            'occurrence_date', p_selected_date,
            'start_time', s.start_time,
            'end_time', s.end_time,
            'library_id', p_library_id,
            'room_id', COALESCE(v_room_id, r.id),
            'room_name', COALESCE(r.name, 'Main Quiet Reading Hall'),
            'slot_status', COALESCE(s.status::text, 'active'),
            'capacity', COALESCE(s.capacity, 40),
            'confirmed_count', (
                SELECT COUNT(*) FROM public.bookings b
                WHERE b.slot_id = s.id
                  AND b.booking_date = p_selected_date
                  AND b.status::text IN ('confirmed', 'checked_in')
            ),
            'available_count', GREATEST(0, COALESCE(s.capacity, 40) - (
                SELECT COUNT(*) FROM public.bookings b
                WHERE b.slot_id = s.id
                  AND b.booking_date = p_selected_date
                  AND b.status::text IN ('confirmed', 'awaiting_check_in', 'checked_in')
            )),
            'waiting_count', (
                SELECT COUNT(*) FROM public.waitlist_entries w
                WHERE w.slot_id = s.id
                  AND w.booking_date = p_selected_date
                  AND w.status::text = 'waiting'
            ),
            'offered_count', (
                SELECT COUNT(*) FROM public.waitlist_entries w
                WHERE w.slot_id = s.id
                  AND w.booking_date = p_selected_date
                  AND w.status::text IN ('offered', 'allocated')
            ),
            'accepted_count', (
                SELECT COUNT(*) FROM public.waitlist_entries w
                WHERE w.slot_id = s.id
                  AND w.booking_date = p_selected_date
                  AND w.status::text = 'accepted'
            ),
            'expired_count', (
                SELECT COUNT(*) FROM public.waitlist_entries w
                WHERE w.slot_id = s.id
                  AND w.booking_date = p_selected_date
                  AND w.status::text = 'expired'
            ),
            'rejected_count', (
                SELECT COUNT(*) FROM public.waitlist_entries w
                WHERE w.slot_id = s.id
                  AND w.booking_date = p_selected_date
                  AND w.status::text = 'rejected'
            )
        )
        ORDER BY s.start_time ASC
    ) INTO v_slots_result
    FROM public.slots s
    LEFT JOIN public.rooms r ON r.library_id = p_library_id
    LEFT JOIN public.slot_occurrences so ON so.slot_id = s.id AND so.occurrence_date = p_selected_date AND so.library_id = p_library_id;

    RETURN COALESCE(v_slots_result, '[]'::jsonb);
END;
$$;

-- ====================================================================
-- RPC FUNCTION: GET ISOLATED WAITLIST QUEUE FOR SLOT OCCURRENCE
-- ====================================================================
DROP FUNCTION IF EXISTS public.get_waitlist_for_occurrence(uuid, date, text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.get_waitlist_for_occurrence(
    p_slot_id UUID,
    p_booking_date DATE,
    p_status_filter TEXT DEFAULT NULL,
    p_search_query TEXT DEFAULT NULL,
    p_page_size INTEGER DEFAULT 50,
    p_page_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rows JSONB;
    v_total_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_total_count
    FROM public.waitlist_entries w
    LEFT JOIN public.profiles p ON p.id = w.student_id
    WHERE w.slot_id = p_slot_id
      AND w.booking_date = p_booking_date
      AND (p_status_filter IS NULL OR p_status_filter = 'ALL' OR w.status::text = LOWER(p_status_filter))
      AND (
          p_search_query IS NULL OR p_search_query = '' OR
          p.full_name ILIKE '%' || p_search_query || '%' OR
          p.registration_number ILIKE '%' || p_search_query || '%' OR
          w.id::text ILIKE '%' || p_search_query || '%'
      );

    SELECT jsonb_agg(
        jsonb_build_object(
            'id', q.id,
            'student_id', q.student_id,
            'student_name', COALESCE(q.full_name, 'Student'),
            'registration_number', COALESCE(q.registration_number, 'N/A'),
            'department', COALESCE(q.department, 'Computer Science & Engineering'),
            'slot_id', q.slot_id,
            'booking_date', q.booking_date,
            'joined_at', q.created_at,
            'status', UPPER(q.status::text),
            'queue_position', q.computed_pos,
            'offered_seat_number', q.offered_seat_number,
            'offer_expires_at', q.offer_expires_at,
            'eligibility_status', 'ELIGIBLE',
            'is_test_data', COALESCE(q.is_test_data, false)
        )
        ORDER BY q.computed_pos ASC, q.created_at ASC
    ) INTO v_rows
    FROM (
        SELECT 
            w.id,
            w.student_id,
            w.slot_id,
            w.booking_date,
            w.status,
            w.created_at,
            w.offer_expires_at,
            w.is_test_data,
            p.full_name,
            p.registration_number,
            p.department,
            s.seat_number AS offered_seat_number,
            (
                SELECT COUNT(*) + 1 
                FROM public.waitlist_entries w2 
                WHERE w2.slot_id = w.slot_id 
                  AND w2.booking_date = w.booking_date 
                  AND w2.status::text IN ('waiting', 'offered', 'allocated')
                  AND (w2.created_at, w2.id) < (w.created_at, w.id)
            ) AS computed_pos
        FROM public.waitlist_entries w
        LEFT JOIN public.profiles p ON p.id = w.student_id
        LEFT JOIN public.seats s ON s.id = w.offered_seat_id
        WHERE w.slot_id = p_slot_id
          AND w.booking_date = p_booking_date
          AND (p_status_filter IS NULL OR p_status_filter = 'ALL' OR w.status::text = LOWER(p_status_filter))
          AND (
              p_search_query IS NULL OR p_search_query = '' OR
              p.full_name ILIKE '%' || p_search_query || '%' OR
              p.registration_number ILIKE '%' || p_search_query || '%' OR
              w.id::text ILIKE '%' || p_search_query || '%'
          )
        ORDER BY w.created_at ASC, w.id ASC
        LIMIT p_page_size OFFSET p_page_offset
    ) q;

    RETURN jsonb_build_object(
        'success', true,
        'slot_id', p_slot_id,
        'booking_date', p_booking_date,
        'total_count', COALESCE(v_total_count, 0),
        'entries', COALESCE(v_rows, '[]'::jsonb)
    );
END;
$$;
