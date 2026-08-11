import { supabase, isUUID } from '../lib/supabase.js';
import { db } from './mockDatabase.js';
import { ROLES, defaultUsers } from '../data/seedData.js';

export function parseErrorMessage(err, fallbackMsg = 'An unexpected error occurred. Please try again.') {
  if (!err) return fallbackMsg;
  const str = typeof err === 'string' ? err : (err.message || err.error_description || err.msg || '');
  if (str.toLowerCase().includes('rate limit') || str.toLowerCase().includes('over_email_send_rate_limit')) {
    return 'Email rate limit reached (Supabase limits 3 emails/hr on default SMTP). Please wait a few minutes or disable email confirmation in Supabase Dashboard.';
  }
  if (typeof err === 'string') {
    const trimmed = err.trim();
    if (trimmed && trimmed !== '{}' && trimmed !== '[object Object]') return trimmed;
    return fallbackMsg;
  }
  if (err instanceof Error && err.message) {
    if (typeof err.message === 'string') {
      const trimmed = err.message.trim();
      if (trimmed && trimmed !== '{}' && trimmed !== '[object Object]') return trimmed;
    }
  }
  if (typeof err === 'object') {
    if (err.message && typeof err.message === 'string') {
      const trimmed = err.message.trim();
      if (trimmed && trimmed !== '{}' && trimmed !== '[object Object]') return trimmed;
    }
    if (err.error_description && typeof err.error_description === 'string') return err.error_description;
    if (err.msg && typeof err.msg === 'string') return err.msg;
  }
  return fallbackMsg;
}

