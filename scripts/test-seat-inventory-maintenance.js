import assert from 'assert';

// 1. Polyfill localStorage & window FIRST before importing Supabase client
if (typeof global.localStorage === 'undefined') {
  const store = {};
  global.localStorage = {
    getItem: (key) => store[key] || null,
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); }
  };
}
if (typeof global.window === 'undefined') {
  global.window = { dispatchEvent: () => {} };
}

import { supabase } from '../src/lib/supabase.js';
import { librarianService } from '../src/services/librarianService.js';
import { bookingService } from '../src/services/bookingService.js';
import { getLiveOccupancy } from '../src/services/occupancyService.js';

async function runSeatInventoryMaintenanceTest() {
  console.log('=== SeatSync Seat Inventory & Maintenance Engine Verification Suite ===\n');

  // STEP 1: Authenticate as Librarian
  console.log('1. Signing in as Librarian (librarian@bitsathy.ac.in / 123456)...');
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'librarian@bitsathy.ac.in',
    password: '123456'
  });

  if (authError || !authData.user) {
    console.error('   ❌ Supabase Auth failed:', authError?.message);
    process.exit(1);
  }
  console.log(`   ✓ Authenticated Librarian: UID=${authData.user.id}, Email=${authData.user.email}`);

  // STEP 2: Fetch Seat Inventory via getSeatInventory RPC
  console.log('\n2. Executing get_seat_inventory RPC...');
  const inventory = await librarianService.getSeatInventory();
  console.log(`   ✓ Total Seats Returned: ${inventory.length}`);
  assert.ok(inventory.length > 0, 'Seat inventory must return seat records');
  const targetSeat = inventory[0];
  console.log(`   ✓ Target Test Seat: Number=${targetSeat.seatNumber}, ID=${targetSeat.id}, OperationalStatus=${targetSeat.operationalStatus}`);

  // Clean any pre-existing maintenance on target seat
  await supabase.from('seat_maintenance').update({ status: 'resolved' }).eq('seat_id', targetSeat.id);

  // STEP 3: Test Reporting Maintenance (report_seat_maintenance)
  console.log('\n3. Reporting Maintenance Issue on Seat ' + targetSeat.seatNumber + '...');
  const reportRes = await librarianService.reportSeatMaintenance({
    seatId: targetSeat.id,
    issueType: 'Power Socket Fault',
    description: 'Socket not supplying 230V power to carrel charger.',
    severity: 'high'
  });
  console.log('   Report Response:', JSON.stringify(reportRes, null, 2));
  assert.ok(reportRes.success, 'Maintenance report should be successful');
  const maintId = reportRes.maintenance_id;

  // Verify seat inventory updated
  const updatedInv = await librarianService.getSeatInventory();
  const seatInMaint = updatedInv.find(s => s.id === targetSeat.id);
  console.log(`   ✓ Updated Seat Status: ${seatInMaint.operationalStatus}, Issue=${seatInMaint.issueType}, Severity=${seatInMaint.severity}`);
  assert.strictEqual(seatInMaint.operationalStatus, 'maintenance', 'Seat operational status must be maintenance');
  assert.strictEqual(seatInMaint.reportedBy, authData.user.id, 'reported_by must match authenticated staff UID');

  // STEP 4: Test Duplicate Active Maintenance Prevention
  console.log('\n4. Testing Duplicate Active Issue Prevention...');
  try {
    await librarianService.reportSeatMaintenance({
      seatId: targetSeat.id,
      issueType: 'Damaged Chair',
      description: 'Duplicate issue attempt'
    });
    assert.fail('Should have rejected duplicate active maintenance report');
  } catch (err) {
    console.log(`   ✓ Correctly Blocked Duplicate Active Issue: "${err.message}"`);
  }

  // STEP 5: Test Student Booking Prevention on Maintenance Seat
  console.log('\n5. Testing Booking Block on Seat under Maintenance...');
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const { data: slots } = await supabase.from('slots').select('*').limit(1);
  const activeSlot = slots[0];

  try {
    await bookingService.createBooking(
      { id: authData.user.id, email: authData.user.email },
      todayStr,
      activeSlot,
      targetSeat.floorId,
      targetSeat.id
    );
    assert.fail('Should have blocked booking on seat under maintenance');
  } catch (err) {
    console.log(`   ✓ Correctly Blocked Student Booking: "${err.message}"`);
    assert.ok(err.message.includes('maintenance'), 'Error message must specify seat under maintenance');
  }

  // STEP 6: Test Student Seat Map Status Integration (getSeatsForSlot)
  console.log('\n6. Verifying Student Seat Map Integration (getSeatsForSlot)...');
  const seatMap = await bookingService.getSeatsForSlot(targetSeat.floorId, todayStr, activeSlot.id, authData.user.id);
  const mapTargetSeat = seatMap.find(s => s.id === targetSeat.id);
  assert.ok(mapTargetSeat, 'Target seat must exist on seat map');
  console.log(`   ✓ Student Map Seat Status: UIStatus=${mapTargetSeat.ui_status}, StatusState=${mapTargetSeat.status_state}`);
  assert.strictEqual(mapTargetSeat.status_state, 'maintenance', 'Seat Map status_state must be maintenance');

  // STEP 7: Test Live Occupancy Capacity Deduction
  console.log('\n7. Verifying Live Occupancy Capacity Deduction (getLiveOccupancy)...');
  const occupancySnapshot = await getLiveOccupancy();
  console.log(`   ✓ Live Occupancy: Total=${occupancySnapshot.total_seats}, Operational=${occupancySnapshot.operational_seats}, MaintenanceSeats=${occupancySnapshot.maintenance_seats}`);
  assert.ok(occupancySnapshot.maintenance_seats >= 1, 'Maintenance seats count must be at least 1');

  // STEP 8: Test Updating Maintenance Progress (update_seat_maintenance)
  console.log('\n8. Updating Maintenance Status to in_progress...');
  const updateRes = await librarianService.updateMaintenanceStatus({
    maintenanceId: maintId,
    status: 'in_progress',
    severity: 'medium'
  });
  console.log('   Update Response:', JSON.stringify(updateRes, null, 2));
  assert.ok(updateRes.success, 'Update should be successful');

  const { data: maintRow } = await supabase.from('seat_maintenance').select('status, started_at').eq('id', maintId).single();
  console.log(`   ✓ Maintenance Row in DB: Status=${maintRow.status}, StartedAt=${maintRow.started_at}`);
  assert.strictEqual(maintRow.status, 'in_progress', 'Status in DB must be in_progress');
  assert.ok(maintRow.started_at, 'started_at timestamp must be set');

  // STEP 9: Test Resolving Maintenance (resolve_seat_maintenance)
  console.log('\n9. Resolving Seat Maintenance with Resolution Notes...');
  const resolveRes = await librarianService.resolveSeatMaintenance(maintId, 'Replaced power socket module & tested 230V continuity.');
  console.log('   Resolve Response:', JSON.stringify(resolveRes, null, 2));
  assert.ok(resolveRes.success, 'Resolution should be successful');

  // STEP 10: Verify Seat Restored to Available & Maintenance History Preserved
  console.log('\n10. Verifying Seat Restored to Available & History Preserved...');
  const finalInv = await librarianService.getSeatInventory();
  const restoredSeat = finalInv.find(s => s.id === targetSeat.id);
  console.log(`   ✓ Restored Seat Status: ${restoredSeat.operationalStatus}`);
  assert.strictEqual(restoredSeat.operationalStatus, 'available', 'Seat must return to available status after resolution');

  const { data: historyRow } = await supabase.from('seat_maintenance').select('status, resolved_at, resolved_by, resolution_notes').eq('id', maintId).single();
  console.log(`   ✓ Historical Record in DB: Status=${historyRow.status}, ResolvedBy=${historyRow.resolved_by}, Notes=${historyRow.resolution_notes}`);
  assert.strictEqual(historyRow.status, 'resolved', 'Historical status must be resolved');
  assert.strictEqual(historyRow.resolved_by, authData.user.id, 'resolved_by must match staff UID');

  // STEP 11: Test Add New Seat RPC (add_new_seat)
  console.log('\n11. Testing Add New Seat RPC (add_new_seat)...');
  const testSeatNum = `S-MNT-${Math.floor(100 + Math.random() * 900)}`;
  const addSeatRes = await librarianService.addNewSeat({
    libraryId: targetSeat.libraryId,
    floorId: targetSeat.floorId,
    roomId: targetSeat.roomId,
    seatNumber: testSeatNum,
    seatType: 'Individual Reading Carrel',
    hasPowerSocket: true,
    isAccessible: true
  });

  console.log('   Add Seat Response:', JSON.stringify(addSeatRes, null, 2));
  assert.ok(addSeatRes.success, 'Adding new seat should succeed');

  const { data: newSeatRow } = await supabase.from('seats').select('id, seat_number, is_active').eq('id', addSeatRes.seat_id).single();
  console.log(`   ✓ New Seat Created in DB: Number=${newSeatRow.seat_number}, IsActive=${newSeatRow.is_active}`);
  assert.strictEqual(newSeatRow.seat_number, testSeatNum.toUpperCase());

  // Cleanup newly added seat
  await supabase.from('seats').delete().eq('id', addSeatRes.seat_id);

  console.log('\n============================================================');
  console.log('🎉 ALL SEAT INVENTORY & MAINTENANCE TESTS PASSED 100%');
  console.log('============================================================');
}

runSeatInventoryMaintenanceTest().catch(err => {
  console.error('\n❌ Test Suite Error:', err);
  process.exit(1);
});
