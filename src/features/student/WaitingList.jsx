import React, { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { waitlistService } from '../../services/waitlistService';
import { bookingService } from '../../services/bookingService';
import { useSync } from '../../hooks/useSync';
import { Card, CardContent } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import { Clock, Calendar, Users, Bell, AlertTriangle, ShieldCheck, CheckCircle2, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { formatSlotTime, formatSlotRange, getSlotPeriod, formatSlotTitle, sortSlotsChronologically } from '../../utils/timeUtils.js';

const format12HourTime = formatSlotTime;


export default function WaitingList() {
  const { user } = useAuth();
  const [myWaitlists, setMyWaitlists] = useState([]);
  const [loading, setLoading] = useState(true);

  const tomorrowDate = bookingService.getTomorrowDateStr();

  const fetchWaitlistData = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const studentEntries = await waitlistService.getStudentWaitlistEntries(user.id);

      const enriched = await Promise.all(
        studentEntries.map(async (entry) => {
          const summary = await waitlistService.getWaitlistSummaryForSlot(
            entry.dateStr,
            entry.slotId,
            user.id
          );
          return { ...entry, summary };
        })
      );

      setMyWaitlists(enriched);
    } catch (err) {
      toast.error('Failed to load waiting list status.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWaitlistData();
  }, [user]);

  useSync(['waitlist_entries', 'seatsync_waitlist'], fetchWaitlistData);

  const handleAcceptOffer = async (entryId) => {
    try {
      const res = await waitlistService.acceptOffer(entryId);
      if (res && res.success) {
        toast.success(`Seat ${res.seat_number || 'A-101'} accepted! Your booking is confirmed.`);
        fetchWaitlistData();
      } else if (res && res.error_code === 'OFFER_EXPIRED') {
        toast.error(res.message || 'This offer has expired.');
        fetchWaitlistData();
      }
    } catch (err) {
      toast.error(err.message || 'Failed to accept offer.');
    }
  };

  const handleRejectOffer = async (entryId) => {
    try {
      await waitlistService.rejectOffer(entryId);
      toast.success('Offer rejected. The seat has been offered to the next student.');
      fetchWaitlistData();
    } catch (err) {
      toast.error('Failed to reject offer.');
    }
  };

  const handleLeaveQueue = async (entryId) => {
    try {
      await waitlistService.leaveWaitlist(entryId, user?.id);
      toast.success('You have left the waiting list queue.');
      fetchWaitlistData();
    } catch (err) {
      toast.error('Could not leave waiting list.');
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="space-y-2 pb-2 border-b border-slate-200/80">
        <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight">My Waiting List Queues</h1>
        <p className="text-xs sm:text-sm text-slate-500 font-medium">
          Track your queue positions and accept seat offers for fully booked library slots.
        </p>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2].map(i => <div key={i} className="h-40 bg-white rounded-2xl border border-slate-200 animate-pulse" />)}
        </div>
      ) : myWaitlists.length === 0 ? (
        <Card className="border border-slate-200 shadow-xs rounded-2xl bg-white p-8 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto border border-amber-200">
            <Users size={28} />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-navy">No Active Waitlists</h3>
            <p className="text-xs text-slate-500 font-medium">You are not currently queued for any fully booked slots.</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {myWaitlists.map(entry => {
            const slot = entry.slot;
            const summary = entry.summary || {};
            const position = summary.studentPosition || entry.queuePosition || 1;
            const aheadCount = Math.max(0, position - 1);
            const isOffered = entry.status === 'offered' || entry.status === 'allocated';

            return (
              <Card key={entry.id} className={`border-2 rounded-2xl overflow-hidden shadow-xs ${isOffered ? 'border-emerald-500 bg-emerald-50/20' : 'border-amber-300/80 bg-white'}`}>
                <CardContent className="p-6 space-y-4">
                  {/* Exclusive Offer Banner */}
                  {isOffered ? (
                    <div className="bg-gradient-to-r from-emerald-600 to-teal-700 text-white rounded-2xl p-5 shadow-md space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 size={24} className="text-emerald-200 animate-bounce" />
                          <h2 className="text-lg font-black tracking-tight">A Seat is Now Available!</h2>
                        </div>
                        <Badge className="bg-white/20 text-white border-white/30 text-xs font-mono font-extrabold">
                          EXCLUSIVE OFFER
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-white/10 rounded-xl p-3 backdrop-blur-xs text-xs">
                        <div>
                          <span className="text-emerald-200 text-[10px] font-bold uppercase block">Seat Assigned</span>
                          <span className="font-black text-white text-base">{entry.offeredSeatNumber || 'A-101'}</span>
                        </div>
                        <div>
                          <span className="text-emerald-200 text-[10px] font-bold uppercase block">Slot Window</span>
                          <span className="font-bold text-white font-mono">{slot?.name || 'Selected Slot'}</span>
                        </div>
                        <div>
                          <span className="text-emerald-200 text-[10px] font-bold uppercase block">Expires At</span>
                          <span className="font-bold text-amber-200 font-mono">
                            {entry.offerExpiresAt ? new Date(entry.offerExpiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '5 mins'}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3 pt-1">
                        <span className="text-xs text-emerald-100 font-medium flex items-center gap-1">
                          <Clock size={14} /> Respond before the countdown expires
                        </span>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            onClick={() => handleRejectOffer(entry.id)}
                            className="bg-white/20 hover:bg-white/30 text-white font-bold h-9 px-4 rounded-xl border-0 text-xs"
                          >
                            Reject Offer
                          </Button>
                          <Button
                            type="button"
                            onClick={() => handleAcceptOffer(entry.id)}
                            className="bg-white text-emerald-800 hover:bg-emerald-50 font-black h-9 px-5 rounded-xl shadow-md text-xs"
                          >
                            Accept Seat
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                        <div className="flex items-center gap-2">
                          <Badge className="bg-amber-500 text-white font-extrabold text-xs">
                            Waitlisted Queue
                          </Badge>
                          <span className="text-xs font-mono font-bold text-slate-500">Entry ID: {entry.id}</span>
                        </div>

                        <div className="bg-amber-500 text-white font-mono font-black text-sm px-3 py-1 rounded-xl shadow-xs">
                          Queue Position: #{position}
                        </div>
                      </div>

                      <div className="grid sm:grid-cols-3 gap-3 bg-amber-50/50 border border-amber-200/60 rounded-xl p-4 text-xs">
                        <div>
                          <span className="text-slate-400 font-bold text-[10px] uppercase block">Slot Label</span>
                          <span className="font-extrabold text-navy text-sm">{slot?.name || slot?.label || 'Afternoon Slot 1'}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 font-bold text-[10px] uppercase block">Time Window</span>
                          <span className="font-bold text-brandBlue font-mono">
                            {slot?.startTime ? `${format12HourTime(slot.startTime)} – ${format12HourTime(slot.endTime)}` : '02:00 PM – 03:00 PM'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 font-bold text-[10px] uppercase block">Date</span>
                          <span className="font-bold text-navy">{entry.dateStr}</span>
                        </div>
                      </div>

                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 flex items-center justify-between">
                        <span className="text-amber-800 font-bold">
                          {aheadCount > 0
                            ? `There are ${aheadCount} student(s) ahead of you in the queue.`
                            : 'You are next in line! You will receive an offer notification as soon as a seat opens.'}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">Privacy Protected</span>
                      </div>

                      <div className="flex items-center justify-between pt-2">
                        <span className="text-xs text-slate-500 font-medium flex items-center gap-1.5">
                          <Bell size={14} className="text-blue-600" /> Exclusive offer system enabled upon seat release
                        </span>

                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => handleLeaveQueue(entry.id)}
                          className="h-9 text-xs font-bold border-red-200 text-red-600 hover:bg-red-50 rounded-xl"
                        >
                          Leave Waiting List
                        </Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
