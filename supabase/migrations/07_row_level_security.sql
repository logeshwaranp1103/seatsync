-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 07: ROW LEVEL SECURITY (RLS) POLICIES
-- ====================================================================

-- 1. Enable RLS on all public tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.libraries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.floors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waitlist_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.check_in_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seat_maintenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.no_show_records ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------
-- PROFILES POLICIES
-- --------------------------------------------------------------------
CREATE POLICY "Active users can view profiles"
ON public.profiles FOR SELECT TO authenticated
USING (public.is_active_user());

CREATE POLICY "Users can update non-sensitive fields in own profile"
ON public.profiles FOR UPDATE TO authenticated
USING (id = auth.uid() AND public.is_active_user())
WITH CHECK (
    id = auth.uid() AND
    role = (SELECT role FROM public.profiles WHERE id = auth.uid()) AND
    status = (SELECT status FROM public.profiles WHERE id = auth.uid())
);

CREATE POLICY "Admins can manage profiles"
ON public.profiles FOR ALL TO authenticated
USING (public.is_admin());

-- --------------------------------------------------------------------
-- LIBRARIES, FLOORS, ROOMS, SEATS, SLOTS POLICIES
-- --------------------------------------------------------------------
CREATE POLICY "Authenticated active users can read libraries"
ON public.libraries FOR SELECT TO authenticated
USING (public.is_active_user());

CREATE POLICY "Admins can manage libraries"
ON public.libraries FOR ALL TO authenticated
USING (public.is_admin());

CREATE POLICY "Authenticated active users can read floors"
ON public.floors FOR SELECT TO authenticated
USING (public.is_active_user());

CREATE POLICY "Admins can manage floors"
ON public.floors FOR ALL TO authenticated
USING (public.is_admin());

CREATE POLICY "Authenticated active users can read rooms"
ON public.rooms FOR SELECT TO authenticated
USING (public.is_active_user());

CREATE POLICY "Admins and librarians can manage rooms"
ON public.rooms FOR ALL TO authenticated
USING (public.is_librarian_or_admin());

CREATE POLICY "Authenticated active users can read seats"
ON public.seats FOR SELECT TO authenticated
USING (public.is_active_user());

CREATE POLICY "Admins and librarians can manage seats"
ON public.seats FOR ALL TO authenticated
USING (public.is_librarian_or_admin());

CREATE POLICY "Authenticated active users can read slots"
ON public.slots FOR SELECT TO authenticated
USING (public.is_active_user());

CREATE POLICY "Admins can manage slots"
ON public.slots FOR ALL TO authenticated
USING (public.is_admin());

-- --------------------------------------------------------------------
-- BOOKINGS POLICIES
-- --------------------------------------------------------------------
CREATE POLICY "Students can view own bookings"
ON public.bookings FOR SELECT TO authenticated
USING (student_id = auth.uid() AND public.is_active_user());

CREATE POLICY "Librarians and admins can view all bookings"
ON public.bookings FOR SELECT TO authenticated
USING (public.is_librarian_or_admin());

CREATE POLICY "Librarians and admins can update bookings"
ON public.bookings FOR UPDATE TO authenticated
USING (public.is_librarian_or_admin());

-- --------------------------------------------------------------------
-- WAITLIST POLICIES
-- --------------------------------------------------------------------
CREATE POLICY "Students can view own waitlist entries"
ON public.waitlist_entries FOR SELECT TO authenticated
USING (student_id = auth.uid() AND public.is_active_user());

CREATE POLICY "Librarians and admins can view all waitlist entries"
ON public.waitlist_entries FOR SELECT TO authenticated
USING (public.is_librarian_or_admin());

-- --------------------------------------------------------------------
-- NOTIFICATIONS POLICIES
-- --------------------------------------------------------------------
CREATE POLICY "Users can view own notifications"
ON public.notifications FOR SELECT TO authenticated
USING (recipient_id = auth.uid() AND public.is_active_user());

CREATE POLICY "Users can update own notifications read status"
ON public.notifications FOR UPDATE TO authenticated
USING (recipient_id = auth.uid() AND public.is_active_user());

CREATE POLICY "Staff can send notifications"
ON public.notifications FOR INSERT TO authenticated
WITH CHECK (public.is_librarian_or_admin());

-- --------------------------------------------------------------------
-- SEAT MAINTENANCE, CHECK-IN LOGS, POLICIES
-- --------------------------------------------------------------------
CREATE POLICY "Librarians and admins can manage seat maintenance"
ON public.seat_maintenance FOR ALL TO authenticated
USING (public.is_librarian_or_admin());

CREATE POLICY "Librarians and admins can view check-in logs"
ON public.check_in_logs FOR ALL TO authenticated
USING (public.is_librarian_or_admin());

CREATE POLICY "Librarians and admins can view staff assignments"
ON public.staff_assignments FOR ALL TO authenticated
USING (public.is_librarian_or_admin());

CREATE POLICY "Authenticated active users can read booking policies"
ON public.booking_policies FOR SELECT TO authenticated
USING (public.is_active_user());

CREATE POLICY "Admins can manage booking policies"
ON public.booking_policies FOR ALL TO authenticated
USING (public.is_admin());

CREATE POLICY "Librarians and admins can view activity logs"
ON public.activity_logs FOR SELECT TO authenticated
USING (public.is_librarian_or_admin());

CREATE POLICY "Librarians and admins can view no show records"
ON public.no_show_records FOR SELECT TO authenticated
USING (public.is_librarian_or_admin());
