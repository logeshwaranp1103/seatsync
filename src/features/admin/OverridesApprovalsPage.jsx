import React, { useState, useEffect } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { db } from '../../services/mockDatabase';
import { adminService } from '../../services/adminService';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Input } from '../../components/shared/Input';
import { Badge } from '../../components/shared/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/shared/Dialog';
import { CheckCheck, Plus, AlertTriangle, ShieldCheck, UserCheck, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function OverridesApprovalsPage() {
  const { user: adminUser } = useAuth();
  const [approvals, setApprovals] = useState([]);
  const [students, setStudents] = useState([]);
  const [isOverrideModalOpen, setIsOverrideModalOpen] = useState(false);

  // Form State
  const [studentId, setStudentId] = useState('');
  const [seatNumber, setSeatNumber] = useState('A-101');
  const [slotTime, setSlotTime] = useState('08:00 AM - 09:00 AM');
  const [reason, setReason] = useState('Emergency Academic VIP Access Override');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const appData = (await db.read('seatsync_approval_requests')) || [];
      const usersData = (await db.read('seatsync_users')) || [];
      setApprovals(appData.reverse());
      const stList = usersData.filter(u => u.role === 'STUDENT');
      setStudents(stList);
      if (stList.length > 0 && !studentId) {
        setStudentId(stList[0].id);
      }
    } catch (err) {
      console.warn('Failed to load approval data:', err);
    }
  };

  const handleCreateOverride = async (e) => {
    e.preventDefault();
    if (!reason.trim()) {
      toast.error('Please state a reason for override.');
      return;
    }

    setLoading(true);
    try {
      const student = students.find(s => s.id === studentId);
      const bookings = (await db.read('seatsync_bookings')) || [];
      const newBk = {
        id: `BK-OVR-${Date.now()}`,
        studentId,
        studentName: student?.name || 'Student',
        studentCollegeId: student?.collegeId || '24AD042',
        seatNumber,
        slotTime,
        bookingDate: new Date().toISOString().split('T')[0],
        status: 'active',
        booking_source: 'admin_override',
        cancellationReason: null
      };

      bookings.push(newBk);
      await db.write('seatsync_bookings', bookings);

      await adminService.logAudit({
        userName: adminUser?.name || 'Administrator',
        action: 'RESERVATION_OVERRIDE_CREATED',
        affectedRecord: `Seat ${seatNumber} for ${student?.name}`,
        result: 'SUCCESS',
        notes: reason
      });

      toast.success(`Override booking ${newBk.id} created for ${student?.name}!`);
      setIsOverrideModalOpen(false);
      await loadData();
    } catch (err) {
      toast.error('Failed to create override booking.');
    } finally {
      setLoading(false);
    }
  };

  const handleApproveRequest = async (requestId) => {
    try {
      await adminService.approveRequest(requestId, adminUser);
      toast.success('Action request approved & executed!');
      await loadData();
    } catch (err) {
      toast.error(err.message || 'Approval failed.');
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
            <CheckCheck className="text-indigo-600" size={28} /> Reservation Overrides & 4-Eye Approvals
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Create emergency booking overrides and enforce four-eye approval workflows for high-risk operations.
          </p>
        </div>

        <Button
          onClick={() => setIsOverrideModalOpen(true)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs h-10 px-5 rounded-xl shadow-xs flex items-center gap-2"
        >
          <Plus size={16} /> Create Emergency Override
        </Button>
      </div>

      {/* APPROVAL QUEUE */}
      <Card className="border border-slate-200/80 bg-white rounded-2xl p-6 shadow-xs space-y-4">
        <h2 className="text-base font-bold text-navy flex items-center gap-2">
          <ShieldCheck size={18} className="text-indigo-600" /> Pending High-Impact Admin Approval Items
        </h2>

        {approvals.length === 0 ? (
          <p className="text-xs text-slate-400 py-8 text-center">No pending approval requests in queue.</p>
        ) : (
          <div className="space-y-3">
            {(approvals || []).map(req => (
              <div key={req.id} className="p-4 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between gap-4">
                <div className="space-y-1 text-xs">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-indigo-50 text-indigo-700 border-indigo-200 font-mono text-[10px]">
                      {req.id}
                    </Badge>
                    <span className="font-bold text-navy">{req.actionType}</span>
                  </div>
                  <p className="text-slate-600 font-sans">{req.description}</p>
                  <p className="text-[10px] text-slate-400 font-mono">Requester: {req.requesterName} • Created: {new Date(req.createdAt).toLocaleString()}</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {req.status === 'Pending Approval' ? (
                    <Button
                      onClick={() => handleApproveRequest(req.id)}
                      className="h-8 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs"
                    >
                      Approve & Execute →
                    </Button>
                  ) : (
                    <Badge className="bg-emerald-600 text-white text-xs font-bold">
                      {req.status} (By {req.approverName})
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* CREATE OVERRIDE MODAL */}
      {isOverrideModalOpen && (
        <Dialog open={isOverrideModalOpen} onOpenChange={setIsOverrideModalOpen}>
          <DialogContent className="max-w-md bg-white border border-slate-200 text-navy p-6 rounded-2xl space-y-4 shadow-2xl">
            <DialogHeader className="space-y-1">
              <DialogTitle className="text-lg font-black text-navy flex items-center gap-2">
                <CheckCheck className="text-indigo-600" size={20} /> Emergency Reservation Override
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500 font-medium">
                Force create a seat booking for a student bypassing standard limits.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleCreateOverride} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">Select Student</label>
                <select
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  className="w-full h-10 bg-slate-50 border border-slate-300 text-navy text-xs font-medium rounded-xl px-3"
                >
                  {(students || []).map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.collegeId || 'Student'})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">Seat Number</label>
                  <Input
                    type="text"
                    value={seatNumber}
                    onChange={(e) => setSeatNumber(e.target.value)}
                    className="h-10 bg-slate-50 border-slate-300 text-navy text-xs rounded-xl font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">Slot Time</label>
                  <select
                    value={slotTime}
                    onChange={(e) => setSlotTime(e.target.value)}
                    className="w-full h-10 bg-slate-50 border border-slate-300 text-navy text-xs font-medium rounded-xl px-3"
                  >
                    <option value="08:00 AM - 09:00 AM">Morning Slot 1 (08:00 - 09:00)</option>
                    <option value="09:00 AM - 10:00 AM">Morning Slot 2 (09:00 - 10:00)</option>
                    <option value="02:00 PM - 03:00 PM">Afternoon Slot 1 (14:00 - 15:00)</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">Override Reason (Mandatory Audit)</label>
                <Input
                  type="text"
                  placeholder="e.g. VIP Academic Special Permit"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="h-10 bg-slate-50 border-slate-300 text-navy text-xs rounded-xl"
                />
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs mt-2"
              >
                {loading ? 'Executing...' : 'Execute Override & Issue Pass →'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
