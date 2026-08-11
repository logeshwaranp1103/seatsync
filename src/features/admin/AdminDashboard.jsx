import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { db } from '../../services/mockDatabase';
import { useSync } from '../../hooks/useSync';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import {
  Users, UserCheck, Armchair, Layers, BookmarkCheck, ListOrdered, BarChart3,
  Settings, ShieldCheck, RefreshCw, Sparkles, TrendingUp, AlertTriangle, Clock, ArrowRight
} from 'lucide-react';
import toast from 'react-hot-toast';

import { supabase } from '../../lib/supabase';

export default function AdminDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [stats, setStats] = useState({
    totalStudents: 0,
    totalStaff: 0,
    totalSeats: 40,
    totalBookings: 0,
    activeBookings: 0,
    waitlistCount: 0,
    noShowCount: 0
  });

  const [recentBookings, setRecentBookings] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchAdminData = async () => {
    try {
      setLoading(true);

      // 1. Query Supabase profiles table for real student & staff counts
      let studentCount = 0;
      let staffCount = 0;
      let hasSupabaseProfiles = false;

      try {
        const { data: profilesData, error: profErr } = await supabase
          .from('profiles')
          .select('id, role, status');

        if (!profErr && profilesData && profilesData.length > 0) {
          hasSupabaseProfiles = true;
          studentCount = profilesData.filter(p => String(p.role).toLowerCase() === 'student').length;
          staffCount = profilesData.filter(p => ['librarian', 'senior_librarian', 'support_staff', 'staff'].includes(String(p.role).toLowerCase())).length;
        }
      } catch { /* proceed to fallback */ }

      // 2. Fetch seats, bookings, waitlist, and local database fallback
      const [users, seats, bookings, waitlist] = await Promise.all([
        db.read('seatsync_users').catch(() => []),
        db.read('seatsync_seats').catch(() => []),
        db.read('seatsync_bookings').catch(() => []),
        db.read('seatsync_waitlist').catch(() => [])
      ]);

      const localStudentUsers = (users || []).filter(u => u.role === 'STUDENT');
      const localStaffUsers = (users || []).filter(u => u.role === 'LIBRARIAN' || u.role === 'STAFF');
      const activeBs = (bookings || []).filter(b => b.status === 'confirmed' || b.status === 'active' || b.status === 'checked_in');

      setStats({
        totalStudents: hasSupabaseProfiles ? Math.max(studentCount, localStudentUsers.length) : localStudentUsers.length,
        totalStaff: hasSupabaseProfiles ? Math.max(staffCount, localStaffUsers.length) : localStaffUsers.length,
        totalSeats: (seats || []).length || 40,
        totalBookings: (bookings || []).length,
        activeBookings: activeBs.length,
        waitlistCount: (waitlist || []).length,
        noShowCount: localStudentUsers.reduce((acc, u) => acc + (u.noShowCount || 0), 0)
      });

      setRecentBookings((bookings || []).slice(0, 8));
    } catch (err) {
      console.error('Failed to load admin stats:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdminData();
  }, []);

  useSync((event) => {
    if (event?.type === 'storage_change') fetchAdminData();
  });

  return (
    <div className="space-y-8 animate-in fade-in duration-300 pb-12">
      {/* Hero Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-navy via-indigo-950 to-navy p-6 sm:p-8 text-white shadow-xl border border-slate-800">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-400/30 text-indigo-300 text-xs font-semibold backdrop-blur-md">
              <Sparkles size={14} className="text-indigo-400" />
              <span>SeatSync System Command & Oversight</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Admin Overview Console — {user?.name || 'Administrator'}
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 max-w-xl leading-relaxed">
              Global administration panel for managing students, librarian accounts, seats, time slots, and library policies.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <Button
              variant="outline"
              onClick={fetchAdminData}
              className="bg-white/10 hover:bg-white/20 text-white border-white/20 text-xs font-bold rounded-xl h-10"
            >
              <RefreshCw size={14} className="mr-1.5" /> Sync Data
            </Button>
          </div>
        </div>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border border-slate-200/80 shadow-xs rounded-2xl bg-white hover:border-indigo-500/40 transition-all">
          <CardContent className="p-4 sm:p-5 flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-indigo-50 text-indigo-700 flex items-center justify-center shrink-0 border border-indigo-100">
              <Users size={22} />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-500 uppercase">Total Students</p>
              <h3 className="text-2xl font-black text-navy mt-0.5">{stats.totalStudents}</h3>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-slate-200/80 shadow-xs rounded-2xl bg-white hover:border-teal-500/40 transition-all">
          <CardContent className="p-4 sm:p-5 flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-teal-50 text-teal-700 flex items-center justify-center shrink-0 border border-teal-100">
              <UserCheck size={22} />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-500 uppercase">Staff / Librarians</p>
              <h3 className="text-2xl font-black text-navy mt-0.5">{stats.totalStaff}</h3>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-slate-200/80 shadow-xs rounded-2xl bg-white hover:border-blue-500/40 transition-all">
          <CardContent className="p-4 sm:p-5 flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-blue-50 text-brandBlue flex items-center justify-center shrink-0 border border-blue-100">
              <Armchair size={22} />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-500 uppercase">Configured Seats</p>
              <h3 className="text-2xl font-black text-navy mt-0.5">{stats.totalSeats}</h3>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-slate-200/80 shadow-xs rounded-2xl bg-white hover:border-purple-500/40 transition-all">
          <CardContent className="p-4 sm:p-5 flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-purple-50 text-purple-700 flex items-center justify-center shrink-0 border border-purple-100">
              <BookmarkCheck size={22} />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-500 uppercase">Active / Total Bookings</p>
              <h3 className="text-2xl font-black text-navy mt-0.5">{stats.activeBookings} / {stats.totalBookings}</h3>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Action Navigation Buttons */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Button
          onClick={() => navigate('/admin/students')}
          className="h-12 bg-white hover:bg-slate-50 text-navy border border-slate-200/80 font-bold text-xs rounded-2xl shadow-xs flex items-center justify-center gap-2"
        >
          <Users size={16} className="text-indigo-600" /> Student Management
        </Button>
        <Button
          onClick={() => navigate('/admin/staff')}
          className="h-12 bg-white hover:bg-slate-50 text-navy border border-slate-200/80 font-bold text-xs rounded-2xl shadow-xs flex items-center justify-center gap-2"
        >
          <UserCheck size={16} className="text-teal-600" /> Staff Management
        </Button>
        <Button
          onClick={() => navigate('/admin/seats')}
          className="h-12 bg-white hover:bg-slate-50 text-navy border border-slate-200/80 font-bold text-xs rounded-2xl shadow-xs flex items-center justify-center gap-2"
        >
          <Armchair size={16} className="text-brandBlue" /> Seat Management
        </Button>
        <Button
          onClick={() => navigate('/admin/settings')}
          className="h-12 bg-white hover:bg-slate-50 text-navy border border-slate-200/80 font-bold text-xs rounded-2xl shadow-xs flex items-center justify-center gap-2"
        >
          <Settings size={16} className="text-purple-600" /> System Settings
        </Button>
      </div>

      {/* Recent System Activity Table */}
      <Card className="border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden bg-white">
        <CardHeader className="border-b border-slate-100 bg-slate-50/80 p-4 flex flex-row items-center justify-between">
          <CardTitle className="text-base font-bold text-navy flex items-center gap-2">
            <BookmarkCheck size={18} className="text-indigo-600" /> Global System Reservations Log
          </CardTitle>
          <Button
            variant="outline"
            onClick={() => navigate('/admin/bookings')}
            className="text-xs font-bold rounded-xl h-8 border-slate-300 text-slate-600 hover:bg-slate-100"
          >
            View All Reservations →
          </Button>
        </CardHeader>

        <CardContent className="p-0">
          {recentBookings.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">No reservations recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100/70 border-b border-slate-200/80 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                    <th className="p-3.5">Booking ID</th>
                    <th className="p-3.5">Student</th>
                    <th className="p-3.5">Date</th>
                    <th className="p-3.5">Seat</th>
                    <th className="p-3.5">Slot Time</th>
                    <th className="p-3.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recentBookings.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3.5 font-mono font-bold text-navy">{b.id}</td>
                      <td className="p-3.5 font-bold text-navy">{b.studentName}</td>
                      <td className="p-3.5 font-mono">{b.bookingDate}</td>
                      <td className="p-3.5 font-bold text-indigo-600">{b.seatNumber}</td>
                      <td className="p-3.5 font-mono">{b.slotTime}</td>
                      <td className="p-3.5">
                        <Badge className={`text-[10px] font-bold ${
                          b.status === 'checkout_pending' ? 'bg-amber-500 text-white' :
                          b.status === 'completed' ? 'bg-slate-500 text-white' :
                          b.status === 'cancelled' ? 'bg-red-500 text-white' : 'bg-indigo-600 text-white'
                        }`}>
                          {b.status || 'Active'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
