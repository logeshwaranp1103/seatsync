import React, { useState } from 'react';
import { db } from '../../services/mockDatabase';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Input } from '../../components/shared/Input';
import { Badge } from '../../components/shared/Badge';
import {
  Search, User, MapPin, Clock, Calendar, AlertTriangle, ShieldCheck,
  History, QrCode, BookmarkCheck, FileText, CheckCircle2
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function BookingLookupPage() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [studentResult, setStudentResult] = useState(null);

  const handleLookup = async (e) => {
    e.preventDefault();
    if (!query.trim()) {
      toast.error('Please enter student name, ID, booking code, seat or token.');
      return;
    }

    setLoading(true);
    setStudentResult(null);

    try {
      const q = query.trim().toLowerCase();
      const [users, bookings, waitlist, logs] = await Promise.all([
        db.read('seatsync_users') || [],
        db.read('seatsync_bookings') || [],
        db.read('seatsync_waitlist') || [],
        db.read('seatsync_activity_logs') || []
      ]);

      // 1. Find matched student or booking
      let student = users.find(u =>
        u.role === 'STUDENT' && (
          u.name.toLowerCase().includes(q) ||
          (u.collegeId && u.collegeId.toLowerCase().includes(q)) ||
          (u.email && u.email.toLowerCase().includes(q))
        )
      );

      let matchedBooking = null;
      if (!student) {
        matchedBooking = bookings.find(b =>
          String(b.id).toLowerCase().includes(q) ||
          (b.seatNumber && b.seatNumber.toLowerCase() === q) ||
          (b.qrToken && b.qrToken.toLowerCase().includes(q))
        );
        if (matchedBooking) {
          student = users.find(u => u.id === matchedBooking.studentId);
        }
      }

      if (!student && !matchedBooking) {
        toast.error(`No records found for query "${query}".`);
        setLoading(false);
        return;
      }

      // 2. Fetch history
      const studentId = student?.id || matchedBooking?.studentId;
      const studentBookings = bookings.filter(b => b.studentId === studentId);
      const studentWaitlist = waitlist.filter(w => w.studentId === studentId);
      const studentLogs = logs.filter(l => l.affectedRecord && l.affectedRecord.includes(student?.name || ''));

      setStudentResult({
        student: student || { name: matchedBooking.studentName, collegeId: matchedBooking.studentCollegeId },
        bookings: studentBookings,
        activeBooking: studentBookings.find(b => b.status === 'active' || b.status === 'confirmed'),
        waitlist: studentWaitlist,
        logs: studentLogs,
        noShowCount: student?.noShowCount || 0
      });

      toast.success('Lookup record retrieved!');
    } catch (err) {
      toast.error('Failed to perform lookup.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="pb-2 border-b border-slate-200">
        <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
          <Search className="text-teal-600" size={28} /> Global Student & Booking Lookup
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
          Search student profiles, active reservations, historical bookings, no-show scores, and staff operation records.
        </p>
      </div>

      <Card className="border border-slate-200/80 bg-white rounded-2xl p-6 shadow-xs space-y-4">
        <form onSubmit={handleLookup} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-3.5 text-slate-400" size={18} />
            <Input
              type="text"
              placeholder="Search by student name, college ID (24AD042), booking ID (BK-1785), or seat (A-102)..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10 h-11 bg-slate-50 border-slate-300 text-navy font-mono text-xs focus:border-teal-600 rounded-xl"
            />
          </div>
          <Button
            type="submit"
            disabled={loading}
            className="h-11 px-6 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl shadow-xs shrink-0"
          >
            {loading ? 'Searching...' : 'Run Lookup'}
          </Button>
        </form>
      </Card>

      {studentResult && (
        <div className="space-y-6 animate-in fade-in">
          {/* PROFILE SUMMARY HEADER CARD */}
          <Card className="border border-slate-200/80 bg-white rounded-2xl p-6 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-teal-50 text-teal-700 border border-teal-200 font-black text-xl flex items-center justify-center">
                  {(studentResult.student.name || 'S').charAt(0)}
                </div>
                <div>
                  <h2 className="text-xl font-extrabold text-navy">{studentResult.student.name}</h2>
                  <p className="text-xs text-slate-500 font-mono">College ID: {studentResult.student.collegeId || '24AD042'}</p>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-center">
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Total Bookings</span>
                  <span className="text-base font-black text-navy">{studentResult.bookings.length}</span>
                </div>
                <div className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-center">
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">No-Show Score</span>
                  <span className="text-base font-black text-amber-600">{studentResult.noShowCount}</span>
                </div>
              </div>
            </div>
          </Card>

          {/* ACTIVE RESERVATION */}
          {studentResult.activeBooking && (
            <Card className="border-2 border-teal-500/60 bg-white rounded-2xl p-6 shadow-xs space-y-4">
              <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                <Badge className="bg-teal-600 text-white font-extrabold text-xs px-3 py-1">Active Pass</Badge>
                <span className="text-xs font-mono text-slate-500">ID: {studentResult.activeBooking.id}</span>
              </div>
              <div className="grid sm:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Seat</span>
                  <p className="text-base font-extrabold text-navy flex items-center gap-1">
                    <MapPin size={16} className="text-teal-600" /> Seat {studentResult.activeBooking.seatNumber}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Slot</span>
                  <p className="text-sm font-bold text-navy font-mono flex items-center gap-1">
                    <Clock size={15} className="text-teal-600" /> {studentResult.activeBooking.slotTime}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Date</span>
                  <p className="text-sm font-bold text-navy font-mono flex items-center gap-1">
                    <Calendar size={15} className="text-teal-600" /> {studentResult.activeBooking.bookingDate}
                  </p>
                </div>
              </div>
            </Card>
          )}

          {/* BOOKING HISTORY TABLE */}
          <Card className="border border-slate-200/80 bg-white rounded-2xl p-6 shadow-xs space-y-4">
            <h3 className="text-base font-bold text-navy flex items-center gap-2">
              <History size={18} className="text-teal-600" /> Complete Booking & Cancellation History
            </h3>

            {studentResult.bookings.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">No historical bookings found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Booking ID</th>
                      <th className="py-2.5 px-3">Seat</th>
                      <th className="py-2.5 px-3">Slot</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Source</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono">
                    {studentResult.bookings.map(b => (
                      <tr key={b.id} className="hover:bg-slate-50 text-slate-700">
                        <td className="py-2.5 px-3">{b.bookingDate}</td>
                        <td className="py-2.5 px-3 font-bold text-navy">{b.id}</td>
                        <td className="py-2.5 px-3 text-teal-600 font-bold">{b.seatNumber}</td>
                        <td className="py-2.5 px-3">{b.slotTime}</td>
                        <td className="py-2.5 px-3">
                          <Badge className={`text-[10px] font-bold ${
                            b.status === 'CANCELLED_BY_ADMIN' || b.status === 'cancelled' ? 'bg-red-600 text-white' :
                            b.status === 'active' ? 'bg-teal-600 text-white' :
                            'bg-slate-500 text-white'
                          }`}>
                            {b.status}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-3 uppercase text-[10px] text-slate-500">{b.booking_source || 'online'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
