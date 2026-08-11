-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 03: CONSTRAINTS & INDEXES
-- ====================================================================

-- 1. Index on bookings: student_id
CREATE INDEX IF NOT EXISTS idx_bookings_student_id ON public.bookings(student_id);

-- 2. Index on bookings: booking_date
CREATE INDEX IF NOT EXISTS idx_bookings_booking_date ON public.bookings(booking_date);

-- 3. Index on bookings: slot_id
CREATE INDEX IF NOT EXISTS idx_bookings_slot_id ON public.bookings(slot_id);

-- 4. Index on bookings: seat_id
CREATE INDEX IF NOT EXISTS idx_bookings_seat_id ON public.bookings(seat_id);

-- 5. Index on bookings: status
CREATE INDEX IF NOT EXISTS idx_bookings_status ON public.bookings(status);

-- 6. Compound Index on bookings: room_id and booking_date
CREATE INDEX IF NOT EXISTS idx_bookings_room_date ON public.bookings(room_id, booking_date);

-- 7. PARTIAL UNIQUE INDEX: Prevent double-booking same seat/date/slot for active statuses
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_seat_booking
ON public.bookings (seat_id, booking_date, slot_id)
WHERE status IN ('confirmed', 'awaiting_check_in', 'checked_in');

-- 8. PARTIAL UNIQUE INDEX: Prevent student holding duplicate active bookings for same date/slot
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_student_active_slot_booking
ON public.bookings (student_id, booking_date, slot_id)
WHERE status IN ('confirmed', 'awaiting_check_in', 'checked_in');

-- 9. PARTIAL UNIQUE INDEX: Prevent duplicate active waitlist entry for student/date/slot/room
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_waitlist_entry
ON public.waitlist_entries (student_id, room_id, slot_id, booking_date)
WHERE status = 'waiting';

-- 10. Indexes on notifications
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON public.notifications(recipient_id, is_read);

-- 11. Indexes on seats
CREATE INDEX IF NOT EXISTS idx_seats_room ON public.seats(room_id, status);

-- 12. Indexes on waitlist_entries
CREATE INDEX IF NOT EXISTS idx_waitlist_queue ON public.waitlist_entries(room_id, slot_id, booking_date, created_at);
