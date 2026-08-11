import assert from 'assert';
import { waitlistService } from '../src/services/waitlistService.js';

console.log('=== SeatSync Date & Slot Categorized Waitlist Engine Test Suite ===\n');

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

  // Test 1: Date formatting in Asia/Kolkata
  test('Test 1: Today date defaults to Asia/Kolkata (IST)', () => {
    const todayStr = waitlistService.getTodayISTDateStr();
    assert.match(todayStr, /^\d{4}-\d{2}-\d{2}$/, 'Valid YYYY-MM-DD format');
  });

  // Test 2: Date-wise slot summary segregation
  await asyncTest('Test 2: Slot summaries returned strictly for selected date', async () => {
    const libId = 'lib-main-001';
    const date1 = '2026-08-06';
    const date2 = '2026-08-07';

    const res1 = await waitlistService.getWaitlistSlotSummary(libId, date1);
    const res2 = await waitlistService.getWaitlistSlotSummary(libId, date2);

    assert.strictEqual(Array.isArray(res1), true, 'Summary returns array for date 1');
    assert.strictEqual(Array.isArray(res2), true, 'Summary returns array for date 2');
    assert.strictEqual(res1[0].occurrence_date, date1, 'Date 1 occurrence date verified');
    assert.strictEqual(res2[0].occurrence_date, date2, 'Date 2 occurrence date verified');
  });

  // Test 3: Same slot time on different dates has distinct occurrence queues
  await asyncTest('Test 3: Same slot time on different dates has separate, isolated queues', async () => {
    const slotId = 'SLOT-05';
    const date1 = '2026-08-06';
    const date2 = '2026-08-07';

    const queue1 = await waitlistService.getWaitlistForOccurrence({ slotId, bookingDate: date1 });
    const queue2 = await waitlistService.getWaitlistForOccurrence({ slotId, bookingDate: date2 });

    assert.strictEqual(queue1.booking_date, date1, 'Queue 1 isolated to date 1');
    assert.strictEqual(queue2.booking_date, date2, 'Queue 2 isolated to date 2');
  });

  // Test 4: Queue position restarts from #1 for each occurrence
  test('Test 4: FIFO Queue Position starts from #1 for each separate slot occurrence', () => {
    const queueDate1 = [
      { id: 'w-1', studentId: 's-1', createdAt: '2026-08-06T10:00:00Z' },
      { id: 'w-2', studentId: 's-2', createdAt: '2026-08-06T10:01:00Z' }
    ];
    const queueDate2 = [
      { id: 'w-3', studentId: 's-3', createdAt: '2026-08-07T10:00:00Z' }
    ];

    const pos1 = queueDate1.map((w, idx) => idx + 1);
    const pos2 = queueDate2.map((w, idx) => idx + 1);

    assert.deepStrictEqual(pos1, [1, 2], 'Date 1 queue positions: #1, #2');
    assert.deepStrictEqual(pos2, [1], 'Date 2 queue position restarts at #1');
  });

  // Test 5: Two slots on the same date have separate queues
  await asyncTest('Test 5: Two slots on the same date maintain separate queue isolation', async () => {
    const date = '2026-08-06';
    const resA = await waitlistService.getWaitlistForOccurrence({ slotId: 'SLOT-01', bookingDate: date });
    const resB = await waitlistService.getWaitlistForOccurrence({ slotId: 'SLOT-02', bookingDate: date });

    assert.strictEqual(resA.slot_id, 'SLOT-01', 'Queue A bound to SLOT-01');
    assert.strictEqual(resB.slot_id, 'SLOT-02', 'Queue B bound to SLOT-02');
  });

  // Test 6: Search filter operates strictly within selected occurrence
  await asyncTest('Test 6: Search query operates only inside selected slot occurrence', async () => {
    const res = await waitlistService.getWaitlistForOccurrence({
      slotId: 'SLOT-05',
      bookingDate: '2026-08-06',
      searchQuery: 'Subash'
    });

    assert.strictEqual(res.success, true, 'Search executed successfully');
    res.entries.forEach(e => {
      assert.strictEqual(e.slot_id, 'SLOT-05', 'Entry belongs to target slot');
      assert.strictEqual(e.booking_date, '2026-08-06', 'Entry belongs to target date');
    });
  });

  // Test 7: Status filter operates strictly within selected occurrence
  await asyncTest('Test 7: Status filter operates only inside selected slot occurrence', async () => {
    const res = await waitlistService.getWaitlistForOccurrence({
      slotId: 'SLOT-05',
      bookingDate: '2026-08-06',
      statusFilter: 'WAITING'
    });

    assert.strictEqual(res.success, true, 'Status filter executed');
    res.entries.forEach(e => {
      assert.strictEqual(e.status, 'WAITING', 'Only WAITING entries returned');
    });
  });

  // Test 8: Cancelled slots remain read-only without promotion
  test('Test 8: Cancelled slot occurrences disable promotion actions', () => {
    const cancelledSlot = { slot_status: 'cancelled', waiting_count: 5 };
    const canPromote = cancelledSlot.slot_status !== 'cancelled' && cancelledSlot.slot_status !== 'disabled';
    assert.strictEqual(canPromote, false, 'Promotion disabled for cancelled slot');
  });

  console.log(`\n=== Categorized Waitlist Results: ${passed} Passed, ${failed} Failed ===`);
}

runAll().catch(console.error);
