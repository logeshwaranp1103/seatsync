import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { db } from '../../services/mockDatabase';
import { librarianService } from '../../services/librarianService';
import { useSync } from '../../hooks/useSync';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import {
  QrCode, RefreshCw, Layers, Users, Armchair, AlertTriangle, TrendingUp,
  Sparkles, CheckCircle2, LogOut, Search, Clock, UserCheck, UserPlus,
  Wrench, Bell, Eye, ShieldAlert, ArrowRight
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function LibrarianDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [metrics, setMetrics] = useState({
    occupiedSeatsCount: 0,
    availableSeatsCount: 40,
    totalSeats: 40,
    todayBookingsCount: 0,
    checkedInCount: 0,
    waitingCount: 0,
    noShowsCount: 0,
    maintenanceSeatsCount: 0,
    occupancyPercentage: 0,
    recentCheckins: [],
    upcomingReservations: [],
    seatsNeedingAttention: []
  });
  const [loading, setLoading] = useState(true);

  const fetchStaffData = async () => {
    try {
      setLoading(true);
      const data = await librarianService.getDashboardMetrics();
      setMetrics(data);
    } catch (err) {
      console.error('Failed to load librarian dashboard data', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStaffData();
  }, []);

  useSync(['seatsync_bookings', 'seatsync_seats', 'seatsync_waitlist', 'seatsync_checkins', 'seatsync_maintenance'], fetchStaffData);

  return (
    <div className="space-y-8 animate-in fade-in duration-300 pb-12">
      {/* HERO BANNER */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-navy via-slate-900 to-navy p-6 sm:p-8 text-white shadow-xl border border-slate-800">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-500/20 border border-teal-400/30 text-teal-300 text-xs font-semibold backdrop-blur-md">
              <Sparkles size={14} className="text-teal-400" />
              <span>SeatSync Staff Command Desk</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
              Welcome, {user?.name || 'Librarian'} 👋
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 max-w-xl leading-relaxed font-medium">
              Real-time library command console tracking {metrics.totalSeats} study seats across Ground Floor and reference zones.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <Button
              variant="outline"
              onClick={fetchStaffData}
              className="bg-white/10 hover:bg-white/20 text-white border-white/20 text-xs font-bold rounded-xl h-10"
            >
              <RefreshCw size={14} className="mr-1.5" /> Refresh State
            </Button>
            <Button
              onClick={() => navigate('/librarian/scan-entry')}
              className="bg-teal-600 hover:bg-teal-700 text-white font-extrabold shadow-md text-xs rounded-xl h-10 px-5"
            >
              <QrCode size={16} className="mr-1.5" /> Scan QR Pass
            </Button>
          </div>
        </div>
      </div>

      {/* QUICK ACTIONS ROW */}
      <div className="space-y-3">
        <h2 className="text-xs font-extrabold text-slate-400 uppercase tracking-widest px-1">Quick Operations</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <button
            onClick={() => navigate('/librarian/scan-entry')}
            className="p-3.5 bg-white hover:bg-slate-50 border border-slate-200/80 rounded-2xl flex flex-col items-center gap-2 text-center transition-all shadow-xs hover:border-teal-500/50 hover:shadow-sm"
          >
            <div className="p-2.5 bg-teal-50 text-teal-600 rounded-xl border border-teal-100">
              <QrCode size={20} />
            </div>
            <span className="text-xs font-bold text-navy">Scan QR</span>
          </button>

          <button
            onClick={() => navigate('/librarian/check-in-out')}
            className="p-3.5 bg-white hover:bg-slate-50 border border-slate-200/80 rounded-2xl flex flex-col items-center gap-2 text-center transition-all shadow-xs hover:border-teal-500/50 hover:shadow-sm"
          >
            <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl border border-emerald-100">
              <UserCheck size={20} />
            </div>
            <span className="text-xs font-bold text-navy">Manual Check-In</span>
          </button>

          <button
            onClick={() => navigate('/librarian/walk-in')}
            className="p-3.5 bg-white hover:bg-slate-50 border border-slate-200/80 rounded-2xl flex flex-col items-center gap-2 text-center transition-all shadow-xs hover:border-teal-500/50 hover:shadow-sm"
          >
            <div className="p-2.5 bg-blue-50 text-brandBlue rounded-xl border border-blue-100">
              <UserPlus size={20} />
            </div>
            <span className="text-xs font-bold text-navy">Walk-In Booking</span>
          </button>

          <button
            onClick={() => navigate('/librarian/lookup')}
            className="p-3.5 bg-white hover:bg-slate-50 border border-slate-200/80 rounded-2xl flex flex-col items-center gap-2 text-center transition-all shadow-xs hover:border-teal-500/50 hover:shadow-sm"
          >
            <div className="p-2.5 bg-purple-50 text-purple-600 rounded-xl border border-purple-100">
              <Search size={20} />
            </div>
            <span className="text-xs font-bold text-navy">Search Booking</span>
          </button>

          <button
            onClick={() => navigate('/librarian/maintenance')}
            className="p-3.5 bg-white hover:bg-slate-50 border border-slate-200/80 rounded-2xl flex flex-col items-center gap-2 text-center transition-all shadow-xs hover:border-teal-500/50 hover:shadow-sm"
          >
            <div className="p-2.5 bg-amber-50 text-amber-600 rounded-xl border border-amber-100">
              <Wrench size={20} />
            </div>
            <span className="text-xs font-bold text-navy">Report Seat Issue</span>
          </button>

          <button
            onClick={() => navigate('/librarian/notifications')}
            className="p-3.5 bg-white hover:bg-slate-50 border border-slate-200/80 rounded-2xl flex flex-col items-center gap-2 text-center transition-all shadow-xs hover:border-teal-500/50 hover:shadow-sm"
          >
            <div className="p-2.5 bg-rose-50 text-rose-600 rounded-xl border border-rose-100">
              <Bell size={20} />
            </div>
            <span className="text-xs font-bold text-navy">Send Notice</span>
          </button>
        </div>
      </div>

      {/* METRICS GRID */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border border-slate-200/80 bg-white rounded-2xl p-5 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-teal-50 text-teal-700 border border-teal-100 flex items-center justify-center shrink-0">
              <Armchair size={22} />
            </div>
            <div>
              <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">Occupied Seats</p>
              <h3 className="text-xl font-black text-navy mt-0.5">{metrics.occupiedSeatsCount} / {metrics.totalSeats}</h3>
            </div>
          </div>
        </Card>

        <Card className="border border-slate-200/80 bg-white rounded-2xl p-5 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-emerald-50 text-emerald-700 border border-emerald-100 flex items-center justify-center shrink-0">
              <CheckCircle2 size={22} />
            </div>
            <div>
              <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">Checked In Today</p>
              <h3 className="text-xl font-black text-navy mt-0.5">{metrics.checkedInCount}</h3>
            </div>
          </div>
        </Card>

        <Card className="border border-slate-200/80 bg-white rounded-2xl p-5 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-amber-50 text-amber-700 border border-amber-100 flex items-center justify-center shrink-0">
              <Users size={22} />
            </div>
            <div>
              <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">Waiting List Queue</p>
              <h3 className="text-xl font-black text-navy mt-0.5">{metrics.waitingCount}</h3>
            </div>
          </div>
        </Card>

        <Card className="border border-slate-200/80 bg-white rounded-2xl p-5 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-rose-50 text-rose-700 border border-rose-100 flex items-center justify-center shrink-0">
              <ShieldAlert size={22} />
            </div>
            <div>
              <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">No-Shows Recorded</p>
              <h3 className="text-xl font-black text-navy mt-0.5">{metrics.noShowsCount}</h3>
            </div>
          </div>
        </Card>
      </div>

      {/* UPCOMING RESERVATIONS TABLE */}
      <Card className="border border-slate-200/80 bg-white rounded-2xl shadow-xs overflow-hidden">
        <CardHeader className="border-b border-slate-100 bg-slate-50/80 p-4 flex flex-row items-center justify-between">
          <CardTitle className="text-base font-bold text-navy flex items-center gap-2">
            <Armchair size={18} className="text-teal-600" /> Today's Active & Upcoming Reservations
          </CardTitle>
          <Button
            variant="outline"
            onClick={() => navigate('/librarian/bookings')}
            className="border-slate-300 text-slate-600 hover:bg-slate-100 text-xs font-bold h-8 rounded-xl"
          >
            View All →
          </Button>
        </CardHeader>

        <CardContent className="p-0">
          {metrics.upcomingReservations.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">No active student bookings found for today.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100/70 border-b border-slate-200/80 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                    <th className="py-3 px-3">Booking ID</th>
                    <th className="py-3 px-3">Student Name</th>
                    <th className="py-3 px-3">Seat</th>
                    <th className="py-3 px-3">Slot Time</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {metrics.upcomingReservations.map(b => (
                    <tr key={b.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-3 font-bold text-navy">{b.id}</td>
                      <td className="py-3 px-3 font-sans font-bold text-navy">{b.studentName}</td>
                      <td className="py-3 px-3 font-bold text-teal-600">{b.seatNumber}</td>
                      <td className="py-3 px-3">{b.slotTime}</td>
                      <td className="py-3 px-3">
                        <Badge className={`text-[10px] font-bold ${
                          b.status === 'active' || b.status === 'checked_in' ? 'bg-teal-600 text-white' : 'bg-brandBlue text-white'
                        }`}>
                          {b.status}
                        </Badge>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <Button
                          onClick={() => navigate('/librarian/check-in-out')}
                          className="h-7 px-2.5 text-[10px] bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-lg"
                        >
                          Verify Desk
                        </Button>
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
