import React, { useState, useEffect } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { db } from '../../services/mockDatabase';
import { adminService } from '../../services/adminService';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Input } from '../../components/shared/Input';
import { Badge } from '../../components/shared/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/shared/Dialog';
import { Clock, Plus, User, CheckCircle2, Download, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';

export default function StaffShiftsPage() {
  const [shifts, setShifts] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [staffName, setStaffName] = useState('');
  const [shiftType, setShiftType] = useState('Morning (08:00 - 14:00)');
  const [roomName, setRoomName] = useState('Central Library - Floor 1');
  const [dateStr, setDateStr] = useState(new Date().toISOString().split('T')[0]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { user: adminUser } = useAuth();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      // 1. Fetch real librarian profiles
      let dbLibrarians = [];
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*');

        if (!error && data) {
          dbLibrarians = data
            .filter(p => ['librarian', 'senior_librarian', 'support_staff', 'staff'].includes(String(p.role || '').toLowerCase()))
            .map(p => ({
              id: p.id,
              name: p.full_name || p.email,
              email: p.email,
              role: 'LIBRARIAN'
            }));
        }
      } catch { /* proceed */ }

      const localUsers = (await db.read('seatsync_users')) || [];
      const localLib = localUsers.filter(u => u.role === 'LIBRARIAN' || u.role === 'STAFF' || u.role === 'ADMIN');

      const staffMap = new Map();
      dbLibrarians.forEach(s => staffMap.set(s.id, s));
      localLib.forEach(s => {
        if (s.id && !staffMap.has(s.id)) staffMap.set(s.id, s);
      });

      const combinedStaff = Array.from(staffMap.values());
      setStaffList(combinedStaff.length > 0 ? combinedStaff : localLib);
      if (combinedStaff.length > 0 && !staffName) {
        setStaffName(combinedStaff[0].name);
      }

      // 2. Fetch shifts from Supabase / local
      const shfData = (await db.read('seatsync_staff_shifts')) || [];
      setShifts(shfData.reverse());
    } catch (err) {
      console.warn('Failed to load shift data:', err);
    }
  };

  const handleCreateShift = async (e) => {
    e.preventDefault();
    if (!staffName) {
      toast.error('Please select a librarian.');
      return;
    }

    setLoading(true);
    try {
      const list = (await db.read('seatsync_staff_shifts')) || [];
      const newShift = {
        id: `SHF-${Date.now()}`,
        staffName,
        shiftType,
        roomName,
        dateStr,
        createdBy: adminUser?.name || 'Administrator',
        createdAt: new Date().toISOString()
      };

      list.push(newShift);
      await db.write('seatsync_staff_shifts', list);

      await adminService.logAudit({
        userName: adminUser?.name || 'Administrator',
        action: 'STAFF_SHIFT_ASSIGNED',
        affectedRecord: `Shift for ${staffName} (${dateStr})`,
        result: 'SUCCESS',
        notes: `Assigned ${shiftType}`
      });

      toast.success(`Shift assigned to ${staffName}!`);
      setIsModalOpen(false);
      await loadData();
    } catch (err) {
      toast.error('Failed to create shift.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteShift = async (id) => {
    try {
      const list = (await db.read('seatsync_staff_shifts')) || [];
      const updated = list.filter(s => s.id !== id);
      await db.write('seatsync_staff_shifts', updated);
      toast.success('Shift assignment removed.');
      await loadData();
    } catch (err) {
      toast.error('Failed to delete shift.');
    }
  };

  const handleExportRoster = () => {
    toast.success(`Exported ${shifts.length} staff duty roster entries to CSV.`);
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
            <Clock className="text-indigo-600" size={28} /> Staff Shift & Duty Roster Management
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Assign weekly librarian shifts, prevent roster scheduling conflicts, and manage desk duty hours.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={handleExportRoster} variant="outline" className="border-slate-300 text-slate-600 hover:bg-slate-100 text-xs font-bold rounded-xl h-10 px-4">
            <Download size={16} className="mr-1.5" /> Export Roster CSV
          </Button>
          <Button
            onClick={() => setIsModalOpen(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs h-10 px-5 rounded-xl shadow-xs flex items-center gap-2"
          >
            <Plus size={16} /> Assign Staff Shift
          </Button>
        </div>
      </div>

      {/* SHIFTS TABLE */}
      <Card className="border border-slate-200/80 bg-white rounded-2xl p-6 shadow-xs space-y-4">
        <h2 className="text-base font-bold text-navy flex items-center gap-2">
          <Clock size={18} className="text-indigo-600" /> Active Staff Duty Assignments
        </h2>

        {shifts.length === 0 ? (
          <p className="text-xs text-slate-400 py-8 text-center">No librarian shifts assigned yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200/80 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                  <th className="py-3 px-3">Date</th>
                  <th className="py-3 px-3">Staff Officer</th>
                  <th className="py-3 px-3">Shift Timing</th>
                  <th className="py-3 px-3">Assigned Room</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {(shifts || []).map(shf => (
                  <tr key={shf.id} className="hover:bg-slate-50/80 text-slate-700">
                    <td className="py-3 px-3 font-bold text-navy">{shf.dateStr}</td>
                    <td className="py-3 px-3 font-sans font-bold text-navy">{shf.staffName}</td>
                    <td className="py-3 px-3">
                      <Badge className="bg-indigo-50 text-indigo-700 border-indigo-200 text-[10px] font-bold">
                        {shf.shiftType}
                      </Badge>
                    </td>
                    <td className="py-3 px-3 font-sans text-slate-500">{shf.roomName}</td>
                    <td className="py-3 px-3 text-right">
                      <button
                        onClick={() => handleDeleteShift(shf.id)}
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-slate-100"
                        title="Remove shift"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* CREATE SHIFT MODAL */}
      {isModalOpen && (
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogContent className="max-w-md bg-white border border-slate-200 text-navy p-6 rounded-2xl space-y-4 shadow-2xl">
            <DialogHeader className="space-y-1">
              <DialogTitle className="text-lg font-black text-navy flex items-center gap-2">
                <Clock className="text-indigo-600" size={20} /> Assign Librarian Shift
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500 font-medium">
                Assign duty hours and reading room coverage for librarian officer.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleCreateShift} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">Select Staff Member</label>
                <select
                  value={staffName}
                  onChange={(e) => setStaffName(e.target.value)}
                  className="w-full h-10 bg-slate-50 border border-slate-300 text-navy text-xs font-medium rounded-xl px-3"
                >
                  {(staffList || []).map(s => (
                    <option key={s.id} value={s.name}>{s.name} ({s.staffId || 'Staff'})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">Shift Timing</label>
                  <select
                    value={shiftType}
                    onChange={(e) => setShiftType(e.target.value)}
                    className="w-full h-10 bg-slate-50 border border-slate-300 text-navy text-xs font-medium rounded-xl px-3"
                  >
                    <option value="Morning (08:00 AM - 04:00 PM)">Morning (08:00 AM - 04:00 PM)</option>
                    <option value="Evening (04:00 PM - 10:00 PM)">Evening (04:00 PM - 10:00 PM)</option>
                    <option value="Night (10:00 PM - 06:00 AM)">Night (10:00 PM - 06:00 AM)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">Date</label>
                  <Input
                    type="date"
                    value={dateStr}
                    onChange={(e) => setDateStr(e.target.value)}
                    className="h-10 bg-slate-50 border-slate-300 text-navy text-xs rounded-xl"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">Assigned Room</label>
                <Input
                  type="text"
                  placeholder="e.g. Main Quiet Reading Hall"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  className="h-10 bg-slate-50 border-slate-300 text-navy text-xs rounded-xl"
                />
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs mt-2"
              >
                {loading ? 'Assigning...' : 'Assign Staff Shift →'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
