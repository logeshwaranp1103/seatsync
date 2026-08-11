import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Card } from '../shared/Card';
import { Button } from '../shared/Button';
import { Badge } from '../shared/Badge';
import { Clock3, ArrowRight, CheckCircle2, Check, Users, Clock, AlertCircle } from 'lucide-react';
import { formatSlotTime, formatSlotTitle, getSlotPeriod } from '../../utils/timeUtils';

/**
 * ModernSlotCard - Shared time slot card component for Student Dashboard & Book a Seat page
 * 
 * @param {Object} props
 * @param {Object} props.slot - Slot occurrence data object from Supabase
 * @param {'dashboard' | 'book'} [props.context='book'] - Usage context ('dashboard' or 'book')
 * @param {boolean} [props.isSelected=false] - Whether this slot is selected on Book a Seat page
 * @param {Object} [props.waitlistSummary={}] - Student waitlist entry state for this slot
 * @param {number} [props.index=0] - Index for staggered Framer Motion entrance
 * @param {Function} [props.onSelectSlot] - Handler when clicking select action
 * @param {Function} [props.onViewReservation] - Handler when clicking view reservation
 * @param {Function} [props.onJoinWaitlist] - Handler when clicking join waitlist
 * @param {Function} [props.onViewWaitlist] - Handler when clicking view waitlist
 */
