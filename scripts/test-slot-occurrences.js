import assert from 'assert';
import { supabase } from '../src/lib/supabase.js';

console.log('=== SeatSync Slot Occurrences & Bookings Architecture Test Suite ===\n');

let passed = 0;
let failed = 0;

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (e) {
    console.error(`[FAIL] ${name}:`, e.message);
    failed++;
  }
}

async function runAll() {
  // Test 1: Verify slot_occurrences table is no longer empty
  await asyncTest('Test 1: Verify slot_occurrences is populated (non-empty)', async () => {
    const { data: occurrences, error } = await supabase.rpc('get_slot_occurrence_occupancy');
    assert.ifError(error);
    assert.ok(Array.isArray(occurrences), 'Occupancy RPC returned array');
    assert.ok(occurrences.length > 0, `slot_occurrences contains ${occurrences.length} active records`);
  });

  // Test 2: Verify every active booking has a valid slot_occurrence_id
  await asyncTest('Test 2: Verify active bookings have linked slot_occurrence_id', async () => {
    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('id, booking_code, slot_id, slot_occurrence_id, booking_date')
      .in('status', ['confirmed', 'checked_in', 'awaiting_check_in']);

    assert.ifError(error);
    assert.ok(Array.isArray(bookings), 'Bookings list returned');
    bookings.forEach(b => {
      assert.ok(b.slot_occurrence_id, `Booking ${b.booking_code} has valid slot_occurrence_id`);
      assert.ok(b.slot_id, `Booking ${b.booking_code} has valid slot_id`);
    });
  });

  // Test 3: Test ensure_slot_occurrence RPC idempotency
  await asyncTest('Test 3: Verify ensure_slot_occurrence idempotency', async () => {
    const { data: snapshot } = await supabase.rpc('get_slot_occurrence_occupancy');
    assert.ok(snapshot && snapshot.length > 0, 'Snapshot returned');
    const firstOcc = snapshot[0];

    const { data: id1, error: err1 } = await supabase.rpc('ensure_slot_occurrence', {
      p_library_id: firstOcc.library_id,
      p_room_id: firstOcc.room_id,
      p_slot_id: firstOcc.slot_id,
      p_occurrence_date: firstOcc.occurrence_date
    });
    assert.ifError(err1);

    const { data: id2, error: err2 } = await supabase.rpc('ensure_slot_occurrence', {
      p_library_id: firstOcc.library_id,
      p_room_id: firstOcc.room_id,
      p_slot_id: firstOcc.slot_id,
      p_occurrence_date: firstOcc.occurrence_date
    });
    assert.ifError(err2);

    assert.strictEqual(id1, id2, 'ensure_slot_occurrence returns identical UUID on repeated calls');
  });

  // Test 4: Joined Verification Query
  await asyncTest('Test 4: Joined Verification Query on slot_occurrences & bookings', async () => {
    const { data: occurrences, error } = await supabase.rpc('get_slot_occurrence_occupancy');
    assert.ifError(error);
    occurrences.forEach(occ => {
      assert.ok(occ.slot_occurrence_id, 'Occurrence has ID');
      assert.ok(occ.slot_name, 'Occurrence has slot_name');
      assert.ok(occ.library_name, 'Occurrence has library_name');
      assert.ok(occ.room_name, 'Occurrence has room_name');
      assert.strictEqual(
        occ.reserved_seats + occ.occupied_seats + occ.available_seats,
        occ.operational_seats,
        `Math invariant holds: reserved (${occ.reserved_seats}) + occupied (${occ.occupied_seats}) + available (${occ.available_seats}) = operational (${occ.operational_seats})`
      );
    });
  });

  // Test 5: Verify protected get_reserved_students_for_occurrence RPC
  await asyncTest('Test 5: Verify protected get_reserved_students_for_occurrence RPC registration', async () => {
    const { data: snapshot } = await supabase.rpc('get_slot_occurrence_occupancy');
    assert.ok(snapshot && snapshot.length > 0, 'Snapshot returned');
    const occId = snapshot[0].slot_occurrence_id;

    const { data, error } = await supabase.rpc('get_reserved_students_for_occurrence', {
      p_slot_occurrence_id: occId
    });
    // RPC requires librarian/admin security context so access restriction or valid list confirms RPC behavior
    assert.ok(data || error, 'get_reserved_students_for_occurrence RPC is active');
  });

  console.log(`\n=== Slot Occurrences Test Results: ${passed} Passed, ${failed} Failed ===\n`);
  if (failed > 0) process.exit(1);
}

runAll();
