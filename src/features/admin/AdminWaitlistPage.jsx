import React, { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { waitlistService } from '../../services/waitlistService';
import { useSync } from '../../hooks/useSync';
import { Card, CardContent } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import { 
  ListOrdered, RefreshCw, Clock, Sparkles, Calendar, ChevronLeft, 
  ChevronRight, Search, Filter, ShieldCheck, Check, Building2, Send, Trash2
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format, addDays, subDays, parseISO } from 'date-fns';
import { formatSlotTime, formatSlotRange, getSlotPeriod, formatSlotTitle, sortSlotsChronologically } from '../../utils/timeUtils.js';

const format12HourTime = formatSlotTime;


const DEFAULT_LIBRARIES = [
  { id: 'lib-main-001', name: 'Central University Library' },
  { id: 'lib-eng-002', name: 'Engineering & Tech Library' },
  { id: 'lib-med-003', name: 'Medical Sciences Library' }
];

export default function AdminWaitlistPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const todayIST = useMemo(() => waitlistService.getTodayISTDateStr(), []);

  // Library selection state
  const initialLibraryId = searchParams.get('library') || 'lib-main-001';
  const [selectedLibraryId, setSelectedLibraryId] = useState(initialLibraryId);
  const [libraries, setLibraries] = useState(DEFAULT_LIBRARIES);

  // Date selection state
  const initialDate = searchParams.get('date') || todayIST;
  const [selectedDate, setSelectedDate] = useState(initialDate);

  // Slot occurrences summary state
  const [slotSummaries, setSlotSummaries] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(true);

  // Selected slot state
  const initialSlotId = searchParams.get('slot');
  const [selectedSlotId, setSelectedSlotId] = useState(initialSlotId);

  // Isolated Queue state
  const [queueData, setQueueData] = useState({ total_count: 0, entries: [] });
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [realtimeStatus, setRealtimeStatus] = useState('connected');

  // Fetch libraries from Supabase
  useEffect(() => {
    async function fetchLibraries() {
      try {
        const { data } = await supabase.from('libraries').select('id, name');
        if (data && data.length > 0) setLibraries(data);
      } catch { /* fallback */ }
    }
    fetchLibraries();
  }, []);

  // Sync Library, Date & Slot with URL query parameters
  useEffect(() => {
    const params = {};
    if (selectedLibraryId) params.library = selectedLibraryId;
    if (selectedDate) params.date = selectedDate;
    if (selectedSlotId) params.slot = selectedSlotId;
    setSearchParams(params, { replace: true });
  }, [selectedLibraryId, selectedDate, selectedSlotId]);

  // Load Date & Library Slot Summaries
  const fetchSlotSummaries = async () => {
    try {
      setLoadingSlots(true);
      const summaries = await waitlistService.getWaitlistSlotSummary(selectedLibraryId, selectedDate);
      setSlotSummaries(summaries || []);
    } catch (err) {
      toast.error('Failed to load date slots.');
    } finally {
      setLoadingSlots(false);
    }
  };

  useEffect(() => {
    fetchSlotSummaries();
  }, [selectedLibraryId, selectedDate]);

  // Selected Slot occurrence object
  const selectedSlot = useMemo(() => {
    return slotSummaries.find(s => String(s.slot_id) === String(selectedSlotId));
  }, [slotSummaries, selectedSlotId]);

  // Fetch Isolated Queue for Selected Slot Occurrence
  const fetchQueueForSelectedSlot = async () => {
    if (!selectedSlotId) {
      setQueueData({ total_count: 0, entries: [] });
      return;
    }
    try {
      setLoadingQueue(true);
      const res = await waitlistService.getWaitlistForOccurrence({
        slotId: selectedSlotId,
        bookingDate: selectedDate,
        statusFilter,
        searchQuery
      });
      setQueueData(res || { total_count: 0, entries: [] });
    } catch (err) {
      toast.error('Failed to load waitlist queue.');
    } finally {
      setLoadingQueue(false);
    }
  };

  useEffect(() => {
    fetchQueueForSelectedSlot();
  }, [selectedSlotId, selectedDate, statusFilter, searchQuery]);

  // Realtime subscription scoped to selected slot occurrence
  useEffect(() => {
    if (!selectedSlotId || !selectedDate) return;

    setRealtimeStatus('connected');
    const channel = supabase
      .channel(`realtime-admin-waitlist-${selectedSlotId}-${selectedDate}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'waitlist_entries',
          filter: `booking_date=eq.${selectedDate}`
        },
        () => {
          fetchSlotSummaries();
          fetchQueueForSelectedSlot();
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setRealtimeStatus('connected');
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          setRealtimeStatus('reconnecting');
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedSlotId, selectedDate]);

  // Date Navigation Handlers
  const handlePreviousDay = () => {
    const prev = format(subDays(parseISO(selectedDate), 1), 'yyyy-MM-dd');
    setSelectedDate(prev);
    setSelectedSlotId(null);
  };

  const handleNextDay = () => {
    const next = format(addDays(parseISO(selectedDate), 1), 'yyyy-MM-dd');
    setSelectedDate(next);
    setSelectedSlotId(null);
  };

  const handleToday = () => {
    setSelectedDate(todayIST);
    setSelectedSlotId(null);
  };

  const handleSlotSelect = (slotId) => {
    if (selectedSlotId === slotId) {
      setSelectedSlotId(null);
    } else {
      setSelectedSlotId(slotId);
    }
  };

  const handleAllocateSeat = async (slotId, dateStr) => {
    try {
      await waitlistService.notifyNextStudent(dateStr, slotId);
      toast.success('Admin waitlist promotion dispatched.');
      fetchSlotSummaries();
      fetchQueueForSelectedSlot();
    } catch {
      toast.error('Failed to allocate seat.');
    }
  };

  const handleRemoveEntry = async (entryId) => {
    try {
      await waitlistService.leaveWaitlist(entryId);
      toast.success('Entry removed from queue.');
      fetchSlotSummaries();
      fetchQueueForSelectedSlot();
    } catch {
      toast.error('Failed to remove entry.');
    }
  };

  const getSlotCardBadge = (slotItem) => {
    if (slotItem.slot_status === 'cancelled' || slotItem.slot_status === 'disabled') {
      return <Badge className="bg-rose-100 text-rose-800 border-rose-300 font-bold">Cancelled</Badge>;
    }
    if (slotItem.waiting_count > 0 && slotItem.available_count === 0) {
      return <Badge className="bg-amber-100 text-amber-800 border-amber-300 font-bold">Full with Queue</Badge>;
    }
    if (slotItem.available_count === 0) {
      return <Badge className="bg-rose-100 text-rose-800 border-rose-300 font-bold">Full</Badge>;
    }
    return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-bold">Active</Badge>;
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300 pb-12">

      {/* 1. PAGE HEADER & LIBRARY SELECTOR */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight">System Waitlist Control</h1>
            <Badge className="bg-purple-600 text-white text-xs font-mono font-extrabold px-2.5 py-0.5">
              Admin Portal
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Categorized waitlist inspection by Library, Date, and Slot Occurrence.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Library Selector */}
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-300 rounded-2xl px-3 py-1.5 text-xs font-bold">
            <Building2 size={16} className="text-brandBlue" />
            <select
              value={selectedLibraryId}
              onChange={(e) => {
                setSelectedLibraryId(e.target.value);
                setSelectedSlotId(null);
              }}
              className="bg-transparent font-bold text-navy focus:outline-none cursor-pointer"
            >
              {libraries.map(lib => (
                <option key={lib.id} value={lib.id}>{lib.name}</option>
              ))}
            </select>
          </div>

          <Button
            onClick={() => { fetchSlotSummaries(); fetchQueueForSelectedSlot(); }}
            variant="outline"
            className="border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-bold rounded-2xl h-9"
          >
            <RefreshCw size={14} className="mr-1.5 text-teal-600" /> Refresh
          </Button>
        </div>
      </div>

      {/* 2. DATE SELECTOR CONTROLS */}
      <Card className="border border-slate-200 bg-white rounded-3xl p-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handlePreviousDay}
              className="rounded-2xl h-9 text-xs font-bold border-slate-300 hover:bg-slate-100"
            >
              <ChevronLeft size={16} className="mr-0.5" /> Previous Day
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleToday}
              className={`rounded-2xl h-9 text-xs font-bold ${selectedDate === todayIST ? 'bg-navy text-white border-navy' : 'border-slate-300 hover:bg-slate-100'}`}
            >
              Today (IST)
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleNextDay}
              className="rounded-2xl h-9 text-xs font-bold border-slate-300 hover:bg-slate-100"
            >
              Next Day <ChevronRight size={16} className="ml-0.5" />
            </Button>
          </div>

          <div className="flex items-center gap-3">
            <Calendar size={18} className="text-brandBlue" />
            <span className="text-xs font-bold text-slate-500">Selected Date:</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                if (e.target.value) {
                  setSelectedDate(e.target.value);
                  setSelectedSlotId(null);
                }
              }}
              className="h-9 px-3 rounded-2xl border border-slate-300 text-xs font-bold font-mono bg-slate-50 text-navy focus:outline-none focus:ring-2 focus:ring-brandBlue"
            />
          </div>
        </div>
      </Card>

      {/* 3. SLOT SELECTION CARDS GRID */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-400">
            Slots Scheduled for {selectedDate} ({slotSummaries.length} Slots)
          </h2>
          <span className="text-xs text-slate-400 font-medium">Select a slot to open its specific operational queue</span>
        </div>

        {loadingSlots ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-32 bg-slate-100 rounded-3xl animate-pulse" />)}
          </div>
        ) : slotSummaries.length === 0 ? (
          <Card className="border border-slate-200 bg-white rounded-3xl p-8 text-center text-xs text-slate-400">
            No slot occurrences scheduled for this date and library.
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {slotSummaries.map((slotItem) => {
              const isSelected = String(slotItem.slot_id) === String(selectedSlotId);

              return (
                <Card
                  key={slotItem.slot_occurrence_id || slotItem.slot_id}
                  onClick={() => handleSlotSelect(slotItem.slot_id)}
                  className={`
                    relative cursor-pointer rounded-3xl border-2 transition-all duration-200 overflow-hidden shadow-xs
                    ${isSelected 
                      ? 'border-brandBlue bg-blue-50/40 ring-4 ring-blue-500/20 shadow-md scale-[1.02]' 
                      : 'border-slate-200/90 bg-white hover:border-slate-300 hover:-translate-y-0.5'
                    }
                  `}
                >
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-navy">{slotItem.slot_name}</span>
                      {isSelected ? (
                        <div className="w-5 h-5 rounded-full bg-brandBlue text-white flex items-center justify-center shadow-xs">
                          <Check size={12} className="stroke-[3]" />
                        </div>
                      ) : (
                        getSlotCardBadge(slotItem)
                      )}
                    </div>

                    <div className="text-sm font-black font-mono text-brandBlue">
                      {format12HourTime(slotItem.start_time)} – {format12HourTime(slotItem.end_time)}
                    </div>

                    <div className="grid grid-cols-3 gap-1 pt-2 border-t border-slate-100 text-center text-[10px]">
                      <div className="bg-amber-50 rounded-xl p-1.5 border border-amber-200/60">
                        <span className="text-slate-400 font-bold uppercase block text-[8px]">Waiting</span>
                        <span className="font-extrabold text-amber-700 font-mono text-xs">{slotItem.waiting_count}</span>
                      </div>
                      <div className="bg-teal-50 rounded-xl p-1.5 border border-teal-200/60">
                        <span className="text-slate-400 font-bold uppercase block text-[8px]">Offered</span>
                        <span className="font-extrabold text-teal-700 font-mono text-xs">{slotItem.offered_count}</span>
                      </div>
                      <div className="bg-emerald-50 rounded-xl p-1.5 border border-emerald-200/60">
                        <span className="text-slate-400 font-bold uppercase block text-[8px]">Available</span>
                        <span className="font-extrabold text-emerald-700 font-mono text-xs">{slotItem.available_count}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. SELECTED SLOT OCCURRENCE QUEUE VIEW */}
      {!selectedSlotId ? (
        <Card className="border-2 border-dashed border-slate-200 bg-slate-50/50 rounded-3xl p-12 text-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 border border-amber-200 flex items-center justify-center mx-auto">
            <ListOrdered size={28} />
          </div>
          <h3 className="text-base font-bold text-navy">No Slot Selected</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Select any slot card above to inspect its isolated waitlist queue. Entries from different dates or slots are strictly segregated.
          </p>
        </Card>
      ) : (
        <div className="space-y-4 animate-in fade-in">
          {/* Selected Slot Summary Banner */}
          <div className="bg-gradient-to-r from-purple-900 to-navy text-white rounded-3xl p-6 shadow-md space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <Badge className="bg-purple-500/30 text-purple-200 border-purple-400/40 text-xs font-mono font-extrabold">
                    ADMIN OCCURRENCE QUEUE
                  </Badge>
                  <h3 className="text-xl font-black text-white">{selectedSlot?.slot_name || 'Selected Slot'}</h3>
                </div>
                <p className="text-xs text-purple-200 font-medium mt-1">
                  {selectedDate} • {format12HourTime(selectedSlot?.start_time)} – {format12HourTime(selectedSlot?.end_time)} • {libraries.find(l=>l.id===selectedLibraryId)?.name}
                </p>
              </div>

              <Button
                onClick={() => handleAllocateSeat(selectedSlotId, selectedDate)}
                className="bg-teal-500 hover:bg-teal-600 text-white font-bold h-10 px-5 rounded-2xl text-xs flex items-center gap-1.5 shadow-md"
              >
                <Send size={14} /> Trigger FIFO Promotion
              </Button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-white/10 rounded-2xl p-3.5 text-xs font-medium">
              <div>
                <span className="text-purple-200 text-[10px] uppercase font-bold block">Waiting Queue</span>
                <span className="text-lg font-extrabold font-mono text-amber-300">{selectedSlot?.waiting_count || 0} Students</span>
              </div>
              <div>
                <span className="text-purple-200 text-[10px] uppercase font-bold block">Active Holds</span>
                <span className="text-lg font-extrabold font-mono text-teal-300">{selectedSlot?.offered_count || 0} Offered</span>
              </div>
              <div>
                <span className="text-purple-200 text-[10px] uppercase font-bold block">Accepted Bookings</span>
                <span className="text-lg font-extrabold font-mono text-emerald-300">{selectedSlot?.accepted_count || 0} Confirmed</span>
              </div>
              <div>
                <span className="text-purple-200 text-[10px] uppercase font-bold block">Expired / Rejected</span>
                <span className="text-lg font-extrabold font-mono text-rose-300">{(selectedSlot?.expired_count || 0) + (selectedSlot?.rejected_count || 0)} History</span>
              </div>
            </div>
          </div>

          {/* Table Filters & Search */}
          <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-3xl border border-slate-200/90 shadow-xs">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 font-bold flex items-center gap-1 mr-1">
                <Filter size={14} className="text-brandBlue" /> Status:
              </span>
              {['ALL', 'WAITING', 'OFFERED', 'ACCEPTED', 'REJECTED', 'EXPIRED'].map(st => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1.5 rounded-2xl text-xs font-bold transition-all border ${
                    statusFilter === st 
                      ? 'bg-navy text-white border-navy shadow-xs' 
                      : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-64">
              <Search size={14} className="absolute left-3 top-3 text-slate-400" />
              <input
                type="text"
                placeholder="Search student or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-9 pl-9 pr-3 rounded-2xl border border-slate-300 text-xs font-medium bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brandBlue"
              />
            </div>
          </div>

          {/* ISOLATED WAITLIST TABLE */}
          <Card className="border border-slate-200/90 bg-white rounded-3xl shadow-xs overflow-hidden">
            <CardContent className="p-0">
              {loadingQueue ? (
                <div className="p-12 text-center text-xs text-slate-400 animate-pulse">Loading occurrence waitlist...</div>
              ) : queueData.entries.length === 0 ? (
                <div className="p-12 text-center space-y-2">
                  <p className="text-sm font-bold text-navy">No waitlist records found for this slot occurrence.</p>
                  <p className="text-xs text-slate-400">Date: {selectedDate} • Slot: {format12HourTime(selectedSlot?.start_time)}.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                        <th className="p-4">FIFO Pos</th>
                        <th className="p-4">Student Identity</th>
                        <th className="p-4">Department</th>
                        <th className="p-4">Joined Timestamp</th>
                        <th className="p-4">Status</th>
                        <th className="p-4">Offered Seat</th>
                        <th className="p-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {queueData.entries.map((w) => (
                        <tr key={w.id} className="hover:bg-slate-50 text-slate-700">
                          <td className="p-4 font-mono font-black text-purple-700">#{w.queue_position}</td>
                          <td className="p-4 font-sans font-bold text-navy">
                            <div>{w.student_name}</div>
                            <span className="text-[10px] font-mono text-purple-600">{w.registration_number}</span>
                          </td>
                          <td className="p-4 text-slate-600">{w.department}</td>
                          <td className="p-4 font-mono text-[11px] text-slate-500">
                            {new Date(w.joined_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="p-4">
                            <Badge className={`text-[10px] font-bold ${
                              w.status === 'OFFERED' ? 'bg-teal-600 text-white' :
                              w.status === 'ACCEPTED' ? 'bg-emerald-600 text-white' :
                              w.status === 'REJECTED' || w.status === 'EXPIRED' ? 'bg-rose-600 text-white' :
                              'bg-amber-600 text-white'
                            }`}>
                              {w.status}
                            </Badge>
                          </td>
                          <td className="p-4 font-mono font-bold text-navy">
                            {w.offered_seat_number || '—'}
                          </td>
                          <td className="p-4 text-right">
                            <button
                              type="button"
                              onClick={() => handleRemoveEntry(w.id)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 rounded-xl hover:bg-slate-100 transition-all"
                              title="Remove entry"
                            >
                              <Trash2 size={15} />
                            </button>
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
      )}

    </div>
  );
}
