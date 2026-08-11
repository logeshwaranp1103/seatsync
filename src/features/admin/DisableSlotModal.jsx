import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../components/shared/Dialog';
import { Button } from '../../components/shared/Button';
import { Label } from '../../components/shared/Label';
import { Input } from '../../components/shared/Input';
import { AlertTriangle, ShieldAlert, Calendar, Users, BookmarkX, Clock, CheckCircle2 } from 'lucide-react';
import { slotService } from '../../services/slotService';
import toast from 'react-hot-toast';

const REASON_OPTIONS = [
  'Library closed for maintenance',
  'Staff unavailable',
  'Power or network issue',
  'Special event',
  'Emergency closure',
  'Low staffing',
  'Other'
];

export default function DisableSlotModal({ isOpen, onClose, slot, dateStr, adminUser, onSuccess }) {
  const [reason, setReason] = useState('Library closed for maintenance');
  const [customMessage, setCustomMessage] = useState('');
  const [confirmedNotice, setConfirmedNotice] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && slot) {
      setConfirmedNotice(false);
      setReason('Library closed for maintenance');
      setCustomMessage('');
    }
  }, [isOpen, slot, dateStr]);

  const handleDisable = async () => {
    const finalReason = reason === 'Other' ? customMessage.trim() : reason;

    if (!finalReason) {
      toast.error('Cancellation reason is required. Please state why this slot is being cancelled.');
      return;
    }

    if (!confirmedNotice) {
      toast.error('Please check the confirmation box to proceed.');
      return;
    }

    setLoading(true);
    try {
      const res = await slotService.cancelSlotOccurrence({
        slotId: slot.slot_id || slot.id,
        libraryId: slot.library_id,
        roomId: slot.room_id,
        dateStr: dateStr || slot.occurrence_date,
        reason: finalReason
      });

      toast.success(
        `${slot.slot_name || slot.label || slot.name || 'Slot'} cancelled for ${dateStr}. ` +
        `${res.cancelledBookingCount || 0} active booking(s) cancelled and notified.`
      );
      if (onSuccess) onSuccess(res);
      onClose();
    } catch (err) {
      toast.error(err?.message || 'Failed to cancel slot occurrence.');
    } finally {
      setLoading(false);
    }
  };

  if (!slot) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg bg-white rounded-3xl p-6 space-y-5 border border-slate-200 shadow-2xl">
        <DialogHeader className="space-y-1 text-left">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center shrink-0">
              <AlertTriangle size={22} />
            </div>
            <div>
              <DialogTitle className="text-xl font-black text-navy">
                Cancel {slot.slot_name || slot.label || slot.name}?
              </DialogTitle>
              <p className="text-xs text-slate-500 font-medium">
                {slot.start_time || slot.startTime} – {slot.end_time || slot.endTime} • Effective Date: <span className="font-bold font-mono text-navy">{dateStr}</span>
              </p>
            </div>
          </div>
        </DialogHeader>

        {/* Warning Banner */}
        <div className="p-4 bg-red-50/80 border border-red-200 text-red-800 rounded-2xl space-y-1 text-xs">
          <div className="font-bold flex items-center gap-1.5 text-red-700">
            <ShieldAlert size={16} />
            <span>Date-Specific Cancellation Notice</span>
          </div>
          <p className="text-[11px] leading-relaxed text-red-600 font-medium">
            This will prevent new bookings and cancel any active student reservations for <strong className="font-mono">{dateStr}</strong>. Affected students will receive an immediate notification with your cancellation reason.
          </p>
        </div>

        {/* Reason Selection */}
        <div className="space-y-2">
          <Label className="text-xs font-bold text-navy">Reason for Cancellation *</Label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full h-10 rounded-xl border border-slate-300 px-3 text-xs font-semibold bg-white text-navy"
          >
            {REASON_OPTIONS.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>

          {reason === 'Other' && (
            <Input
              placeholder="Enter custom cancellation reason..."
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              className="h-10 text-xs rounded-xl border-slate-300 text-navy mt-2 font-medium"
              required
            />
          )}
        </div>

        {/* Confirmation Checkbox */}
        <div className="flex items-start gap-2.5 p-3 rounded-2xl bg-slate-50 border border-slate-200">
          <input
            type="checkbox"
            id="confirm-cancel"
            checked={confirmedNotice}
            onChange={(e) => setConfirmedNotice(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-red-600 focus:ring-red-500 cursor-pointer"
          />
          <label htmlFor="confirm-cancel" className="text-xs text-slate-700 font-medium cursor-pointer">
            I understand that cancelling this slot occurrence will cancel active student bookings for <span className="font-mono font-bold">{dateStr}</span> and notify affected students.
          </label>
        </div>

        <DialogFooter className="flex items-center justify-end gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="rounded-xl text-xs font-bold text-slate-700 h-10 px-4"
          >
            Keep Active
          </Button>
          <Button
            type="button"
            onClick={handleDisable}
            disabled={loading}
            className="bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold h-10 px-5 shadow-md"
          >
            {loading ? 'Cancelling Slot...' : 'Cancel Slot Occurrence →'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
