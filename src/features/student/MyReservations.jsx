import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { bookingService } from '../../services/bookingService';
import { db } from '../../services/mockDatabase';
import { useSync } from '../../hooks/useSync';
import { Card, CardContent } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../components/shared/Dialog';
import { 
  QrCode, Clock, MapPin, Calendar, AlertTriangle, CheckCircle2, XCircle, LogOut, 
  ArrowRight, ShieldCheck, RefreshCw, Copy, Info, Search, Plus, Filter, ArrowUpDown, 
  Check, Download, Zap, Sparkles, Building2, Users, Layers, AlertCircle, ChevronRight, Eye, ShieldAlert, Ban
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { format, parse, isAfter, isBefore, addDays } from 'date-fns';
import { QRCodeCanvas } from 'qrcode.react';
import { buildEntryQrPayload } from '../../utils/qrPayload.js';
import CheckoutQrModal from '../../components/student/CheckoutQrModal';

function getBookingState(booking) {
  if (!booking) return null;
  const rawStatus = (booking.status || '').toUpperCase();
  const rawSource = (booking.cancellationSource || booking.cancellation_source || '').toLowerCase();

  if (rawStatus === 'CANCELLED_BY_ADMIN' || rawSource === 'admin_slot' || rawSource === 'admin') {
    return 'CANCELLED_BY_ADMIN';
  }

  if (rawStatus === 'CANCELLED_BY_STUDENT' || rawStatus === 'CANCELLED') {
    if (rawSource === 'admin_slot' || rawSource === 'admin') return 'CANCELLED_BY_ADMIN';
    return 'CANCELLED_BY_STUDENT';
  }

  if (rawStatus === 'COMPLETED' || rawStatus === 'CHECKED_OUT') return 'COMPLETED';
  if (rawStatus === 'CHECKOUT_PENDING') return 'CHECKOUT_PENDING';

  const now = new Date();
  const datePart = booking.bookingDate || format(now, 'yyyy-MM-dd');
  let startDateTime = null;
  let endDateTime = null;

  if (booking.slotTime && booking.slotTime.includes('–')) {
    const [rawStart, rawEnd] = booking.slotTime.split('–').map(s => s.trim());
    try {
      startDateTime = parse(`${datePart} ${rawStart}`, 'yyyy-MM-dd hh:mm a', new Date());
      endDateTime = parse(`${datePart} ${rawEnd}`, 'yyyy-MM-dd hh:mm a', new Date());
    } catch {
      startDateTime = null;
    }
  }

  if (!startDateTime) {
    return rawStatus === 'ACTIVE' ? 'ACTIVE' : 'UPCOMING';
  }

  if (isAfter(now, endDateTime)) return 'COMPLETED';
  if (isAfter(now, startDateTime) && isBefore(now, endDateTime)) return 'ACTIVE';
  return 'UPCOMING';
}

function formatHumanDate(dateStr) {
  if (!dateStr) return '';
  try {
    const dateObj = parse(dateStr, 'yyyy-MM-dd', new Date());
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const tomorrowStr = format(addDays(new Date(), 1), 'yyyy-MM-dd');

    if (dateStr === todayStr) {
      return `Today · ${format(dateObj, 'EEEE, d MMMM yyyy')}`;
    }
    if (dateStr === tomorrowStr) {
      return `Tomorrow · ${format(dateObj, 'EEEE, d MMMM yyyy')}`;
    }
    return format(dateObj, 'EEEE, d MMMM yyyy');
  } catch {
    return dateStr;
  }
}

export default function MyReservations() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [bookings, setBookings] = useState([]);
  const [waitlistEntries, setWaitlistEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modals state
  const [qrModalTarget, setQrModalTarget] = useState(null);
  const [detailTarget, setDetailTarget] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false);
  const [checkoutPassData, setCheckoutPassData] = useState(null);
  const [requestingCheckout, setRequestingCheckout] = useState(false);

  const handleRequestCheckout = async (booking) => {
    if (!booking || !user) return;
    setRequestingCheckout(true);
    try {
      const res = await bookingService.requestCheckoutQr(booking.id);
      if (!res.success) {
        toast.error(res.message || 'Failed to generate checkout QR.');
        return;
      }
      setCheckoutPassData(res.checkoutPass);
      setCheckoutModalOpen(true);
      toast.success('Checkout QR generated — show it to the librarian.');
      fetchBookingsAndWaitlist();
    } catch (err) {
      toast.error(err.message || 'Failed to request checkout QR.');
    } finally {
      setRequestingCheckout(false);
    }
  };

  // Filter & Sort state
  const [selectedFilter, setSelectedFilter] = useState('ALL'); // ALL, ACTIVE, UPCOMING, WAITLISTED, COMPLETED, CANCELLED
  const [sortBy, setSortBy] = useState('nearest'); // nearest, newest, oldest

  const fetchBookingsAndWaitlist = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const [userBookings, localWaitlist] = await Promise.all([
        bookingService.getMyBookings(user.id),
        db.read('seatsync_waitlist').catch(() => [])
      ]);

      setBookings(userBookings || []);
      const userWaiting = (localWaitlist || []).filter(
        w => String(w.studentId) === String(user.id) && (w.status || '').toLowerCase() === 'waiting'
      );
      setWaitlistEntries(userWaiting);
    } catch {
      toast.error('Failed to load reservations data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBookingsAndWaitlist();
  }, [user]);

  useSync(['bookings', 'slot_occurrences', 'slots', 'notifications', 'seatsync_bookings'], fetchBookingsAndWaitlist);

  // Calculate conflict booking IDs (same date + overlapping slot time)
  const conflictBookingIds = useMemo(() => {
    const ids = new Set();
    const activeAndUpcoming = bookings.filter(b => {
      const st = getBookingState(b);
      return st === 'ACTIVE' || st === 'UPCOMING';
    });

    for (let i = 0; i < activeAndUpcoming.length; i++) {
      for (let j = i + 1; j < activeAndUpcoming.length; j++) {
        const b1 = activeAndUpcoming[i];
        const b2 = activeAndUpcoming[j];

        if (b1.bookingDate === b2.bookingDate) {
          if (b1.slotTime === b2.slotTime || (b1.slotId && b1.slotId === b2.slotId)) {
            ids.add(b1.id);
            ids.add(b2.id);
          }
        }
      }
    }
    return ids;
  }, [bookings]);

  // Identify nearest upcoming/active booking
  const nearestBookingId = useMemo(() => {
    const activeOrUpcoming = bookings.filter(b => {
      const st = getBookingState(b);
      return st === 'ACTIVE' || st === 'UPCOMING';
    });

    if (activeOrUpcoming.length === 0) return null;

    const active = activeOrUpcoming.find(b => getBookingState(b) === 'ACTIVE');
    if (active) return active.id;

    const sorted = [...activeOrUpcoming].sort((a, b) => {
      const tA = (a.bookingDate || '') + (a.slotTime || '');
      const tB = (b.bookingDate || '') + (b.slotTime || '');
      return tA.localeCompare(tB);
    });

    return sorted[0]?.id || null;
  }, [bookings]);

  // Counts for statistics & filters
  const counts = useMemo(() => {
    const active = bookings.filter(b => ['ACTIVE', 'CHECKOUT_PENDING'].includes(getBookingState(b))).length;
    const upcoming = bookings.filter(b => getBookingState(b) === 'UPCOMING').length;
    const completed = bookings.filter(b => getBookingState(b) === 'COMPLETED').length;
    const cancelled = bookings.filter(b => ['CANCELLED_BY_STUDENT', 'CANCELLED_BY_ADMIN'].includes(getBookingState(b))).length;
    const waitlisted = waitlistEntries.length;
    const all = bookings.length;

    return { all, active, upcoming, completed, cancelled, waitlisted };
  }, [bookings, waitlistEntries]);

  // Filtered and sorted bookings
  const filteredAndSortedBookings = useMemo(() => {
    let list = [...bookings];

    if (selectedFilter === 'ACTIVE') {
      list = list.filter(b => ['ACTIVE', 'CHECKOUT_PENDING'].includes(getBookingState(b)));
    } else if (selectedFilter === 'UPCOMING') {
      list = list.filter(b => getBookingState(b) === 'UPCOMING');
    } else if (selectedFilter === 'COMPLETED') {
      list = list.filter(b => getBookingState(b) === 'COMPLETED');
    } else if (selectedFilter === 'CANCELLED') {
      list = list.filter(b => ['CANCELLED_BY_STUDENT', 'CANCELLED_BY_ADMIN'].includes(getBookingState(b)));
    }

    if (sortBy === 'nearest') {
      list.sort((a, b) => {
        if (a.id === nearestBookingId) return -1;
        if (b.id === nearestBookingId) return 1;
        const tA = (a.bookingDate || '') + (a.slotTime || '');
        const tB = (b.bookingDate || '') + (b.slotTime || '');
        return tA.localeCompare(tB);
      });
    } else if (sortBy === 'newest') {
      list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    } else if (sortBy === 'oldest') {
      list.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    }

    return list;
  }, [bookings, selectedFilter, sortBy, nearestBookingId]);

  const handleCopyId = (id, e) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(id);
    toast.success(`Booking reference ${id} copied!`);
  };

  const handleDownloadQr = (booking) => {
    const canvas = document.getElementById(`qr-canvas-${booking.id}`);
    if (!canvas) {
      toast.error('Unable to generate pass image.');
      return;
    }
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `SeatSync-Pass-${booking.seatNumber || 'Seat'}-${booking.bookingDate}.png`;
    a.click();
    toast.success('QR Pass image saved to device!');
  };

  const handleCancelBooking = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await bookingService.cancelBooking(cancelTarget.id, user.id);
      toast.success('Reservation cancelled successfully');
      setCancelTarget(null);
      fetchBookingsAndWaitlist();
    } catch (err) {
      toast.error(err.message || 'Failed to cancel booking');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300 pb-16">
      {/* 1. HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight">My Library Reservations</h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-0.5">
            View active QR passes, upcoming bookings, and historical reservation standing.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={fetchBookingsAndWaitlist} variant="outline" className="text-xs font-bold rounded-xl h-9">
            <RefreshCw size={14} className="mr-1.5" /> Refresh
          </Button>
          <Button onClick={() => navigate('/student/find-seat')} className="bg-brandBlue hover:bg-blue-600 text-white font-bold text-xs rounded-xl h-9 shadow-sm">
            <Plus size={16} className="mr-1.5" /> Book New Seat
          </Button>
        </div>
      </div>

      {/* 2. STATS OVERVIEW CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        <Card className="border border-slate-200/90 shadow-xs hover:border-emerald-500/40 transition-all rounded-2xl bg-white">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-100">
              <Zap size={20} />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Active Sessions</p>
              <h3 className="text-lg font-black text-navy mt-0.5">{counts.active}</h3>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-slate-200/90 shadow-xs hover:border-brandBlue/40 transition-all rounded-2xl bg-white">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-50 text-brandBlue flex items-center justify-center shrink-0 border border-blue-100">
              <Calendar size={20} />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Upcoming Passes</p>
              <h3 className="text-lg font-black text-navy mt-0.5">{counts.upcoming}</h3>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-slate-200/90 shadow-xs hover:border-amber-500/40 transition-all rounded-2xl bg-white">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 border border-amber-100">
              <Users size={20} />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Waitlist Entries</p>
              <h3 className="text-lg font-black text-navy mt-0.5">{counts.waitlisted}</h3>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-slate-200/90 shadow-xs hover:border-slate-400/40 transition-all rounded-2xl bg-white">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center shrink-0 border border-slate-200">
              <CheckCircle2 size={20} />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Completed</p>
              <h3 className="text-lg font-black text-navy mt-0.5">{counts.completed}</h3>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 3. FILTER BAR & SORT CONTROL */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-2 sm:p-2.5 rounded-2xl border border-slate-200/90 shadow-xs">
        {/* Filter Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          {[
            { id: 'ALL', label: 'All', count: counts.all },
            { id: 'ACTIVE', label: 'Active', count: counts.active },
            { id: 'UPCOMING', label: 'Upcoming', count: counts.upcoming },
            { id: 'WAITLISTED', label: 'Waitlisted', count: counts.waitlisted },
            { id: 'COMPLETED', label: 'Completed', count: counts.completed },
            { id: 'CANCELLED', label: 'Cancelled', count: counts.cancelled },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setSelectedFilter(tab.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 ${
                selectedFilter === tab.id
                  ? 'bg-navy text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-navy'
              }`}
            >
              <span>{tab.label}</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-extrabold ${
                selectedFilter === tab.id ? 'bg-white/20 text-white' : 'bg-slate-200/80 text-slate-600'
              }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Sort Control */}
        <div className="flex items-center gap-2 border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-100 shrink-0 self-end sm:self-center">
          <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1">
            <ArrowUpDown size={12} /> Sort:
          </span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="h-8 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl px-2.5 text-navy focus:outline-none focus:ring-2 focus:ring-brandBlue/30"
          >
            <option value="nearest">Nearest First</option>
            <option value="newest">Newest Created</option>
            <option value="oldest">Oldest Created</option>
          </select>
        </div>
      </div>

      {/* 4. RESERVATIONS LIST */}
      {selectedFilter !== 'WAITLISTED' && (
        loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-44 bg-white rounded-2xl border border-slate-200/90 animate-pulse p-6 space-y-4">
                <div className="h-5 bg-slate-100 rounded-lg w-1/3"></div>
                <div className="h-16 bg-slate-50 rounded-xl w-full"></div>
              </div>
            ))}
          </div>
        ) : filteredAndSortedBookings.length === 0 ? (
          <Card className="border border-slate-200 shadow-xs rounded-2xl bg-white p-10 text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-blue-50 text-brandBlue flex items-center justify-center mx-auto border border-blue-100">
              <Calendar size={28} />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-bold text-navy">No Reservations Found</h3>
              <p className="text-xs text-slate-500 font-medium max-w-md mx-auto">
                {selectedFilter === 'ALL'
                  ? "You haven't reserved any library seats yet. Click below to book a seat."
                  : `No reservations found under the "${selectedFilter}" filter.`}
              </p>
            </div>
            <Button
              onClick={() => navigate('/student/find-seat')}
              className="bg-brandBlue hover:bg-blue-600 text-white font-bold h-10 px-6 rounded-xl text-xs shadow-sm"
            >
              Book a Seat Now <ArrowRight size={14} className="ml-1.5" />
            </Button>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredAndSortedBookings.map(booking => {
              const computedState = getBookingState(booking);
              const isNearest = booking.id === nearestBookingId;
              const hasConflict = conflictBookingIds.has(booking.id);
              const isCancelledByAdmin = computedState === 'CANCELLED_BY_ADMIN';
              const isCancelledByStudent = computedState === 'CANCELLED_BY_STUDENT';
              const isCompleted = computedState === 'COMPLETED';
              const isActive = computedState === 'ACTIVE';
              const isCheckoutPending = computedState === 'CHECKOUT_PENDING';
              const isUpcoming = computedState === 'UPCOMING';

              return (
                <Card
                  key={booking.id}
                  className={`border-2 transition-all rounded-2xl overflow-hidden shadow-xs relative ${
                    isCancelledByAdmin
                      ? 'border-red-500 bg-red-50/60 shadow-xs'
                      : hasConflict
                      ? 'border-red-400 bg-red-50/20'
                      : isNearest
                      ? 'border-brandBlue/50 bg-gradient-to-r from-blue-50/60 via-white to-slate-50 shadow-md border-l-4 border-l-brandBlue'
                      : 'border-slate-200/90 hover:border-brandBlue/40 bg-white'
                  }`}
                >
                  <CardContent className="p-5 space-y-4">
                    
                    {/* CARD HEADER */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        {isNearest && !isCancelledByAdmin && (
                          <Badge className="bg-brandBlue text-white font-extrabold text-[10px] px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow-xs">
                            <Sparkles size={11} className="text-amber-300" /> YOUR NEXT RESERVATION
                          </Badge>
                        )}

                        <Badge className={`font-bold text-xs flex items-center gap-1 px-2.5 py-0.5 ${
                          isCancelledByAdmin ? 'bg-red-600 text-white font-black uppercase' :
                          isCancelledByStudent ? 'bg-red-500 text-white' :
                          isActive ? 'bg-emerald-600 text-white' :
                          isCheckoutPending ? 'bg-amber-500 text-white' :
                          isCompleted ? 'bg-slate-600 text-white' : 'bg-brandBlue text-white'
                        }`}>
                          {isCancelledByAdmin ? <Ban size={13} /> :
                           isCancelledByStudent ? <XCircle size={12} /> :
                           isActive ? <Zap size={12} /> :
                           isCheckoutPending ? <Clock size={12} /> :
                           isCompleted ? <CheckCircle2 size={12} /> : <Calendar size={12} />}
                          
                          {isCancelledByAdmin ? 'SLOT CANCELLED BY ADMIN' :
                           isCancelledByStudent ? 'Cancelled by You' :
                           isActive ? 'Active Session' :
                           isCheckoutPending ? 'Pending Checkout' :
                           isCompleted ? 'Completed' : 'Upcoming Pass'}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-3 text-xs font-mono font-bold text-slate-600">
                        <span className="flex items-center gap-1 text-slate-700">
                          <Calendar size={14} className="text-brandBlue" /> {formatHumanDate(booking.bookingDate)}
                        </span>
                        
                        <div className="flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded-lg text-[11px]">
                          <span className="text-slate-500">Ref:</span>
                          <span className="text-navy">{booking.bookingCode || booking.id}</span>
                          <button
                            onClick={(e) => handleCopyId(booking.id, e)}
                            className="text-slate-400 hover:text-brandBlue transition-colors ml-1 p-0.5"
                            title="Copy Booking Reference"
                          >
                            <Copy size={12} />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* CANCELLED BY ADMIN DETAILED NOTICE BANNER */}
                    {isCancelledByAdmin && (
                      <div className="p-3.5 bg-white border border-red-300 rounded-xl text-xs space-y-1.5 shadow-xs">
                        <div className="font-bold text-red-700 flex items-center gap-1.5 text-sm">
                          <ShieldAlert size={16} className="text-red-600" />
                          <span>Slot Cancelled by Administrator</span>
                        </div>
                        <p className="text-xs text-slate-700 font-medium">
                          <strong>Reason:</strong> {booking.cancellationReason || booking.cancellation_reason || 'No reason was provided by the administrator.'}
                        </p>
                        {booking.cancelledAt && (
                          <p className="text-[10.5px] text-slate-500 font-mono">
                            Cancelled at: {new Date(booking.cancelledAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                          </p>
                        )}
                      </div>
                    )}

                    {/* MAIN INFORMATION GRID */}
                    <div className="grid sm:grid-cols-4 gap-3 bg-slate-50/80 border border-slate-200/80 rounded-xl p-3.5 text-xs">
                      <div>
                        <span className="text-slate-400 font-semibold block text-[10px] uppercase tracking-wider">Seat Number</span>
                        <span className="font-black text-navy text-base flex items-center gap-1.5">
                          <MapPin size={16} className="text-brandBlue" /> {(() => {
                            const sn = booking.seatNumber;
                            if (!sn) return 'S-01';
                            const str = String(sn).trim();
                            if (str.length > 20 || str.includes('-4cbf-') || str.match(/^[0-9a-f-]{36}$/i)) return 'S-01';
                            return str;
                          })()}
                        </span>
                      </div>

                      <div>
                        <span className="text-slate-400 font-semibold block text-[10px] uppercase tracking-wider">Library & Floor</span>
                        <span className="font-bold text-navy block truncate">{booking.libraryName || 'Central Library'}</span>
                        <span className="text-slate-500 text-[11px] font-medium">{booking.floorName || 'Ground Floor'}</span>
                      </div>

                      <div>
                        <span className="text-slate-400 font-semibold block text-[10px] uppercase tracking-wider">Time Slot</span>
                        <span className="font-bold text-navy font-mono flex items-center gap-1">
                          <Clock size={13} className="text-brandBlue" /> {booking.slotTime || '08:00 AM – 09:00 AM'}
                        </span>
                      </div>

                      <div>
                        <span className="text-slate-400 font-semibold block text-[10px] uppercase tracking-wider">Status Standing</span>
                        <span className={`font-bold font-mono text-xs block ${
                          isCancelledByAdmin ? 'text-red-700' :
                          isCancelledByStudent ? 'text-red-600' :
                          isActive ? 'text-emerald-700' : 'text-indigo-700'
                        }`}>
                          {isCancelledByAdmin ? 'Cancelled by Admin' :
                           isCancelledByStudent ? 'Cancelled by Student' :
                           isActive ? 'Session Checked-In' : 'Pass Confirmed'}
                        </span>
                      </div>
                    </div>

                    {/* WALK-IN ALLOCATION NOTICE */}
                    {(booking.booking_source === 'librarian_walk_in' || booking.bookingSource === 'librarian_walk_in' || booking.is_cancellable === false || booking.isCancellable === false) && (
                      <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl text-xs flex items-center justify-between gap-2 text-amber-900 font-medium">
                        <span className="font-bold flex items-center gap-1.5">
                          <Badge className="bg-amber-600 text-white font-mono font-extrabold text-[10px] px-2 py-0.5 rounded-md">
                            Walk-In • Allocated by Librarian
                          </Badge>
                          <span>Non-cancellable walk-in allocation. This seat was allocated at the librarian desk.</span>
                        </span>
                      </div>
                    )}

                    {/* FOOTER ACTIONS */}
                    {!isCancelledByAdmin && !isCancelledByStudent && !isCompleted && (
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Button
                            onClick={() => setQrModalTarget(booking)}
                            variant="outline"
                            className="h-8 text-xs font-bold rounded-xl border-brandBlue/30 text-brandBlue hover:bg-blue-50"
                          >
                            <QrCode size={13} className="mr-1.5" /> View Entry Pass
                          </Button>

                          {bookingService.canRequestCheckout(booking, user) && (
                            <Button
                              onClick={() => handleRequestCheckout(booking)}
                              disabled={requestingCheckout}
                              className="h-8 text-xs font-bold rounded-xl bg-amber-600 hover:bg-amber-700 text-white shadow-xs disabled:opacity-50"
                            >
                              <LogOut size={13} className="mr-1.5" />
                              {requestingCheckout ? 'Generating...' : 'Request Checkout QR'}
                            </Button>
                          )}
                        </div>

                        {(booking.booking_source === 'librarian_walk_in' || booking.bookingSource === 'librarian_walk_in' || booking.is_cancellable === false || booking.isCancellable === false) ? (
                          <span className="text-[11px] font-bold text-amber-800 bg-amber-100/70 px-3 py-1 rounded-xl border border-amber-300">
                            Non-cancellable Walk-In Allocation
                          </span>
                        ) : (
                          <Button
                            onClick={() => setCancelTarget(booking)}
                            variant="ghost"
                            className="h-8 text-xs font-bold rounded-xl text-red-600 hover:bg-red-50"
                          >
                            <XCircle size={13} className="mr-1.5" /> Cancel Pass
                          </Button>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )
      )}

      {/* QR PASS MODAL */}
      {qrModalTarget && (
        <Dialog open={!!qrModalTarget} onOpenChange={() => setQrModalTarget(null)}>
          <DialogContent className="max-w-sm bg-white rounded-3xl p-6 text-center space-y-4 border border-slate-200 shadow-2xl">
            <DialogHeader className="space-y-1">
              <DialogTitle className="text-lg font-black text-navy">Library Entry Pass</DialogTitle>
              <DialogDescription className="text-xs text-slate-500 font-medium">
                Scan this QR code at the library entrance scanner.
              </DialogDescription>
            </DialogHeader>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3 flex flex-col items-center">
              <div className="p-3 bg-white rounded-xl shadow-xs border border-slate-200">
                <QRCodeCanvas
                  id={`qr-canvas-${qrModalTarget.id}`}
                  value={buildEntryQrPayload(qrModalTarget.qrToken || qrModalTarget.id)}
                  size={160}
                />
              </div>
              <div className="text-xs font-mono font-bold text-navy">
                Seat {(() => {
                  const sn = qrModalTarget.seatNumber;
                  if (!sn) return 'S-01';
                  const str = String(sn).trim();
                  if (str.length > 20 || str.includes('-4cbf-') || str.match(/^[0-9a-f-]{36}$/i)) return 'S-01';
                  return str;
                })()} • {qrModalTarget.slotTime}
              </div>
            </div>

            <Button
              onClick={() => handleDownloadQr(qrModalTarget)}
              className="w-full bg-brandBlue hover:bg-blue-600 text-white font-bold h-10 text-xs rounded-xl shadow-xs flex items-center justify-center gap-1.5"
            >
              <Download size={14} /> Save QR Image to Device
            </Button>
          </DialogContent>
        </Dialog>
      )}

      {/* CANCEL CONFIRMATION DIALOG */}
      {cancelTarget && (
        <Dialog open={!!cancelTarget} onOpenChange={() => setCancelTarget(null)}>
          <DialogContent className="max-w-md bg-white rounded-3xl p-6 space-y-4 border border-slate-200 shadow-2xl">
            <DialogHeader className="text-left space-y-1">
              <DialogTitle className="text-lg font-black text-navy flex items-center gap-2">
                <AlertTriangle size={20} className="text-amber-500" /> Cancel Reservation?
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                This will release seat <strong className="text-navy">{cancelTarget.seatNumber}</strong> for other students.
              </DialogDescription>
            </DialogHeader>

            <DialogFooter className="flex items-center justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setCancelTarget(null)} className="rounded-xl text-xs font-bold h-10">
                Keep Reservation
              </Button>
              <Button
                onClick={handleCancelBooking}
                disabled={cancelling}
                className="bg-red-600 hover:bg-red-700 text-white font-bold text-xs h-10 px-5 rounded-xl shadow-sm"
              >
                {cancelling ? 'Cancelling...' : 'Confirm Cancellation →'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {/* CHECKOUT QR MODAL */}
      <CheckoutQrModal
        isOpen={checkoutModalOpen}
        onClose={() => setCheckoutModalOpen(false)}
        passData={checkoutPassData}
        onCheckoutCompleted={() => {
          fetchBookingsAndWaitlist();
          setCheckoutModalOpen(false);
        }}
      />
    </div>
  );
}
