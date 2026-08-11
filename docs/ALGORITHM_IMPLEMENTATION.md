# SeatSync — Algorithm Implementation Reference Guide

This document details the production-grade implementation, location, signature, authorization, dashboard consumption, and scalability characteristics for all **25 algorithms** in **SeatSync**.

---

## 1. Atomic Booking Algorithm
- **Location**: `supabase/migrations/17_algorithm_enhancements.sql` -> `create_booking()`
- **Frontend Caller**: [bookingService.js](file:///c:/FULL%20STACK%20DEVELOPMENT/PROJECT%20WITH%20AI/SMART%20LIBRARY%20BOOKING/SeatSync-Unified/src/services/bookingService.js#L247) -> `createBooking()`
- **Dashboard Consumers**: Student Dashboard ([Dashboard.jsx](file:///c:/FULL%20STACK%20DEVELOPMENT/PROJECT%20WITH%20AI/SMART%20LIBRARY%20BOOKING/SeatSync-Unified/src/features/student/Dashboard.jsx)), [FindSeat.jsx](file:///c:/FULL%20STACK%20DEVELOPMENT/PROJECT%20WITH%20AI/SMART%20LIBRARY%20BOOKING/SeatSync-Unified/src/features/student/FindSeat.jsx)
- **Key Details**: Authenticates `auth.uid()`, checks account status, checks active penalties (`check_user_restriction_status`), locks target seat with `FOR UPDATE`, enforces `idx_unique_active_seat_booking` partial unique index, records transactional outbox event.
- **Scalability**: $O(1)$ index lookup with pessimistic row locking.

---

## 2. Overlap-Detection Algorithm
- **Location**: `create_booking()` in `17_algorithm_enhancements.sql` & `idx_unique_student_active_slot_booking` index in `03_constraints_and_indexes.sql`.
- **Frontend Caller**: `bookingService.createBooking()`
- **Dashboard Consumers**: Student Dashboard
- **Key Details**: Evaluates `new_start < existing_end AND new_end > existing_start` for time slots and enforces unique active reservation per student per date/slot.
- **Scalability**: $O(1)$ index check on `(student_id, booking_date, slot_id)`.

---

## 3. Idempotency Algorithm
- **Location**: `public.idempotency_keys` table in `17_algorithm_enhancements.sql`.
- **RPC Support**: `create_booking`, `cancel_booking`, `join_waitlist`, `accept_waitlist_offer` accept `p_idempotency_key`.
- **Frontend Caller**: `bookingService`, `waitlistService`
- **Dashboard Consumers**: All Dashboards
- **Key Details**: Stores transaction output by unique idempotency key. On duplicate request retry, returns original stored JSON payload without re-running transaction logic.

---

## 4. Seat-Availability Algorithm
- **Location**: `occupancyService.js` -> `getOccupancy()`
- **Dashboard Consumers**: Student Seat Map, Librarian Live Occupancy ([LiveOccupancyPage.jsx](file:///c:/FULL%20STACK%20DEVELOPMENT/PROJECT%20WITH%20AI/SMART%20LIBRARY%20BOOKING/SeatSync-Unified/src/features/librarian/LiveOccupancyPage.jsx))
- **Key Details**: Evaluates physical condition, active maintenance tickets, room closures, slot cancellations, and active bookings/holds. Avoids unreliable frontend-only booleans.
- **Scalability**: Filtered PostgreSQL query with composite indexes on `(room_id, status)`.

---

## 5. FIFO Waitlist Algorithm
- **Location**: `09_waitlist_rpcs.sql` -> `join_waitlist()`, `get_student_waitlist_position()`
- **Frontend Caller**: [waitlistService.js](file:///c:/FULL%20STACK%20DEVELOPMENT/PROJECT%20WITH%20AI/SMART%20LIBRARY%20BOOKING/SeatSync-Unified/src/services/waitlistService.js#L172)
- **Dashboard Consumers**: Student Waiting List ([WaitingList.jsx](file:///c:/FULL%20STACK%20DEVELOPMENT/PROJECT%20WITH%20AI/SMART%20LIBRARY%20BOOKING/SeatSync-Unified/src/features/student/WaitingList.jsx)), Staff Waitlist Page
- **Key Details**: Queue ordering enforced via `ORDER BY created_at ASC, id ASC`. Enforces partial unique index `idx_unique_active_waitlist_entry`. Returns requesting student's queue position without exposing full list of other students.

---

## 6. Waitlist-Promotion Algorithm
- **Location**: `09_waitlist_rpcs.sql` & `17_algorithm_enhancements.sql` -> `allocate_next_waitlisted_student()`
- **Trigger**: Automatic on booking cancellation, slot checkout, or offer expiration.
- **Key Details**: Locks target waitlist row using `FOR UPDATE SKIP LOCKED`. Creates expiring seat hold (`status = 'allocated'`) with `expires_at` timestamp and outbox notification.

---

## 7. Waitlist Offer Acceptance & Expiry
- **Location**: `17_algorithm_enhancements.sql` -> `accept_waitlist_offer()`, `reject_waitlist_offer()`, `fn_run_auto_03_waitlist_expiration()`
- **Schedule**: Cron job `AUTO-03` running every 5 minutes.
- **Dashboard Consumers**: Student Dashboard, Staff Waitlist Page

---

## 8. Booking-Cancellation Algorithm
- **Location**: `08_transactional_booking_rpcs.sql` -> `cancel_booking()`
- **Frontend Caller**: `bookingService.cancelBooking()`
- **Dashboard Consumers**: Student Dashboard, Librarian Dashboard, Admin Dashboard
- **Key Details**: Enforces role authorization (student owner vs staff/admin), logs actor and reason, writes to outbox, triggers waitlist auto-promotion.

---

## 9. Check-In & No-Show Algorithm
- **Location**: `10_checkin_checkout_rpcs.sql` -> `check_in_booking()`, `17_algorithm_enhancements.sql` -> `process_no_shows_batch()`
- **Schedule**: Cron job `AUTO-01` running every 5 minutes.
- **Dashboard Consumers**: Librarian Desk Check-In ([CheckInOutPage.jsx](file:///c:/FULL%20STACK%20DEVELOPMENT/PROJECT%20WITH%20AI/SMART LIBRARY BOOKING/SeatSync-Unified/src/features/librarian/CheckInOutPage.jsx))
- **Key Details**: Evaluates 15-minute grace period `(NOW() AT TIME ZONE 'Asia/Kolkata')::TIME > start_time + 15 mins`. Uses `FOR UPDATE SKIP LOCKED`, increments no-show penalty counts, auto-applies sliding window restrictions.

---

## 10. Checkout & Auto-Completion Algorithm
- **Location**: `10_checkin_checkout_rpcs.sql` -> `check_out_booking()`, `auto_complete_ended_slots()`
- **Dashboard Consumers**: Librarian Dashboard
- **Key Details**: Completes active sessions when slot ends, releases desk space, and triggers waitlist promotion.

---

## 11. Repeated No-Show Restriction Algorithm
- **Location**: `17_algorithm_enhancements.sql` -> `user_restrictions` table & `check_user_restriction_status()`
- **Dashboard Consumers**: Admin Penalties & Restrictions Page ([PenaltiesRestrictionsPage.jsx](file:///c:/FULL%20STACK%20DEVELOPMENT/PROJECT%20WITH%20AI/SMART%20LIBRARY%20BOOKING/SeatSync-Unified/src/features/admin/PenaltiesRestrictionsPage.jsx))
- **Key Details**: Evaluates sliding window of no-shows against threshold (default: 3). Blocks future booking creation automatically.

---

## 12. Secure QR Algorithm
- **Location**: `supabase/functions/verify-qr-pass/index.ts` & `scan_nonces` table in `17_algorithm_enhancements.sql`.
- **Dashboard Consumers**: Librarian QR Scanner ([QRScannerPage.jsx](file:///c:/FULL%20STACK%20DEVELOPMENT/PROJECT%20WITH%20AI/SMART%20LIBRARY%20BOOKING/SeatSync-Unified/src/features/librarian/QRScannerPage.jsx))
- **Key Details**: Verifies signed payload containing booking ID, student ID, action, expiration, and random nonce. Single-use nonce stored in `scan_nonces` to prevent replay attacks.

---

## 13. Slot-Disable & Emergency Closure Algorithm
- **Location**: `11_admin_ops_rpcs.sql` -> `disable_slot()`, `set_room_status()`
- **Dashboard Consumers**: Admin Disable Slot Modal ([DisableSlotModal.jsx](file:///c:/FULL%20STACK%20DEVELOPMENT/PROJECT%20WITH%20AI/SMART%20LIBRARY%20BOOKING/SeatSync-Unified/src/features/admin/DisableSlotModal.jsx))
- **Key Details**: Sets affected active bookings to `slot_cancelled` ("Cancelled by Library"), cancels pending waitlist entries, fires outbox notifications, updates dashboards in Realtime.

---

## 14. Seat Maintenance Algorithm
- **Location**: `11_admin_ops_rpcs.sql` -> `set_seat_maintenance()`
- **Dashboard Consumers**: Librarian Seat Maintenance Page ([SeatMaintenancePage.jsx](file:///c:/FULL%20STACK%20DEVELOPMENT/PROJECT%20WITH%20AI/SMART%20LIBRARY%20BOOKING/SeatSync-Unified/src/features/librarian/SeatMaintenancePage.jsx))
- **Key Details**: Separates physical seat condition from reservation availability, logs ticket in `seat_maintenance`, updates seat status to `maintenance`.

---

## 15. Realtime Synchronization Algorithm
- **Location**: [useSync.js](file:///c:/FULL%20STACK%20DEVELOPMENT/PROJECT%20WITH%20AI/SMART%20LIBRARY%20BOOKING/SeatSync-Unified/src/hooks/useSync.js)
- **Dashboard Consumers**: All Dashboards
- **Key Details**: Filtered PostgreSQL change listeners on `bookings`, `seats`, `waitlist_entries`, `notifications`, `seat_maintenance`. Includes clean teardown on unmount to prevent duplicate subscriptions or memory leaks.

---

## 16. Transactional Notification-Outbox Algorithm
- **Location**: `17_algorithm_enhancements.sql` -> `notification_outbox` table
- **Key Details**: Mutating RPCs insert pending message records into `notification_outbox` within the transaction. Decouples core database performance from external notification delivery.

---

## 17. Live Occupancy Algorithm
- **Location**: [occupancyService.js](file:///c:/FULL%20STACK%20DEVELOPMENT/PROJECT%20WITH%20AI/SMART%20LIBRARY%20BOOKING/SeatSync-Unified/src/services/occupancyService.js#L252) -> `getOccupancyColorClass()`
- **Dashboard Consumers**: Librarian Live Occupancy Page
- **Formula**: $\text{occupancy percentage} = \frac{\text{checked-in operational seats}}{\text{total operational seats}} \times 100$
- **Color Thresholds**: Green (0–59%), Amber (60–84%), Red (85–100%).

---

## 18. Seat Recommendation Algorithm
- **Location**: [bookingService.js](file:///c:/FULL%20STACK%20DEVELOPMENT/PROJECT%20WITH%20AI/SMART%20LIBRARY%20BOOKING/SeatSync-Unified/src/services/bookingService.js#L402) -> `getRecommendedSeats()`
- **Dashboard Consumers**: Student Find Seat Page ([FindSeat.jsx](file:///c:/FULL%20STACK%20DEVELOPMENT/PROJECT%20WITH%20AI/SMART%20LIBRARY%20BOOKING/SeatSync-Unified/src/features/student/FindSeat.jsx))
- **Key Details**: Weighted score ranking: Power outlet (+30), Quiet zone match (+25), Accessibility (+20), Distance/position heuristic (+0 to +25). Returns top 3 candidate seats.

---

## 19. Search & Server Filtering Algorithms
- **Location**: `03_constraints_and_indexes.sql`, `17_algorithm_enhancements.sql`
- **Dashboard Consumers**: Librarian Booking Lookup, Admin Student Management
- **Key Details**: Uses composite indexes (`idx_bookings_room_date`, `idx_bookings_student_id`, `idx_bookings_slot_id`) and debounced search inputs.

---

## 20. Keyset Pagination Algorithm
- **Location**: [bookingService.js](file:///c:/FULL%20STACK%20DEVELOPMENT/PROJECT%20WITH%20AI/SMART%20LIBRARY%20BOOKING/SeatSync-Unified/src/services/bookingService.js#L436) -> `getMyBookingsPaginated()`
- **Dashboard Consumers**: Student My Reservations, Admin Audit Logs
- **Key Details**: Stable cursor-based ordering `created_at DESC, id DESC` avoiding expensive offset queries on large datasets.

---

## 21. Rate Limiting Algorithm
- **Location**: `17_algorithm_enhancements.sql` -> `user_rate_limits` table & `check_rate_limit()`
- **Key Details**: Token bucket per user action (e.g. max 5 booking attempts per minute). Rejects excess attempts with rate-limit error.

---

## 22. Cache & Invalidation Algorithm
- **Location**: `occupancyService.js`, `slotService.js`
- **Key Details**: In-memory caching for read-heavy availability summaries, invalidated automatically by Realtime postgres change events.

---

## 23. Audit-Log Algorithm
- **Location**: `02_tables_and_relationships.sql` -> `activity_logs` table
- **Key Details**: Append-only audit table storing actor ID, role, action, entity type, entity ID, description, timestamp, metadata. Protected by strict RLS against modification.

---

## 24. Analytics Algorithms
- **Location**: `17_algorithm_enhancements.sql` -> `get_system_analytics_summary()`, [adminService.js](file:///c:/FULL%20STACK%20DEVELOPMENT/PROJECT WITH AI/SMART LIBRARY BOOKING/SeatSync-Unified/src/services/adminService.js#L197)
- **Dashboard Consumers**: Admin Reports & Analytics Page ([ReportsAnalyticsPage.jsx](file:///c:/FULL%20STACK%20DEVELOPMENT/PROJECT%20WITH%20AI/SMART%20LIBRARY%20BOOKING/SeatSync-Unified/src/features/admin/ReportsAnalyticsPage.jsx))
- **Key Details**: Aggregates occupancy rate, completion rate, no-show rate, cancellation rate, waitlist conversion rate.

---

## 25. Demand Forecasting & Anomaly Detection
- **Location**: [adminService.js](file:///c:/FULL%20STACK%20DEVELOPMENT/PROJECT%20WITH%20AI/SMART%20LIBRARY%20BOOKING/SeatSync-Unified/src/services/adminService.js#L217) -> `calculateEMAForecast()`, `detectAnomalies()`
- **Dashboard Consumers**: Admin Reports & Analytics Page
- **Key Details**: Exponential Moving Average (EMA with $\alpha = 0.3$) for next-period slot demand prediction. Rule-based anomaly detector for unusual spikes in no-shows or QR failures.
