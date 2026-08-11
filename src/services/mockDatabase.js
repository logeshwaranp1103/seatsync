import {
  defaultUsers, defaultSlots, defaultFloors, defaultZones, defaultSeats,
  defaultBookings, defaultWaitlist, defaultNotifications, defaultActivityLogs, defaultSettings
} from '../data/seedData.js';

const memoryStore = new Map();

class MockDatabase {
  constructor() {
    this.delay = 150;
    this.init();
  }

  init() {
    try {
      if (typeof localStorage !== 'undefined' && !localStorage.getItem('seatsync_initialized')) {
        localStorage.setItem('seatsync_users', JSON.stringify(defaultUsers));
        localStorage.setItem('seatsync_slots', JSON.stringify(defaultSlots));
        localStorage.setItem('seatsync_floors', JSON.stringify(defaultFloors));
        localStorage.setItem('seatsync_zones', JSON.stringify(defaultZones));
        localStorage.setItem('seatsync_seats', JSON.stringify(defaultSeats));
        localStorage.setItem('seatsync_bookings', JSON.stringify(defaultBookings));
        localStorage.setItem('seatsync_waitlist', JSON.stringify(defaultWaitlist));
        localStorage.setItem('seatsync_notifications', JSON.stringify(defaultNotifications));
        localStorage.setItem('seatsync_checkins', JSON.stringify([]));
        localStorage.setItem('seatsync_checkout_requests', JSON.stringify([]));
        localStorage.setItem('seatsync_maintenance', JSON.stringify([]));
        localStorage.setItem('seatsync_incidents', JSON.stringify([]));
        localStorage.setItem('seatsync_handovers', JSON.stringify([]));
        localStorage.setItem('seatsync_walkins', JSON.stringify([]));
        localStorage.setItem('seatsync_libraries', JSON.stringify([
          { id: 'LIB-01', name: 'Central University Library', code: 'MAIN-LIB', totalRooms: 4, capacity: 200, status: 'active' }
        ]));
        localStorage.setItem('seatsync_rooms', JSON.stringify([
          { id: 'RM-01', libraryId: 'LIB-01', name: 'Main Quiet Reading Hall', floor: 'Ground Floor', capacity: 40, status: 'active' },
          { id: 'RM-02', libraryId: 'LIB-01', name: 'Reference & Periodicals Room', floor: 'First Floor', capacity: 30, status: 'active' }
        ]));
        localStorage.setItem('seatsync_roles', JSON.stringify([
          { id: 'ROLE-01', title: 'Super Admin', isSystem: true, permissions: ['*'] },
          { id: 'ROLE-02', title: 'Librarian', isSystem: true, permissions: ['bookings.view', 'checkin.manage', 'walkin.create', 'maintenance.report', 'incidents.create'] }
        ]));
        localStorage.setItem('seatsync_booking_policies', JSON.stringify([
          { id: 'POL-01', title: 'Default Student Booking Policy', maxActiveBookings: 1, gracePeriodMins: 15, maxNoShows: 3, advanceBookingDays: 1, isPublished: true }
        ]));
        localStorage.setItem('seatsync_academic_calendar', JSON.stringify([]));
        localStorage.setItem('seatsync_announcements', JSON.stringify([]));
        localStorage.setItem('seatsync_penalties', JSON.stringify([]));
        localStorage.setItem('seatsync_support_tickets', JSON.stringify([]));
        localStorage.setItem('seatsync_staff_shifts', JSON.stringify([]));
        localStorage.setItem('seatsync_automation_rules', JSON.stringify([]));
        localStorage.setItem('seatsync_approval_requests', JSON.stringify([]));
        localStorage.setItem('seatsync_security_events', JSON.stringify([]));
        localStorage.setItem('seatsync_activity_logs', JSON.stringify(defaultActivityLogs));
        localStorage.setItem('seatsync_settings', JSON.stringify(defaultSettings));
        localStorage.setItem('seatsync_initialized', 'true');
      }
    } catch { /* Node.js env fallback */ }
  }

  async read(key) {
    return new Promise(resolve => {
      setTimeout(() => {
        let data = null;
        try {
          if (typeof localStorage !== 'undefined') data = localStorage.getItem(key);
        } catch { /* ignore */ }

        if (!data) data = memoryStore.get(key);

        if (!data) {
          resolve(key === 'seatsync_settings' ? defaultSettings : []);
          return;
        }
        try {
          const parsed = typeof data === 'string' ? JSON.parse(data) : data;
          resolve(parsed !== null ? parsed : (key === 'seatsync_settings' ? defaultSettings : []));
        } catch {
          resolve(key === 'seatsync_settings' ? defaultSettings : []);
        }
      }, this.delay);
    });
  }

  async write(key, value) {
    return new Promise(resolve => {
      setTimeout(() => {
        try {
          if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(value));
        } catch { /* ignore */ }

        memoryStore.set(key, value);

        if (typeof window !== 'undefined') {
          try {
            window.dispatchEvent(new StorageEvent('storage', { key: key, newValue: JSON.stringify(value) }));
          } catch { /* ignore */ }
        }
        resolve(value);
      }, this.delay);
    });
  }
}

export const db = new MockDatabase();
