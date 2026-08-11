import assert from 'assert';
import { supabase } from '../src/lib/supabase.js';

// Polyfill localStorage for Node execution
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

console.log('=== SeatSync Admin BIT1000 Login Test ===\n');

async function testAdminLogin() {
  try {
    console.log('1. Resolving auth email for identifier BIT1000...');
    const { data: resolved, error: rpcErr } = await supabase.rpc('fn_get_auth_email_by_identifier', { p_identifier: 'BIT1000' });
    assert.ifError(rpcErr);
    assert.ok(resolved && resolved.length > 0, 'Resolved auth email from BIT1000');
    console.log(`   Resolved email: ${resolved[0].auth_email}`);

    console.log('2. Authenticating with SeatSync authService (BIT1000 / 123456)...');
    const user = await authService.login('BIT1000', '123456');
    assert.ok(user, 'Login succeeded');
    assert.strictEqual(user.role, 'ADMIN', 'User mapped to ADMIN role');
    assert.strictEqual(user.adminId || user.identifier || user.collegeId, 'BIT1000', 'Admin ID is BIT1000');
    
    const dashboardRoute = authService.getDashboardRoute(user.role, user);
    assert.strictEqual(dashboardRoute, '/admin/dashboard', 'Routes directly to /admin/dashboard');

    console.log('\n[PASS] Admin BIT1000 login successfully verified! Routes to /admin/dashboard.');
  } catch (err) {
    console.error('\n[FAIL] Admin login error:', err.message || err);
    process.exit(1);
  }
}

testAdminLogin();
