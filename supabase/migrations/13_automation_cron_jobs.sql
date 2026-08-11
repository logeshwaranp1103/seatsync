-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 13: AUTOMATION EXECUTION LOGS & CRON JOBS
-- ====================================================================

-- 1. Create Automation Execution Logs Table
CREATE TABLE IF NOT EXISTS public.automation_execution_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    automation_code TEXT NOT NULL,
    automation_name TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    status TEXT CHECK (status IN ('running', 'success', 'failed')) DEFAULT 'success',
    records_processed INTEGER DEFAULT 0,
    error_message TEXT,
    execution_source TEXT DEFAULT 'backend_cron',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for fast query retrieval on monitoring page
CREATE INDEX IF NOT EXISTS idx_auto_logs_code ON public.automation_execution_logs(automation_code);
CREATE INDEX IF NOT EXISTS idx_auto_logs_started ON public.automation_execution_logs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_auto_logs_status ON public.automation_execution_logs(status);

-- Enable RLS
ALTER TABLE public.automation_execution_logs ENABLE ROW LEVEL SECURITY;

-- Read policy for authenticated staff and admins
DROP POLICY IF EXISTS "Staff and Admins can view automation execution logs" ON public.automation_execution_logs;
CREATE POLICY "Staff and Admins can view automation execution logs"
    ON public.automation_execution_logs
    FOR SELECT
    USING (public.is_librarian_or_admin());

-- System insert policy
DROP POLICY IF EXISTS "System can insert automation execution logs" ON public.automation_execution_logs;
CREATE POLICY "System can insert automation execution logs"
    ON public.automation_execution_logs
    FOR INSERT
    WITH CHECK (true);

-- 2. AUTO-01: No-Show Grace Auto-Release Function
CREATE OR REPLACE FUNCTION public.fn_run_auto_01_no_show_release()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_count INTEGER := 0;
    v_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE;
    v_grace_mins INTEGER := 15;
    v_rec RECORD;
    v_log_id UUID;
