-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 37: STUDENT ACCESS MANAGEMENT ENGINE
-- ====================================================================

-- 1. Ensure Table Columns & Defaults on public.profiles, public.user_restrictions & public.audit_logs
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS account_status TEXT DEFAULT 'active';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS blocked_reason TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS blocked_by UUID;

ALTER TABLE public.audit_logs ALTER COLUMN id SET DEFAULT gen_random_uuid();

UPDATE public.profiles
SET account_status = COALESCE(LOWER(status::text), account_status, 'active')
WHERE account_status IS NULL OR account_status != LOWER(status::text);

-- Enhance public.user_restrictions & Drop NOT NULL on expires_at
ALTER TABLE public.user_restrictions ADD COLUMN IF NOT EXISTS student_id UUID;
ALTER TABLE public.user_restrictions ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE public.user_restrictions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE public.user_restrictions ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.user_restrictions ADD COLUMN IF NOT EXISTS blocked_by UUID;
ALTER TABLE public.user_restrictions ADD COLUMN IF NOT EXISTS unblocked_at TIMESTAMPTZ;
ALTER TABLE public.user_restrictions ADD COLUMN IF NOT EXISTS unblocked_by UUID;
ALTER TABLE public.user_restrictions ADD COLUMN IF NOT EXISTS unblock_reason TEXT;

ALTER TABLE public.user_restrictions ALTER COLUMN expires_at DROP NOT NULL;

-- Update constraint on restriction_type to accept login_access
ALTER TABLE public.user_restrictions DROP CONSTRAINT IF EXISTS user_restrictions_restriction_type_check;
ALTER TABLE public.user_restrictions ADD CONSTRAINT user_restrictions_restriction_type_check
CHECK (restriction_type IN ('login_access', 'booking_blocked', 'waitlist_blocked', 'account_suspended', 'account_blocked'));

-- Backfill missing user_restrictions columns
UPDATE public.user_restrictions
SET student_id = COALESCE(student_id, user_id),
    blocked_at = COALESCE(blocked_at, created_at, NOW()),
    blocked_by = COALESCE(blocked_by, created_by),
    status = CASE WHEN is_active = false THEN 'resolved' ELSE COALESCE(status, 'active') END
WHERE student_id IS NULL OR blocked_at IS NULL OR status IS NULL;

-- Create Partial Unique Index preventing multiple active access blocks for the same student
CREATE UNIQUE INDEX IF NOT EXISTS one_active_access_block_per_student
ON public.user_restrictions(student_id)
WHERE status = 'active';

-- Allow Staff and Librarians to view audit_logs
DROP POLICY IF EXISTS "Admins can view audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Staff and Admins can view audit logs" ON public.audit_logs;

CREATE POLICY "Staff and Admins can view audit logs" ON public.audit_logs
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND LOWER(role::text) IN ('admin', 'super_admin', 'librarian', 'senior_librarian', 'staff')
  )
);


-- 2. HELPER RPC: is_account_active()
DROP FUNCTION IF EXISTS public.is_account_active CASCADE;

