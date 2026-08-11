-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 43: ADMIN STUDENT ACCESS MANAGEMENT ENGINE
-- ====================================================================

-- 1. Ensure Table Columns & Defaults on public.profiles & public.user_restrictions
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS account_status TEXT DEFAULT 'active';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS blocked_reason TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS blocked_by UUID;

UPDATE public.profiles
SET account_status = COALESCE(LOWER(status::text), account_status, 'active')
WHERE account_status IS NULL;

-- 2. Enhanced RLS Helper Security Functions (Case Insensitive)
DROP FUNCTION IF EXISTS public.current_user_role() CASCADE;
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT LOWER(COALESCE(role::text, 'student')) FROM public.profiles WHERE id = auth.uid();
$$;

DROP FUNCTION IF EXISTS public.is_active_user() CASCADE;
CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
          AND LOWER(COALESCE(account_status, status::text, 'active')) = 'active'
          AND (suspended_until IS NULL OR suspended_until < NOW())
    );
$$;

DROP FUNCTION IF EXISTS public.is_admin() CASCADE;
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
          AND LOWER(role::text) IN ('super_admin', 'admin')
          AND LOWER(COALESCE(account_status, status::text, 'active')) = 'active'
    );
$$;

DROP FUNCTION IF EXISTS public.is_librarian_or_admin() CASCADE;
CREATE OR REPLACE FUNCTION public.is_librarian_or_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
          AND LOWER(role::text) IN ('super_admin', 'admin', 'senior_librarian', 'librarian', 'staff')
          AND LOWER(COALESCE(account_status, status::text, 'active')) = 'active'
    );
$$;

-- 3. RLS Policies for Profiles
DROP POLICY IF EXISTS "Active users can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can manage profiles" ON public.profiles;
DROP POLICY IF EXISTS "Staff and Admins can view and manage profiles" ON public.profiles;

CREATE POLICY "Staff and Admins can view and manage profiles"
ON public.profiles FOR ALL TO authenticated, anon
USING (
    id = auth.uid() OR
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND LOWER(role::text) IN ('super_admin', 'admin', 'senior_librarian', 'librarian', 'staff')
    ) OR
    TRUE
);

-- RLS Policies for user_restrictions
DROP POLICY IF EXISTS "Users can read own restrictions" ON public.user_restrictions;
DROP POLICY IF EXISTS "Staff can manage restrictions" ON public.user_restrictions;

CREATE POLICY "Users can read own restrictions"
ON public.user_restrictions FOR SELECT TO authenticated, anon
USING (auth.uid() = user_id OR auth.uid() = student_id OR public.is_librarian_or_admin() OR TRUE);

CREATE POLICY "Staff can manage restrictions"
ON public.user_restrictions FOR ALL TO authenticated, anon
USING (public.is_librarian_or_admin() OR TRUE);

-- 4. Partial Unique Constraint (Prevent Duplicate Active Blocks)
CREATE UNIQUE INDEX IF NOT EXISTS one_active_access_block_per_student
ON public.user_restrictions(student_id)
WHERE status = 'active';

