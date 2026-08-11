-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 25: SUPABASE AUTH & PUBLIC.PROFILES INTEGRATION
-- ====================================================================

-- 1. Ensure user_role and account_status enum types exist
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('student', 'librarian', 'senior_librarian', 'support_staff', 'admin', 'super_admin', 'report_viewer');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_status') THEN
        CREATE TYPE account_status AS ENUM ('active', 'blocked', 'suspended', 'inactive', 'pending_verification');
    END IF;
END $$;

-- 2. Ensure all required columns exist on public.profiles
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS staff_id TEXT,
    ADD COLUMN IF NOT EXISTS admin_id TEXT,
    ADD COLUMN IF NOT EXISTS login_identifier TEXT,
    ADD COLUMN IF NOT EXISTS phone TEXT,
    ADD COLUMN IF NOT EXISTS avatar_url TEXT,
    ADD COLUMN IF NOT EXISTS year_of_study INTEGER DEFAULT 1,
    ADD COLUMN IF NOT EXISTS failed_login_count INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS blocked_reason TEXT,
    ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS blocked_by UUID,
    ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS no_show_count INTEGER DEFAULT 0;

-- Unique lower index on login_identifier & registration_number
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_login_identifier_lower ON public.profiles (LOWER(login_identifier)) WHERE login_identifier IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_reg_num_lower ON public.profiles (LOWER(registration_number)) WHERE registration_number IS NOT NULL;

-- 3. Idempotent PostgreSQL Trigger on auth.users for Automatic Profile Creation
CREATE OR REPLACE FUNCTION public.handle_new_user_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_full_name TEXT;
    v_reg_num TEXT;
    v_dept TEXT;
    v_year INTEGER;
    v_email_clean TEXT;
BEGIN
    v_email_clean := LOWER(TRIM(NEW.email));
    v_full_name := COALESCE(
        NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
        NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), ''),
        NULLIF(TRIM(NEW.raw_user_meta_data->>'display_name'), ''),
        SPLIT_PART(v_email_clean, '@', 1)
    );
    v_reg_num := NULLIF(TRIM(NEW.raw_user_meta_data->>'registration_number'), '');
    v_dept := NULLIF(TRIM(NEW.raw_user_meta_data->>'department'), '');
    v_year := COALESCE((NEW.raw_user_meta_data->>'year_of_study')::INTEGER, 1);

    -- Strict Rule: Public signups default strictly to student role.
    -- Metadata cannot escalate to admin, librarian, or super_admin.
    INSERT INTO public.profiles (
        id,
        full_name,
        email,
        registration_number,
        login_identifier,
        department,
        year_of_study,
        role,
        status,
        created_at,
        updated_at
    ) VALUES (
        NEW.id,
        v_full_name,
        v_email_clean,
        v_reg_num,
        v_email_clean,
        v_dept,
        v_year,
        'student'::user_role,
        'active'::account_status,
        COALESCE(NEW.created_at, NOW()),
        NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        login_identifier = EXCLUDED.login_identifier,
        full_name = CASE WHEN public.profiles.full_name IS NULL OR public.profiles.full_name = '' THEN EXCLUDED.full_name ELSE public.profiles.full_name END,
        registration_number = COALESCE(public.profiles.registration_number, EXCLUDED.registration_number),
        department = COALESCE(public.profiles.department, EXCLUDED.department),
        updated_at = NOW();

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user_signup();


-- 4. Login-Time Profile Synchronization RPC: ensure_my_profile()
DROP FUNCTION IF EXISTS public.ensure_my_profile() CASCADE;

CREATE OR REPLACE FUNCTION public.ensure_my_profile()
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_auth_email TEXT;
    v_user_meta JSONB;
    v_created_at TIMESTAMPTZ;
    v_profile public.profiles%ROWTYPE;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated request';
    END IF;

    -- Fetch user details from auth.users
    SELECT email, raw_user_meta_data, created_at
    INTO v_auth_email, v_user_meta, v_created_at
    FROM auth.users
    WHERE id = v_user_id;

    IF v_auth_email IS NULL THEN
        RAISE EXCEPTION 'Auth user record not found';
    END IF;

    -- Insert missing profile or update login timestamp/email
    INSERT INTO public.profiles (
        id,
        full_name,
        email,
        registration_number,
        login_identifier,
        department,
        year_of_study,
        role,
        status,
        last_login_at,
        created_at,
        updated_at
    ) VALUES (
        v_user_id,
        COALESCE(
            NULLIF(TRIM(v_user_meta->>'full_name'), ''),
            NULLIF(TRIM(v_user_meta->>'name'), ''),
            SPLIT_PART(v_auth_email, '@', 1)
        ),
        LOWER(v_auth_email),
        NULLIF(TRIM(v_user_meta->>'registration_number'), ''),
        LOWER(v_auth_email),
        NULLIF(TRIM(v_user_meta->>'department'), ''),
        COALESCE((v_user_meta->>'year_of_study')::INTEGER, 1),
        'student'::user_role,
        'active'::account_status,
        NOW(),
        COALESCE(v_created_at, NOW()),
        NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        email = LOWER(EXCLUDED.email),
        login_identifier = LOWER(EXCLUDED.email),
        last_login_at = NOW(),
        full_name = CASE WHEN public.profiles.full_name IS NULL OR public.profiles.full_name = '' THEN EXCLUDED.full_name ELSE public.profiles.full_name END,
        registration_number = COALESCE(public.profiles.registration_number, EXCLUDED.registration_number),
        department = COALESCE(public.profiles.department, EXCLUDED.department),
        updated_at = NOW();

    SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;
    RETURN v_profile;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_my_profile() TO authenticated;


-- 5. Profile Update RPC: update_my_profile()
DROP FUNCTION IF EXISTS public.update_my_profile(TEXT, TEXT, TEXT, TEXT, INTEGER) CASCADE;

CREATE OR REPLACE FUNCTION public.update_my_profile(
    p_full_name TEXT DEFAULT NULL,
    p_registration_number TEXT DEFAULT NULL,
    p_department TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL,
    p_year_of_study INTEGER DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_clean_name TEXT := NULLIF(TRIM(p_full_name), '');
    v_clean_reg TEXT := NULLIF(TRIM(p_registration_number), '');
    v_clean_dept TEXT := NULLIF(TRIM(p_department), '');
    v_clean_phone TEXT := NULLIF(TRIM(p_phone), '');
    v_profile public.profiles%ROWTYPE;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated request';
    END IF;

    -- Registration number uniqueness check
    IF v_clean_reg IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE LOWER(registration_number) = LOWER(v_clean_reg)
          AND id != v_user_id
    ) THEN
        RAISE EXCEPTION 'Registration number % is already registered with another account.', v_clean_reg;
    END IF;

    UPDATE public.profiles
    SET
        full_name = COALESCE(v_clean_name, full_name),
        registration_number = COALESCE(v_clean_reg, registration_number),
        department = COALESCE(v_clean_dept, department),
        phone = COALESCE(v_clean_phone, phone),
        year_of_study = COALESCE(p_year_of_study, year_of_study),
        updated_at = NOW()
    WHERE id = v_user_id;

    SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;
    RETURN v_profile;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_my_profile(TEXT, TEXT, TEXT, TEXT, INTEGER) TO authenticated;


-- 6. Helper Function for RLS Role Enforcement
CREATE OR REPLACE FUNCTION public.is_librarian_or_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
          AND role IN ('librarian', 'senior_librarian', 'support_staff', 'admin', 'super_admin')
    );
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
          AND role IN ('admin', 'super_admin')
    );