export const authService = {
  getCurrentUser() {
    try {
      const stored = localStorage.getItem('seatsync_session');
      if (!stored) return null;
      return JSON.parse(stored);
    } catch {
      return null;
    }
  },

  async _saveToLocalUser({ fullName, registrationNumber, department, yearOfStudy, email, password }) {
    let users = await db.read('seatsync_users');
    if (!users || !Array.isArray(users) || users.length === 0) {
      users = [...defaultUsers];
    }
    const cleanEmail = email.trim().toLowerCase();
    const cleanRegNo = registrationNumber.trim();

    // Check if duplicate user
    const existing = users.find(u =>
      (u.email && u.email.toLowerCase() === cleanEmail) ||
      (u.collegeId && u.collegeId.toLowerCase() === cleanRegNo.toLowerCase()) ||
      (u.registration_number && u.registration_number.toLowerCase() === cleanRegNo.toLowerCase()) ||
      (u.identifier && u.identifier.toLowerCase() === cleanEmail)
    );

    if (existing) {
      throw new Error('An account with this email or registration number already exists.');
    }

    const newUser = {
      id: `std_${Date.now()}`,
      name: fullName,
      fullName: fullName,
      email: cleanEmail,
      collegeId: cleanRegNo,
      registration_number: cleanRegNo,
      identifier: cleanEmail,
      department,
      yearOfStudy: Number(yearOfStudy),
      role: ROLES.STUDENT,
      status: 'ACTIVE',
      password: password,
      noShowCount: 0
    };

    users.push(newUser);
    await db.write('seatsync_users', users);
    return newUser;
  },

  async isLibrarianAuthorizedByAdmin(identifierOrEmail) {
    const clean = String(identifierOrEmail || '').trim().toLowerCase();
    if (!clean) return false;

    // 1. Check Supabase DB profiles table for validated librarian profile
    try {
      const { data: dbProfiles } = await supabase
        .from('profiles')
        .select('*')
        .or(`email.ilike."${clean}",staff_id.ilike."${clean}",login_identifier.ilike."${clean}"`);

      if (dbProfiles && dbProfiles.length > 0) {
        const validLibrarian = dbProfiles.find(p =>
          ['librarian', 'senior_librarian', 'support_staff'].includes(String(p.role).toLowerCase()) &&
          String(p.status || 'active').toLowerCase() === 'active'
        );
        if (validLibrarian) return true;
      }
    } catch { /* proceed to local DB fallback */ }

    // 2. Check local DB seatsync_users for validated librarian
    try {
      const users = (await db.read('seatsync_users')) || [];
      const validUser = users.find(u =>
        (
          (u.email && u.email.toLowerCase() === clean) ||
          (u.staffId && u.staffId.toLowerCase() === clean) ||
          (u.identifier && u.identifier.toLowerCase() === clean) ||
          (clean === 'lib001' || clean === 'staff001' || clean === 'librarian@college.edu')
        ) &&
        (u.role === 'LIBRARIAN' || u.role === 'STAFF' || u.role === 'librarian') &&
        String(u.status || 'ACTIVE').toUpperCase() === 'ACTIVE'
      );
      if (validUser) return true;
    } catch { /* proceed */ }

    return false;
  },

  async ensureMyProfile() {
    try {
      const { data, error } = await supabase.rpc('ensure_my_profile');
      if (error) {
        console.warn('[authService] ensure_my_profile error:', error.message);
        return null;
      }
      return data;
    } catch (err) {
      console.warn('[authService] ensure_my_profile failed:', err);
      return null;
    }
  },

  async updateMyProfile({ fullName, registrationNumber, department, phone, yearOfStudy, gender }) {
    const cleanGender = gender ? (['female', 'girls', 'girl'].includes(String(gender).toLowerCase()) ? 'girls' : 'boys') : null;
    let data = null;
    
    try {
      const { data: rpcData, error } = await supabase.rpc('update_my_profile', {
        p_full_name: fullName || null,
        p_registration_number: registrationNumber || null,
        p_department: department || null,
        p_phone: phone || null,
        p_year_of_study: yearOfStudy ? Number(yearOfStudy) : null
      });

      if (!error) data = rpcData;
    } catch { /* fallback */ }

    // Direct update to profiles table for gender and fallback fields
    try {
      const currentUser = this.getCurrentUser();
      const userId = currentUser?.id;
      if (userId && isUUID(userId)) {
        const updatePayload = {};
        if (fullName) updatePayload.full_name = fullName;
        if (registrationNumber) updatePayload.registration_number = registrationNumber;
        if (department) updatePayload.department = department;
        if (phone) updatePayload.phone = phone;
        if (yearOfStudy) updatePayload.year_of_study = Number(yearOfStudy);
        if (cleanGender) updatePayload.gender = cleanGender;

        const { data: updatedProf } = await supabase
          .from('profiles')
          .update(updatePayload)
          .eq('id', userId)
          .select()
          .single();

        if (updatedProf) data = updatedProf;
      }
    } catch { /* proceed */ }

    // Update session storage profile
    const session = this.getCurrentUser();
    if (session) {
      if (fullName) { session.name = fullName; session.fullName = fullName; }
      if (registrationNumber) session.collegeId = registrationNumber;
      if (department) session.department = department;
      if (yearOfStudy) session.yearOfStudy = Number(yearOfStudy);
      if (cleanGender) { session.gender = cleanGender; session.genderGroup = cleanGender; }
      localStorage.setItem('seatsync_session', JSON.stringify(session));
      window.dispatchEvent(new Event('storage'));
    }

    return data || session;
  },

  async login(identifier, password, rememberMe = true) {
    const cleanId = String(identifier || '').trim();
    const cleanPass = String(password || '').trim();

    if (!cleanId || !cleanPass) {
      throw new Error('Invalid ID/email or password.');
    }

    let targetEmail = cleanId.toLowerCase();
    let authSucceeded = false;
    let authUser = null;

    // 1. Resolve Staff ID, Admin ID, or Reg Number (if no '@') via RPC
    if (!cleanId.includes('@')) {
      try {
        const { data: resolvedEmail, error: rpcError } = await supabase
          .rpc('fn_get_auth_email_by_identifier', { p_identifier: cleanId });

        if (!rpcError && resolvedEmail && resolvedEmail.length > 0 && resolvedEmail[0].auth_email) {
          targetEmail = resolvedEmail[0].auth_email;
        } else {
          // Fallback check against profiles table
          const { data: profile } = await supabase
            .from('profiles')
            .select('email')
            .or(`login_identifier.eq."${cleanId.toLowerCase()}",staff_id.eq."${cleanId}",admin_id.eq."${cleanId}",registration_number.eq."${cleanId}"`)
            .maybeSingle();

          if (profile && profile.email) {
            targetEmail = profile.email;
          }
        }
      } catch { /* proceed */ }
    }

    // 2. Authenticate with Supabase Auth
    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: targetEmail,
        password: cleanPass
      });

      if (!authError && authData?.user) {
        authSucceeded = true;
        authUser = authData.user;
      }
    } catch (err) {
      if (err.message && err.message.includes('rate limit')) {
        throw err;
      }
    }

    // 3. If Supabase Auth verified the credentials
    if (authSucceeded && authUser) {
      // Call ensure_my_profile() to sync profile, last_login_at, and verified email atomically
      let profile = await this.ensureMyProfile();

      if (!profile) {
        const { data: fallbackProfile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', authUser.id)
          .single();
        profile = fallbackProfile;
      }

      if (profile) {
        // Call get_my_access_status RPC to retrieve comprehensive access info
        let myStatus = null;
        try {
          const { data: statusData } = await supabase.rpc('get_my_access_status');
          if (statusData) myStatus = statusData;
        } catch { /* proceed with profile */ }

        const accountStatus = String(myStatus?.account_status || profile.account_status || profile.status || 'active').toLowerCase();

        if (accountStatus === 'blocked') {
          const blockedInfo = {
            reason: myStatus?.blocked_reason || profile.blocked_reason || 'Policy violation',
            blockedAt: myStatus?.blocked_at || profile.blocked_at || new Date().toISOString(),
            blockedBy: myStatus?.blocked_by_display_name || 'Library Administration'
          };
          try {
            sessionStorage.setItem('seatsync_blocked_info', JSON.stringify(blockedInfo));
            localStorage.setItem('seatsync_blocked_info', JSON.stringify(blockedInfo));
          } catch { /* fallback */ }

          await supabase.auth.signOut();
          const err = new Error(`Your SeatSync account has been blocked by library staff.\n\nReason: ${blockedInfo.reason}`);
          err.code = 'ACCOUNT_BLOCKED';
          err.blockedInfo = blockedInfo;
          throw err;
        }

        if (accountStatus === 'suspended') {
          await supabase.auth.signOut();
          const err = new Error('Your SeatSync account is suspended. Please contact the library administrator.');
          err.code = 'ACCOUNT_SUSPENDED';
          throw err;
        }

        if (accountStatus === 'inactive') {
          await supabase.auth.signOut();
          throw new Error('This account is inactive. Contact the administrator.');
        }

        const dbRole = String(profile.role || 'student').toLowerCase();
        let mappedRole = ROLES.STUDENT;
        if (['librarian', 'senior_librarian', 'support_staff'].includes(dbRole)) {
          mappedRole = ROLES.LIBRARIAN;
        } else if (['admin', 'super_admin', 'report_viewer'].includes(dbRole)) {
          mappedRole = ROLES.ADMIN;
        }

        // Validate librarian against DB profiles
        if (mappedRole === ROLES.LIBRARIAN) {
          const isValidLibrarian = await this.isLibrarianAuthorizedByAdmin(profile.email || profile.staff_id || cleanId);
          if (!isValidLibrarian) {
            await supabase.auth.signOut();
            throw new Error('Librarian login failed: Your email has not been validated or authorized by the Admin in the database. Please contact Admin to register your email.');
          }
        }

        const sessionUser = {
          id: profile.id,
          name: profile.full_name,
          fullName: profile.full_name,
          email: profile.email,
          collegeId: profile.registration_number || profile.admin_id || profile.staff_id,
          registration_number: profile.registration_number,
          department: profile.department,
          yearOfStudy: profile.year_of_study,
          staffId: profile.staff_id || profile.registration_number,
          adminId: profile.admin_id || profile.registration_number,
          identifier: cleanId,
          dbRole: profile.role,
          role: mappedRole,
          gender: String(profile.gender || 'boys').toLowerCase() === 'female' || String(profile.gender || 'boys').toLowerCase() === 'girls' ? 'girls' : 'boys',
          genderGroup: String(profile.gender || 'boys').toLowerCase() === 'female' || String(profile.gender || 'boys').toLowerCase() === 'girls' ? 'girls' : 'boys',
          status: accountStatus.toUpperCase(),
          noShowCount: profile.no_show_count || 0,
          needsProfileCompletion: mappedRole === ROLES.STUDENT && (!profile.registration_number || !profile.department)
        };

        // Audit Logging for Librarian Login Success
        if (mappedRole === ROLES.LIBRARIAN) {
          try {
            await supabase.from('audit_logs').insert({
              actor_id: profile.id,
              target_id: profile.id,
              event_type: 'LIBRARIAN_LOGIN_SUCCESS',
              metadata: { email: profile.email, staff_id: profile.staff_id }
            });
          } catch { /* non-blocking */ }
        }

        localStorage.setItem('seatsync_session', JSON.stringify(sessionUser));
        window.dispatchEvent(new Event('storage'));
        return sessionUser;
      }
    }

    // 3.5 Direct Supabase Database Admin profile check if password matches 123456 or admin123
    if (cleanId.toUpperCase() === 'BIT1000' || cleanId.toLowerCase() === 'admin@bitsathy.ac.in' || cleanId.toUpperCase() === 'ADM001') {
      try {
        const { data: dbAdmin } = await supabase
          .from('profiles')
          .select('*')
          .or(`admin_id.ilike."${cleanId}",login_identifier.ilike."${cleanId}",email.ilike."${targetEmail}"`)
          .maybeSingle();

        if (dbAdmin && ['admin', 'super_admin'].includes(String(dbAdmin.role).toLowerCase()) && String(dbAdmin.status || 'active').toLowerCase() === 'active') {
          if (cleanPass === '123456' || cleanPass === 'admin123' || cleanPass === 'Admin123!') {
            const sessionUser = {
              id: dbAdmin.id,
              name: dbAdmin.full_name,
              fullName: dbAdmin.full_name,
              email: dbAdmin.email,
              collegeId: dbAdmin.admin_id || 'BIT1000',
              adminId: dbAdmin.admin_id || 'BIT1000',
              identifier: cleanId,
              dbRole: dbAdmin.role,
              role: ROLES.ADMIN,
              status: 'ACTIVE',
              noShowCount: 0
            };
            localStorage.setItem('seatsync_session', JSON.stringify(sessionUser));
            window.dispatchEvent(new Event('storage'));
            return sessionUser;
          }
        }
      } catch { /* proceed */ }
    }

    // 4. Fallback check against seed/mock database users
    let users = await db.read('seatsync_users');
    if (!users || !Array.isArray(users) || users.length === 0) {
      users = [...defaultUsers];
      await db.write('seatsync_users', defaultUsers);
    } else {
      // Merge missing default seed users (like BIT1000) into cached users list
      let updated = false;
      defaultUsers.forEach(du => {
        const hasUser = users.some(u =>
          (u.identifier && u.identifier.toLowerCase() === du.identifier.toLowerCase()) ||
          (u.adminId && du.adminId && u.adminId.toLowerCase() === du.adminId.toLowerCase()) ||
          (u.email && u.email.toLowerCase() === du.email.toLowerCase())
        );
        if (!hasUser) {
          users.push(du);
          updated = true;
        }
      });
      if (updated) {
        await db.write('seatsync_users', users);
      }
    }

    const matchedUser = users.find(u => {
      const matchId = (
        (u.identifier && String(u.identifier).toLowerCase() === cleanId.toLowerCase()) ||
        (u.collegeId && String(u.collegeId).toLowerCase() === cleanId.toLowerCase()) ||
        (u.registration_number && String(u.registration_number).toLowerCase() === cleanId.toLowerCase()) ||
        (u.staffId && String(u.staffId).toLowerCase() === cleanId.toLowerCase()) ||
        (u.adminId && String(u.adminId).toLowerCase() === cleanId.toLowerCase()) ||
        (u.email && String(u.email).toLowerCase() === cleanId.toLowerCase()) ||
        (cleanId.toUpperCase() === 'BIT1000' && (u.adminId === 'BIT1000' || u.identifier === 'BIT1000')) ||
        (cleanId.toUpperCase() === 'STAFF001' && (u.staffId === 'LIB001' || u.role === 'LIBRARIAN')) ||
        (cleanId.toUpperCase() === 'LIB001' && (u.staffId === 'LIB001' || u.role === 'LIBRARIAN'))
      );
      const passMatch = u.password === cleanPass ||
        (cleanPass === '123456' && (u.password === '123456' || u.adminId === 'BIT1000' || u.identifier === 'BIT1000')) ||
        (cleanPass === 'Staff123!' && u.password === 'staff123') ||
        (cleanPass === 'Admin123!' && u.password === 'admin123') ||
        (cleanPass === 'Student123!' && u.password === 'student123');

      return matchId && passMatch;
    });

    if (!matchedUser) {
      // Audit Logging for failed librarian login attempt if identifier suggests librarian
      if (cleanId.toUpperCase().includes('LIB') || cleanId.toUpperCase().includes('STAFF')) {
        try {
          await supabase.from('audit_logs').insert({
            event_type: 'LIBRARIAN_LOGIN_FAILED',
            metadata: { identifier: cleanId }
          });
        } catch { /* non-blocking */ }
      }

      throw new Error('Invalid ID/email or password.');
    }

    let role = matchedUser.role;
    if (role === 'STAFF') role = ROLES.LIBRARIAN;

    // Validate librarian role against DB profiles
    if (role === ROLES.LIBRARIAN) {
      const isAuthorized = await this.isLibrarianAuthorizedByAdmin(matchedUser.email || matchedUser.staffId || cleanId);
      if (!isAuthorized) {
        throw new Error('Librarian login failed: Your email has not been validated or authorized by the Admin in the database. Please contact Admin to register your email.');
      }
    }

    const status = String(matchedUser.status || 'ACTIVE').toUpperCase();
    if (status === 'BLOCKED') {
      const err = new Error('Your SeatSync account is blocked. Please contact the library administrator.');
      err.code = 'ACCOUNT_BLOCKED';
      throw err;
    }
    if (status === 'SUSPENDED') {
      const err = new Error('Your SeatSync account is suspended. Please contact the library administrator.');
      err.code = 'ACCOUNT_SUSPENDED';
      throw err;
    }
    if (status === 'INACTIVE') {
      throw new Error('This account is inactive. Contact the administrator.');
    }

    const sessionUser = {
      ...matchedUser,
      role,
      needsProfileCompletion: role === ROLES.STUDENT && (!matchedUser.collegeId && !matchedUser.registration_number)
    };

    localStorage.setItem('seatsync_session', JSON.stringify(sessionUser));
    window.dispatchEvent(new Event('storage'));
    return sessionUser;
  },

  async registerStudent({ fullName, registrationNumber, department, yearOfStudy, gender = 'male', email, password }) {
    const cleanEmail = email.trim().toLowerCase();
    const cleanRegNo = registrationNumber.trim();
    const cleanGender = ['female', 'girl', 'girls'].includes(String(gender).toLowerCase()) ? 'female' : 'male';

    if (!fullName || !fullName.trim()) throw new Error('Full Name is required.');
    if (!cleanRegNo) throw new Error('Registration Number is required.');
    if (!cleanEmail || !cleanEmail.includes('@')) throw new Error('Valid college email is required.');
    if (!password || password.length < 6) throw new Error('Password must be at least 6 characters.');

    // Supabase Auth sign up
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        data: {
          full_name: fullName.trim(),
          registration_number: cleanRegNo,
          department,
          year_of_study: Number(yearOfStudy),
          gender: cleanGender
        }
      }
    });

    if (authError) {
      console.warn('Supabase auth sign up warning:', authError.message || authError);
      if (authError.message && (authError.message.includes('already registered') || authError.message.includes('already exists'))) {
        throw new Error('An account with this email is already registered.');
      }
    }

    const userId = authData?.user?.id;
    if (userId && isUUID(userId)) {
      await supabase
        .from('profiles')
        .update({ gender: cleanGender })
        .eq('id', userId)
        .catch(() => {});
    }

    return { user: authData?.user, email: cleanEmail, name: fullName, gender: cleanGender };
  },

  async requestPasswordReset(identifier) {
    const cleanId = String(identifier || '').trim();
    let targetEmail = cleanId.toLowerCase();

    if (!cleanId.includes('@')) {
      try {
        const { data: resolvedEmail } = await supabase
          .rpc('fn_get_auth_email_by_identifier', { p_identifier: cleanId });

        if (resolvedEmail && resolvedEmail.length > 0 && resolvedEmail[0].auth_email) {
          targetEmail = resolvedEmail[0].auth_email;
        }
      } catch { /* proceed with input */ }
    }

    const base = import.meta.env.BASE_URL || '/';
    const resetPath = `${base}reset-password`.replace(/\/\//g, '/');
    try {
      await supabase.auth.resetPasswordForEmail(targetEmail, {
        redirectTo: `${window.location.origin}${resetPath}`
      });
    } catch (err) {
      console.warn('Password reset request error:', err);
    }
    return true;
  },

  async resendConfirmationEmail(identifier) {
    const cleanId = String(identifier || '').trim();
    let targetEmail = cleanId.toLowerCase();

    if (!cleanId.includes('@')) {
      try {
        const { data: resolvedEmail } = await supabase
          .rpc('fn_get_auth_email_by_identifier', { p_identifier: cleanId });

        if (resolvedEmail && resolvedEmail.length > 0 && resolvedEmail[0].auth_email) {
          targetEmail = resolvedEmail[0].auth_email;
        }
      } catch { /* proceed */ }
    }

    const { data, error } = await supabase.auth.resend({
      type: 'signup',
      email: targetEmail
    });

    if (error) {
      throw new Error(parseErrorMessage(error, 'Failed to resend confirmation email.'));
    }
    return data;
  },

  async updatePassword(newPassword) {
    let supabaseData = null;
    let supabaseError = null;

    try {
      const { data, error } = await supabase.auth.updateUser({
        password: newPassword
      });
      if (error) supabaseError = error;
      else supabaseData = data;
    } catch (err) {
      supabaseError = err;
    }

    // Also sync password into seatsync_session and seatsync_users local storage
    const session = this.getCurrentUser();
    if (session) {
      session.password = newPassword;
      localStorage.setItem('seatsync_session', JSON.stringify(session));
      try {
        let users = await db.read('seatsync_users');
        if (Array.isArray(users)) {
          const idx = users.findIndex(u =>
            (u.id && session.id && u.id === session.id) ||
            (u.email && session.email && u.email.toLowerCase() === session.email.toLowerCase()) ||
            (u.collegeId && session.collegeId && u.collegeId.toLowerCase() === session.collegeId.toLowerCase())
          );
          if (idx !== -1) {
            users[idx].password = newPassword;
            await db.write('seatsync_users', users);
          }
        }
      } catch { /* ignore */ }
    }

    if (supabaseError && !session) {
      throw new Error(parseErrorMessage(supabaseError, 'Failed to update password.'));
    }

    return supabaseData || { success: true };
  },

  async logout() {
    const currentUser = this.getCurrentUser();
    if (currentUser && currentUser.role === ROLES.LIBRARIAN) {
      try {
        await supabase.from('audit_logs').insert({
          actor_id: currentUser.id && isUUID(currentUser.id) ? currentUser.id : null,
          event_type: 'LIBRARIAN_LOGOUT',
          metadata: { email: currentUser.email, staff_id: currentUser.staffId }
        });
      } catch { /* non-blocking */ }
    }

    try {
      await supabase.auth.signOut();
    } catch { /* ignore */ }
    localStorage.removeItem('seatsync_session');
    window.dispatchEvent(new Event('storage'));
  },

  getDashboardRoute(role, session = null) {
    if (session?.needsProfileCompletion) {
      return '/complete-profile';
    }
    switch (role) {
      case ROLES.STUDENT:
        return '/student/dashboard';
      case ROLES.LIBRARIAN:
        return '/librarian/dashboard';
      case ROLES.ADMIN:
        return '/admin/dashboard';
      default:
        return '/unauthorized';
    }
  },

  // STUDENT ACCESS MANAGEMENT ENGINE (RPC)
  async getMyAccessStatus() {
    try {
      const { data, error } = await supabase.rpc('get_my_access_status');
      if (error) {
        console.error('[authService] get_my_access_status RPC error:', error);
        return { authenticated: false, account_status: 'active' };
      }
      return data || { authenticated: false, account_status: 'active' };
    } catch (err) {
      console.warn('[authService] getMyAccessStatus notice:', err);
      return { authenticated: false, account_status: 'active' };
    }
  },

  async getStudentAccessManagement({ search = null, department = null, status = null } = {}) {
    const { data, error } = await supabase.rpc('get_student_access_management', {
      p_search: search && search.trim() ? search.trim() : null,
      p_department: department && department !== 'all' ? department : null,
      p_status: status && status !== 'all' ? status : null
    });

    if (error) {
      console.error('[authService] get_student_access_management RPC error:', error);
      throw new Error(error.message || 'Unable to fetch student records.');
    }

    return (data || []).map(s => ({
      id: s.student_id,
      name: s.full_name || s.email?.split('@')[0] || 'Student',
      registrationNumber: s.college_id || 'N/A',
      email: s.email,
      department: s.department || 'General Study',
      yearOfStudy: s.year_of_study || 1,
      accountStatus: String(s.account_status || 'active').toLowerCase(),
      isBlocked: Boolean(s.is_blocked),
      activeBlockId: s.active_block_id,
      blockedReason: s.blocked_reason,
      blockedAt: s.blocked_at,
      blockedById: s.blocked_by_id,
      blockedByName: s.blocked_by_name || 'Library Staff',
      totalBlockEvents: s.total_block_events || 0,
      createdAt: s.created_at
    }));
  },

  async blockStudentAccess({ studentId, reason, category = 'Policy violation', expiresAt = null }) {
    if (!studentId || !isUUID(studentId)) {
      throw new Error('Please select a valid student account.');
    }
    const cleanReason = String(reason || '').trim();
    if (!cleanReason) {
      throw new Error('Reason for blocking access is required.');
    }

    const { data, error } = await supabase.rpc('block_student_access', {
      p_student_id: studentId,
      p_reason: cleanReason,
      p_category: category || 'Policy violation',
      p_expires_at: expiresAt || null
    });

    if (error) {
      console.error('[authService] block_student_access RPC error:', error);
      throw new Error(error.message || 'Failed to block student access.');
    }

    if (data && !data.success) {
      throw new Error(data.message || 'Block action rejected.');
    }

    return data;
  },

  async unblockStudentAccess({ studentId, unblockReason }) {
    if (!studentId || !isUUID(studentId)) {
      throw new Error('Please select a valid student account.');
    }
    const cleanReason = String(unblockReason || '').trim();
    if (!cleanReason) {
      throw new Error('Resolution reason is required to unblock access.');
    }

    const { data, error } = await supabase.rpc('unblock_student_access', {
      p_student_id: studentId,
      p_unblock_reason: cleanReason
    });

    if (error) {
      console.error('[authService] unblock_student_access RPC error:', error);
      throw new Error(error.message || 'Failed to unblock student access.');
    }

    if (data && !data.success) {
      throw new Error(data.message || 'Unblock action rejected.');
    }

    return data;
  },

  async getStudentAccessBlockReport({ status = null, fromDate = null, toDate = null, department = null } = {}) {
    try {
      const { data, error } = await supabase.rpc('get_student_access_block_report', {
        p_status: status && status !== 'all' ? status : null,
        p_from_date: fromDate || null,
        p_to_date: toDate || null,
        p_department: department && department !== 'all' ? department : null
      });

      if (error) {
        console.error('[authService] get_student_access_block_report RPC error:', error);
        throw error;
      }

      return (data || []).map(r => ({
        blockRecordId: r.block_record_id,
        studentId: r.student_id,
        studentName: r.student_name,
        registrationNumber: r.registration_number || 'N/A',
        email: r.email,
        department: r.department,
        currentAccountStatus: r.current_account_status,
        blockStatus: r.block_status, // 'active' | 'resolved' | 'expired'
        blockCategory: r.block_category,
        blockReason: r.block_reason,
        blockedAt: r.blocked_at,
        blockedById: r.blocked_by_id,
        blockedByName: r.blocked_by_name || 'Library Staff',
        expiresAt: r.expires_at,
        unblockedAt: r.unblocked_at,
        unblockedById: r.unblocked_by_id,
        unblockedByName: r.unblocked_by_name,
        unblockReason: r.unblock_reason,
        duration: r.duration
      }));
    } catch (err) {
      console.warn('[authService] getStudentAccessBlockReport notice:', err.message);
      throw err;
    }
  }
};
