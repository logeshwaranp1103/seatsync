-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 04: AUTOMATIC AUTH PROFILE CREATION TRIGGER
-- ====================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    default_role user_role := 'student';
    req_role TEXT;
BEGIN
    -- Check if metadata explicitly provides a valid role (e.g., from seed script)
    req_role := NEW.raw_user_meta_data->>'role';
    IF req_role IN ('super_admin', 'admin', 'senior_librarian', 'librarian', 'support_staff', 'report_viewer', 'student') THEN
        default_role := req_role::user_role;
    END IF;

    INSERT INTO public.profiles (
        id,
        full_name,
        email,
        registration_number,
        department,
        year_of_study,
        phone,
        role,
        status,
        created_at,
        updated_at
    )
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', SPLIT_PART(NEW.email, '@', 1)),
        NEW.email,
        NEW.raw_user_meta_data->>'registration_number',
        COALESCE(NEW.raw_user_meta_data->>'department', 'Computer Science'),
        COALESCE((NEW.raw_user_meta_data->>'year_of_study')::integer, 1),
        NEW.raw_user_meta_data->>'phone',
        default_role,
        'active',
        NOW(),
        NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        email = EXCLUDED.email,
        updated_at = NOW();

    RETURN NEW;
END;
$$;

-- Bind Trigger to auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user_signup();
