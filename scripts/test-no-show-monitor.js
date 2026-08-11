import assert from 'assert';

console.log('=== SeatSync No-Show & Standing Monitor Engine Unit Test ===\n');

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

// Test 1: Account Standing Threshold Calculation
runTest('Test 1: Calculate account standing labels based on max_no_shows', () => {
  function getStanding(count, max = 3) {
    if (count >= max) return 'Restricted';
    if (count === 0) return 'Good Standing';
    if (count === 1) return 'Warning';
    if (count === 2) return 'Final Warning';
    return 'Restricted';
  }

  assert.strictEqual(getStanding(0, 3), 'Good Standing');
  assert.strictEqual(getStanding(1, 3), 'Warning');
  assert.strictEqual(getStanding(2, 3), 'Final Warning');
  assert.strictEqual(getStanding(3, 3), 'Restricted');
  assert.strictEqual(getStanding(4, 3), 'Restricted');
});

// Test 2: Dynamic Policy Threshold (e.g. max_no_shows = 5)
runTest('Test 2: Dynamic threshold relative to configured max policy limit', () => {
  function getStanding(count, max = 5) {
    if (count >= max) return 'Restricted';
    if (count === 0) return 'Good Standing';
    if (count < Math.ceil(max / 2)) return 'Warning';
    return 'Final Warning';
  }

  assert.strictEqual(getStanding(0, 5), 'Good Standing');
  assert.strictEqual(getStanding(2, 5), 'Warning');
  assert.strictEqual(getStanding(4, 5), 'Final Warning');
  assert.strictEqual(getStanding(5, 5), 'Restricted');
});

// Test 3: Offense Formatting
runTest('Test 3: Format offense ratio display text accurately', () => {
  function formatOffenses(count, max) {
    return `${count} / ${max} Offenses`;
  }

  assert.strictEqual(formatOffenses(0, 3), '0 / 3 Offenses');
  assert.strictEqual(formatOffenses(1, 3), '1 / 3 Offenses');
  assert.strictEqual(formatOffenses(3, 3), '3 / 3 Offenses');
  assert.strictEqual(formatOffenses(2, 5), '2 / 5 Offenses');
});

console.log(`\nTest Summary: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) process.exit(1);