CREATE OR REPLACE FUNCTION public.is_account_active(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status TEXT;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT LOWER(COALESCE(account_status, status::text, 'active')) INTO v_status
    FROM public.profiles
    WHERE id = p_user_id;

    RETURN COALESCE(v_status = 'active', FALSE);
END;
$$;


-- 3. RPC: block_student_access()
DROP FUNCTION IF EXISTS public.block_student_access CASCADE;

CREATE OR REPLACE FUNCTION public.block_student_access(
    p_student_id UUID,
    p_reason TEXT,
    p_category TEXT DEFAULT 'Policy violation',
    p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_staff_id UUID := auth.uid();
    v_staff_profile RECORD;
    v_target_profile RECORD;
    v_clean_reason TEXT := TRIM(COALESCE(p_reason, ''));
    v_clean_category TEXT := TRIM(COALESCE(p_category, 'Policy violation'));
    v_new_restriction_id UUID := gen_random_uuid();
    v_active_block RECORD;
BEGIN
    -- 1. Check Authentication
    IF v_staff_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Authentication required.');
    END IF;

    -- 2. Validate Staff Role
    SELECT id, full_name, role INTO v_staff_profile FROM public.profiles WHERE id = v_staff_id;
    IF v_staff_profile.id IS NULL OR LOWER(v_staff_profile.role::text) NOT IN ('librarian', 'senior_librarian', 'staff', 'admin', 'super_admin') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Access denied. Staff or Librarian role required to block access.');
    END IF;

    -- 3. Validate Reason
    IF v_clean_reason = '' THEN
        RETURN jsonb_build_object('success', false, 'message', 'A specific reason for blocking access is required.');
    END IF;

    -- 4. Validate Target Profile
    SELECT * INTO v_target_profile FROM public.profiles WHERE id = p_student_id FOR UPDATE;
    IF v_target_profile.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Student profile record not found.');
    END IF;

    -- 5. Anti-Self Blocking Guard
    IF v_staff_id = p_student_id THEN
        RETURN jsonb_build_object('success', false, 'message', 'You cannot block your own account.');
    END IF;

    -- 6. Role Hierarchy Protection: Librarians/Staff cannot block Admins or other Librarians
    IF LOWER(v_target_profile.role::text) IN ('admin', 'super_admin', 'librarian', 'senior_librarian', 'staff') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Librarians and Staff cannot block administrative or staff accounts.');
    END IF;

    -- 7. Check for existing active access block
    SELECT * INTO v_active_block
    FROM public.user_restrictions
    WHERE student_id = p_student_id AND status = 'active'
    LIMIT 1;

    IF v_active_block.id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Student already has an active access block (Reason: ' || COALESCE(v_active_block.reason, 'Blocked') || ').'
        );
    END IF;

    -- 8. Insert Immutable Historical Restriction Record
    INSERT INTO public.user_restrictions (
        id,
        user_id,
        student_id,
        restriction_type,
        status,
        reason,
        category,
        blocked_at,
        blocked_by,
        created_by,
        expires_at,
        is_active,
        created_at,
        updated_at
    ) VALUES (
        v_new_restriction_id,
        p_student_id,
        p_student_id,
        'login_access',
        'active',
        v_clean_reason,
        v_clean_category,
        NOW(),
        v_staff_id,
        v_staff_id,
        p_expires_at,
        true,
        NOW(),
        NOW()
    );

    -- 9. Update Current Access State in profiles
    UPDATE public.profiles
    SET
        account_status = 'blocked',
        status = 'blocked',
        blocked_reason = v_clean_reason,
        blocked_at = NOW(),
        blocked_by = v_staff_id,
        updated_at = NOW()
    WHERE id = p_student_id;

    -- 10. Audit Log
    BEGIN
        INSERT INTO public.audit_logs (id, actor_id, target_id, event_type, metadata, created_at)
        VALUES (
            gen_random_uuid(),
            v_staff_id,
            p_student_id,
            'STUDENT_ACCESS_BLOCKED',
            jsonb_build_object(
                'restriction_id', v_new_restriction_id,
                'student_name', v_target_profile.full_name,
                'reason', v_clean_reason,
                'category', v_clean_category
            ),
            NOW()
        );
    EXCEPTION WHEN OTHERS THEN NULL; END;

    -- 11. Activity Log
    BEGIN
        INSERT INTO public.activity_logs (user_id, action, details, created_at)
        VALUES (
            v_staff_id,
            'student_access_blocked',
            'Blocked student access for ' || COALESCE(v_target_profile.full_name, 'Student') || ' (' || v_clean_reason || ')',
            NOW()
        );
    EXCEPTION WHEN OTHERS THEN NULL; END;

    -- 12. Student Notification & Notification Outbox
    BEGIN
        INSERT INTO public.notifications (user_id, title, message, type, read, created_at)
        VALUES (
            p_student_id,
            'SeatSync Access Blocked',
            'Your SeatSync access was blocked by library staff. Reason: ' || v_clean_reason,
            'account_blocked',
            false,
            NOW()
        );
    EXCEPTION WHEN OTHERS THEN NULL; END;

    BEGIN
        INSERT INTO public.notification_outbox (user_id, channel, subject, content, status, created_at)
        VALUES (
            p_student_id,
            'email',
            'SeatSync Account Access Blocked',
            'Your SeatSync library access has been blocked. Reason: ' || v_clean_reason,
            'pending',
            NOW()
        );
    EXCEPTION WHEN OTHERS THEN NULL; END;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Student access blocked successfully.',
        'restriction_id', v_new_restriction_id,
        'student_id', p_student_id,
        'account_status', 'blocked'
    );
END;
$$;


-- 4. RPC: unblock_student_access()
DROP FUNCTION IF EXISTS public.unblock_student_access CASCADE;

