import { supabase, isUUID } from '../lib/supabase.js';
import { db } from './mockDatabase.js';
import { defaultSlots, defaultSeats } from '../data/seedData.js';

export function getTodayKolkataDate() {
  const options = { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' };
  const formatter = new Intl.DateTimeFormat('en-CA', options); // Returns YYYY-MM-DD
  return formatter.format(new Date());
}

export function getCurrentOrNextKolkataSlot(slots = []) {
  if (!slots || slots.length === 0) return null;
  const nowStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date());

  const current = slots.find(s => {
    const st = s.start_time || s.startTime || '00:00:00';
    const et = s.end_time || s.endTime || '23:59:59';
    return st <= nowStr && et >= nowStr;
  });
  if (current) return current;

  const upcoming = slots
    .filter(s => (s.start_time || s.startTime || '00:00:00') > nowStr)
    .sort((a, b) => (a.start_time || a.startTime || '00:00:00').localeCompare(b.start_time || b.startTime || '00:00:00'));
  if (upcoming.length > 0) return upcoming[0];

  return slots[0];
}

/**
 * 1. Fetch live occupancy snapshot for library / floor / room / slot
 */
export async function getLiveOccupancy({ libraryId = null, floorId = null, roomId = null, slotId = null, bookingDate = null } = {}) {
  const { data, error } = await supabase.rpc('get_live_occupancy_snapshot', {
    p_library_id: libraryId && isUUID(libraryId) ? libraryId : null,
    p_floor_id: floorId && isUUID(floorId) ? floorId : null,
    p_room_id: roomId && isUUID(roomId) ? roomId : null,
    p_slot_id: slotId && isUUID(slotId) ? slotId : null,
    p_booking_date: bookingDate || getTodayKolkataDate()
  });

  if (error) {
    throw new Error(`[Supabase Error] ${error.message}`);
  }
  return data;
}

/**
 * 2. Fetch floor-wise occupancy breakdown
 */
export async function getFloorOccupancy({ libraryId = null, floorId = null, slotId = null, bookingDate = null } = {}) {
  const snapshot = await getLiveOccupancy({ libraryId, floorId, slotId, bookingDate });
  return snapshot?.floors || [];
}

/**
 * 3. Fetch slot-wise occupancy breakdown across all daily slots
 */
export async function getSlotOccupancy({ libraryId = null, floorId = null, roomId = null, bookingDate = null } = {}) {
  const snapshot = await getLiveOccupancy({ libraryId, floorId, roomId, bookingDate });
  return snapshot?.slots || [];
}

/**
 * 4. Fetch currently checked-in occupants list
 */
export async function getCurrentOccupants({ libraryId = null, floorId = null, roomId = null, slotId = null, bookingDate = null } = {}) {
  const { data, error } = await supabase.rpc('get_current_occupants', {
    p_library_id: libraryId && isUUID(libraryId) ? libraryId : null,
    p_floor_id: floorId && isUUID(floorId) ? floorId : null,
    p_room_id: roomId && isUUID(roomId) ? roomId : null,
    p_slot_id: slotId && isUUID(slotId) ? slotId : null,
    p_booking_date: bookingDate || getTodayKolkataDate()
  });

  if (error) {
    throw new Error(`[Supabase Error] ${error.message}`);
  }

  return (data || []).map(o => ({
    bookingId: o.booking_id,
    bookingCode: o.booking_code,
    studentId: o.student_id,
    studentName: o.student_name,
    registrationNumber: o.registration_number,
    seatId: o.seat_id,
    seatNumber: o.seat_number,
    roomId: o.room_id,
    roomName: o.room_name,
    floorId: o.floor_id,
    floorName: o.floor_name,
    slotId: o.slot_id,
    slotName: o.slot_name,
    checkedInAt: o.checked_in_at,
    timeOccupiedMinutes: o.time_occupied_minutes
  }));
}

/**
 * 5. Fetch detailed seat statuses for a room / floor / library
 */
export async function getLiveSeatStatuses({ libraryId = null, floorId = null, roomId = null, slotId = null, bookingDate = null } = {}) {
  const { data, error } = await supabase.rpc('get_live_seat_statuses', {
    p_room_id: roomId && isUUID(roomId) ? roomId : null,
    p_slot_id: slotId && isUUID(slotId) ? slotId : null,
    p_booking_date: bookingDate || getTodayKolkataDate(),
    p_library_id: libraryId && isUUID(libraryId) ? libraryId : null,
    p_floor_id: floorId && isUUID(floorId) ? floorId : null
  });

  if (error) {
    throw new Error(`[Supabase Error] ${error.message}`);
  }
  return data || [];
}

