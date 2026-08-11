-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 31: UPDATE SLOTS TABLE IS_ACTIVE SYNC
-- ====================================================================

-- 1. Update cancel_slot_and_notify_students to set slots.is_active = false
CREATE OR REPLACE FUNCTION public.cancel_slot_and_notify_students(
    p_slot_occurrence_id UUID,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_admin_id UUID := COALESCE(auth.uid(), (SELECT id FROM public.profiles WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1));
    v_clean_reason TEXT := NULLIF(TRIM(p_reason), '');
    v_occ_record RECORD;
    v_slot_record RECORD;
    v_affected_bookings_count INTEGER := 0;
    v_notifications_count INTEGER := 0;
    v_booking_rec RECORD;
    v_notif_exists BOOLEAN;
    v_start_time_str TEXT;
    v_end_time_str TEXT;
BEGIN
    IF v_admin_id IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated request. Administrator login required.';
    END IF;

    IF v_clean_reason IS NULL THEN
        RAISE EXCEPTION 'Cancellation reason is required. Please state why this slot is being cancelled.';
    END IF;

    SELECT * INTO v_occ_record
    FROM public.slot_occurrences
    WHERE id = p_slot_occurrence_id
    FOR UPDATE;

    IF v_occ_record.id IS NULL THEN
        RAISE EXCEPTION 'Slot occurrence record not found.';
    END IF;

    SELECT name, start_time, end_time INTO v_slot_record
    FROM public.slots
    WHERE id = v_occ_record.slot_id;

    v_start_time_str := TO_CHAR(v_slot_record.start_time, 'HH12:MI AM');
    v_end_time_str := TO_CHAR(v_slot_record.end_time, 'HH12:MI AM');

    -- Update public.slots table is_active = false
    UPDATE public.slots
    SET
        is_active = false,
        disabled_at = NOW(),
        disabled_by = v_admin_id,
        cancellation_reason = v_clean_reason,
        updated_at = NOW()
    WHERE id = v_occ_record.slot_id;

    -- Update public.slot_occurrences table
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
    WHERE id = p_slot_occurrence_id;

    -- Cancel connected active student bookings and send notifications
    FOR v_booking_rec IN
        SELECT b.id, b.student_id, b.booking_code
        FROM public.bookings b
        WHERE (b.slot_occurrence_id = p_slot_occurrence_id OR (b.slot_id = v_occ_record.slot_id AND b.booking_date = v_occ_record.occurrence_date))
          AND b.status IN ('confirmed', 'checked_in', 'awaiting_check_in')
    LOOP
        v_affected_bookings_count := v_affected_bookings_count + 1;

        UPDATE public.bookings
        SET
            status = 'cancelled',
            cancellation_source = 'admin_slot',
            cancelled_at = NOW(),
            cancelled_by = v_admin_id,
            cancellation_reason = v_clean_reason,
            updated_at = NOW()
        WHERE id = v_booking_rec.id;

        SELECT EXISTS (
            SELECT 1 FROM public.notifications
            WHERE recipient_id = v_booking_rec.student_id
              AND related_entity_id = v_booking_rec.id
              AND type = 'admin_slot_cancellation'
        ) INTO v_notif_exists;

        IF NOT v_notif_exists THEN
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
                    'admin_slot_cancellation',
                    'Slot Cancelled by Admin',
                    'Your reservation for ' || COALESCE(v_slot_record.name, 'Time Slot') || ' on ' || TO_CHAR(v_occ_record.occurrence_date, 'DD-MM-YYYY') || ' (' || COALESCE(v_start_time_str, '') || '–' || COALESCE(v_end_time_str, '') || ') has been cancelled by the administrator. Reason: ' || v_clean_reason,
                    'high',
                    'booking',
                    v_booking_rec.id,
                    false,
                    NOW()
                );
                v_notifications_count := v_notifications_count + 1;
            EXCEPTION WHEN OTHERS THEN /* non-blocking */ END;
        END IF;
    END LOOP;

    -- Audit log
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
            'SLOT_OCCURRENCE_CANCELLED',
            jsonb_build_object(
                'slot_occurrence_id', p_slot_occurrence_id,
                'slot_id', v_occ_record.slot_id,
                'occurrence_date', v_occ_record.occurrence_date,
                'reason', v_clean_reason,
                'affected_bookings_count', v_affected_bookings_count,
                'notifications_count', v_notifications_count
            ),
            NOW()
        );
    EXCEPTION WHEN OTHERS THEN /* non-blocking */ END;

    RETURN jsonb_build_object(
        'success', true,
        'slot_occurrence_id', p_slot_occurrence_id,
        'slot_id', v_occ_record.slot_id,
        'status', 'cancelled',
        'is_active', false,
        'is_booking_enabled', false,
        'cancellation_reason', v_clean_reason,
        'cancelled_at', NOW(),
        'cancelled_by', v_admin_id,
        'affected_bookings_count', v_affected_bookings_count,
        'notifications_count', v_notifications_count
    );
END;
$$;


-- 2. Update enable_slot_occurrence to set slots.is_active = true
CREATE OR REPLACE FUNCTION public.enable_slot_occurrence(
    p_slot_occurrence_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_admin_id UUID := COALESCE(auth.uid(), (SELECT id FROM public.profiles WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1));
    v_occurrence_date DATE;
    v_slot_id UUID;
    v_status TEXT;
    v_occurrence_json JSONB;
BEGIN
    IF v_admin_id IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated request. Administrator login required.';
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

    -- Update public.slots table is_active = true
    UPDATE public.slots
    SET
        is_active = true,
        disabled_at = NULL,
        disabled_by = NULL,
        cancellation_reason = NULL,
        updated_at = NOW()
    WHERE id = v_slot_id;

    -- Update public.slot_occurrences table
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

    -- Audit log
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
            jsonb_build_object('occurrence_id', p_slot_occurrence_id, 'slot_id', v_slot_id, 'date', v_occurrence_date),
            NOW()
        );
    EXCEPTION WHEN OTHERS THEN /* non-blocking */ END;

    SELECT jsonb_build_object(
        'success', true,
        'slot_occurrence_id', so.id,
        'slot_id', v_slot_id,
        'occurrence_date', so.occurrence_date,
        'status', so.status,
        'is_active', true,
        'is_booking_enabled', so.is_booking_enabled
    ) INTO v_occurrence_json
    FROM public.slot_occurrences so
    WHERE so.id = p_slot_occurrence_id;

    RETURN v_occurrence_json;
END;
$$;