CREATE OR REPLACE FUNCTION public.unblock_student_access(
    p_student_id UUID,
    p_unblock_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_staff_id UUID := auth.uid();
    v_staff_profile RECORD;
    v_target_profile RECORD;
    v_active_block RECORD;
    v_clean_reason TEXT := TRIM(COALESCE(p_unblock_reason, ''));
BEGIN
    -- 1. Check Authentication
    IF v_staff_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Authentication required.');
    END IF;

    -- 2. Validate Staff Role
    SELECT id, full_name, role INTO v_staff_profile FROM public.profiles WHERE id = v_staff_id;
    IF v_staff_profile.id IS NULL OR LOWER(v_staff_profile.role::text) NOT IN ('librarian', 'senior_librarian', 'staff', 'admin', 'super_admin') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Access denied. Staff or Librarian role required to unblock access.');
    END IF;

    -- 3. Validate Resolution Reason
    IF v_clean_reason = '' THEN
        RETURN jsonb_build_object('success', false, 'message', 'A resolution reason is required to unblock access.');
    END IF;

    -- 4. Validate Target Profile
    SELECT * INTO v_target_profile FROM public.profiles WHERE id = p_student_id FOR UPDATE;
    IF v_target_profile.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Student profile record not found.');
    END IF;

    -- 5. Find Active Block
    SELECT * INTO v_active_block
    FROM public.user_restrictions
    WHERE student_id = p_student_id AND status = 'active'
    FOR UPDATE;

    IF v_active_block.id IS NULL THEN
        -- Check if profile is blocked anyway
        IF LOWER(COALESCE(v_target_profile.account_status, v_target_profile.status::text, '')) != 'blocked' THEN
            RETURN jsonb_build_object('success', true, 'message', 'Student account is already active.');
        END IF;
    END IF;

    -- 6. Mark History Record Resolved (Preserving Original Block Record)
    IF v_active_block.id IS NOT NULL THEN
        UPDATE public.user_restrictions
        SET
            status = 'resolved',
            is_active = false,
            unblocked_at = NOW(),
            unblocked_by = v_staff_id,
            unblock_reason = v_clean_reason,
            updated_at = NOW()
        WHERE id = v_active_block.id;
    END IF;

    -- 7. Restore Current Profile Status
    UPDATE public.profiles
    SET
        account_status = 'active',
        status = 'active',
        blocked_reason = NULL,
        blocked_at = NULL,
        blocked_by = NULL,
        updated_at = NOW()
    WHERE id = p_student_id;

    -- 8. Audit Log
    BEGIN
        INSERT INTO public.audit_logs (id, actor_id, target_id, event_type, metadata, created_at)
        VALUES (
            gen_random_uuid(),
            v_staff_id,
            p_student_id,
            'STUDENT_ACCESS_UNBLOCKED',
            jsonb_build_object(
                'restriction_id', v_active_block.id,
                'student_name', v_target_profile.full_name,
                'unblock_reason', v_clean_reason
            ),
            NOW()
        );
    EXCEPTION WHEN OTHERS THEN NULL; END;

    -- 9. Activity Log
    BEGIN
        INSERT INTO public.activity_logs (user_id, action, details, created_at)
        VALUES (
            v_staff_id,
            'student_access_unblocked',
            'Unblocked student access for ' || COALESCE(v_target_profile.full_name, 'Student') || ' (' || v_clean_reason || ')',
            NOW()
        );
    EXCEPTION WHEN OTHERS THEN NULL; END;

    -- 10. Student Notification
    BEGIN
        INSERT INTO public.notifications (user_id, title, message, type, read, created_at)
        VALUES (
            p_student_id,
            'SeatSync Access Restored',
            'Your SeatSync account has been unblocked. Resolution: ' || v_clean_reason,
            'account_unblocked',
            false,
            NOW()
        );
    EXCEPTION WHEN OTHERS THEN NULL; END;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Student access unblocked successfully.',
        'student_id', p_student_id,
        'account_status', 'active'
    );
END;
$$;


-- 5. RPC: get_my_access_status()
DROP FUNCTION IF EXISTS public.get_my_access_status CASCADE;

