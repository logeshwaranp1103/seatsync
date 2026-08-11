import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { slotService } from '../../services/slotService';
import { useAuth } from '../../auth/AuthProvider';
import { useSync } from '../../hooks/useSync';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import { Layers, Clock, RefreshCw, AlertTriangle, CheckCircle2, ShieldAlert, User, Calendar, Ban } from 'lucide-react';
import DisableSlotModal from './DisableSlotModal';
import { format, addDays } from 'date-fns';
import toast from 'react-hot-toast';
import {
  formatSlotTime,
  formatSlotRange,
  getSlotPeriod,
  formatSlotTitle,
  sortSlotsChronologically
} from '../../utils/timeUtils';


export default function SlotConfigPage() {
  const { user } = useAuth();
  const [slots, setSlots] = useState([]);
  const [libraries, setLibraries] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [selectedLibraryId, setSelectedLibraryId] = useState(null);
  const [selectedRoomId, setSelectedRoomId] = useState(null);

  const tomorrowDateStr = format(addDays(new Date(), 1), 'yyyy-MM-dd');
  const [selectedDate, setSelectedDate] = useState(tomorrowDateStr);
  const [loading, setLoading] = useState(true);

  // Modal State
  const [selectedSlotForDisable, setSelectedSlotForDisable] = useState(null);
  const [isDisableModalOpen, setIsDisableModalOpen] = useState(false);

  // Fetch initial filters (libraries & rooms)
  useEffect(() => {
    async function initFilters() {
      try {
        const [{ data: libData }, { data: roomData }] = await Promise.all([
          supabase.from('libraries').select('id, name').order('name'),
          supabase.from('rooms').select('id, name, library_id').order('name')
        ]);
        if (libData && libData.length > 0) {
          setLibraries(libData);
          setSelectedLibraryId(libData[0].id);
        }
        if (roomData && roomData.length > 0) {
          setRooms(roomData);
          setSelectedRoomId(roomData[0].id);
        }
      } catch { /* proceed */ }
    }
    initFilters();
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      setLoading(true);
      const data = await slotService.getAdminSlotOccurrences({
        libraryId: selectedLibraryId,
        roomId: selectedRoomId,
        dateStr: selectedDate
      });
      setSlots(sortSlotsChronologically(data || []));
    } catch (err) {
      toast.error('Failed to load slot configuration: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedLibraryId, selectedRoomId, selectedDate]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  useSync(['slot_occurrences', 'slots', 'bookings'], fetchConfig);

  const handleOpenDisableModal = (slot) => {
    setSelectedSlotForDisable(slot);
    setIsDisableModalOpen(true);
  };

  const handleEnableSlot = async (slot) => {
    try {
      const res = await slotService.enableSlotOccurrence({
        slotOccurrenceId: slot.slot_occurrence_id,
        slotId: slot.slot_id,
        dateStr: selectedDate,
        slotName: slot.slot_name
      });
      toast.success(res.message);
      window.dispatchEvent(new CustomEvent('seatsync-sync-event', { detail: { type: 'slot_occurrences' } }));
      fetchConfig();
    } catch (err) {
      toast.error(err?.message || 'Failed to enable slot.');
    }
  };

  const handleToggleGlobalMasterSlot = async (slot) => {
    try {
      if (slot.master_is_active) {
        const reason = window.prompt(`Enter global disable reason for ${slot.slot_name} (applies to all dates):`, 'Global maintenance');
        if (!reason || !reason.trim()) return;
        await slotService.disableMasterSlot({ slotId: slot.slot_id, reason: reason.trim() });
        toast.success(`Master slot ${slot.slot_name} globally disabled.`);
      } else {
        await slotService.enableMasterSlot({ slotId: slot.slot_id });
        toast.success(`Master slot ${slot.slot_name} globally enabled.`);
      }
      window.dispatchEvent(new CustomEvent('seatsync-sync-event', { detail: { type: 'slots' } }));
      fetchConfig();
    } catch (err) {
      toast.error(err.message || 'Failed to update master slot state.');
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300 pb-12">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
            <Clock size={28} className="text-indigo-600" />
            <span>Time Slots & Date Occurrence Control</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Manage reusable master slots and date-specific slot cancellations/disabling for students.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-white border border-slate-300 rounded-xl px-3 py-1.5 shadow-xs">
            <Calendar size={14} className="text-indigo-600" />
            <span className="text-xs font-bold text-slate-600">Effective Date:</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="text-xs font-mono font-bold text-navy focus:outline-none"
            />
          </div>

          <Button onClick={fetchConfig} variant="outline" className="text-xs font-bold rounded-xl h-9">
            <RefreshCw size={14} className="mr-1.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* Main Slots List Card */}
      <Card className="border border-slate-200/90 rounded-2xl shadow-xs overflow-hidden bg-white">
        <CardHeader className="border-b border-slate-100 bg-slate-50/80 p-4 flex items-center justify-between">
          <CardTitle className="text-base font-bold text-navy flex items-center gap-2">
            <Layers size={18} className="text-indigo-600" />
            <span>Configured Time Slots — Date: <span className="font-mono text-indigo-700">{selectedDate}</span></span>
          </CardTitle>
          <Badge className="bg-indigo-100 text-indigo-800 text-xs font-mono font-bold">
            {slots.length} Slots Defined
          </Badge>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400 font-mono animate-pulse">
              Loading slot occurrence state for {selectedDate}...
            </div>
          ) : slots.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 font-mono italic">
              No slot configurations found.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 text-xs">
              {slots.map(s => {
                const isMasterDisabled = s.master_is_active === false;
                const isOccurrenceCancelled = s.occurrence_status === 'cancelled' || s.is_booking_enabled === false;
                const isDisabled = isMasterDisabled || isOccurrenceCancelled;

                return (
                  <div
                    key={s.slot_id}
                    className={`p-4 sm:p-5 space-y-3 transition-colors ${
                      isDisabled ? 'bg-red-50/30' : 'hover:bg-slate-50/80'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-black text-navy text-sm sm:text-base">
                            {formatSlotTitle(s.slot_name, s.start_time, s.end_time)}
                          </span>
                          
                          <Badge variant="outline" className="text-[10px] font-bold uppercase bg-white">
                            {getSlotPeriod(s.start_time)}
                          </Badge>

                          {isMasterDisabled ? (
                            <Badge className="bg-purple-600 text-white text-[10px] font-bold">
                              GLOBALLY DISABLED
                            </Badge>
                          ) : isOccurrenceCancelled ? (
                            <Badge className="bg-red-600 text-white text-[10px] font-bold">
                              CANCELLED ON {selectedDate}
                            </Badge>
                          ) : (
                            <Badge className="bg-emerald-600 text-white text-[10px] font-bold">
                              ACTIVE
                            </Badge>
                          )}

                          {s.active_bookings_count > 0 && (
                            <Badge className="bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-mono font-bold">
                              {s.active_bookings_count} Active Booking{s.active_bookings_count > 1 ? 's' : ''}
                            </Badge>
                          )}
                        </div>

                        <div className="text-xs text-slate-500 font-mono flex items-center gap-2">
                          <span>{formatSlotRange(s.start_time, s.end_time)}</span>
                        </div>
                      </div>

                      {/* Action Controls */}
                      <div className="flex items-center gap-2">
                        {isOccurrenceCancelled ? (
                          <Button
                            onClick={() => handleEnableSlot(s)}
                            variant="outline"
                            className="h-8 text-xs font-bold rounded-xl border-emerald-300 text-emerald-700 hover:bg-emerald-50 shadow-xs"
                          >
                            <CheckCircle2 size={14} className="mr-1 text-emerald-600" /> Enable Slot for Date
                          </Button>
                        ) : (
                          <Button
                            onClick={() => handleOpenDisableModal(s)}
                            variant="outline"
                            className="h-8 text-xs font-bold rounded-xl border-red-300 text-red-700 hover:bg-red-50 shadow-xs"
                          >
                            <Ban size={14} className="mr-1 text-red-600" /> Disable / Cancel for Date
                          </Button>
                        )}

                        <Button
                          onClick={() => handleToggleGlobalMasterSlot(s)}
                          variant="ghost"
                          className="h-8 text-[11px] font-semibold text-slate-500 hover:text-slate-900 rounded-xl"
                          title="Globally disable/enable master slot for ALL future dates"
                        >
                          {isMasterDisabled ? 'Re-enable Master' : 'Disable Master'}
                        </Button>
                      </div>
                    </div>

                    {/* Cancellation Info Banner */}
                    {isDisabled && (
                      <div className="p-3 bg-red-50 border border-red-200/90 rounded-2xl text-xs space-y-1">
                        <div className="flex items-center justify-between text-red-800 font-bold">
                          <span className="flex items-center gap-1.5">
                            <ShieldAlert size={14} className="text-red-600" />
                            {isMasterDisabled ? 'Globally Disabled Master Slot' : 'Slot Occurrence Cancelled for Date'}
                          </span>
                          {s.disabled_at && (
                            <span className="text-[10px] font-mono text-red-600">
                              {new Date(s.disabled_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-red-700 font-medium">
                          <strong>Reason:</strong> {s.cancellation_reason || 'No cancellation reason provided.'}
                        </p>
                        {s.disabled_by_name && (
                          <p className="text-[10px] text-red-600 font-medium">
                            Action by: <span className="font-bold">{s.disabled_by_name}</span>
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Date-Specific Cancellation Modal */}
      <DisableSlotModal
        isOpen={isDisableModalOpen}
        onClose={() => setIsDisableModalOpen(false)}
        slot={selectedSlotForDisable}
        dateStr={selectedDate}
        adminUser={user}
        onSuccess={fetchConfig}
      />
    </div>
  );
}
