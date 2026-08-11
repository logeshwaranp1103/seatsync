import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { bookingService } from '../../services/bookingService';
import { db } from '../../services/mockDatabase';
import { useSync } from '../../hooks/useSync';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Input } from '../../components/shared/Input';
import { Badge } from '../../components/shared/Badge';
import { BookmarkCheck, Search, RefreshCw, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';

export default function AdminBookingsPage() {
  const [bookings, setBookings] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchBookings = async () => {
    try {
      setLoading(true);

      // 1. Fetch real Supabase bookings
      let dbBookings = [];
      try {
        const { data, error } = await supabase
          .from('bookings')
          .select('*')
          .order('created_at', { ascending: false });

        if (!error && data && data.length > 0) {
          // Resolve student names, seat numbers, and slot times separately
          const studentIds = [...new Set(data.filter(b => b.student_id).map(b => b.student_id))];
          const seatIds = [...new Set(data.filter(b => b.seat_id).map(b => b.seat_id))];
          const slotIds = [...new Set(data.filter(b => b.slot_id).map(b => b.slot_id))];

          const profileMap = new Map();
          const seatMap = new Map();
          const slotMap = new Map();

          if (studentIds.length > 0) {
            try {
              const { data: profiles } = await supabase.from('profiles').select('id, full_name, registration_number').in('id', studentIds);
              if (profiles) profiles.forEach(p => profileMap.set(p.id, p));
            } catch { /* proceed */ }
          }
          if (seatIds.length > 0) {
            try {
              const { data: seats } = await supabase.from('seats').select('id, seat_number').in('id', seatIds);
              if (seats) seats.forEach(s => seatMap.set(s.id, s.seat_number));
            } catch { /* proceed */ }
          }
          if (slotIds.length > 0) {
            try {
              const { data: slots } = await supabase.from('slots').select('id, name, start_time, end_time').in('id', slotIds);
              if (slots) slots.forEach(s => slotMap.set(s.id, s));
            } catch { /* proceed */ }
          }

          dbBookings = data.map(b => {
            const prof = profileMap.get(b.student_id);
            const slot = slotMap.get(b.slot_id);
            return {
              id: b.id,
              bookingCode: b.booking_code,
              studentId: b.student_id,
              studentName: prof?.full_name || 'Student',
              collegeId: prof?.registration_number || 'N/A',
              bookingDate: b.booking_date,
              seatNumber: seatMap.get(b.seat_id) || 'A-101',
              slotTime: slot ? `${slot.start_time || ''} – ${slot.end_time || ''}` : '09:00 AM – 10:00 AM',
              status: b.status,
              createdAt: b.created_at
            };
          });
        }
      } catch { /* proceed */ }

      // 2. Fetch local storage bookings
      const localData = (await db.read('seatsync_bookings')) || [];

      // Merge and deduplicate
      const map = new Map();
      dbBookings.forEach(b => map.set(b.id, b));
      localData.forEach(b => {
        if (b.id && !map.has(b.id)) map.set(b.id, b);
      });

      setBookings(Array.from(map.values()));
    } catch {
      toast.error('Failed to load reservations.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBookings();
  }, []);

  useSync((event) => {
    if (event?.type === 'storage_change') fetchBookings();
  });

  const handleAdminCancel = async (bookingId) => {
    try {
      try {
        await bookingService.cancelBooking(bookingId, 'admin');
      } catch {
        const data = (await db.read('seatsync_bookings')) || [];
        const target = data.find(b => b.id === bookingId);
        if (target) {
          target.status = 'cancelled';
          await db.write('seatsync_bookings', data);
        }
      }
      toast.success(`Cancelled reservation ${bookingId}`);
      fetchBookings();
    } catch {
      toast.error('Failed to cancel booking.');
    }
  };

  const filtered = bookings.filter(b =>
    (b.studentName || '').toLowerCase().includes(search.toLowerCase()) ||
    (b.seatNumber || '').toLowerCase().includes(search.toLowerCase()) ||
    (b.id || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight">System Reservations Log</h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium">
            Administrative view of all student reservations and pass lifecycles.
          </p>
        </div>

        <Button onClick={fetchBookings} variant="outline" className="text-xs font-bold rounded-xl h-9">
          <RefreshCw size={14} className="mr-1.5" /> Refresh List
        </Button>
      </div>

      <Card className="border border-slate-200 bg-white rounded-2xl p-4 shadow-xs">
        <div className="relative max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            type="text"
            placeholder="Search booking ID, student, or seat number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-10 text-xs rounded-xl border-slate-300"
          />
        </div>
      </Card>

      <Card className="border border-slate-200 rounded-2xl shadow-xs overflow-hidden bg-white">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400">Loading system reservations...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">No reservations match search.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                    <th className="p-3.5">Booking ID</th>
                    <th className="p-3.5">Student</th>
                    <th className="p-3.5">Date</th>
                    <th className="p-3.5">Seat</th>
                    <th className="p-3.5">Slot Time</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(b => (
                    <tr key={b.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3.5 font-mono font-bold text-navy">{b.id}</td>
                      <td className="p-3.5 font-bold text-navy">{b.studentName}</td>
                      <td className="p-3.5 font-mono">{b.bookingDate}</td>
                      <td className="p-3.5 font-bold text-indigo-600">{b.seatNumber}</td>
                      <td className="p-3.5 font-mono">{b.slotTime}</td>
                      <td className="p-3.5">
                        <Badge className={`text-[10px] font-bold ${
                          b.status === 'checkout_pending' ? 'bg-amber-500 text-white' :
                          b.status === 'completed' ? 'bg-slate-500 text-white' :
                          b.status === 'cancelled' ? 'bg-red-500 text-white' : 'bg-indigo-600 text-white'
                        }`}>
                          {b.status || 'Active'}
                        </Badge>
                      </td>
                      <td className="p-3.5 text-right">
                        {b.status !== 'cancelled' && b.status !== 'completed' && (
                          <Button
                            onClick={() => handleAdminCancel(b.id)}
                            variant="outline"
                            className="h-7 text-[11px] font-bold rounded-lg border-red-200 text-red-600 hover:bg-red-50"
                          >
                            Revoke
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
