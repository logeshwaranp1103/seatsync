import { supabase, isUUID } from '../lib/supabase.js';
import { bookingService } from './bookingService.js';
import { db } from './mockDatabase.js';

export const dashboardService = {
  async getStudentStats(studentId) {
    try {
      const myBookings = await bookingService.getMyBookings(studentId);
      const tomorrowDate = bookingService.getTomorrowDateStr();

      const activeOrConfirmed = (myBookings || []).filter(b => 
        !['cancelled', 'cancelled_by_student', 'cancelled_by_admin', 'slot_cancelled'].includes(String(b.status || '').toLowerCase())
      );

      const tomorrowsBookings = activeOrConfirmed.filter(b => b.bookingDate === tomorrowDate).length;
      const completedReservations = (myBookings || []).filter(b => 
        ['completed', 'checked_out'].includes(String(b.status || '').toLowerCase())
      ).length;

      const activeBooking = activeOrConfirmed.find(b => 
        ['active', 'checked_in', 'checkout_pending'].includes(String(b.status || '').toLowerCase())
      );

      const upcomingBooking = activeOrConfirmed.find(b => 
        b.bookingDate === tomorrowDate && ['confirmed', 'awaiting_check_in'].includes(String(b.status || '').toLowerCase())
      );

      const totalStudyHours = completedReservations * 1;

      return {
        tomorrowsBookings,
        completedReservations,
        activeBooking: activeBooking || null,
        upcomingBooking: upcomingBooking || null,
        totalStudyHours
      };
    } catch (err) {
      console.warn('[dashboardService] getStudentStats notice:', err.message);
      return {
        tomorrowsBookings: 0,
        completedReservations: 0,
        activeBooking: null,
        upcomingBooking: null,
        totalStudyHours: 0
      };
    }
  },

  async getStudentDashboardStats(studentId) {
    return this.getStudentStats(studentId);
  },

  async getLibraryInfo() {
    try {
      const [{ data: libData }, { count }] = await Promise.all([
        supabase.from('libraries').select('name').limit(1).maybeSingle(),
        supabase.from('seats').select('*', { count: 'exact', head: true })
      ]);

      return {
        libraryName: libData?.name || 'SeatSync Central Library',
        operatingHours: '08:00 AM – 10:00 PM',
        totalSeats: count || 40,
        notice: 'Quiet Study Hours are in effect in Zone A from 6:00 PM onwards.'
      };
    } catch {
      return {
        libraryName: 'SeatSync Central Library',
        operatingHours: '08:00 AM – 10:00 PM',
        totalSeats: 40,
        notice: 'Quiet Study Hours are in effect in Zone A from 6:00 PM onwards.'
      };
    }
  }
};