export function ModernSlotCard({
  slot,
  context = 'book',
  isSelected = false,
  waitlistSummary = {},
  index = 0,
  onSelectSlot,
  onViewReservation,
  onJoinWaitlist,
  onViewWaitlist
}) {
  const shouldReduceMotion = useReducedMotion();

  if (!slot) return null;

  const slotStatus = String(slot.effectiveStatus ?? slot.occurrenceStatus ?? slot.status ?? (slot.isDisabledByAdmin ? "DISABLED" : "ACTIVE")).toUpperCase();
  const isSlotCancelled = slotStatus === "DISABLED" || slotStatus === "CANCELLED" || slot.isDisabledByAdmin === true || slot.isDisabled === true || slot.isBookingEnabled === false;
  
  const availableSeats = slot.availableCount !== undefined 
    ? slot.availableCount 
    : (slot.available_seats !== undefined ? slot.available_seats : (isSlotCancelled ? 0 : 0));

  const operationalSeats = slot.operationalSeats ?? slot.operational_seats ?? slot.physicalTotalSeats ?? slot.totalCount ?? availableSeats;
  const reservedSeats = slot.reservedSeats !== undefined 
    ? slot.reservedSeats 
    : (slot.reserved_seats !== undefined ? slot.reserved_seats : Math.max(0, operationalSeats - availableSeats));

  const isFullyBooked = !isSlotCancelled && Number(availableSeats) === 0;
  const isStudentWaiting = !isSlotCancelled && Boolean(waitlistSummary.isStudentWaiting || slot.studentWaitlistPosition);
  const studentWaitlistPos = waitlistSummary.studentPosition || slot.studentWaitlistPosition || 1;

  const isAlreadyBooked = Boolean(slot.isBookedByStudent || slot.hasStudentBooking || slot.has_student_booking);
  const period = getSlotPeriod(slot.startTime || slot.start_time);

  const rawName = slot.name || slot.label || slot.slot_name || '';
  const cleanDisplayTitle = rawName.replace(/\s*\(\d{1,2}:\d{2}\s*(?:AM|PM)[\s\S]*\)/i, '').trim() || formatSlotTitle(rawName, slot.startTime || slot.start_time, slot.endTime || slot.end_time);

  const formattedStart = formatSlotTime(slot.startTime || slot.start_time);
  const formattedEnd = formatSlotTime(slot.endTime || slot.end_time);

  const availabilityPercent = operationalSeats > 0 ? Math.min(100, Math.max(0, Math.round((availableSeats / operationalSeats) * 100))) : 0;

  const periodAccentClass = isSelected
    ? 'border-l-4 border-l-blue-600'
    : isAlreadyBooked
    ? 'border-l-4 border-l-teal-500'
    : isSlotCancelled
    ? 'border-l-4 border-l-rose-400'
    : period.toUpperCase() === 'MORNING'
    ? 'border-l-4 border-l-blue-500'
    : period.toUpperCase() === 'AFTERNOON'
    ? 'border-l-4 border-l-amber-500'
    : 'border-l-4 border-l-indigo-500';

  const progressBarColor = isSlotCancelled
    ? 'bg-slate-300'
    : isSelected
    ? 'bg-blue-600'
    : isAlreadyBooked
    ? 'bg-teal-500'
    : availabilityPercent === 0
    ? 'bg-rose-500'
    : availabilityPercent < 20
    ? 'bg-rose-500'
    : availabilityPercent <= 50
    ? 'bg-amber-500'
    : 'bg-emerald-500';

  return (
    <motion.div
      initial={shouldReduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: shouldReduceMotion ? 0 : Math.min(index * 0.035, 0.25) }}
      whileHover={shouldReduceMotion ? {} : { y: -3 }}
      className="h-full"
    >
      <Card className={`
        group relative flex min-h-[200px] flex-col overflow-hidden rounded-2xl border bg-white p-5 shadow-sm
        transition-all duration-200 hover:border-blue-300 hover:shadow-lg ${periodAccentClass} ${
          isSlotCancelled
            ? 'border-rose-200 bg-rose-50/30 opacity-90'
            : isSelected
            ? 'border-blue-500 bg-blue-50/70 shadow-md ring-2 ring-blue-400/30'
            : isAlreadyBooked
            ? 'border-teal-300 bg-gradient-to-br from-teal-50/60 to-white'
            : isFullyBooked
            ? isStudentWaiting ? 'border-amber-300 bg-amber-50/30' : 'border-rose-200 bg-rose-50/20'
            : 'border-slate-200'
        }
      `}>
        {/* Card Header */}
        <div className="flex items-start justify-between gap-3">
          <span className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
            {period} • 1 HOUR
          </span>

          {isAlreadyBooked ? (
            <Badge className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold bg-teal-100 text-teal-800 border-teal-200 shadow-2xs">
              <CheckCircle2 className="h-3.5 w-3.5 text-teal-600" />
              ✓ Your Reservation
            </Badge>
          ) : isSelected ? (
            <Badge className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold bg-blue-600 text-white shadow-2xs">
              <Check className="h-3.5 w-3.5 text-white" />
              Selected
            </Badge>
          ) : isStudentWaiting ? (
            <Badge className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold bg-amber-100 text-amber-900 border-amber-300">
              Waitlisted #{studentWaitlistPos}
            </Badge>
          ) : isSlotCancelled ? (
            <Badge className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold bg-rose-100 text-rose-800 border-rose-200">
              Cancelled
            </Badge>
          ) : isFullyBooked ? (
            <Badge className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold bg-rose-50 text-rose-700 border-rose-200">
              Fully Booked
            </Badge>
          ) : (
            <Badge className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold bg-emerald-50 text-emerald-700 border-emerald-200">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Available
            </Badge>
          )}
        </div>

        {/* Slot Name & Hierarchy */}
        <h3 className="mt-4 text-lg font-semibold leading-6 text-slate-950 tracking-tight">
          {cleanDisplayTitle}
        </h3>

        <div className="mt-2 flex items-center gap-2">
          <Clock3 className="h-4 w-4 shrink-0 text-blue-600" />
          <span className="whitespace-nowrap text-base font-semibold tabular-nums text-slate-700">
            {formattedStart} — {formattedEnd}
          </span>
        </div>

        {/* Capacity Section */}
        {isSlotCancelled ? (
          <div className="mt-4 p-2.5 bg-rose-100/70 border border-rose-200 rounded-xl text-xs space-y-1">
            <div className="font-bold text-rose-800 flex items-center gap-1.5">
              <AlertCircle size={14} className="shrink-0 text-rose-600" /> Slot Cancelled
            </div>
            {slot.disabledReason && (
              <p className="text-[11px] text-slate-600 font-medium truncate">Reason: {slot.disabledReason}</p>
            )}
          </div>
        ) : isAlreadyBooked ? (
          <div className="mt-4">
            <p className="text-xs font-medium text-teal-800">
              {context === 'dashboard' ? 'You already reserved this time slot.' : 'You already booked this time.'}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {reservedSeats} reserved
            </p>
          </div>
        ) : (
          <div className="mt-5">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium text-slate-600">
                {availableSeats} seats available
              </span>

              <span className="font-semibold tabular-nums text-slate-900">
                {availabilityPercent}%
              </span>
            </div>

            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 border border-slate-200/50">
              <motion.div
                className={`h-full rounded-full ${progressBarColor}`}
                initial={{ width: 0 }}
                animate={{ width: `${availabilityPercent}%` }}
                transition={{ duration: shouldReduceMotion ? 0 : 0.4 }}
              />
            </div>

            <p className="mt-2 text-xs text-slate-500">
              {reservedSeats} reserved
            </p>
          </div>
        )}

        {/* Card Action Placement */}
        <div className="mt-auto pt-5">
          {isSlotCancelled ? (
            <Button
              type="button"
              disabled
              aria-disabled="true"
              className="h-11 min-h-[44px] w-full rounded-xl text-xs font-bold bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed"
            >
              Unavailable
            </Button>
          ) : isAlreadyBooked ? (
            <Button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (onViewReservation) onViewReservation(e, slot);
              }}
              className="h-11 min-h-[44px] w-full rounded-xl text-xs font-bold bg-teal-600 hover:bg-teal-700 active:bg-teal-800 text-white flex items-center justify-center gap-2 shadow-xs cursor-pointer"
            >
              View Reservation
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
            </Button>
          ) : isSelected ? (
            <Button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (onSelectSlot) onSelectSlot(e, slot);
              }}
              className="h-11 min-h-[44px] w-full rounded-xl text-xs font-bold bg-blue-700 hover:bg-blue-800 text-white flex items-center justify-center gap-2 shadow-xs cursor-pointer"
            >
              Selected
              <Check className="h-4 w-4" />
            </Button>
          ) : isFullyBooked ? (
            isStudentWaiting ? (
              <Button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (onViewWaitlist) onViewWaitlist(e, slot);
                }}
                className="h-11 min-h-[44px] w-full rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white flex items-center justify-center gap-2 shadow-xs cursor-pointer"
              >
                View Waiting List
                <Users className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (onJoinWaitlist) onJoinWaitlist(e, slot);
                }}
                className="h-11 min-h-[44px] w-full rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white flex items-center justify-center gap-2 shadow-xs cursor-pointer"
              >
                Join Waitlist
                <Clock className="h-4 w-4" />
              </Button>
            )
          ) : (
            <Button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (onSelectSlot) onSelectSlot(e, slot);
              }}
              className="h-11 min-h-[44px] w-full rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white flex items-center justify-center gap-2 shadow-xs cursor-pointer"
            >
              {context === 'dashboard' ? 'Select Seat' : 'Select Slot'}
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
            </Button>
          )}
        </div>
      </Card>
    </motion.div>
  );
}

export function ModernSlotCardSkeleton() {
  return (
    <Card className="flex min-h-[200px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm animate-pulse">
      <div className="flex justify-between items-center">
        <div className="h-3 w-24 bg-slate-200 rounded" />
        <div className="h-6 w-20 bg-slate-200 rounded-full" />
      </div>
      <div className="mt-4 h-6 w-36 bg-slate-200 rounded" />
      <div className="mt-2 h-4 w-44 bg-slate-200 rounded" />
      <div className="mt-5 space-y-2">
        <div className="flex justify-between">
          <div className="h-4 w-28 bg-slate-200 rounded" />
          <div className="h-4 w-10 bg-slate-200 rounded" />
        </div>
        <div className="h-2 w-full bg-slate-200 rounded-full" />
        <div className="h-3 w-20 bg-slate-200 rounded" />
      </div>
      <div className="mt-auto pt-5">
        <div className="h-11 w-full bg-slate-200 rounded-xl" />
      </div>
    </Card>
  );
}
