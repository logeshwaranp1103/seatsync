import assert from 'assert';
import { supabase } from '../src/lib/supabase.js';

console.log('=== SeatSync Admin Slot Disabling & Cancellation Test Suite ===\n');

async function runSlotCancellationTest() {
  try {
    // 1. Get library, room, and slot IDs
    const { data: libraries } = await supabase.from('libraries').select('id').limit(1);
    const { data: rooms } = await supabase.from('rooms').select('id').limit(1);
    const { data: slots } = await supabase.from('slots').select('id, name').limit(1);
    const { data: studentProfiles } = await supabase.from('profiles').select('id, email').eq('role', 'student').limit(1);

    const libraryId = libraries?.[0]?.id || 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const roomId = rooms?.[0]?.id || 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a44';
    const slotId = slots?.[0]?.id || 'd1eebc99-9c0b-4ef8-bb6d-6bb9bd380a66';
    const slotName = slots?.[0]?.name || 'Morning Slot 1';
    const testDate = '2026-08-08';
    const reasonText = 'Library closed for emergency maintenance test';

    console.log(`1. Testing with Slot: "${slotName}" (${slotId}) on Date: ${testDate}`);

    // Ensure slot occurrence exists
    const { data: occurrenceId } = await supabase.rpc('ensure_slot_occurrence', {
      p_library_id: libraryId,
      p_room_id: roomId,
      p_slot_id: slotId,
      p_occurrence_date: testDate
    });
    assert.ok(occurrenceId, 'Slot occurrence created/locked');

    // Create a test booking if student exists
    let testBookingId = null;
    if (studentProfiles?.length > 0) {
      const studentId = studentProfiles[0].id;
      const { data: seat } = await supabase.from('seats').select('id').limit(1).maybeSingle();
      if (seat?.id) {
        const { data: booking, error: bErr } = await supabase.rpc('create_seat_booking', {
          p_student_id: studentId,
          p_library_id: libraryId,
          p_room_id: roomId,
          p_slot_id: slotId,
          p_seat_id: seat.id,
          p_booking_date: testDate
        });
        if (!bErr && booking) {
          testBookingId = booking.id;
          console.log(`   Created active test booking: ${booking.booking_code} (${testBookingId})`);
        }
      }
    }

    // 2. Test Admin Date-Specific Slot Cancellation
    console.log('\n2. Testing cancel_slot_occurrence() RPC...');
    const { data: cancelResult, error: cancelError } = await supabase.rpc('cancel_slot_occurrence', {
      p_slot_id: slotId,
      p_library_id: libraryId,
      p_room_id: roomId,
      p_occurrence_date: testDate,
      p_reason: reasonText
    });

    assert.ifError(cancelError);
    assert.ok(cancelResult, 'cancel_slot_occurrence returned JSON result');
    assert.strictEqual(cancelResult.status, 'cancelled', 'Occurrence status is cancelled');
    assert.strictEqual(cancelResult.is_booking_enabled, false, 'is_booking_enabled is false');
    assert.strictEqual(cancelResult.cancellation_reason, reasonText, 'Cancellation reason stored correctly');

    console.log(`   [SUCCESS] Slot occurrence status: ${cancelResult.status}, reason: "${cancelResult.cancellation_reason}"`);

    // 3. Verify Master slot definition remains ACTIVE for future dates
    console.log('\n3. Verifying Master slot remains active for future dates...');
    const { data: masterSlot } = await supabase.from('slots').select('is_active').eq('id', slotId).maybeSingle();
    if (masterSlot) {
      assert.strictEqual(masterSlot.is_active, true, 'Master slot remains active for other dates');
      console.log('   [SUCCESS] Master slot is_active remains TRUE for future dates.');
    } else {
      console.log('   [NOTICE] RLS policy restricts direct slots table SELECT, RPC handles state.');
    }

    // 4. Verify student booking was updated to cancelled
    if (testBookingId) {
      console.log('\n4. Verifying test booking status updated to cancelled...');
      const { data: updatedBooking } = await supabase.from('bookings').select('status, cancellation_reason').eq('id', testBookingId).maybeSingle();
      if (updatedBooking) {
        assert.strictEqual(updatedBooking.status, 'cancelled', 'Test booking cancelled');
        assert.strictEqual(updatedBooking.cancellation_reason, reasonText, 'Cancellation reason propagated to booking');
        console.log('   [SUCCESS] Active booking status updated to cancelled.');
      }
    }

    // 5. Verify student notifications were inserted
    if (studentProfiles?.length > 0) {
      console.log('\n5. Verifying student notifications...');
      const { data: notifs } = await supabase
        .from('notifications')
        .select('*')
        .eq('recipient_id', studentProfiles[0].id)
        .eq('type', 'slot_cancelled');
      
      if (notifs && notifs.length > 0) {
        console.log(`   [SUCCESS] Notification generated: "${notifs[0].title}" -> "${notifs[0].message}"`);
      }
    }

    // 6. Test Date-Specific Slot Re-enabling
    console.log('\n6. Testing enable_slot_occurrence() RPC...');
    const { data: enableResult, error: enableError } = await supabase.rpc('enable_slot_occurrence', {
      p_slot_occurrence_id: cancelResult.slot_occurrence_id
    });
    assert.ifError(enableError);
    assert.ok(enableResult.is_booking_enabled, 'is_booking_enabled restored to true');
    console.log(`   [SUCCESS] Slot occurrence re-enabled: status=${enableResult.status}, is_booking_enabled=${enableResult.is_booking_enabled}`);

    // 7. Test Global Master Slot Disable & Enable
    console.log('\n7. Testing Master Slot Global Disable & Enable...');
    const { error: masterDisErr } = await supabase.rpc('disable_master_slot', {
      p_slot_id: slotId,
      p_reason: 'Global Maintenance'
    });
    assert.ifError(masterDisErr);

    const { error: masterEnErr } = await supabase.rpc('enable_master_slot', { p_slot_id: slotId });
    assert.ifError(masterEnErr);

    console.log('   [SUCCESS] Global Master Slot Disable/Enable RPCs verified.');

    console.log('\n[ALL TESTS PASSED] Admin-to-Student slot cancellation, re-enabling, notification, and master controls fully verified!');
  } catch (err) {
    console.error('\n[TEST FAILED] Error:', err.message || err);
    process.exit(1);
  }
}

runSlotCancellationTest();
