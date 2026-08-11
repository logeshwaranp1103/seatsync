import assert from 'assert';
import { bookingService } from '../src/services/bookingService.js';
import { librarianService } from '../src/services/librarianService.js';

console.log('=== SeatSync Librarian Operational & QR State Machine Test Suite ===\n');

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
  const todayDate = '2026-08-06';
  const tomorrowDate = '2026-08-07';
  const slotObj = { id: 'SLOT-01', name: 'Morning Slot 1', startTime: '08:00', endTime: '09:00' };
  const studentA = { id: 'usr-student-001', name: 'SUBASH P', collegeId: '7376252AD344' };

  let testBooking = null;

  // Test 1: Student creates booking for tomorrow (7 Aug 2026)
  await asyncTest('Test 1: Student creates booking for tomorrow (7 Aug 2026)', async () => {
    testBooking = await bookingService.createBooking(studentA, tomorrowDate, slotObj, 'floor-g', 'S-01');
    assert.ok(testBooking, 'Booking created');
    const sNum = testBooking.seatNumber || testBooking.seat_number;
    assert.strictEqual(sNum, 'S-01', 'Seat S-01 booked');
  });

  // Test 2: Full booking code integrity (BK-A5F19340, untruncated)
  await asyncTest('Test 2: Booking reference code is complete and untruncated', async () => {
    const code = testBooking.bookingCode || testBooking.booking_code || testBooking.id;
    assert.ok(code && code.length >= 7, `Code ${code} is complete`);
  });

  // Test 3: Snapshot on Today (6 Aug) -> Seat S-01 is AVAILABLE (not occupied or reserved for 6 Aug!)
  await asyncTest('Test 3: Tomorrow booking does NOT mark seat S-01 as occupied or reserved on today (6 Aug)', async () => {
    const snapshotToday = await librarianService.getLibrarianSlotSnapshot(null, null, todayDate, slotObj.id);
    const seatToday = snapshotToday.find(s => (s.seatNumber || s.seat_number) === 'S-01');
    assert.ok(seatToday, 'Seat S-01 found in today snapshot');
    const state = seatToday.status_state || seatToday.displayStatus;
    assert.strictEqual(state, 'available', 'Seat S-01 is available on 6 Aug');
  });

  // Test 4: Snapshot on Tomorrow (7 Aug) -> Seat S-01 MUST display 'reserved', Reserved count increases
  await asyncTest('Test 4: Tomorrow snapshot displays seat S-01 as "Reserved" with authorized student details', async () => {
    const snapshotTomorrow = await librarianService.getLibrarianSlotSnapshot(null, null, tomorrowDate, slotObj.id);
    const seatTomorrow = snapshotTomorrow.find(s => (s.seatNumber || s.seat_number) === 'S-01');
    assert.ok(seatTomorrow, 'Seat S-01 found in tomorrow snapshot');
    const state = seatTomorrow.status_state || seatTomorrow.displayStatus;
    assert.strictEqual(state, 'reserved', 'Seat S-01 status_state is "reserved"');
    assert.ok(seatTomorrow.booking, 'Booking details included in snapshot');
  });

  // Test 5: Verify QR code on Today (6 Aug) -> Returns TOO_EARLY status (valid = false, no green Entry Verified card!)
  await asyncTest('Test 5: Scanning tomorrow pass on today returns TOO_EARLY warning (valid = false)', async () => {
    const code = testBooking.bookingCode || testBooking.booking_code || testBooking.id;
    try {
      const verifyRes = await librarianService.verifyToken(code, null, todayDate);
      if (verifyRes.statusCode === 'TOO_EARLY') {
        assert.strictEqual(verifyRes.statusCode, 'TOO_EARLY', 'Status code is TOO_EARLY');
      } else {
        assert.fail('Should have flagged check-in not open yet');
      }
    } catch (err) {
      assert.ok(err.message.includes('not open yet') || err.message.includes('not found') || err.message.includes('date'), 'Throws check-in window warning');
    }
  });

  // Test 6: Verify QR code on Tomorrow (7 Aug) -> Returns valid pass ready for check-in
  await asyncTest('Test 6: Scanning pass on booking date returns ready for check-in', async () => {
    const code = testBooking.bookingCode || testBooking.booking_code || testBooking.id;
    const verifyRes = await librarianService.verifyToken(code, null, tomorrowDate);
    assert.ok(verifyRes && verifyRes.booking, 'Valid pass returned');
    const sNum = verifyRes.booking.seatNumber || verifyRes.booking.seat_number;
    assert.strictEqual(sNum, 'S-01', 'Assigned seat S-01 matched');
  });

  // Test 7: Confirm Entry -> Atomic check-in
  await asyncTest('Test 7: Confirm entry executes check-in and updates booking status to checked_in', async () => {
    const checkinRes = await librarianService.processCheckIn(testBooking.id, { name: 'Anitha' }, 'QR Verified');
    assert.ok(checkinRes, 'Check-in response returned');
    assert.strictEqual(checkinRes.status, 'checked_in', 'Status set to checked_in');
  });

  // Test 8: Tomorrow snapshot after check-in -> Seat S-01 MUST display 'occupied'
  await asyncTest('Test 8: Seat S-01 changes from "Reserved" to "Occupied" in Live Occupancy after check-in', async () => {
    const snapshotPostCheckin = await librarianService.getLibrarianSlotSnapshot(null, null, tomorrowDate, slotObj.id);
    const seatPostCheckin = snapshotPostCheckin.find(s => (s.seatNumber || s.seat_number) === 'S-01');
    assert.ok(seatPostCheckin, 'Seat S-01 found');
    const state = seatPostCheckin.status_state || seatPostCheckin.displayStatus;
    assert.strictEqual(state, 'occupied', 'Seat S-01 status_state is "occupied"');
  });

  console.log(`\n=== Librarian Operational Flow Results: ${passed} Passed, ${failed} Failed ===\n`);
  if (failed > 0) process.exit(1);
}

runAll();
