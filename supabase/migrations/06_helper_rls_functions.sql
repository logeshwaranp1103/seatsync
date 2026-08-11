-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 06: HELPER SECURITY DEFINER RLS FUNCTIONS
-- ====================================================================

-- 1. Get current user role
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

-- 2. Get current user account status
CREATE OR REPLACE FUNCTION public.current_user_status()
RETURNS account_status
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT status FROM public.profiles WHERE id = auth.uid();
$$;

-- 3. Check if user is active (not blocked, suspended, or inactive)
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
          AND status = 'active'
          AND (suspended_until IS NULL OR suspended_until < NOW())
    );
$$;

-- 4. Check if user is admin or super_admin
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
          AND role IN ('super_admin', 'admin')
          AND status = 'active'
    );
$$;

-- 5. Check if user is librarian or admin
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
          AND role IN ('super_admin', 'admin', 'senior_librarian', 'librarian', 'support_staff')
          AND status = 'active'
    );
$$;

-- 6. Check if staff can manage specific library
CREATE OR REPLACE FUNCTION public.can_manage_library(target_library_id UUID)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
          AND status = 'active'
          AND (
            role IN ('super_admin', 'admin') OR
            EXISTS (
                SELECT 1 FROM public.staff_assignments
                WHERE staff_id = auth.uid()
                  AND library_id = target_library_id
            )
          )
    );
$$;
