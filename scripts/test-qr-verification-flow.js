import { parseEntryQrPayload, parseEntryQrDetails, buildEntryQrPayload } from '../src/utils/qrPayload.js';

console.log('Testing QR Parser scenarios...');

// Test 1: Plain UUID
const uuidStr = '5406eb70-f2dd-4e2e-a2ea-123456789abc';
const p1 = parseEntryQrPayload(uuidStr);
console.log('Test 1 (UUID):', p1 === uuidStr ? 'PASS' : 'FAIL', p1);

// Test 2: Booking Code
const codeStr = 'BK-1785';
const p2 = parseEntryQrPayload(codeStr);
console.log('Test 2 (Booking Code):', p2 === codeStr ? 'PASS' : 'FAIL', p2);

// Test 3: JSON Payload
const jsonStr = JSON.stringify({ bookingId: 'BK-1785', studentName: 'Test Student' });
const p3 = parseEntryQrPayload(jsonStr);
console.log('Test 3 (JSON):', p3 === 'BK-1785' ? 'PASS' : 'FAIL', p3);

// Test 4: SeatSync URI
const uriStr = buildEntryQrPayload('BK-1785');
const p4 = parseEntryQrPayload(uriStr);
console.log('Test 4 (SeatSync URI):', p4 === 'BK-1785' ? 'PASS' : 'FAIL', p4);

// Test 5: Web URL with token query param
const urlStr = 'https://seatsync.app/verify?token=BK-1785&v=1';
const p5 = parseEntryQrPayload(urlStr);
console.log('Test 5 (Web URL query param):', p5 === 'BK-1785' ? 'PASS' : 'FAIL', p5);

// Test 6: Invalid QR format
try {
  parseEntryQrPayload('');
  console.log('Test 6 (Empty string): FAIL');
} catch (e) {
  console.log('Test 6 (Empty string): PASS - Threw', e.message);
}

console.log('ALL QR PARSER TESTS COMPLETE.');
