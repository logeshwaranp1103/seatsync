-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 01: EXTENSIONS & ENUMS
-- ====================================================================

-- 1. Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Custom User Roles Enum
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM (
        'super_admin',
        'admin',
        'senior_librarian',
        'librarian',
        'support_staff',
        'report_viewer',
        'student'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 3. Account Status Enum
DO $$ BEGIN
    CREATE TYPE account_status AS ENUM (
        'active',
        'blocked',
        'suspended',
        'inactive'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 4. Room Status Enum
DO $$ BEGIN
    CREATE TYPE room_status AS ENUM (
        'active',
        'temporarily_closed',
        'inactive'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 5. Seat Status Enum
DO $$ BEGIN
    CREATE TYPE seat_status AS ENUM (
        'available',
        'maintenance',
        'disabled'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 6. Slot Status Enum
DO $$ BEGIN
    CREATE TYPE slot_status AS ENUM (
        'active',
        'disabled',
        'cancelled'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 7. Booking Status Enum
DO $$ BEGIN
    CREATE TYPE booking_status AS ENUM (
        'confirmed',
        'awaiting_check_in',
        'checked_in',
        'completed',
        'cancelled',
        'no_show',
        'expired',
        'slot_cancelled'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 8. Waitlist Status Enum
DO $$ BEGIN
    CREATE TYPE waitlist_status AS ENUM (
        'waiting',
        'allocated',
        'expired',
        'cancelled'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
