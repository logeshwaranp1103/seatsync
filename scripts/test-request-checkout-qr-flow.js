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
import { buildCheckoutQrPayload, parseCheckoutQrPayload } from '../src/utils/qrPayload.js';
import { bookingService } from '../src/services/bookingService.js';
import { librarianService } from '../src/services/librarianService.js';

async function runCheckoutQrWorkflowTestSuite() {
  console.log('============================================================');
  console.log('  SeatSync Request Checkout QR End-to-End Verification Suite');
  console.log('============================================================\n');

  // STEP 1: Payload Contract & Parser Unit Tests
  console.log('1. Testing Checkout QR Payload Generator & Parser Contract...');
  const sampleToken = 'chk_9f8e7d6c5b4a3210';
  const constructedPayload = buildCheckoutQrPayload(sampleToken);
  console.log(`   Constructed URI: ${constructedPayload}`);
  assert.strictEqual(constructedPayload, `seatsync://checkout/${sampleToken}`);

  const parsedToken = parseCheckoutQrPayload(constructedPayload);
  console.log(`   Parsed Token: ${parsedToken}`);
  assert.strictEqual(parsedToken, sampleToken);

  // Test rejection of entry pass in checkout mode
  assert.throws(() => {
    parseCheckoutQrPayload('seatsync://entry?v=1&token=SS-TEST-1234');
  }, (err) => err.message === 'NOT_CHECKOUT_PASS', 'Entry QR in checkout scanner must throw NOT_CHECKOUT_PASS');
  console.log('   ✓ Entry pass correctly rejected in checkout scanner mode (NOT_CHECKOUT_PASS)');

  // STEP 2: Student Eligibility Rules Verification
  console.log('\n2. Verifying Student Checkout Eligibility Rules (canRequestCheckout)...');
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const testStudentUser = { id: '11111111-2222-3333-4444-555555555555' };

  const eligibleBooking = {
    id: 'bk-eligible-1',
    studentId: testStudentUser.id,
    bookingDate: todayStr,
    status: 'checked_in',
    booking_source: 'online'
  };

  const walkInCheckedInBooking = {
    id: 'bk-walkin-1',
    studentId: testStudentUser.id,
    bookingDate: todayStr,
    status: 'checked_in',
    booking_source: 'librarian_walk_in',
    is_cancellable: false
  };

  const reservedNotCheckedInBooking = {
    id: 'bk-reserved-1',
    studentId: testStudentUser.id,
    bookingDate: todayStr,
    status: 'confirmed'
  };

  const cancelledBooking = {
    id: 'bk-cancelled-1',
    studentId: testStudentUser.id,
    bookingDate: todayStr,
    status: 'cancelled'
  };

  const completedBooking = {
    id: 'bk-completed-1',
    studentId: testStudentUser.id,
    bookingDate: todayStr,
    status: 'completed'
  };

  assert.strictEqual(bookingService.canRequestCheckout(eligibleBooking, testStudentUser), true, 'Checked-in online booking must be eligible');
  assert.strictEqual(bookingService.canRequestCheckout(walkInCheckedInBooking, testStudentUser), true, 'Checked-in walk-in booking must be eligible');
  assert.strictEqual(bookingService.canRequestCheckout(reservedNotCheckedInBooking, testStudentUser), false, 'Reserved non-checked-in booking must NOT be eligible');
  assert.strictEqual(bookingService.canRequestCheckout(cancelledBooking, testStudentUser), false, 'Cancelled booking must NOT be eligible');
  assert.strictEqual(bookingService.canRequestCheckout(completedBooking, testStudentUser), false, 'Completed booking must NOT be eligible');
  console.log('   ✓ Eligibility matrix verified 100% across all booking states & sources');

  // STEP 3: Authenticate with Supabase Auth as Librarian
  console.log('\n3. Authenticating Librarian Session for DB Integration Test...');
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'librarian@bitsathy.ac.in',
    password: '123456'
  });

  if (authError || !authData.user) {
    console.error('   ❌ Supabase Auth failed:', authError?.message);
    process.exit(1);
  }
  console.log(`   ✓ Signed In Librarian: UID=${authData.user.id}, Email=${authData.user.email}`);

  // Clean up any existing test bookings for this user
  await supabase.from('bookings').delete().eq('student_id', authData.user.id);

  // STEP 4: Create Active Test Booking for TODAY & Check-In
  console.log('\n4. Creating Active Checked-In Test Booking...');
  const { data: libraries } = await supabase.from('libraries').select('id').limit(1);
  const { data: floors } = await supabase.from('floors').select('id').limit(1);
  const { data: rooms } = await supabase.from('rooms').select('id').limit(1);
  const { data: seats } = await supabase.from('seats').select('*').limit(1);

  const libraryId = libraries?.[0]?.id || '11111111-1111-1111-1111-111111111111';
  const floorId = floors?.[0]?.id;
  const roomId = rooms?.[0]?.id;
  const activeSeat = seats?.[0];

  const { data: slots } = await supabase.from('slots').select('*');
  let activeSlot = slots?.[0];
  if (activeSlot) {
    await supabase.from('slots').update({ start_time: '00:00:00', end_time: '23:59:59' }).eq('id', activeSlot.id);
  }

  const { data: newBooking, error: createErr } = await supabase
    .from('bookings')
    .insert({
      booking_code: `BK-CKTEST-${Math.floor(1000 + Math.random() * 9000)}`,
      student_id: authData.user.id,
      library_id: libraryId,
      floor_id: floorId,
      room_id: roomId,
      seat_id: activeSeat?.id,
      slot_id: activeSlot.id,
      booking_date: todayStr,
      status: 'checked_in',
      checked_in_at: new Date().toISOString(),
      checked_in_by: authData.user.id,
      qr_token: `SS-CHECKOUT-TEST-${Math.floor(100000 + Math.random() * 900000)}`
    })
    .select('*')
    .single();

  if (createErr || !newBooking) {
    console.error('   ❌ Test Booking Creation Failed:', createErr?.message);
    process.exit(1);
  }
  console.log(`   ✓ Active Checked-In Booking Created: ID=${newBooking.id}, Code=${newBooking.booking_code}, Status=${newBooking.status}`);

  // STEP 5: Test Request Checkout QR RPC / Service
  console.log('\n5. Requesting Checkout QR Pass (requestCheckoutQr)...');
  const reqResult = await bookingService.requestCheckoutQr(newBooking.id);
  console.log('   RPC Request Result:', JSON.stringify(reqResult, null, 2));

  assert.ok(reqResult.success, 'Request checkout QR should succeed');
  assert.ok(reqResult.checkoutPass, 'Checkout pass object must be returned');
  assert.ok(reqResult.checkoutPass.token, 'Raw opaque token must be returned');
  assert.ok(reqResult.checkoutPass.payload.startsWith('seatsync://checkout/'), 'Payload must use seatsync://checkout/ URI scheme');
  console.log(`   ✓ Generated Pass Token: ${reqResult.checkoutPass.token}`);
  console.log(`   ✓ Generated Pass Payload: ${reqResult.checkoutPass.payload}`);

  // STEP 6: Test Librarian Camera Scanner Checkout Verification (scanCheckoutQr)
  console.log('\n6. Executing Librarian Camera Scan Checkout (scanCheckoutQr)...');
  const scanCheckoutRes = await librarianService.scanCheckoutQr(reqResult.checkoutPass.payload);
  console.log('   Scanner Result:', JSON.stringify(scanCheckoutRes, null, 2));

  assert.ok(scanCheckoutRes.success, 'Librarian scan checkout should be successful');
  console.log(`   ✓ Scanner Feedback Message: "${scanCheckoutRes.message}"`);

  // STEP 7: Verify Database State Update in public.bookings
  console.log('\n7. Verifying Final Database Record State in public.bookings...');
  const { data: finalBooking, error: fErr } = await supabase
    .from('bookings')
    .select('id, status, checked_out_at, checked_out_by')
    .eq('id', newBooking.id)
    .single();

  assert.ifError(fErr);
  console.log(`   ✓ Final DB Status: ${finalBooking.status}`);
  console.log(`   ✓ Checked Out At: ${finalBooking.checked_out_at}`);
  console.log(`   ✓ Checked Out By: ${finalBooking.checked_out_by}`);

  assert.ok(['completed', 'checked_out'].includes(finalBooking.status), 'Booking status must be completed or checked_out');
  assert.ok(finalBooking.checked_out_at, 'checked_out_at timestamp must be set');

  // STEP 8: Test Replay & Single-Use Protection
  console.log('\n8. Testing Replay Protection (Scanning used checkout QR again)...');
  const replayResult = await librarianService.scanCheckoutQr(reqResult.checkoutPass.payload);
  console.log('   Replay Scan Result:', JSON.stringify(replayResult, null, 2));
  assert.strictEqual(replayResult.success, false, 'Scanning used QR must be rejected');
  assert.ok(['TOKEN_ALREADY_USED', 'STUDENT_ALREADY_CHECKED_OUT'].includes(replayResult.statusCode), `Status code should be TOKEN_ALREADY_USED or STUDENT_ALREADY_CHECKED_OUT, got: ${replayResult.statusCode}`);
  console.log(`   ✓ Single-use protection verified! Re-scanning used QR is rejected with code: ${replayResult.statusCode}`);

  // STEP 9: Test Scanning Unrecognized / Invalid QR Token
  console.log('\n9. Testing Unrecognized / Invalid QR Token Recognition...');
  const invalidResult = await librarianService.scanCheckoutQr('seatsync://checkout/chk_invalid_token_999999');
  console.log('   Invalid Token Result:', JSON.stringify(invalidResult, null, 2));
  assert.strictEqual(invalidResult.success, false, 'Scanning invalid token must fail');
  assert.strictEqual(invalidResult.statusCode, 'INVALID_CHECKOUT_QR', 'Status code must be INVALID_CHECKOUT_QR');
  assert.strictEqual(invalidResult.message, 'Invalid checkout QR code or token not recognized.', 'Error message must clearly inform token is not recognized');
  console.log('   ✓ Unrecognized token correctly identified with clear feedback message.');

  // STEP 10: Test Non-Cancellable Librarian Walk-In Allocation Checkout Compatibility
  console.log('\n10. Testing Non-Cancellable Librarian Walk-In Allocation Checkout Compatibility...');
  const { data: walkInBooking, error: wCreateErr } = await supabase
    .from('bookings')
    .insert({
      booking_code: `BK-WALKIN-${Math.floor(1000 + Math.random() * 9000)}`,
      student_id: authData.user.id,
      library_id: libraryId,
      floor_id: floorId,
      room_id: roomId,
      seat_id: activeSeat?.id,
      slot_id: activeSlot.id,
      booking_date: todayStr,
      status: 'checked_in',
      booking_source: 'librarian_walk_in',
      is_cancellable: false,
      checked_in_at: new Date().toISOString()
    })
    .select('*')
    .single();

  assert.ifError(wCreateErr);
  console.log(`   ✓ Walk-In Booking Created: ID=${walkInBooking.id}, Source=${walkInBooking.booking_source}, Cancellable=${walkInBooking.is_cancellable}`);

  // Confirm student CANNOT cancel walk-in booking
  await assert.rejects(async () => {
    await bookingService.cancelBooking(walkInBooking.id, authData.user.id);
  }, /cannot be cancelled|walk-in/i, 'Walk-in booking cancel attempt must throw error');
  console.log('   ✓ Student cannot cancel walk-in booking (preserved as non-cancellable)');

  // Confirm student CAN request Checkout QR for walk-in booking
  const walkInPassRes = await bookingService.requestCheckoutQr(walkInBooking.id);
  assert.ok(walkInPassRes.success, 'Student must be able to request checkout QR for checked-in walk-in booking');
  console.log(`   ✓ Walk-In Checkout QR Pass Generated: ${walkInPassRes.checkoutPass.payload}`);

  // Confirm librarian can scan and complete checkout for walk-in booking
  const walkInCheckoutRes = await librarianService.scanCheckoutQr(walkInPassRes.checkoutPass.payload);
  assert.ok(walkInCheckoutRes.success, 'Librarian must be able to scan and complete checkout for walk-in booking');
  console.log('   ✓ Walk-In booking checkout completed successfully!');

  // Cleanup test bookings
  await supabase.from('bookings').delete().in('id', [newBooking.id, walkInBooking.id]);

  console.log('\n============================================================');
  console.log('🎉 ALL END-TO-END CHECKOUT QR WORKFLOW VERIFICATIONS PASSED!');
  console.log('============================================================');
}

runCheckoutQrWorkflowTestSuite().catch(err => {
  console.error('\n❌ Test Suite Exception:', err);
  process.exit(1);
});