CREATE OR REPLACE FUNCTION public.get_my_access_status()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_profile RECORD;
    v_blocker_name TEXT;
    v_active_restriction RECORD;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('authenticated', false);
    END IF;

    SELECT id, full_name, email, role, status, account_status, blocked_reason, blocked_at, blocked_by
    INTO v_profile
    FROM public.profiles
    WHERE id = v_user_id;

    IF v_profile.id IS NULL THEN
        RETURN jsonb_build_object('authenticated', true, 'account_status', 'active');
    END IF;

    IF v_profile.blocked_by IS NOT NULL THEN
        SELECT full_name INTO v_blocker_name FROM public.profiles WHERE id = v_profile.blocked_by;
    END IF;

    SELECT expires_at INTO v_active_restriction
    FROM public.user_restrictions
    WHERE student_id = v_user_id AND status = 'active'
    ORDER BY created_at DESC
    LIMIT 1;

    RETURN jsonb_build_object(
        'authenticated', true,
        'user_id', v_profile.id,
        'full_name', v_profile.full_name,
        'account_status', LOWER(COALESCE(v_profile.account_status, v_profile.status::text, 'active')),
        'blocked_reason', v_profile.blocked_reason,
        'blocked_at', v_profile.blocked_at,
        'blocked_by_display_name', COALESCE(v_blocker_name, 'Library Administration'),
        'expires_at', v_active_restriction.expires_at,
        'support_message', 'Your SeatSync account has been blocked by library staff.'
    );
END;
$$;


-- 6. RPC: get_student_access_block_report()
DROP FUNCTION IF EXISTS public.get_student_access_block_report CASCADE;

CREATE OR REPLACE FUNCTION public.get_student_access_block_report(
    p_status TEXT DEFAULT NULL,
    p_from_date DATE DEFAULT NULL,
    p_to_date DATE DEFAULT NULL,
    p_department TEXT DEFAULT NULL
)
RETURNS TABLE (
    block_record_id UUID,
    student_id UUID,
    student_name TEXT,
    registration_number TEXT,
    email TEXT,
    department TEXT,
    current_account_status TEXT,
    block_status TEXT,
    block_category TEXT,
    block_reason TEXT,
    blocked_at TIMESTAMPTZ,
    blocked_by_id UUID,
    blocked_by_name TEXT,
    expires_at TIMESTAMPTZ,
    unblocked_at TIMESTAMPTZ,
    unblocked_by_id UUID,
    unblocked_by_name TEXT,
    unblock_reason TEXT,
    duration TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        ur.id AS block_record_id,
        s.id AS student_id,
        COALESCE(s.full_name, s.email) AS student_name,
        s.registration_number,
        s.email,
        COALESCE(s.department, 'General') AS department,
        LOWER(COALESCE(s.account_status, s.status::text, 'active')) AS current_account_status,
        ur.status AS block_status,
        COALESCE(ur.category, 'Policy violation') AS block_category,
        ur.reason AS block_reason,
        ur.blocked_at,
        ur.blocked_by AS blocked_by_id,
        COALESCE(b_staff.full_name, 'Library Staff') AS blocked_by_name,
        ur.expires_at,
        ur.unblocked_at,
        ur.unblocked_by AS unblocked_by_id,
        u_staff.full_name AS unblocked_by_name,
        ur.unblock_reason,
        CASE
            WHEN ur.unblocked_at IS NOT NULL THEN
                TO_CHAR(ur.unblocked_at - ur.blocked_at, 'HH24h MIm')
            ELSE
                TO_CHAR(NOW() - ur.blocked_at, 'HH24h MIm')
        END AS duration
    FROM public.user_restrictions ur
    JOIN public.profiles s ON s.id = ur.student_id
    LEFT JOIN public.profiles b_staff ON b_staff.id = ur.blocked_by
    LEFT JOIN public.profiles u_staff ON u_staff.id = ur.unblocked_by
    WHERE (p_status IS NULL OR p_status = 'all' OR ur.status = p_status)
      AND (p_from_date IS NULL OR ur.blocked_at::DATE >= p_from_date)
      AND (p_to_date IS NULL OR ur.blocked_at::DATE <= p_to_date)
      AND (p_department IS NULL OR p_department = 'all' OR s.department ILIKE '%' || p_department || '%')
    ORDER BY ur.blocked_at DESC;
END;
$$;


-- 7. SECURITY GRANTS & REALTIME PUBLICATION
GRANT EXECUTE ON FUNCTION public.is_account_active(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.block_student_access(UUID, TEXT, TEXT, TIMESTAMPTZ) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.unblock_student_access(UUID, TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_my_access_status() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_student_access_block_report(TEXT, DATE, DATE, TEXT) TO authenticated, anon;
