import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import {
  LayoutDashboard, QrCode, UserCheck, BookmarkCheck, UserPlus, Users, UserX, Search,
  Eye, ShieldAlert, Wrench, AlertOctagon, Bell, History, BarChart3,
  ArrowRightLeft, User, LogOut, Menu, X, ChevronDown, ChevronRight, BookOpen,
  Sparkles, Clock, PanelLeftClose, PanelLeftOpen
} from 'lucide-react';
import { Button } from '../components/shared/Button';
import { Badge } from '../components/shared/Badge';
import { format } from 'date-fns';

const NAV_GROUPS = [
  {
    title: 'DASHBOARD',
    items: [
      { name: 'Dashboard', path: '/librarian/dashboard', icon: LayoutDashboard }
    ]
  },
  {
    title: 'BOOKING OPERATIONS',
    items: [
      { name: 'QR Pass Scanner', path: '/librarian/scan-entry', icon: QrCode },
      { name: 'Check-In / Check-Out', path: '/librarian/check-in-out', icon: UserCheck },
      { name: 'Reservations & Seats', path: '/librarian/bookings', icon: BookmarkCheck },
      { name: 'Walk-In Allocation', path: '/librarian/walk-in', icon: UserPlus },
      { name: 'Waiting List Queue', path: '/librarian/waitlist', icon: Users },
      { name: 'Booking Lookup', path: '/librarian/lookup', icon: Search }
    ]
  },
  {
    title: 'LIBRARY MONITORING',
    items: [
      { name: 'Live Occupancy', path: '/librarian/occupancy', icon: Eye },
      { name: 'No-Show Monitor', path: '/librarian/no-shows', icon: ShieldAlert },
      { name: 'Seat Maintenance', path: '/librarian/maintenance', icon: Wrench }
    ]
  },
  {
    title: 'MANAGEMENT',
    items: [
      { name: 'Student Access & Blocking', path: '/librarian/students', icon: UserX },
      { name: 'Notifications', path: '/librarian/notifications', icon: Bell },
      { name: 'Activity Logs', path: '/librarian/activity-logs', icon: History },
      { name: 'Reports & Analytics', path: '/librarian/analytics', icon: BarChart3 },
      { name: 'Shift Handover', path: '/librarian/handover', icon: ArrowRightLeft }
    ]
  },
  {
    title: 'ACCOUNT',
    items: [
      { name: 'Staff Profile', path: '/librarian/profile', icon: User }
    ]
  }
];

