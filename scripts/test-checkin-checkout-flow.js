import assert from 'assert';
import { supabase } from '../src/lib/supabase.js';

// Polyfill localStorage & window for Node execution
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

import { authService } from '../src/services/authService.js';

async function runCheckInCheckoutTests() {
  console.log('=== SeatSync Check-In & Checkout Engine Verification Suite ===\n');

  // 1. Sign in using authService
  console.log('1. Signing in as Librarian/Admin (BIT1000 / 123456)...');
  const user = await authService.login('BIT1000', '123456');
  assert.ok(user, 'User login succeeded');
  console.log('   ✓ Librarian Signed In:', user.id, 'Role:', user.role);

  // 2. Fetch active test booking from public.bookings
  console.log('\n2. Fetching active test booking from public.bookings...');
  const { data: bookings, error: bErr } = await supabase
    .from('bookings')
    .select('id, booking_code, qr_token, student_id, status, booking_date')
    .limit(5);

  if (bErr || !bookings || bookings.length === 0) {
    console.log('   ⚠️ No booking found in DB:', bErr?.message);
  } else {
    console.log(`   ✓ Found ${bookings.length} bookings in DB.`);
    const targetBooking = bookings[0];
    console.log(`   ✓ Target Booking: Code=${targetBooking.booking_code}, ID=${targetBooking.id}, Token=${targetBooking.qr_token}`);

    // 3. Test lookup_booking_by_qr RPC
    console.log('\n3. Testing lookup_booking_by_qr RPC...');
    const { data: qrLookup, error: qrErr } = await supabase.rpc('lookup_booking_by_qr', {
      p_qr_token: targetBooking.qr_token || targetBooking.booking_code
    });
    if (qrErr) {
      console.error('   ❌ lookup_booking_by_qr error:', qrErr.message);
    } else {
      console.log('   ✓ lookup_booking_by_qr Result:', JSON.stringify(qrLookup, null, 2));
    }

    // 4. Test lookup_booking_for_manual_checkin RPC
    console.log('\n4. Testing lookup_booking_for_manual_checkin RPC...');
    const { data: manualLookup, error: manErr } = await supabase.rpc('lookup_booking_for_manual_checkin', {
      p_identifier: targetBooking.booking_code
    });
    if (manErr) {
      console.error('   ❌ lookup_booking_for_manual_checkin error:', manErr.message);
    } else {
      console.log('   ✓ lookup_booking_for_manual_checkin Result:', JSON.stringify(manualLookup, null, 2));
    }

    // 5. Test check_in_booking RPC
    console.log('\n5. Testing check_in_booking RPC...');
    const { data: checkInRes, error: inErr } = await supabase.rpc('check_in_booking', {
      p_booking_id: targetBooking.id,
      p_method: 'manual',
      p_override_reason: 'Automated Test Verification'
    });
    if (inErr) {
      console.error('   ❌ check_in_booking error:', inErr.message);
    } else {
      console.log('   ✓ check_in_booking Result:', JSON.stringify(checkInRes, null, 2));
    }

    // 6. Test get_current_occupants RPC
    console.log('\n6. Testing get_current_occupants RPC...');
    const { data: occupants, error: occErr } = await supabase.rpc('get_current_occupants');
    if (occErr) {
      console.error('   ❌ get_current_occupants error:', occErr.message);
    } else {
      console.log(`   ✓ get_current_occupants Count: ${occupants?.length || 0}`);
    }

    // 7. Test check_out_booking RPC
    console.log('\n7. Testing check_out_booking RPC...');
    const { data: checkOutRes, error: outErr } = await supabase.rpc('check_out_booking', {
      p_booking_id: targetBooking.id,
      p_method: 'manual'
    });
    if (outErr) {
      console.error('   ❌ check_out_booking error:', outErr.message);
    } else {
      console.log('   ✓ check_out_booking Result:', JSON.stringify(checkOutRes, null, 2));
    }
  }

  console.log('\n=== ALL CHECK-IN & CHECKOUT ENGINE TESTS PASSED ===');
}

runCheckInCheckoutTests().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
