import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { useAuth } from '../../auth/AuthProvider';
import { useSync } from '../../hooks/useSync';
import { bookingService } from '../../services/bookingService';
import { slotService } from '../../services/slotService';
import { occupancyService } from '../../services/occupancyService';
import { Card, CardContent } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../components/shared/Dialog';
import {
  Clock, Clock3, Armchair, Shield, CheckCircle2, ChevronRight, AlertCircle,
  MapPin, Sparkles, Filter, Lock, Check, Zap, Users, ShieldAlert, Ban, RefreshCw
} from 'lucide-react';
import { format, addDays } from 'date-fns';
import toast from 'react-hot-toast';
import { ModernSlotCard, ModernSlotCardSkeleton } from '../../components/student/ModernSlotCard';
import {
  formatSlotTime,
  formatSlotRange,
  getSlotPeriod,
  formatSlotTitle,
  sortSlotsChronologically
} from '../../utils/timeUtils';


export default function FindSeat() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const targetOccurrenceId = searchParams.get('slotOccurrenceId') || searchParams.get('slotId');

  const { user } = useAuth();
  const shouldReduceMotion = useReducedMotion();

  const seatMapRef = useRef(null);
  const hasScrolledRef = useRef(false);

  const tomorrowDate = useMemo(() => format(addDays(new Date(), 1), 'yyyy-MM-dd'), []);

  const [floors, setFloors] = useState([]);
  const [selectedFloor, setSelectedFloor] = useState(null);

  const [slots, setSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(null);

  const [seats, setSeats] = useState([]);
  const [selectedZone, setSelectedZone] = useState('ALL');
  const [selectedSeat, setSelectedSeat] = useState(null);

  const [loadingSlots, setLoadingSlots] = useState(true);
  const [slotsError, setSlotsError] = useState(null);
  const [loadingSeats, setLoadingSeats] = useState(false);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);

  const fetchInitialData = async () => {
    try {
      setLoadingSlots(true);
      setSlotsError(null);
      const [floorsData, availableSlots] = await Promise.all([
        bookingService.getFloors(),
        bookingService.getSlotsAvailability(tomorrowDate, user?.id)
      ]);

      setFloors(floorsData || []);
      if (floorsData && floorsData.length > 0 && !selectedFloor) {
        setSelectedFloor(floorsData[0]);
      }

      const mappedSlots = (availableSlots || []).map(s => ({
        ...s,
        effectiveStatus: s.isDisabledByAdmin ? 'cancelled' : 'active',
        isBookingEnabled: !s.isDisabledByAdmin,
        hasStudentBooking: s.isBookedByStudent,
        physicalTotalSeats: s.physicalTotalSeats ?? 0,
        operationalSeats: s.operationalSeats ?? 0,
        reservedSeats: s.reservedSeats || 0,
        availableCount: s.availableCount ?? 0,
        maintenanceSeats: s.maintenanceSeats || 0,
        blockedSeats: s.blockedSeats || 0,
        waitlistCount: 0
      }));

      const sorted = sortSlotsChronologically(mappedSlots);
      setSlots(sorted);

      // Restore slot selection if URL contains slotOccurrenceId
      if (targetOccurrenceId) {
        const matchedSlot = sorted.find(s => 
          String(s.slot_occurrence_id) === String(targetOccurrenceId) ||
          String(s.id) === String(targetOccurrenceId)
        );

        if (matchedSlot) {
          const isCancelled = matchedSlot.effectiveStatus === 'cancelled' ||
                              matchedSlot.effectiveStatus === 'globally_disabled' ||
                              matchedSlot.effectiveStatus === 'disabled' ||
                              matchedSlot.isBookingEnabled === false;
          if (isCancelled) {
            toast.error('This time slot is no longer available.');
          } else {
            setSelectedSlot(matchedSlot);
          }
        } else {
          toast.error('This time slot is no longer available.');
        }
      }

    } catch (err) {
      setSlotsError(err.message || 'Failed to load slot availability.');
      toast.error('Failed to load slots availability: ' + err.message);
    } finally {
      setLoadingSlots(false);
    }
  };

  useEffect(() => {
    fetchInitialData();
  }, [tomorrowDate, user?.id, targetOccurrenceId]);

  useSync(['slot_occurrences', 'slots', 'bookings', 'seats', 'seat_maintenance', 'waitlist_entries', 'notifications'], fetchInitialData);

  const fetchSeats = async () => {
    if (!selectedSlot || !selectedFloor) return;
    try {
      setLoadingSeats(true);
      const seatsData = await bookingService.getSeatsForSlot(
        selectedFloor.id,
        tomorrowDate,
        selectedSlot.id,
        user?.id
      );
      setSeats(seatsData);
    } catch {
      toast.error('Failed to load seats map.');
    } finally {
      setLoadingSeats(false);
    }
  };

  useEffect(() => {
    if (selectedSlot && selectedFloor) {
      fetchSeats();
    }
  }, [selectedSlot, selectedFloor]);

  // Scroll to seat map once upon loading target occurrence
  useEffect(() => {
    if (selectedSlot && !loadingSeats && seatMapRef.current && !hasScrolledRef.current) {
      hasScrolledRef.current = true;
      seatMapRef.current.scrollIntoView({
        behavior: shouldReduceMotion ? 'auto' : 'smooth',
        block: 'start',
      });
      const focusTarget = seatMapRef.current.querySelector('h2, h3, button, [tabIndex]');
      if (focusTarget) {
        focusTarget.focus({ preventScroll: true });
      }
    }
  }, [selectedSlot, loadingSeats, shouldReduceMotion]);

  const handleConfirmSeatBooking = async (targetSeat) => {
    const seatToBook = targetSeat || selectedSeat;
    if (!selectedSlot || !selectedFloor || !seatToBook || !user) return;

    if (selectedSlot.effectiveStatus === 'cancelled' || selectedSlot.effectiveStatus === 'globally_disabled' || selectedSlot.isBookingEnabled === false) {
      toast.error('This slot occurrence has been cancelled by the administrator.');
      return;
    }

    setBookingLoading(true);
    try {
      await bookingService.createBooking(
        user,
        tomorrowDate,
        selectedSlot,
        selectedFloor.id,
        seatToBook.id
      );
      toast.success(`Seat ${seatToBook.seatNumber} successfully booked! Reservation confirmed.`);
      setConfirmModalOpen(false);
      setSelectedSeat(null);
      setSelectedSlot(null);
      fetchInitialData();
    } catch (error) {
      if (error.message?.includes('reserved by another student') || error.message?.includes('already') || error.message?.includes('booked')) {
        toast.error('This seat was just reserved by another student. Please select another available seat.');
        setSelectedSeat(null);
        fetchSeats();
      } else {
        toast.error(error.message || 'Failed to complete booking.');
      }
    } finally {
      setBookingLoading(false);
    }
  };

  const filteredSeats = useMemo(() => {
    if (selectedZone === 'ALL') return seats;
    return seats.filter(s => s.zoneId === selectedZone);
  }, [seats, selectedZone]);

  const handleSeatClick = (seat) => {
    const isAvailable = seat.status_state === 'available' || seat.ui_status === 'Available';
    if (!isAvailable) {
      if (seat.isUserBooked || seat.status_state === 'user_booked') {
        toast.error(`You already have a reservation for Seat ${seat.seatNumber}.`);
      } else {
        toast.error(`Seat ${seat.seatNumber} is ${seat.ui_status || seat.status_state}. Please select an available seat.`);
      }
      return;
    }

    setSelectedSeat(seat);

    // On mobile (< 768px), immediately open confirmation modal portal
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setConfirmModalOpen(true);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8 space-y-5 sm:space-y-6 lg:space-y-8 animate-in fade-in duration-300 pb-24 sm:pb-16">
      {/* Header */}
      <div className="pb-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">Reserve a Seat</h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Select a time slot for tomorrow (<span className="font-mono font-bold text-slate-900">{format(new Date(tomorrowDate), 'EEEE, d MMMM yyyy')}</span>) and pick your seat.
          </p>
        </div>

        <Badge className={`px-3.5 py-1.5 rounded-2xl font-mono font-extrabold text-xs text-white shadow-xs ${
          (['female', 'girls', 'girl'].includes(String(user?.gender || user?.genderGroup || 'boys').toLowerCase()))
            ? 'bg-pink-600'
            : 'bg-blue-600'
        }`}>
          {(['female', 'girls', 'girl'].includes(String(user?.gender || user?.genderGroup || 'boys').toLowerCase()))
            ? 'GIRLS SEATS ONLY'
            : 'BOYS SEATS ONLY'}
        </Badge>
      </div>

      {/* GENDER GROUP NOTICE BANNER */}
      <div className={`p-4 rounded-2xl border flex items-center justify-between gap-3 text-xs font-semibold ${
        (['female', 'girls', 'girl'].includes(String(user?.gender || user?.genderGroup || 'boys').toLowerCase()))
          ? 'bg-pink-50 border-pink-200 text-pink-900'
          : 'bg-blue-50 border-blue-200 text-blue-900'
      }`}>
        <div className="flex items-center gap-2.5">
          <Shield className={(['female', 'girls', 'girl'].includes(String(user?.gender || user?.genderGroup || 'boys').toLowerCase())) ? 'text-pink-600' : 'text-blue-600'} size={18} />
          <span>
            <strong>Gender Access Policy:</strong> You are viewing <strong>{(['female', 'girls', 'girl'].includes(String(user?.gender || user?.genderGroup || 'boys').toLowerCase())) ? 'GIRLS' : 'BOYS'} GROUP SEATS</strong> based on your registered student gender profile.
          </span>
        </div>
        <span className="text-[11px] font-bold uppercase font-mono tracking-wider shrink-0">
          Enforced by Database
        </span>
      </div>

      {/* 1. SLOT SELECTION */}
      {!selectedSlot ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 flex items-center gap-2.5 tracking-tight">
              <Clock className="h-5 w-5 text-blue-600 shrink-0" /> Step 1: Select Time Slot
            </h2>
            <Badge variant="outline" className="text-xs font-semibold bg-slate-50 text-slate-700 border-slate-200">
              Tomorrow's Operational Slots
            </Badge>
          </div>

          {loadingSlots ? (
            /* Loading Skeleton State */
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map(i => (
                <ModernSlotCardSkeleton key={i} />
              ))}
            </div>
          ) : slotsError ? (
            /* Error State with Retry Button */
            <Card className="p-8 text-center bg-white border border-rose-200 rounded-2xl space-y-3 shadow-sm">
              <AlertCircle className="h-10 w-10 text-rose-500 mx-auto" />
              <p className="text-sm font-bold text-slate-900">Unable to load slot availability.</p>
              <p className="text-xs text-slate-500">{slotsError}</p>
              <Button onClick={fetchInitialData} className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs h-10 px-5 rounded-xl">
                Retry Loading Slots
              </Button>
            </Card>
          ) : slots.length === 0 ? (
            /* Empty State */
            <Card className="p-8 text-center bg-white border border-slate-200 rounded-2xl space-y-3">
              <p className="text-sm text-slate-500 font-semibold">No operational slots are available for tomorrow.</p>
              <Button onClick={fetchInitialData} className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs h-10 px-5 rounded-xl">
                Reload Time Slots
              </Button>
            </Card>
          ) : (
            /* Database-backed Shared Modern Slot Cards Grid */
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {slots.map((slot, index) => (
                <ModernSlotCard
                  key={slot.slot_occurrence_id || slot.id}
                  slot={slot}
                  context="book"
                  isSelected={selectedSlot?.id === slot.id || selectedSlot?.slot_occurrence_id === slot.slot_occurrence_id}
                  waitlistSummary={{
                    isStudentWaiting: Boolean(slot.studentWaitlistPosition),
                    studentPosition: slot.studentWaitlistPosition
                  }}
                  index={index}
                  onSelectSlot={() => {
                    const isCancelled = slot.effectiveStatus === 'cancelled' || slot.effectiveStatus === 'globally_disabled' || slot.effectiveStatus === 'disabled' || slot.isBookingEnabled === false;
                    if (isCancelled) {
                      toast.error(`This slot was cancelled by administrator. Reason: ${slot.disabledReason || 'Library maintenance'}`);
                      return;
                    }
                    const isAlreadyBooked = Boolean(slot.hasStudentBooking || slot.current_student_has_reservation);
                    if (isAlreadyBooked) {
                      toast.error('You already have an active reservation for this time slot.');
                      return;
                    }
                    setSelectedSlot(slot);
                  }}
                  onViewReservation={() => navigate('/student/reservations')}
                  onJoinWaitlist={() => toast.info('Please join waitlist from the Dashboard.')}
                  onViewWaitlist={() => navigate('/student/reservations')}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        /* 2. SEAT SELECTION GRID & MAP */
        <div ref={seatMapRef} className="space-y-6 scroll-mt-20">
          {/* Selected Slot Summary Banner */}
          <div className="flex flex-col gap-4 rounded-2xl border border-blue-200 bg-blue-50/70 p-4 sm:p-5 shadow-xs sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className="bg-blue-600 text-white font-bold text-xs flex items-center gap-1">
                  <Check className="h-3.5 w-3.5 text-white" />
                  {(selectedSlot.name || selectedSlot.label || '').replace(/\s*\(\d{1,2}:\d{2}\s*(?:AM|PM)[\s\S]*\)/i, '').trim() || formatSlotTitle(selectedSlot.name, selectedSlot.startTime, selectedSlot.endTime)}
                </Badge>
                <span className="text-sm font-semibold text-slate-800 flex items-center gap-1.5 tabular-nums">
                  <Clock3 className="h-4 w-4 text-blue-600 shrink-0" />
                  {formatSlotTime(selectedSlot.startTime)} — {formatSlotTime(selectedSlot.endTime)}
                </span>
              </div>

              <p className="text-xs text-slate-600 mt-1">
                Selected Floor: <strong className="text-slate-900">{selectedFloor?.name || 'Floor 1'}</strong> • Tomorrow (<span className="font-semibold text-slate-900">{format(new Date(tomorrowDate), 'EEEE, d MMMM yyyy')}</span>)
              </p>
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={() => { setSelectedSlot(null); setSelectedSeat(null); }}
              className="h-11 min-h-[44px] w-full sm:w-auto px-5 rounded-xl border-blue-300 bg-white font-bold text-xs hover:bg-blue-100 text-blue-700 shrink-0 shadow-2xs"
            >
              Change Slot
            </Button>
          </div>

          {/* Seat Map Controls & Layout */}
          <div className="grid lg:grid-cols-4 gap-6">
            <div className="lg:col-span-3 space-y-4">
              {/* Zone Filter & Compact Legend Header */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs">
                <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
                  <span className="text-xs font-bold text-slate-600 flex items-center gap-1 shrink-0">
                    <Filter size={14} className="text-blue-600" /> Zone:
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedZone('ALL')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors shrink-0 ${selectedZone === 'ALL' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >
                    All Seats
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedZone('zone-a')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors shrink-0 ${selectedZone === 'zone-a' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >
                    Zone A — Quiet Study (S-01 to S-20)
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedZone('zone-b')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors shrink-0 ${selectedZone === 'zone-b' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >
                    Zone B — Collaborative (S-21 to S-40)
                  </button>
                </div>
              </div>

              {/* Seat Legend */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-semibold text-slate-700">
                  <div className="flex items-center gap-1.5">
                    <span className="w-3.5 h-3.5 rounded-md bg-emerald-500 border border-emerald-600 text-white flex items-center justify-center text-[9px] font-bold">✓</span>
                    <span>Available</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="w-3.5 h-3.5 rounded-md bg-blue-600 border border-blue-700 text-white flex items-center justify-center text-[9px] font-bold">★</span>
                    <span>Selected</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="w-3.5 h-3.5 rounded-md bg-amber-500 border border-amber-600 text-white flex items-center justify-center text-[9px] font-bold">⏰</span>
                    <span>Reserved</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="w-3.5 h-3.5 rounded-md bg-rose-500 border border-rose-600 text-white flex items-center justify-center text-[9px] font-bold">🔒</span>
                    <span>Occupied</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="w-3.5 h-3.5 rounded-md bg-slate-400 border border-slate-500 text-white flex items-center justify-center text-[9px] font-bold">🔧</span>
                    <span>Maintenance</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="w-3.5 h-3.5 rounded-md bg-teal-600 border border-teal-700 text-white flex items-center justify-center text-[9px] font-bold">👤</span>
                    <span>Booked by You</span>
                  </div>
                </div>
              </div>

              {/* Interactive Responsive Seat Map Grid */}
              <Card className="border border-slate-200 bg-white rounded-2xl p-4 sm:p-6 shadow-xs">
                {loadingSeats ? (
                  <div className="py-12 text-center text-xs font-mono text-slate-400 animate-pulse">Loading interactive seat map layout...</div>
                ) : filteredSeats.length === 0 ? (
                  <div className="py-10 text-center text-xs text-slate-500 font-semibold">No seats match the selected zone filter.</div>
                ) : (
                  <div className="grid grid-cols-4 gap-2.5 xs:grid-cols-5 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
                    {filteredSeats.map(seat => {
                      const isSelected = selectedSeat?.id === seat.id;
                      const isAvailable = seat.status_state === 'available' || seat.ui_status === 'Available';
                      const isUserBooked = seat.isUserBooked || seat.status_state === 'user_booked';
                      const isOccupied = seat.status_state === 'occupied' || seat.ui_status === 'Occupied';
                      const isReserved = seat.status_state === 'reserved' || seat.ui_status === 'Reserved';
                      const isMaintenance = seat.status_state === 'maintenance' || seat.ui_status === 'Maintenance';

                      return (
                        <button
                          key={seat.id}
                          type="button"
                          disabled={!isAvailable}
                          aria-disabled={!isAvailable}
                          aria-pressed={isSelected}
                          aria-label={`Seat ${seat.seatNumber}, ${seat.ui_status || seat.status_state}`}
                          onClick={() => handleSeatClick(seat)}
                          className={`
                            relative h-11 sm:h-12 min-h-[44px] min-w-[44px] w-full rounded-xl flex flex-col items-center justify-center font-mono transition-all border p-1
                            focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 select-none
                            ${isSelected
                              ? 'bg-blue-600 text-white border-blue-700 ring-4 ring-blue-500/20 scale-105 shadow-md z-10 font-bold'
                              : isUserBooked
                                ? 'bg-teal-600 text-white border-teal-700 cursor-not-allowed font-bold'
                                : isOccupied
                                  ? 'bg-rose-100 text-rose-800 border-rose-200 cursor-not-allowed opacity-80'
                                  : isReserved
                                    ? 'bg-amber-100 text-amber-800 border-amber-200 cursor-not-allowed opacity-80'
                                    : isMaintenance
                                      ? 'bg-slate-200 text-slate-500 border-slate-300 cursor-not-allowed'
                                      : 'bg-emerald-50 text-emerald-900 border-emerald-200 hover:border-blue-600 hover:bg-blue-50 hover:scale-105 cursor-pointer font-bold'}
                          `}
                        >
                          <span className="text-xs font-bold">{seat.seatNumber}</span>
                          {seat.powerOutlet && <span className="text-[9px] leading-none opacity-80 mt-0.5">⚡</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </Card>
            </div>

            {/* Desktop Selected Seat Details Sidebar (hidden on mobile, shown on md+) */}
            <div className="hidden md:block space-y-4">
              <Card className="border border-slate-200 bg-white rounded-2xl p-5 shadow-xs space-y-4 sticky top-20">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Armchair size={18} className="text-blue-600" /> Selected Seat Details
                </h3>

                {selectedSeat ? (
                  <div className="space-y-3">
                    <div className="p-4 bg-blue-50/60 border border-blue-200 rounded-xl space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xl font-black text-slate-900 font-mono">{selectedSeat.seatNumber}</span>
                        <Badge className="bg-emerald-600 text-white text-[10px]">Available</Badge>
                      </div>
                      <p className="text-xs font-semibold text-slate-700">{selectedSeat.type || 'Quiet Study Seat'}</p>
                    </div>

                    <div className="space-y-2 text-xs text-slate-600">
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span>Power Socket:</span>
                        <span className="font-bold text-slate-900">{selectedSeat.powerOutlet ? 'Available (⚡)' : 'No'}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span>Window View:</span>
                        <span className="font-bold text-slate-900">{selectedSeat.nearWindow ? 'Yes' : 'No'}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span>Accessible:</span>
                        <span className="font-bold text-slate-900">{selectedSeat.isAccessible ? 'Yes (♿)' : 'Standard'}</span>
                      </div>
                    </div>

                    <Button
                      onClick={() => setConfirmModalOpen(true)}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs h-11 min-h-[44px] rounded-xl shadow-md flex items-center justify-center gap-2"
                    >
                      <span>Proceed to Confirm</span> <ChevronRight size={16} />
                    </Button>
                  </div>
                ) : (
                  <div className="py-8 text-center text-xs text-slate-400 space-y-2">
                    <Armchair size={32} className="mx-auto text-slate-300" />
                    <p>Click on any available green seat grid item to select.</p>
                  </div>
                )}
              </Card>
            </div>
          </div>
        </div>
      )}

      {/* Booking Confirmation Dialog Modal (Rendered through Portal for both Mobile and Desktop) */}
      {selectedSeat && selectedSlot && (
        <Dialog open={confirmModalOpen} onOpenChange={setConfirmModalOpen}>
          <DialogContent className="max-w-md bg-white rounded-3xl p-5 sm:p-6 space-y-4 border border-slate-200 shadow-2xl pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">
            <DialogHeader className="text-left space-y-1">
              <DialogTitle className="text-lg font-black text-slate-900 flex items-center gap-2">
                <Sparkles size={20} className="text-blue-600" /> Confirm Seat Reservation
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                Please review your library booking details before confirming.
              </DialogDescription>
            </DialogHeader>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2.5 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-500 font-medium">Student Name:</span>
                <span className="font-bold text-slate-900">{user?.name || user?.fullName || 'Student'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-500 font-medium">Registration No:</span>
                <span className="font-mono font-bold text-blue-600">{user?.collegeId || user?.registration_number || 'N/A'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-500 font-medium">Booking Date:</span>
                <span className="font-mono font-bold text-slate-900">{tomorrowDate}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-500 font-medium">Time Slot:</span>
                <span className="font-bold text-slate-900">{formatSlotRange(selectedSlot.startTime, selectedSlot.endTime)}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-500 font-medium">Selected Seat:</span>
                <Badge className="bg-blue-600 text-white font-mono font-bold text-xs">{selectedSeat.seatNumber}</Badge>
              </div>
            </div>

            <DialogFooter className="flex flex-col-reverse sm:flex-row items-center justify-end gap-2.5 pt-2">
              <Button
                variant="outline"
                onClick={() => setConfirmModalOpen(false)}
                className="w-full sm:w-auto rounded-xl text-xs font-bold h-11 min-h-[44px] border-slate-300"
              >
                Cancel
              </Button>
              <Button
                onClick={() => handleConfirmSeatBooking(selectedSeat)}
                disabled={bookingLoading}
                className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs h-11 min-h-[44px] px-6 rounded-xl shadow-md"
              >
                {bookingLoading ? 'Reserving Seat...' : 'Confirm Reservation →'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}


