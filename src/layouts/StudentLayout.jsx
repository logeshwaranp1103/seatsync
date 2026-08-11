import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { authService } from '../services/authService';
import { notificationService } from '../services/notificationService';
import { bookingService } from '../services/bookingService';
import { db } from '../services/mockDatabase';
import { useSync } from '../hooks/useSync';
import {
  LayoutDashboard, Search, BookmarkCheck, Bell, User, LogOut, Menu, X,
  BookOpen, Check, Clock, Users, ChevronDown, ChevronLeft, ChevronRight,
  Sparkles, Settings, AlertTriangle,
} from 'lucide-react';
import { Button } from '../components/shared/Button';
import { Badge } from '../components/shared/Badge';
import { format, formatDistanceToNow } from 'date-fns';

const NAV_GROUPS = [
  {
    label: 'Main',
    items: [
      { name: 'Dashboard', path: '/student/dashboard', icon: LayoutDashboard },
      { name: 'Book a Seat', path: '/student/find-seat', icon: Search },
    ],
  },
  {
    label: 'Activity',
    items: [
      { name: 'My Bookings', path: '/student/reservations', icon: BookmarkCheck, badgeKey: 'bookings' },
      { name: 'Waiting List', path: '/student/waitlist', icon: Users, badgeKey: 'waitlist' },
      { name: 'Notifications', path: '/student/notifications', icon: Bell, badgeKey: 'notifications' },
    ],
  },
  {
    label: 'Account',
    items: [
      { name: 'My Profile', path: '/student/profile', icon: User },
    ],
  },
];

const BOTTOM_NAV_ITEMS = [
  { name: 'Home', path: '/student/dashboard', icon: LayoutDashboard },
  { name: 'Book', path: '/student/find-seat', icon: Search },
  { name: 'Bookings', path: '/student/reservations', icon: BookmarkCheck },
  { name: 'Waitlist', path: '/student/waitlist', icon: Users },
  { name: 'Profile', path: '/student/profile', icon: User },
];

function SidebarBadge({ count, variant = 'blue', isActive, collapsed }) {
  if (!count || count <= 0) return null;
  const label = count > 9 ? '9+' : String(count);

  const colors = {
    blue: isActive ? 'bg-white text-brandBlue' : 'bg-brandBlue text-white',
    amber: isActive ? 'bg-white text-amber-600' : 'bg-amber-500 text-white',
    teal: isActive ? 'bg-white text-teal-600' : 'bg-teal-500 text-white',
    red: isActive ? 'bg-white text-red-600' : 'bg-red-500 text-white',
  };

  if (collapsed) {
    return (
      <span
        aria-label={`${count} items`}
        className={`absolute top-1 right-1 min-w-[16px] h-4 flex items-center justify-center rounded-full text-[9px] font-extrabold px-1 shadow-sm border border-white/60 ${colors[variant]}`}
      >
        {label}
      </span>
    );
  }

  return (
    <span
      aria-label={`${count} items`}
      className={`ml-auto min-w-[20px] h-5 flex items-center justify-center rounded-full text-[10px] font-extrabold px-1.5 ${colors[variant]}`}
    >
      {label}
    </span>
  );
}

