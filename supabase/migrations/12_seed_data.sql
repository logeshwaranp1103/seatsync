-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 12: SEED DATA
-- ====================================================================

-- 1. Insert Main Library
INSERT INTO public.libraries (id, name, code, address, description, timezone, opening_time, closing_time, status)
VALUES (
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'Central University Library',
    'MAIN-LIB-01',
    'Tech Campus, Block A, Main Academic Quad',
    'Primary university smart library with high-speed Wi-Fi, quiet zones, and ergonomic seating.',
    'Asia/Kolkata',
    '08:00:00',
    '22:00:00',
    'active'
)
ON CONFLICT (code) DO NOTHING;

-- 2. Insert Floors
INSERT INTO public.floors (id, library_id, name, floor_number, status)
VALUES 
    ('b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Ground Floor (Main Hall)', 0, 'active'),
    ('b2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'First Floor (Silent Zone)', 1, 'active')
ON CONFLICT DO NOTHING;

-- 3. Insert Rooms
INSERT INTO public.rooms (id, library_id, floor_id, name, code, capacity, status)
VALUES 
    ('c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a44', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22', 'Ground Floor Main Reading Zone', 'GF-ROOM-01', 40, 'active'),
    ('c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a55', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'b2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', 'First Floor Silent Study Pods', 'FF-ROOM-02', 20, 'active')
ON CONFLICT DO NOTHING;

-- 4. Insert 40 Seats for Ground Floor Main Reading Zone (A-101 to A-140)
DO $$
DECLARE
    i INT;
    seat_num TEXT;
BEGIN
    FOR i IN 101..140 LOOP
        seat_num := 'A-' || i;
        INSERT INTO public.seats (room_id, seat_number, seat_type, has_power_socket, is_accessible, status)
        VALUES (
            'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a44',
            seat_num,
            CASE WHEN i % 5 = 0 THEN 'Window Special' WHEN i % 3 = 0 THEN 'Power Ergonomic' ELSE 'Standard Desk' END,
            CASE WHEN i % 2 = 0 THEN true ELSE false END,
            CASE WHEN i = 101 OR i = 102 THEN true ELSE false END,
            'available'
        )
        ON CONFLICT (room_id, seat_number) DO NOTHING;
    END LOOP;
END $$;

-- 5. Insert Operational Time Slots
INSERT INTO public.slots (id, library_id, room_id, name, start_time, end_time, status)
VALUES 
    ('d1eebc99-9c0b-4ef8-bb6d-6bb9bd380a66', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a44', 'Morning Slot 1 (08:00 AM - 09:00 AM)', '08:00:00', '09:00:00', 'active'),
    ('d2eebc99-9c0b-4ef8-bb6d-6bb9bd380a77', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a44', 'Morning Slot 2 (09:00 AM - 10:00 AM)', '09:00:00', '10:00:00', 'active'),
    ('d3eebc99-9c0b-4ef8-bb6d-6bb9bd380a88', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a44', 'Late Morning (10:00 AM - 11:00 AM)', '10:00:00', '11:00:00', 'active'),
    ('d4eebc99-9c0b-4ef8-bb6d-6bb9bd380a99', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a44', 'Midday Slot (11:00 AM - 12:00 PM)', '11:00:00', '12:00:00', 'active'),
    ('d5eebc99-9c0b-4ef8-bb6d-6bb9bd380b11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a44', 'Afternoon Session 1 (01:00 PM - 02:00 PM)', '13:00:00', '14:00:00', 'active'),
    ('d6eebc99-9c0b-4ef8-bb6d-6bb9bd380b22', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a44', 'Afternoon Session 2 (02:00 PM - 03:00 PM)', '14:00:00', '15:00:00', 'active'),
    ('d7eebc99-9c0b-4ef8-bb6d-6bb9bd380b33', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a44', 'Evening Slot (04:00 PM - 05:00 PM)', '16:00:00', '17:00:00', 'active')
ON CONFLICT DO NOTHING;

-- 6. Insert Default Booking Policy
INSERT INTO public.booking_policies (
    library_id,
    maximum_bookings_per_student,
    advance_booking_days,
    cancellation_deadline_minutes,
    check_in_grace_minutes,
    maximum_no_show_count,
    allow_extensions,
    maximum_extension_minutes,
    waitlist_expiration_minutes,
    allow_walk_in,
    allowed_departments,
    allowed_years
)
VALUES (
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    2,
    7,
    30,
    15,
    3,
    true,
    60,
    10,
    true,
    ARRAY['Computer Science', 'Information Technology', 'Artificial Intelligence', 'Electronics'],
    ARRAY[1, 2, 3, 4]
)
ON CONFLICT (library_id) DO NOTHING;
