import React, { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { librarianService } from '../../services/librarianService';
import { Card, CardContent } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/shared/Dialog';
import { Label } from '../../components/shared/Label';
import { Input } from '../../components/shared/Input';
import { 
  ShieldAlert, AlertTriangle, ShieldCheck, Clock, Bell, RotateCcw,
  RefreshCw, CheckCircle2, UserX, AlertCircle, Info, Search
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function NoShowsMonitorPage() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Reset Standing Modal state
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [targetStudent, setTargetStudent] = useState(null);
  const [resetReason, setResetReason] = useState('');
  const [isResetting, setIsResetting] = useState(false);

  // Warning pending state map
  const [warningPendingMap, setWarningPendingMap] = useState({});

  const isMountedRef = useRef(true);

  // Fetch real student no-show standings from database
  const fetchStandings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await librarianService.getStudentNoShowStandings();
      if (isMountedRef.current) {
        setStudents(data || []);
      }
    } catch (err) {
      console.error('[NoShowsMonitorPage] Failed to fetch student standings:', err);
      if (isMountedRef.current) {
        setError(err.message || 'Unable to load no-show standings from database.');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // Realtime subscription setup
  useEffect(() => {
    isMountedRef.current = true;
    fetchStandings();

    // Subscribe to changes on no_show_records, user_restrictions, bookings, booking_policies
    const channel = supabase
      .channel('no_show_monitor_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'no_show_records' },
        () => fetchStandings()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_restrictions' },
        () => fetchStandings()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings' },
        () => fetchStandings()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'booking_policies' },
        () => fetchStandings()
      )
      .subscribe();

    return () => {
      isMountedRef.current = false;
      supabase.removeChannel(channel);
    };
  }, [fetchStandings]);

  // Open Reset Standing Modal
  const openResetModal = (student) => {
    setTargetStudent(student);
    setResetReason('');
    setResetModalOpen(true);
  };

  // Execute Reset Standing
  const handleResetSubmit = async (e) => {
    e.preventDefault();
    if (!targetStudent) return;
    const cleanReason = resetReason.trim();
    if (!cleanReason) {
      toast.error('Resolution reason is required to reset student standing.');
      return;
    }

    try {
      setIsResetting(true);
      await librarianService.resetStudentNoShowStanding(targetStudent.student_id || targetStudent.id, cleanReason);
      toast.success(`Reset no-shows for ${targetStudent.student_name || targetStudent.name}. Account standing restored.`);
      setResetModalOpen(false);
      setTargetStudent(null);
      setResetReason('');
      await fetchStandings();
    } catch (err) {
      console.error('[NoShowsMonitorPage] Reset standing failed:', err);
      toast.error(err.message || 'Failed to reset student status.');
    } finally {
      setIsResetting(false);
    }
  };

  // Issue Warning Notification
  const handleSendWarning = async (student) => {
    const sId = student.student_id || student.id;
    if (warningPendingMap[sId]) return;

    try {
      setWarningPendingMap(prev => ({ ...prev, [sId]: true }));
      await librarianService.warnStudentNoShow(sId);
      toast.success(`Warning notification dispatched to ${student.student_name || student.name}.`);
    } catch (err) {
      console.error('[NoShowsMonitorPage] Send warning failed:', err);
      toast.error(err.message || 'Failed to send warning.');
    } finally {
      setWarningPendingMap(prev => ({ ...prev, [sId]: false }));
    }
  };

  // Filter students by search
  const filteredStudents = students.filter(s => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    const nameMatch = (s.student_name || s.name || '').toLowerCase().includes(q);
    const idMatch = (s.college_id || s.collegeId || '').toLowerCase().includes(q);
    const deptMatch = (s.department || '').toLowerCase().includes(q);
    return nameMatch || idMatch || deptMatch;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300 pb-12">
      {/* Header Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
            <ShieldAlert className="text-teal-600" size={28} /> No-Show & Standing Monitor
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Track missed student check-ins (15-min grace countdown) and manage penalty restrictions backed by Supabase audit records.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={fetchStandings}
            variant="outline"
            size="sm"
            disabled={loading}
            className="h-9 text-xs font-bold border-slate-200 text-slate-600 hover:bg-slate-100 rounded-xl"
          >
            <RefreshCw size={14} className={`mr-1.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>

          <Badge variant="outline" className="bg-slate-100 border-slate-200 text-teal-700 font-mono text-xs px-3 py-1.5 rounded-xl">
            Grace Limit: 15 Mins
          </Badge>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
          <Input
            type="text"
            placeholder="Search by student name, college ID, department..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 text-xs h-9 rounded-xl border-slate-200 focus:border-teal-500"
          />
        </div>

        <div className="text-xs text-slate-500 font-medium">
          Showing <span className="font-bold text-navy">{filteredStudents.length}</span> of <span className="font-bold text-navy">{students.length}</span> students
        </div>
      </div>

      {/* Error Alert State */}
      {error && (
        <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="shrink-0 text-red-600" />
            <span className="font-semibold">{error}</span>
          </div>
          <Button
            onClick={fetchStandings}
            size="sm"
            className="bg-red-600 hover:bg-red-700 text-white text-xs h-8 rounded-lg px-3"
          >
            Retry Loading
          </Button>
        </div>
      )}

      {/* Standings Table Card */}
      <Card className="border border-slate-200/80 bg-white rounded-2xl shadow-xs overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 space-y-3">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-12 bg-slate-100/70 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : filteredStudents.length === 0 ? (
            <div className="p-12 text-center text-slate-400 space-y-2">
              <UserX className="mx-auto text-slate-300" size={36} />
              <p className="text-xs font-semibold text-slate-600">
                {searchQuery ? 'No student records matching search filter.' : 'No student records found.'}
              </p>
              <p className="text-[11px] text-slate-400">
                All registered student accounts and their no-show standing history will appear here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                    <th className="p-3.5">Student Name</th>
                    <th className="p-3.5">College ID</th>
                    <th className="p-3.5">Department</th>
                    <th className="p-3.5">No-Show Count</th>
                    <th className="p-3.5">Account Standing</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {filteredStudents.map(s => {
                    const count = s.no_show_count ?? s.noShowCount ?? 0;
                    const max = s.max_no_shows ?? s.maxNoShows ?? 3;
                    const standing = s.account_standing || s.accountStanding || (count >= max ? 'Restricted' : 'Good Standing');
                    const isRestricted = s.is_restricted || s.isRestricted || count >= max;

                    let badgeColor = 'bg-emerald-600 text-white';
                    let countColor = 'text-slate-700';

                    if (standing === 'Restricted' || isRestricted) {
                      badgeColor = 'bg-red-600 text-white font-bold';
                      countColor = 'text-red-600 font-black';
                    } else if (standing === 'Final Warning' || count === 2) {
                      badgeColor = 'bg-orange-500 text-white font-bold';
                      countColor = 'text-orange-600 font-bold';
                    } else if (standing === 'Warning' || count === 1) {
                      badgeColor = 'bg-amber-500 text-white font-bold';
                      countColor = 'text-amber-600 font-bold';
                    }

                    const sId = s.student_id || s.id;
                    const isWarnPending = !!warningPendingMap[sId];

                    return (
                      <tr key={sId} className="hover:bg-slate-50 text-slate-700 transition-colors">
                        <td className="p-3.5 font-sans font-bold text-navy">
                          {s.student_name || s.name}
                        </td>
                        <td className="p-3.5 font-mono text-slate-500">
                          {s.college_id || s.collegeId || 'N/A'}
                        </td>
                        <td className="p-3.5 font-sans text-slate-500">
                          {s.department || 'General'}
                        </td>
                        <td className="p-3.5 font-bold">
                          <span className={countColor}>
                            {count} / {max} Offenses
                          </span>
                        </td>
                        <td className="p-3.5">
                          <Badge className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${badgeColor}`}>
                            {standing}
                          </Badge>
                        </td>
                        <td className="p-3.5 text-right flex items-center justify-end gap-2">
                          <Button
                            onClick={() => handleSendWarning(s)}
                            disabled={isWarnPending}
                            variant="outline"
                            className="h-7 text-[10px] font-bold border-slate-300 text-slate-600 hover:bg-slate-100 rounded-lg"
                          >
                            <Bell size={11} className={`mr-1 ${isWarnPending ? 'animate-pulse' : ''}`} /> 
                            {isWarnPending ? 'Sending...' : 'Warn'}
                          </Button>
                          <Button
                            onClick={() => openResetModal(s)}
                            className="h-7 text-[10px] font-bold bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-2.5"
                          >
                            Reset Standing
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reset Standing Dialog Modal */}
      <Dialog open={resetModalOpen} onOpenChange={setResetModalOpen}>
        <DialogContent className="max-w-md bg-white rounded-2xl p-6 border border-slate-200">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-navy flex items-center gap-2">
              <RotateCcw className="text-teal-600" size={20} /> Reset Student No-Show Standing
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              This action will forgive active no-show offenses for <strong className="text-navy">{targetStudent?.student_name || targetStudent?.name}</strong>, remove 7-day restrictions, and restore account status to Good Standing.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleResetSubmit} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">
                Resolution Reason <span className="text-red-500">*</span>
              </Label>
              <Input
                type="text"
                placeholder="e.g. Fine paid, apology submitted, attendance verified..."
                value={resetReason}
                onChange={(e) => setResetReason(e.target.value)}
                required
                className="text-xs h-9 rounded-xl border-slate-200 focus:border-teal-500"
              />
              <p className="text-[10px] text-slate-400">
                This reason will be logged in Supabase audit history and sent to the student.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                onClick={() => setResetModalOpen(false)}
                disabled={isResetting}
                className="h-8 text-xs font-semibold rounded-xl border-slate-200"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isResetting || !resetReason.trim()}
                className="h-8 text-xs font-bold bg-teal-600 hover:bg-teal-700 text-white rounded-xl px-4"
              >
                {isResetting ? 'Resetting...' : 'Confirm Reset Standing'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