function SidebarTooltip({ label, count, variant }) {
  return (
    <span
      role="tooltip"
      className="absolute left-full ml-3 z-50 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap flex items-center gap-1.5"
    >
      <span className="bg-navy text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg shadow-lg">
        {label}
      </span>
      {count > 0 && (
        <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-full shadow ${
          variant === 'amber' ? 'bg-amber-500 text-white' :
          variant === 'teal' ? 'bg-teal-500 text-white' :
          'bg-brandBlue text-white'
        }`}>
          {count > 9 ? '9+' : count}
        </span>
      )}
    </span>
  );
}

function SidebarNavItem({ item, isCollapsed, badges, onNavigate }) {
  const badgeCount = item.badgeKey ? (badges[item.badgeKey] || 0) : 0;
  const badgeVariant =
    item.badgeKey === 'notifications' ? 'red' :
    item.badgeKey === 'waitlist' ? 'amber' :
    item.badgeKey === 'bookings' ? 'teal' : 'blue';

  return (
    <li>
      <NavLink
        to={item.path}
        onClick={onNavigate}
        aria-label={item.name}
        className={({ isActive }) =>
          [
            'relative group flex items-center rounded-xl transition-all duration-150 select-none outline-none',
            'focus-visible:ring-2 focus-visible:ring-brandBlue/50 focus-visible:ring-offset-1',
            isCollapsed
              ? 'justify-center w-11 h-11 mx-auto'
              : 'gap-3 px-3 py-2.5 w-full',
            isActive
              ? 'bg-gradient-to-r from-brandBlue to-blue-600 text-white shadow-md shadow-brandBlue/25'
              : 'text-slate-500 hover:bg-slate-100/90 hover:text-navy hover:translate-x-0.5',
          ].join(' ')
        }
      >
        {({ isActive }) => (
          <>
            {isActive && !isCollapsed && (
              <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-white/60 rounded-r-full" />
            )}

            <div className="relative shrink-0">
              <item.icon
                size={18}
                strokeWidth={isActive ? 2.2 : 1.8}
                className={isActive ? 'text-white' : 'text-slate-400 group-hover:text-brandBlue transition-colors'}
              />
              {isCollapsed && (
                <SidebarBadge count={badgeCount} variant={badgeVariant} isActive={isActive} collapsed />
              )}
            </div>

            {!isCollapsed && (
              <>
                <span className={`text-xs font-semibold flex-1 leading-none ${isActive ? 'text-white font-bold' : ''}`}>
                  {item.name}
                </span>
                <SidebarBadge count={badgeCount} variant={badgeVariant} isActive={isActive} />
              </>
            )}

            {isCollapsed && (
              <SidebarTooltip label={item.name} count={badgeCount} variant={badgeVariant} />
            )}
          </>
        )}
      </NavLink>
    </li>
  );
}

function SidebarNavGroup({ group, isCollapsed, badges, onNavigate }) {
  return (
    <div className="mb-1">
      {!isCollapsed && (
        <p className="px-3 mb-1 text-[10px] font-extrabold uppercase tracking-widest text-slate-400 select-none">
          {group.label}
        </p>
      )}
      {isCollapsed && (
        <div className="w-6 h-px bg-slate-200/80 mx-auto mb-1 mt-2" aria-hidden="true" />
      )}
      <ul className={`space-y-0.5 ${isCollapsed ? 'flex flex-col items-center gap-0.5' : ''}`}>
        {group.items.map(item => (
          <SidebarNavItem
            key={item.path}
            item={item}
            isCollapsed={isCollapsed}
            badges={badges}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
    </div>
  );
}

function StudentSessionCard({ user, isCollapsed, onClick }) {
  const initials = (user?.name || 'S')
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  if (isCollapsed) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={user?.name}
        aria-label={`${user?.name} – Go to profile`}
        className="group relative flex items-center justify-center w-11 h-11 mx-auto rounded-xl hover:bg-slate-100 transition-colors focus-visible:ring-2 focus-visible:ring-brandBlue/50 focus-visible:outline-none"
      >
        <div className="relative">
          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-brandBlue to-blue-700 text-white font-extrabold text-sm flex items-center justify-center shadow-sm border border-white">
            {initials}
          </div>
          <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white" aria-label="Active session" />
        </div>
        <SidebarTooltip label={user?.name || 'Student'} count={0} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${user?.name} – Go to profile`}
      className="w-full flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200/80 hover:bg-blue-50/60 hover:border-brandBlue/30 transition-all duration-150 focus-visible:ring-2 focus-visible:ring-brandBlue/50 focus-visible:outline-none group"
    >
      <div className="relative shrink-0">
        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-brandBlue to-blue-700 text-white font-extrabold text-sm flex items-center justify-center shadow-sm border border-white">
          {initials}
        </div>
        <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white" aria-label="Active session" />
      </div>

      <div className="flex-1 text-left min-w-0">
        <p className="text-xs font-bold text-navy leading-tight truncate group-hover:text-brandBlue transition-colors">
          {user?.name || 'Student'}
        </p>
        <p className="text-[10px] text-slate-400 font-mono mt-0.5 truncate">
          {user?.collegeId || '—'}
        </p>
      </div>

      <ChevronRight size={14} className="text-slate-300 group-hover:text-brandBlue transition-colors shrink-0" />
    </button>
  );
}

function LogoutConfirmationDialog({ isOpen, onCancel, onConfirm }) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      aria-modal="true"
      role="dialog"
      aria-labelledby="logout-dialog-title"
    >
      <div
        className="absolute inset-0 bg-navy/50 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden="true"
      />
      <div className="relative bg-white rounded-2xl shadow-2xl border border-slate-200/80 w-full max-w-sm p-6 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-start gap-4 mb-5">
          <div className="w-10 h-10 rounded-xl bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
            <AlertTriangle size={20} className="text-red-500" />
          </div>
          <div>
            <h2 id="logout-dialog-title" className="text-sm font-bold text-navy">
              Log out of SeatSync?
            </h2>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Are you sure you want to log out? Your session and bookings are saved and you can log back in any time.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="h-9 px-4 text-xs font-bold text-slate-700 border border-slate-200 rounded-xl hover:bg-slate-100 transition-colors focus-visible:ring-2 focus-visible:ring-brandBlue/50 focus-visible:outline-none"
          >
            Stay Logged In
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="h-9 px-4 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors shadow-sm shadow-red-600/20 focus-visible:ring-2 focus-visible:ring-red-500/50 focus-visible:outline-none"
          >
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}

