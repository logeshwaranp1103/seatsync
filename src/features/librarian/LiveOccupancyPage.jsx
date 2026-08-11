import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { 
  getLiveOccupancy, 
  getFloorOccupancy, 
  getCurrentOccupants, 
  getLiveSeatStatuses,
  getSlotOccurrenceOccupancy,
  getReservedStudentsForOccurrence,
  getTodayKolkataDate, 
  getCurrentOrNextKolkataSlot 
} from '../../services/occupancyService';
import { librarianService } from '../../services/librarianService';
import { useOccupancyRealtime } from '../../hooks/useOccupancyRealtime';
import { Card, CardContent } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/shared/Dialog';
import {
  Eye, Armchair, RefreshCw, Layers, Calendar, Clock, MapPin, AlertCircle, CheckCircle2, 
  User, LogOut, LogIn, Wrench, ShieldAlert, Lock, Activity, Filter, RotateCcw, 
  ChevronDown, ChevronUp, Building2, Users, AlertTriangle, ArrowRight
} from 'lucide-react';
import toast from 'react-hot-toast';
import { formatSlotTime, formatSlotRange, getSlotPeriod, formatSlotTitle, sortSlotsChronologically } from '../../utils/timeUtils.js';

const format12HourTime = formatSlotTime;


export default function LiveOccupancyPage() {
  // Filter states
  const [libraries, setLibraries] = useState([]);
  const [floors, setFloors] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [slots, setSlots] = useState([]);

  const [selectedLibraryId, setSelectedLibraryId] = useState('');
  const [selectedFloorId, setSelectedFloorId] = useState('');
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [selectedDate, setSelectedDate] = useState(getTodayKolkataDate());
  const [selectedSlotId, setSelectedSlotId] = useState('');

  // Data states
  const [snapshotMetrics, setSnapshotMetrics] = useState(null);
  const [occupantsList, setOccupantsList] = useState([]);
  const [seatMap, setSeatMap] = useState([]);

  const [loading, setLoading] = useState(true);
  const [filterLoading, setFilterLoading] = useState(false);
  const [queryError, setQueryError] = useState(null);
  const [selectedSeat, setSelectedSeat] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  // Reserved Students Modal state
  const [reservedStudentsModalOpen, setReservedStudentsModalOpen] = useState(false);
  const [reservedStudentsList, setReservedStudentsList] = useState([]);
  const [loadingReservedStudents, setLoadingReservedStudents] = useState(false);
  const [selectedOccurrenceTitle, setSelectedOccurrenceTitle] = useState('');

  const handleViewReservedStudents = async (sl, e) => {
    if (e) e.stopPropagation();
    setSelectedOccurrenceTitle(`${sl.slot_name || 'Slot'} (${format12HourTime(sl.start_time)} - ${format12HourTime(sl.end_time)})`);
    setReservedStudentsModalOpen(true);
    setLoadingReservedStudents(true);
    try {
      const list = await getReservedStudentsForOccurrence(sl.slot_occurrence_id);
      setReservedStudentsList(list);
    } catch (err) {
      toast.error(err.message || 'Failed to load reserved students.');
    } finally {
      setLoadingReservedStudents(false);
    }
  };

  // Activity feed state
  const [activityLog, setActivityLog] = useState([]);

  // 1. Initial filter options from Supabase tables
  useEffect(() => {
    async function initFilters() {
      try {
        const [
          { data: libData },
          { data: floorData },
          { data: roomData },
          { data: slotData }
        ] = await Promise.all([
          supabase.from('libraries').select('id, name').order('name'),
          supabase.from('floors').select('id, name, library_id').order('floor_number'),
          supabase.from('rooms').select('id, name, library_id, floor_id').order('name'),
          supabase.from('slots').select('id, name, start_time, end_time, status').order('start_time')
        ]);

        if (libData && libData.length > 0) {
          setLibraries(libData);
          setSelectedLibraryId(libData[0].id);
        }

        if (floorData) setFloors(floorData);
        if (roomData) {
          setRooms(roomData);
          if (roomData.length > 0) setSelectedRoomId(roomData[0].id);
        }

        if (slotData && slotData.length > 0) {
          const uniqueSlots = slotData.filter((s, idx, self) =>
            idx === self.findIndex(t => t.name === s.name && t.start_time === s.start_time)
          );
          setSlots(uniqueSlots);
          const activeOrNext = getCurrentOrNextKolkataSlot(uniqueSlots);
          if (activeOrNext) setSelectedSlotId(activeOrNext.id);
        }
      } catch (err) {
        setQueryError(`Failed to load filter metadata: ${err.message}`);
      }
    }

    initFilters();
  }, []);

  // Filtered rooms based on selected library and floor
  const filteredRooms = useMemo(() => {
    return rooms.filter(r => {
      const matchLib = !selectedLibraryId || r.library_id === selectedLibraryId;
      const matchFloor = !selectedFloorId || r.floor_id === selectedFloorId;
      return matchLib && matchFloor;
    });
  }, [rooms, selectedLibraryId, selectedFloorId]);

  // Update room selection if current choice is filtered out
  useEffect(() => {
    if (filteredRooms.length > 0 && !filteredRooms.some(r => r.id === selectedRoomId)) {
      setSelectedRoomId(filteredRooms[0].id);
    }
  }, [filteredRooms, selectedRoomId]);

  // 2. Main data loader function powered by Supabase RPCs
  const loadOccupancyData = useCallback(async (isSilent = false) => {
    if (!isSilent) {
      setLoading(true);
    }
    setQueryError(null);

    try {
      const [snapshot, occupants, seats] = await Promise.all([
        getLiveOccupancy({
          libraryId: selectedLibraryId,
          floorId: selectedFloorId,
          roomId: selectedRoomId,
          slotId: selectedSlotId,
          bookingDate: selectedDate
        }),
        getCurrentOccupants({
          libraryId: selectedLibraryId,
          floorId: selectedFloorId,
          roomId: selectedRoomId,
          slotId: selectedSlotId,
          bookingDate: selectedDate
        }),
        getLiveSeatStatuses({
          libraryId: selectedLibraryId,
          floorId: selectedFloorId,
          roomId: selectedRoomId,
          slotId: selectedSlotId,
          bookingDate: selectedDate
        })
      ]);

      setSnapshotMetrics(snapshot);
      setOccupantsList(occupants || []);
      setSeatMap(seats || []);
      setLastUpdated(new Date());

      // Append to local activity feed
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setActivityLog(prev => [
        { id: `act-${Date.now()}`, timeStr, action: 'Occupancy Snapshot Synchronized', status: 'live' },
        ...prev.slice(0, 7)
      ]);
    } catch (err) {
      console.error('[LiveOccupancyPage] Query failure:', err);
      setQueryError(err.message || 'Failed to fetch live occupancy data from database.');
    } finally {
      setLoading(false);
      setFilterLoading(false);
    }
  }, [selectedLibraryId, selectedFloorId, selectedRoomId, selectedSlotId, selectedDate]);

  // Trigger refetch when filters change
  useEffect(() => {
    if (selectedDate) {
      setFilterLoading(true);
      loadOccupancyData();
    }
  }, [loadOccupancyData]);

  // 3. Supabase Realtime Subscription hook
  const { connectionStatus, triggerRefetch } = useOccupancyRealtime({
    libraryId: selectedLibraryId,
    onRefetch: () => loadOccupancyData(true)
  });

  // Action handlers
  const handleCheckInSeat = async (bookingId) => {
    try {
      await librarianService.processCheckIn(bookingId, null, 'Desk Checked In by Librarian');
      toast.success(`Check-in processed successfully! Seat state updated.`);
      setSelectedSeat(null);
      await loadOccupancyData();
    } catch (err) {
      toast.error(err.message || 'Failed to process check-in.');
    }
  };

  const handleCheckOutSeat = async (bookingId) => {
    try {
      await librarianService.processCheckOut(bookingId, null);
      toast.success(`Check-out processed successfully! Desk released.`);
      setSelectedSeat(null);
      await loadOccupancyData();
    } catch (err) {
      toast.error(err.message || 'Failed to process check-out.');
    }
  };

  const handleResolveMaintenance = async (seatNumberOrId) => {
    try {
      await librarianService.resolveSeatMaintenance(seatNumberOrId);
      toast.success(`Seat ${seatNumberOrId} activated! Maintenance record resolved.`);
      setSelectedSeat(null);
      await loadOccupancyData();
    } catch {
      toast.error('Failed to activate seat.');
    }
  };

  const handleReportMaintenance = async (seatNumberOrId) => {
    try {
      await librarianService.reportSeatMaintenance({
        seatNumber: seatNumberOrId,
        category: 'Desk Maintenance',
        description: 'Flagged for maintenance by librarian'
      });
      toast.success(`Seat ${seatNumberOrId} set under maintenance.`);
      setSelectedSeat(null);
      await loadOccupancyData();
    } catch {
      toast.error('Failed to set maintenance status.');
    }
  };

  const handleResetToday = () => {
    setSelectedDate(getTodayKolkataDate());
    if (slots.length > 0) {
      const activeOrNext = getCurrentOrNextKolkataSlot(slots);
      if (activeOrNext) setSelectedSlotId(activeOrNext.id);
    }
    toast.success('Reset to current date & active slot in Asia/Kolkata.');
  };

  // Seat visual configuration based on required colors:
  // Occupied: red #EF4444 | Reserved: orange #F59E0B | Available: green #22C55E | Maintenance/Inactive: grey #94A3B8
  const getSeatVisualConfig = (seat) => {
    const status = seat.status || 'available';
    switch (status) {
      case 'occupied':
        return {
          bg: 'bg-[#EF4444] text-white border-red-600 shadow-red-500/20',
          badgeBg: 'bg-red-700 text-white',
          label: 'Occupied',
          icon: <User size={15} className="stroke-[2.5]" />
        };
      case 'reserved':
        return {
          bg: 'bg-[#F59E0B] text-white border-amber-600 shadow-amber-500/20',
          badgeBg: 'bg-amber-700 text-white',
          label: 'Reserved',
          icon: <Calendar size={15} className="stroke-[2.5]" />
        };
      case 'maintenance':
        return {
          bg: 'bg-[#94A3B8] text-white border-slate-500 shadow-slate-400/20',
          badgeBg: 'bg-slate-600 text-white',
          label: 'Maintenance',
          icon: <Wrench size={15} className="stroke-[2.5]" />
        };
      case 'inactive':
        return {
          bg: 'bg-slate-300 text-slate-700 border-slate-400',
          badgeBg: 'bg-slate-500 text-white',
          label: 'Inactive',
          icon: <Lock size={15} className="stroke-[2.5]" />
        };
      default: // available
        return {
          bg: 'bg-[#22C55E] text-white border-emerald-600 shadow-emerald-500/20 hover:brightness-105',
          badgeBg: 'bg-emerald-700 text-white',
          label: 'Available',
          icon: <Armchair size={15} className="stroke-[2.5]" />
        };
    }
  };

  // Computed metrics for Gauge
  const operationalSeats = snapshotMetrics?.operational_seats ?? 0;
  const occupiedSeats = snapshotMetrics?.occupied_seats ?? 0;
  const reservedSeats = snapshotMetrics?.reserved_seats ?? 0;
  const availableSeats = snapshotMetrics?.available_seats ?? 0;
  const maintenanceSeats = snapshotMetrics?.maintenance_seats ?? 0;
  const utilizationPercent = snapshotMetrics?.occupancy_percentage ?? 0;

  const currentSlotObj = slots.find(s => s.id === selectedSlotId);
  const currentRoomObj = rooms.find(r => r.id === selectedRoomId);

  // Group seats for physical matrix (2 banks of 5 desks per row)
  const rows = useMemo(() => {
    const seatList = seatMap || [];
    const grouped = [];
    for (let i = 0; i < seatList.length; i += 10) {
      const rowSeats = seatList.slice(i, i + 10);
      grouped.push({
        bank1: rowSeats.slice(0, 5),
        bank2: rowSeats.slice(5, 10)
      });
    }
    return grouped;
  }, [seatMap]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300 pb-12">

      {/* 1. HEADER & REALTIME STATUS INDICATOR */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
              <Eye className="text-teal-600" size={30} /> Live Library Occupancy
            </h1>
            <Badge className="bg-navy text-white text-[11px] font-mono font-extrabold px-3 py-1 rounded-xl shadow-xs">
              Supabase Real-Time Engine
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Real-time occupancy tracking based on active checked-in bookings and maintenance records.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Connection Status Indicator */}
          <div className="flex items-center gap-2 bg-white border border-slate-200/90 rounded-2xl px-3.5 py-1.5 shadow-xs">
            {connectionStatus === 'live' && (
              <>
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                </span>
                <span className="text-xs font-mono font-bold text-emerald-700">Realtime Connected</span>
              </>
            )}
            {connectionStatus === 'reconnecting' && (
              <>
                <span className="h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse" />
                <span className="text-xs font-mono font-bold text-amber-700">Reconnecting...</span>
              </>
            )}
            {connectionStatus === 'offline' && (
              <>
                <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                <span className="text-xs font-mono font-bold text-rose-700">Disconnected</span>
              </>
            )}
            {connectionStatus === 'updating' && (
              <>
                <RefreshCw size={14} className="animate-spin text-brandBlue" />
                <span className="text-xs font-mono font-bold text-brandBlue">Refetching...</span>
              </>
            )}
          </div>

          <div className="text-right hidden sm:block text-[11px] text-slate-400 font-mono">
            <div>Updated {lastUpdated.toLocaleTimeString()}</div>
            <div className="text-[10px] text-slate-500 font-bold">{selectedDate}</div>
          </div>

          <Button
            onClick={() => loadOccupancyData()}
            className="bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold h-9 px-3.5 rounded-2xl border border-slate-300 shadow-xs flex items-center gap-1.5"
          >
            <RefreshCw size={14} className="text-teal-600" /> Refresh Data
          </Button>
        </div>
      </div>

      {/* 2. FILTER CONTROLS */}
      <Card className="border border-slate-200 bg-white rounded-3xl p-5 shadow-xs space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Library Filter */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block flex items-center gap-1">
              <Building2 size={12} className="text-brandBlue" /> Library
            </label>
            <select
              value={selectedLibraryId}
              disabled={filterLoading}
              onChange={(e) => setSelectedLibraryId(e.target.value)}
              className="w-full h-10 bg-slate-50 border border-slate-300 text-navy font-bold text-xs rounded-2xl px-3.5 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600 cursor-pointer disabled:opacity-50"
            >
              <option value="">All Libraries</option>
              {libraries.map(lib => (
                <option key={lib.id} value={lib.id}>{lib.name}</option>
              ))}
            </select>
          </div>

          {/* Floor Filter */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block flex items-center gap-1">
              <Layers size={12} className="text-brandBlue" /> Floor
            </label>
            <select
              value={selectedFloorId}
              disabled={filterLoading}
              onChange={(e) => setSelectedFloorId(e.target.value)}
              className="w-full h-10 bg-slate-50 border border-slate-300 text-navy font-bold text-xs rounded-2xl px-3.5 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600 cursor-pointer disabled:opacity-50"
            >
              <option value="">All Floors</option>
              {floors
                .filter(f => !selectedLibraryId || f.library_id === selectedLibraryId)
                .map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
            </select>
          </div>

          {/* Room Filter */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block flex items-center gap-1">
              <MapPin size={12} className="text-brandBlue" /> Room
            </label>
            <select
              value={selectedRoomId}
              disabled={filterLoading}
              onChange={(e) => setSelectedRoomId(e.target.value)}
              className="w-full h-10 bg-slate-50 border border-slate-300 text-navy font-bold text-xs rounded-2xl px-3.5 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600 cursor-pointer disabled:opacity-50"
            >
              <option value="">All Rooms</option>
              {filteredRooms.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>

          {/* Date Selector */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block flex items-center gap-1">
              <Calendar size={12} className="text-brandBlue" /> Date (IST)
            </label>
            <input
              type="date"
              value={selectedDate}
              disabled={filterLoading}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full h-10 bg-slate-50 border border-slate-300 text-navy font-bold text-xs rounded-2xl px-3.5 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600 font-mono cursor-pointer disabled:opacity-50"
            />
          </div>

          {/* Slot Selector */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block flex items-center gap-1">
              <Clock size={12} className="text-brandBlue" /> Operational Slot
            </label>
            <select
              value={selectedSlotId}
              disabled={filterLoading}
              onChange={(e) => setSelectedSlotId(e.target.value)}
              className="w-full h-10 bg-slate-50 border border-slate-300 text-navy font-bold text-xs rounded-2xl px-3.5 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600 font-mono cursor-pointer disabled:opacity-50"
            >
              <option value="">Auto Detect Active Slot</option>
              {slots.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} ({format12HourTime(s.start_time)} – {format12HourTime(s.end_time)})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Action button row */}
        <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-slate-600 font-mono">
            <span className="font-bold text-navy">{snapshotMetrics?.slot_name || currentSlotObj?.name || 'Selected Slot'}</span>
            <span>•</span>
            <span className="text-teal-600 font-bold">{selectedDate}</span>
          </div>

          <Button
            type="button"
            onClick={handleResetToday}
            className="h-8 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl border border-slate-300 flex items-center gap-1 px-3"
          >
            <RotateCcw size={12} /> Today (Asia/Kolkata)
          </Button>
        </div>
      </Card>

      {/* 3. ACTIVE SLOT WARNING BANNER */}
      {snapshotMetrics?.slot_active === false && (
        <div className="p-4 bg-amber-50 border border-amber-300 rounded-2xl flex items-center gap-3 text-xs text-amber-900 font-semibold shadow-xs">
          <AlertTriangle size={20} className="text-amber-600 shrink-0" />
          <div>
            <p className="font-bold">No library slot is currently active.</p>
            <p className="text-[11px] text-amber-700 font-normal mt-0.5">
              The selected slot is outside operational hours, or has been disabled/cancelled for {selectedDate}.
            </p>
          </div>
        </div>
      )}

      {/* 4. ERROR ALERT STATE WITH RETRY BUTTON */}
      {queryError && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center justify-between text-xs text-rose-700 font-medium shadow-xs">
          <div className="flex items-center gap-2">
            <AlertCircle size={18} className="text-rose-600 shrink-0" />
            <span>Database Error: {queryError}</span>
          </div>
          <Button onClick={() => loadOccupancyData()} className="bg-rose-600 text-white font-bold text-xs h-8 px-3 rounded-xl">
            Retry Connection
          </Button>
        </div>
      )}

      {/* 5. SUMMARY METRICS & CIRCULAR UTILIZATION GAUGE */}
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-6 gap-4 animate-pulse">
          <div className="lg:col-span-2 h-36 bg-slate-200 rounded-3xl" />
          <div className="lg:col-span-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-36 bg-slate-200 rounded-3xl" />
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-6 gap-4">
          {/* Circular SVG Utilization Ring */}
          <Card className="lg:col-span-2 border border-slate-200/90 bg-white rounded-3xl p-5 shadow-xs flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">Live Occupancy</span>
              <div className="text-3xl font-black font-mono text-teal-700">
                {occupiedSeats} / {operationalSeats}
              </div>
              <p className="text-xs text-slate-500 font-medium">
                Operational Capacity ({utilizationPercent}% filled)
              </p>
              {maintenanceSeats > 0 && (
                <p className="text-[10px] text-rose-600 font-semibold italic">
                  *Excludes {maintenanceSeats} maintenance seat{maintenanceSeats > 1 ? 's' : ''}
                </p>
              )}
            </div>

            {/* Circular Gauge */}
            <div className="relative w-24 h-24 flex items-center justify-center shrink-0">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 80 80">
                <circle cx="40" cy="40" r="32" stroke="#E2E8F0" strokeWidth="7" fill="transparent" />
                <circle
                  cx="40"
                  cy="40"
                  r="32"
                  stroke={utilizationPercent >= 85 ? '#EF4444' : utilizationPercent >= 60 ? '#F59E0B' : '#22C55E'}
                  strokeWidth="7"
                  strokeDasharray={201.06}
                  strokeDashoffset={201.06 - (utilizationPercent / 100) * 201.06}
                  strokeLinecap="round"
                  fill="transparent"
                  className="transition-all duration-700 ease-out"
                />
              </svg>
              <div className="absolute text-center text-xs font-black font-mono text-navy">
                {utilizationPercent}%
              </div>
            </div>
          </Card>

          {/* 4 Metric Cards */}
          <div className="lg:col-span-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Total Seats */}
            <Card className="border border-slate-200/90 bg-white rounded-3xl p-4 shadow-xs">
              <div className="flex items-center justify-between text-slate-400">
                <span className="text-[10px] font-extrabold uppercase tracking-wider">Total Seats</span>
                <Layers size={16} />
              </div>
              <h3 className="text-2xl font-black text-navy mt-2 font-mono">{snapshotMetrics?.total_seats ?? 0}</h3>
              <p className="text-[10px] text-slate-400 font-medium mt-1">Total configured</p>
            </Card>

            {/* Available Seats */}
            <Card className="border border-emerald-200/80 bg-emerald-50/40 rounded-3xl p-4 shadow-xs">
              <div className="flex items-center justify-between text-emerald-600">
                <span className="text-[10px] font-extrabold uppercase tracking-wider">Available</span>
                <Armchair size={16} />
              </div>
              <h3 className="text-2xl font-black text-emerald-700 mt-2 font-mono">{availableSeats}</h3>
              <p className="text-[10px] text-emerald-600 font-medium mt-1">Ready for booking</p>
            </Card>

            {/* Checked-In Occupied */}
            <Card className="border border-red-200/80 bg-red-50/40 rounded-3xl p-4 shadow-xs">
              <div className="flex items-center justify-between text-red-600">
                <span className="text-[10px] font-extrabold uppercase tracking-wider">Occupied</span>
                <User size={16} />
              </div>
              <h3 className="text-2xl font-black text-red-700 mt-2 font-mono">{occupiedSeats}</h3>
              <p className="text-[10px] text-red-600 font-medium mt-1">Checked in occupants</p>
            </Card>

            {/* Reserved / Awaiting Check-In */}
            <Card className="border border-amber-200/80 bg-amber-50/40 rounded-3xl p-4 shadow-xs">
              <div className="flex items-center justify-between text-amber-600">
                <span className="text-[10px] font-extrabold uppercase tracking-wider">Reserved</span>
                <Calendar size={16} />
              </div>
              <h3 className="text-2xl font-black text-amber-700 mt-2 font-mono">{reservedSeats}</h3>
              <p className="text-[10px] text-amber-600 font-medium mt-1">Awaiting check-in</p>
            </Card>
          </div>
        </div>
      )}

      {/* 6. STATUS LEGEND WITH EXACT COLOR CODES */}
      <Card className="border border-slate-200/90 bg-white rounded-3xl p-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4 text-xs">
          <span className="font-extrabold text-navy uppercase text-[10px] tracking-wider flex items-center gap-1.5">
            <Filter size={14} className="text-brandBlue" /> Color Legend:
          </span>

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-3.5 h-3.5 rounded-lg bg-[#22C55E] border border-emerald-600" />
              <span className="text-slate-700 font-bold">Available ({availableSeats})</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3.5 h-3.5 rounded-lg bg-[#F59E0B] border border-amber-600" />
              <span className="text-slate-700 font-bold">Reserved ({reservedSeats})</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3.5 h-3.5 rounded-lg bg-[#EF4444] border border-red-600" />
              <span className="text-slate-700 font-bold">Occupied ({occupiedSeats})</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3.5 h-3.5 rounded-lg bg-[#94A3B8] border border-slate-500" />
              <span className="text-slate-700 font-bold">Maintenance / Inactive ({maintenanceSeats})</span>
            </div>
          </div>
        </div>
      </Card>

      {/* 7. NEW: SLOT-WISE LIVE OCCUPANCY BREAKDOWN */}
      <Card className="border border-slate-200/90 bg-white rounded-3xl p-6 shadow-xs space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-base font-black text-navy flex items-center gap-2">
              <Clock size={18} className="text-teal-600" /> Slot-Wise Live Occupancy Breakdown
            </h2>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Live capacity breakdown across all operational time slots for {selectedDate}. Click any slot card to inspect its seat map.
            </p>
          </div>
          <Badge className="bg-brandBlue text-white border-blue-600 text-xs font-mono font-bold">
            {(snapshotMetrics?.slots || []).length} Daily Slots
          </Badge>
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs text-slate-400 font-mono animate-pulse">
            Loading slot-wise occupancy breakdown...
          </div>
        ) : (snapshotMetrics?.slots || []).length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400 font-mono italic">
            No slot data configured for this library.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {(snapshotMetrics?.slots || []).map(sl => {
              const isSelected = selectedSlotId === sl.slot_id;
              const isCurrentActive = sl.slot_state === 'active';
              return (
                <motion.div
                  key={sl.slot_id}
                  whileHover={{ y: -3 }}
                  className={`
                    border rounded-3xl p-4 space-y-3 cursor-pointer transition-all shadow-xs relative overflow-hidden
                    ${isSelected ? 'border-teal-500 ring-2 ring-teal-500/20 bg-teal-50/20' : 'border-slate-200 bg-white hover:border-slate-300'}
                  `}
                  onClick={() => setSelectedSlotId(sl.slot_id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="text-xs font-black text-navy">{sl.slot_name}</h4>
                      <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                        {format12HourTime(sl.start_time)} – {format12HourTime(sl.end_time)}
                      </p>
                    </div>

                    {isCurrentActive && (
                      <Badge className="bg-emerald-500 text-white text-[9px] font-mono font-black animate-pulse">
                        Active Now
                      </Badge>
                    )}
                    {sl.slot_state === 'upcoming' && (
                      <Badge className="bg-blue-100 text-blue-800 text-[9px] font-mono font-bold">
                        Upcoming
                      </Badge>
                    )}
                    {sl.slot_state === 'past' && (
                      <Badge className="bg-slate-100 text-slate-600 text-[9px] font-mono font-medium">
                        Past
                      </Badge>
                    )}
                    {sl.slot_state === 'disabled' && (
                      <Badge className="bg-rose-100 text-rose-700 text-[9px] font-mono font-bold">
                        Disabled
                      </Badge>
                    )}
                  </div>

                  {/* Meter Progress Bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-[10px] font-mono font-bold">
                      <span className="text-slate-500">Occupancy</span>
                      <span className="text-navy">{sl.occupancy_percentage}% ({sl.occupied_seats}/{sl.operational_seats})</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-full transition-all duration-500 ${
                          sl.occupancy_percentage >= 85 ? 'bg-[#EF4444]' : sl.occupancy_percentage >= 60 ? 'bg-[#F59E0B]' : 'bg-[#22C55E]'
                        }`}
                        style={{ width: `${Math.min(100, sl.occupancy_percentage)}%` }}
                      />
                    </div>
                  </div>

                  {/* Slot Stats Grid */}
                  <div className="grid grid-cols-3 gap-1 text-center font-mono text-[10px] pt-1 border-t border-slate-100">
                    <div className="p-1 rounded-xl bg-emerald-50 text-emerald-800">
                      <div className="font-black">{sl.available_seats}</div>
                      <div className="text-[8px] uppercase tracking-tighter">Avail</div>
                    </div>
                    <div className="p-1 rounded-xl bg-amber-50 text-amber-800">
                      <div className="font-black">{sl.reserved_seats}</div>
                      <div className="text-[8px] uppercase tracking-tighter">Res</div>
                    </div>
                    <div className="p-1 rounded-xl bg-red-50 text-red-800">
                      <div className="font-black">{sl.occupied_seats}</div>
                      <div className="text-[8px] uppercase tracking-tighter">Occ</div>
                    </div>
                  </div>

                  {/* View Reserved Students Action */}
                  <Button
                    onClick={(e) => handleViewReservedStudents(sl, e)}
                    className="w-full h-7 text-[10px] font-bold bg-navy hover:bg-slate-800 text-white rounded-xl flex items-center justify-center gap-1 mt-1"
                  >
                    <Users size={12} /> View Reserved Students ({sl.reserved_seats + sl.occupied_seats})
                  </Button>

                  {isSelected && (
                    <div className="flex items-center justify-center gap-1 text-[10px] font-bold text-teal-700 pt-0.5">
                      <span>Currently Viewing Map</span> <ArrowRight size={12} />
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </Card>

      {/* 8. PHYSICAL SEAT MAP GRID */}
      <Card className="border border-slate-200/90 bg-white rounded-3xl p-6 shadow-xs space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-base font-black text-navy flex items-center gap-2">
              <Layers size={18} className="text-teal-600" /> {currentRoomObj?.name || 'Selected Room Seat Map'}
            </h2>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Interactive physical desk statuses for {currentSlotObj?.name || 'Selected Slot'}. Click any desk for action options.
            </p>
          </div>
          <Badge className="bg-slate-100 text-slate-700 border-slate-200 text-xs font-mono font-bold">
            {operationalSeats} Operational Desks
          </Badge>
        </div>

        {/* Window Wall marker */}
        <div className="w-full bg-slate-100/80 border border-slate-200 rounded-2xl py-1.5 text-center text-[10px] font-bold uppercase tracking-widest text-slate-400">
          🪟 Quiet Reading Room Window View
        </div>

        {loading ? (
          <div className="p-16 text-center text-xs text-slate-400 font-mono animate-pulse">
            Loading real-time desk statuses...
          </div>
        ) : seatMap.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400 font-mono">
            No seat grid data available for selected room.
          </div>
        ) : (
          <div className="space-y-4">
            {rows.map((row, rowIdx) => (
              <div key={`row-${rowIdx}`} className="flex items-center justify-center gap-3 sm:gap-6">
                {/* Bank 1 */}
                <div className="grid grid-cols-5 gap-2 sm:gap-3 flex-1">
                  {row.bank1.map((seat, colIdx) => {
                    const cfg = getSeatVisualConfig(seat);
                    return (
                      <motion.button
                        key={seat.seat_id ? `bank1-${seat.seat_id}-${colIdx}` : `b1-${rowIdx}-${colIdx}`}
                        type="button"
                        whileHover={{ y: -2, scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setSelectedSeat(seat)}
                        className={`
                          h-14 rounded-2xl border flex flex-col items-center justify-center p-1.5 transition-all shadow-xs cursor-pointer focus:outline-none focus:ring-2 focus:ring-brandBlue
                          ${cfg.bg}
                        `}
                        title={`Seat ${seat.seat_number} — ${cfg.label}`}
                      >
                        <div className="flex items-center gap-1">
                          {cfg.icon}
                          <span className="text-xs font-black font-mono">{seat.seat_number}</span>
                        </div>
                        <span className="text-[9px] font-semibold opacity-90 truncate max-w-full">
                          {cfg.label}
                        </span>
                      </motion.button>
                    );
                  })}
                </div>

                {/* AISLE */}
                <div className="w-10 sm:w-16 h-14 bg-slate-100/70 rounded-2xl border border-slate-200/80 flex flex-col items-center justify-center text-[9px] font-bold text-slate-400 uppercase tracking-tighter shrink-0 select-none">
                  <span>AISLE</span>
                  <span className="text-[7px]">🚶</span>
                </div>

                {/* Bank 2 */}
                <div className="grid grid-cols-5 gap-2 sm:gap-3 flex-1">
                  {row.bank2.map((seat, colIdx) => {
                    const cfg = getSeatVisualConfig(seat);
                    return (
                      <motion.button
                        key={seat.seat_id ? `bank2-${seat.seat_id}-${colIdx}` : `b2-${rowIdx}-${colIdx}`}
                        type="button"
                        whileHover={{ y: -2, scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setSelectedSeat(seat)}
                        className={`
                          h-14 rounded-2xl border flex flex-col items-center justify-center p-1.5 transition-all shadow-xs cursor-pointer focus:outline-none focus:ring-2 focus:ring-brandBlue
                          ${cfg.bg}
                        `}
                        title={`Seat ${seat.seat_number} — ${cfg.label}`}
                      >
                        <div className="flex items-center gap-1">
                          {cfg.icon}
                          <span className="text-xs font-black font-mono">{seat.seat_number}</span>
                        </div>
                        <span className="text-[9px] font-semibold opacity-90 truncate max-w-full">
                          {cfg.label}
                        </span>
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Main Entry Door marker */}
        <div className="w-full bg-slate-100/80 border border-slate-200 rounded-2xl py-1.5 text-center text-[10px] font-bold uppercase tracking-widest text-slate-400">
          🚪 Main Hall Entrance & Turnstile Gate
        </div>
      </Card>

      {/* 9. CURRENTLY CHECKED-IN OCCUPANTS LIST */}
      <Card className="border border-slate-200/90 bg-white rounded-3xl p-6 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-base font-black text-navy flex items-center gap-2">
              <Users size={18} className="text-teal-600" /> Currently Checked-In Occupants ({occupantsList.length})
            </h2>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Students who are currently seated at their desks for active slot ({currentSlotObj?.name || 'Current Slot'}).
            </p>
          </div>
          <Badge className="bg-teal-100 text-teal-800 border-teal-200 text-xs font-mono font-bold">
            {occupantsList.length} Active Occupants
          </Badge>
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs text-slate-400 font-mono animate-pulse">
            Loading occupants list...
          </div>
        ) : occupantsList.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400 font-mono italic">
            No students are currently checked in for this date and slot.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-extrabold uppercase text-[10px] tracking-wider border-b border-slate-200">
                <tr>
                  <th className="p-3">Booking Code</th>
                  <th className="p-3">Student Name</th>
                  <th className="p-3">Reg ID</th>
                  <th className="p-3">Seat</th>
                  <th className="p-3">Room</th>
                  <th className="p-3">Floor</th>
                  <th className="p-3">Slot</th>
                  <th className="p-3">Check-In Time</th>
                  <th className="p-3">Time Occupied</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-navy font-medium">
                {occupantsList.map(occ => (
                  <tr key={occ.bookingId} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-3 font-mono font-bold text-teal-600">{occ.bookingCode}</td>
                    <td className="p-3 font-bold">{occ.studentName}</td>
                    <td className="p-3 font-mono text-indigo-600">{occ.registrationNumber}</td>
                    <td className="p-3 font-mono font-black text-rose-600">{occ.seatNumber}</td>
                    <td className="p-3">{occ.roomName}</td>
                    <td className="p-3">{occ.floorName}</td>
                    <td className="p-3 text-slate-600">{occ.slotName}</td>
                    <td className="p-3 font-mono text-emerald-700">
                      {occ.checkedInAt ? new Date(occ.checkedInAt).toLocaleTimeString() : 'N/A'}
                    </td>
                    <td className="p-3 font-mono font-bold text-slate-800">
                      {occ.timeOccupiedMinutes} mins
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* 10. FLOOR-WISE & ROOM-WISE BREAKDOWN TABLES */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Floor Breakdown */}
        <Card className="border border-slate-200/90 bg-white rounded-3xl p-5 shadow-xs space-y-4">
          <h3 className="text-sm font-black text-navy uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 pb-2">
            <Layers size={16} className="text-teal-600" /> Floor-Wise Breakdown
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-extrabold uppercase text-[9px] tracking-wider">
                <tr>
                  <th className="p-2">Floor</th>
                  <th className="p-2">Total</th>
                  <th className="p-2">Oper.</th>
                  <th className="p-2 text-red-600">Occ.</th>
                  <th className="p-2 text-amber-600">Res.</th>
                  <th className="p-2 text-emerald-600">Avail.</th>
                  <th className="p-2">%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {(snapshotMetrics?.floors || []).map((fl, i) => (
                  <tr key={fl.floor_id || i} className="hover:bg-slate-50">
                    <td className="p-2 font-bold font-sans text-navy">{fl.floor_name}</td>
                    <td className="p-2">{fl.total_seats}</td>
                    <td className="p-2 font-bold">{fl.operational_seats}</td>
                    <td className="p-2 font-bold text-red-600">{fl.occupied_seats}</td>
                    <td className="p-2 font-bold text-amber-600">{fl.reserved_seats}</td>
                    <td className="p-2 font-bold text-emerald-600">{fl.available_seats}</td>
                    <td className="p-2 font-black text-teal-700">{fl.occupancy_percentage}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Room Breakdown */}
        <Card className="border border-slate-200/90 bg-white rounded-3xl p-5 shadow-xs space-y-4">
          <h3 className="text-sm font-black text-navy uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 pb-2">
            <MapPin size={16} className="text-teal-600" /> Room-Wise Breakdown
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-extrabold uppercase text-[9px] tracking-wider">
                <tr>
                  <th className="p-2">Room</th>
                  <th className="p-2">Total</th>
                  <th className="p-2">Oper.</th>
                  <th className="p-2 text-red-600">Occ.</th>
                  <th className="p-2 text-amber-600">Res.</th>
                  <th className="p-2 text-emerald-600">Avail.</th>
                  <th className="p-2">%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {(snapshotMetrics?.rooms || []).map((rm, i) => (
                  <tr key={rm.room_id || i} className="hover:bg-slate-50">
                    <td className="p-2 font-bold font-sans text-navy">{rm.room_name}</td>
                    <td className="p-2">{rm.total_seats}</td>
                    <td className="p-2 font-bold">{rm.operational_seats}</td>
                    <td className="p-2 font-bold text-red-600">{rm.occupied_seats}</td>
                    <td className="p-2 font-bold text-amber-600">{rm.reserved_seats}</td>
                    <td className="p-2 font-bold text-emerald-600">{rm.available_seats}</td>
                    <td className="p-2 font-black text-teal-700">{rm.occupancy_percentage}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* 11. SEAT DETAILS DIALOG */}
      {selectedSeat && (
        <Dialog open={!!selectedSeat} onOpenChange={() => setSelectedSeat(null)}>
          <DialogContent className="max-w-md bg-white border border-slate-200 text-navy p-6 rounded-3xl space-y-4 shadow-2xl">
            <DialogHeader className="space-y-1">
              <DialogTitle className="text-lg font-black text-navy flex items-center justify-between">
                <span>Seat {selectedSeat.seat_number} Details</span>
                <Badge className={`text-xs font-bold ${getSeatVisualConfig(selectedSeat).badgeBg}`}>
                  {getSeatVisualConfig(selectedSeat).label}
                </Badge>
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500 font-medium">
                {currentRoomObj?.name || 'Reading Hall'}
              </DialogDescription>
            </DialogHeader>

            <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl space-y-2.5 text-xs font-mono">
              <p className="text-slate-600">
                Current Status: <span className="font-bold text-navy uppercase">{getSeatVisualConfig(selectedSeat).label}</span>
              </p>

              {selectedSeat.status === 'maintenance' ? (
                <div className="pt-2 border-t border-slate-200 space-y-2">
                  <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-center gap-2 text-xs font-bold font-sans">
                    <Wrench size={16} className="text-rose-600 shrink-0" />
                    <span>Seat is under active maintenance</span>
                  </div>
                  {selectedSeat.maintenance?.reason && (
                    <p className="text-slate-600">
                      Reason: <strong className="text-slate-800">{selectedSeat.maintenance.reason}</strong>
                    </p>
                  )}
                </div>
              ) : selectedSeat.booking ? (
                <div className="pt-2 border-t border-slate-200 space-y-1.5">
                  <p className="text-slate-600">Student: <strong className="text-navy">{selectedSeat.booking.student_name}</strong></p>
                  <p className="text-slate-600">Reg No: <strong className="text-indigo-600">{selectedSeat.booking.registration_number}</strong></p>
                  <p className="text-slate-600">Booking Code: <strong className="text-teal-600">{selectedSeat.booking.booking_code}</strong></p>
                  {selectedSeat.booking.checked_in_at && (
                    <p className="text-emerald-700">Checked In: {new Date(selectedSeat.booking.checked_in_at).toLocaleTimeString()}</p>
                  )}
                </div>
              ) : (
                <p className="text-slate-400 italic">No active booking for this date and time slot.</p>
              )}
            </div>

            {/* Operational Actions */}
            <div className="space-y-2 pt-1">
              {selectedSeat.booking && selectedSeat.status === 'reserved' && (
                <Button
                  onClick={() => handleCheckInSeat(selectedSeat.booking.id)}
                  className="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs h-10 rounded-2xl flex items-center justify-center gap-2 shadow-md"
                >
                  <LogIn size={16} /> Process Check-In →
                </Button>
              )}

              {selectedSeat.booking && selectedSeat.status === 'occupied' && (
                <Button
                  onClick={() => handleCheckOutSeat(selectedSeat.booking.id)}
                  className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs h-10 rounded-2xl flex items-center justify-center gap-2 shadow-md"
                >
                  <LogOut size={16} /> Process Check-Out →
                </Button>
              )}

              {selectedSeat.status === 'maintenance' ? (
                <Button
                  type="button"
                  onClick={() => handleResolveMaintenance(selectedSeat.seat_number)}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs h-10 rounded-2xl flex items-center justify-center gap-2 shadow-md"
                >
                  <CheckCircle2 size={16} /> Activate Seat (End Maintenance) →
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={() => handleReportMaintenance(selectedSeat.seat_number)}
                  className="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs h-10 rounded-2xl flex items-center justify-center gap-2 shadow-md"
                >
                  <Wrench size={16} /> Set Under Maintenance →
                </Button>
              )}

              <Button
                onClick={() => setSelectedSeat(null)}
                variant="outline"
                className="w-full text-slate-700 font-bold text-xs h-10 rounded-2xl border-slate-300"
              >
                Close Details
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* 10. RESERVED STUDENTS LIST MODAL FOR LIBRARIANS */}
      <Dialog open={reservedStudentsModalOpen} onOpenChange={setReservedStudentsModalOpen}>
        <DialogContent className="max-w-2xl bg-white rounded-3xl p-6 border border-slate-200 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-black text-navy flex items-center gap-2">
              <Users size={20} className="text-teal-600" />
              <span>Reserved Students — {selectedOccurrenceTitle}</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 font-medium">
              Real-time student reservations and check-in statuses for this slot occurrence.
            </DialogDescription>
          </DialogHeader>

          {loadingReservedStudents ? (
            <div className="py-8 text-center text-xs font-mono text-slate-400 animate-pulse">
              Fetching reserved student list...
            </div>
          ) : reservedStudentsList.length === 0 ? (
            <div className="py-8 text-center text-xs font-mono text-slate-400 italic">
              No active student reservations for this slot occurrence.
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto space-y-2 pr-1">
              {reservedStudentsList.map((stu) => (
                <div key={stu.bookingId} className="p-3 bg-slate-50 border border-slate-200/90 rounded-2xl flex items-center justify-between text-xs hover:border-slate-300 transition-colors">
                  <div className="space-y-0.5">
                    <div className="font-bold text-navy text-xs flex items-center gap-2">
                      <span>{stu.studentName}</span>
                      <Badge className="bg-teal-600 text-white font-mono text-[10px]">{stu.seatNumber}</Badge>
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono">
                      Reg: <span className="font-bold text-navy">{stu.registrationNumber}</span> • {stu.department}
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono">
                      Code: {stu.bookingCode} • QR Token: {stu.qrToken ? stu.qrToken.slice(0, 12) + '...' : 'N/A'}
                    </div>
                  </div>
                  <div className="text-right space-y-1">
                    <Badge className={stu.bookingStatus.includes('Occupied') ? 'bg-emerald-100 text-emerald-800 font-bold text-[10px]' : 'bg-amber-100 text-amber-800 font-bold text-[10px]'}>
                      {stu.bookingStatus}
                    </Badge>
                    {stu.checkedInAt && (
                      <p className="text-[10px] text-slate-400 font-mono">
                        In: {new Date(stu.checkedInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
