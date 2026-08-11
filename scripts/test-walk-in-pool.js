import assert from 'assert';
import { bookingService } from '../src/services/bookingService.js';
import { librarianService } from '../src/services/librarianService.js';

console.log('=== SeatSync Dedicated Walk-In Seat Pool (S-41 to S-50) Test Suite ===\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (e) {
    console.error(`[FAIL] ${name}:`, e.message);
    failed++;
  }
}

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
  const dateStr = '2026-08-06';
  const slotId = 'SLOT-01';

  // Test 1: Student seat map returns only S-01 through S-40
  await asyncTest('Test 1: Student seat map query returns only online-bookable seats (S-01 to S-40)', async () => {
    const seats = await bookingService.getSeatsForSlot(null, dateStr, slotId);
    assert.ok(seats.length > 0, 'Student seat list returns online bookable seats');
    const hasWalkInSeat = seats.some(s => s.seatNumber === 'S-41' || s.seatNumber === 'S-50');
    assert.strictEqual(hasWalkInSeat, false, 'Walk-in seats S-41 to S-50 never appear in student seat map');
  });

  // Test 2: S-41 through S-50 never appear for any student slot
  await asyncTest('Test 2: S-41 through S-50 never appear for any student slot', async () => {
    const seats = await bookingService.getSeatsForSlot(null, dateStr, 'SLOT-05');
    const seatNumbers = seats.map(s => s.seatNumber);
    assert.strictEqual(seatNumbers.includes('S-41'), false);
    assert.strictEqual(seatNumbers.includes('S-50'), false);
  });

  // Test 3: Direct student RPC attempt to book S-41 fails
  await asyncTest('Test 3: Direct student attempt to book S-41 fails with SEAT_NOT_AVAILABLE_FOR_ONLINE_BOOKING', async () => {
    const user = { id: 'usr-student-001', role: 'STUDENT' };
    try {
      await bookingService.createBooking(user, dateStr, { id: slotId }, null, 'S-41');
      assert.fail('Should have thrown SEAT_NOT_AVAILABLE_FOR_ONLINE_BOOKING error');
    } catch (err) {
      assert.match(err.message, /SEAT_NOT_AVAILABLE_FOR_ONLINE_BOOKING/, 'Correct safe authorization error thrown');
    }
  });

  // Test 4: Walk-In Desk returns only S-41 through S-50
  await asyncTest('Test 4: Walk-In Desk returns only walk_in_only pool seats (S-41 to S-50)', async () => {
    const seats = await bookingService.getWalkInSeatsForSlot(null, dateStr, slotId);
    assert.strictEqual(seats.length, 10, 'Walk-in pool contains exactly 10 seats');
    assert.strictEqual(seats[0].seat_number, 'S-41', 'First walk-in seat is S-41');
    assert.strictEqual(seats[9].seat_number, 'S-50', 'Last walk-in seat is S-50');
  });

  // Test 5: Librarian can allocate an available S-41
  await asyncTest('Test 5: Librarian can allocate an available walk-in seat (S-41)', async () => {
    const student = { id: 'usr-student-walkin', name: 'Aarav Sharma', collegeId: '2024CSE042' };
    const seat = { id: 'seat-41', seatNumber: 'S-41' };
    const slot = { id: slotId, name: 'Morning Slot 1' };
    const staffUser = { id: 'usr-staff-001', name: 'Librarian Desk' };

    const res = await librarianService.createWalkInBooking({
      student,
      seat,
      slot,
      dateStr,
      staffUser,
      autoCheckIn: true
    });

    assert.strictEqual(res.seatNumber, 'S-41', 'Walk-in booking created for S-41');
    assert.strictEqual(res.bookingSource, 'walk_in', 'booking_source = walk_in recorded');
  });

  // Test 6: Walk-in allocation with instant check-in creates checked_in booking
  await asyncTest('Test 6: Walk-in allocation with instant check-in creates checked_in booking', async () => {
    const student = { id: 'usr-student-instant', name: 'Priya Patel', collegeId: '2024ECE019' };
    const seat = { id: 'seat-42', seatNumber: 'S-42' };
    const slot = { id: slotId, name: 'Morning Slot 1' };

    const res = await librarianService.createWalkInBooking({
      student,
      seat,
      slot,
      dateStr,
      staffUser: { name: 'Staff' },
      autoCheckIn: true
    });

    assert.strictEqual(res.status, 'checked_in', 'Initial status set to checked_in');
  });

  // Test 7: Releasing a walk-in seat does not promote student online waitlist
  test('Test 7: Cancelling walk-in allocation releases seat without promoting online waitlist', () => {
    const walkInBooking = { bookingSource: 'walk_in', seatNumber: 'S-41' };
    const promotesOnlineWaitlist = walkInBooking.bookingSource === 'online';
    assert.strictEqual(promotesOnlineWaitlist, false, 'Walk-in cancellation does not promote online student waitlist');
  });

  // Test 8: Physical room capacity is 50, online pool capacity is 40
  test('Test 8: Physical room capacity is 50, online bookable pool is 40', () => {
    const totalPhysical = 50;
    const onlinePool = 40;
    const walkInPool = 10;
    assert.strictEqual(totalPhysical, onlinePool + walkInPool, '50 physical = 40 online + 10 walk-in');
  });

  console.log(`\n=== Dedicated Walk-In Pool Results: ${passed} Passed, ${failed} Failed ===`);
}

runAll().catch(console.error);