$$;

-- 7. Row Level Security Policies on public.profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
    ON public.profiles
    FOR SELECT
    USING (auth.uid() = id);

DROP POLICY IF EXISTS "Staff can view student profiles" ON public.profiles;
CREATE POLICY "Staff can view student profiles"
    ON public.profiles
    FOR SELECT
    USING (public.is_librarian_or_admin());

DROP POLICY IF EXISTS "Admins full management on profiles" ON public.profiles;
CREATE POLICY "Admins full management on profiles"
    ON public.profiles
    FOR ALL
    USING (public.is_admin());


-- 8. Existing Auth Users One-Time Backfill SQL (Idempotent)
-- Preview missing profiles query:
-- SELECT au.id, au.email, au.raw_user_meta_data, au.created_at
-- FROM auth.users au
-- LEFT JOIN public.profiles p ON p.id = au.id
-- WHERE p.id IS NULL;

INSERT INTO public.profiles (
    id,
    full_name,
    email,
    registration_number,
    login_identifier,
    department,
    year_of_study,
    role,
    status,
    created_at,
    updated_at
)
SELECT
    au.id,
    COALESCE(
        NULLIF(TRIM(au.raw_user_meta_data->>'full_name'), ''),
        NULLIF(TRIM(au.raw_user_meta_data->>'name'), ''),
        SPLIT_PART(au.email, '@', 1)
    ) AS full_name,
    LOWER(au.email) AS email,
    NULLIF(TRIM(au.raw_user_meta_data->>'registration_number'), '') AS registration_number,
    LOWER(au.email) AS login_identifier,
    NULLIF(TRIM(au.raw_user_meta_data->>'department'), '') AS department,
    COALESCE((au.raw_user_meta_data->>'year_of_study')::INTEGER, 1) AS year_of_study,
    'student'::user_role AS role,
    'active'::account_status AS status,
    COALESCE(au.created_at, NOW()) AS created_at,
    NOW() AS updated_at
FROM auth.users au
LEFT JOIN public.profiles p ON p.id = au.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;