/**
 * 6. Fetch slot occurrence live occupancy summary
 */
export async function getSlotOccurrenceOccupancy({ libraryId = null, occurrenceDate = null, roomId = null, slotOccurrenceId = null } = {}) {
  const { data, error } = await supabase.rpc('get_slot_occurrence_occupancy', {
    p_library_id: libraryId && isUUID(libraryId) ? libraryId : null,
    p_occurrence_date: occurrenceDate || getTodayKolkataDate(),
    p_room_id: roomId && isUUID(roomId) ? roomId : null,
    p_slot_occurrence_id: slotOccurrenceId && isUUID(slotOccurrenceId) ? slotOccurrenceId : null
  });

  if (error) {
    throw new Error(`[Supabase Error] ${error.message}`);
  }
  return data || [];
}

/**
 * 7. Fetch reserved students list for a specific slot occurrence (Librarians & Admins only)
 */
export async function getReservedStudentsForOccurrence(slotOccurrenceId) {
  if (!slotOccurrenceId || !isUUID(slotOccurrenceId)) return [];

  const { data, error } = await supabase.rpc('get_reserved_students_for_occurrence', {
    p_slot_occurrence_id: slotOccurrenceId
  });

  if (error) {
    throw new Error(`[Supabase Error] ${error.message}`);
  }

  return (data || []).map(r => ({
    bookingId: r.booking_id,
    bookingCode: r.booking_code,
    studentId: r.student_id,
    studentName: r.student_name,
    registrationNumber: r.registration_number,
    department: r.department,
    seatId: r.seat_id,
    seatNumber: r.seat_number,
    bookingDate: r.booking_date,
    slotName: r.slot_name,
    startTime: r.start_time,
    endTime: r.end_time,
    bookingStatus: r.booking_status,
    checkedInAt: r.checked_in_at,
    checkedOutAt: r.checked_out_at,
    qrToken: r.qr_token
  }));
}

export const occupancyService = {
  getLiveOccupancy,
  getFloorOccupancy,
  getSlotOccupancy,
  getCurrentOccupants,
  getLiveSeatStatuses,
  getSlotOccurrenceOccupancy,
  getReservedStudentsForOccurrence,

  async getOccupancy({ roomId, bookingDate, slotId }) {
    try {
      const seats = await getLiveSeatStatuses({ roomId, slotId, bookingDate });
      if (seats && seats.length > 0) {
        const totalCapacity = seats.length;
        const availableCount = seats.filter(s => s.status === 'available').length;
        const reservedCount = seats.filter(s => s.status === 'reserved').length;
        const occupiedCount = seats.filter(s => s.status === 'occupied').length;
        const maintenanceCount = seats.filter(s => s.status === 'maintenance' || s.status === 'inactive').length;
        const operationalSeats = Math.max(0, totalCapacity - maintenanceCount);
        const occupancyPercentage = operationalSeats > 0 ? Math.round((occupiedCount / operationalSeats) * 100) : 0;

        return {
          success: true,
          seats: seats.map(s => ({
            seatId: s.seat_id,
            seatNumber: s.seat_number,
            seatType: s.seat_type,
            hasPower: s.has_power_socket,
            isAccessible: s.is_accessible,
            operationalStatus: s.status,
            displayStatus: s.status,
            stateLabel: s.status.charAt(0).toUpperCase() + s.status.slice(1),
            colorClass: s.color,
            maintenanceInfo: s.maintenance,
            booking: s.booking
          })),
          totalCapacity,
          availableCount,
          reservedCount,
          occupiedCount,
          maintenanceCount,
          occupancyPercentage,
          colorThreshold: this.getOccupancyColorClass(occupancyPercentage)
        };
      }
    } catch (err) {
      console.warn('[occupancyService] RPC snapshot error, using fallback:', err.message);
    }

    // Fallback if RPC is initializing
    const seats = defaultSeats;
    const mergedSeats = seats.map(s => ({
      seatId: s.id,
      seatNumber: s.seatNumber,
      operationalStatus: 'active',
      displayStatus: 'available',
      stateLabel: 'Available',
      colorClass: '#22C55E',
      booking: null
    }));

    return {
      success: true,
      seats: mergedSeats,
      totalCapacity: 40,
      availableCount: 40,
      reservedCount: 0,
      occupiedCount: 0,
      maintenanceCount: 0,
      occupancyPercentage: 0,
      colorThreshold: 'green'
    };
  },

  getOccupancyColorClass(pct) {
    if (pct >= 85) return 'red';
    if (pct >= 60) return 'amber';
    return 'green';
  }
};
