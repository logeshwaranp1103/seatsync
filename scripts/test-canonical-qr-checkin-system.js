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
import { buildEntryQrPayload, parseEntryQrPayload } from '../src/utils/qrPayload.js';
import { librarianService } from '../src/services/librarianService.js';

async function runCanonicalQrSystemTest() {
  console.log('=== SeatSync Canonical QR Check-In & Checkout Verification Suite ===\n');

  // STEP 1: Authenticate with Supabase Auth as Librarian
  console.log('1. Signing in as Librarian (librarian@bitsathy.ac.in / 123456)...');
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'librarian@bitsathy.ac.in',
    password: '123456'
  });

  if (authError || !authData.user) {
    console.error('   ❌ Supabase Auth failed:', authError?.message);
    process.exit(1);
  }
  console.log(`   ✓ Authenticated Librarian Session: UID=${authData.user.id}, Email=${authData.user.email}`);

  // Clean up any existing test bookings for this user
  await supabase.from('bookings').delete().eq('student_id', authData.user.id);

  // STEP 2: Prepare a test booking valid for TODAY in Asia/Kolkata and CURRENT TIME SLOT
  console.log('\n2. Preparing test booking valid for TODAY in Asia/Kolkata...');
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
  
  const { data: libraries } = await supabase.from('libraries').select('id').limit(1);
  const { data: floors } = await supabase.from('floors').select('id').limit(1);
  const { data: rooms } = await supabase.from('rooms').select('id').limit(1);
  const { data: seats } = await supabase.from('seats').select('*').limit(1);
  const activeSeat = seats?.[0];

  const libraryId = libraries?.[0]?.id || '11111111-1111-1111-1111-111111111111';
  const floorId = floors?.[0]?.id;
  const roomId = rooms?.[0]?.id;

  // Ensure active slot window is wide open for test execution
  const { data: slots } = await supabase.from('slots').select('*');
  let activeSlot = slots?.[0];

  if (activeSlot) {
    await supabase.from('slots').update({ start_time: '00:00:00', end_time: '23:59:59' }).eq('id', activeSlot.id);
  }

  const testQrToken = `SS-TEST-${Math.floor(100000 + Math.random() * 900000)}`;

  const { data: newBooking, error: createErr } = await supabase
    .from('bookings')
    .insert({
      booking_code: `BK-TEST-${Math.floor(1000 + Math.random() * 9000)}`,
      student_id: authData.user.id,
      library_id: libraryId,
      floor_id: floorId,
      room_id: roomId,
      seat_id: activeSeat?.id,
      slot_id: activeSlot.id,
      booking_date: todayStr,
      status: 'confirmed',
      qr_token: testQrToken
    })
    .select('*')
    .single();

  if (createErr || !newBooking) {
    console.error('   ❌ Booking Creation Error:', createErr?.message);
    process.exit(1);
  }

  console.log(`   ✓ Active Test Booking Created: Code=${newBooking.booking_code}, ID=${newBooking.id}, Date=${todayStr}, Token=${newBooking.qr_token}, Slot=${activeSlot.name}`);

  // STEP 3: Test Canonical Payload Generator & Parser Contract
  console.log('\n3. Testing Canonical QR Payload Contract (build & parse)...');
  const canonicalPayload = buildEntryQrPayload(newBooking.qr_token);
  console.log(`   Canonical URI Payload: ${canonicalPayload}`);

  const parsedToken = parseEntryQrPayload(canonicalPayload);
  console.log(`   Parsed Token: ${parsedToken}`);
  assert.strictEqual(parsedToken, newBooking.qr_token, 'Parsed token must match stored qr_token exactly');
  console.log('   ✓ QR Payload Contract verified (parsed token strictly matches DB value)');

  // STEP 4: Test Atomic QR Check-In RPC (check_in_booking_by_qr)
  console.log('\n4. Executing Atomic QR Check-In RPC (check_in_booking_by_qr)...');
  const scanResult = await librarianService.scanEntryQr(canonicalPayload);
  console.log('   RPC Response:', JSON.stringify(scanResult, null, 2));
  assert.ok(scanResult.valid, `QR check-in failed: ${scanResult.message}`);
  assert.strictEqual(scanResult.statusCode, 'SUCCESS', 'Check-in status must be SUCCESS');

  // STEP 5: Verify DB Record Update in public.bookings
  console.log('\n5. Verifying database state update in public.bookings...');
  const { data: updatedRow, error: uErr } = await supabase
    .from('bookings')
    .select('id, status, checked_in_at, checked_in_by')
    .eq('id', newBooking.id)
    .single();

  assert.ifError(uErr);
  console.log(`   ✓ DB Status: ${updatedRow.status}`);
  console.log(`   ✓ Checked In At: ${updatedRow.checked_in_at}`);
  console.log(`   ✓ Checked In By: ${updatedRow.checked_in_by}`);
  assert.strictEqual(updatedRow.status, 'checked_in', 'Booking status must be checked_in');

  // STEP 6: Verify Current Occupants RPC (get_current_occupants)
  console.log('\n6. Verifying get_current_occupants RPC...');
  const occupants = await librarianService.getCurrentOccupants();
  console.log(`   Current Occupants Count: ${occupants.length}`);
  const matchingOccupant = occupants.find(o => o.bookingId === newBooking.id || o.bookingCode === newBooking.booking_code);
  assert.ok(matchingOccupant, 'Student must appear in Current Occupants list');
  console.log(`   ✓ Found Occupant: ${matchingOccupant.studentName} at Seat ${matchingOccupant.seatNumber}`);

  // STEP 7: Test Atomic Checkout RPC (check_out_booking)
  console.log('\n7. Executing Atomic Checkout RPC (check_out_booking)...');
  const checkoutRes = await librarianService.checkOutBooking({
    bookingId: newBooking.id,
    method: 'manual'
  });
  console.log('   Checkout RPC Result:', JSON.stringify(checkoutRes, null, 2));
  assert.ok(checkoutRes.success, 'Checkout should be successful');

  // STEP 8: Verify Final DB State (status = checked_out)
  console.log('\n8. Verifying final database state in public.bookings...');
  const { data: finalRow, error: fErr } = await supabase
    .from('bookings')
    .select('id, status, checked_out_at, checked_out_by')
    .eq('id', newBooking.id)
    .single();

  assert.ifError(fErr);
  console.log(`   ✓ Final DB Status: ${finalRow.status}`);
  console.log(`   ✓ Checked Out At: ${finalRow.checked_out_at}`);
  assert.strictEqual(finalRow.status, 'checked_out', 'Booking status must be checked_out');

  // STEP 9: Test Unknown Token Returns BOOKING_NOT_FOUND
  console.log('\n9. Testing unknown QR token (BOOKING_NOT_FOUND)...');
  const unknownResult = await librarianService.scanEntryQr('seatsync://entry?v=1&token=SS-NONEXISTENT-999');
  console.log('   Unknown Token Result:', JSON.stringify(unknownResult, null, 2));
  assert.strictEqual(unknownResult.statusCode, 'BOOKING_NOT_FOUND', 'Unknown token must return BOOKING_NOT_FOUND');
  console.log('   ✓ Non-existent token correctly returns BOOKING_NOT_FOUND!');

  // Cleanup test booking
  await supabase.from('bookings').delete().eq('id', newBooking.id);

  console.log('\n============================================================');
  console.log('🎉 ALL CANONICAL QR CHECK-IN & CHECKOUT TESTS PASSED 100%');
  console.log('============================================================');
}

runCanonicalQrSystemTest().catch(err => {
  console.error('\n❌ Test Suite Error:', err);
  process.exit(1);
});
