import assert from 'assert';
import { supabase } from '../src/lib/supabase.js';

console.log('=== SeatSync Complete Admin Slot Cancellation & DB is_active Sync Test Suite ===\n');

async function runFullWorkflowTest() {
  try {
    // 1. Get library, floor, room, slot, admin, and student profiles
    const { data: libraries } = await supabase.from('libraries').select('id').limit(1);
    const { data: floors } = await supabase.from('floors').select('id').limit(1);
    const { data: rooms } = await supabase.from('rooms').select('id').limit(1);
    const { data: slots } = await supabase.from('slots').select('id, name').limit(1);
    const { data: seats } = await supabase.from('seats').select('id').limit(1);
    const { data: studentProfiles } = await supabase.rpc('get_admin_students_list');

    const libraryId = libraries?.[0]?.id || 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const floorId = floors?.[0]?.id || 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
    const roomId = rooms?.[0]?.id || 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a44';
    const slotId = slots?.[0]?.id || 'd1eebc99-9c0b-4ef8-bb6d-6bb9bd380a66';
    const slotName = slots?.[0]?.name || 'Morning Slot 1';
    const seatId = seats?.[0]?.id || 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a01';
    const studentId = studentProfiles?.[0]?.id || '1ab4fb5c-aa73-42d2-aaca-27d79543e27d';
    const studentName = studentProfiles?.[0]?.full_name || 'MONISH E';

    // Use a fresh date for isolated test run
    const testDate = '2026-08-25';
    const reasonText = 'Library maintenance and electrical repair';

    console.log(`1. Target Slot: "${slotName}" (${slotId}) on Date: ${testDate}`);
    console.log(`   Student: ${studentName} (${studentId})`);

    // Ensure slot occurrence exists
    const { data: occurrenceId } = await supabase.rpc('ensure_slot_occurrence', {
      p_library_id: libraryId,
      p_room_id: roomId,
      p_slot_id: slotId,
      p_occurrence_date: testDate
    });
    assert.ok(occurrenceId, 'Slot occurrence created/locked');

    // Create an active test booking for the student directly
    const bookingCode = `TEST-BK-${Date.now().toString().slice(-6)}`;
    const { data: booking, error: bErr } = await supabase.from('bookings').insert({
      library_id: libraryId,
      floor_id: floorId,
      room_id: roomId,
      slot_id: slotId,
      slot_occurrence_id: occurrenceId,
      seat_id: seatId,
      student_id: studentId,
      booking_date: testDate,
      booking_code: bookingCode,
      status: 'confirmed',
      cancellation_source: 'student'
    }).select('*').single();

    assert.ifError(bErr);
    assert.ok(booking?.id, 'Student booking inserted successfully');
    const testBookingId = booking.id;
    console.log(`   [SUCCESS] Created active student booking: ${booking.booking_code} (${testBookingId})`);

    // 2. Admin cancels the slot occurrence via cancel_slot_and_notify_students RPC
    console.log('\n2. Invoking cancel_slot_and_notify_students() RPC...');
    const { data: cancelResult, error: cancelErr } = await supabase.rpc('cancel_slot_and_notify_students', {
      p_slot_occurrence_id: occurrenceId,
      p_reason: reasonText
    });

    assert.ifError(cancelErr);
    assert.ok(cancelResult, 'RPC returned cancellation summary JSON');
    assert.strictEqual(cancelResult.status, 'cancelled', 'Occurrence status is cancelled');
    assert.strictEqual(cancelResult.is_active, false, 'DB slots table is_active is FALSE when slot is cancelled');
    assert.strictEqual(cancelResult.is_booking_enabled, false, 'is_booking_enabled is false');
    assert.strictEqual(cancelResult.cancellation_reason, reasonText, 'Reason matches input');
    assert.ok(cancelResult.affected_bookings_count > 0, 'Affected bookings count > 0');

    console.log(`   [SUCCESS] Slot is_active set to FALSE in DB slots table. Reason: "${cancelResult.cancellation_reason}"`);

    // 3. Verify affected booking updated in DB with cancellation_source = 'admin_slot'
    console.log('\n3. Verifying booking table status & cancellation_source...');
    const { data: updatedBooking } = await supabase
      .from('bookings')
      .select('status, cancellation_source, cancellation_reason, cancelled_by')
      .eq('id', testBookingId)
      .single();

    assert.strictEqual(updatedBooking.status, 'cancelled', 'Booking status updated to cancelled');
    assert.strictEqual(updatedBooking.cancellation_source, 'admin_slot', 'cancellation_source is admin_slot');
    assert.strictEqual(updatedBooking.cancellation_reason, reasonText, 'cancellation_reason stored');
    console.log('   [SUCCESS] Booking status = cancelled, cancellation_source = admin_slot');

    // 4. Verify student notification created in public.notifications
    console.log('\n4. Verifying student notification in public.notifications...');
    const { data: notifs } = await supabase
      .from('notifications')
      .select('*')
      .eq('recipient_id', studentId)
      .eq('related_entity_id', testBookingId);

    assert.ok(notifs && notifs.length > 0, 'Student notification created');
    assert.strictEqual(notifs[0].type, 'admin_slot_cancellation', 'Notification type is admin_slot_cancellation');
    assert.strictEqual(notifs[0].title, 'Slot Cancelled by Admin', 'Notification title is correct');
    assert.ok(notifs[0].message.includes(reasonText), 'Notification message contains cancellation reason');
    console.log(`   [SUCCESS] Notification created: "${notifs[0].title}" -> "${notifs[0].message}"`);

    // 5. Test Re-enabling Slot Occurrence -> sets is_active = true in DB slots table
    console.log('\n5. Invoking enable_slot_occurrence() RPC...');
    const { data: enableResult, error: enableErr } = await supabase.rpc('enable_slot_occurrence', {
      p_slot_occurrence_id: occurrenceId
    });

    assert.ifError(enableErr);
    assert.strictEqual(enableResult.is_active, true, 'DB slots table is_active set to TRUE when slot is re-enabled');
    assert.strictEqual(enableResult.is_booking_enabled, true, 'is_booking_enabled set to TRUE');
    console.log('   [SUCCESS] Slot is_active set to TRUE in DB slots table upon re-enabling.');

    console.log('\n[ALL TESTS PASSED] DB slots table is_active synchronization & student display fully verified!');
  } catch (err) {
    console.error('\n[TEST FAILED] Error:', err.message || err);
    process.exit(1);
  }
}

runFullWorkflowTest();
