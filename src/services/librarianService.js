import { supabase, isUUID } from '../lib/supabase.js';
import { db } from './mockDatabase.js';
import { bookingService } from './bookingService.js';
import { waitlistService } from './waitlistService.js';
import { slotService } from './slotService.js';
import { getTodayKolkataDate } from './occupancyService.js';

export const librarianService = {
  // 1. DASHBOARD METRICS
  async getDashboardMetrics(dateStr = getTodayKolkataDate()) {
    try {
      const [{ data: bookings }, { data: seats }, { data: waitlist }, { data: users }, { data: maintenance }] = await Promise.all([
        supabase.from('bookings').select('*').eq('booking_date', dateStr),
        supabase.from('seats').select('*'),
        supabase.from('waitlist_entries').select('*').eq('booking_date', dateStr).eq('status', 'waiting'),
        supabase.from('profiles').select('*').eq('role', 'student'),
        supabase.from('seat_maintenance').select('*').neq('status', 'Resolved')
      ]);

      if (seats) {
        const bList = bookings || [];
        const sList = seats || [];
        const wList = waitlist || [];
        const uList = users || [];
        const mntList = maintenance || [];

        const todayBookings = bList.filter(b => !['cancelled', 'slot_cancelled'].includes(b.status));
        const checkedInCount = todayBookings.filter(b => b.status === 'checked_in').length;
        const reservedCount = todayBookings.filter(b => ['confirmed', 'awaiting_check_in'].includes(b.status)).length;
        const occupiedSeatsCount = checkedInCount;
        const maintenanceSeatsCount = sList.filter(s => s.status === 'maintenance' || mntList.some(m => m.seat_id === s.id)).length;
        const totalSeats = sList.length || 40;
        const availableSeatsCount = Math.max(0, totalSeats - occupiedSeatsCount - reservedCount - maintenanceSeatsCount);
        const occupancyPercentage = totalSeats > 0 ? Math.round((occupiedSeatsCount / totalSeats) * 100) : 0;

        const waitingCount = wList.length;
        const noShowsCount = uList.reduce((sum, u) => sum + (u.no_show_count || 0), 0);

        return {
          occupiedSeatsCount,
          reservedCount,
          availableSeatsCount,
          totalSeats,
          todayBookingsCount: todayBookings.length,
          checkedInCount,
          waitingCount,
          noShowsCount,
          maintenanceSeatsCount,
          occupancyPercentage,
          recentCheckins: [],
          upcomingReservations: todayBookings.slice(0, 5),
          seatsNeedingAttention: sList.filter(s => s.status === 'maintenance')
        };
      }
    } catch { /* fallback */ }

    // Fallback
    const [bookings, seats, waitlist, users, checkins, maintenance] = await Promise.all([
      db.read('seatsync_bookings') || [],
      db.read('seatsync_seats') || [],
      db.read('seatsync_waitlist') || [],
      db.read('seatsync_users') || [],
      db.read('seatsync_checkins') || [],
      db.read('seatsync_maintenance') || []
    ]);

    const bList = bookings || [];
    const sList = seats || [];
    const wList = waitlist || [];
    const uList = users || [];

    const todayBookings = bList.filter(b => b.bookingDate === dateStr && b.status !== 'CANCELLED_BY_ADMIN' && b.status !== 'cancelled');
    const checkedInCount = todayBookings.filter(b => b.status === 'active' || b.status === 'checked_in').length;
    const reservedCount = todayBookings.filter(b => b.status === 'confirmed').length;
    const occupiedSeatsCount = checkedInCount;
    const maintenanceSeatsCount = sList.filter(s => s.status === 'maintenance').length;
    const totalSeats = sList.length || 40;
    const availableSeatsCount = Math.max(0, totalSeats - occupiedSeatsCount - reservedCount - maintenanceSeatsCount);
    const occupancyPercentage = totalSeats > 0 ? Math.round((occupiedSeatsCount / totalSeats) * 100) : 0;

    const waitingCount = wList.filter(w => w.dateStr === dateStr && (w.status || '').toLowerCase() === 'waiting').length;
    const students = uList.filter(u => u.role === 'STUDENT');
    const noShowsCount = students.reduce((sum, u) => sum + (u.noShowCount || 0), 0);

    return {
      occupiedSeatsCount,
      reservedCount,
      availableSeatsCount,
      totalSeats,
      todayBookingsCount: todayBookings.length,
      checkedInCount,
      waitingCount,
      noShowsCount,
      maintenanceSeatsCount,
      occupancyPercentage,
      recentCheckins: [],
      upcomingReservations: todayBookings.slice(0, 5),
      seatsNeedingAttention: sList.filter(s => s.status === 'maintenance')
    };
  },

  // 2. OPERATIONAL BOOKINGS FOR STAFF (DIRECT SUPABASE FETCH)
  async getOperationalBookings(libraryId = null, bookingDate = null, slotId = null) {
    try {
      const validDate = (bookingDate && String(bookingDate).match(/^\d{4}-\d{2}-\d{2}$/)) ? bookingDate : null;
      const validLibId = (libraryId && isUUID(libraryId)) ? libraryId : null;
      const validSlotId = (slotId && isUUID(slotId)) ? slotId : null;

      const rpcPayload = {};
      if (validLibId) rpcPayload.p_library_id = validLibId;
      if (validDate) rpcPayload.p_booking_date = validDate;
      if (validSlotId) rpcPayload.p_slot_id = validSlotId;

      const { data: rpcData, error: rpcError } = await supabase.rpc('get_operational_bookings', rpcPayload);

      if (!rpcError && rpcData && rpcData.length > 0) {
        return rpcData.map(b => ({
          id: b.id,
          bookingCode: b.booking_code,
          studentId: b.student_id,
          studentName: b.student_name,
          studentRegistrationNumber: b.student_registration_number,
          studentEmail: b.student_email,
          libraryId: b.library_id,
          libraryName: b.library_name,
          roomId: b.room_id,
          roomName: b.room_name,
          seatId: b.seat_id,
          seatNumber: b.seat_number,
          slotId: b.slot_id,
          slotName: b.slot_name,
          slotTime: b.start_time ? `${b.start_time} – ${b.end_time}` : 'Slot',
          bookingDate: b.booking_date,
          bookingSource: b.booking_source || 'online',
          status: b.status,
          createdAt: b.created_at,
          checkedInAt: b.checked_in_at,
          checkedOutAt: b.checked_out_at
        }));
      }

      // Step 2: Direct PostgreSQL Table Select from public.bookings
      let query = supabase
        .from('bookings')
        .select('*')
        .order('created_at', { ascending: false });

      if (libraryId && isUUID(libraryId)) query = query.eq('library_id', libraryId);
      if (bookingDate) query = query.eq('booking_date', bookingDate);
      if (slotId && isUUID(slotId)) query = query.eq('slot_id', slotId);

      const { data: dbData, error: dbErr } = await query;

      if (!dbErr && dbData && dbData.length > 0) {
        // Resolve student profiles and seat numbers in bulk
        const studentIds = [...new Set(dbData.map(b => b.student_id).filter(Boolean))];
        const seatIds = [...new Set(dbData.map(b => b.seat_id).filter(Boolean))];
        const slotIds = [...new Set(dbData.map(b => b.slot_id).filter(Boolean))];

        const [profRes, seatRes, slotRes] = await Promise.all([
          studentIds.length > 0 ? supabase.from('profiles').select('id, full_name, registration_number, email').in('id', studentIds) : { data: [] },
          seatIds.length > 0 ? supabase.from('seats').select('id, seat_number').in('id', seatIds) : { data: [] },
          slotIds.length > 0 ? supabase.from('slots').select('id, name, start_time, end_time').in('id', slotIds) : { data: [] }
        ]);

        const profMap = new Map((profRes.data || []).map(p => [p.id, p]));
        const seatMap = new Map((seatRes.data || []).map(s => [s.id, s.seat_number]));
        const slotMap = new Map((slotRes.data || []).map(sl => [sl.id, sl]));

        return dbData.map(b => {
          const prof = profMap.get(b.student_id);
          const seatNum = seatMap.get(b.seat_id);
          const slotObj = slotMap.get(b.slot_id);

          return {
            id: b.id,
            bookingCode: b.booking_code || b.id,
            studentId: b.student_id,
            studentName: prof?.full_name || 'Student',
            studentRegistrationNumber: prof?.registration_number || '24AD042',
            studentEmail: prof?.email || '',
            libraryId: b.library_id,
            roomId: b.room_id,
            seatId: b.seat_id,
            seatNumber: seatNum || 'S-01',
            slotId: b.slot_id,
            slotName: slotObj?.name || 'Slot',
            slotTime: slotObj?.start_time ? `${slotObj.start_time} – ${slotObj.end_time}` : 'Slot',
            bookingDate: b.booking_date,
            bookingSource: b.booking_source || 'online',
            status: b.status,
            createdAt: b.created_at,
            checkedInAt: b.checked_in_at,
            checkedOutAt: b.checked_out_at
          };
        });
      }
    } catch { /* fallback */ }

    const local = (await db.read('seatsync_bookings')) || [];
    return local
      .filter(b => 
        (!bookingDate || b.bookingDate === bookingDate || b.booking_date === bookingDate) &&
        (!slotId || b.slotId === slotId || b.slot_id === slotId)
      )
      .map(b => ({
        ...b,
        studentRegistrationNumber: b.studentRegistrationNumber || b.student_registration_number || b.collegeId || '24AD042',
        collegeId: b.collegeId || b.studentRegistrationNumber || b.student_registration_number || '24AD042'
      }));
  },

  async getStaffBookings(libraryId = null, bookingDate = null, slotId = null) {
    return this.getOperationalBookings(libraryId, bookingDate, slotId);
  },

  // 3. GET LIBRARIAN SLOT SNAPSHOT
  async getLibrarianSlotSnapshot(libraryId = null, roomId = null, bookingDate = null, slotId = null) {
    try {
      const { data, error } = await supabase.rpc('get_librarian_slot_snapshot', {
        p_library_id: libraryId && isUUID(libraryId) ? libraryId : null,
        p_room_id: roomId && isUUID(roomId) ? roomId : null,
        p_booking_date: bookingDate || null,
        p_slot_id: slotId && isUUID(slotId) ? slotId : null
      });

      if (!error && data) {
        return data.map(s => ({
          id: s.seat_id,
          seatId: s.seat_id,
          seatNumber: s.seat_number,
          allocationMode: s.allocation_mode,
          status_state: s.computed_state,
          ui_status: s.computed_state === 'reserved' ? 'Reserved' : s.computed_state === 'occupied' ? 'Occupied' : s.computed_state === 'held' ? 'Held' : s.computed_state === 'maintenance' ? 'Maintenance' : 'Available',
          powerOutlet: s.power_outlet,
          nearWindow: s.near_window,
          booking: s.booking_id ? {
            id: s.booking_id,
            bookingCode: s.booking_code,
            status: s.booking_status,
            bookingSource: s.booking_source,
            studentId: s.student_id,
            studentName: s.student_name,
            studentRegistrationNumber: s.student_registration_number,
            studentEmail: s.student_email,
            slotId: s.slot_id,
            slotName: s.slot_name,
            slotTime: s.start_time ? `${s.start_time} – ${s.end_time}` : 'Slot',
            bookingDate: s.booking_date,
            createdAt: s.created_at,
            checkedInAt: s.checked_in_at,
            checkedOutAt: s.checked_out_at
          } : null
        }));
      }
    } catch { /* fallback */ }

    const localBookings = (await db.read('seatsync_bookings')) || [];
    const rawSeats = (await db.read('seatsync_seats')) || [];
    const localSeats = rawSeats.length > 0 ? rawSeats : Array.from({ length: 40 }, (_, i) => ({
      id: `SEAT-${String(i + 1).padStart(2, '0')}`,
      seatNumber: `S-${String(i + 1).padStart(2, '0')}`,
      allocationMode: 'online',
      status: 'available'
    }));

    return localSeats.map(s => {
      const activeBooking = localBookings.find(b =>
        (b.seatId === s.id || b.seatNumber === s.seatNumber || b.seat_number === s.seatNumber) &&
        (!bookingDate || b.bookingDate === bookingDate || b.booking_date === bookingDate) &&
        (!slotId || b.slotId === slotId || b.slot_id === slotId) &&
        ['confirmed', 'active', 'checked_in', 'awaiting_check_in'].includes(b.status)
      );

      const state = activeBooking
        ? (activeBooking.status === 'checked_in' || activeBooking.status === 'active' ? 'occupied' : 'reserved')
        : (s.status === 'maintenance' ? 'maintenance' : 'available');

      return {
        id: s.id,
        seatId: s.id,
        seatNumber: s.seatNumber,
        allocationMode: s.allocationMode || 'online',
        status_state: state,
        ui_status: state === 'reserved' ? 'Reserved' : state === 'occupied' ? 'Occupied' : state === 'maintenance' ? 'Maintenance' : 'Available',
        powerOutlet: s.powerOutlet || false,
        nearWindow: s.nearWindow || false,
        booking: activeBooking ? {
          id: activeBooking.id,
          bookingCode: activeBooking.booking_code || activeBooking.id,
          status: activeBooking.status,
          bookingSource: activeBooking.bookingSource || 'online',
          studentId: activeBooking.studentId,
          studentName: activeBooking.studentName,
          studentRegistrationNumber: activeBooking.collegeId || activeBooking.registrationNumber || '24AD042',
          studentEmail: activeBooking.studentEmail,
          slotId: activeBooking.slotId,
          slotName: activeBooking.slotName || 'Slot',
          slotTime: activeBooking.slotTime,
          bookingDate: activeBooking.bookingDate,
          createdAt: activeBooking.createdAt
        } : null
      };
    });
  },

  // 3B. LIVE OCCUPANCY SNAPSHOT (REAL SUPABASE DATA)
  async getLiveOccupancySnapshot(libraryId = null, floorId = null, roomId = null, slotId = null, bookingDate = null) {
    try {
      const { data, error } = await supabase.rpc('get_live_occupancy_snapshot', {
        p_library_id: libraryId && isUUID(libraryId) ? libraryId : null,
        p_floor_id: floorId && isUUID(floorId) ? floorId : null,
        p_room_id: roomId && isUUID(roomId) ? roomId : null,
        p_slot_id: slotId && isUUID(slotId) ? slotId : null,
        p_booking_date: bookingDate || null
      });

      if (!error && data) return data;
    } catch { /* fallback */ }

    // Fallback computed snapshot
    const metrics = await this.getDashboardMetrics(bookingDate || getTodayKolkataDate());
    return {
      library_id: libraryId,
      slot_id: slotId,
      slot_name: 'Current Slot',
      slot_active: true,
      booking_date: bookingDate || getTodayKolkataDate(),
      total_seats: metrics.totalSeats,
      operational_seats: metrics.totalSeats - metrics.maintenanceSeatsCount,
      occupied_seats: metrics.occupiedSeatsCount,
      reserved_seats: metrics.reservedCount,
      available_seats: metrics.availableSeatsCount,
      maintenance_seats: metrics.maintenanceSeatsCount,
      awaiting_check_in: metrics.reservedCount,
      checked_in_count: metrics.occupiedSeatsCount,
      occupancy_percentage: metrics.occupancyPercentage,
      floors: [],
      timestamp: new Date().toISOString()
    };
  },

  // 3C. GET CURRENT OCCUPANTS (REAL SUPABASE DATA)
  async getCurrentOccupants(libraryId = null, floorId = null, roomId = null, slotId = null, bookingDate = null) {
    try {
      const { data, error } = await supabase.rpc('get_current_occupants', {
        p_library_id: libraryId && isUUID(libraryId) ? libraryId : null,
        p_floor_id: floorId && isUUID(floorId) ? floorId : null,
        p_room_id: roomId && isUUID(roomId) ? roomId : null,
        p_slot_id: slotId && isUUID(slotId) ? slotId : null,
        p_booking_date: bookingDate || null
      });

      if (!error && data) {
        return data.map(o => ({
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
    } catch { /* fallback */ }

    const localBookings = (await db.read('seatsync_bookings')) || [];
    return localBookings
      .filter(b => b.status === 'checked_in' || b.status === 'active')
      .map(b => ({
        bookingId: b.id,
        bookingCode: b.bookingCode || b.booking_code || b.id,
        studentId: b.studentId || b.student_id,
        studentName: b.studentName || b.student_name || 'Student',
        registrationNumber: b.studentRegistrationNumber || b.collegeId || '24AD042',
        seatId: b.seatId || b.seat_id,
        seatNumber: b.seatNumber || b.seat_number || 'S-01',
        roomName: 'Main Quiet Reading Hall',
        floorName: 'Ground Floor',
        slotName: 'Morning Slot 1',
        checkedInAt: b.checkedInAt || b.checked_in_at || new Date().toISOString(),
        timeOccupiedMinutes: 45
      }));
  },

  // 4. LOOKUP BOOKING BY ID OR CODE (SUPABASE RPC)
  async lookupBookingById(identifier, libraryId = null) {
    if (!identifier || !identifier.trim()) {
      return { success: false, message: 'Please enter a Booking ID or code.', is_eligible: false };
    }

    try {
      const { data, error } = await supabase.rpc('lookup_booking_by_identifier', {
        p_identifier: identifier.trim(),
        p_librarian_library_id: libraryId && isUUID(libraryId) ? libraryId : null
      });

      if (!error && data) {
        return {
          success: Boolean(data.success),
          statusCode: data.status_code || 'UNKNOWN',
          message: data.message || '',
          isEligible: Boolean(data.is_eligible),
          eligibilityCode: data.eligibility_code,
          eligibilityMessage: data.eligibility_message,
          booking: data.booking ? {
            id: data.booking.id,
            bookingCode: data.booking.booking_code,
            studentId: data.booking.student_id,
            studentName: data.booking.student_name,
            studentRegistrationNumber: data.booking.registration_number,
            department: data.booking.department,
            avatarUrl: data.booking.avatar_url,
            seatId: data.booking.seat_id,
            seatNumber: data.booking.seat_number,
            roomName: data.booking.room_name,
            floorName: data.booking.floor_name,
            libraryName: data.booking.library_name,
            libraryId: data.booking.library_id,
            slotName: data.booking.slot_name,
            slotTime: data.booking.slot_time,
            startTime: data.booking.start_time,
            endTime: data.booking.end_time,
            bookingDate: data.booking.booking_date,
            status: data.booking.status,
            checkedInAt: data.booking.checked_in_at
          } : null
        };
      }
    } catch (err) {
      console.warn('[librarianService] lookupBookingById error:', err.message);
    }

    return {
      success: false,
      statusCode: 'BOOKING_NOT_FOUND',
      message: 'Booking not found',
      isEligible: false
    };
  },

  // 4B. LOOKUP BOOKINGS BY REGISTER NUMBER / COLLEGE ID (SUPABASE RPC)
  async lookupBookingsByRegisterNumber(registerNumber, libraryId = null) {
    if (!registerNumber || !registerNumber.trim()) {
      return { success: false, statusCode: 'MISSING_REGISTER_NUMBER', message: 'Please enter a student register number.', matches: [] };
    }

    try {
      const { data, error } = await supabase.rpc('lookup_bookings_by_register_number', {
        p_register_number: registerNumber.trim(),
        p_librarian_library_id: libraryId && isUUID(libraryId) ? libraryId : null
      });

      if (!error && data) {
        return {
          success: Boolean(data.success),
          statusCode: data.status_code || 'UNKNOWN',
          message: data.message || '',
          matches: (data.matches || []).map(m => ({
            id: m.id,
            bookingCode: m.booking_code,
            studentId: m.student_id,
            studentName: m.student_name,
            studentRegistrationNumber: m.registration_number,
            department: m.department,
            avatarUrl: m.avatar_url,
            seatId: m.seat_id,
            seatNumber: m.seat_number,
            roomName: m.room_name,
            floorName: m.floor_name,
            libraryName: m.library_name,
            libraryId: m.library_id,
            slotName: m.slot_name,
            slotTime: m.slot_time,
            startTime: m.start_time,
            endTime: m.end_time,
            bookingDate: m.booking_date,
            status: m.status,
            checkedInAt: m.checked_in_at,
            isEligible: Boolean(m.is_eligible),
            eligibilityCode: m.eligibility_code,
            eligibilityMessage: m.eligibility_message
          }))
        };
      }
    } catch (err) {
      console.warn('[librarianService] lookupBookingsByRegisterNumber error:', err.message);
    }

    return {
      success: false,
      statusCode: 'STUDENT_NOT_FOUND',
      message: 'Student register number not found',
      matches: []
    };
  },

  // 4C. SECURE ENTRY QR SCANNING & LOOKUP ENGINE
  async getCheckInHistory(limit = 20) {
    try {
      const { data, error } = await supabase
        .from('check_in_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (!error && data) {
        // Resolve booking codes and student names from related tables
        const bookingIds = [...new Set(data.filter(l => l.booking_id).map(l => l.booking_id))];
        const studentIds = [...new Set(data.filter(l => l.student_id).map(l => l.student_id))];

        let bookingMap = new Map();
        let studentMap = new Map();
        let seatMap = new Map();

        if (bookingIds.length > 0) {
          try {
            const { data: bookingsData } = await supabase.from('bookings').select('id, booking_code, seat_id').in('id', bookingIds);
            if (bookingsData) {
              bookingsData.forEach(b => bookingMap.set(b.id, b));
              const seatIds = [...new Set(bookingsData.filter(b => b.seat_id).map(b => b.seat_id))];
              if (seatIds.length > 0) {
                const { data: seatsData } = await supabase.from('seats').select('id, seat_number').in('id', seatIds);
                if (seatsData) seatsData.forEach(s => seatMap.set(s.id, s.seat_number));
              }
            }
          } catch { /* proceed */ }
        }

        if (studentIds.length > 0) {
          try {
            const { data: studentsData } = await supabase.from('profiles').select('id, full_name').in('id', studentIds);
            if (studentsData) studentsData.forEach(s => studentMap.set(s.id, s.full_name));
          } catch { /* proceed */ }
        }

        return data.map(l => {
          const booking = bookingMap.get(l.booking_id);
          return {
            id: l.id,
            bookingCode: booking?.booking_code || l.booking_id || 'BK-001',
            studentName: studentMap.get(l.student_id) || 'Student',
            seatNumber: (booking?.seat_id && seatMap.get(booking.seat_id)) || 'A-101',
            action: l.action || 'CHECK_IN',
            timestamp: l.created_at
          };
        });
      }
    } catch { /* proceed to local DB fallback */ }

    const localLogs = (await db.read('seatsync_checkins')) || [];
    return localLogs.slice(0, limit);
  },

  async scanEntryQr(scannedValue, libraryId = null) {
    const { parseEntryQrPayload } = await import('../utils/qrPayload.js');
    let token = null;

    try {
      token = parseEntryQrPayload(scannedValue);
    } catch (err) {
      return {
        valid: false,
        statusCode: (err.message || 'INVALID_QR_FORMAT').toUpperCase(),
        message: err.message === 'UNSUPPORTED_QR_VERSION'
          ? 'Unsupported QR Pass version.'
          : err.message === 'MISSING_QR_TOKEN'
          ? 'Missing QR token.'
          : 'QR code is invalid or does not contain a booking reference'
      };
    }

    const lookupRes = await this.lookupBookingById(token, libraryId);
    if (!lookupRes.success || !lookupRes.booking) {
      return {
        valid: false,
        statusCode: lookupRes.statusCode || 'BOOKING_NOT_FOUND',
        message: lookupRes.message || 'Booking not found'
      };
    }

    return {
      valid: lookupRes.isEligible,
      statusCode: lookupRes.eligibilityCode || 'SUCCESS',
      message: lookupRes.eligibilityMessage || 'Booking pass found.',
      booking: lookupRes.booking,
      scannedPayload: scannedValue
    };
  },

  // 5. SECURE ATOMIC CHECK-IN RPC
  async checkInBooking({ bookingId, method = 'manual', scannedPayload = null }) {
    if (!bookingId || !isUUID(bookingId)) {
      return { success: false, statusCode: 'INVALID_BOOKING_ID', message: 'Valid booking ID required.' };
    }

    try {
      const { data, error } = await supabase.rpc('check_in_booking', {
        p_booking_id: bookingId,
        p_method: method,
        p_scanned_payload: scannedPayload
      });

      if (error) {
        console.error('[librarianService] check_in_booking RPC error:', error);
        return {
          success: false,
          statusCode: 'DATABASE_ERROR',
          message: `Database verification failed (${error.message || 'RPC Error'}).`
        };
      }

      if (data) {
        return {
          success: Boolean(data.success),
          alreadyCheckedIn: Boolean(data.already_checked_in),
          statusCode: (data.status_code || 'UNKNOWN').toUpperCase(),
          message: data.message || 'Check-in processed.',
          booking: data.booking ? {
            id: data.booking.id,
            bookingCode: data.booking.booking_code,
            studentId: data.booking.student_id,
            studentName: data.booking.student_name,
            studentRegistrationNumber: data.booking.registration_number,
            department: data.booking.department,
            seatNumber: data.booking.seat_number,
            floorName: data.booking.floor_name,
            roomName: data.booking.room_name,
            libraryName: data.booking.library_name,
            slotName: data.booking.slot_name,
            slotTime: data.booking.slot_time,
            bookingDate: data.booking.booking_date,
            status: 'checked_in',
            checkedInAt: data.booking.checked_in_at
          } : null
        };
      }
    } catch (err) {
      console.error('[librarianService] checkInBooking exception:', err);
      return {
        success: false,
        statusCode: 'DATABASE_ERROR',
        message: err.message || 'Database verification failed'
      };
    }

    return { success: false, statusCode: 'CHECKIN_FAILED', message: 'Check-in failed.' };
  },

  async processCheckIn(bookingId, staffUser, method = 'manual') {
    return this.checkInBooking({ bookingId, method });
  },

  // 6. ATOMIC CHECK-OUT RPC
  async checkOutBooking({ bookingId, method = 'manual', overrideReason = null }) {
    if (isUUID(bookingId)) {
      try {
        const { data, error } = await supabase.rpc('check_out_booking', {
          p_booking_id: bookingId,
          p_method: method
        });

        if (!error && data) {
          if (!data.success) {
            throw new Error(data.message || 'Checkout failed.');
          }
          return {
            success: true,
            statusCode: (data.status_code || 'SUCCESS').toUpperCase(),
            message: data.message || 'Checkout completed.',
            booking: {
              id: data.booking_id || bookingId,
              bookingCode: data.booking_code,
              studentName: data.student_name || 'Student',
              seatNumber: data.seat_number || 'S-01',
              status: 'completed',
              checkedOutAt: data.checked_out_at
            }
          };
        }
      } catch (err) {
        console.warn('[librarianService] checkOutBooking RPC notice:', err.message);
      }

      // Direct Table Fallback if RPC call failed
      try {
        const { data: staffUser } = await supabase.auth.getUser();
        const staffId = staffUser?.user?.id || null;

        const { data: updated, error: uErr } = await supabase
          .from('bookings')
          .update({
            status: 'completed',
            checked_out_at: new Date().toISOString(),
            checked_out_by: staffId,
            updated_at: new Date().toISOString()
          })
          .eq('id', bookingId)
          .select('*')
          .single();

        if (!uErr && updated) {
          // Resolve student name and seat number separately
          let resolvedStudentName = 'Student';
          let resolvedSeatNumber = 'S-01';
          if (updated.student_id) {
            try {
              const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', updated.student_id).maybeSingle();
              if (prof) resolvedStudentName = prof.full_name;
            } catch { /* proceed */ }
          }
          if (updated.seat_id) {
            try {
              const { data: seat } = await supabase.from('seats').select('seat_number').eq('id', updated.seat_id).maybeSingle();
              if (seat) resolvedSeatNumber = seat.seat_number;
            } catch { /* proceed */ }
          }

          await supabase.from('check_in_logs').insert({
            booking_id: updated.id,
            student_id: updated.student_id,
            librarian_id: staffId,
            seat_id: updated.seat_id,
            library_id: updated.library_id,
            slot_id: updated.slot_id,
            action: 'checkout',
            method: method || 'qr',
            checkout_method: method || 'qr',
            notes: 'Seat Released & Checkout Completed',
            created_at: new Date().toISOString()
          }).catch(() => {});

          return {
            success: true,
            statusCode: 'SUCCESS',
            message: `Checkout completed for ${resolvedStudentName}! Seat ${resolvedSeatNumber} released.`,
            booking: {
              id: updated.id,
              bookingCode: updated.booking_code,
              studentName: resolvedStudentName,
              seatNumber: resolvedSeatNumber,
              status: 'completed',
              checkedOutAt: updated.checked_out_at
            }
          };
        }
      } catch (err) {
        console.warn('[librarianService] Direct update fallback notice:', err.message);
      }
    }

    const bookings = (await db.read('seatsync_bookings')) || [];
    const target = bookings.find(b => String(b.id) === String(bookingId));
    if (!target) throw new Error('Booking record not found.');

    target.status = 'completed';
    target.checkedOutAt = new Date().toISOString();
    await db.write('seatsync_bookings', bookings);
    return {
      success: true,
      statusCode: 'SUCCESS',
      message: `Checkout completed for ${target.studentName || 'Student'}! Seat ${target.seatNumber || 'assigned'} released.`,
      booking: target
    };
  },

  // 6B. SECURE CHECKOUT QR SCAN ENGINE
  async scanCheckoutQr(scannedValue) {
    const { parseCheckoutQrPayload } = await import('../utils/qrPayload.js');
    let checkoutToken = null;

    try {
      checkoutToken = parseCheckoutQrPayload(scannedValue);
    } catch (err) {
      if (err.message === 'NOT_CHECKOUT_PASS') {
        try {
          const { parseEntryQrPayload } = await import('../utils/qrPayload.js');
          checkoutToken = parseEntryQrPayload(scannedValue);
        } catch {
          return {
            success: false,
            statusCode: 'NOT_CHECKOUT_PASS',
            message: 'This QR code is an entry pass, not a checkout pass.'
          };
        }
      } else {
        return {
          success: false,
          statusCode: (err.message || 'INVALID_CHECKOUT_QR').toUpperCase(),
          message: 'Invalid checkout QR code or token not recognized.'
        };
      }
    }

    const tokenToVerify = checkoutToken || String(scannedValue || '').trim();

    // Call Supabase Atomic Verification & Checkout RPC
    try {
      const { data, error } = await supabase.rpc('verify_and_checkout_booking', {
        p_checkout_token: tokenToVerify
      });

      if (error) {
        console.warn('[librarianService] verify_and_checkout_booking RPC error:', error.message || error);
      } else if (data) {
        if (!data.success) {
          return {
            success: false,
            statusCode: (data.status_code || 'CHECKOUT_FAILED').toUpperCase(),
            message: data.message || 'Checkout verification failed.'
          };
        }

        const b = data.booking;
        return {
          success: true,
          statusCode: 'SUCCESS',
          message: data.message || `Checkout verified and seat ${b?.seat_number || ''} released!`,
          booking: {
            id: b.id,
            bookingCode: b.booking_code,
            studentId: b.student_id,
            studentName: b.student_name,
            studentRegistrationNumber: b.student_registration_number,
            seatNumber: b.seat_number,
            roomName: b.room_name,
            floorName: b.floor_name,
            libraryName: b.library_name,
            slotName: b.slot_name,
            slotTime: b.slot_time,
            bookingDate: b.booking_date,
            status: b.status || 'completed',
            checkedOutAt: b.checked_out_at
          }
        };
      }
    } catch (err) {
      console.warn('[librarianService] verify_and_checkout_booking RPC notice:', err.message);
    }

    // Local / Dev Fallback if verify_and_checkout_booking RPC fails or is unavailable
    let pass = null;
    if (typeof localStorage !== 'undefined') {
      try {
        const stored = localStorage.getItem('seatsync_active_checkout_pass');
        if (stored) pass = JSON.parse(stored);
      } catch { /* ignore */ }
    }

    let targetBookingId = null;
    let studentName = 'Student';
    let seatNumber = 'S-01';

    if (pass && (pass.token === tokenToVerify || tokenToVerify.includes(pass.bookingId) || pass.bookingId === tokenToVerify)) {
      if (new Date(pass.expiresAt) <= new Date()) {
        return { success: false, statusCode: 'TOKEN_EXPIRED', message: 'Checkout QR has expired. Please ask the student to request a new one.' };
      }
      targetBookingId = pass.bookingId;
      studentName = pass.studentName || 'Student';
      seatNumber = pass.seatNumber || 'S-01';
    } else {
      // Query Supabase directly for matching booking by ID, code, or qr_token
      try {
        let query = supabase.from('bookings').select('*');
        if (isUUID(tokenToVerify)) {
          query = query.eq('id', tokenToVerify);
        } else {
          query = query.or(`booking_code.eq."${tokenToVerify}",qr_token.eq."${tokenToVerify}"`);
        }
        const { data: matchedBookings } = await query.limit(1);
        if (matchedBookings && matchedBookings.length > 0) {
          const mb = matchedBookings[0];
          targetBookingId = mb.id;

          // Resolve student name
          if (mb.student_id) {
            try {
              const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', mb.student_id).maybeSingle();
              if (prof) studentName = prof.full_name;
            } catch { /* proceed */ }
          }
          // Resolve seat number
          if (mb.seat_id) {
            try {
              const { data: seat } = await supabase.from('seats').select('seat_number').eq('id', mb.seat_id).maybeSingle();
              if (seat) seatNumber = seat.seat_number;
            } catch { /* proceed */ }
          }

          if (['completed', 'checked_out'].includes(mb.status)) {
            return {
              success: false,
              statusCode: 'STUDENT_ALREADY_CHECKED_OUT',
              message: 'Student is already checked out of this booking.'
            };
          }
          if (mb.status !== 'checked_in') {
            return {
              success: false,
              statusCode: 'STUDENT_NOT_CHECKED_IN',
              message: 'Booking is not currently in checked-in status.'
            };
          }
        }
      } catch { /* ignore and proceed */ }
    }

    if (targetBookingId) {
      try {
        const checkOutRes = await this.checkOutBooking({ bookingId: targetBookingId, method: 'qr' });
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem('seatsync_active_checkout_pass');
        }
        return {
          success: true,
          statusCode: 'SUCCESS',
          message: `Checkout verified for ${checkOutRes.booking?.studentName || studentName}! Seat ${checkOutRes.booking?.seatNumber || seatNumber} released.`,
          booking: checkOutRes.booking || {
            id: targetBookingId,
            studentName,
            seatNumber,
            status: 'completed',
            checkedOutAt: new Date().toISOString()
          }
        };
      } catch (err) {
        const msg = err.message || 'Checkout verification failed.';
        let code = 'CHECKOUT_FAILED';
        if (msg.includes('already')) code = 'STUDENT_ALREADY_CHECKED_OUT';
        if (msg.includes('not checked in')) code = 'STUDENT_NOT_CHECKED_IN';
        return { success: false, statusCode: code, message: msg };
      }
    }

    return {
      success: false,
      statusCode: 'INVALID_CHECKOUT_QR',
      message: 'Invalid checkout QR code or token not recognized.'
    };
  },


  // 5. WALK-IN SEAT ALLOCATION
  async createWalkInBooking({ student, seat, slot, dateStr, staffUser, autoCheckIn = true }) {
    const newBooking = await bookingService.createBooking(student, dateStr, slot, seat.floorId, seat.id);
    if (autoCheckIn && newBooking) {
      await this.processCheckIn(newBooking.id, staffUser, 'Walk-In Auto Check-In');
    }
    return newBooking;
  },

  // 6. SEAT TRANSFER
  async transferSeat({ bookingId, newSeat, staffUser, reason }) {
    const bookings = (await db.read('seatsync_bookings')) || [];
    const target = bookings.find(b => String(b.id) === String(bookingId));
    if (!target) throw new Error('Booking record not found.');

    target.seatId = newSeat.id;
    target.seatNumber = newSeat.seatNumber;
    await db.write('seatsync_bookings', bookings);
    return target;
  },

  // 7. SEAT INVENTORY & MAINTENANCE ENGINE (RPC)
  async getSeatInventory({ libraryId = null, floorId = null, roomId = null, search = null, maintenanceStatus = null } = {}) {
    try {
      const { data, error } = await supabase.rpc('get_seat_inventory', {
        p_library_id: libraryId && isUUID(libraryId) ? libraryId : null,
        p_floor_id: floorId && isUUID(floorId) ? floorId : null,
        p_room_id: roomId && isUUID(roomId) ? roomId : null,
        p_search: search && search.trim() ? search.trim() : null,
        p_maintenance_status: maintenanceStatus && maintenanceStatus.trim() ? maintenanceStatus.trim() : null
      });

      if (error) {
        console.error('[librarianService] get_seat_inventory error:', error);
        throw error;
      }

      return (data || []).map(s => ({
        id: s.seat_id,
        seatNumber: s.seat_number,
        type: s.seat_type,
        libraryId: s.library_id,
        libraryName: s.library_name,
        floorId: s.floor_id,
        floorName: s.floor_name,
        roomId: s.room_id,
        roomName: s.room_name,
        hasPowerSocket: Boolean(s.has_power_outlet),
        isAccessible: Boolean(s.is_accessible),
        isActive: Boolean(s.seat_is_active),
        operationalStatus: s.operational_status, // 'available' | 'maintenance' | 'inactive'
        maintenanceId: s.maintenance_id,
        maintenanceStatus: s.maintenance_status, // 'reported' | 'in_progress' | 'resolved'
        issueType: s.issue_type,
        description: s.issue_description,
        severity: s.severity, // 'low' | 'medium' | 'high' | 'critical'
        reportedAt: s.reported_at,
        reportedBy: s.reported_by,
        reportedByName: s.reported_by_name || 'Staff Librarian',
        assignedTo: s.assigned_to,
        assignedToName: s.assigned_to_name,
        expectedResolutionAt: s.expected_resolution_at,
        resolvedAt: s.resolved_at,
        resolutionNotes: s.resolution_notes
      }));
    } catch (err) {
      console.warn('[librarianService] getSeatInventory notice:', err.message);
      throw err;
    }
  },

  async reportSeatMaintenance({ seatId, seatNumber, issueType, category, description, severity, priority, expectedResolutionAt, assignedTo }) {
    let targetSeatId = seatId;

    if (!targetSeatId && seatNumber) {
      const orParts = [`seat_number.eq."${seatNumber}"`];
      if (isUUID(seatNumber)) orParts.push(`id.eq."${seatNumber}"`);
      const { data: seatData } = await supabase.from('seats').select('id').or(orParts.join(',')).maybeSingle();
      if (seatData) targetSeatId = seatData.id;
    }

    if (!targetSeatId) {
      throw new Error('Please select a valid seat.');
    }

    const { data, error } = await supabase.rpc('report_seat_maintenance', {
      p_seat_id: targetSeatId,
      p_issue_type: issueType || category || 'General Maintenance',
      p_description: description || 'Flagged for maintenance',
      p_severity: (severity || priority || 'medium').toLowerCase(),
      p_expected_resolution_at: expectedResolutionAt || null,
      p_assigned_to: assignedTo && isUUID(assignedTo) ? assignedTo : null
    });

    if (error) {
      console.error('[librarianService] report_seat_maintenance RPC error:', error);
      throw new Error(error.message || 'Failed to report maintenance issue.');
    }

    if (data && !data.success) {
      throw new Error(data.message || 'Maintenance report rejected.');
    }

    return data;
  },

  async updateMaintenanceStatus({ maintenanceId, status, severity, assignedTo, expectedResolutionAt }) {
    if (!maintenanceId || !isUUID(maintenanceId)) {
      throw new Error('Invalid maintenance ticket ID.');
    }

    const { data, error } = await supabase.rpc('update_seat_maintenance', {
      p_maintenance_id: maintenanceId,
      p_status: status,
      p_severity: severity || null,
      p_assigned_to: assignedTo && isUUID(assignedTo) ? assignedTo : null,
      p_expected_resolution_at: expectedResolutionAt || null
    });

    if (error) {
      console.error('[librarianService] update_seat_maintenance RPC error:', error);
      throw new Error(error.message || 'Failed to update maintenance status.');
    }

    if (data && !data.success) {
      throw new Error(data.message || 'Maintenance update rejected.');
    }

    return data;
  },

  async resolveSeatMaintenance(maintenanceIdOrSeatNumber, resolutionNotes = 'Issue resolved & verified.') {
    let maintId = maintenanceIdOrSeatNumber;

    if (maintId && !isUUID(maintId)) {
      const { data: seatData } = await supabase.from('seats').select('id').eq('seat_number', maintId).maybeSingle();
      if (seatData) {
        const { data: maintRow } = await supabase
          .from('seat_maintenance')
          .select('id')
          .eq('seat_id', seatData.id)
          .in('status', ['reported', 'in_progress'])
          .maybeSingle();
        if (maintRow) maintId = maintRow.id;
      }
    }

    if (!maintId || !isUUID(maintId)) {
      throw new Error('No active maintenance record found to resolve.');
    }

    const { data, error } = await supabase.rpc('resolve_seat_maintenance', {
      p_maintenance_id: maintId,
      p_resolution_notes: resolutionNotes
    });

    if (error) {
      console.error('[librarianService] resolve_seat_maintenance RPC error:', error);
      throw new Error(error.message || 'Failed to resolve seat maintenance.');
    }

    if (data && !data.success) {
      throw new Error(data.message || 'Resolution failed.');
    }

    return data;
  },

  async addNewSeat({ libraryId, floorId, roomId, seatNumber, seatType, hasPowerSocket = false, isAccessible = false, allocationMode = 'student_selectable' }) {
    if (!libraryId || !floorId || !roomId || !seatNumber) {
      throw new Error('Library, floor, room, and seat number are required.');
    }

    const { data, error } = await supabase.rpc('add_new_seat', {
      p_library_id: libraryId,
      p_floor_id: floorId,
      p_room_id: roomId,
      p_seat_number: seatNumber.trim().toUpperCase(),
      p_seat_type: seatType || 'Standard Study Desk',
      p_has_power_socket: Boolean(hasPowerSocket),
      p_is_accessible: Boolean(isAccessible),
      p_allocation_mode: allocationMode || 'student_selectable'
    });

    if (error) {
      console.error('[librarianService] add_new_seat RPC error:', error);
      throw new Error(error.message || 'Failed to create seat.');
    }

    if (data && !data.success) {
      throw new Error(data.message || 'Seat creation rejected.');
    }

    return data;
  },

  // 8. INCIDENT REPORTS
  async createIncidentReport({ category, description, severity, location, studentName, actionTaken, staffUser }) {
    const incidents = (await db.read('seatsync_incidents')) || [];
    const incident = {
      id: `INC-${Date.now()}`,
      category,
      description,
      severity: severity || 'Medium',
      location: location || 'Main Reading Room',
      studentName: studentName || 'N/A',
      actionTaken: actionTaken || 'Logged',
      createdAt: new Date().toISOString(),
      status: 'Open'
    };

    incidents.push(incident);
    await db.write('seatsync_incidents', incidents);
    return incident;
  },

  // 9. SHIFT HANDOVER
  async createShiftHandover({ outgoingStaff, incomingStaff, notes, pendingIssues, maintenanceCount, unresolvedIncidents }) {
    const handovers = (await db.read('seatsync_handovers')) || [];
    const handover = {
      id: `HND-${Date.now()}`,
      outgoingStaff,
      incomingStaff,
      notes,
      timestamp: new Date().toISOString(),
      status: 'Pending'
    };

    handovers.push(handover);
    await db.write('seatsync_handovers', handovers);
    return handover;
  },

  async acknowledgeShiftHandover(handoverId, incomingStaffName) {
    const handovers = (await db.read('seatsync_handovers')) || [];
    const handover = handovers.find(h => String(h.id) === String(handoverId));
    if (handover) {
      handover.status = 'Acknowledged';
      await db.write('seatsync_handovers', handovers);
    }
    return handover || { id: handoverId, status: 'Acknowledged' };
  },

  // 10. WALK-IN ALLOCATION
  async createWalkInBooking({ student, seat, slot, dateStr, staffUser, autoCheckIn = true, notes = '' }) {
    if (student?.id && seat?.id && slot?.id && isUUID(student.id) && isUUID(seat.id) && isUUID(slot.id)) {
      try {
        const { data, error } = await supabase.rpc('allocate_walk_in_seat', {
          p_student_id: student.id,
          p_seat_id: seat.id,
          p_slot_id: slot.id,
          p_booking_date: dateStr,
          p_perform_instant_check_in: autoCheckIn,
          p_idempotency_key: `WK-IK-${student.id}-${dateStr}-${seat.id}-${Date.now()}`,
          p_notes: notes
        });

        if (!error && data && data.success) {
          return {
            id: data.booking_id,
            bookingCode: data.booking_code,
            studentName: student.name || student.full_name || 'Student',
            studentRegistrationNumber: student.collegeId || student.registration_number || 'N/A',
            seatNumber: seat.seatNumber || seat.seat_number || 'S-41',
            slotName: slot.name || slot.label || 'Time Slot',
            bookingDate: dateStr,
            status: autoCheckIn ? 'checked_in' : 'confirmed',
            bookingSource: 'walk_in',
            allocatedBy: staffUser?.name || 'Staff Librarian',
            createdAt: new Date().toISOString()
          };
        }
        if (error) throw new Error(error.message);
      } catch (err) {
        if (err.message && !err.message.includes('fetch') && !err.message.includes('RPC')) {
          throw err;
        }
      }
    }

    const bookings = (await db.read('seatsync_bookings')) || [];
    const bookingCode = `WK-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    const newBooking = {
      id: `booking-walkin-${Date.now()}`,
      bookingCode,
      studentId: student.id || student.collegeId || 'STD-LOCAL',
      studentName: student.name || student.full_name || 'Student',
      studentRegistrationNumber: student.collegeId || 'N/A',
      studentEmail: student.email || '',
      seatId: seat.id || seat.seatNumber,
      seatNumber: seat.seatNumber || seat.seat_number || 'S-41',
      slotId: slot.id,
      slotName: slot.name || slot.label || 'Slot',
      bookingDate: dateStr,
      status: autoCheckIn ? 'checked_in' : 'confirmed',
      bookingSource: 'walk_in',
      allocatedBy: staffUser?.name || 'Staff Librarian',
      createdAt: new Date().toISOString(),
      checkedInAt: autoCheckIn ? new Date().toISOString() : null
    };

    bookings.push(newBooking);
    await db.write('seatsync_bookings', bookings);
    return newBooking;
  },

  // 12. NO-SHOW & STANDING MONITOR ENGINE
  async getStudentNoShowStandings(libraryId = null) {
    try {
      const { data, error } = await supabase.rpc('get_student_no_show_standings', {
        p_library_id: libraryId && isUUID(libraryId) ? libraryId : null
      });

      if (!error && Array.isArray(data)) {
        return data.map(r => ({
          student_id: r.student_id,
          id: r.student_id,
          student_name: r.student_name,
          name: r.student_name,
          college_id: r.college_id,
          collegeId: r.college_id,
          department: r.department,
          no_show_count: r.no_show_count,
          noShowCount: r.no_show_count,
          max_no_shows: r.max_no_shows || 3,
          maxNoShows: r.max_no_shows || 3,
          account_standing: r.account_standing,
          accountStanding: r.account_standing,
          is_restricted: r.is_restricted,
          isRestricted: r.is_restricted,
          restriction_start_at: r.restriction_start_at,
          restriction_end_at: r.restriction_end_at
        }));
      }
      if (error) console.warn('[librarianService] get_student_no_show_standings RPC error:', error.message);
    } catch (err) {
      console.warn('[librarianService] getStudentNoShowStandings notice:', err.message);
    }

    // Fallback if DB RPC fails
    const users = (await db.read('seatsync_users')) || [];
    return users.filter(u => u.role === 'STUDENT').map(u => ({
      student_id: u.id,
      id: u.id,
      student_name: u.name || u.full_name,
      name: u.name || u.full_name,
      college_id: u.collegeId || u.identifier || 'N/A',
      collegeId: u.collegeId || u.identifier || 'N/A',
      department: u.department || 'General',
      no_show_count: u.noShowCount || 0,
      noShowCount: u.noShowCount || 0,
      max_no_shows: 3,
      maxNoShows: 3,
      account_standing: (u.noShowCount || 0) >= 3 ? 'Restricted' : ((u.noShowCount || 0) === 2 ? 'Final Warning' : ((u.noShowCount || 0) === 1 ? 'Warning' : 'Good Standing')),
      accountStanding: (u.noShowCount || 0) >= 3 ? 'Restricted' : ((u.noShowCount || 0) === 2 ? 'Final Warning' : ((u.noShowCount || 0) === 1 ? 'Warning' : 'Good Standing')),
      is_restricted: (u.noShowCount || 0) >= 3 || u.accountStatus === 'restricted',
      isRestricted: (u.noShowCount || 0) >= 3 || u.accountStatus === 'restricted'
    }));
  },

  async resetStudentNoShowStanding(studentId, reason) {
    const cleanReason = String(reason || '').trim();
    if (!cleanReason) {
      throw new Error('Resolution reason is required to reset student standing.');
    }

    if (isUUID(studentId)) {
      const { data, error } = await supabase.rpc('reset_student_no_show_standing', {
        p_student_id: studentId,
        p_reason: cleanReason
      });

      if (error) throw new Error(error.message);
      return data;
    }

    // Mock fallback
    const users = (await db.read('seatsync_users')) || [];
    const target = users.find(u => u.id === studentId);
    if (target) {
      target.noShowCount = 0;
      target.accountStatus = 'active';
      await db.write('seatsync_users', users);
    }
    return { success: true };
  },

  async warnStudentNoShow(studentId, warningMessage = null) {
    if (isUUID(studentId)) {
      const { data, error } = await supabase.rpc('warn_student_no_show', {
        p_student_id: studentId,
        p_message: warningMessage || null
      });

      if (error) throw new Error(error.message);
      return data;
    }

    // Mock fallback
    return { success: true };
  }
};

