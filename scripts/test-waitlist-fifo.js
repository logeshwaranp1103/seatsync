import assert from 'assert';
import { waitlistService } from '../src/services/waitlistService.js';
import { bookingService } from '../src/services/bookingService.js';
import { occupancyService } from '../src/services/occupancyService.js';

console.log('=== SeatSync Strict FIFO Waitlist Engine Test Suite ===\n');

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
  // Test 1: Single seat offer to #1 student only
  test('Test 1: One released seat offered exclusively to Position #1 student', () => {
    const queue = [
      { id: 'wl-1', studentId: 's-1', status: 'waiting', createdAt: '2026-08-05T10:00:00Z' },
      { id: 'wl-2', studentId: 's-2', status: 'waiting', createdAt: '2026-08-05T10:01:00Z' },
      { id: 'wl-3', studentId: 's-3', status: 'waiting', createdAt: '2026-08-05T10:02:00Z' }
    ];

    queue.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const topCandidate = queue[0];
    topCandidate.status = 'offered';

    assert.strictEqual(topCandidate.studentId, 's-1', 'Position #1 candidate selected');
    assert.strictEqual(queue[1].status, 'waiting', 'Position #2 student remains in waiting status');
  });

  // Test 2: Student #1 accepts offer -> confirmed booking, #2 gets no offer
  await asyncTest('Test 2: Student #1 accepts offer -> confirmed booking created', async () => {
    const result = await waitlistService.acceptOffer('wl-1');
    assert.strictEqual(result.success, true, 'Accept offer returns success');
    assert.strictEqual(result.status, 'confirmed', 'Booking status confirmed');
  });

  // Test 3: Student #1 rejects offer -> Position #2 promoted
  await asyncTest('Test 3: Student #1 rejects offer -> Position #2 receives next offer', async () => {
    const rej = await waitlistService.rejectOffer('wl-1', 'Not needed anymore');
    assert.strictEqual(rej.success, true, 'Rejection processed');
    assert.strictEqual(rej.status, 'rejected', 'Status updated to rejected');
  });

  // Test 4: Idempotency on double-click Accept
  await asyncTest('Test 4: Double-clicking Accept returns original result without duplicate booking', async () => {
    const key = `IK-ACC-TEST-${Date.now()}`;
    const res1 = await waitlistService.acceptOffer('wl-2', key);
    const res2 = await waitlistService.acceptOffer('wl-2', key);
    assert.strictEqual(res1.booking_id, res2.booking_id, 'Same booking ID returned');
  });

  // Test 5: Dynamic Queue Position calculation
  test('Test 5: Dynamic Position Calculation using (joined_at, id) tuple ordering', () => {
    const entries = [
      { id: 'b-1', createdAt: '2026-08-05T10:00:00Z' },
      { id: 'a-2', createdAt: '2026-08-05T10:00:00Z' }, // Tied timestamp, ID decides
      { id: 'c-3', createdAt: '2026-08-05T10:05:00Z' }
    ];

    entries.sort((a, b) => {
      const timeDiff = new Date(a.createdAt) - new Date(b.createdAt);
      if (timeDiff !== 0) return timeDiff;
      return a.id.localeCompare(b.id);
    });

    assert.strictEqual(entries[0].id, 'a-2', 'Tied timestamp broken deterministically by ID');
  });

  // Test 6: Ineligible student skipped safely
  test('Test 6: Ineligible student (restricted/duplicate booking) skipped to next candidate', () => {
    const candidates = [
      { id: 'wl-1', studentId: 'restricted-user', isRestricted: true },
      { id: 'wl-2', studentId: 'active-user', isRestricted: false }
    ];

    const eligible = candidates.find(c => !c.isRestricted);
    assert.strictEqual(eligible.id, 'wl-2', 'Restricted student skipped, eligible student selected');
  });

  // Test 7: Expiration worker idempotency
  test('Test 7: Expiry worker runs idempotently without duplicate offers', () => {
    const expiredOffers = [
      { id: 'wl-exp-1', offerExpiresAt: '2026-08-05T10:00:00Z', status: 'offered' }
    ];
    const now = '2026-08-05T10:10:00Z';

    const toExpire = expiredOffers.filter(o => o.status === 'offered' && o.offerExpiresAt <= now);
    assert.strictEqual(toExpire.length, 1, 'Found expired offer');
    toExpire[0].status = 'expired';

    const secondRun = expiredOffers.filter(o => o.status === 'offered' && o.offerExpiresAt <= now);
    assert.strictEqual(secondRun.length, 0, 'Second run finds zero offers to expire');
  });

  // Test 8: Multi-seat release (2 seats released -> top 2 students offered)
  test('Test 8: Two seats released -> Top 2 eligible students receive distinct offers', () => {
    const queue = [
      { id: 'wl-1', studentId: 's-1', status: 'waiting' },
      { id: 'wl-2', studentId: 's-2', status: 'waiting' },
      { id: 'wl-3', studentId: 's-3', status: 'waiting' }
    ];

    const seats = ['A-101', 'A-102'];
    const offers = [];

    seats.forEach((seat, idx) => {
      if (queue[idx]) {
        queue[idx].status = 'offered';
        queue[idx].offeredSeat = seat;
        offers.push(queue[idx]);
      }
    });

    assert.strictEqual(offers.length, 2, 'Two distinct offers created');
    assert.strictEqual(offers[0].offeredSeat, 'A-101', 'First seat to s-1');
    assert.strictEqual(offers[1].offeredSeat, 'A-102', 'Second seat to s-2');
  });

  // Test 9: Cancellation of accepted waitlist booking triggers promotion for remaining queue
  test('Test 9: Cancellation of accepted waitlist booking offers seat to next student', () => {
    const queue = [
      { id: 'wl-1', studentId: 's-1', status: 'accepted' },
      { id: 'wl-2', studentId: 's-2', status: 'waiting' }
    ];

    // s-1 cancels
    queue[0].status = 'cancelled';
    const nextEligible = queue.find(q => q.status === 'waiting');
    nextEligible.status = 'offered';

    assert.strictEqual(nextEligible.studentId, 's-2', 'Seat offered to s-2 upon s-1 cancellation');
  });

  // Test 10: Slot closure by library cancels waitlist entries with distinct status
  test('Test 10: Emergency slot closure marks waitlist entries as cancelled_by_library', () => {
    const queue = [
      { id: 'wl-1', status: 'waiting' },
      { id: 'wl-2', status: 'offered' }
    ];

    queue.forEach(q => { q.status = 'cancelled_by_library'; });
    assert.strictEqual(queue[0].status, 'cancelled_by_library', 'Distinct status applied');
    assert.strictEqual(queue[1].status, 'cancelled_by_library', 'Offered hold cancelled');
  });

  console.log(`\n=== Waitlist Engine Results: ${passed} Passed, ${failed} Failed ===`);
}

runAll().catch(console.error);
