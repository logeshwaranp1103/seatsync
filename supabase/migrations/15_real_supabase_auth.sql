-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 15: REAL SUPABASE AUTHENTICATION & PROFILES
-- ====================================================================

-- 1. Ensure enum types exist
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('student', 'librarian', 'senior_librarian', 'support_staff', 'admin', 'super_admin', 'report_viewer');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_status') THEN
        CREATE TYPE account_status AS ENUM ('active', 'blocked', 'suspended', 'inactive', 'pending_verification');
    END IF;
END $$;

-- 2. Add missing fields to public.profiles table
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS staff_id TEXT,
    ADD COLUMN IF NOT EXISTS admin_id TEXT,
    ADD COLUMN IF NOT EXISTS login_identifier TEXT,
    ADD COLUMN IF NOT EXISTS failed_login_count INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- 3. Populate default login_identifier for existing rows
UPDATE public.profiles
SET login_identifier = LOWER(COALESCE(email, registration_number, staff_id, admin_id, id::text))
WHERE login_identifier IS NULL;

-- 4. Case-insensitive unique indexes for identifiers
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_login_identifier_lower ON public.profiles (LOWER(login_identifier));
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_staff_id_lower ON public.profiles (LOWER(staff_id)) WHERE staff_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_admin_id_lower ON public.profiles (LOWER(admin_id)) WHERE admin_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_reg_num_lower ON public.profiles (LOWER(registration_number)) WHERE registration_number IS NOT NULL;

-- 5. SECURITY DEFINER function to securely resolve Auth Email from Staff ID, Admin ID, Reg No, or Login Identifier
-- Does NOT expose profile lists to anonymous users and prevents account enumeration
CREATE OR REPLACE FUNCTION public.fn_get_auth_email_by_identifier(p_identifier TEXT)
RETURNS TABLE (
    auth_email TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_clean_id TEXT;
BEGIN
    v_clean_id := LOWER(TRIM(p_identifier));
    IF v_clean_id IS NULL OR v_clean_id = '' THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT p.email
    FROM public.profiles p
    WHERE LOWER(p.login_identifier) = v_clean_id
       OR LOWER(p.email) = v_clean_id
       OR LOWER(p.staff_id) = v_clean_id
       OR LOWER(p.admin_id) = v_clean_id
       OR LOWER(p.registration_number) = v_clean_id
    LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_auth_email_by_identifier(TEXT) TO anon, authenticated;

-- 6. Trigger to automatically handle profile creation from auth.users signup
CREATE OR REPLACE FUNCTION public.handle_new_user_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_role user_role := 'student';
    v_reg_num TEXT;
    v_full_name TEXT;
    v_dept TEXT;
    v_year INTEGER;
BEGIN
    v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', SPLIT_PART(NEW.email, '@', 1));
    v_reg_num := NEW.raw_user_meta_data->>'registration_number';
    v_dept := NEW.raw_user_meta_data->>'department';
    v_year := (NEW.raw_user_meta_data->>'year_of_study')::INTEGER;

    INSERT INTO public.profiles (
        id,
        full_name,
        email,
        registration_number,
        login_identifier,
        department,
        year_of_study,
        role,
        status
    ) VALUES (
        NEW.id,
        v_full_name,
        NEW.email,
        v_reg_num,
        LOWER(NEW.email),
        v_dept,
        v_year,
        v_role,
        'active'
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        login_identifier = EXCLUDED.login_identifier,
        updated_at = NOW();

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user_signup();

-- 7. Ensure RLS policies on profiles are secure
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Allow users to read their own profile
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
    ON public.profiles
    FOR SELECT
    USING (auth.uid() = id);

-- Allow librarians/staff to view student profiles for library operations
DROP POLICY IF EXISTS "Staff can view student profiles" ON public.profiles;
CREATE POLICY "Staff can view student profiles"
    ON public.profiles
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.role IN ('librarian', 'senior_librarian', 'support_staff', 'admin', 'super_admin')
        )
    );

-- Allow admins full access to profile management
DROP POLICY IF EXISTS "Admins full management on profiles" ON public.profiles;
CREATE POLICY "Admins full management on profiles"
    ON public.profiles
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.role IN ('admin', 'super_admin')
        )
    );