export default function StudentLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('seatsync_sidebar_collapsed') === 'true'; } catch { return false; }
  });

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const notifRef = useRef(null);

  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  const [waitlistCount, setWaitlistCount] = useState(0);
  const [activeBookingsCount, setActiveBookingsCount] = useState(0);
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    try {
      const data = await notificationService.getNotifications(user.id);
      setNotifications(data);
    } catch { /* silent */ }
  }, [user]);

  const fetchBadgeCounts = useCallback(async () => {
    if (!user) return;
    try {
      const [bookings, waitlists] = await Promise.all([
        bookingService.getMyBookings(user.id),
        db.read('seatsync_waitlist').catch(() => []),
      ]);
      const active = bookings.filter(b => b.status === 'confirmed' || b.status === 'active').length;
      const waiting = (waitlists || []).filter(
        w => w.studentId === user.id && (w.status || '').toLowerCase() === 'waiting'
      ).length;
      setActiveBookingsCount(active);
      setWaitlistCount(waiting);
    } catch { /* silent */ }
  }, [user]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    async function checkStudentAccess() {
      if (!user) return;
      if (user.accountStatus === 'blocked' || user.status === 'blocked') {
        navigate('/account-blocked', { replace: true });
        return;
      }
      try {
        const access = await authService.getMyAccessStatus();
        if (access && access.account_status === 'blocked') {
          navigate('/account-blocked', { replace: true });
        }
      } catch { /* silent */ }
    }
    checkStudentAccess();
  }, [user, location.pathname, navigate]);

  useEffect(() => {
    fetchNotifications();
    fetchBadgeCounts();

    // Supabase Realtime Subscription for bookings & notifications changes
    const channel = supabase
      .channel('student-layout-bookings-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => {
        fetchNotifications();
        fetchBadgeCounts();
        window.dispatchEvent(new CustomEvent('seatsync-sync-event', { detail: { type: 'bookings' } }));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'slot_occurrences' }, () => {
        fetchNotifications();
        fetchBadgeCounts();
        window.dispatchEvent(new CustomEvent('seatsync-sync-event', { detail: { type: 'slot_occurrences' } }));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (payload) => {
        if (payload.new && user?.id && (String(payload.new.recipient_id || payload.new.user_id) === String(user.id))) {
          toast(payload.new.title ? `${payload.new.title}\n${payload.new.message}` : payload.new.message, {
            duration: 6000,
            icon: '⚠️',
            style: {
              borderRadius: '16px',
              background: '#FEF2F2',
              color: '#991B1B',
              border: '1px solid #FCA5A5',
              fontWeight: 'bold',
              fontSize: '12px'
            }
          });
          fetchNotifications();
          fetchBadgeCounts();
          window.dispatchEvent(new CustomEvent('seatsync-sync-event', { detail: { type: 'notifications' } }));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  useSync((event) => {
    if (event?.type === 'storage_change' || event?.type?.startsWith('WAITLIST_')) {
      fetchNotifications();
      fetchBadgeCounts();
    }
  });

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const handler = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) setIsNotifOpen(false);
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setIsUserMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const unreadCount = notifications.filter(n => !n.isRead).length;

  const badges = {
    notifications: unreadCount,
    waitlist: waitlistCount,
    bookings: activeBookingsCount,
  };

  const toggleSidebar = () => {
    setIsSidebarCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('seatsync_sidebar_collapsed', String(next)); } catch { /* silent */ }
      return next;
    });
  };

  const handleMarkAsRead = async (id, e) => {
    e.stopPropagation();
    await notificationService.markAsRead(id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
  };

  const handleMarkAllRead = async () => {
    if (!user) return;
    await notificationService.markAllAsRead(user.id);
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const closeMobileMenu = () => setIsMobileMenuOpen(false);

  const pageTitles = {
    '/student/dashboard': 'Dashboard',
    '/student/find-seat': 'Book a Seat',
    '/student/reservations': 'My Bookings',
    '/student/waitlist': 'Waiting List',
    '/student/notifications': 'Notifications',
    '/student/profile': 'My Profile',
  };
  const currentPageTitle = pageTitles[location.pathname] || 'SeatSync';

  const SidebarContent = ({ isCollapsed = false, onNavigate = () => {} }) => (
    <div
      className={`flex flex-col h-full bg-white border-r border-slate-200/80 shadow-sm overflow-hidden transition-all duration-300 ${isCollapsed ? 'w-[76px]' : 'w-[272px]'}`}
    >
      <div className={`h-16 flex items-center border-b border-slate-100 shrink-0 ${isCollapsed ? 'justify-center px-3' : 'justify-between px-4'}`}>
        <button
          type="button"
          onClick={() => { navigate('/student/dashboard'); onNavigate(); }}
          aria-label="Go to dashboard"
          className="flex items-center gap-2.5 rounded-xl transition-all duration-150 hover:opacity-80 focus-visible:ring-2 focus-visible:ring-brandBlue/50 focus-visible:outline-none group"
        >
          <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-brandBlue to-blue-700 text-white flex items-center justify-center shadow-md shadow-brandBlue/20 shrink-0">
            <BookOpen size={16} />
          </div>
          {!isCollapsed && (
            <div className="flex flex-col leading-none">
              <span className="text-sm font-black tracking-tight text-navy">SeatSync</span>
              <span className="text-[9px] font-bold uppercase tracking-widest text-brandBlue mt-0.5">Student Portal</span>
            </div>
          )}
        </button>

        {!isCollapsed && (
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label="Collapse sidebar"
            className="h-7 w-7 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors focus-visible:ring-2 focus-visible:ring-brandBlue/50 focus-visible:outline-none"
          >
            <ChevronLeft size={15} />
          </button>
        )}
      </div>

      <nav
        aria-label="Student navigation"
        className="flex-1 overflow-y-auto py-4 px-2 space-y-4 scrollbar-thin"
      >
        {NAV_GROUPS.map(group => (
          <SidebarNavGroup
            key={group.label}
            group={group}
            isCollapsed={isCollapsed}
            badges={badges}
            onNavigate={onNavigate}
          />
        ))}
      </nav>

      <div className={`border-t border-slate-100 shrink-0 ${isCollapsed ? 'px-2 py-3 flex flex-col items-center gap-2' : 'px-3 py-3 space-y-2'}`}>
        <StudentSessionCard
          user={user}
          isCollapsed={isCollapsed}
          onClick={() => { navigate('/student/profile'); onNavigate(); }}
        />

        {isCollapsed ? (
          <div className="group relative flex justify-center w-full">
            <button
              type="button"
              onClick={() => setShowLogoutDialog(true)}
              aria-label="Logout"
              className="w-11 h-11 flex items-center justify-center rounded-xl text-slate-400 hover:bg-red-50 hover:text-red-600 transition-all duration-150 focus-visible:ring-2 focus-visible:ring-red-400/50 focus-visible:outline-none"
            >
              <LogOut size={18} strokeWidth={1.8} />
            </button>
            <SidebarTooltip label="Logout Session" count={0} />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowLogoutDialog(true)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-500 hover:bg-red-50 hover:text-red-600 transition-all duration-150 focus-visible:ring-2 focus-visible:ring-red-400/50 focus-visible:outline-none group"
          >
            <LogOut size={17} strokeWidth={1.8} className="text-slate-400 group-hover:text-red-500 transition-colors shrink-0" />
            <span>Logout Session</span>
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-slate-50/60 overflow-hidden font-sans">
      <aside className={`hidden md:flex flex-col flex-shrink-0 relative z-20 h-full transition-all duration-300 ${isSidebarCollapsed ? 'w-[76px]' : 'w-[272px]'}`}>
        {isSidebarCollapsed && (
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label="Expand sidebar"
            className="absolute top-4 -right-4 z-30 h-7 w-7 rounded-lg bg-white border border-slate-200 shadow-sm flex items-center justify-center text-slate-400 hover:text-brandBlue hover:border-brandBlue/40 transition-all focus-visible:ring-2 focus-visible:ring-brandBlue/50 focus-visible:outline-none"
          >
            <ChevronRight size={14} />
          </button>
        )}
        <SidebarContent isCollapsed={isSidebarCollapsed} />
      </aside>

      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-navy/55 backdrop-blur-sm z-40 md:hidden animate-in fade-in duration-200"
          onClick={closeMobileMenu}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 md:hidden flex flex-col transform transition-transform duration-300 ease-in-out ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}
        aria-modal="true"
        aria-label="Mobile navigation"
      >
        <button
          type="button"
          onClick={closeMobileMenu}
          aria-label="Close menu"
          className="absolute top-3.5 right-3 z-10 h-8 w-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-navy transition-colors focus-visible:ring-2 focus-visible:ring-brandBlue/50 focus-visible:outline-none"
        >
          <X size={18} />
        </button>
        <SidebarContent isCollapsed={false} onNavigate={closeMobileMenu} />
      </aside>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 md:h-16 bg-white/95 backdrop-blur-md border-b border-slate-200/80 flex items-center justify-between px-3.5 md:px-5 z-30 sticky top-0 shadow-xs shrink-0">
          <div className="flex items-center gap-2.5">
            {/* Mobile Compact Brand Header */}
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-brandBlue to-blue-700 text-white flex items-center justify-center shadow-sm">
                <BookOpen size={16} />
              </div>
              <div className="flex flex-col leading-none">
                <span className="font-black text-sm text-navy tracking-tight">SeatSync</span>
                <span className="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider mt-0.5">{currentPageTitle}</span>
              </div>
            </div>

            <div className="hidden md:flex items-center gap-2">
              <Badge className="bg-blue-50 text-brandBlue border-blue-200/80 px-2.5 py-1 rounded-full text-[11px] font-extrabold flex items-center gap-1">
                <Sparkles size={10} /> Student Portal
              </Badge>
              <div className="flex items-center gap-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200/70 px-3 py-1 rounded-full text-xs font-semibold">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                Library Open
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-3">
            <div className="hidden lg:flex items-center gap-1.5 text-xs font-semibold text-slate-500 bg-slate-100/70 border border-slate-200/80 px-3 py-1.5 rounded-xl font-mono">
              <Clock size={12} className="text-slate-400" />
              <span>{format(currentTime, 'EEEE, d MMM yyyy • hh:mm:ss a')}</span>
            </div>

            <div className="relative" ref={notifRef}>
              <Button
                variant="ghost"
                size="icon"
                className="relative rounded-xl hover:bg-slate-100 text-navy h-10 w-10 focus-visible:ring-2 focus-visible:ring-brandBlue/30"
                onClick={() => setIsNotifOpen(prev => !prev)}
                aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
              >
                <Bell size={19} />
                {unreadCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[9px] font-extrabold text-white shadow-sm border border-white">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </Button>

              {isNotifOpen && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-2xl shadow-2xl border border-slate-200/90 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="p-4 border-b border-slate-100 bg-slate-50/80 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-navy">Notifications</span>
                      {unreadCount > 0 && (
                        <Badge className="bg-brandBlue text-white text-[10px] px-2 py-0.5 font-extrabold">{unreadCount} new</Badge>
                      )}
                    </div>
                    {unreadCount > 0 && (
                      <button onClick={handleMarkAllRead} className="text-xs text-brandBlue hover:underline font-bold">
                        Mark all read
                      </button>
                    )}
                  </div>

                  <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                    {notifications.length === 0 ? (
                      <div className="p-8 text-center text-xs text-slate-400 font-medium">No notifications yet.</div>
                    ) : (
                      notifications.slice(0, 5).map(n => (
                        <div key={n.id} className={`p-3.5 text-xs flex items-start justify-between gap-3 transition-colors ${!n.isRead ? 'bg-blue-50/40' : 'hover:bg-slate-50'}`}>
                          <div className="space-y-0.5 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className={`font-bold ${!n.isRead ? 'text-brandBlue' : 'text-navy'}`}>{n.title}</span>
                              <span className="text-[10px] text-slate-400 font-mono shrink-0">
                                {(() => {
                                  const dateVal = n.createdAt || n.timestamp;
                                  if (!dateVal) return 'Recently';
                                  try {
                                    const d = new Date(dateVal);
                                    if (isNaN(d.getTime())) return 'Recently';
                                    return formatDistanceToNow(d, { addSuffix: true });
                                  } catch {
                                    return 'Recently';
                                  }
                                })()}
                              </span>
                            </div>
                            <p className="text-slate-500 leading-relaxed text-[11px]">{n.message}</p>
                          </div>
                          {!n.isRead && (
                            <button onClick={(e) => handleMarkAsRead(n.id, e)} className="text-slate-300 hover:text-brandBlue p-1 shrink-0 transition-colors" title="Mark as read">
                              <Check size={13} />
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>

                  <div className="p-3 border-t border-slate-100 bg-slate-50 text-center">
                    <button
                      onClick={() => { setIsNotifOpen(false); navigate('/student/notifications'); }}
                      className="text-xs font-bold text-brandBlue hover:underline"
                    >
                      View All Notifications →
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="relative" ref={userMenuRef}>
              <button
                type="button"
                onClick={() => setIsUserMenuOpen(prev => !prev)}
                aria-label="User menu"
                className="flex items-center gap-2 p-1 rounded-xl hover:bg-slate-100 transition-colors focus-visible:ring-2 focus-visible:ring-brandBlue/30 focus-visible:outline-none"
              >
                <div className="h-8 w-8 rounded-full bg-gradient-to-br from-brandBlue to-blue-700 text-white font-extrabold text-xs flex items-center justify-center shadow-sm border border-brandBlue/20">
                  {(user?.name || 'S').charAt(0).toUpperCase()}
                </div>
                <div className="text-left hidden sm:block">
                  <p className="text-xs font-bold leading-none text-navy">{user?.name}</p>
                  <p className="text-[10px] text-slate-400 font-mono mt-0.5">{user?.collegeId || '—'}</p>
                </div>
                <ChevronDown size={13} className="text-slate-400 hidden sm:block" />
              </button>

              {isUserMenuOpen && (
                <div className="absolute right-0 mt-2 w-60 bg-white rounded-2xl shadow-2xl border border-slate-200/90 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="p-4 bg-gradient-to-r from-navy to-slate-900 space-y-1">
                    <p className="text-xs font-bold text-white">{user?.name}</p>
                    <p className="text-[11px] text-blue-200 font-mono">{user?.collegeId || '—'}</p>
                    <Badge className="bg-white/20 text-white text-[9px] font-extrabold uppercase tracking-wider mt-1">Student Account</Badge>
                  </div>
                  <div className="p-1.5 space-y-0.5 text-xs font-semibold text-slate-600">
                    {[
                      { label: 'My Profile', path: '/student/profile', icon: User, color: 'text-brandBlue' },
                      { label: 'My Bookings', path: '/student/reservations', icon: BookmarkCheck, color: 'text-teal-600' },
                      { label: 'Waiting List', path: '/student/waitlist', icon: Users, color: 'text-amber-600' },
                      { label: 'Notifications', path: '/student/notifications', icon: Bell, color: 'text-blue-600' },
                    ].map(({ label, path, icon: Icon, color }) => (
                      <button
                        key={path}
                        type="button"
                        onClick={() => { setIsUserMenuOpen(false); navigate(path); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-slate-100 hover:text-navy transition-colors text-left"
                      >
                        <Icon size={14} className={color} /> {label}
                      </button>
                    ))}
                    <div className="border-t border-slate-100 my-1 pt-1">
                      <button
                        type="button"
                        onClick={() => { setIsUserMenuOpen(false); setShowLogoutDialog(true); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-red-600 hover:bg-red-50 transition-colors text-left font-bold"
                      >
                        <LogOut size={14} /> Logout
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-3.5 md:p-6 lg:p-8 pb-28 md:pb-8">
          <Outlet />
        </div>

        <nav
          aria-label="Mobile bottom navigation"
          className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/80 flex justify-around items-center pt-1.5 pb-[calc(0.35rem+env(safe-area-inset-bottom,0px))] px-1 shadow-lg"
        >
          {BOTTOM_NAV_ITEMS.map((item) => (
            <NavLink
              key={item.name}
              to={item.path}
              aria-label={item.name}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 py-1 px-2.5 rounded-xl text-[10px] font-bold transition-all min-w-[44px] min-h-[44px] justify-center ${
                  isActive ? 'text-brandBlue' : 'text-slate-400 hover:text-navy'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <div className={`p-1 rounded-lg ${isActive ? 'bg-brandBlue/10' : ''}`}>
                    <item.icon size={18} strokeWidth={isActive ? 2.2 : 1.8} />
                  </div>
                  <span>{item.name}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </main>

      <LogoutConfirmationDialog
        isOpen={showLogoutDialog}
        onCancel={() => setShowLogoutDialog(false)}
        onConfirm={handleLogout}
      />
    </div>
  );
}
