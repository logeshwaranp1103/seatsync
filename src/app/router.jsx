import React from 'react';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import ProtectedRoute from '../auth/ProtectedRoute';

// Derive basename from Vite's base URL.
// Dev: base='/' → basename=''
// GitHub Pages: base='/TECH-NOVA/' → basename='/TECH-NOVA'
const viteBase = import.meta.env.BASE_URL || '/';
const routerBasename = viteBase === '/' ? '' : viteBase.replace(/\/$/, '');
import RoleRoute from '../auth/RoleRoute';
import { ROLES } from '../data/seedData';

// Shared Pages
import LoginPage from '../pages/LoginPage';
import StudentSignUpPage from '../pages/StudentSignUpPage';
import ResetPasswordPage from '../pages/ResetPasswordPage';
import AccountBlockedPage from '../pages/AccountBlockedPage';
import AccountSuspendedPage from '../pages/AccountSuspendedPage';
import ProfileCompletionPage from '../pages/ProfileCompletionPage';
import UnauthorizedPage from '../pages/UnauthorizedPage';
import NotFoundPage from '../pages/NotFoundPage';

// Layouts
import StudentLayout from '../layouts/StudentLayout';
import LibrarianLayout from '../layouts/LibrarianLayout';
import AdminLayout from '../layouts/AdminLayout';

// Student Features
import Dashboard from '../features/student/Dashboard';
import FindSeat from '../features/student/FindSeat';
import MyReservations from '../features/student/MyReservations';
import WaitingList from '../features/student/WaitingList';
import Notifications from '../features/student/Notifications';
import Profile from '../features/student/Profile';

// Librarian Features
import LibrarianDashboard from '../features/librarian/LibrarianDashboard';
import QRScannerPage from '../features/librarian/QRScannerPage';
import CheckInOutPage from '../features/librarian/CheckInOutPage';
import StaffReservationsPage from '../features/librarian/StaffReservationsPage';
import WalkInAllocationPage from '../features/librarian/WalkInAllocationPage';
import StaffWaitlistPage from '../features/librarian/StaffWaitlistPage';
import BookingLookupPage from '../features/librarian/BookingLookupPage';
import LiveOccupancyPage from '../features/librarian/LiveOccupancyPage';
import NoShowsMonitorPage from '../features/librarian/NoShowsMonitorPage';
import SeatMaintenancePage from '../features/librarian/SeatMaintenancePage';
import LibrarianNotificationsPage from '../features/librarian/LibrarianNotificationsPage';
import LibrarianActivityLogsPage from '../features/librarian/LibrarianActivityLogsPage';
import LibrarianReportsPage from '../features/librarian/LibrarianReportsPage';
import ShiftHandoverPage from '../features/librarian/ShiftHandoverPage';
import LibrarianProfilePage from '../features/librarian/LibrarianProfilePage';

// Admin Features
import AdminDashboard from '../features/admin/AdminDashboard';
import StudentManagementPage from '../features/admin/StudentManagementPage';
import StaffManagementPage from '../features/admin/StaffManagementPage';
import RolesPermissionsPage from '../features/admin/RolesPermissionsPage';
import PenaltiesRestrictionsPage from '../features/admin/PenaltiesRestrictionsPage';
import LibrariesRoomsPage from '../features/admin/LibrariesRoomsPage';
import SeatManagementPage from '../features/admin/SeatManagementPage';
import SlotConfigPage from '../features/admin/SlotConfigPage';
import AcademicCalendarPage from '../features/admin/AcademicCalendarPage';
import BookingRulesPage from '../features/admin/BookingRulesPage';
import AdminBookingsPage from '../features/admin/AdminBookingsPage';
import AdminWaitlistPage from '../features/admin/AdminWaitlistPage';
import OverridesApprovalsPage from '../features/admin/OverridesApprovalsPage';
import AnnouncementsPage from '../features/admin/AnnouncementsPage';
import SupportTicketsPage from '../features/admin/SupportTicketsPage';
import StaffShiftsPage from '../features/admin/StaffShiftsPage';
import ReportsAnalyticsPage from '../features/admin/ReportsAnalyticsPage';
import BulkDataPage from '../features/admin/BulkDataPage';
import SystemHealthPage from '../features/admin/SystemHealthPage';
import SecurityCentrePage from '../features/admin/SecurityCentrePage';
import AuditLogsPage from '../features/admin/AuditLogsPage';
import AutomationRulesPage from '../features/admin/AutomationRulesPage';
import AdminSettingsPage from '../features/admin/AdminSettingsPage';
import AdminProfilePage from '../features/admin/AdminProfilePage';
import SupabaseDiagnosticsPage from '../features/admin/SupabaseDiagnosticsPage';

