# SeatSync — Dashboard Interconnection & End-to-End Supabase Audit

This document details the comprehensive audit and technical architecture establishing **Supabase PostgreSQL** as the single authoritative source of truth across all SeatSync dashboards: Student Dashboard, Librarian/Staff Dashboard, Administrator Dashboard, and Live Occupancy.

---

## 📊 Dashboard Interconnection Audit Matrix

| Feature | Student Source | Staff Source | Admin Source | Database Table / RPC | Audited Failure Mode | Final Shared Source |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Seat Booking Creation** | `bookingService.createBooking` | `librarianService.createWalkInBooking` | Admin Operations View | `public.create_booking()` RPC / `public.bookings` | Silent fallback to `localStorage` when UUID resolution failed or when Supabase RPC error occurred | **Supabase PostgreSQL (`bookings`)** via `create_booking` RPC |
| **My Reservations** | `bookingService.getStudentBookings` | — | Admin Student History | `public.bookings` JOIN `seats`, `slots`, `rooms` | Fallback to local storage if Supabase returned 0 rows for new users | **Supabase PostgreSQL (`bookings`)** where `student_id = auth.uid()` |
| **Operational Slot Bookings** | — | `librarianService.getOperationalBookings` | `adminService.getOperationalBookings` | `public.get_operational_bookings()` RPC | Mismatched date/slot filter keys (`slotId` vs `slot_id`) and missing profile joins | **Supabase PostgreSQL (`get_operational_bookings`)** |
| **Seat Map Availability** | `bookingService.getSeatsForSlot` | `occupancyService.getOccupancy` | Live Seat Map | `public.seats` LEFT JOIN `public.bookings` | Client-side status state calculation mismatch (`user_booked` vs `reserved`) | **Supabase PostgreSQL (`seats` + `bookings`)** |
| **Walk-In Pool Allocation** | — | `bookingService.getWalkInSeatsForSlot` | Walk-In History | `public.allocate_walk_in_seat()` RPC | Online student queries included `walk_in_only` seats (`S-41`..`S-50`) | **Supabase PostgreSQL (`seats.allocation_mode = 'walk_in_only'`)** |
| **Live Occupancy Metrics** | — | `occupancyService.getOccupancy` | Admin Overview Cards | `public.seats`, `public.bookings`, `public.seat_maintenance` | `seatsync_seats` local DB fallback causing out-of-sync capacity counters | **Supabase PostgreSQL (`getOccupancy`)** |
| **Realtime Updates** | Supabase Realtime | Supabase Realtime | Supabase Realtime | `supabase_realtime` publication (`bookings`, `seats`, `waitlist_entries`, `seat_maintenance`) | Unsubscribed tables or missing client event handlers on `bookings` inserts | **Supabase Realtime Publication** triggering `useSync` refetch |

---

## 🔍 Root Cause Analysis of Data Mismatches

1. **Silent Fallback to Local Storage**:
   - In `bookingService.js`, when a Supabase query returned 0 rows or thrown an RPC error, the catch block fell back to reading/writing `seatsync_bookings` in `localStorage`.
   - A real student's booking was written locally in their browser, but was completely invisible to the Librarian and Admin dashboards.
2. **Missing Auth-to-Profile Mapping Trigger**:
   - Self-registered Supabase auth users did not automatically receive a corresponding row in `public.profiles`, causing foreign key join queries on `profiles` to fail silently.
3. **Mismatched Column Filter Keys**:
   - Student dashboard used camelCase `slotId` / `bookingDate`, while Staff and Admin queries expected snake_case `slot_id` / `booking_date`.
4. **Realtime Subscription Disconnect**:
   - `bookings` and `seat_maintenance` were not consistently published to `supabase_realtime`, preventing real-time cross-dashboard synchronization upon booking creation or checkout.

---

## 🛠️ Solutions & Architectural Fixes

1. **Single Shared Supabase Client**:
   - All modules import the single shared client `supabase` from `src/lib/supabase.js`.
2. **Atomic Student Booking RPC (`create_booking`)**:
   - Uses `student_id := auth.uid()` from session context.
   - Enforces seat physical condition, walk-in pool restriction (`allocation_mode != 'walk_in_only'`), student slot overlap prevention, concurrent seat lock (`FOR UPDATE`), idempotency key logging, notification outbox entry, and atomic commit.
3. **Operational Joined RPC (`get_operational_bookings`)**:
   - Secure RPC returning complete joined booking records: Booking ID, Student Name, Student College/Register ID, Library, Room, Seat Number, Slot Name & Times, Booking Date, Booking Source, Status, Timestamps, and Check-in/out State.
4. **Auth Trigger & Profile Backfill**:
   - Added `on_auth_user_created` trigger on `auth.users` setting default role `'student'`.
   - Backfilled missing profile rows using `ON CONFLICT (id) DO NOTHING`.
5. **Realtime Publication Configuration**:
   - Added `bookings`, `seats`, `waitlist_entries`, `seat_maintenance`, `notification_outbox`, and `slot_occurrences` to `supabase_realtime` publication.
