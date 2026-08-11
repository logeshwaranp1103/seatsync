-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 02: NORMALIZED TABLES & RELATIONSHIPS
-- ====================================================================

-- 1. Profiles Table (Referencing auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    email TEXT,
    registration_number TEXT UNIQUE,
    department TEXT,
    year_of_study INTEGER,
    phone TEXT,
    avatar_url TEXT,
    role user_role NOT NULL DEFAULT 'student',
    status account_status NOT NULL DEFAULT 'active',
    blocked_reason TEXT,
    blocked_at TIMESTAMPTZ,
    blocked_by UUID REFERENCES public.profiles(id),
    suspended_until TIMESTAMPTZ,
    no_show_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Libraries Table
CREATE TABLE IF NOT EXISTS public.libraries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    address TEXT,
    description TEXT,
    timezone TEXT DEFAULT 'Asia/Kolkata',
    opening_time TIME DEFAULT '08:00:00',
    closing_time TIME DEFAULT '22:00:00',
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Floors Table
CREATE TABLE IF NOT EXISTS public.floors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    library_id UUID NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    floor_number INTEGER NOT NULL,
    floor_map_path TEXT,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Rooms Table
CREATE TABLE IF NOT EXISTS public.rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    library_id UUID NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
    floor_id UUID NOT NULL REFERENCES public.floors(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    capacity INTEGER NOT NULL CHECK (capacity >= 0),
    opening_time TIME DEFAULT '08:00:00',
    closing_time TIME DEFAULT '22:00:00',
    status room_status NOT NULL DEFAULT 'active',
    closure_reason TEXT,
    closed_at TIMESTAMPTZ,
    closed_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (floor_id, code)
);

-- 5. Seats Table
CREATE TABLE IF NOT EXISTS public.seats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
    seat_number TEXT NOT NULL,
    seat_type TEXT DEFAULT 'Standard',
    has_power_socket BOOLEAN DEFAULT true,
    is_accessible BOOLEAN DEFAULT false,
    status seat_status NOT NULL DEFAULT 'available',
    maintenance_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (room_id, seat_number)
);

-- 6. Slots Table
CREATE TABLE IF NOT EXISTS public.slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    library_id UUID NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
    room_id UUID REFERENCES public.rooms(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    status slot_status NOT NULL DEFAULT 'active',
    effective_date DATE,
    cancellation_reason TEXT,
    disabled_by UUID REFERENCES public.profiles(id),
    disabled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CHECK (end_time > start_time)
);

-- 7. Bookings Table
CREATE TABLE IF NOT EXISTS public.bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_code TEXT UNIQUE NOT NULL,
    student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    library_id UUID NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
    floor_id UUID NOT NULL REFERENCES public.floors(id) ON DELETE CASCADE,
    room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
    seat_id UUID NOT NULL REFERENCES public.seats(id) ON DELETE CASCADE,
    slot_id UUID NOT NULL REFERENCES public.slots(id) ON DELETE CASCADE,
    booking_date DATE NOT NULL,
    status booking_status NOT NULL DEFAULT 'confirmed',
    booking_source TEXT DEFAULT 'online',
    qr_token TEXT,
    checked_in_at TIMESTAMPTZ,
    checked_in_by UUID REFERENCES public.profiles(id),
    checked_out_at TIMESTAMPTZ,
    checked_out_by UUID REFERENCES public.profiles(id),
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID REFERENCES public.profiles(id),
    cancellation_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Waitlist Entries Table
CREATE TABLE IF NOT EXISTS public.waitlist_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    library_id UUID NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
    room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
    slot_id UUID NOT NULL REFERENCES public.slots(id) ON DELETE CASCADE,
    booking_date DATE NOT NULL,
    status waitlist_status NOT NULL DEFAULT 'waiting',
    queue_position INTEGER,
    allocated_booking_id UUID REFERENCES public.bookings(id),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Notifications Table
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    priority TEXT DEFAULT 'NORMAL',
    related_entity_type TEXT,
    related_entity_id UUID,
    is_read BOOLEAN DEFAULT false,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. Check-In Logs Table
CREATE TABLE IF NOT EXISTS public.check_in_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    librarian_id UUID REFERENCES public.profiles(id),
    action TEXT NOT NULL CHECK (action IN ('check_in', 'check_out')),
    method TEXT NOT NULL CHECK (method IN ('qr', 'booking_code', 'manual')),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. Seat Maintenance Table
CREATE TABLE IF NOT EXISTS public.seat_maintenance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seat_id UUID NOT NULL REFERENCES public.seats(id) ON DELETE CASCADE,
    category TEXT DEFAULT 'Broken Frame / Cushion',
    reason TEXT NOT NULL,
    priority TEXT DEFAULT 'Medium',
    status TEXT DEFAULT 'In progress',
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    created_by UUID REFERENCES public.profiles(id),
    completed_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. Staff Assignments Table
CREATE TABLE IF NOT EXISTS public.staff_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    library_id UUID NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
    room_id UUID REFERENCES public.rooms(id) ON DELETE CASCADE,
    duty_date DATE NOT NULL,
    shift_start TIME NOT NULL,
    shift_end TIME NOT NULL,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 13. Booking Policies Table
CREATE TABLE IF NOT EXISTS public.booking_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    library_id UUID UNIQUE NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
    maximum_bookings_per_student INTEGER DEFAULT 2,
    advance_booking_days INTEGER DEFAULT 7,
    cancellation_deadline_minutes INTEGER DEFAULT 30,
    check_in_grace_minutes INTEGER DEFAULT 15,
    maximum_no_show_count INTEGER DEFAULT 3,
    allow_extensions BOOLEAN DEFAULT true,
    maximum_extension_minutes INTEGER DEFAULT 60,
    waitlist_expiration_minutes INTEGER DEFAULT 10,
    allow_walk_in BOOLEAN DEFAULT true,
    allowed_departments TEXT[],
    allowed_years INTEGER[],
    updated_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 14. Activity Logs Table (Append-only)
CREATE TABLE IF NOT EXISTS public.activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES public.profiles(id),
    actor_role TEXT,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id UUID,
    description TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 15. No-Show Records Table
CREATE TABLE IF NOT EXISTS public.no_show_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    booking_id UUID UNIQUE NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
    recorded_by UUID REFERENCES public.profiles(id),
    reason TEXT DEFAULT 'Grace period expired without desk check-in',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
