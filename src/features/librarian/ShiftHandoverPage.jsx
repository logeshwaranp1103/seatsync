import React, { useState, useEffect } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { db } from '../../services/mockDatabase';
import { librarianService } from '../../services/librarianService';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Input } from '../../components/shared/Input';
import { Badge } from '../../components/shared/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/shared/Dialog';
import {
  ArrowRightLeft, User, CheckCircle2, Clock, FileText, Plus,
  ShieldCheck, AlertTriangle, MessageSquare
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function ShiftHandoverPage() {
  const { user: staffUser } = useAuth();
  const [handovers, setHandovers] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form
  const [incomingStaff, setIncomingStaff] = useState('');
  const [notes, setNotes] = useState('');
  const [pendingIssues, setPendingIssues] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [hndData, usersData, mntData, incData] = await Promise.all([
        db.read('seatsync_handovers') || [],
        db.read('seatsync_users') || [],
        db.read('seatsync_maintenance') || [],
        db.read('seatsync_incidents') || []
      ]);
      setHandovers(hndData.reverse());
      const librarians = usersData.filter(u => u.role === 'LIBRARIAN' || u.role === 'ADMIN');
      setStaffList(librarians);
      if (librarians.length > 0 && !incomingStaff) {
        setIncomingStaff(librarians[0].name);
      }
    } catch (err) {
      console.warn('Failed to load handover data:', err);
    }
  };

  const handleCreateHandover = async (e) => {
    e.preventDefault();
    if (!notes.trim()) {
      toast.error('Please enter handover notes.');
      return;
    }

    setLoading(true);
    try {
      const [mntData, incData] = await Promise.all([
        db.read('seatsync_maintenance') || [],
        db.read('seatsync_incidents') || []
      ]);
      const maintenanceCount = mntData.filter(m => m.status !== 'Resolved').length;
      const unresolvedIncidents = incData.filter(i => i.status !== 'Resolved').length;

      await librarianService.createShiftHandover({
        outgoingStaff: staffUser?.name || 'Outgoing Staff',
        incomingStaff,
        notes,
        pendingIssues: pendingIssues || 'None',
        maintenanceCount,
        unresolvedIncidents
      });

      toast.success('Shift handover logged successfully!');
      setIsModalOpen(false);
      setNotes('');
      setPendingIssues('');
      await loadData();
    } catch (err) {
      toast.error('Failed to log shift handover.');
    } finally {
      setLoading(false);
    }
  };

  const handleAcknowledge = async (handoverId) => {
    try {
      await librarianService.acknowledgeShiftHandover(handoverId, staffUser?.name || 'Incoming Staff');
      toast.success('Shift handover acknowledged!');
      await loadData();
    } catch (err) {
      toast.error('Failed to acknowledge shift handover.');
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
            <ArrowRightLeft className="text-teal-600" size={28} /> Shift Handover Desk
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Seamlessly record and acknowledge shift handovers, operational notes, and pending desk issues.
          </p>
        </div>

        <Button
          onClick={() => setIsModalOpen(true)}
          className="bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs h-10 px-5 rounded-xl shadow-xs flex items-center gap-2"
        >
          <Plus size={16} /> Create Shift Handover
        </Button>
      </div>

      {/* HANDOVER HISTORY LIST */}
      <Card className="border border-slate-200/80 bg-white rounded-2xl p-6 shadow-xs space-y-4">
        <h2 className="text-base font-bold text-navy flex items-center gap-2">
          <Clock size={18} className="text-teal-600" /> Shift Handover Log History
        </h2>

        {handovers.length === 0 ? (
          <p className="text-xs text-slate-400 py-8 text-center">No shift handovers logged yet.</p>
        ) : (
          <div className="space-y-4">
            {handovers.map(h => (
              <div key={h.id} className="p-5 bg-slate-50 border border-slate-200/80 rounded-xl space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
                  <div className="flex items-center gap-3">
                    <Badge className="bg-teal-50 text-teal-700 border-teal-200 font-mono text-xs font-bold">
                      {h.id}
                    </Badge>
                    <span className="text-xs text-slate-500 font-mono">
                      {new Date(h.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <Badge className={`text-xs font-bold ${
                    h.status === 'Acknowledged' ? 'bg-emerald-600 text-white' : 'bg-amber-600 text-white'
                  }`}>
                    {h.status}
                  </Badge>
                </div>

                <div className="grid sm:grid-cols-2 gap-4 text-xs font-sans">
                  <div>
                    <span className="text-slate-400 text-[10px] font-bold uppercase block">Outgoing Librarian</span>
                    <span className="font-extrabold text-navy">{h.outgoingStaff}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] font-bold uppercase block">Incoming Librarian</span>
                    <span className="font-extrabold text-teal-600">{h.incomingStaff}</span>
                  </div>
                </div>

                <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-1 text-xs">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Handover Notes & Pending Issues</span>
                  <p className="text-slate-700">{h.notes}</p>
                  {h.pendingIssues && h.pendingIssues !== 'None' && (
                    <p className="text-amber-600 font-medium pt-1">Pending Issues: {h.pendingIssues}</p>
                  )}
                </div>

                {h.status !== 'Acknowledged' && (
                  <Button
                    onClick={() => handleAcknowledge(h.id)}
                    className="w-full h-9 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 size={16} /> Acknowledge & Accept Shift →
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* CREATE HANDOVER MODAL */}
      {isModalOpen && (
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogContent className="max-w-md bg-white border border-slate-200 text-navy p-6 rounded-2xl space-y-4 shadow-2xl">
            <DialogHeader className="space-y-1">
              <DialogTitle className="text-lg font-black text-navy flex items-center gap-2">
                <ArrowRightLeft className="text-teal-600" size={20} /> Create Shift Handover
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500 font-medium">
                Log handoff information for the incoming librarian.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleCreateHandover} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">Incoming Librarian Staff</label>
                <select
                  value={incomingStaff}
                  onChange={(e) => setIncomingStaff(e.target.value)}
                  className="w-full h-10 bg-slate-50 border border-slate-300 text-navy text-xs font-medium rounded-xl px-3 focus:border-teal-600"
                >
                  {staffList.map(s => (
                    <option key={s.id} value={s.name}>{s.name} ({s.staffId || 'Staff'})</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">Handover Notes</label>
                <Input
                  type="text"
                  placeholder="Key observations during shift..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="h-10 bg-slate-50 border-slate-300 text-navy text-xs rounded-xl"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">Pending Issues / Special Instructions</label>
                <Input
                  type="text"
                  placeholder="e.g., Seat A-102 damaged, VIP visit at 3 PM..."
                  value={pendingIssues}
                  onChange={(e) => setPendingIssues(e.target.value)}
                  className="h-10 bg-slate-50 border-slate-300 text-navy text-xs rounded-xl"
                />
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-11 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl shadow-xs mt-2"
              >
                {loading ? 'Logging Handover...' : 'Log Shift Handover →'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
