-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 30: ADMIN SLOT CANCELLATION WORKFLOW & NOTIFICATIONS
-- ====================================================================

-- 1. Ensure cancellation_source column exists on public.bookings
ALTER TABLE public.bookings
    ADD COLUMN IF NOT EXISTS cancellation_source TEXT DEFAULT 'student';

-- Update legacy bookings cancellation_source if missing
UPDATE public.bookings
SET cancellation_source = 'admin_slot'
WHERE status = 'cancelled' AND cancellation_reason IS NOT NULL AND cancellation_source IS NULL;


-- 2. Create atomic cancel_slot_and_notify_students() RPC function
DROP FUNCTION IF EXISTS public.cancel_slot_and_notify_students CASCADE;

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
    -- 1. Validate administrator identity
    IF v_admin_id IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated request. Administrator login required.';
    END IF;

    -- 2. Validate non-empty cancellation reason
    IF v_clean_reason IS NULL THEN
        RAISE EXCEPTION 'Cancellation reason is required. Please state why this slot is being cancelled.';
    END IF;

    -- 3. Lock and retrieve slot_occurrence
    SELECT * INTO v_occ_record
    FROM public.slot_occurrences
    WHERE id = p_slot_occurrence_id
    FOR UPDATE;

    IF v_occ_record.id IS NULL THEN
        RAISE EXCEPTION 'Slot occurrence record not found.';
    END IF;

    -- 4. Retrieve slot definition details
    SELECT name, start_time, end_time INTO v_slot_record
    FROM public.slots
    WHERE id = v_occ_record.slot_id;

    v_start_time_str := TO_CHAR(v_slot_record.start_time, 'HH12:MI AM');
    v_end_time_str := TO_CHAR(v_slot_record.end_time, 'HH12:MI AM');

    -- 5. Update slot_occurrence to cancelled
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

    -- 6. Cancel connected active bookings and generate notifications
    FOR v_booking_rec IN
        SELECT b.id, b.student_id, b.booking_code
        FROM public.bookings b
        WHERE (b.slot_occurrence_id = p_slot_occurrence_id OR (b.slot_id = v_occ_record.slot_id AND b.booking_date = v_occ_record.occurrence_date AND b.room_id = v_occ_record.room_id))
          AND b.status IN ('confirmed', 'checked_in', 'awaiting_check_in')
    LOOP
        v_affected_bookings_count := v_affected_bookings_count + 1;

        -- Update booking status to cancelled with cancellation_source = 'admin_slot'
        UPDATE public.bookings
        SET
            status = 'cancelled',
            cancellation_source = 'admin_slot',
            cancelled_at = NOW(),
            cancelled_by = v_admin_id,
            cancellation_reason = v_clean_reason,
            updated_at = NOW()
        WHERE id = v_booking_rec.id;

        -- Check if notification already exists for this booking cancellation (deduplication)
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

    -- 7. Write entry to audit_logs
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

    -- Return JSON summary
    RETURN jsonb_build_object(
        'success', true,
        'slot_occurrence_id', p_slot_occurrence_id,
        'status', 'cancelled',
        'is_booking_enabled', false,
        'cancellation_reason', v_clean_reason,
        'cancelled_at', NOW(),
        'cancelled_by', v_admin_id,
        'affected_bookings_count', v_affected_bookings_count,
        'notifications_count', v_notifications_count
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_slot_and_notify_students(UUID, TEXT) TO authenticated;
