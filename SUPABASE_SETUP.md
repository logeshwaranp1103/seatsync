# SeatSync Unified — Complete Supabase Integration & Setup Guide

This document contains step-by-step instructions for deploying, configuring, and verifying the **Supabase Backend** for the **SeatSync Unified** Smart Library Seat Reservation System.

---

## 1. Supabase Project Credentials

- **Supabase URL**: `https://hftpwhuzfoawujspkmpf.supabase.co`
- **Publishable API Key**: `sb_publishable__QIBzlwOumqkB42mfDFXtw_kj8jKBie`

> [!IMPORTANT]
> The browser uses **only** the publishable key. Security, authorization, and data isolation are strictly enforced through PostgreSQL **Row Level Security (RLS)** and **Security Definer RPC Functions**.

---

## 2. Environment Configuration (`.env`)

Create a `.env` file in the project root (`SeatSync-Unified/`):

```env
VITE_SUPABASE_URL=https://hftpwhuzfoawujspkmpf.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable__QIBzlwOumqkB42mfDFXtw_kj8jKBie
```

---

## 3. SQL Migrations Execution Order

Navigate to your **Supabase Dashboard** -> **SQL Editor** and run the migration scripts located in `supabase/migrations/` in the exact sequence below:

1. `01_extensions_and_enums.sql`: Enables `uuid-ossp`, `pgcrypto`, and creates domain enums (`user_role`, `account_status`, `room_status`, `seat_status`, `slot_status`, `booking_status`, `waitlist_status`).
2. `02_tables_and_relationships.sql`: Creates all 15 normalized tables (`profiles`, `libraries`, `floors`, `rooms`, `seats`, `slots`, `bookings`, `waitlist_entries`, `notifications`, `check_in_logs`, `seat_maintenance`, `staff_assignments`, `booking_policies`, `activity_logs`, `no_show_records`).
3. `03_constraints_and_indexes.sql`: Creates partial unique indexes preventing overlapping seat/date/slot bookings and duplicate active waitlists.
4. `04_auth_profile_trigger.sql`: Binds `handle_new_user_signup()` trigger to `auth.users` for automatic profile creation.
5. `05_updated_at_triggers.sql`: Auto-updates `updated_at` timestamps across all tables.
6. `06_helper_rls_functions.sql`: Adds `is_admin()`, `is_librarian_or_admin()`, `is_active_user()`, `can_manage_library(id)`.
7. `07_row_level_security.sql`: Enables RLS on all 15 tables with role-based read/write access policies.
8. `08_transactional_booking_rpcs.sql`: Defines `create_booking` and `cancel_booking` transactional RPCs.
9. `09_waitlist_rpcs.sql`: Defines `join_waitlist` and `allocate_next_waitlisted_student` FIFO RPCs.
10. `10_checkin_checkout_rpcs.sql`: Defines `check_in_booking` and `check_out_booking` desk verification RPCs.
11. `11_admin_ops_rpcs.sql`: Defines `set_user_account_status`, `disable_slot`, `set_room_status`, `set_seat_maintenance` admin RPCs.
12. `12_seed_data.sql`: Seeds Central University Library, 2 floors, 40 seats (A-101 to A-140), time slots, and default booking policies.
13. `13_automation_cron_jobs.sql`: Creates `automation_execution_logs` table, `SECURITY DEFINER` automation functions, and registers 5-minute recurring `pg_cron` schedules.
14. `14_waitlist_demo_scenario.sql`: Creates test scenario metadata and transactional `prepare_waitlist_demo_scenario` RPC.
15. `15_real_supabase_auth.sql`: Adds `staff_id`, `admin_id`, `login_identifier` columns, lower-case unique indexes, and `fn_get_auth_email_by_identifier` RPC for secure Staff/Admin ID login email resolution without account enumeration.

---

## 4. Method for Creating Accounts in Supabase

### A. Creating the First Super Admin
1. Open Supabase Dashboard -> **Authentication** -> **Users** -> Click **Add User** -> **Create User**.
2. Email: `admin@college.edu`
3. Password: Set a strong password.
4. Go to **SQL Editor** and promote the user profile to Super Admin:
```sql
UPDATE public.profiles
SET role = 'super_admin',
    admin_id = 'ADM001',
    login_identifier = 'adm001',
    status = 'active'
WHERE email = 'admin@college.edu';
```

### B. Inviting Librarians & Staff
1. Admin Dashboard -> **Staff Management** (`/admin/staff`).
2. Add Staff Member with Staff ID (e.g. `STAFF001`), Registered Email (`staff@college.edu`), and Role (`librarian`).
3. Or create via Supabase Dashboard -> **Authentication** -> **Invite User**, then set `staff_id = 'STAFF001'` in `public.profiles`.

### C. Student Self-Registration
1. Students register directly on the frontend at `/signup`.
2. Input: Full Name, Registration Number (`2024CSE001`), Department, Year, Email, Password.
3. Automatically assigns `role = 'student'` and `login_identifier = lower(email)`.

---

## 5. Enabling Realtime Tables

In the **Supabase Dashboard**:
1. Go to **Database** -> **Publications**.
2. Select `supabase_realtime`.
3. Enable replication for tables:
   - `profiles`
   - `bookings`
   - `seats`
   - `rooms`
   - `slots`
   - `waitlist_entries`
   - `notifications`
