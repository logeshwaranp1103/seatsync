import assert from 'assert';
import { bookingService } from '../src/services/bookingService.js';
import { librarianService } from '../src/services/librarianService.js';
import { adminService } from '../src/services/adminService.js';
import { occupancyService } from '../src/services/occupancyService.js';

console.log('=== SeatSync End-to-End Dashboard Interconnection Test Suite ===\n');

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
  const dateStr = '2026-08-07';
  const slotId = 'SLOT-01';
  const studentA = { id: 'usr-student-001', name: 'Subash P', collegeId: '24AD042' };
  const studentB = { id: 'usr-student-002', name: 'Aarav Sharma', collegeId: '24AD043' };

  // Test 1: Student A creates booking
  await asyncTest('Test 1: Student A creates booking committed to database', async () => {
    const res = await bookingService.createBooking(studentA, dateStr, { id: slotId }, 'floor-g', 'S-12');
    assert.ok(res, 'Booking response returned');
    assert.strictEqual(res.seat_number || res.seatNumber, 'S-12', 'Seat S-12 booked');
  });

  // Test 2: Student A sees booking in My Reservations
  await asyncTest('Test 2: Student A sees confirmed booking in My Reservations', async () => {
    const myBookings = await bookingService.getStudentBookings(studentA.id);
    assert.ok(myBookings.length > 0, 'Student A has active reservations');
    const b = myBookings.find(x => x.bookingDate === dateStr);
    assert.ok(b, 'Booking found for date');
    assert.strictEqual(b.seatNumber, 'S-12', 'Seat S-12 matches');
  });

  // Test 3: Student B cannot book same seat in same slot
  await asyncTest('Test 3: Student B cannot book same seat S-12 in same slot (Double Booking Prevention)', async () => {
    try {
      await bookingService.createBooking(studentB, dateStr, { id: slotId }, 'floor-g', 'S-12');
      assert.fail('Should have rejected double booking');
    } catch (err) {
      assert.ok(err.message.includes('already') || err.message.includes('taken') || err.message.includes('SEAT_ALREADY_BOOKED'), 'Rejection error thrown');
    }
  });

  // Test 4: Student A cannot book another seat in same slot (Student Overlap Prevention)
  await asyncTest('Test 4: Student A cannot book another seat in same slot (Slot Overlap Prevention)', async () => {
    try {
      await bookingService.createBooking(studentA, dateStr, { id: slotId }, 'floor-g', 'S-15');
      assert.fail('Should have rejected slot overlap');
    } catch (err) {
      assert.ok(err.message.includes('active reservation') || err.message.includes('STUDENT_OVERLAP'), 'Overlap error thrown');
    }
  });

  // Test 5: Librarian Dashboard sees Student A's booking with full details
  await asyncTest('Test 5: Librarian Dashboard fetches Student A booking with full student details', async () => {
    const operational = await librarianService.getOperationalBookings(null, dateStr, slotId);
    assert.ok(operational.length > 0, 'Operational bookings returned');
    const matched = operational.find(b => b.seatNumber === 'S-12');
    assert.ok(matched, 'Matching seat S-12 booking found');
    assert.strictEqual(matched.studentName, studentA.name, 'Student name matches');
    assert.strictEqual(matched.studentRegistrationNumber, studentA.collegeId, 'Register ID matches');
  });

  // Test 6: Admin Dashboard sees Student A's booking
  await asyncTest('Test 6: Admin Dashboard fetches same booking with identical ID and status', async () => {
    const adminBookings = await adminService.getOperationalBookings(null, dateStr, slotId);
    assert.ok(adminBookings.length > 0, 'Admin operational bookings returned');
    const matched = adminBookings.find(b => b.seatNumber === 'S-12');
    assert.ok(matched, 'Matching admin booking found');
    assert.strictEqual(matched.status, 'confirmed', 'Status matches confirmed');
  });

  // Test 7: Student seat map marks S-12 as unavailable / user_booked
  await asyncTest('Test 7: Student seat map marks seat S-12 as unavailable / booked by user', async () => {
    const seats = await bookingService.getSeatsForSlot('floor-g', dateStr, slotId, studentA.id);
    const seat12 = seats.find(s => s.seatNumber === 'S-12');
    assert.ok(seat12, 'Seat S-12 exists');
    assert.strictEqual(seat12.isUserBooked, true, 'isUserBooked is true for Student A');
    assert.strictEqual(seat12.ui_status, 'Booked by You', 'ui_status is Booked by You');
  });

  // Test 8: Live Occupancy reflects capacity and reservation count
  await asyncTest('Test 8: Live Occupancy reflects total capacity and reserved count', async () => {
    const occ = await occupancyService.getOccupancy({ bookingDate: dateStr, slotId });
    assert.strictEqual(occ.totalCapacity, 50, 'Total physical capacity is 50');
    assert.ok(occ.reservedCount > 0, 'Reserved count is updated');
  });

  console.log(`\n=== End-to-End Interconnection Results: ${passed} Passed, ${failed} Failed ===`);
}

runAll().catch(console.error);
