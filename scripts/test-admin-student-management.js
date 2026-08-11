import assert from 'assert';
import { supabase } from '../src/lib/supabase.js';

console.log('=== SeatSync Admin Student Management Test Suite ===\n');

async function runAdminStudentTest() {
  try {
    console.log('1. Calling get_admin_students_list() RPC...');
    const { data: students, error } = await supabase.rpc('get_admin_students_list');
    assert.ifError(error);
    assert.ok(Array.isArray(students), 'RPC returned students array');
    assert.ok(students.length > 0, `Returned ${students.length} student profiles from public.profiles`);

    console.log('\nFetched Student Profiles from public.profiles:');
    students.forEach((s, idx) => {
      console.log(`  [${idx + 1}] ${s.full_name} | Reg: ${s.registration_number} | Email: ${s.email} | Dept: ${s.department} | Year: ${s.year_of_study} | Status: ${s.status}`);
      assert.ok(s.id, 'Student has UUID id');
      assert.ok(s.full_name, 'Student has full_name');
      assert.ok(s.email, 'Student has email');
      assert.ok(s.registration_number, 'Student has registration_number');
    });

    console.log('\n[PASS] Admin Student Account Management successfully verified! Fetches all student names and details from public.profiles.');
  } catch (err) {
    console.error('\n[FAIL] Test error:', err.message || err);
    process.exit(1);
  }
}

runAdminStudentTest();