const router = createBrowserRouter([
  {
    path: '/',
    element: <Navigate to="/login" replace />,
  },
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/signup',
    element: <StudentSignUpPage />,
  },
  {
    path: '/forgot-password',
    element: <Navigate to="/login" replace />,
  },
  {
    path: '/reset-password',
    element: <ResetPasswordPage />,
  },
  {
    path: '/account-blocked',
    element: <AccountBlockedPage />,
  },
  {
    path: '/account-suspended',
    element: <AccountSuspendedPage />,
  },
  {
    path: '/unauthorized',
    element: <UnauthorizedPage />,
  },
  {
    path: '/complete-profile',
    element: <ProfileCompletionPage />,
  },

  // STUDENT DASHBOARD ROUTES
  {
    path: '/student',
    element: (
      <ProtectedRoute>
        <RoleRoute allowedRoles={[ROLES.STUDENT]}>
          <StudentLayout />
        </RoleRoute>
      </ProtectedRoute>
    ),
    children: [
      { path: '', element: <Navigate to="/student/dashboard" replace /> },
      { path: 'dashboard', element: <Dashboard /> },
      { path: 'find-seat', element: <FindSeat /> },
      { path: 'book', element: <FindSeat /> },
      { path: 'reservations', element: <MyReservations /> },
      { path: 'waitlist', element: <WaitingList /> },
      { path: 'notifications', element: <Notifications /> },
      { path: 'profile', element: <Profile /> },
    ],
  },

  // LIBRARIAN DASHBOARD ROUTES
  {
    path: '/librarian',
    element: (
      <ProtectedRoute>
        <RoleRoute allowedRoles={[ROLES.LIBRARIAN]}>
          <LibrarianLayout />
        </RoleRoute>
      </ProtectedRoute>
    ),
    children: [
      { path: '', element: <Navigate to="/librarian/dashboard" replace /> },
      { path: 'dashboard', element: <LibrarianDashboard /> },
      { path: 'scan-entry', element: <QRScannerPage /> },
      { path: 'check-in-out', element: <CheckInOutPage /> },
      { path: 'bookings', element: <StaffReservationsPage /> },
      { path: 'walk-in', element: <WalkInAllocationPage /> },
      { path: 'waitlist', element: <StaffWaitlistPage /> },
      { path: 'lookup', element: <BookingLookupPage /> },
      { path: 'occupancy', element: <LiveOccupancyPage /> },
      { path: 'no-shows', element: <NoShowsMonitorPage /> },
      { path: 'students', element: <StudentManagementPage /> },
      { path: 'maintenance', element: <SeatMaintenancePage /> },
      { path: 'incidents', element: <Navigate to="/librarian/maintenance" replace /> },
      { path: 'notifications', element: <LibrarianNotificationsPage /> },
      { path: 'activity-logs', element: <LibrarianActivityLogsPage /> },
      { path: 'analytics', element: <LibrarianReportsPage /> },
      { path: 'handover', element: <ShiftHandoverPage /> },
      { path: 'profile', element: <LibrarianProfilePage /> },
    ],
  },

  // ADMIN DASHBOARD ROUTES
  {
    path: '/admin',
    element: (
      <ProtectedRoute>
        <RoleRoute allowedRoles={[ROLES.ADMIN]}>
          <AdminLayout />
        </RoleRoute>
      </ProtectedRoute>
    ),
    children: [
      { path: '', element: <Navigate to="/admin/dashboard" replace /> },
      { path: 'dashboard', element: <AdminDashboard /> },
      { path: 'students', element: <StudentManagementPage /> },
      { path: 'staff', element: <StaffManagementPage /> },
      { path: 'roles-permissions', element: <RolesPermissionsPage /> },
      { path: 'penalties', element: <PenaltiesRestrictionsPage /> },
      { path: 'libraries-rooms', element: <LibrariesRoomsPage /> },
      { path: 'seats', element: <SeatManagementPage /> },
      { path: 'slots', element: <SlotConfigPage /> },
      { path: 'academic-calendar', element: <AcademicCalendarPage /> },
      { path: 'booking-rules', element: <BookingRulesPage /> },
      { path: 'bookings', element: <AdminBookingsPage /> },
      { path: 'waitlist', element: <AdminWaitlistPage /> },
      { path: 'maintenance', element: <SeatManagementPage /> },
      { path: 'incidents', element: <SeatManagementPage /> },
      { path: 'overrides', element: <OverridesApprovalsPage /> },
      { path: 'notifications', element: <AnnouncementsPage /> },
      { path: 'announcements', element: <AnnouncementsPage /> },
      { path: 'support', element: <SupportTicketsPage /> },
      { path: 'staff-shifts', element: <StaffShiftsPage /> },
      { path: 'handovers', element: <StaffShiftsPage /> },
      { path: 'reports', element: <ReportsAnalyticsPage /> },
      { path: 'bulk-data', element: <BulkDataPage /> },
      { path: 'database-usage', element: <ReportsAnalyticsPage /> },
      { path: 'system-health', element: <SystemHealthPage /> },
      { path: 'diagnostics', element: <SupabaseDiagnosticsPage /> },
      { path: 'security', element: <SecurityCentrePage /> },
      { path: 'audit-logs', element: <AuditLogsPage /> },
      { path: 'automation', element: <AutomationRulesPage /> },
      { path: 'settings', element: <AdminSettingsPage /> },
      { path: 'profile', element: <AdminProfilePage /> },
    ],
  },

  {
    path: '*',
    element: <NotFoundPage />,
  },
], { basename: routerBasename });

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
