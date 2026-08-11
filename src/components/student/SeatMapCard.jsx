import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabase.js';
import { Card, CardContent } from '../shared/Card.jsx';
import { Button } from '../shared/Button.jsx';
import { Badge } from '../shared/Badge.jsx';
import { 
  MapPin, Clock, RefreshCw, Zap, Sun, ShieldCheck, Check, AlertCircle, 
  X, Sparkles, Filter, ChevronRight, Lock, CheckCircle2, User
} from 'lucide-react';
import toast from 'react-hot-toast';
import { formatSlotTime, formatSlotRange, getSlotPeriod, formatSlotTitle, sortSlotsChronologically } from '../../utils/timeUtils.js';

const format12HourTime = formatSlotTime;


export default function SeatMapCard({
  floor,
  slot,
  dateStr,
  seats = [],
  loadingSeats = false,
  selectedSeat = null,
  onSelectSeat,
  onConfirmBooking,
  bookingLoading = false,
  onRefresh,
  isSlotCancelled = false,
  user
}) {
  const [realtimeStatus, setRealtimeStatus] = useState('connected'); // 'connected' | 'reconnecting'
  const [lastUpdated, setLastUpdated] = useState('Just now');
  const [filterZone, setFilterZone] = useState('ALL');
  const [filterAvailableOnly, setFilterAvailableOnly] = useState(false);
  const [filterPowerSocket, setFilterPowerSocket] = useState(false);
  const [filterNearWindow, setFilterNearWindow] = useState(false);

  // Setup Supabase Realtime listener for seat map availability changes
  useEffect(() => {
    if (!slot?.id || !dateStr) return;

    setRealtimeStatus('connected');
    const channel = supabase
      .channel(`realtime-seatmap-${slot.id}-${dateStr}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bookings',
          filter: `booking_date=eq.${dateStr}`
        },
        (payload) => {
          setLastUpdated(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
          if (onRefresh) onRefresh();
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
  }, [slot?.id, dateStr]);

  // Recalculate Occupancy Counts
  const occupancyCounts = useMemo(() => {
    let available = 0;
    let reserved = 0;
    let occupied = 0;
    let held = 0;
    let maintenance = 0;
    let userBooked = 0;

    seats.forEach(s => {
      const state = s.status_state || (s.ui_status || '').toLowerCase();
      if (s.isUserBooked || state === 'user_booked') {
        userBooked++;
      }
      if (state === 'maintenance' || s.status === 'maintenance') {
        maintenance++;
      } else if (state === 'occupied' || s.ui_status === 'Occupied') {
        occupied++;
      } else if (state === 'held' || s.ui_status === 'Held') {
        held++;
      } else if (state === 'reserved' || s.ui_status === 'Reserved') {
        reserved++;
      } else if (state === 'available' || s.ui_status === 'Available') {
        available++;
      }
    });

    return { available, reserved, occupied, held, maintenance, userBooked, total: seats.length || 40 };
  }, [seats]);

  // Filtered Seats
  const filteredSeats = useMemo(() => {
    return seats.filter(s => {
      if (filterAvailableOnly && s.status_state !== 'available' && s.ui_status !== 'Available') return false;
      if (filterZone !== 'ALL' && s.zoneId !== filterZone) return false;
      if (filterPowerSocket && !s.powerOutlet) return false;
      if (filterNearWindow && !s.nearWindow) return false;
      return true;
    });
  }, [seats, filterAvailableOnly, filterZone, filterPowerSocket, filterNearWindow]);

  // Group 40 seats into 4 rows of 10 (Bank 1: seats 1-5, Bank 2: seats 6-10 per row)
  const seatRows = useMemo(() => {
    const sorted = [...filteredSeats].sort((a, b) => {
      const numA = parseInt(String(a.seatNumber).replace(/\D/g, ''), 10) || 0;
      const numB = parseInt(String(b.seatNumber).replace(/\D/g, ''), 10) || 0;
      return numA - numB;
    });

    const rows = [];
    for (let r = 0; r < 4; r++) {
      const bank1 = [];
      const bank2 = [];
      for (let c = 0; c < 5; c++) {
        const idx1 = r * 10 + c;
        const idx2 = r * 10 + 5 + c;
        if (sorted[idx1]) bank1.push(sorted[idx1]);
        if (sorted[idx2]) bank2.push(sorted[idx2]);
      }
      rows.push({ rowNumber: r + 1, bank1, bank2 });
    }
    return rows;
  }, [filteredSeats]);

  const handleSeatClick = (seat) => {
    if (isSlotCancelled) {
      toast.error('This slot has been cancelled by the library.');
      return;
    }

    const state = seat.status_state || (seat.ui_status || '').toLowerCase();
    if (state !== 'available' && seat.ui_status !== 'Available') {
      if (seat.isUserBooked) {
        toast.success(`You already have a booking for Seat ${seat.seatNumber}.`);
      } else {
        toast.error(`Seat ${seat.seatNumber} is ${seat.ui_status || 'unavailable'}. Please select an available seat.`);
      }
      return;
    }

    if (selectedSeat?.id === seat.id) {
      onSelectSeat(null); // Deselect
    } else {
      onSelectSeat(seat);
    }
  };

  const clearAllFilters = () => {
    setFilterZone('ALL');
    setFilterAvailableOnly(false);
    setFilterPowerSocket(false);
    setFilterNearWindow(false);
  };

  return (
    <Card className="border-2 border-slate-200/90 rounded-2xl md:rounded-3xl bg-white shadow-lg overflow-hidden animate-in fade-in duration-300">
      <CardContent className="p-3.5 sm:p-6 space-y-5 md:space-y-6">

        {/* 1. HALL HEADER & LIVE STATUS BAR */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3.5 border-b border-slate-200/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-teal-50 border border-teal-200/80 flex items-center justify-center text-teal-600 shadow-xs shrink-0">
              <MapPin size={22} className="sm:w-6 sm:h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-xl font-black text-navy tracking-tight">Main Quiet Reading Hall</h2>
                <Badge className="bg-navy text-white text-[9px] sm:text-[10px] font-mono font-extrabold px-2 py-0.5">
                  Floor 1
                </Badge>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-500 font-medium flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span>Quiet Zone</span>
                <span>•</span>
                <span className="font-bold text-navy">40 online seats</span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200/80 rounded-xl sm:rounded-2xl px-3 py-1.5 text-[11px] sm:text-xs font-semibold">
              {realtimeStatus === 'connected' ? (
                <span className="flex items-center gap-1.5 text-emerald-600 font-bold">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  Live
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-amber-600 font-bold">
                  <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse"></span>
                  Reconnecting...
                </span>
              )}
              <span className="text-slate-300">|</span>
              <span className="text-slate-400 font-mono text-[10px] sm:text-[11px]">{lastUpdated}</span>
            </div>

            {slot && (
              <div className="bg-blue-50 border border-blue-200/80 rounded-xl sm:rounded-2xl px-3 py-1.5 text-[11px] sm:text-xs font-bold text-brandBlue font-mono flex items-center gap-1.5">
                <Clock size={13} className="text-brandBlue shrink-0" />
                <span>{format12HourTime(slot.startTime)} – {format12HourTime(slot.endTime)}</span>
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRefresh}
              className="h-8 sm:h-9 px-3 rounded-xl sm:rounded-2xl text-xs font-bold text-slate-600 border-slate-300 hover:bg-slate-100"
              title="Refresh seat availability"
            >
              <RefreshCw size={13} className="mr-1 text-teal-600" /> Refresh
            </Button>
          </div>
        </div>

        {/* 2. COMPACT OCCUPANCY SUMMARY (2-Column Grid on Mobile) */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 sm:gap-3">
          <div className="bg-emerald-50/80 border border-emerald-200/90 rounded-xl sm:rounded-2xl p-2.5 sm:p-3 text-center transition-all hover:bg-emerald-50">
            <span className="text-[9px] sm:text-[10px] font-extrabold uppercase tracking-wider text-emerald-700 block">Available</span>
            <span className="text-xl sm:text-2xl font-black text-emerald-600 font-mono">{occupancyCounts.available}</span>
          </div>

          <div className="bg-amber-50/80 border border-amber-200/90 rounded-xl sm:rounded-2xl p-2.5 sm:p-3 text-center transition-all hover:bg-amber-50">
            <span className="text-[9px] sm:text-[10px] font-extrabold uppercase tracking-wider text-amber-700 block">Reserved</span>
            <span className="text-xl sm:text-2xl font-black text-amber-600 font-mono">{occupancyCounts.reserved}</span>
          </div>

          <div className="bg-rose-50/80 border border-rose-200/90 rounded-xl sm:rounded-2xl p-2.5 sm:p-3 text-center transition-all hover:bg-rose-50">
            <span className="text-[9px] sm:text-[10px] font-extrabold uppercase tracking-wider text-rose-700 block">Occupied</span>
            <span className="text-xl sm:text-2xl font-black text-rose-600 font-mono">{occupancyCounts.occupied}</span>
          </div>

          <div className="bg-teal-50/80 border border-teal-200/90 rounded-xl sm:rounded-2xl p-2.5 sm:p-3 text-center transition-all hover:bg-teal-50">
            <span className="text-[9px] sm:text-[10px] font-extrabold uppercase tracking-wider text-teal-700 block">Held / Offer</span>
            <span className="text-xl sm:text-2xl font-black text-teal-600 font-mono">{occupancyCounts.held}</span>
          </div>

          <div className="bg-slate-100/80 border border-slate-300/90 rounded-xl sm:rounded-2xl p-2.5 sm:p-3 text-center transition-all hover:bg-slate-100 col-span-2 md:col-span-1">
            <span className="text-[9px] sm:text-[10px] font-extrabold uppercase tracking-wider text-slate-600 block">Maintenance</span>
            <span className="text-xl sm:text-2xl font-black text-slate-500 font-mono">{occupancyCounts.maintenance}</span>
          </div>
        </div>

        {/* 3. SEAT-STATUS LEGEND */}
        <div className="bg-slate-50/90 border border-slate-200/80 rounded-xl sm:rounded-2xl p-3 sm:p-4 space-y-2">
          <span className="text-[10px] sm:text-[11px] font-extrabold uppercase tracking-wider text-slate-400 block">Seat Status Legend</span>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] sm:text-xs font-semibold text-slate-700">
            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded-md bg-emerald-500 border border-emerald-600 shadow-xs flex items-center justify-center text-[9px] text-white font-bold">✓</span>
              <span>Available</span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded-md bg-brandBlue border border-blue-700 shadow-xs flex items-center justify-center text-[9px] text-white font-bold">★</span>
              <span>Selected</span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded-md bg-amber-500 border border-amber-600 shadow-xs flex items-center justify-center text-[9px] text-white font-bold">⏰</span>
              <span>Reserved</span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded-md bg-rose-500 border border-rose-600 shadow-xs flex items-center justify-center text-[9px] text-white font-bold">🔒</span>
              <span>Occupied</span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded-md bg-teal-500 border border-teal-600 shadow-xs flex items-center justify-center text-[9px] text-white font-bold">⏳</span>
              <span>Held / Offer</span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded-md bg-slate-400 border border-slate-500 shadow-xs flex items-center justify-center text-[9px] text-white font-bold">🔧</span>
              <span>Maintenance</span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded-md bg-blue-100 border-2 border-brandBlue text-brandBlue shadow-xs flex items-center justify-center text-[9px] font-black">👤</span>
              <span className="text-brandBlue font-bold">Booked by You</span>
            </div>
          </div>
        </div>

        {/* 4. FILTERS & CONTROLS */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 bg-white p-2.5 sm:p-3 rounded-xl sm:rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-slate-500 font-bold flex items-center gap-1 mr-1">
              <Filter size={13} className="text-brandBlue" /> Filters:
            </span>

            <button
              type="button"
              onClick={() => setFilterAvailableOnly(!filterAvailableOnly)}
              className={`px-2.5 py-1.5 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-bold transition-all border ${
                filterAvailableOnly
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                  : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
              }`}
            >
              Available Only
            </button>

            <button
              type="button"
              onClick={() => setFilterPowerSocket(!filterPowerSocket)}
              className={`px-2.5 py-1.5 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-bold transition-all border flex items-center gap-1 ${
                filterPowerSocket
                  ? 'bg-amber-500 text-white border-amber-500 shadow-xs'
                  : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
              }`}
            >
              <Zap size={11} /> Power Socket
            </button>

            <button
              type="button"
              onClick={() => setFilterNearWindow(!filterNearWindow)}
              className={`px-2.5 py-1.5 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-bold transition-all border flex items-center gap-1 ${
                filterNearWindow
                  ? 'bg-sky-600 text-white border-sky-600 shadow-xs'
                  : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
              }`}
            >
              <Sun size={11} /> Window View
            </button>
          </div>

          {(filterZone !== 'ALL' || filterAvailableOnly || filterPowerSocket || filterNearWindow) && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={clearAllFilters}
              className="h-7 px-2 text-[11px] font-bold text-red-600 border-red-200 hover:bg-red-50 rounded-lg"
            >
              Clear
            </Button>
          )}
        </div>

        {/* CANCELLED SLOT ALERT */}
        {isSlotCancelled && (
          <div className="bg-red-50 border border-red-200 rounded-xl sm:rounded-2xl p-3.5 text-center space-y-1.5 animate-in fade-in">
            <div className="flex items-center justify-center gap-2 text-red-700 font-black text-xs sm:text-sm">
              <AlertCircle size={18} /> Slot Cancelled by Library Admin
            </div>
            <p className="text-[11px] sm:text-xs text-slate-600 font-medium">
              This time slot is disabled. All seats are locked for reservation and waiting list queueing.
            </p>
          </div>
        )}

        {/* 5. INTERACTIVE PHYSICAL SEAT MAP */}
        {loadingSeats ? (
          <div className="py-12 text-center space-y-3">
            <div className="w-8 h-8 border-3 border-brandBlue border-t-transparent rounded-full animate-spin mx-auto"></div>
            <p className="text-xs font-bold text-slate-400">Loading interactive 40-seat hall layout...</p>
          </div>
        ) : filteredSeats.length === 0 ? (
          <div className="py-10 border-2 border-dashed border-slate-200 rounded-2xl text-center space-y-2">
            <p className="text-xs sm:text-sm font-bold text-navy">No seats match the selected filter criteria.</p>
            <Button type="button" onClick={clearAllFilters} variant="outline" className="text-xs font-bold rounded-xl h-8 px-3">
              Reset Filters
            </Button>
          </div>
        ) : (
          <div className="bg-slate-100/60 border border-slate-200/90 rounded-2xl sm:rounded-3xl p-3 sm:p-6 space-y-5">
            
            {/* Top Physical Wall Markers */}
            <div className="flex items-center justify-between text-[10px] sm:text-[11px] font-extrabold text-slate-400 uppercase tracking-wider px-1">
              <span className="flex items-center gap-1"><Sun size={12} className="text-amber-500 shrink-0" /> Window Wall</span>
              <span className="bg-slate-200 text-slate-600 px-2.5 py-0.5 rounded-full text-[9px] sm:text-[10px]">Front Board</span>
              <span className="flex items-center gap-1"><Zap size={12} className="text-blue-500 shrink-0" /> Power Hub</span>
            </div>

            {/* A. MOBILE PURPOSE-BUILT SEAT MAP (< 768px / md) */}
            <div className="md:hidden space-y-4">
              {seatRows.map((row) => (
                <div key={row.rowNumber} className="bg-white border border-slate-200/90 rounded-2xl p-3 shadow-xs space-y-2.5">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                    <span className="text-xs font-black text-navy uppercase tracking-wider">ROW {row.rowNumber}</span>
                    <span className="text-[10px] font-bold text-slate-400 font-mono">10 Seats</span>
                  </div>

                  {/* Left Bank (5 Seats) */}
                  <div className="space-y-1">
                    <span className="text-[9px] font-extrabold text-slate-400 uppercase block tracking-wider">Window-Side Seats</span>
                    <div className="grid grid-cols-5 gap-1.5">
                      {row.bank1.map((seat) => {
                        const isSelected = selectedSeat?.id === seat.id;
                        const isAvailable = !isSlotCancelled && (seat.status_state === 'available' || seat.ui_status === 'Available');
                        const isUserBooked = seat.isUserBooked || seat.status_state === 'user_booked';
                        const isOccupied = seat.status_state === 'occupied' || seat.ui_status === 'Occupied';
                        const isReserved = seat.status_state === 'reserved' || seat.ui_status === 'Reserved';
                        const isHeld = seat.status_state === 'held' || seat.ui_status === 'Held';
                        const isMaintenance = seat.status_state === 'maintenance' || seat.ui_status === 'Maintenance';

                        return (
                          <button
                            key={seat.id}
                            type="button"
                            disabled={!isAvailable}
                            aria-disabled={!isAvailable}
                            aria-pressed={isSelected}
                            aria-label={`Seat ${seat.seatNumber}, ${seat.ui_status}`}
                            onClick={() => handleSeatClick(seat)}
                            className={`
                              relative h-11 rounded-xl flex flex-col items-center justify-center p-1 border-2 text-[11px] font-black
                              transition-all duration-150 shadow-xs focus:outline-none focus:ring-2 focus:ring-brandBlue
                              ${isSlotCancelled
                                ? 'bg-slate-200 text-slate-400 border-slate-300 cursor-not-allowed'
                                : isSelected
                                ? 'bg-brandBlue text-white border-blue-700 ring-2 ring-blue-400 shadow-md scale-105 z-10'
                                : isUserBooked
                                ? 'bg-blue-50 text-brandBlue border-brandBlue ring-2 ring-blue-300 font-extrabold'
                                : isOccupied
                                ? 'bg-rose-500 text-white border-rose-600 cursor-not-allowed opacity-90'
                                : isReserved
                                ? 'bg-amber-500 text-white border-amber-600 cursor-not-allowed opacity-90'
                                : isHeld
                                ? 'bg-teal-500 text-white border-teal-600 cursor-not-allowed opacity-90'
                                : isMaintenance
                                ? 'bg-slate-400 text-white border-slate-500 cursor-not-allowed opacity-80'
                                : 'bg-emerald-500 text-white border-emerald-600 hover:bg-emerald-600 active:scale-95 cursor-pointer'
                              }
                            `}
                          >
                            <span className="flex items-center gap-0.5 leading-none">
                              {isSelected && <Check size={11} className="stroke-[3]" />}
                              {isUserBooked && !isSelected && <User size={10} />}
                              {seat.seatNumber}
                            </span>
                            {seat.powerOutlet && (
                              <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-amber-300 border border-amber-500" title="Power Socket" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Central Aisle Divider */}
                  <div className="flex items-center gap-2 py-1">
                    <div className="h-px bg-slate-200 flex-1" />
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest font-mono">Central Aisle</span>
                    <div className="h-px bg-slate-200 flex-1" />
                  </div>

                  {/* Right Bank (5 Seats) */}
                  <div className="space-y-1">
                    <span className="text-[9px] font-extrabold text-slate-400 uppercase block tracking-wider">Power-Side Seats</span>
                    <div className="grid grid-cols-5 gap-1.5">
                      {row.bank2.map((seat) => {
                        const isSelected = selectedSeat?.id === seat.id;
                        const isAvailable = !isSlotCancelled && (seat.status_state === 'available' || seat.ui_status === 'Available');
                        const isUserBooked = seat.isUserBooked || seat.status_state === 'user_booked';
                        const isOccupied = seat.status_state === 'occupied' || seat.ui_status === 'Occupied';
                        const isReserved = seat.status_state === 'reserved' || seat.ui_status === 'Reserved';
                        const isHeld = seat.status_state === 'held' || seat.ui_status === 'Held';
                        const isMaintenance = seat.status_state === 'maintenance' || seat.ui_status === 'Maintenance';

                        return (
                          <button
                            key={seat.id}
                            type="button"
                            disabled={!isAvailable}
                            aria-disabled={!isAvailable}
                            aria-pressed={isSelected}
                            aria-label={`Seat ${seat.seatNumber}, ${seat.ui_status}`}
                            onClick={() => handleSeatClick(seat)}
                            className={`
                              relative h-11 rounded-xl flex flex-col items-center justify-center p-1 border-2 text-[11px] font-black
                              transition-all duration-150 shadow-xs focus:outline-none focus:ring-2 focus:ring-brandBlue
                              ${isSlotCancelled
                                ? 'bg-slate-200 text-slate-400 border-slate-300 cursor-not-allowed'
                                : isSelected
                                ? 'bg-brandBlue text-white border-blue-700 ring-2 ring-blue-400 shadow-md scale-105 z-10'
                                : isUserBooked
                                ? 'bg-blue-50 text-brandBlue border-brandBlue ring-2 ring-blue-300 font-extrabold'
                                : isOccupied
                                ? 'bg-rose-500 text-white border-rose-600 cursor-not-allowed opacity-90'
                                : isReserved
                                ? 'bg-amber-500 text-white border-amber-600 cursor-not-allowed opacity-90'
                                : isHeld
                                ? 'bg-teal-500 text-white border-teal-600 cursor-not-allowed opacity-90'
                                : isMaintenance
                                ? 'bg-slate-400 text-white border-slate-500 cursor-not-allowed opacity-80'
                                : 'bg-emerald-500 text-white border-emerald-600 hover:bg-emerald-600 active:scale-95 cursor-pointer'
                              }
                            `}
                          >
                            <span className="flex items-center gap-0.5 leading-none">
                              {isSelected && <Check size={11} className="stroke-[3]" />}
                              {isUserBooked && !isSelected && <User size={10} />}
                              {seat.seatNumber}
                            </span>
                            {seat.powerOutlet && (
                              <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-amber-300 border border-amber-500" title="Power Socket" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* B. DESKTOP PHYSICAL SEAT MAP GRID (>= 768px / md) */}
            <div className="hidden md:block space-y-4 max-w-5xl mx-auto">
              {seatRows.map((row) => (
                <div key={row.rowNumber} className="flex flex-row items-center gap-3">
                  <div className="w-16 text-[11px] font-black text-slate-400 uppercase tracking-wider text-right pr-2 shrink-0">
                    Row {row.rowNumber}
                  </div>

                  <div className="flex-1 w-full grid grid-cols-11 gap-2.5 items-center">
                    
                    {/* Bank 1 (Left Bank - 5 Seats) */}
                    <div className="col-span-5 grid grid-cols-5 gap-2">
                      {row.bank1.map((seat) => {
                        const isSelected = selectedSeat?.id === seat.id;
                        const isAvailable = !isSlotCancelled && (seat.status_state === 'available' || seat.ui_status === 'Available');
                        const isUserBooked = seat.isUserBooked || seat.status_state === 'user_booked';
                        const isOccupied = seat.status_state === 'occupied' || seat.ui_status === 'Occupied';
                        const isReserved = seat.status_state === 'reserved' || seat.ui_status === 'Reserved';
                        const isHeld = seat.status_state === 'held' || seat.ui_status === 'Held';
                        const isMaintenance = seat.status_state === 'maintenance' || seat.ui_status === 'Maintenance';

                        return (
                          <button
                            key={seat.id}
                            type="button"
                            disabled={!isAvailable}
                            aria-disabled={!isAvailable}
                            aria-pressed={isSelected}
                            aria-label={`Seat ${seat.seatNumber}, ${seat.ui_status}`}
                            onClick={() => handleSeatClick(seat)}
                            title={`Seat ${seat.seatNumber} (${seat.ui_status})${seat.powerOutlet ? ' • Power Outlet' : ''}`}
                            className={`
                              relative h-14 rounded-2xl flex flex-col items-center justify-center p-1.5 border-2 text-xs font-black
                              transition-all duration-200 shadow-xs focus:outline-none focus:ring-2 focus:ring-brandBlue focus:ring-offset-2
                              ${isSlotCancelled
                                ? 'bg-slate-200 text-slate-400 border-slate-300 cursor-not-allowed'
                                : isSelected
                                ? 'bg-brandBlue text-white border-blue-700 ring-4 ring-blue-500/30 scale-105 shadow-md z-10'
                                : isUserBooked
                                ? 'bg-blue-50 text-brandBlue border-brandBlue ring-2 ring-blue-300 font-extrabold'
                                : isOccupied
                                ? 'bg-rose-500 text-white border-rose-600 cursor-not-allowed opacity-90'
                                : isReserved
                                ? 'bg-amber-500 text-white border-amber-600 cursor-not-allowed opacity-90'
                                : isHeld
                                ? 'bg-teal-500 text-white border-teal-600 cursor-not-allowed opacity-90'
                                : isMaintenance
                                ? 'bg-slate-400 text-white border-slate-500 cursor-not-allowed opacity-80'
                                : 'bg-emerald-500 text-white border-emerald-600 hover:bg-emerald-600 hover:-translate-y-1 hover:shadow-md cursor-pointer'
                              }
                            `}
                          >
                            <span className="text-[10px] tracking-tight flex items-center gap-0.5">
                              {isSelected && <Check size={12} className="stroke-[3]" />}
                              {isUserBooked && !isSelected && <User size={11} />}
                              {seat.seatNumber}
                            </span>

                            <span className="text-[8px] font-normal opacity-90 block mt-0.5">
                              {isSelected ? 'Selected' : seat.ui_status}
                            </span>

                            {seat.powerOutlet && (
                              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-300 border border-amber-500" title="Power Socket" />
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {/* Central Physical Hall Aisle */}
                    <div className="col-span-1 h-full flex flex-col items-center justify-center bg-slate-200/80 rounded-xl py-1 text-[9px] font-black text-slate-500 font-mono uppercase tracking-widest text-center border border-slate-300/80">
                      <span>A</span>
                      <span>I</span>
                      <span>S</span>
                      <span>L</span>
                      <span>E</span>
                    </div>

                    {/* Bank 2 (Right Bank - 5 Seats) */}
                    <div className="col-span-5 grid grid-cols-5 gap-2">
                      {row.bank2.map((seat) => {
                        const isSelected = selectedSeat?.id === seat.id;
                        const isAvailable = !isSlotCancelled && (seat.status_state === 'available' || seat.ui_status === 'Available');
                        const isUserBooked = seat.isUserBooked || seat.status_state === 'user_booked';
                        const isOccupied = seat.status_state === 'occupied' || seat.ui_status === 'Occupied';
                        const isReserved = seat.status_state === 'reserved' || seat.ui_status === 'Reserved';
                        const isHeld = seat.status_state === 'held' || seat.ui_status === 'Held';
                        const isMaintenance = seat.status_state === 'maintenance' || seat.ui_status === 'Maintenance';

                        return (
                          <button
                            key={seat.id}
                            type="button"
                            disabled={!isAvailable}
                            aria-disabled={!isAvailable}
                            aria-pressed={isSelected}
                            aria-label={`Seat ${seat.seatNumber}, ${seat.ui_status}`}
                            onClick={() => handleSeatClick(seat)}
                            title={`Seat ${seat.seatNumber} (${seat.ui_status})${seat.powerOutlet ? ' • Power Outlet' : ''}`}
                            className={`
                              relative h-14 rounded-2xl flex flex-col items-center justify-center p-1.5 border-2 text-xs font-black
                              transition-all duration-200 shadow-xs focus:outline-none focus:ring-2 focus:ring-brandBlue focus:ring-offset-2
                              ${isSlotCancelled
                                ? 'bg-slate-200 text-slate-400 border-slate-300 cursor-not-allowed'
                                : isSelected
                                ? 'bg-brandBlue text-white border-blue-700 ring-4 ring-blue-500/30 scale-105 shadow-md z-10'
                                : isUserBooked
                                ? 'bg-blue-50 text-brandBlue border-brandBlue ring-2 ring-blue-300 font-extrabold'
                                : isOccupied
                                ? 'bg-rose-500 text-white border-rose-600 cursor-not-allowed opacity-90'
                                : isReserved
                                ? 'bg-amber-500 text-white border-amber-600 cursor-not-allowed opacity-90'
                                : isHeld
                                ? 'bg-teal-500 text-white border-teal-600 cursor-not-allowed opacity-90'
                                : isMaintenance
                                ? 'bg-slate-400 text-white border-slate-500 cursor-not-allowed opacity-80'
                                : 'bg-emerald-500 text-white border-emerald-600 hover:bg-emerald-600 hover:-translate-y-1 hover:shadow-md cursor-pointer'
                              }
                            `}
                          >
                            <span className="text-[10px] tracking-tight flex items-center gap-0.5">
                              {isSelected && <Check size={12} className="stroke-[3]" />}
                              {isUserBooked && !isSelected && <User size={11} />}
                              {seat.seatNumber}
                            </span>

                            <span className="text-[8px] font-normal opacity-90 block mt-0.5">
                              {isSelected ? 'Selected' : seat.ui_status}
                            </span>

                            {seat.powerOutlet && (
                              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-300 border border-amber-500" title="Power Socket" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Bottom Entrance Label */}
            <div className="flex items-center justify-between text-[10px] sm:text-[11px] font-extrabold text-slate-400 uppercase tracking-widest pt-2 border-t border-slate-200 px-1">
              <span>Main Entry Door</span>
              <span>Lockers & Water</span>
            </div>
          </div>
        )}

        {/* 6. STICKY SELECTED SEAT ACTION PANEL */}
        {selectedSeat && !isSlotCancelled && (
          <div className="fixed bottom-[64px] left-3 right-3 z-30 md:static md:bottom-auto md:left-auto md:right-auto md:z-auto bg-gradient-to-r from-blue-900 to-navy text-white rounded-2xl md:rounded-3xl p-4 md:p-6 shadow-2xl space-y-3.5 animate-in slide-in-from-bottom duration-200 border border-blue-400/30">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Badge className="bg-blue-500/30 text-blue-200 border-blue-400/40 text-[10px] font-mono font-extrabold px-2 py-0.5">
                    SELECTED SEAT
                  </Badge>
                  <span className="text-xl sm:text-2xl font-black tracking-tight text-white">{selectedSeat.seatNumber}</span>
                </div>
                <p className="text-[11px] sm:text-xs text-blue-200 font-medium">
                  Main Quiet Reading Hall • Floor 1 • {selectedSeat.type || 'Quiet Study'}
                </p>
              </div>

              <div className="flex items-center gap-2 justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onSelectSeat(null)}
                  className="bg-white/10 hover:bg-white/20 text-white font-bold h-10 px-3 rounded-xl border-white/20 text-xs shrink-0"
                >
                  Clear
                </Button>
                
                <Button
                  type="button"
                  disabled={bookingLoading}
                  onClick={() => onConfirmBooking(selectedSeat)}
                  className="bg-brandBlue hover:bg-blue-600 text-white font-black h-10 px-5 rounded-xl shadow-lg text-xs flex items-center gap-1.5 shrink-0"
                >
                  {bookingLoading ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Reserving {selectedSeat.seatNumber}...
                    </>
                  ) : (
                    <>
                      Confirm & Reserve {selectedSeat.seatNumber} <ChevronRight size={15} />
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-white/10 rounded-xl p-2.5 backdrop-blur-xs text-[11px]">
              <div>
                <span className="text-blue-300 text-[9px] font-bold uppercase block">Date</span>
                <span className="font-bold text-white">{dateStr}</span>
              </div>

              <div>
                <span className="text-blue-300 text-[9px] font-bold uppercase block">Time Window</span>
                <span className="font-bold text-white font-mono">
                  {slot ? `${format12HourTime(slot.startTime)} – ${format12HourTime(slot.endTime)}` : 'Slot'}
                </span>
              </div>

              <div>
                <span className="text-blue-300 text-[9px] font-bold uppercase block">Facilities</span>
                <span className="font-bold text-white flex items-center gap-1">
                  {selectedSeat.powerOutlet ? '⚡ Power' : 'Standard'}
                </span>
              </div>

              <div>
                <span className="text-blue-300 text-[9px] font-bold uppercase block">Policy</span>
                <span className="font-bold text-amber-300">15-Min Check-in</span>
              </div>
            </div>
          </div>
        )}

      </CardContent>
    </Card>
  );
}
