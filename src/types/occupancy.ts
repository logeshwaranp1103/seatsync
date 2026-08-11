/**
 * SeatSync Live Library Occupancy Engine — TypeScript Definitions
 */

export type SeatStatusCategory = 'occupied' | 'reserved' | 'available' | 'maintenance' | 'inactive';

export interface FloorOccupancyBreakdown {
  floor_id: string;
  floor_name: string;
  total_seats: number;
  operational_seats: number;
  occupied_seats: number;
  reserved_seats: number;
  available_seats: number;
  maintenance_seats: number;
  occupancy_percentage: number;
}

export interface RoomOccupancyBreakdown {
  floor_id: string;
  floor_name: string;
  room_id: string;
  room_name: string;
  total_seats: number;
  operational_seats: number;
  occupied_seats: number;
  reserved_seats: number;
  available_seats: number;
  maintenance_seats: number;
  occupancy_percentage: number;
}

export interface SlotOccupancyBreakdown {
  slot_id: string;
  slot_name: string;
  start_time: string;
  end_time: string;
  slot_state: 'active' | 'upcoming' | 'past' | 'disabled';
  total_seats: number;
  operational_seats: number;
  occupied_seats: number;
  reserved_seats: number;
  available_seats: number;
  maintenance_seats: number;
  occupancy_percentage: number;
}

export interface LiveOccupancySnapshot {
  library_id: string | null;
  slot_occurrence_id: string | null;
  slot_id: string | null;
  slot_name: string;
  slot_active: boolean;
  booking_date: string;
  total_seats: number;
  operational_seats: number;
  occupied_seats: number;
  reserved_seats: number;
  available_seats: number;
  maintenance_seats: number;
  awaiting_check_in: number;
  checked_in_count: number;
  occupancy_percentage: number;
  floors: FloorOccupancyBreakdown[];
  rooms: RoomOccupancyBreakdown[];
  slots: SlotOccupancyBreakdown[];
  timestamp: string;
}

export interface CurrentOccupant {
  bookingId: string;
  bookingCode: string;
  studentId: string;
  studentName: string;
  registrationNumber: string;
  seatId: string;
  seatNumber: string;
  roomId: string;
  roomName: string;
  floorId: string;
  floorName: string;
  slotId: string;
  slotName: string;
  checkedInAt: string;
  timeOccupiedMinutes: number;
}

export interface SeatStatusDetail {
  seat_id: string;
  seat_number: string;
  seat_type: string;
  has_power_socket: boolean;
  is_accessible: boolean;
  status: SeatStatusCategory;
  color: string;
  booking: {
    id: string;
    booking_code: string;
    status: string;
    checked_in_at: string | null;
    student_name: string;
    registration_number: string;
  } | null;
  maintenance: {
    id: string;
    category: string;
    reason: string;
    priority: string;
    status: string;
    started_at: string;
  } | null;
}

export type RealtimeConnectionStatus = 'live' | 'reconnecting' | 'offline' | 'updating';
