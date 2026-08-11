import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../shared/Dialog';
import { Button } from '../shared/Button';
import { Badge } from '../shared/Badge';
import { 
  Clock, Calendar, Users, Bell, Info, AlertTriangle, CheckCircle2, X, LogOut, ArrowRight, ShieldCheck
} from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { waitlistService } from '../../services/waitlistService';
import { formatSlotTime } from '../../utils/timeUtils';

export default function WaitlistModal({
  isOpen,
  onClose,
  mode = 'confirm',
  slot,
  dateStr,
  user,
  summary,
  onSuccess
}) {
  const [loading, setLoading] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  if (!slot) return null;

  const formattedDate = dateStr ? format(new Date(dateStr), 'EEEE, d MMM yyyy') : 'Tomorrow';
  const formattedJoinedAt = summary?.studentEntry?.joinedAt 
    ? format(new Date(summary.studentEntry.joinedAt), 'MMM d, yyyy \at h:mm a')
    : 'Recently';

  const handleJoin = async () => {
    if (!user || !slot || !dateStr) return;
    setLoading(true);
    try {
      await waitlistService.joinWaitlist({
        student: user,
        dateStr,
        slot,
        notificationPreference: 'In-App & System Notifications'
      });
      toast.success("You’ve joined the waiting list successfully.");
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      toast.error(err.message || 'Could not join waiting list');
    } finally {
      setLoading(false);
    }
  };

  const handleLeave = async () => {
    if (!user || !summary?.studentEntry?.id) return;
    setLoading(true);
    try {
      await waitlistService.leaveWaitlist(summary.studentEntry.id, user.id);
      toast.success('You have left the waiting list.');
      setShowLeaveConfirm(false);
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      toast.error(err.message || 'Could not leave waiting list');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) { setShowLeaveConfirm(false); onClose(); } }}>
      <DialogContent 
        className="
          sm:max-w-md w-full p-0 overflow-hidden border-0 shadow-2xl rounded-2xl bg-white
          max-sm:fixed max-sm:bottom-0 max-sm:top-auto max-sm:left-0 max-sm:right-0 max-sm:translate-y-0
          max-sm:rounded-t-3xl max-sm:rounded-b-none max-sm:m-0 max-sm:max-w-none animate-in slide-in-from-bottom duration-300
        "
      >
        <div className="bg-gradient-to-r from-amber-500 via-amber-600 to-orange-600 p-5 text-white relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="h-10 w-10 rounded-xl bg-white/20 backdrop-blur-md flex items-center justify-center font-bold text-white shrink-0">
                {mode === 'confirm' ? <Clock size={22} /> : <Users size={22} />}
              </div>
              <div>
                <Badge className="bg-white/20 text-white border-0 text-[10px] font-extrabold uppercase tracking-wider mb-0.5">
                  {mode === 'confirm' ? 'Fully Booked Slot' : 'Waiting List Details'}
                </Badge>
                <DialogTitle className="text-xl font-extrabold text-white leading-tight">
                  {slot.label}
                </DialogTitle>
              </div>
            </div>

            <button 
              onClick={() => { setShowLeaveConfirm(false); onClose(); }} 
              className="h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors focus:outline-none focus:ring-2 focus:ring-white/50"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="space-y-1">
                <span className="text-slate-400 font-semibold text-[10px] uppercase block flex items-center gap-1">
                  <Calendar size={11} /> Date
                </span>
                <span className="font-bold text-navy">{formattedDate}</span>
              </div>
              <div className="space-y-1">
                <span className="text-slate-400 font-semibold text-[10px] uppercase block flex items-center gap-1">
                  <Clock size={11} /> Time Window
                </span>
                <span className="font-bold text-brandBlue font-mono">
                  {format12HourTime(slot.startTime)} – {format12HourTime(slot.endTime)}
                </span>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-xs font-semibold text-slate-600">
              <span className="flex items-center gap-1">
                <Clock size={12} className="text-slate-400" /> Duration: <strong className="text-navy">60 Minutes</strong>
              </span>
              <span className="flex items-center gap-1">
                <Users size={12} className="text-amber-600" /> Queue: <strong className="text-amber-700">{summary?.waitlistCount || 0} waiting</strong>
              </span>
            </div>
          </div>

          {mode === 'confirm' && (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200/80 rounded-2xl p-4 flex items-start gap-3">
                <Info size={20} className="text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-950 leading-relaxed font-medium">
                  This slot is currently full. Would you like to join the waiting list? We’ll notify you if a seat becomes available.
                </p>
              </div>

              <div className="space-y-2 text-xs text-slate-500 font-medium">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={15} className="text-emerald-600 shrink-0" />
                  <span>Fair FIFO queue — seats allocated strictly in order of joining.</span>
                </div>
                <div className="flex items-center gap-2">
                  <Bell size={15} className="text-blue-600 shrink-0" />
                  <span>Instant in-app notification when a seat opens up.</span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-3 pt-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  disabled={loading}
                  className="w-full sm:w-1/2 min-h-[44px] text-xs font-bold border-slate-300 text-slate-700 rounded-xl"
                >
                  Cancel
                </Button>

                <Button
                  type="button"
                  onClick={handleJoin}
                  disabled={loading}
                  className="w-full sm:w-1/2 min-h-[44px] text-xs font-bold bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white rounded-xl shadow-md shadow-amber-500/20 focus:ring-2 focus:ring-amber-500"
                >
                  {loading ? 'Joining...' : 'Yes, Join Waiting List'}
                </Button>
              </div>
            </div>
          )}

          {mode === 'details' && !showLeaveConfirm && (
            <div className="space-y-4">
              <div className="bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-amber-500/10 border-2 border-amber-400/60 rounded-2xl p-4 flex items-center justify-between">
                <div>
                  <Badge className="bg-amber-100 text-amber-800 border-amber-300 font-bold text-[10px] uppercase mb-1">
                    Waitlisted
                  </Badge>
                  <h4 className="text-sm font-bold text-navy">You are on the waiting list</h4>
                  <p className="text-xs text-slate-500 font-medium">Joined {formattedJoinedAt}</p>
                </div>

                <div className="bg-amber-500 text-white px-4 py-2 rounded-xl text-center shadow-md shadow-amber-500/30">
                  <span className="text-[10px] uppercase font-bold tracking-wider block opacity-90">Position</span>
                  <span className="text-2xl font-black font-mono">#{summary?.studentPosition || 1}</span>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 flex items-center justify-between text-xs">
                <span className="text-slate-600 font-semibold flex items-center gap-2">
                  <Bell size={16} className="text-brandBlue" /> Notification Status
                </span>
                <span className="font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                  {summary?.studentEntry?.notificationPreference || 'In-App & System Active'}
                </span>
              </div>

              <div className="bg-blue-50/70 border border-blue-200/80 rounded-xl p-3 flex items-start gap-2.5 text-xs text-blue-900 leading-relaxed font-medium">
                <Info size={16} className="text-brandBlue shrink-0 mt-0.5" />
                <span>Your position may change if users ahead of you leave the queue.</span>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowLeaveConfirm(true)}
                  disabled={loading}
                  className="w-full sm:w-1/2 min-h-[44px] text-xs font-bold border-red-200 text-red-700 hover:bg-red-50 hover:border-red-300 rounded-xl"
                >
                  <LogOut size={14} className="mr-1.5" /> Leave Waiting List
                </Button>

                <Button
                  type="button"
                  onClick={onClose}
                  className="w-full sm:w-1/2 min-h-[44px] text-xs font-bold bg-navy hover:bg-navy/90 text-white rounded-xl shadow-sm"
                >
                  Close
                </Button>
              </div>
            </div>
          )}

          {mode === 'details' && showLeaveConfirm && (
            <div className="space-y-4 animate-in fade-in">
              <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3">
                <AlertTriangle size={22} className="text-red-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-bold text-red-950">Leave Waiting List?</h4>
                  <p className="text-xs text-red-800 leading-relaxed mt-1 font-medium">
                    Are you sure you want to leave the queue? You will lose your current position <strong>(#{summary?.studentPosition})</strong>.
                  </p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowLeaveConfirm(false)}
                  disabled={loading}
                  className="w-full sm:w-1/2 min-h-[44px] text-xs font-bold border-slate-300 text-slate-700 rounded-xl"
                >
                  Keep My Position
                </Button>

                <Button
                  type="button"
                  onClick={handleLeave}
                  disabled={loading}
                  className="w-full sm:w-1/2 min-h-[44px] text-xs font-bold bg-red-600 hover:bg-red-700 text-white rounded-xl shadow-sm"
                >
                  {loading ? 'Leaving...' : 'Yes, Leave Queue'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
