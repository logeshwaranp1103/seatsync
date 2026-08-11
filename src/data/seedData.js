export const ROLES = {
  STUDENT: 'STUDENT',
  LIBRARIAN: 'LIBRARIAN',
  ADMIN: 'ADMIN'
};

export const defaultUsers = [
  {
    id: 'USR-001',
    identifier: '24AD042',
    name: 'Subash P',
    email: 'student@college.edu',
    password: 'student123',
    role: 'STUDENT',
    gender: 'boys',
    status: 'ACTIVE',
    collegeId: '24AD042',
    department: 'Computer Science & Engineering',
    noShowCount: 0,
    createdAt: new Date().toISOString()
  },
  {
    id: 'USR-007',
    identifier: '24AD043',
    name: 'Anitha M',
    email: 'girl.student@college.edu',
    password: 'student123',
    role: 'STUDENT',
    gender: 'girls',
    status: 'ACTIVE',
    collegeId: '24AD043',
    department: 'Information Technology',
    noShowCount: 0,
    createdAt: new Date().toISOString()
  },
  {
    id: 'USR-002',
    identifier: 'LIB001',
    name: 'Library Staff / Librarian',
    email: 'librarian@college.edu',
    password: 'staff123',
    role: 'LIBRARIAN',
    status: 'ACTIVE',
    staffId: 'LIB001',
    department: 'Library Operations',
    createdAt: new Date().toISOString()
  },
  {
    id: 'USR-005',
    identifier: 'STAFF002',
    name: 'Assistant Librarian',
    email: 'librarian2@college.edu',
    password: 'staff123',
    role: 'LIBRARIAN',
    status: 'ACTIVE',
    staffId: 'STAFF002',
    department: 'Library Operations',
    createdAt: new Date().toISOString()
  },
  {
    id: 'USR-006',
    identifier: 'STAFF003',
    name: 'Senior Librarian',
    email: 'librarian3@college.edu',
    password: 'staff123',
    role: 'LIBRARIAN',
    status: 'ACTIVE',
    staffId: 'STAFF003',
    department: 'Library Operations',
    createdAt: new Date().toISOString()
  },
  {
    id: 'USR-003',
    identifier: 'ADM001',
    name: 'System Admin',
    email: 'admin@college.edu',
    password: 'admin123',
    role: 'ADMIN',
    status: 'ACTIVE',
    adminId: 'ADM001',
    department: 'IT & Systems Administration',
    createdAt: new Date().toISOString()
  },
  {
    id: 'USR-004',
    identifier: 'BIT1000',
    name: 'System Administrator',
    email: 'admin@bitsathy.ac.in',
    password: '123456',
    role: 'ADMIN',
    status: 'ACTIVE',
    adminId: 'BIT1000',
    department: 'IT & Systems Administration',
    createdAt: new Date().toISOString()
  }
];

export const defaultSlots = [
  { id: 'SLOT-01', label: 'Morning Slot 1', name: 'Morning Slot 1', startTime: '08:00 AM', endTime: '09:00 AM', start_time: '08:00:00', end_time: '09:00:00', active: true },
  { id: 'SLOT-02', label: 'Morning Slot 2', name: 'Morning Slot 2', startTime: '09:00 AM', endTime: '10:00 AM', start_time: '09:00:00', end_time: '10:00:00', active: true },
  { id: 'SLOT-03', label: 'Late Morning Slot', name: 'Late Morning Slot', startTime: '10:00 AM', endTime: '11:00 AM', start_time: '10:00:00', end_time: '11:00:00', active: true },
  { id: 'SLOT-04', label: 'Midday Slot', name: 'Midday Slot', startTime: '11:00 AM', endTime: '12:00 PM', start_time: '11:00:00', end_time: '12:00:00', active: true },
  { id: 'SLOT-05', label: 'Afternoon Session 1', name: 'Afternoon Session 1', startTime: '01:00 PM', endTime: '02:00 PM', start_time: '13:00:00', end_time: '14:00:00', active: true },
  { id: 'SLOT-06', label: 'Afternoon Session 2', name: 'Afternoon Session 2', startTime: '02:00 PM', endTime: '03:00 PM', start_time: '14:00:00', end_time: '15:00:00', active: true },
  { id: 'SLOT-07', label: 'Afternoon Session 3', name: 'Afternoon Session 3', startTime: '03:00 PM', endTime: '04:00 PM', start_time: '15:00:00', end_time: '16:00:00', active: true },
  { id: 'SLOT-08', label: 'Evening Slot 1', name: 'Evening Slot 1', startTime: '04:00 PM', endTime: '05:00 PM', start_time: '16:00:00', end_time: '17:00:00', active: true },
  { id: 'SLOT-09', label: 'Evening Slot 2', name: 'Evening Slot 2', startTime: '05:00 PM', endTime: '06:00 PM', start_time: '17:00:00', end_time: '18:00:00', active: true }
];

export const defaultFloors = [
  { id: 'floor-g', name: 'Ground Floor', level: 0, description: 'General Reading & Study Area', active: true },
  { id: 'floor-1', name: 'First Floor', level: 1, description: 'Silent Study & Reference Books', active: true },
  { id: 'floor-2', name: 'Second Floor', level: 2, description: 'Digital Resource Center', active: true }
];

export const defaultZones = [
  { id: 'zone-a', floorId: 'floor-g', name: 'Zone A', type: 'quiet', description: 'Individual Quiet Study', active: true },
  { id: 'zone-b', floorId: 'floor-g', name: 'Zone B', type: 'group', description: 'Collaborative Group Study', active: true }
];

export const defaultSeats = Array.from({ length: 50 }, (_, i) => {
  const num = i + 1;
  const zoneId = num <= 20 ? 'zone-a' : 'zone-b';
  const allocationMode = num > 40 ? 'walk_in_only' : 'online';
  return {
    id: `SEAT-${num.toString().padStart(2, '0')}`,
    seatNumber: `S-${num.toString().padStart(2, '0')}`,
    floorId: 'floor-g',
    zoneId,
    type: num > 40 ? 'Walk-In Reserved Pool' : (zoneId === 'zone-a' ? 'Quiet Study' : 'Group Discussion'),
    status: 'active',
    allocationMode,
    gender_group: num <= 20 ? 'boys' : 'girls',
    genderGroup: num <= 20 ? 'boys' : 'girls',
    powerOutlet: num % 2 === 0,
    nearWindow: num % 4 === 0
  };
});

export const defaultBookings = [];
export const defaultWaitlist = [];
export const defaultNotifications = [
  {
    id: 'NOTIF-001',
    userId: 'USR-001',
    title: 'Welcome to SeatSync',
    message: 'Your student account is active. You can now reserve library study seats.',
    createdAt: new Date().toISOString(),
    timestamp: new Date().toISOString(),
    isRead: false,
    read: false
  }
];
export const defaultActivityLogs = [];
export const defaultSettings = {
  libraryName: 'SeatSync Central University Library',
  operatingHours: '08:00 AM – 10:00 PM',
  maxBookingsPerStudent: 1,
  gracePeriodMinutes: 15,
  noShowLimitBeforeRestriction: 3,
  restrictionDurationDays: 7,
  notice: 'Quiet Study Hours are in effect in Zone A from 6:00 PM onwards.'
};
