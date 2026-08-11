import React, { useEffect, useState } from 'react';
import { supabase, isUUID } from '../../lib/supabase';
import { db } from '../../services/mockDatabase';
import { useAuth } from '../../auth/AuthProvider';
import { useSync } from '../../hooks/useSync';
import { Card, CardContent } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Input } from '../../components/shared/Input';
import { Label } from '../../components/shared/Label';
import { Badge } from '../../components/shared/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/shared/Dialog';
import { UserCheck, Plus, Search, RefreshCw, ShieldAlert, ShieldCheck, Lock, Unlock, Eye, Mail, Phone, Building, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function StaffManagementPage() {
  const { user: currentUser } = useAuth();
  const [staffList, setStaffList] = useState([]);
  const [libraries, setLibraries] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);

  // Add Librarian Modal State
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [newStaff, setNewStaff] = useState({
    fullName: '',
    email: '',
    staffId: '',
    phone: '',
    libraryId: ''
  });

  // View Details Modal State
  const [viewStaff, setViewStaff] = useState(null);

  const fetchStaff = async () => {
    try {
      setLoading(true);

      // 1. Fetch real Supabase profiles for librarians
      let dbStaff = [];
      const { data: dbProfiles, error } = await supabase
        .from('profiles')
        .select('*');

      if (!error && dbProfiles && dbProfiles.length > 0) {
        dbStaff = dbProfiles
          .filter(p => ['librarian', 'senior_librarian', 'support_staff', 'staff'].includes(String(p.role || '').toLowerCase()))
          .map(p => ({
            id: p.id,
            staffId: p.staff_id || p.login_identifier || p.registration_number || 'LIB-001',
            name: p.full_name || 'Library Staff',
            email: p.email,
            phone: p.phone || 'N/A',
            department: p.department || 'Library Operations',
            role: 'LIBRARIAN',
            dbRole: p.role,
            status: String(p.status || 'active').toUpperCase(),
            createdAt: p.created_at
          }));
      }

      // 2. Fetch local database staff
      const localUsers = (await db.read('seatsync_users')) || [];
      const localStaff = localUsers
        .filter(u => u.role === 'LIBRARIAN' || u.role === 'STAFF')
        .map(u => ({
          ...u,
          staffId: u.staffId || u.identifier || u.collegeId || 'LIB-001',
          status: String(u.status || 'ACTIVE').toUpperCase()
        }));

      // Merge and deduplicate by email or staffId
      const staffMap = new Map();
      dbStaff.forEach(s => {
        const key = (s.email || s.staffId || s.id).toLowerCase();
        staffMap.set(key, s);
      });
      localStaff.forEach(s => {
        const key = (s.email || s.staffId || s.id).toLowerCase();
        if (!staffMap.has(key)) staffMap.set(key, s);
      });

      const combinedStaff = Array.from(staffMap.values());
      setStaffList(combinedStaff.length > 0 ? combinedStaff : localStaff);

      // Fetch libraries for dropdown
      const { data: libData } = await supabase.from('libraries').select('id, name, code');
      if (libData) setLibraries(libData);
    } catch {
      toast.error('Failed to load staff list.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStaff();
  }, []);

  useSync((event) => {
    if (event?.type === 'storage_change') fetchStaff();
  });

  // Handle Add Librarian Form Submission
  const handleAddStaff = async (e) => {
    e.preventDefault();
    const cleanName = newStaff.fullName.trim();
    const cleanEmail = newStaff.email.trim().toLowerCase();
    const cleanStaffId = newStaff.staffId.trim();

    if (!cleanName) {
      toast.error('Please enter Full Name.');
      return;
    }
    if (!cleanEmail || !cleanEmail.includes('@')) {
      toast.error('Please enter a valid official email address.');
      return;
    }
    if (!cleanStaffId) {
      toast.error('Please enter Staff ID.');
      return;
    }

    setSubmitting(true);

    try {
      // 1. Check duplicate librarian email or Staff ID in Supabase profiles
      const { data: dupCheck } = await supabase
        .from('profiles')
        .select('id, email, staff_id')
        .or(`email.eq."${cleanEmail}",staff_id.eq."${cleanStaffId}"`)
        .maybeSingle();

      if (dupCheck) {
        if (dupCheck.email?.toLowerCase() === cleanEmail && dupCheck.staff_id !== cleanStaffId) {
          throw new Error('An account with this email address already exists.');
        }
      }

      let createdUserId = null;

      // 2. Try Supabase Auth Sign Up to establish auth credentials for librarian
      try {
        const { data: authData } = await supabase.auth.signUp({
          email: cleanEmail,
          password: 'staff123',
          options: {
            data: {
              full_name: cleanName,
              role: 'librarian',
              staff_id: cleanStaffId
            }
          }
        });
        if (authData?.user?.id) {
          createdUserId = authData.user.id;
        }
      } catch { /* proceed with direct profile store */ }

      // 3. Store / update in Supabase 'profiles' DB table as validated librarian
      if (createdUserId) {
        await supabase.from('profiles').update({
          full_name: cleanName,
          email: cleanEmail,
          staff_id: cleanStaffId,
          login_identifier: cleanStaffId.toLowerCase(),
          role: 'librarian',
          status: 'active',
          phone: newStaff.phone.trim() || null,
          updated_at: new Date().toISOString()
        }).eq('id', createdUserId);
      } else if (dupCheck?.id) {
        await supabase.from('profiles').update({
          full_name: cleanName,
          email: cleanEmail,
          staff_id: cleanStaffId,
          login_identifier: cleanStaffId.toLowerCase(),
          role: 'librarian',
          status: 'active',
          phone: newStaff.phone.trim() || null,
          updated_at: new Date().toISOString()
        }).eq('id', dupCheck.id);
      }

      // 4. Save to local DB (seatsync_users) for offline resiliency
      const localUsers = (await db.read('seatsync_users')) || [];
      const existingIdx = localUsers.findIndex(u =>
        (u.email && u.email.toLowerCase() === cleanEmail) ||
        (u.staffId && u.staffId.toLowerCase() === cleanStaffId.toLowerCase())
      );
      const newStaffRecord = {
        id: createdUserId || dupCheck?.id || `lib_${Date.now()}`,
        identifier: cleanStaffId,
        staffId: cleanStaffId,
        name: cleanName,
        fullName: cleanName,
        email: cleanEmail,
        password: 'staff123',
        role: 'LIBRARIAN',
        status: 'ACTIVE',
        department: 'Library Operations',
        createdAt: new Date().toISOString()
      };

      if (existingIdx >= 0) {
        localUsers[existingIdx] = { ...localUsers[existingIdx], ...newStaffRecord };
      } else {
        localUsers.push(newStaffRecord);
      }
      await db.write('seatsync_users', localUsers);

      // 5. Record Audit Log Event
      try {
        await supabase.from('audit_logs').insert({
          actor_id: currentUser?.id && isUUID(currentUser.id) ? currentUser.id : null,
          event_type: 'LIBRARIAN_CREATED',
          metadata: { full_name: cleanName, email: cleanEmail, staff_id: cleanStaffId }
        });
      } catch { /* non-blocking audit log */ }

      toast.success(`Librarian ${cleanName} (${cleanEmail}) validated and added to DB successfully.`);
      setAddModalOpen(false);
      setNewStaff({ fullName: '', email: '', staffId: '', phone: '', libraryId: '' });
      fetchStaff();
    } catch (err) {
      toast.error(err.message || 'Failed to register librarian in DB.');
    } finally {
      setSubmitting(false);
    }
  };

  // Status Change Handlers (Block, Suspend, Reactivate)
  const handleUpdateStatus = async (staffMember, targetStatus) => {
    const actionText = targetStatus === 'BLOCKED' ? 'block' : targetStatus === 'SUSPENDED' ? 'suspend' : 'reactivate';
    if (!window.confirm(`Are you sure you want to ${actionText} librarian ${staffMember.name}?`)) return;

    try {
      const dbStatus = targetStatus.toLowerCase();

      // 1. Update Supabase Profile
      if (staffMember.id && isUUID(staffMember.id)) {
        const { error: updateErr } = await supabase
          .from('profiles')
          .update({
            status: dbStatus,
            blocked_reason: targetStatus === 'BLOCKED' ? 'Restricted by administrator' : null,
            blocked_at: targetStatus === 'BLOCKED' ? new Date().toISOString() : null
          })
          .eq('id', staffMember.id);

        if (updateErr) throw new Error(updateErr.message);

        // Record Audit Event
        const eventType = targetStatus === 'BLOCKED' ? 'LIBRARIAN_BLOCKED' : targetStatus === 'SUSPENDED' ? 'LIBRARIAN_SUSPENDED' : 'LIBRARIAN_REACTIVATED';
        await supabase.from('audit_logs').insert({
          actor_id: currentUser?.id && isUUID(currentUser.id) ? currentUser.id : null,
          target_id: staffMember.id,
          event_type: eventType,
          metadata: { target_name: staffMember.name, staff_id: staffMember.staffId, new_status: dbStatus }
        });
      }

      // 2. Update local mock database
      const users = await db.read('seatsync_users') || [];
      const updatedUsers = users.map(u => {
        if (u.id === staffMember.id || u.staffId === staffMember.staffId || u.email === staffMember.email) {
          return { ...u, status: targetStatus };
        }
        return u;
      });
      await db.write('seatsync_users', updatedUsers);

      toast.success(`Librarian ${staffMember.name} account is now ${targetStatus}.`);
      fetchStaff();
    } catch (err) {
      toast.error(`Failed to update librarian status: ${err.message}`);
    }
  };

  // Permanently Remove Librarian Handler (Deletes from both DB and interface)
  const handleRemoveStaff = async (staffMember) => {
    if (!window.confirm(`Are you sure you want to permanently remove librarian ${staffMember.name} (${staffMember.email || staffMember.staffId})?\n\nThis will completely delete the librarian account from both the DB and interface.`)) {
      return;
    }

    try {
      // 1. Call RPC fn_remove_librarian in Supabase DB
      try {
        await supabase.rpc('fn_remove_librarian', {
          p_email: staffMember.email || '',
          p_staff_id: staffMember.staffId || null
        });
      } catch { /* proceed with direct delete */ }

      // Direct fallback deletion from profiles
      if (staffMember.id && isUUID(staffMember.id)) {
        await supabase.from('profiles').delete().eq('id', staffMember.id);
      }
      if (staffMember.email) {
        await supabase.from('profiles').delete().ilike('email', staffMember.email);
      }
      if (staffMember.staffId) {
        await supabase.from('profiles').delete().ilike('staff_id', staffMember.staffId);
      }

      // Record Audit Log Event
      try {
        await supabase.from('audit_logs').insert({
          actor_id: currentUser?.id && isUUID(currentUser.id) ? currentUser.id : null,
          event_type: 'LIBRARIAN_REMOVED',
          metadata: { target_name: staffMember.name, email: staffMember.email, staff_id: staffMember.staffId }
        });
      } catch { /* non-blocking */ }

      // 2. Delete from local database (seatsync_users)
      const users = (await db.read('seatsync_users')) || [];
      const updatedUsers = users.filter(u =>
        u.id !== staffMember.id &&
        (!staffMember.staffId || String(u.staffId || u.identifier || '').toLowerCase() !== String(staffMember.staffId).toLowerCase()) &&
        (!staffMember.email || String(u.email || '').toLowerCase() !== String(staffMember.email).toLowerCase())
      );
      await db.write('seatsync_users', updatedUsers);

      // 3. Update local UI state immediately
      setStaffList(prev => prev.filter(s =>
        s.id !== staffMember.id &&
        s.staffId !== staffMember.staffId &&
        s.email !== staffMember.email
      ));

      if (viewStaff?.id === staffMember.id || viewStaff?.staffId === staffMember.staffId) {
        setViewStaff(null);
      }

      toast.success(`Librarian ${staffMember.name} removed successfully from DB and interface.`);
      fetchStaff();
    } catch (err) {
      toast.error(`Failed to remove librarian: ${err.message}`);
    }
  };

  const filtered = staffList.filter(s => {
    const matchesSearch =
      (s.name || '').toLowerCase().includes(search.toLowerCase()) ||
      (s.staffId || s.identifier || '').toLowerCase().includes(search.toLowerCase()) ||
      (s.email || '').toLowerCase().includes(search.toLowerCase());

    const matchesStatus = statusFilter === 'ALL' || s.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300 pb-12">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight">Staff & Librarian Accounts</h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium">
            Admin-only management of librarian credentials, access privileges, and account statuses.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={fetchStaff} variant="outline" className="text-xs font-bold rounded-xl h-9">
            <RefreshCw size={14} className="mr-1.5" /> Refresh
          </Button>
          <Button onClick={() => setAddModalOpen(true)} className="bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl h-9 shadow-md shadow-teal-600/20">
            <Plus size={16} className="mr-1.5" /> Add Librarian
          </Button>
        </div>
      </div>

      {/* Filter and Search Toolbar */}
      <Card className="border border-slate-200 bg-white rounded-2xl p-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              type="text"
              placeholder="Search by librarian name, Staff ID, or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-10 text-xs rounded-xl border-slate-300"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-500">Status:</span>
            {['ALL', 'ACTIVE', 'SUSPENDED', 'BLOCKED'].map(st => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 text-[11px] font-bold rounded-xl transition-all ${
                  statusFilter === st
                    ? 'bg-navy text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Staff Table */}
      <Card className="border border-slate-200 rounded-2xl shadow-xs overflow-hidden bg-white">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 text-center text-xs text-slate-400">Loading librarian accounts...</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-400">No librarian accounts found matching your query.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100/80 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                    <th className="p-3.5">Staff ID</th>
                    <th className="p-3.5">Full Name</th>
                    <th className="p-3.5">Official Email</th>
                    <th className="p-3.5">Phone</th>
                    <th className="p-3.5">Role</th>
                    <th className="p-3.5">Account Status</th>
                    <th className="p-3.5 text-right">Admin Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(s => (
                    <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3.5 font-mono font-bold text-teal-700">{s.staffId}</td>
                      <td className="p-3.5 font-bold text-navy">{s.name}</td>
                      <td className="p-3.5 text-slate-500">{s.email}</td>
                      <td className="p-3.5 text-slate-500">{s.phone}</td>
                      <td className="p-3.5">
                        <Badge className="bg-teal-100 text-teal-800 border-teal-300 font-bold text-[10px]">
                          {s.role || 'LIBRARIAN'}
                        </Badge>
                      </td>
                      <td className="p-3.5">
                        {s.status === 'ACTIVE' && (
                          <Badge className="bg-emerald-600 text-white text-[10px] font-bold">ACTIVE</Badge>
                        )}
                        {s.status === 'SUSPENDED' && (
                          <Badge className="bg-amber-500 text-white text-[10px] font-bold">SUSPENDED</Badge>
                        )}
                        {s.status === 'BLOCKED' && (
                          <Badge className="bg-rose-600 text-white text-[10px] font-bold">BLOCKED</Badge>
                        )}
                      </td>
                      <td className="p-3.5 text-right space-x-1.5 flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setViewStaff(s)}
                          className="h-8 w-8 p-0 text-slate-600 hover:text-navy"
                          title="View Details"
                        >
                          <Eye size={15} />
                        </Button>

                        {s.status !== 'ACTIVE' && (
                          <Button
                            size="sm"
                            onClick={() => handleUpdateStatus(s, 'ACTIVE')}
                            className="h-8 px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] rounded-lg"
                            title="Reactivate Account"
                          >
                            <Unlock size={13} className="mr-1" /> Reactivate
                          </Button>
                        )}

                        {s.status === 'ACTIVE' && (
                          <Button
                            size="sm"
                            onClick={() => handleUpdateStatus(s, 'SUSPENDED')}
                            className="h-8 px-2.5 bg-amber-500 hover:bg-amber-600 text-white font-bold text-[11px] rounded-lg"
                            title="Suspend Account"
                          >
                            Suspend
                          </Button>
                        )}

                        {s.status !== 'BLOCKED' && (
                          <Button
                            size="sm"
                            onClick={() => handleUpdateStatus(s, 'BLOCKED')}
                            className="h-8 px-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-[11px] rounded-lg"
                            title="Block Account"
                          >
                            <Lock size={13} className="mr-1" /> Block
                          </Button>
                        )}

                        <Button
                          size="sm"
                          onClick={() => handleRemoveStaff(s)}
                          className="h-8 px-2.5 bg-red-700 hover:bg-red-800 text-white font-bold text-[11px] rounded-lg shadow-xs flex items-center gap-1"
                          title="Remove Librarian from DB & Interface"
                        >
                          <Trash2 size={13} /> Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal: Add Librarian Form */}
      <Dialog open={addModalOpen} onOpenChange={setAddModalOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-navy flex items-center gap-2">
              <ShieldCheck size={20} className="text-teal-600" /> Add New Librarian Account
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 pt-1">
              Create official librarian credentials. Role is automatically set to <span className="font-bold text-teal-700">Librarian</span>.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAddStaff} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-navy">Full Name *</Label>
              <Input
                placeholder="e.g. Dr. Anitha M"
                value={newStaff.fullName}
                onChange={(e) => setNewStaff({ ...newStaff, fullName: e.target.value })}
                className="h-10 text-xs rounded-xl"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-navy">Official Email Address *</Label>
              <Input
                type="email"
                placeholder="e.g. anitha.m@university.edu"
                value={newStaff.email}
                onChange={(e) => setNewStaff({ ...newStaff, email: e.target.value })}
                className="h-10 text-xs rounded-xl"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-navy">Staff ID *</Label>
                <Input
                  placeholder="e.g. LIB005"
                  value={newStaff.staffId}
                  onChange={(e) => setNewStaff({ ...newStaff, staffId: e.target.value })}
                  className="h-10 text-xs font-mono rounded-xl uppercase"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-navy">Phone Number</Label>
                <Input
                  placeholder="+91 9876543210"
                  value={newStaff.phone}
                  onChange={(e) => setNewStaff({ ...newStaff, phone: e.target.value })}
                  className="h-10 text-xs rounded-xl"
                />
              </div>
            </div>

            {libraries.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-navy">Assigned Library</Label>
                <select
                  value={newStaff.libraryId}
                  onChange={(e) => setNewStaff({ ...newStaff, libraryId: e.target.value })}
                  className="w-full h-10 text-xs rounded-xl border border-slate-300 px-3 bg-white"
                >
                  <option value="">All Libraries / Central Library</option>
                  {libraries.map(lib => (
                    <option key={lib.id} value={lib.id}>{lib.name} ({lib.code})</option>
                  ))}
                </select>
              </div>
            )}

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-[11px] text-slate-500 space-y-1">
              <p className="font-bold text-slate-700">🔒 Security Enforcement Notice:</p>
              <p>An invitation link / temporary pass code will be sent to the email provided. Self-registration is disabled for staff roles.</p>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setAddModalOpen(false)} className="h-9 text-xs rounded-xl">
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="h-9 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl shadow-xs"
              >
                {submitting ? 'Creating Account...' : 'Create Librarian'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: View Details */}
      {viewStaff && (
        <Dialog open={!!viewStaff} onOpenChange={() => setViewStaff(null)}>
          <DialogContent className="sm:max-w-md rounded-2xl p-6">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-navy">Librarian Account Details</DialogTitle>
            </DialogHeader>

            <div className="space-y-3 pt-2 text-xs">
              <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
                <span className="font-bold text-slate-500">Staff ID</span>
                <span className="font-mono font-bold text-teal-700">{viewStaff.staffId}</span>
              </div>
              <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
                <span className="font-bold text-slate-500">Full Name</span>
                <span className="font-bold text-navy">{viewStaff.name}</span>
              </div>
              <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
                <span className="font-bold text-slate-500">Official Email</span>
                <span className="text-slate-700">{viewStaff.email}</span>
              </div>
              <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
                <span className="font-bold text-slate-500">Phone</span>
                <span className="text-slate-700">{viewStaff.phone}</span>
              </div>
              <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
                <span className="font-bold text-slate-500">Status</span>
                <Badge className={
                  viewStaff.status === 'ACTIVE' ? 'bg-emerald-600 text-white' :
                  viewStaff.status === 'SUSPENDED' ? 'bg-amber-500 text-white' : 'bg-rose-600 text-white'
                }>
                  {viewStaff.status}
                </Badge>
              </div>

              <div className="pt-3 flex justify-between gap-3 border-t border-slate-100">
                <Button
                  type="button"
                  onClick={() => handleRemoveStaff(viewStaff)}
                  className="h-9 px-3 bg-red-700 hover:bg-red-800 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-xs"
                >
                  <Trash2 size={14} /> Remove Account
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setViewStaff(null)}
                  className="h-9 text-xs rounded-xl font-bold"
                >
                  Close
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