export default function LibrarianLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const toggleGroup = (groupTitle) => {
    setCollapsedGroups(prev => ({
      ...prev,
      [groupTitle]: !prev[groupTitle]
    }));
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex h-screen bg-slate-50/60 overflow-hidden font-sans">
      {/* Desktop Sidebar */}
      <aside className={`hidden md:flex flex-col bg-white border-r border-slate-200/80 shadow-sm transition-all duration-300 ${
        isSidebarCollapsed ? 'w-20' : 'w-64'
      } shrink-0`}>
        {/* Header */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-100 bg-white">
          {!isSidebarCollapsed && (
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-teal-600 to-emerald-700 text-white flex items-center justify-center shadow-md shadow-teal-600/20">
                <BookOpen size={16} />
              </div>
              <div className="flex flex-col leading-none">
                <span className="text-sm font-black tracking-tight text-navy">SeatSync</span>
                <span className="text-[9px] font-bold uppercase tracking-widest text-teal-600 mt-0.5">Librarian Portal</span>
              </div>
            </div>
          )}
          {isSidebarCollapsed && (
            <div className="mx-auto h-8 w-8 rounded-xl bg-gradient-to-br from-teal-600 to-emerald-700 text-white flex items-center justify-center shadow-md shadow-teal-600/20">
              <BookOpen size={16} />
            </div>
          )}
          <button
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            title={isSidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
          >
            {isSidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
        </div>

        {/* Navigation items grouped */}
        <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-4 scrollbar-thin">
          {NAV_GROUPS.map(group => {
            const isGroupCollapsed = collapsedGroups[group.title];

            return (
              <div key={group.title} className="space-y-1">
                {!isSidebarCollapsed && (
                  <button
                    onClick={() => toggleGroup(group.title)}
                    className="w-full flex items-center justify-between text-[10px] font-extrabold text-slate-400 uppercase tracking-widest px-2.5 py-1 hover:text-slate-600 select-none"
                  >
                    <span>{group.title}</span>
                    {isGroupCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  </button>
                )}

                {(!isGroupCollapsed || isSidebarCollapsed) && (
                  <div className="space-y-0.5">
                    {group.items.map(item => (
                      <NavLink
                        key={item.path}
                        to={item.path}
                        title={isSidebarCollapsed ? item.name : undefined}
                        className={({ isActive }) =>
                          `flex items-center gap-3 ${isSidebarCollapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5'} rounded-xl text-xs font-semibold transition-all duration-150 ${
                            isActive
                              ? 'bg-gradient-to-r from-teal-600 to-emerald-600 text-white font-bold shadow-md shadow-teal-600/25'
                              : 'text-slate-500 hover:bg-slate-100/90 hover:text-navy hover:translate-x-0.5'
                          }`
                        }
                      >
                        <item.icon size={18} className="shrink-0" />
                        {!isSidebarCollapsed && <span>{item.name}</span>}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* User profile section */}
        <div className="p-3 border-t border-slate-100 bg-white space-y-2">
          {!isSidebarCollapsed ? (
            <>
              <div className="flex items-center gap-3 p-2 bg-slate-50 border border-slate-200/80 rounded-xl">
                <div className="h-8 w-8 rounded-full bg-gradient-to-br from-teal-600 to-emerald-700 text-white font-extrabold text-xs flex items-center justify-center shadow-sm shrink-0">
                  {(user?.name || 'L').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-navy truncate">{user?.name || 'Librarian'}</p>
                  <p className="text-[10px] text-teal-600 font-mono font-bold truncate">{user?.staffId || 'Staff Officer'}</p>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={handleLogout}
                className="w-full h-8 text-[11px] font-bold border-slate-200 text-slate-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 rounded-xl flex items-center justify-center gap-2"
              >
                <LogOut size={14} /> Logout Staff
              </Button>
            </>
          ) : (
            <button
              onClick={handleLogout}
              title="Logout Staff"
              className="w-full py-2.5 flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl"
            >
              <LogOut size={18} />
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-slate-50/60">
        <header className="h-16 bg-white/90 backdrop-blur-md border-b border-slate-200/80 flex items-center justify-between px-4 md:px-6 shrink-0 shadow-xs">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden p-2 rounded-xl text-slate-600 hover:bg-slate-100"
            >
              <Menu size={20} />
            </button>
            <Badge className="bg-teal-50 text-teal-700 border-teal-200/80 font-bold text-xs px-3 py-1 flex items-center gap-1.5 rounded-full">
              <Sparkles size={12} className="text-teal-600" /> Operational Control Desk
            </Badge>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden lg:flex items-center gap-1.5 text-xs font-semibold text-slate-500 bg-slate-100/70 border border-slate-200/80 px-3.5 py-1.5 rounded-xl font-mono">
              <Clock size={13} className="text-slate-400" />
              <span>{format(currentTime, 'EEEE, d MMM yyyy • hh:mm:ss a')}</span>
            </div>
          </div>
        </header>

        {/* Mobile Menu Drawer */}
        {isMobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-50 bg-navy/55 backdrop-blur-sm p-4 flex flex-col justify-between overflow-y-auto animate-in fade-in">
            <div className="bg-white rounded-2xl p-4 space-y-4 shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <span className="font-black text-navy text-base">Librarian Operations</span>
                <button onClick={() => setIsMobileMenuOpen(false)} className="text-slate-400 p-1 rounded-lg hover:bg-slate-100">
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4">
                {NAV_GROUPS.map(group => (
                  <div key={group.title} className="space-y-1">
                    <p className="text-[10px] font-extrabold text-teal-600 uppercase tracking-widest px-2">{group.title}</p>
                    <div className="space-y-0.5">
                      {group.items.map(item => (
                        <NavLink
                          key={item.path}
                          to={item.path}
                          onClick={() => setIsMobileMenuOpen(false)}
                          className={({ isActive }) =>
                            `flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold ${
                              isActive ? 'bg-gradient-to-r from-teal-600 to-emerald-600 text-white font-bold' : 'text-slate-600 hover:bg-slate-100'
                            }`
                          }
                        >
                          <item.icon size={18} />
                          <span>{item.name}</span>
                        </NavLink>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <Button onClick={handleLogout} className="w-full mt-4 bg-red-600 hover:bg-red-700 text-white font-bold h-10 rounded-xl">
                <LogOut size={16} className="mr-2" /> Logout Staff Session
              </Button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-auto p-4 md:p-6 lg:p-8 bg-slate-50/60 text-navy">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
