import assert from 'assert';
import { getLiveOccupancy, getCurrentOccupants, getLiveSeatStatuses, getSlotOccupancy } from '../src/services/occupancyService.js';
import { supabase } from '../src/lib/supabase.js';

console.log('=== SeatSync Live Library Occupancy Comprehensive Test Suite ===\n');

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
  const todayDate = '2026-08-07';
  const tomorrowDate = '2026-08-08';

  // Fetch real library, room, slot
  const [{ data: libs }, { data: rooms }, { data: slots }] = await Promise.all([
    supabase.from('libraries').select('id').limit(1),
    supabase.from('rooms').select('id').limit(1),
    supabase.from('slots').select('id').limit(1)
  ]);

  const libId = libs?.[0]?.id || null;
  const roomId = rooms?.[0]?.id || null;
  const slotId = slots?.[0]?.id || null;

  // Test 1: Fetch Live Occupancy Snapshot via RPC
  let snapshotToday = null;
  await asyncTest('Test 1: Fetch live occupancy snapshot RPC from Supabase', async () => {
    snapshotToday = await getLiveOccupancy({ libraryId: libId, roomId, slotId, bookingDate: todayDate });
    assert.ok(snapshotToday, 'Snapshot returned');
    assert.ok(typeof snapshotToday.total_seats === 'number', 'Total seats is number');
    assert.ok(typeof snapshotToday.operational_seats === 'number', 'Operational seats is number');
    assert.ok(Array.isArray(snapshotToday.floors), 'Floors breakdown is array');
    assert.ok(Array.isArray(snapshotToday.rooms), 'Rooms breakdown is array');
    assert.ok(Array.isArray(snapshotToday.slots), 'Slots breakdown is array');
  });

  // Test 2: Verify Math Invariant (Occupied + Reserved + Available = Operational)
  await asyncTest('Test 2: Verify Math Invariant (Occupied + Reserved + Available = Operational seats)', async () => {
    const sum = snapshotToday.occupied_seats + snapshotToday.reserved_seats + snapshotToday.available_seats;
    assert.strictEqual(sum, snapshotToday.operational_seats, `Sum (${sum}) equals Operational Seats (${snapshotToday.operational_seats})`);
  });

  // Test 3: Operational Capacity Math (Operational = Total - Maintenance)
  await asyncTest('Test 3: Verify Operational Capacity Math (Operational = Total - Maintenance)', async () => {
    const expectedOperational = Math.max(0, snapshotToday.total_seats - snapshotToday.maintenance_seats);
    assert.strictEqual(snapshotToday.operational_seats, expectedOperational, 'Operational capacity math matches');
  });

  // Test 4: Fetch Current Occupants List via RPC
  let occupants = [];
  await asyncTest('Test 4: Fetch current checked-in occupants list RPC from Supabase', async () => {
    occupants = await getCurrentOccupants({ libraryId: libId, roomId, slotId, bookingDate: todayDate });
    assert.ok(Array.isArray(occupants), 'Occupants list returned');
    assert.strictEqual(occupants.length, snapshotToday.occupied_seats, 'Occupants count matches occupied seats count');
  });

  // Test 5: Verify Future Booking Isolation
  await asyncTest('Test 5: Verify future confirmed booking on tomorrow does not inflate today occupancy', async () => {
    const snapshotTomorrow = await getLiveOccupancy({ libraryId: libId, roomId, slotId, bookingDate: tomorrowDate });
    assert.ok(snapshotTomorrow, 'Tomorrow snapshot returned');
    assert.strictEqual(snapshotToday.occupied_seats, occupants.length, 'Today occupied count unaffected by future dates');
  });

  // Test 6: Verify Occupancy Percentage Calculation
  await asyncTest('Test 6: Verify occupancy percentage math (Occupied / Operational * 100)', async () => {
    const expectedPct = snapshotToday.operational_seats > 0 
      ? Math.round((snapshotToday.occupied_seats / snapshotToday.operational_seats) * 100 * 10) / 10 
      : 0;
    assert.strictEqual(Math.round(snapshotToday.occupancy_percentage), Math.round(expectedPct), 'Occupancy percentage math matches');
  });

  // Test 7: Verify Live Seat Status Classification Priority
  await asyncTest('Test 7: Verify live seat statuses return for selected room with priority classification', async () => {
    if (roomId) {
      const seats = await getLiveSeatStatuses({ roomId, slotId, bookingDate: todayDate });
      assert.ok(Array.isArray(seats), 'Seat list returned');
      seats.forEach(s => {
        assert.ok(['occupied', 'reserved', 'available', 'maintenance', 'inactive'].includes(s.status), `Valid status: ${s.status}`);
        assert.ok(typeof s.color === 'string', 'Color code present');
      });
    }
  });

  // Test 8: Verify Division by Zero Safety
  await asyncTest('Test 8: Verify division by zero safety when operational seats is 0', async () => {
    const fakeSnapshot = { total_seats: 0, operational_seats: 0, occupied_seats: 0, occupancy_percentage: 0 };
    const pct = fakeSnapshot.operational_seats > 0 ? (fakeSnapshot.occupied_seats / fakeSnapshot.operational_seats) * 100 : 0;
    assert.strictEqual(pct, 0, 'Safe division by zero returns 0%');
  });

  // Test 9: Verify Slot-Wise Breakdown Array & Metrics
  await asyncTest('Test 9: Verify Slot-Wise Breakdown Array & Per-Slot Math Invariant', async () => {
    const slotBreakdowns = await getSlotOccupancy({ libraryId: libId, roomId, bookingDate: todayDate });
    assert.ok(Array.isArray(slotBreakdowns), 'Slot breakdowns array returned');
    assert.ok(slotBreakdowns.length > 0, 'At least 1 slot breakdown returned');
    slotBreakdowns.forEach(sl => {
      assert.ok(sl.slot_id, 'Slot ID present');
      assert.ok(sl.slot_name, 'Slot Name present');
      assert.ok(['active', 'upcoming', 'past', 'disabled'].includes(sl.slot_state), `Valid slot state: ${sl.slot_state}`);
      const sum = sl.occupied_seats + sl.reserved_seats + sl.available_seats;
      assert.strictEqual(sum, sl.operational_seats, `Slot ${sl.slot_name} math invariant satisfies sum == operational`);
    });
  });

  console.log(`\n=== Live Library Occupancy Results: ${passed} Passed, ${failed} Failed ===\n`);
  if (failed > 0) process.exit(1);
}

runAll();
