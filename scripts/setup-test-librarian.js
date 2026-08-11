import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://hftpwhuzfoawujspkmpf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable__QIBzlwOumqkB42mfDFXtw_kj8jKBie';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function setupLibrarian() {
  console.log('=== Setting Up Test Librarian in Supabase Auth & Profiles ===\n');

  const email = 'librarian@bitsathy.ac.in';
  const password = '123456';

  // 1. Sign in or Sign up
  console.log('1. Attempting sign-in for librarian@bitsathy.ac.in...');
  let { data: authData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });

  if (signInError) {
    console.log('   Sign in failed:', signInError.message, '- Attempting signUp...');
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password });
    if (signUpError) {
      console.error('   SignUp Error:', signUpError.message);
      process.exit(1);
    }
    authData = signUpData;
    console.log('   ✓ Signed Up new auth user:', authData.user.id);
  } else {
    console.log('   ✓ Signed In existing auth user:', authData.user.id);
  }

  const userId = authData.user.id;

  // 2. Sync profile row via RPC
  console.log('2. Syncing librarian profile row via ensure_my_profile...');
  const { data: profileData, error: pErr } = await supabase.rpc('ensure_my_profile');
  if (pErr) {
    console.error('   ensure_my_profile error:', pErr.message);
  } else {
    console.log('   ✓ ensure_my_profile result:', profileData);
  }

  // 3. Ensure role = 'librarian'
  console.log('3. Updating profile role to librarian...');
  const { error: updateErr } = await supabase
    .from('profiles')
    .update({ role: 'librarian', full_name: 'Chief Librarian', staff_id: 'LIB100' })
    .eq('id', userId);

  if (updateErr) {
    console.error('   Profile update error:', updateErr.message);
  } else {
    console.log('   ✓ Profile updated to role = librarian');
  }

  console.log('\n=== LIBRARIAN USER READY FOR AUTHENTICATED SCANNING TESTS ===');
}

setupLibrarian();
