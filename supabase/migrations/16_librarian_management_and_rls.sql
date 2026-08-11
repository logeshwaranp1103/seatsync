-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 16: LIBRARIAN MANAGEMENT & RLS SECURITY
-- ====================================================================

-- 1. Ensure enum types exist and include required values
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('student', 'librarian', 'senior_librarian', 'support_staff', 'admin', 'super_admin', 'report_viewer');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_status') THEN
        CREATE TYPE account_status AS ENUM ('active', 'blocked', 'suspended', 'inactive', 'pending_verification');
    END IF;
END $$;

-- 2. Ensure profiles table has all required columns
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS full_name TEXT,
    ADD COLUMN IF NOT EXISTS email TEXT,
    ADD COLUMN IF NOT EXISTS staff_id TEXT,
    ADD COLUMN IF NOT EXISTS admin_id TEXT,
    ADD COLUMN IF NOT EXISTS login_identifier TEXT,
    ADD COLUMN IF NOT EXISTS phone TEXT,
    ADD COLUMN IF NOT EXISTS status account_status NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS role user_role NOT NULL DEFAULT 'student',
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 3. Indexes for fast lookup & RLS security checks
CREATE INDEX IF NOT EXISTS idx_profiles_id ON public.profiles (id);
CREATE INDEX IF NOT EXISTS idx_profiles_email_lower ON public.profiles (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_profiles_staff_id_lower ON public.profiles (LOWER(staff_id)) WHERE staff_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles (role);
CREATE INDEX IF NOT EXISTS idx_profiles_status ON public.profiles (status);

-- 4. Dedicated audit_logs table for administrative and security actions
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    target_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON public.audit_logs (target_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON public.audit_logs (event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs (created_at DESC);

-- 5. Helper Security Definer authorization functions
CREATE OR REPLACE FUNCTION public.is_active_librarian()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
          AND status::text = 'active'
          AND role::text IN ('librarian', 'senior_librarian', 'admin', 'super_admin')
    );
$$;

CREATE OR REPLACE FUNCTION public.is_active_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
          AND status::text = 'active'
          AND role::text IN ('admin', 'super_admin')
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_active_librarian() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_active_admin() TO authenticated, anon;

-- 6. Enable Row Level Security on all operational tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.libraries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waitlist_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.check_in_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seat_maintenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- 7. RLS Policies

-- PROFILES
DROP POLICY IF EXISTS "Active users can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can manage profiles" ON public.profiles;
DROP POLICY IF EXISTS "Librarians can view profiles" ON public.profiles;

CREATE POLICY "Librarians and Admins can view profiles"
ON public.profiles FOR SELECT TO authenticated
USING (public.is_active_librarian() OR id = auth.uid());

CREATE POLICY "Admins can insert profiles"
ON public.profiles FOR INSERT TO authenticated
WITH CHECK (public.is_active_admin());

CREATE POLICY "Admins can update profiles"
ON public.profiles FOR UPDATE TO authenticated
USING (public.is_active_admin())
WITH CHECK (public.is_active_admin());

-- AUDIT LOGS
DROP POLICY IF EXISTS "Admins and Librarians can view audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Authenticated users can insert audit logs" ON public.audit_logs;

CREATE POLICY "Admins can view audit logs"
ON public.audit_logs FOR SELECT TO authenticated
USING (public.is_active_admin());

CREATE POLICY "Authenticated users can insert audit logs"
ON public.audit_logs FOR INSERT TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

-- BOOKINGS
DROP POLICY IF EXISTS "Librarians can view and edit bookings" ON public.bookings;
CREATE POLICY "Librarians can view and edit bookings"
ON public.bookings FOR ALL TO authenticated
USING (public.is_active_librarian());

-- SEATS & ROOMS
DROP POLICY IF EXISTS "Librarians can manage seats" ON public.seats;
CREATE POLICY "Librarians can manage seats"
ON public.seats FOR ALL TO authenticated
USING (public.is_active_librarian());

-- CHECK IN LOGS
DROP POLICY IF EXISTS "Librarians can manage check in logs" ON public.check_in_logs;
CREATE POLICY "Librarians can manage check in logs"
ON public.check_in_logs FOR ALL TO authenticated
USING (public.is_active_librarian());

-- SEAT MAINTENANCE
DROP POLICY IF EXISTS "Librarians can manage seat maintenance" ON public.seat_maintenance;
CREATE POLICY "Librarians can manage seat maintenance"
ON public.seat_maintenance FOR ALL TO authenticated
USING (public.is_active_librarian());

-- WAITLIST ENTRIES
DROP POLICY IF EXISTS "Librarians can manage waitlist" ON public.waitlist_entries;
CREATE POLICY "Librarians can manage waitlist"
ON public.waitlist_entries FOR ALL TO authenticated
USING (public.is_active_librarian());
