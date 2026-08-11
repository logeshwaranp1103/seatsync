import React, { useState, useEffect } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { db } from '../../services/mockDatabase';
import { adminService } from '../../services/adminService';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Input } from '../../components/shared/Input';
import { Badge } from '../../components/shared/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/shared/Dialog';
import { ShieldAlert, Plus, AlertTriangle, CheckCircle2, User, Clock, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { authService } from '../../services/authService';

export default function PenaltiesRestrictionsPage() {
  const [students, setStudents] = useState([]);
  const [penalties, setPenalties] = useState([]);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [restrictionType, setRestrictionType] = useState('TEMP_SUSPENSION');
  const [durationDays, setDurationDays] = useState('7');
  const [reason, setReason] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { user: adminUser } = useAuth();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      let dbStudents = [];
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('role', 'student');

        if (!error && data) {
          dbStudents = data.map(s => ({
            id: s.id,
            name: s.full_name || 'Student',
            email: s.email,
            collegeId: s.registration_number || s.college_id || 'N/A',
            accountStatus: s.status || 'ACTIVE',
            noShowCount: s.no_show_count || 0
          }));
        }
      } catch { /* proceed */ }

      const localUsers = (await db.read('seatsync_users')) || [];
      const localSt = localUsers.filter(u => u.role === 'STUDENT');

      const stMap = new Map();
      dbStudents.forEach(s => stMap.set(s.id, s));
      localSt.forEach(s => {
        if (s.id && !stMap.has(s.id)) stMap.set(s.id, s);
      });

      const combinedStudents = Array.from(stMap.values());
      setStudents(combinedStudents);

      if (combinedStudents.length > 0 && !selectedStudentId) {
        setSelectedStudentId(combinedStudents[0].id);
      }

      // Fetch restrictions log from Supabase user_restrictions / audit_logs
      let dbRestrictions = [];
      try {
        const { data: resData } = await supabase
          .from('user_restrictions')
          .select('*')
          .order('created_at', { ascending: false });

        if (resData && resData.length > 0) {
          // Resolve user names from profiles
          const userIds = [...new Set(resData.filter(r => r.user_id).map(r => r.user_id))];
          const nameMap = new Map();
          if (userIds.length > 0) {
            try {
              const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', userIds);
              if (profiles) profiles.forEach(p => nameMap.set(p.id, p.full_name));
            } catch { /* proceed */ }
          }

          dbRestrictions = resData.map(r => ({
            id: r.id,
            studentId: r.user_id,
            studentName: nameMap.get(r.user_id) || 'Student',
            restrictionType: r.restriction_type || 'TEMP_SUSPENSION',
            reason: r.reason,
            createdAt: r.created_at
          }));
        }
      } catch { /* proceed */ }

      const localPen = (await db.read('seatsync_penalties')) || [];
      const penMap = new Map();
      dbRestrictions.forEach(p => penMap.set(p.id, p));
      localPen.forEach(p => {
        if (p.id && !penMap.has(p.id)) penMap.set(p.id, p);
      });

      const combinedPen = Array.from(penMap.values());
      combinedPen.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      setPenalties(combinedPen);
    } catch (err) {
      console.warn('Failed to load penalties data:', err);
    }
  };

  const handleApplyRestriction = async (e) => {
    e.preventDefault();
    if (!selectedStudentId) {
      toast.error('Please select a student.');
      return;
    }
    if (!reason.trim()) {
      toast.error('Please provide a reason.');
      return;
    }

    setLoading(true);
    try {
      await adminService.applyStudentRestriction(
        selectedStudentId,
        restrictionType,
        Number(durationDays) || 7,
        reason,
        adminUser
      );

      toast.success('Restriction applied & notification sent!');
      setIsModalOpen(false);
      await loadData();
    } catch (err) {
      toast.error(err.message || 'Failed to apply restriction.');
    } finally {
      setLoading(false);
    }
  };

  const handleReconstructStanding = async (studentId) => {
    try {
      try {
        await supabase
          .from('profiles')
          .update({ status: 'active', no_show_count: 0 })
          .eq('id', studentId);
      } catch { /* proceed */ }

      const users = (await db.read('seatsync_users')) || [];
      const target = users.find(u => u.id === studentId);
      if (target) {
        target.accountStatus = 'active';
        target.noShowCount = 0;
        await db.write('seatsync_users', users);
      }
      toast.success('Standing reinstated successfully.');
      await loadData();
    } catch (err) {
      toast.error('Failed to reinstate student.');
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
            <ShieldAlert className="text-indigo-600" size={28} /> Penalties & Restrictions Management
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Impose temporary booking suspensions, review appeals, and enforce platform attendance standards.
          </p>
        </div>

        <Button
          onClick={() => setIsModalOpen(true)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs h-10 px-5 rounded-xl shadow-xs flex items-center gap-2"
        >
          <Plus size={16} /> Apply Student Restriction
        </Button>
      </div>

      {/* RESTRICTED STUDENTS TABLE */}
      <Card className="border border-slate-200/80 bg-white rounded-2xl p-6 shadow-xs space-y-4">
        <h2 className="text-base font-bold text-navy flex items-center gap-2">
          <AlertTriangle size={18} className="text-amber-500" /> Student Account Standings Log
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200/80 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                <th className="py-3 px-3">Student Name</th>
                <th className="py-3 px-3">College ID</th>
                <th className="py-3 px-3">No-Shows</th>
                <th className="py-3 px-3">Standing Status</th>
                <th className="py-3 px-3">Restriction Reason</th>
                <th className="py-3 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {(students || []).map(s => (
                <tr key={s.id} className="hover:bg-slate-50/80 text-slate-700">
                  <td className="py-3 px-3 font-sans font-bold text-navy">{s.name}</td>
                  <td className="py-3 px-3 font-mono text-slate-500">{s.collegeId || s.identifier}</td>
                  <td className="py-3 px-3 font-bold text-amber-600">{s.noShowCount || 0} / 3</td>
                  <td className="py-3 px-3">
                    <Badge className={`text-[10px] font-bold ${
                      s.accountStatus === 'restricted' ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'
                    }`}>
                      {s.accountStatus === 'restricted' ? 'Restricted' : 'Active'}
                    </Badge>
                  </td>
                  <td className="py-3 px-3 font-sans text-slate-500 max-w-xs truncate">{s.restrictionReason || '-'}</td>
                  <td className="py-3 px-3 text-right">
                    {s.accountStatus === 'restricted' && (
                      <Button
                        onClick={() => handleReconstructStanding(s.id)}
                        className="h-7 px-2.5 text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg"
                      >
                        Reinstate Standing
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* APPLY RESTRICTION MODAL */}
      {isModalOpen && (
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogContent className="max-w-md bg-white border border-slate-200 text-navy p-6 rounded-2xl space-y-4 shadow-2xl">
            <DialogHeader className="space-y-1">
              <DialogTitle className="text-lg font-black text-navy flex items-center gap-2">
                <ShieldAlert className="text-indigo-600" size={20} /> Apply Student Restriction
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500 font-medium">
                Impose a booking restriction that prevents student from making new seat reservations.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleApplyRestriction} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">Select Student</label>
                <select
                  value={selectedStudentId}
                  onChange={(e) => setSelectedStudentId(e.target.value)}
                  className="w-full h-10 bg-slate-50 border border-slate-300 text-navy text-xs font-medium rounded-xl px-3 focus:border-indigo-500"
                >
                  {(students || []).map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.collegeId || 'Student'})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">Restriction Type</label>
                  <select
                    value={restrictionType}
                    onChange={(e) => setRestrictionType(e.target.value)}
                    className="w-full h-10 bg-slate-50 border border-slate-300 text-navy text-xs font-medium rounded-xl px-3"
                  >
                    <option value="7-Day Temporary Suspension">7-Day Temporary Suspension</option>
                    <option value="14-Day Suspension">14-Day Suspension</option>
                    <option value="Permanent Booking Block">Permanent Booking Block</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">Duration (Days)</label>
                  <Input
                    type="number"
                    value={durationDays}
                    onChange={(e) => setDurationDays(e.target.value)}
                    className="h-10 bg-slate-50 border-slate-300 text-navy text-xs rounded-xl"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">Restriction Reason</label>
                <Input
                  type="text"
                  placeholder="e.g. 3 consecutive no-show offenses..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="h-10 bg-slate-50 border-slate-300 text-navy text-xs rounded-xl"
                />
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-11 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl shadow-xs mt-2"
              >
                {loading ? 'Applying...' : 'Enforce Restriction & Send Alert →'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
