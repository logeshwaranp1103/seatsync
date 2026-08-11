-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 28: ADMIN STUDENT MANAGEMENT RPC & POLICIES
-- ====================================================================

-- 1. Create or replace RPC function to fetch all student profiles for Admin Management
CREATE OR REPLACE FUNCTION public.get_admin_students_list()
RETURNS TABLE (
    id UUID,
    full_name TEXT,
    email TEXT,
    registration_number TEXT,
    department TEXT,
    year_of_study INTEGER,
    phone TEXT,
    role TEXT,
    status TEXT,
    no_show_count INTEGER,
    created_at TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.id,
        COALESCE(p.full_name, 'Student') AS full_name,
        p.email,
        COALESCE(p.registration_number, p.login_identifier, 'N/A') AS registration_number,
        COALESCE(p.department, 'Computer Science & Engineering') AS department,
        COALESCE(p.year_of_study, 1) AS year_of_study,
        p.phone,
        p.role::text,
        COALESCE(p.status::text, p.account_status::text, 'active') AS status,
        COALESCE(p.no_show_count, 0) AS no_show_count,
        p.created_at,
        p.last_login_at
    FROM public.profiles p
    WHERE p.role = 'student'::user_role
    ORDER BY p.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_students_list() TO authenticated, anon;

-- 2. Create RPC function for Admin to block/unblock student accounts
CREATE OR REPLACE FUNCTION public.admin_toggle_student_status(
    p_student_id UUID,
    p_new_status TEXT,
    p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Access denied. Only system administrators can change student account status.';
    END IF;

    UPDATE public.profiles
    SET
        status = p_new_status::account_status,
        blocked_reason = CASE WHEN p_new_status = 'blocked' THEN COALESCE(p_reason, 'Restricted by administrator') ELSE NULL END,
        blocked_at = CASE WHEN p_new_status = 'blocked' THEN NOW() ELSE NULL END,
        no_show_count = CASE WHEN p_new_status = 'active' THEN 0 ELSE no_show_count END,
        updated_at = NOW()
    WHERE id = p_student_id;

    RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_toggle_student_status(UUID, TEXT, TEXT) TO authenticated;