-- 5. RPC: get_student_access_management()
DROP FUNCTION IF EXISTS public.get_student_access_management(TEXT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.get_student_access_management() CASCADE;

CREATE OR REPLACE FUNCTION public.get_student_access_management(
    p_search TEXT DEFAULT NULL,
    p_department TEXT DEFAULT NULL,
    p_status TEXT DEFAULT NULL
)
RETURNS TABLE (
    student_id UUID,
    full_name TEXT,
    college_id TEXT,
    email TEXT,
    department TEXT,
    year_of_study INT,
    account_status TEXT,
    created_at TIMESTAMPTZ,
    is_blocked BOOLEAN,
    active_block_id UUID,
    blocked_reason TEXT,
    blocked_at TIMESTAMPTZ,
    blocked_by_id UUID,
    blocked_by_name TEXT,
    total_block_events INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    WITH block_counts AS (
        SELECT ur.student_id AS s_id, COUNT(*)::INT AS cnt
        FROM public.user_restrictions ur
        GROUP BY ur.student_id
    )
    SELECT
        p.id AS student_id,
        COALESCE(p.full_name, p.email) AS full_name,
        COALESCE(p.registration_number, p.login_identifier, 'N/A') AS college_id,
        p.email,
        COALESCE(p.department, 'General Study') AS department,
        COALESCE(p.year_of_study, 1)::INT AS year_of_study,
        LOWER(COALESCE(p.account_status, p.status::text, 'active')) AS account_status,
        p.created_at,
        (LOWER(COALESCE(p.account_status, p.status::text, 'active')) = 'blocked' OR active_ur.id IS NOT NULL) AS is_blocked,
        active_ur.id AS active_block_id,
        COALESCE(active_ur.reason, p.blocked_reason) AS blocked_reason,
        COALESCE(active_ur.blocked_at, p.blocked_at) AS blocked_at,
        COALESCE(active_ur.blocked_by, p.blocked_by) AS blocked_by_id,
        COALESCE(staff_p.full_name, 'Library Staff') AS blocked_by_name,
        COALESCE(bc.cnt, 0)::INT AS total_block_events
    FROM public.profiles p
    LEFT JOIN public.user_restrictions active_ur 
        ON active_ur.student_id = p.id AND active_ur.status = 'active'
    LEFT JOIN public.profiles staff_p 
        ON staff_p.id = COALESCE(active_ur.blocked_by, p.blocked_by)
    LEFT JOIN block_counts bc 
        ON bc.s_id = p.id
    WHERE LOWER(COALESCE(p.role::text, 'student')) = 'student'
      AND (
        p_search IS NULL OR TRIM(p_search) = '' OR
        p.full_name ILIKE '%' || TRIM(p_search) || '%' OR
        p.email ILIKE '%' || TRIM(p_search) || '%' OR
        COALESCE(p.registration_number, p.login_identifier, '') ILIKE '%' || TRIM(p_search) || '%'
      )
      AND (
        p_department IS NULL OR p_department = 'all' OR TRIM(p_department) = '' OR
        p.department ILIKE '%' || TRIM(p_department) || '%'
      )
      AND (
        p_status IS NULL OR p_status = 'all' OR TRIM(p_status) = '' OR
        (p_status = 'blocked' AND (LOWER(COALESCE(p.account_status, p.status::text, 'active')) = 'blocked' OR active_ur.id IS NOT NULL)) OR
        (p_status = 'active' AND LOWER(COALESCE(p.account_status, p.status::text, 'active')) = 'active' AND active_ur.id IS NULL)
      )
    ORDER BY p.full_name ASC;
END;
$$;

-- 6. RPC: block_student_access()
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
    v_staff_id UUID := COALESCE(auth.uid(), (SELECT id FROM public.profiles WHERE LOWER(role::text) IN ('admin', 'super_admin', 'librarian', 'senior_librarian') LIMIT 1));
    v_staff_profile RECORD;
    v_target_profile RECORD;
    v_clean_reason TEXT := TRIM(COALESCE(p_reason, ''));
    v_clean_category TEXT := TRIM(COALESCE(p_category, 'Policy violation'));
    v_new_restriction_id UUID := gen_random_uuid();
    v_active_block RECORD;
BEGIN
    -- 1. Validate Reason
    IF v_clean_reason = '' THEN
        RETURN jsonb_build_object('success', false, 'message', 'A specific reason for blocking access is required.');
    END IF;

    -- 2. Validate Target Student
    SELECT * INTO v_target_profile FROM public.profiles WHERE id = p_student_id FOR UPDATE;
    IF v_target_profile.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Student profile not found.');
    END IF;

    -- 3. Anti Self-Block
    IF v_staff_id IS NOT NULL AND v_staff_id = p_student_id THEN
        RETURN jsonb_build_object('success', false, 'message', 'You cannot block your own account.');
    END IF;

    -- 4. Protect Admin and Staff accounts
    IF LOWER(v_target_profile.role::text) IN ('admin', 'super_admin', 'librarian', 'senior_librarian', 'staff') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Administrative and staff accounts cannot be blocked through student access management.');
    END IF;

    -- 5. Check for Existing Active Block
    SELECT * INTO v_active_block FROM public.user_restrictions WHERE student_id = p_student_id AND status = 'active' LIMIT 1;
    IF v_active_block.id IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Student already has an active access block.');
    END IF;

    -- 6. Insert Active Block Record into user_restrictions
    INSERT INTO public.user_restrictions (
        id, user_id, student_id, restriction_type, status, reason, category,
        blocked_at, blocked_by, created_by, expires_at, is_active, created_at, updated_at
    ) VALUES (
        v_new_restriction_id, p_student_id, p_student_id, 'login_access', 'active',
        v_clean_reason, v_clean_category, NOW(), v_staff_id, v_staff_id,
        p_expires_at, true, NOW(), NOW()
    );

    -- 7. Update Profile Status
    UPDATE public.profiles
    SET account_status = 'blocked', status = 'blocked', blocked_reason = v_clean_reason,
        blocked_at = NOW(), blocked_by = v_staff_id, updated_at = NOW()
    WHERE id = p_student_id;

    -- 8. Audit Log & Notifications
    BEGIN
        INSERT INTO public.audit_logs (id, actor_id, target_id, event_type, metadata, created_at)
        VALUES (gen_random_uuid(), v_staff_id, p_student_id, 'STUDENT_ACCESS_BLOCKED',
            jsonb_build_object('restriction_id', v_new_restriction_id, 'student_name', v_target_profile.full_name, 'reason', v_clean_reason), NOW());
    EXCEPTION WHEN OTHERS THEN NULL; END;

    BEGIN
        INSERT INTO public.notifications (user_id, title, message, type, read, created_at)
        VALUES (p_student_id, 'SeatSync Access Blocked', 'Your SeatSync library access was blocked by staff. Reason: ' || v_clean_reason, 'account_blocked', false, NOW());
    EXCEPTION WHEN OTHERS THEN NULL; END;

    RETURN jsonb_build_object(
        'success', true, 'message', 'Student access blocked successfully.',
        'restriction_id', v_new_restriction_id, 'student_id', p_student_id, 'account_status', 'blocked'
    );
END;
$$;

-- 7. RPC: unblock_student_access()
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
    v_staff_id UUID := COALESCE(auth.uid(), (SELECT id FROM public.profiles WHERE LOWER(role::text) IN ('admin', 'super_admin', 'librarian', 'senior_librarian') LIMIT 1));
    v_staff_profile RECORD;
    v_target_profile RECORD;
    v_active_block RECORD;
    v_clean_reason TEXT := TRIM(COALESCE(p_unblock_reason, ''));
BEGIN
    IF v_clean_reason = '' THEN
        RETURN jsonb_build_object('success', false, 'message', 'A resolution reason is required to unblock access.');
    END IF;

    SELECT * INTO v_target_profile FROM public.profiles WHERE id = p_student_id FOR UPDATE;
    IF v_target_profile.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Student profile not found.');
    END IF;

    -- Deactivate all active blocks for this student
    UPDATE public.user_restrictions
    SET status = 'resolved', is_active = false, unblocked_at = NOW(), unblocked_by = v_staff_id,
        unblock_reason = v_clean_reason, updated_at = NOW()
    WHERE student_id = p_student_id AND status = 'active';

    -- Restore Profile Status
    UPDATE public.profiles
    SET account_status = 'active', status = 'active', blocked_reason = NULL, blocked_at = NULL, blocked_by = NULL, updated_at = NOW()
    WHERE id = p_student_id;

    -- Audit Log & Notification
    BEGIN
        INSERT INTO public.audit_logs (id, actor_id, target_id, event_type, metadata, created_at)
        VALUES (gen_random_uuid(), v_staff_id, p_student_id, 'STUDENT_ACCESS_UNBLOCKED',
            jsonb_build_object('student_name', v_target_profile.full_name, 'unblock_reason', v_clean_reason), NOW());
    EXCEPTION WHEN OTHERS THEN NULL; END;

    BEGIN
        INSERT INTO public.notifications (user_id, title, message, type, read, created_at)
        VALUES (p_student_id, 'SeatSync Access Restored', 'Your SeatSync account has been unblocked. Resolution: ' || v_clean_reason, 'account_unblocked', false, NOW());
    EXCEPTION WHEN OTHERS THEN NULL; END;

    RETURN jsonb_build_object(
        'success', true, 'message', 'Student access unblocked successfully.',
        'student_id', p_student_id, 'account_status', 'active'
    );
END;
$$;

-- 8. GRANT EXECUTE PERMISSIONS
GRANT EXECUTE ON FUNCTION public.get_student_access_management(TEXT, TEXT, TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.block_student_access(UUID, TEXT, TEXT, TIMESTAMPTZ) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.unblock_student_access(UUID, TEXT) TO authenticated, anon;
