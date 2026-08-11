import assert from 'assert';
import {
  timeToMinutes,
  formatSlotTime,
  formatSlotRange,
  getSlotPeriod,
  formatSlotTitle,
  sortSlotsChronologically
} from '../src/utils/timeUtils.js';

console.log('=== SeatSync Centralized Time Utilities Test Suite ===\n');

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] ${name}:`, err.message);
    failed++;
  }
}

// Test 1: timeToMinutes with various formats
runTest('Test 1: timeToMinutes parses 24-hour, 12-hour, and timestamps accurately', () => {
  assert.strictEqual(timeToMinutes('08:00:00'), 480);
  assert.strictEqual(timeToMinutes('08:00'), 480);
  assert.strictEqual(timeToMinutes('08:00 AM'), 480);
  assert.strictEqual(timeToMinutes('12:00 PM'), 720);
  assert.strictEqual(timeToMinutes('01:00 PM'), 780);
  assert.strictEqual(timeToMinutes('04:00 PM'), 960);
  assert.strictEqual(timeToMinutes('16:00:00'), 960);
  assert.strictEqual(timeToMinutes('12:00 AM'), 0);
  assert.strictEqual(timeToMinutes('11:59 PM'), 1439);
});

// Test 2: formatSlotTime
runTest('Test 2: formatSlotTime standardizes time into 12-hour AM/PM format', () => {
  assert.strictEqual(formatSlotTime('08:00:00'), '08:00 AM');
  assert.strictEqual(formatSlotTime('13:00:00'), '01:00 PM');
  assert.strictEqual(formatSlotTime('16:00:00'), '04:00 PM');
  assert.strictEqual(formatSlotTime('08:00 AM'), '08:00 AM');
  assert.strictEqual(formatSlotTime('4:00 PM'), '04:00 PM');
});

// Test 3: formatSlotRange
runTest('Test 3: formatSlotRange formats start and end times properly', () => {
  assert.strictEqual(formatSlotRange('08:00:00', '09:00:00'), '08:00 AM – 09:00 AM');
  assert.strictEqual(formatSlotRange('16:00:00', '17:00:00'), '04:00 PM – 05:00 PM');
});

// Test 4: getSlotPeriod
runTest('Test 4: getSlotPeriod maps start_time to MORNING, AFTERNOON, EVENING per specification', () => {
  assert.strictEqual(getSlotPeriod('08:00:00'), 'MORNING');
  assert.strictEqual(getSlotPeriod('10:00:00'), 'MORNING');
  assert.strictEqual(getSlotPeriod('11:00:00'), 'AFTERNOON');
  assert.strictEqual(getSlotPeriod('13:00:00'), 'AFTERNOON');
  assert.strictEqual(getSlotPeriod('15:59:00'), 'AFTERNOON');
  assert.strictEqual(getSlotPeriod('16:00:00'), 'EVENING');
  assert.strictEqual(getSlotPeriod('17:00:00'), 'EVENING');
});

// Test 5: formatSlotTitle
runTest('Test 5: formatSlotTitle strips hardcoded parentheticals and formats title with DB time range', () => {
  assert.strictEqual(
    formatSlotTitle('Morning Slot 1 (08:00 AM - 09:00 AM)', '08:00:00', '09:00:00'),
    'Morning Slot 1 (08:00 AM – 09:00 AM)'
  );
  assert.strictEqual(
    formatSlotTitle('Evening Slot (12:00 AM – 11:59 PM)', '16:00:00', '17:00:00'),
    'Evening Slot (04:00 PM – 05:00 PM)'
  );
});

// Test 6: sortSlotsChronologically
runTest('Test 6: sortSlotsChronologically sorts slots from earliest to latest', () => {
  const inputSlots = [
    { name: 'Evening Slot', startTime: '16:00:00', endTime: '17:00:00' },
    { name: 'Morning Slot 1', startTime: '08:00:00', endTime: '09:00:00' },
    { name: 'Afternoon Slot 1', startTime: '13:00:00', endTime: '14:00:00' },
    { name: 'Morning Slot 2', startTime: '09:00:00', endTime: '10:00:00' }
  ];

  const sorted = sortSlotsChronologically(inputSlots);
  const startTimes = sorted.map(s => s.startTime);
  assert.deepStrictEqual(startTimes, ['08:00:00', '09:00:00', '13:00:00', '16:00:00']);
});

console.log(`\nTest Summary: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
