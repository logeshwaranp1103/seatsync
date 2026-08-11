import React, { useState, useEffect } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { librarianService } from '../../services/librarianService';
import { Card } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Input } from '../../components/shared/Input';
import { Badge } from '../../components/shared/Badge';
import {
  UserCheck, LogOut, Search, CheckCircle2,
  Clock, MapPin, Calendar, AlertTriangle, ShieldAlert
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function CheckInOutPage() {
  const { user: staffUser } = useAuth();
  const [activeTab, setActiveTab] = useState('check-in'); // 'check-in' | 'check-out'
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [matchingBookings, setMatchingBookings] = useState([]);
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [checkInReason, setCheckInReason] = useState('Entry Pass Verified');
  const [overrideReason, setOverrideReason] = useState('');
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [recentLogs, setRecentLogs] = useState([]);

  useEffect(() => {
    loadRecentLogs();
  }, []);

  const loadRecentLogs = async () => {
    try {
      const logs = await librarianService.getCheckInHistory();
      setRecentLogs(logs || []);
    } catch (err) {
      console.warn('Failed to load checkin logs:', err);
    }
  };

  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    if (!searchInput.trim()) {
      toast.error('Please enter a booking code, registration number, or student email.');
      return;
    }

    setLoading(true);
    setMatchingBookings([]);
    setSelectedBooking(null);

    try {
      const res = await librarianService.lookupBookingForManualCheckIn(searchInput.trim());
      if (res.success && res.matches?.length > 0) {
        setMatchingBookings(res.matches);
        if (res.matches.length === 1) {
          setSelectedBooking(res.matches[0]);
        }
        toast.success(`Found ${res.matches.length} matching reservation(s)!`);
      } else {
        toast.error(res.message || 'No reservation found matching search query.');
      }
    } catch (err) {
      toast.error(err.message || 'Error searching for booking.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmCheckIn = async (overrideReasonText = null) => {
    if (!selectedBooking) return;
    setLoading(true);
    try {
      const finalReason = overrideReasonText || checkInReason;
      const res = await librarianService.checkInBooking({
        bookingId: selectedBooking.id,
        method: 'manual',
        overrideReason: finalReason
      });

      if (res.success) {
        toast.success(`Check-In confirmed for ${selectedBooking.studentName} (Seat ${selectedBooking.seatNumber}).`);
        setSelectedBooking(null);
        setMatchingBookings([]);
        setSearchInput('');
        setShowOverrideModal(false);
        setOverrideReason('');
        await loadRecentLogs();
      } else {
        toast.error(res.message || 'Check-in failed.');
      }
    } catch (err) {
      toast.error(err.message || 'Check-in failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmCheckOut = async () => {
    if (!selectedBooking) return;
    setLoading(true);
    try {
      const res = await librarianService.checkOutBooking({
        bookingId: selectedBooking.id,
        method: 'manual'
      });

      if (res.success) {
        toast.success(`Check-Out completed for ${selectedBooking.studentName}. Seat released!`);
        setSelectedBooking(null);
        setMatchingBookings([]);
        setSearchInput('');
        await loadRecentLogs();
      } else {
        toast.error(res.message || 'Check-out failed.');
      }
    } catch (err) {
      toast.error(err.message || 'Check-out failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
            <UserCheck className="text-teal-600" size={28} /> Check-In & Check-Out Desk
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Manually verify student entry passes, confirm desk check-ins, or process student check-outs using real database records.
          </p>
        </div>

        {/* Tab Toggle */}
        <div className="flex bg-slate-100 border border-slate-200 p-1 rounded-2xl">
          <button
            onClick={() => { setActiveTab('check-in'); setSelectedBooking(null); setMatchingBookings([]); }}
            className={`px-5 py-2 rounded-xl text-xs font-extrabold transition-all flex items-center gap-2 ${
              activeTab === 'check-in'
                ? 'bg-teal-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-navy'
            }`}
          >
            <UserCheck size={16} /> Check-In Desk
          </button>
          <button
            onClick={() => { setActiveTab('check-out'); setSelectedBooking(null); setMatchingBookings([]); }}
            className={`px-5 py-2 rounded-xl text-xs font-extrabold transition-all flex items-center gap-2 ${
              activeTab === 'check-out'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-navy'
            }`}
          >
            <LogOut size={16} /> Check-Out Desk
          </button>
        </div>
      </div>

      {/* SEARCH CARD */}
      <Card className="border border-slate-200/80 bg-white rounded-2xl p-6 shadow-xs space-y-4">
        <h2 className="text-base font-bold text-navy flex items-center gap-2">
          <Search size={18} className="text-teal-600" /> Search Student Reservation
        </h2>

        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-3.5 text-slate-400" size={18} />
            <Input
              type="text"
              placeholder="Enter Booking Code (BK-114312), Register Number (7376252AD345), or Email..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-10 h-11 bg-slate-50 border-slate-300 text-navy font-mono text-xs focus:border-teal-600 rounded-xl"
            />
          </div>
          <Button
            type="submit"
            disabled={loading}
            className={`h-11 px-6 font-bold text-xs rounded-xl shadow-xs ${
              activeTab === 'check-in' ? 'bg-teal-600 hover:bg-teal-700 text-white' : 'bg-amber-600 hover:bg-amber-700 text-white'
            }`}
          >
            {loading ? 'Searching...' : 'Find Reservation'}
          </Button>
        </form>
      </Card>

      {/* MATCHING CANDIDATES SELECTOR IF MULTIPLE RETURNED */}
      {matchingBookings.length > 1 && !selectedBooking && (
        <Card className="border border-indigo-200 bg-indigo-50/40 rounded-2xl p-6 shadow-xs space-y-4">
          <h3 className="text-sm font-extrabold text-navy flex items-center gap-2">
            <AlertTriangle className="text-indigo-600" size={18} />
            Multiple Matching Reservations Found ({matchingBookings.length})
          </h3>
          <p className="text-xs text-slate-600">Please select the specific reservation to proceed:</p>

          <div className="space-y-2">
            {matchingBookings.map((b) => (
              <div
                key={b.id}
                onClick={() => setSelectedBooking(b)}
                className="p-4 bg-white border border-slate-200 hover:border-teal-500 rounded-xl cursor-pointer transition-all flex flex-wrap items-center justify-between gap-3 shadow-xs"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-navy text-sm">{b.studentName}</span>
                    <Badge className="bg-slate-100 text-slate-700 text-[10px]">{b.registrationNumber}</Badge>
                    <Badge className={`text-[10px] ${b.status === 'checked_in' ? 'bg-teal-600 text-white' : 'bg-brandBlue text-white'}`}>
                      {b.status.toUpperCase()}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-500 font-mono mt-1">
                    Code: <strong>{b.bookingCode}</strong> | Seat: <strong>{b.seatNumber}</strong> | {b.slotName} ({b.slotTime})
                  </p>
                </div>
                <Button className="h-8 px-4 text-xs font-bold bg-teal-600 hover:bg-teal-700 text-white rounded-lg">
                  Select
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* SELECTED RESERVATION CARD */}
      {selectedBooking && (
        <Card className={`border-2 rounded-2xl p-6 shadow-sm space-y-6 animate-in slide-in-from-top-2 ${
          activeTab === 'check-in' ? 'border-teal-500/50 bg-white' : 'border-amber-500/50 bg-white'
        }`}>
          <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Badge className={`text-xs font-extrabold px-3 py-1 ${
                selectedBooking.status === 'checked_in' ? 'bg-teal-600 text-white' :
                selectedBooking.status === 'checked_out' ? 'bg-slate-500 text-white' :
                selectedBooking.status === 'cancelled' ? 'bg-rose-600 text-white' :
                'bg-brandBlue text-white'
              }`}>
                {selectedBooking.status.toUpperCase()}
              </Badge>
              <span className="text-xs font-mono font-bold text-slate-500">Code: {selectedBooking.bookingCode}</span>
            </div>
            <span className="text-xs font-mono text-slate-500 flex items-center gap-1">
              <Calendar size={14} className="text-teal-600" /> Date: {selectedBooking.bookingDate}
            </span>
          </div>

          <div className="grid sm:grid-cols-3 gap-4 bg-slate-50 border border-slate-200/80 rounded-xl p-4">
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Student Name</span>
              <p className="text-base font-extrabold text-navy flex items-center gap-1.5">
                {selectedBooking.studentName}
              </p>
              <p className="text-[11px] text-slate-500 font-mono">Reg No: {selectedBooking.registrationNumber}</p>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Assigned Seat</span>
              <p className="text-base font-extrabold text-navy flex items-center gap-1.5">
                <MapPin size={16} className="text-teal-600" /> Seat {selectedBooking.seatNumber}
              </p>
              <p className="text-[11px] text-slate-500">{selectedBooking.floorName || 'Ground Floor'} - {selectedBooking.roomName || 'Main Reading Room'}</p>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Reserved Slot</span>
              <p className="text-sm font-bold text-navy font-mono flex items-center gap-1.5">
                <Clock size={16} className="text-teal-600" /> {selectedBooking.slotTime}
              </p>
            </div>
          </div>

          {activeTab === 'check-in' ? (
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 block">Verification Method / Reason</label>
                <select
                  value={checkInReason}
                  onChange={(e) => setCheckInReason(e.target.value)}
                  className="w-full h-11 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-navy px-3 focus:border-teal-600"
                >
                  <option value="Entry Pass Verified">Entry Pass QR Verified</option>
                  <option value="Physical Student ID Verified">Physical Student ID Verified</option>
                  <option value="Staff Manual Desk Verification">Staff Manual Desk Verification</option>
                </select>
              </div>

              {selectedBooking.status === 'checked_in' ? (
                <div className="p-4 bg-teal-50 border border-teal-200 text-teal-700 text-xs rounded-xl flex items-center gap-2">
                  <CheckCircle2 size={18} className="text-teal-600 shrink-0" />
                  <span>Student is already checked in to Seat {selectedBooking.seatNumber}.</span>
                </div>
              ) : selectedBooking.eligibilityCode !== 'ELIGIBLE' && selectedBooking.eligibilityCode !== 'ALREADY_CHECKED_IN' ? (
                <div className="space-y-3">
                  <div className="p-4 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl flex items-start gap-2">
                    <ShieldAlert size={18} className="text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-extrabold">{selectedBooking.eligibilityMessage || 'Validation Notice'}</p>
                      <p className="mt-0.5 text-slate-600">Standard check-in validation triggered code: <code className="font-bold">{selectedBooking.eligibilityCode}</code>. An authorized librarian override is available below.</p>
                    </div>
                  </div>

                  <Button
                    onClick={() => setShowOverrideModal(true)}
                    disabled={loading}
                    className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center justify-center gap-2"
                  >
                    <ShieldAlert size={18} /> Apply Librarian Override & Check-In →
                  </Button>
                </div>
              ) : (
                <Button
                  onClick={() => handleConfirmCheckIn()}
                  disabled={loading}
                  className="w-full h-11 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center justify-center gap-2"
                >
                  <UserCheck size={18} /> Confirm Desk Check-In & Activate Pass →
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4 pt-2">
              {selectedBooking.status === 'checked_out' ? (
                <div className="p-4 bg-slate-100 border border-slate-200 text-slate-600 text-xs rounded-xl flex items-center gap-2">
                  <CheckCircle2 size={18} className="text-slate-400 shrink-0" />
                  <span>Student has already checked out from Seat {selectedBooking.seatNumber}.</span>
                </div>
              ) : (
                <Button
                  onClick={handleConfirmCheckOut}
                  disabled={loading}
                  className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center justify-center gap-2"
                >
                  <LogOut size={18} /> Confirm Student Check-Out & Release Seat →
                </Button>
              )}
            </div>
          )}
        </Card>
      )}

      {/* OVERRIDE REASON MODAL */}
      {showOverrideModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in zoom-in-95">
            <h3 className="text-lg font-black text-navy flex items-center gap-2">
              <ShieldAlert className="text-amber-600" size={22} /> Librarian Override Reason Required
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Please enter the official reason for overriding the check-in window constraint for <strong>{selectedBooking?.studentName}</strong> (Seat {selectedBooking?.seatNumber}).
            </p>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 block">Override Reason</label>
              <Input
                type="text"
                placeholder="e.g. Special permission granted by Head Librarian"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                className="h-11 bg-slate-50 border-slate-300 text-xs text-navy rounded-xl"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                onClick={() => setShowOverrideModal(false)}
                variant="outline"
                className="flex-1 h-11 rounded-xl font-bold text-xs"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (!overrideReason.trim()) {
                    toast.error('Override reason is required.');
                    return;
                  }
                  handleConfirmCheckIn(overrideReason.trim());
                }}
                disabled={loading}
                className="flex-1 h-11 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl"
              >
                Confirm Override
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* RECENT CHECK-IN ACTIVITY TABLE */}
      <Card className="border border-slate-200/80 bg-white rounded-2xl p-6 shadow-xs space-y-4">
        <h3 className="text-base font-bold text-navy flex items-center gap-2">
          <Clock size={18} className="text-teal-600" /> Recent Desk Check-In Activity Log
        </h3>

        {recentLogs.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-6">No recent check-in records logged yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                  <th className="py-2.5 px-3">Time</th>
                  <th className="py-2.5 px-3">Student</th>
                  <th className="py-2.5 px-3">Booking Code</th>
                  <th className="py-2.5 px-3">Action</th>
                  <th className="py-2.5 px-3">Verified By</th>
                  <th className="py-2.5 px-3">Reason / Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {recentLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50 text-slate-700">
                    <td className="py-2.5 px-3 font-semibold text-slate-500">{log.timestamp ? new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now'}</td>
                    <td className="py-2.5 px-3 font-bold text-navy">{log.studentName}</td>
                    <td className="py-2.5 px-3 font-bold text-teal-600">{log.bookingCode}</td>
                    <td className="py-2.5 px-3 uppercase text-[11px]">
                      <Badge className={log.action === 'checkout' ? 'bg-amber-500 text-white' : 'bg-teal-600 text-white'}>
                        {log.action}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3 text-slate-500">{log.librarianName || 'Staff'}</td>
                    <td className="py-2.5 px-3 text-slate-500">{log.overrideReason || log.notes || 'Verified'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
