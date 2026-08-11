import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://hftpwhuzfoawujspkmpf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable__QIBzlwOumqkB42mfDFXtw_kj8jKBie';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function inspectProfiles() {
  console.log('=== Inspecting Profiles Table for Admin/Librarian ===\n');

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, admin_id, staff_id, registration_number, login_identifier');

  if (error) {
    console.error('Error:', error);
  } else {
    console.log('Profiles Found:', JSON.stringify(profiles, null, 2));
  }
}

inspectProfiles();
