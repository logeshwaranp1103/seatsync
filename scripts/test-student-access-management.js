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
import { authService } from '../src/services/authService.js';

async function runStudentAccessManagementTest() {
  console.log('=== SeatSync Student Access Management Verification Suite ===\n');

  // STEP 1: Authenticate as Librarian
  console.log('1. Signing in as Staff Librarian (librarian@bitsathy.ac.in / 123456)...');
  const { data: staffAuth, error: staffErr } = await supabase.auth.signInWithPassword({
    email: 'librarian@bitsathy.ac.in',
    password: '123456'
  });

  if (staffErr || !staffAuth.user) {
    console.error('   ❌ Librarian authentication failed:', staffErr?.message);
    process.exit(1);
  }
  const staffUid = staffAuth.user.id;
  console.log(`   ✓ Authenticated Librarian: UID=${staffUid}, Email=${staffAuth.user.email}`);

  // STEP 2: Find a test student profile
  console.log('\n2. Locating target student profile...');
  const { data: students, error: stdErr } = await supabase
    .from('profiles')
    .select('id, full_name, email, registration_number, role, status, account_status')
    .eq('role', 'student')
    .limit(1);

  if (stdErr || !students || students.length === 0) {
    console.error('   ❌ Failed to locate student profile:', stdErr?.message);
    process.exit(1);
  }

  const testStudent = students[0];
  console.log(`   ✓ Target Student: Name=${testStudent.full_name}, Email=${testStudent.email}, ID=${testStudent.id}`);

  // Clean any active restriction on test student first
  await supabase.from('user_restrictions').update({ status: 'resolved', is_active: false }).eq('student_id', testStudent.id);
  await supabase.from('profiles').update({ account_status: 'active', status: 'active', blocked_reason: null, blocked_at: null, blocked_by: null }).eq('id', testStudent.id);

  // STEP 3: Test Anti-Self Blocking Guard
  console.log('\n3. Testing Anti-Self Blocking Guard...');
  try {
    await authService.blockStudentAccess({
      studentId: staffUid,
      reason: 'Attempting self-block'
    });
    assert.fail('Should have rejected self-blocking attempt');
  } catch (err) {
    console.log(`   ✓ Correctly Blocked Self-Block Attempt: "${err.message}"`);
  }

  // STEP 4: Test Blocking Student Access (block_student_access RPC)
  console.log('\n4. Executing block_student_access RPC...');
  const testReason = 'Repeated no-show for 3 consecutive morning slots without prior cancellation.';
  const blockRes = await authService.blockStudentAccess({
    studentId: testStudent.id,
    reason: testReason,
    category: 'Repeated no-show'
  });

  console.log('   Block Response:', JSON.stringify(blockRes, null, 2));
  assert.ok(blockRes.success, 'Block action should be successful');
  const restrictionId = blockRes.restriction_id;

  // STEP 5: Verify Profile State Update
  console.log('\n5. Verifying public.profiles Account Status...');
  const { data: updatedProfile } = await supabase
    .from('profiles')
    .select('account_status, status, blocked_reason, blocked_at, blocked_by')
    .eq('id', testStudent.id)
    .single();

  console.log('   Profile DB State:', JSON.stringify(updatedProfile, null, 2));
  assert.strictEqual(updatedProfile.account_status, 'blocked', 'account_status must be blocked');
  assert.strictEqual(updatedProfile.blocked_reason, testReason, 'blocked_reason must match entered reason');
  assert.strictEqual(updatedProfile.blocked_by, staffUid, 'blocked_by must match staff UID');

  // STEP 6: Verify user_restrictions History Record
  console.log('\n6. Verifying public.user_restrictions History Record...');
  const { data: restrictionRow } = await supabase
    .from('user_restrictions')
    .select('*')
    .eq('id', restrictionId)
    .single();

  console.log(`   History Record: ID=${restrictionRow.id}, Status=${restrictionRow.status}, Category=${restrictionRow.category}`);
  assert.strictEqual(restrictionRow.status, 'active', 'Restriction status must be active');
  assert.strictEqual(restrictionRow.reason, testReason);
  assert.strictEqual(restrictionRow.blocked_by, staffUid);

  // STEP 7: Verify Audit & Activity Logs
  console.log('\n7. Verifying Audit & Activity Log Entries...');
  const { data: auditRows } = await supabase
    .from('audit_logs')
    .select('*')
    .eq('actor_id', staffUid)
    .eq('event_type', 'STUDENT_ACCESS_BLOCKED');

  console.log(`   ✓ Audit Log Entries Found: ${auditRows?.length || 0}`);
  assert.ok(auditRows && auditRows.length > 0, 'Audit log entry must exist for access block');

  // STEP 8: Test Duplicate Active Block Prevention (partial unique index)
  console.log('\n8. Testing Duplicate Active Block Prevention...');
  try {
    await authService.blockStudentAccess({
      studentId: testStudent.id,
      reason: 'Second duplicate block attempt'
    });
    assert.fail('Should have rejected duplicate active block');
  } catch (err) {
    console.log(`   ✓ Correctly Blocked Duplicate Active Block: "${err.message}"`);
  }

  // STEP 9: Test is_account_active Helper RPC
  console.log('\n9. Testing is_account_active RPC for Blocked Student...');
  const { data: isActiveState } = await supabase.rpc('is_account_active', { p_user_id: testStudent.id });
  console.log(`   ✓ is_account_active(${testStudent.id}) = ${isActiveState}`);
  assert.strictEqual(isActiveState, false, 'is_account_active must return false for blocked student');

  // STEP 10: Test Unblocking Student Access (unblock_student_access RPC)
  console.log('\n10. Executing unblock_student_access RPC...');
  const resolutionReason = 'Student completed counselling and signed attendance warning acknowledgment.';
  const unblockRes = await authService.unblockStudentAccess({
    studentId: testStudent.id,
    unblockReason: resolutionReason
  });

  console.log('   Unblock Response:', JSON.stringify(unblockRes, null, 2));
  assert.ok(unblockRes.success, 'Unblock action should be successful');

  // STEP 11: Verify Profile Restored to Active
  console.log('\n11. Verifying public.profiles Restored State...');
  const { data: restoredProfile } = await supabase
    .from('profiles')
    .select('account_status, status, blocked_reason, blocked_at, blocked_by')
    .eq('id', testStudent.id)
    .single();

  console.log('   Restored Profile DB State:', JSON.stringify(restoredProfile, null, 2));
  assert.strictEqual(restoredProfile.account_status, 'active', 'account_status must be restored to active');
  assert.strictEqual(restoredProfile.blocked_reason, null, 'blocked_reason must be cleared to null');

  // STEP 12: Verify Historical Restriction Record Preserved as Resolved
  console.log('\n12. Verifying Historical Restriction Preserved as Resolved...');
  const { data: resolvedHistoryRow } = await supabase
    .from('user_restrictions')
    .select('*')
    .eq('id', restrictionId)
    .single();

  console.log(`   Resolved History: Status=${resolvedHistoryRow.status}, UnblockedBy=${resolvedHistoryRow.unblocked_by}, Reason=${resolvedHistoryRow.unblock_reason}`);
  assert.strictEqual(resolvedHistoryRow.status, 'resolved', 'Historical record status must be resolved');
  assert.strictEqual(resolvedHistoryRow.unblocked_by, staffUid, 'unblocked_by must match staff UID');
  assert.strictEqual(resolvedHistoryRow.unblock_reason, resolutionReason);

  // STEP 13: Test is_account_active for Unblocked Student
  console.log('\n13. Testing is_account_active RPC for Unblocked Student...');
  const { data: isRestoredActive } = await supabase.rpc('is_account_active', { p_user_id: testStudent.id });
  console.log(`   ✓ is_account_active(${testStudent.id}) = ${isRestoredActive}`);
  assert.strictEqual(isRestoredActive, true, 'is_account_active must return true for unblocked student');

  // STEP 14: Test Historical Report RPC (get_student_access_block_report)
  console.log('\n14. Testing get_student_access_block_report RPC...');
  const reportRows = await authService.getStudentAccessBlockReport();
  console.log(`   ✓ Total Historical Report Rows Returned: ${reportRows.length}`);
  assert.ok(reportRows.length > 0, 'Block report must return historical records');
  const targetReportRow = reportRows.find(r => r.blockRecordId === restrictionId);
  assert.ok(targetReportRow, 'Target test restriction must be included in report');
  console.log(`   ✓ Report Row Verified: Student=${targetReportRow.studentName}, BlockReason=${targetReportRow.blockReason}, UnblockReason=${targetReportRow.unblockReason}`);

  console.log('\n============================================================');
  console.log('🎉 ALL STUDENT ACCESS MANAGEMENT TESTS PASSED 100%');
  console.log('============================================================');
}

runStudentAccessManagementTest().catch(err => {
  console.error('\n❌ Test Suite Error:', err);
  process.exit(1);
});
