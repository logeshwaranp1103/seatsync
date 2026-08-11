-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 39: NO-SHOW & STANDING MONITOR ENGINE
-- ====================================================================

-- 1. ENHANCE PUBLIC.NO_SHOW_RECORDS SCHEMA
ALTER TABLE public.no_show_records ADD COLUMN IF NOT EXISTS forgiven_at TIMESTAMPTZ;
ALTER TABLE public.no_show_records ADD COLUMN IF NOT EXISTS forgiven_by UUID REFERENCES public.profiles(id);
ALTER TABLE public.no_show_records ADD COLUMN IF NOT EXISTS forgiveness_reason TEXT;

-- Enforce uniqueness per booking_id so one booking cannot generate duplicate no-show records
CREATE UNIQUE INDEX IF NOT EXISTS no_show_records_booking_id_unique 
ON public.no_show_records (booking_id);

-- 2. CREATE FUNCTION: GET STUDENT NO-SHOW STANDINGS
DROP FUNCTION IF EXISTS public.get_student_no_show_standings CASCADE;

CREATE OR REPLACE FUNCTION public.get_student_no_show_standings(
    p_library_id UUID DEFAULT NULL
)
RETURNS TABLE (
    student_id UUID,
    student_name TEXT,
    college_id TEXT,
    department TEXT,
    no_show_count INT,
    max_no_shows INT,
    account_standing TEXT,
    is_restricted BOOLEAN,
    restriction_start_at TIMESTAMPTZ,
    restriction_end_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_is_staff BOOLEAN := FALSE;
    v_configured_max INT := 3;
BEGIN
    -- Determine caller role
    SELECT public.is_librarian_or_admin() INTO v_is_staff;

    -- Fetch max allowed no-shows from booking policy or fallback to 3
    SELECT COALESCE(maximum_no_show_count, 3) INTO v_configured_max
    FROM public.booking_policies
    WHERE (p_library_id IS NULL OR library_id = p_library_id)
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_configured_max IS NULL OR v_configured_max < 1 THEN
        v_configured_max := 3;
    END IF;

    RETURN QUERY
    WITH student_counts AS (
        SELECT 
            p.id AS s_id,
            p.full_name AS s_name,
            COALESCE(p.registration_number, p.phone, 'N/A') AS s_college_id,
            COALESCE(p.department, 'General') AS s_dept,
            COUNT(ns.id)::INT AS active_no_shows
        FROM public.profiles p
        LEFT JOIN public.no_show_records ns 
            ON ns.student_id = p.id 
           AND ns.forgiven_at IS NULL
        WHERE (p.role::text = 'student' OR p.role::text = 'STUDENT')
          AND (v_is_staff OR p.id = v_caller_id)
        GROUP BY p.id, p.full_name, p.registration_number, p.phone, p.department
    ),
    active_restrictions AS (
        SELECT 
            ur.student_id,
            ur.blocked_at AS start_at,
            ur.expires_at AS end_at,
            ROW_NUMBER() OVER (PARTITION BY ur.student_id ORDER BY ur.blocked_at DESC) AS rn
        FROM public.user_restrictions ur
        WHERE ur.status = 'active' OR ur.is_active IS TRUE
    )
    SELECT 
        sc.s_id AS student_id,
        sc.s_name AS student_name,
        sc.s_college_id AS college_id,
        sc.s_dept AS department,
        sc.active_no_shows AS no_show_count,
        v_configured_max AS max_no_shows,
        CASE
            WHEN ar.student_id IS NOT NULL OR sc.active_no_shows >= v_configured_max THEN 'Restricted'
            WHEN sc.active_no_shows = 0 THEN 'Good Standing'
            WHEN sc.active_no_shows = 1 THEN 'Warning'
            WHEN sc.active_no_shows = 2 THEN 'Final Warning'
            ELSE 'Restricted'
        END AS account_standing,
        (ar.student_id IS NOT NULL OR sc.active_no_shows >= v_configured_max) AS is_restricted,
        ar.start_at AS restriction_start_at,
        ar.end_at AS restriction_end_at
    FROM student_counts sc
    LEFT JOIN active_restrictions ar ON ar.student_id = sc.s_id AND ar.rn = 1
    ORDER BY (ar.student_id IS NOT NULL OR sc.active_no_shows >= v_configured_max) DESC,
             sc.active_no_shows DESC,
             sc.s_name ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_student_no_show_standings(UUID) TO authenticated, anon;


-- 3. CREATE FUNCTION: RESET STUDENT NO-SHOW STANDING
DROP FUNCTION IF EXISTS public.reset_student_no_show_standing CASCADE;

CREATE OR REPLACE FUNCTION public.reset_student_no_show_standing(
    p_student_id UUID,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_clean_reason TEXT := TRIM(COALESCE(p_reason, ''));
    v_forgiven_count INT := 0;
    v_student_name TEXT;
BEGIN
    -- Verify staff permissions
    IF NOT public.is_librarian_or_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only librarians and administrators can reset student standings.';
    END IF;

    -- Verify non-empty reason
    IF v_clean_reason = '' THEN
        RAISE EXCEPTION 'A valid resolution reason is required to reset student standing.';
    END IF;

    -- Verify target student profile exists
    SELECT full_name INTO v_student_name
    FROM public.profiles
    WHERE id = p_student_id;

    IF v_student_name IS NULL THEN
        RAISE EXCEPTION 'Student profile not found.';
    END IF;

    -- 1. Mark active unforgiven no-show records as forgiven
    UPDATE public.no_show_records
    SET forgiven_at = NOW(),
        forgiven_by = v_caller_id,
        forgiveness_reason = v_clean_reason
    WHERE student_id = p_student_id
      AND forgiven_at IS NULL;

    GET DIAGNOSTICS v_forgiven_count = ROW_COUNT;

    -- 2. Resolve any active user restriction for this student
    UPDATE public.user_restrictions
    SET is_active = FALSE,
        status = 'resolved',
        unblocked_at = NOW(),
        unblocked_by = v_caller_id,
        unblock_reason = v_clean_reason
    WHERE (student_id = p_student_id OR user_id = p_student_id)
      AND (status = 'active' OR is_active IS TRUE);

    -- 3. Reset profile standing status
    UPDATE public.profiles
    SET no_show_count = 0,
        account_status = 'active',
        status = 'active',
        blocked_reason = NULL,
        blocked_at = NULL,
        blocked_by = NULL,
        updated_at = NOW()
    WHERE id = p_student_id;

    -- 4. Log Audit Event
    INSERT INTO public.audit_logs (
        user_id,
        action,
        target_type,
        target_id,
        details
    ) VALUES (
        v_caller_id,
        'RESET_NO_SHOW_STANDING',
        'student',
        p_student_id,
        jsonb_build_object(
            'student_name', v_student_name,
            'reason', v_clean_reason,
            'forgiven_count', v_forgiven_count,
            'reset_by', v_caller_id,
            'timestamp', NOW()
        )
    );

    -- 5. Notify Student Outbox / Notifications
    INSERT INTO public.notifications (
        user_id,
        type,
        title,
        message
    ) VALUES (
        p_student_id,
        'NO_SHOW_RESET',
        'Account Standing Restored',
        'Your library no-show count and restrictions have been reset by staff. Reason: ' || v_clean_reason
    );

    RETURN jsonb_build_object(
        'success', true,
        'student_id', p_student_id,
        'forgiven_count', v_forgiven_count,
        'new_no_show_count', 0,
        'new_standing', 'Good Standing',
        'message', 'No-show standing successfully reset for ' || v_student_name
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_student_no_show_standing(UUID, TEXT) TO authenticated;


-- 4. CREATE FUNCTION: WARN STUDENT NO-SHOW
DROP FUNCTION IF EXISTS public.warn_student_no_show CASCADE;

CREATE OR REPLACE FUNCTION public.warn_student_no_show(
    p_student_id UUID,
    p_message TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_student_name TEXT;
    v_current_count INT := 0;
    v_max_allowed INT := 3;
    v_warning_msg TEXT;
BEGIN
    -- Verify staff permissions
    IF NOT public.is_librarian_or_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only librarians and administrators can issue student warnings.';
    END IF;

    -- Fetch student details & current no-show count
    SELECT 
        p.full_name,
        COUNT(ns.id)::INT
    INTO 
        v_student_name,
        v_current_count
    FROM public.profiles p
    LEFT JOIN public.no_show_records ns ON ns.student_id = p.id AND ns.forgiven_at IS NULL
    WHERE p.id = p_student_id
    GROUP BY p.full_name;

    IF v_student_name IS NULL THEN
        RAISE EXCEPTION 'Student profile not found.';
    END IF;

    -- Get configured max limit
    SELECT COALESCE(maximum_no_show_count, 3) INTO v_max_allowed
    FROM public.booking_policies
    ORDER BY created_at DESC LIMIT 1;

    IF v_max_allowed IS NULL OR v_max_allowed < 1 THEN
        v_max_allowed := 3;
    END IF;

    v_warning_msg := COALESCE(
        TRIM(p_message),
        'Attendance Warning: You currently have ' || v_current_count || ' / ' || v_max_allowed || 
        ' no-show offenses. Reaching ' || v_max_allowed || ' offenses will result in an automated 7-day seat booking restriction.'
    );

    -- 1. Create Notification
    INSERT INTO public.notifications (
        user_id,
        type,
        title,
        message
    ) VALUES (
        p_student_id,
        'NO_SHOW_WARNING',
        'Attendance Warning — 15 Min Grace Period Policy',
        v_warning_msg
    );

    -- 2. Create Outbox Item
    INSERT INTO public.notification_outbox (
        recipient_id,
        type,
        title,
        message,
        priority
    ) VALUES (
        p_student_id,
        'NO_SHOW_WARNING',
        'Attendance Warning',
        v_warning_msg,
        'HIGH'
    );

    -- 3. Log Audit Record
    INSERT INTO public.audit_logs (
        user_id,
        action,
        target_type,
        target_id,
        details
    ) VALUES (
        v_caller_id,
        'WARN_STUDENT_NO_SHOW',
        'student',
        p_student_id,
        jsonb_build_object(
            'student_name', v_student_name,
            'current_count', v_current_count,
            'max_allowed', v_max_allowed,
            'warning_message', v_warning_msg,
            'timestamp', NOW()
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'student_id', p_student_id,
        'student_name', v_student_name,
        'message', 'Warning notification successfully dispatched to ' || v_student_name
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.warn_student_no_show(UUID, TEXT) TO authenticated;


-- 5. UPDATE BATCH NO-SHOW PROCESSOR WITH IDEMPOTENT RESTRICTIONS
CREATE OR REPLACE FUNCTION public.process_no_shows_batch()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now_kolkata TIMESTAMPTZ := CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata';
    v_today_date DATE := v_now_kolkata::DATE;
    v_now_time TIME := v_now_kolkata::TIME;
    v_rec RECORD;
    v_processed_count INTEGER := 0;
    v_max_no_shows INTEGER := 3;
    v_unforgiven_count INTEGER := 0;
BEGIN
    -- Fetch policy threshold
    SELECT COALESCE(maximum_no_show_count, 3) INTO v_max_no_shows
    FROM public.booking_policies
    ORDER BY created_at DESC LIMIT 1;

    IF v_max_no_shows IS NULL OR v_max_no_shows < 1 THEN
        v_max_no_shows := 3;
    END IF;

    FOR v_rec IN
        SELECT b.id, b.student_id, b.seat_id, b.room_id, b.slot_id, b.booking_date, s.start_time
        FROM public.bookings b
        JOIN public.slots s ON s.id = b.slot_id
        WHERE b.status = 'confirmed'
          AND (
            b.booking_date < v_today_date OR
            (b.booking_date = v_today_date AND v_now_time > (s.start_time + INTERVAL '15 minutes')::TIME)
          )
        FOR UPDATE OF b
    LOOP
        -- Update booking status to no_show
        UPDATE public.bookings
        SET status = 'no_show',
            cancellation_reason = 'No-show grace period expired without check-in',
            updated_at = NOW()
        WHERE id = v_rec.id;

        -- Record no_show entry idempotently via UNIQUE (booking_id) constraint
        INSERT INTO public.no_show_records (booking_id, student_id, booking_date, slot_id)
        VALUES (v_rec.id, v_rec.student_id, v_rec.booking_date, v_rec.slot_id)
        ON CONFLICT (booking_id) DO NOTHING;

        -- Count current active unforgiven no-shows for this student
        SELECT COUNT(*)::INT INTO v_unforgiven_count
        FROM public.no_show_records
        WHERE student_id = v_rec.student_id AND forgiven_at IS NULL;

        -- Update profile no_show_count
        UPDATE public.profiles
        SET no_show_count = v_unforgiven_count,
            updated_at = NOW()
        WHERE id = v_rec.student_id;

        -- Outbox Notification
        INSERT INTO public.notification_outbox (
            recipient_id, type, title, message, priority
        ) VALUES (
            v_rec.student_id,
            'NO_SHOW_EXPIRED',
            'Reservation Marked No-Show',
            'Your reservation for ' || v_rec.booking_date || ' was marked no-show because check-in was not completed within the grace period.',
            'HIGH'
        );

        -- Apply automated 7-day restriction if threshold reached
        IF v_unforgiven_count >= v_max_no_shows THEN
            IF NOT EXISTS (
                SELECT 1 FROM public.user_restrictions 
                WHERE (student_id = v_rec.student_id OR user_id = v_rec.student_id)
                  AND (status = 'active' OR is_active IS TRUE)
            ) THEN
                INSERT INTO public.user_restrictions (
                    user_id,
                    student_id,
                    restriction_type,
                    category,
                    reason,
                    blocked_at,
                    expires_at,
                    is_active,
                    status
                ) VALUES (
                    v_rec.student_id,
                    v_rec.student_id,
                    'booking_blocked',
                    'Excessive No-Shows',
                    'Automated 7-day restriction: Exceeded ' || v_max_no_shows || ' no-show offenses',
                    NOW(),
                    NOW() + INTERVAL '7 days',
                    TRUE,
                    'active'
                );

                UPDATE public.profiles
                SET account_status = 'restricted',
                    status = 'restricted',
                    blocked_reason = 'Automated restriction: Exceeded ' || v_max_no_shows || ' no-shows',
                    blocked_at = NOW()
                WHERE id = v_rec.student_id;
            END IF;
        END IF;

        -- Promote next waitlisted student if seat freed
        PERFORM public.promote_next_waitlisted_student(v_rec.room_id, v_rec.slot_id, v_rec.booking_date, v_rec.seat_id);

        v_processed_count := v_processed_count + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'processed_count', v_processed_count,
        'timestamp', NOW()
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_no_shows_batch() TO authenticated;
