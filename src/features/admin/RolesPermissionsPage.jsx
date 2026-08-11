import React, { useState, useEffect } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { db } from '../../services/mockDatabase';
import { adminService } from '../../services/adminService';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Input } from '../../components/shared/Input';
import { Badge } from '../../components/shared/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/shared/Dialog';
import { KeyRound, Plus, ShieldCheck, CheckCircle2, Lock, Copy } from 'lucide-react';
import toast from 'react-hot-toast';

const AVAILABLE_PERMISSIONS = [
  { key: 'students.view', label: 'View Student Records' },
  { key: 'students.suspend', label: 'Suspend / Restrict Student' },
  { key: 'staff.manage', label: 'Manage Staff Roster' },
  { key: 'bookings.view', label: 'View All Reservations' },
  { key: 'bookings.override', label: 'Emergency Reservation Override' },
  { key: 'slots.manage', label: 'Configure Slots & Templates' },
  { key: 'rooms.manage', label: 'Manage Rooms & Suspensions' },
  { key: 'maintenance.assign', label: 'Assign Maintenance Work' },
  { key: 'incidents.review', label: 'Review Incident Reports' },
  { key: 'reports.export', label: 'Export Analytics Reports' },
  { key: 'security.view', label: 'View Security Centre' },
  { key: 'roles.manage', label: 'Manage Roles & Permissions' }
];

export default function RolesPermissionsPage() {
  const { user: adminUser } = useAuth();
  const [roles, setRoles] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form State
  const [roleTitle, setRoleTitle] = useState('');
  const [selectedPermissions, setSelectedPermissions] = useState(['bookings.view']);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadRoles();
  }, []);

  const loadRoles = async () => {
    try {
      const data = (await db.read('seatsync_roles')) || [];
      setRoles(data);
    } catch (err) {
      console.warn('Failed to load roles:', err);
    }
  };

  const togglePermission = (key) => {
    setSelectedPermissions(prev =>
      prev.includes(key) ? prev.filter(p => p !== key) : [...prev, key]
    );
  };

  const handleCreateRole = async (e) => {
    e.preventDefault();
    if (!roleTitle.trim()) {
      toast.error('Please enter a role title.');
      return;
    }

    setLoading(true);
    try {
      await adminService.createRole({ title: roleTitle, permissions: selectedPermissions }, adminUser);
      toast.success(`Role ${roleTitle} created with ${selectedPermissions.length} permissions!`);
      setIsModalOpen(false);
      setRoleTitle('');
      await loadRoles();
    } catch (err) {
      toast.error('Failed to create role.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
            <KeyRound className="text-indigo-600" size={28} /> Roles & Permissions Control (RBAC)
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Configure custom staff roles, action-level permission matrices, and administrative clearance limits.
          </p>
        </div>

        <Button
          onClick={() => setIsModalOpen(true)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs h-10 px-5 rounded-xl shadow-xs flex items-center gap-2"
        >
          <Plus size={16} /> Create Custom Role
        </Button>
      </div>

      {/* ROLES GRID */}
      <div className="grid md:grid-cols-2 gap-6">
        {(roles || []).map(role => (
          <Card key={role.id} className="border border-slate-200/80 bg-white rounded-2xl p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-extrabold text-navy">{role.title}</h3>
                <p className="text-xs font-mono text-slate-500">ID: {role.id}</p>
              </div>
              <Badge className={`text-xs font-bold ${role.isSystem ? 'bg-purple-600 text-white' : 'bg-teal-600 text-white'}`}>
                {role.isSystem ? 'System Core Role' : 'Custom Staff Role'}
              </Badge>
            </div>

            <div className="space-y-1.5 pt-2 border-t border-slate-100">
              <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">Assigned Permissions ({role.permissions?.includes('*') ? 'ALL (*)' : role.permissions?.length})</span>
              <div className="flex flex-wrap gap-1.5">
                {role.permissions?.includes('*') ? (
                  <Badge className="bg-purple-600 text-white font-bold text-[10px]">Full Super Admin Access (*)</Badge>
                ) : (
                  (role.permissions || []).map(p => (
                    <Badge key={p} className="bg-slate-100 text-navy border-slate-200 text-[10px]">
                      {p}
                    </Badge>
                  ))
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* CREATE ROLE MODAL */}
      {isModalOpen && (
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogContent className="max-w-lg bg-white border border-slate-200 text-navy p-6 rounded-2xl space-y-4 shadow-2xl">
            <DialogHeader className="space-y-1">
              <DialogTitle className="text-lg font-black text-navy flex items-center gap-2">
                <KeyRound className="text-indigo-600" size={20} /> Create Custom Staff Role
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500 font-medium">
                Define a new staff role and assign fine-grained module access keys.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleCreateRole} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">Role Title</label>
                <Input
                  type="text"
                  placeholder="e.g., Senior Desk Supervisor"
                  value={roleTitle}
                  onChange={(e) => setRoleTitle(e.target.value)}
                  className="h-10 bg-slate-50 border-slate-300 text-navy text-xs rounded-xl"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 block">Module Permission Keys</label>
                <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  {AVAILABLE_PERMISSIONS.map(p => (
                    <div
                      key={p.key}
                      onClick={() => togglePermission(p.key)}
                      className={`p-2 rounded-xl border text-[11px] font-semibold cursor-pointer transition-all flex items-center gap-2 ${
                        selectedPermissions.includes(p.key)
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-900'
                          : 'border-slate-200 bg-white text-slate-600'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedPermissions.includes(p.key)}
                        onChange={() => {}}
                        className="accent-indigo-600 rounded"
                      />
                      <span className="truncate">{p.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs mt-2"
              >
                {loading ? 'Creating Role...' : 'Save Role & Access Keys →'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
