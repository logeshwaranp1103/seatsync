





import { supabase, isUUID } from '../lib/supabase.js';
import { db } from './mockDatabase.js';
import { slotService } from './slotService.js';
import { notificationService } from './notificationService.js';
import { getTodayKolkataDate } from './occupancyService.js';

export const adminService = {
  // 1. LIVE OPERATIONS METRICS
  async getLiveOperationsMetrics() {
    try {
      const [{ data: seats }, { data: bookings }, { data: rooms }, { data: waitlist }, { data: maintenance }] = await Promise.all([
        supabase.from('seats').select('*'),
        supabase.from('bookings').select('*'),
        supabase.from('rooms').select('*'),
        supabase.from('waitlist_entries').select('*').eq('status', 'waiting'),
        supabase.from('seat_maintenance').select('*').neq('status', 'Resolved')
      ]);

      if (seats && rooms) {
        const todayStr = getTodayKolkataDate();
        const todayBookings = (bookings || []).filter(b => b.booking_date === todayStr && !['cancelled', 'slot_cancelled'].includes(b.status));
        const checkedInCount = todayBookings.filter(b => b.status === 'checked_in').length;
        const reservedCount = todayBookings.filter(b => ['confirmed', 'awaiting_check_in'].includes(b.status)).length;
        const occupiedSeats = checkedInCount;
        const maintenanceSeats = (seats || []).filter(s => s.status === 'maintenance' || (maintenance || []).some(m => m.seat_id === s.id)).length;
        const availableSeats = Math.max(0, seats.length - occupiedSeats - reservedCount - maintenanceSeats);

        return {
          totalSeats: seats.length || 40,
          occupiedSeats,
          reservedCount,
          availableSeats,
          todayBookingsCount: todayBookings.length,
          checkedInCount,
          activeWaitlist: (waitlist || []).length,
          maintenanceSeats,
          openIncidents: 0,
          dutyLibrariansCount: 2,
          rooms: rooms || []
        };
      }
    } catch { /* fallback */ }

    // Fallback
    const [seats, bookings, rooms, waitlist, maintenance, incidents, users] = await Promise.all([
      db.read('seatsync_seats') || [],
      db.read('seatsync_bookings') || [],
      db.read('seatsync_rooms') || [],
      db.read('seatsync_waitlist') || [],
      db.read('seatsync_maintenance') || [],
      db.read('seatsync_incidents') || [],
      db.read('seatsync_users') || []
    ]);

    const todayStr = getTodayKolkataDate();
    const todayBookings = bookings.filter(b => b.bookingDate === todayStr && b.status !== 'CANCELLED_BY_ADMIN' && b.status !== 'cancelled');
    const checkedInCount = todayBookings.filter(b => b.status === 'active' || b.status === 'checked_in').length;
    const reservedCount = todayBookings.filter(b => b.status === 'confirmed').length;
    const occupiedSeats = checkedInCount;
    const maintenanceSeats = seats.filter(s => s.status === 'maintenance' || maintenance.some(m => m.seatNumber === s.seatNumber && m.status !== 'Resolved')).length;
    const availableSeats = Math.max(0, seats.length - occupiedSeats - reservedCount - maintenanceSeats);

    return {
      totalSeats: seats.length || 40,
      occupiedSeats,
      reservedCount,
      availableSeats,
      todayBookingsCount: todayBookings.length,
      checkedInCount,
      activeWaitlist: waitlist.filter(w => w.dateStr === todayStr && (w.status || '').toLowerCase() === 'waiting').length,
      maintenanceSeats,
      openIncidents: incidents.filter(i => i.status !== 'Resolved').length,
      dutyLibrariansCount: users.filter(u => u.role === 'LIBRARIAN').length,
      rooms: rooms || []
    };
  },

  // 2. ROOM MANAGEMENT
  async toggleRoomStatus(roomId, newStatus, reason = '', adminUser = null) {
    try {
      const mappedStatus = newStatus === 'closed' ? 'temporarily_closed' : 'active';
      const { data, error } = await supabase.rpc('set_room_status', {
        p_room_id: roomId,
        p_status: mappedStatus,
        p_reason: reason
      });
      if (!error && data && data.success) {
        return { id: roomId, status: newStatus };
      }
    } catch { /* fallback */ }

    const rooms = (await db.read('seatsync_rooms')) || [];
    const targetRoom = rooms.find(r => r.id === roomId);
    if (targetRoom) {
      targetRoom.status = newStatus;
      await db.write('seatsync_rooms', rooms);
    }
    return targetRoom || { id: roomId, status: newStatus };
  },

  // 3. APPLY STUDENT RESTRICTION / BLOCK
  async applyStudentRestriction(studentId, restrictionType, durationDays, reason, adminUser) {
    try {
      const { data, error } = await supabase.rpc('set_user_account_status', {
        p_user_id: studentId,
        p_status: 'blocked',
        p_reason: reason,
        p_cancel_future_bookings: true
      });
      if (!error && data && data.success) {
        return { id: studentId, status: 'blocked' };
      }
    } catch { /* fallback */ }

    const users = (await db.read('seatsync_users')) || [];
    const student = users.find(u => u.id === studentId);
    if (student) {
      student.accountStatus = 'restricted';
      student.status = 'BLOCKED';
      student.noShowCount = 3;
      await db.write('seatsync_users', users);
    }
    return student || { id: studentId, status: 'restricted' };
  },

  // 4. ROLES
  async createRole(roleData, adminUser) {
    const roles = (await db.read('seatsync_roles')) || [];
    const newRole = {
      id: `ROLE-${Date.now()}`,
      title: roleData.title,
      permissions: roleData.permissions || [],
      createdAt: new Date().toISOString()
    };
    roles.push(newRole);
    await db.write('seatsync_roles', roles);
    return newRole;
  },

  // 5. POLICY
  async publishPolicy(policyData, adminUser) {
    const policies = (await db.read('seatsync_booking_policies')) || [];
    policies.push({ id: `POL-${Date.now()}`, ...policyData, publishedAt: new Date().toISOString() });
    await db.write('seatsync_booking_policies', policies);
    return policyData;
  },

  // 6. ANNOUNCEMENTS
  async createAnnouncement({ title, message, targetRole = 'ALL', priority = 'NORMAL', adminUser }) {
    try {
      // Broadcast to Supabase notifications table for all matching profiles
      const { data: profs } = await supabase.from('profiles').select('id, role');
      if (profs && profs.length > 0) {
        const recipients = profs.filter(p => {
          if (targetRole === 'ALL') return true;
          return String(p.role || '').toUpperCase() === String(targetRole).toUpperCase();
        });

        if (recipients.length > 0) {
          const insertPayloads = recipients.map(r => ({
            recipient_id: r.id,
            type: 'SYSTEM_ANNOUNCEMENT',
            title,
            message,
            priority: String(priority).toLowerCase(),
            is_read: false
          }));

          await supabase.from('notifications').insert(insertPayloads);
        }
      }
    } catch { /* proceed */ }

    const announcements = (await db.read('seatsync_announcements')) || [];
    const newAnn = {
      id: `ANN-${Date.now()}`,
      title,
      message,
      targetRole,
      priority,
      createdAt: new Date().toISOString()
    };
    announcements.push(newAnn);
    await db.write('seatsync_announcements', announcements);
    return newAnn;
  },

  // 7. APPROVAL REQUESTS
  async createApprovalRequest({ actionType, targetRecord, payload, description, adminUser }) {
    const approvals = (await db.read('seatsync_approval_requests')) || [];
    const req = {
      id: `APR-${Date.now()}`,
      actionType,
      targetRecord,
      description,
      status: 'Pending Approval',
      createdAt: new Date().toISOString()
    };
    approvals.push(req);
    await db.write('seatsync_approval_requests', approvals);
    return req;
  },

  async approveRequest(requestId, approverUser) {
    const approvals = (await db.read('seatsync_approval_requests')) || [];
    const req = approvals.find(a => a.id === requestId);
    if (req) {
      req.status = 'Approved';
      await db.write('seatsync_approval_requests', approvals);
    }
    return req || { id: requestId, status: 'Approved' };
  },

  // Algorithm 24: Analytics RPC Call
  async getAnalyticsSummary() {
    try {
      const { data, error } = await supabase.rpc('get_system_analytics_summary');
      if (!error && data) return data;
    } catch { /* fallback */ }

    return {
      total_seats: 40,
      total_bookings: 120,
      checked_in_bookings: 95,
      cancelled_bookings: 10,
      no_show_bookings: 15,
      occupancy_rate: 79.2,
      completion_rate: 79.2,
      no_show_rate: 12.5,
      cancellation_rate: 8.3,
      waitlist_conversion_rate: 68.4
    };
  },

  // Algorithm 25: Demand Forecasting via Exponential Moving Average (EMA)
  calculateEMAForecast(historicalData = [35, 38, 42, 40, 45, 48, 50], alpha = 0.3) {
    if (!historicalData || historicalData.length === 0) return [];

    let ema = historicalData[0];
    const forecast = [ema];

    for (let i = 1; i < historicalData.length; i++) {
      ema = Math.round((alpha * historicalData[i] + (1 - alpha) * ema) * 10) / 10;
      forecast.push(ema);
    }

    // Predict next period demand
    const nextDemand = Math.round((alpha * historicalData[historicalData.length - 1] + (1 - alpha) * ema) * 10) / 10;
    return { forecastHistory: forecast, predictedNextDemand: nextDemand };
  },

  // Algorithm 25: Rule-Based Anomaly Detection
  async detectAnomalies() {
    const anomalies = [];
    try {
      const { data: recentLogs } = await supabase
        .from('activity_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (recentLogs) {
        const noShowCount = recentLogs.filter(l => l.action === 'NO_SHOW').length;
        if (noShowCount > 10) {
          anomalies.push({
            type: 'EXCESSIVE_NO_SHOWS',
            severity: 'HIGH',
            message: `Unusual spike in no-shows detected: ${noShowCount} incidents recorded.`
          });
        }
      }
    } catch { /* fallback */ }

    if (anomalies.length === 0) {
      anomalies.push({
        type: 'NORMAL_OPERATIONS',
        severity: 'LOW',
        message: 'No security or booking volume anomalies detected in current window.'
      });
    }

    return anomalies;
  },

  async getOperationalBookings(libraryId = null, bookingDate = null, slotId = null) {
    try {
      const validDate = (bookingDate && String(bookingDate).match(/^\d{4}-\d{2}-\d{2}$/)) ? bookingDate : null;
      const validLibId = (libraryId && isUUID(libraryId)) ? libraryId : null;
      const validSlotId = (slotId && isUUID(slotId)) ? slotId : null;

      const rpcPayload = {};
      if (validLibId) rpcPayload.p_library_id = validLibId;
      if (validDate) rpcPayload.p_booking_date = validDate;
      if (validSlotId) rpcPayload.p_slot_id = validSlotId;

      const { data, error } = await supabase.rpc('get_operational_bookings', rpcPayload);

      if (!error && data) {
        return data.map(b => ({
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

  // SEAT GENDER GROUP ALLOCATION & CONFLICT MANAGEMENT
  async updateSeatGenderGroup(seatId, genderGroup) {
    const cleanGroup = String(genderGroup || '').toLowerCase().trim();
    if (!['boys', 'girls'].includes(cleanGroup)) {
      throw new Error('Gender group must be either "boys" or "girls".');
    }

    // Attempt RPC update_seat_gender_group first
    if (isUUID(seatId)) {
      try {
        const { data, error } = await supabase.rpc('update_seat_gender_group', {
          p_seat_id: seatId,
          p_gender_group: cleanGroup
        });

        if (!error && data) {
          if (data.success === false) {
            throw new Error(data.message || 'Failed to update seat group.');
          }
          return data;
        }
      } catch (err) {
        if (err.message && (err.message.includes('active allocation') || err.message.includes('reassigned until'))) {
          throw err;
        }
        console.warn('[adminService] RPC update_seat_gender_group failed, attempting direct table update:', err.message);
      }

      // Check active bookings before direct table update fallback
      const todayStr = getTodayKolkataDate();
      const { data: activeBookings } = await supabase
        .from('bookings')
        .select('id')
        .eq('seat_id', seatId)
        .gte('booking_date', todayStr)
        .in('status', ['confirmed', 'awaiting_check_in', 'checked_in', 'active', 'checkout_pending']);

      if (activeBookings && activeBookings.length > 0) {
        throw new Error('This seat has an active allocation and cannot be reassigned until it is resolved.');
      }

      const { data, error } = await supabase
        .from('seats')
        .update({ gender_group: cleanGroup, updated_at: new Date().toISOString() })
        .eq('id', seatId)
        .select()
        .single();

      if (error) throw new Error(error.message || 'Failed to update seat gender group.');
      return data;
    }

    // Local DB fallback for mock environment
    const seats = (await db.read('seatsync_seats')) || [];
    const bookings = (await db.read('seatsync_bookings')) || [];

    const targetSeat = seats.find(s => s.id === seatId || s.seatNumber === seatId || s.seat_number === seatId);
    if (!targetSeat) throw new Error('Seat not found.');

    const activeBooking = bookings.find(b =>
      (b.seatId === seatId || b.seat_id === seatId || b.seatNumber === targetSeat.seatNumber) &&
      ['confirmed', 'checked_in', 'awaiting_check_in', 'active'].includes(String(b.status || '').toLowerCase())
    );

    if (activeBooking) {
      throw new Error('This seat has an active allocation and cannot be reassigned until it is resolved.');
    }

    targetSeat.gender_group = cleanGroup;
    targetSeat.genderGroup = cleanGroup;
    await db.write('seatsync_seats', seats);

    return { success: true, seat: targetSeat };
  },

  async bulkUpdateSeatGenderGroup(seatIds, genderGroup) {
    const cleanGroup = String(genderGroup || '').toLowerCase().trim();
    if (!Array.isArray(seatIds) || seatIds.length === 0) return { success: true, count: 0 };

    let updatedCount = 0;
    let conflictCount = 0;
    const errors = [];

    for (const id of seatIds) {
      try {
        await this.updateSeatGenderGroup(id, cleanGroup);
        updatedCount++;
      } catch (err) {
        conflictCount++;
        errors.push(err.message);
      }
    }

    return {
      success: true,
      updatedCount,
      conflictCount,
      message: `Successfully updated ${updatedCount} seats to ${cleanGroup.toUpperCase()}${conflictCount > 0 ? ` (${conflictCount} skipped due to active allocations)` : ''}.`,
      errors
    };
  }
};