BEGIN
    INSERT INTO public.automation_execution_logs (automation_code, automation_name, status, execution_source)
    VALUES ('AUTO-01', 'No-Show Grace Auto-Release', 'running', 'backend_cron')
    RETURNING id INTO v_log_id;

    FOR v_rec IN
        SELECT b.id, b.student_id, b.seat_id, b.room_id, b.slot_id, s.start_time
        FROM public.bookings b
        JOIN public.slots s ON s.id = b.slot_id
        WHERE b.booking_date = v_today
          AND b.status IN ('confirmed', 'awaiting_check_in')
          AND (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::TIME > (s.start_time + (v_grace_mins || ' minutes')::INTERVAL)
    LOOP
        -- Mark as no-show
        UPDATE public.bookings
        SET status = 'no_show', updated_at = now()
        WHERE id = v_rec.id;

        -- Record no-show penalty log
        INSERT INTO public.no_show_records (student_id, booking_id, date, slot_id, created_at)
        VALUES (v_rec.student_id, v_rec.id, v_today, v_rec.slot_id, now())
        ON CONFLICT DO NOTHING;

        -- Notify student
        INSERT INTO public.notifications (recipient_id, type, title, message, related_booking_id)
        VALUES (
            v_rec.student_id,
            'no_show',
            'Booking Marked No-Show',
            'Your reservation was cancelled as the 15-minute check-in grace period expired.',
            v_rec.id
        );

        -- Trigger waitlist allocation
        PERFORM public.allocate_next_waitlisted_student(v_rec.room_id, v_today, v_rec.slot_id);

        v_count := v_count + 1;
    END LOOP;

    -- Update execution log
    UPDATE public.automation_execution_logs
    SET completed_at = now(), status = 'success', records_processed = v_count
    WHERE id = v_log_id;

    RETURN v_count;
EXCEPTION WHEN OTHERS THEN
    IF v_log_id IS NOT NULL THEN
        UPDATE public.automation_execution_logs
        SET completed_at = now(), status = 'failed', error_message = SQLERRM
        WHERE id = v_log_id;
    END IF;
    RETURN 0;
END;
$$;

-- 3. AUTO-02: Waitlist Auto-Allocation Function
CREATE OR REPLACE FUNCTION public.fn_run_auto_02_waitlist_allocation()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_count INTEGER := 0;
    v_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE;
    v_rec RECORD;
    v_log_id UUID;
BEGIN
    INSERT INTO public.automation_execution_logs (automation_code, automation_name, status, execution_source)
    VALUES ('AUTO-02', 'Waitlist Auto-Allocation', 'running', 'backend_cron')
    RETURNING id INTO v_log_id;

    FOR v_rec IN
        SELECT DISTINCT room_id, slot_id
        FROM public.waitlist_entries
        WHERE booking_date = v_today AND status = 'waiting'
    LOOP
        IF public.allocate_next_waitlisted_student(v_rec.room_id, v_today, v_rec.slot_id) THEN
            v_count := v_count + 1;
        END IF;
    END LOOP;

    UPDATE public.automation_execution_logs
    SET completed_at = now(), status = 'success', records_processed = v_count
    WHERE id = v_log_id;

    RETURN v_count;
EXCEPTION WHEN OTHERS THEN
    IF v_log_id IS NOT NULL THEN
        UPDATE public.automation_execution_logs
        SET completed_at = now(), status = 'failed', error_message = SQLERRM
        WHERE id = v_log_id;
    END IF;
    RETURN 0;
END;
$$;

-- 4. AUTO-03: Waitlist Offer Expiration Function
CREATE OR REPLACE FUNCTION public.fn_run_auto_03_waitlist_expiration()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_count INTEGER := 0;
    v_rec RECORD;
    v_log_id UUID;
BEGIN
    INSERT INTO public.automation_execution_logs (automation_code, automation_name, status, execution_source)
    VALUES ('AUTO-03', 'Waitlist Offer Expiration', 'running', 'backend_cron')
    RETURNING id INTO v_log_id;

    FOR v_rec IN
        SELECT id, student_id, room_id, booking_date, slot_id
        FROM public.waitlist_entries
        WHERE status = 'allocated' AND expires_at < now()
    LOOP
        UPDATE public.waitlist_entries
        SET status = 'expired'
        WHERE id = v_rec.id;

        INSERT INTO public.notifications (recipient_id, type, title, message)
        VALUES (
            v_rec.student_id,
            'waitlist_allocated',
            'Waitlist Offer Expired',
            'Your allocated seat reservation claim expired.'
        );

        PERFORM public.allocate_next_waitlisted_student(v_rec.room_id, v_rec.booking_date, v_rec.slot_id);
        v_count := v_count + 1;
    END LOOP;

    UPDATE public.automation_execution_logs
    SET completed_at = now(), status = 'success', records_processed = v_count
    WHERE id = v_log_id;

    RETURN v_count;
EXCEPTION WHEN OTHERS THEN
    IF v_log_id IS NOT NULL THEN
        UPDATE public.automation_execution_logs
        SET completed_at = now(), status = 'failed', error_message = SQLERRM
        WHERE id = v_log_id;
    END IF;
    RETURN 0;
END;
$$;

-- 5. AUTO-04: Occupancy Threshold Alert Function
CREATE OR REPLACE FUNCTION public.fn_run_auto_04_occupancy_alerts()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_count INTEGER := 0;
    v_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE;
    v_room RECORD;
    v_total INTEGER;
    v_occupied INTEGER;
    v_pct INTEGER;
    v_log_id UUID;
    v_staff_id UUID;
BEGIN
    INSERT INTO public.automation_execution_logs (automation_code, automation_name, status, execution_source)
    VALUES ('AUTO-04', 'Occupancy Threshold Alert', 'running', 'backend_cron')
    RETURNING id INTO v_log_id;

    FOR v_room IN SELECT id, name, capacity FROM public.rooms WHERE is_active = true LOOP
        SELECT COUNT(*) INTO v_total FROM public.seats WHERE room_id = v_room.id AND status = 'available';
        IF v_room.capacity > 0 THEN
            SELECT COUNT(*) INTO v_occupied FROM public.bookings WHERE room_id = v_room.id AND booking_date = v_today AND status = 'checked_in';
            v_pct := ROUND((v_occupied::NUMERIC / v_room.capacity::NUMERIC) * 100);

            IF v_pct >= 90 THEN
                FOR v_staff_id IN SELECT id FROM public.profiles WHERE role IN ('librarian', 'senior_librarian', 'admin', 'super_admin') LOOP
                    INSERT INTO public.notifications (recipient_id, type, title, message, priority)
                    VALUES (
                        v_staff_id,
                        'maintenance_notice',
                        'High Occupancy Alert (>=90%)',
                        'Room ' || v_room.name || ' has reached ' || v_pct || '% occupancy capacity.',
                        'URGENT'
                    );
                END LOOP;
                v_count := v_count + 1;
            END IF;
        END IF;
    END LOOP;

    UPDATE public.automation_execution_logs
    SET completed_at = now(), status = 'success', records_processed = v_count
    WHERE id = v_log_id;

    RETURN v_count;
EXCEPTION WHEN OTHERS THEN
    IF v_log_id IS NOT NULL THEN
        UPDATE public.automation_execution_logs
        SET completed_at = now(), status = 'failed', error_message = SQLERRM
        WHERE id = v_log_id;
    END IF;
    RETURN 0;
END;
$$;

-- 6. Register Cron Schedules via pg_cron extension
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.schedule('auto-01-no-show-release', '*/5 * * * *', 'SELECT public.fn_run_auto_01_no_show_release()');
        PERFORM cron.schedule('auto-02-waitlist-allocation', '*/5 * * * *', 'SELECT public.fn_run_auto_02_waitlist_allocation()');
        PERFORM cron.schedule('auto-03-waitlist-expiration', '*/5 * * * *', 'SELECT public.fn_run_auto_03_waitlist_expiration()');
        PERFORM cron.schedule('auto-04-occupancy-alerts', '*/5 * * * *', 'SELECT public.fn_run_auto_04_occupancy_alerts()');
    END IF;
END $$;
