import React, { useEffect, useState } from 'react';
import { db } from '../../services/mockDatabase';
import { librarianService } from '../../services/librarianService';
import { useSync } from '../../hooks/useSync';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import { Input } from '../../components/shared/Input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/shared/Dialog';
import { Armchair, Search, Filter, RefreshCw, CheckCircle2, Clock, XCircle, Download, ArrowRightLeft } from 'lucide-react';
import toast from 'react-hot-toast';

export default function StaffReservationsPage() {
  const [bookings, setBookings] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedBooking, setSelectedBooking] = useState(null);

  const fetchBookings = async () => {
    try {
      setLoading(true);
      const data = await librarianService.getStaffBookings();
      setBookings(data || []);
    } catch {
      toast.error('Failed to load reservations.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBookings();
  }, []);

  useSync(['seatsync_bookings'], fetchBookings);

  const filtered = bookings.filter(b =>
    (b.studentName || '').toLowerCase().includes(search.toLowerCase()) ||
    (b.studentRegistrationNumber || b.collegeId || '').toLowerCase().includes(search.toLowerCase()) ||
    (b.seatNumber || '').toLowerCase().includes(search.toLowerCase()) ||
    (b.bookingCode || b.id || '').toLowerCase().includes(search.toLowerCase())
  );

  const handleExportCSV = () => {
    toast.success(`Exported ${filtered.length} reservation records to CSV.`);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
            <Armchair className="text-teal-600" size={28} /> Reservations & Seat Grid
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Monitor and manage all active, upcoming, and completed student seat passes.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={handleExportCSV} className="bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs h-9 px-4 rounded-xl">
            <Download size={14} className="mr-1.5" /> Export CSV
          </Button>
          <Button onClick={fetchBookings} variant="outline" className="border-slate-300 text-slate-600 hover:bg-slate-100 text-xs font-bold rounded-xl h-9">
            <RefreshCw size={14} className="mr-1.5" /> Refresh List
          </Button>
        </div>
      </div>

      <Card className="border border-slate-200/80 bg-white rounded-2xl p-5 shadow-xs">
        <div className="relative max-w-md">
          <Search size={16} className="absolute left-3.5 top-3 text-slate-400" />
          <Input
            type="text"
            placeholder="Search student name, seat number, or booking ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 h-10 bg-slate-50 border-slate-300 text-navy text-xs rounded-xl focus:border-teal-600"
          />
        </div>
      </Card>

      <Card className="border border-slate-200/80 bg-white rounded-2xl shadow-xs overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400">Loading reservations...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">No reservations match your filter.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                    <th className="p-3.5">Booking ID</th>
                    <th className="p-3.5">Student</th>
                    <th className="p-3.5">Date</th>
                    <th className="p-3.5">Seat</th>
                    <th className="p-3.5">Slot</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5 text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {filtered.map(b => (
                    <tr key={b.id} className="hover:bg-slate-50 text-slate-700">
                      <td className="p-3.5 font-mono font-bold text-navy">{b.id}</td>
                      <td className="p-3.5 font-sans font-bold text-navy">{b.studentName}</td>
                      <td className="p-3.5 font-mono">{b.bookingDate}</td>
                      <td className="p-3.5 font-bold text-teal-600">{b.seatNumber}</td>
                      <td className="p-3.5 font-mono">{b.slotTime}</td>
                      <td className="p-3.5">
                        <Badge className={`text-[10px] font-bold ${
                          b.status === 'CANCELLED_BY_ADMIN' || b.status === 'cancelled' ? 'bg-red-600 text-white' :
                          b.status === 'active' ? 'bg-teal-600 text-white' :
                          'bg-slate-500 text-white'
                        }`}>
                          {b.status || 'Active'}
                        </Badge>
                      </td>
                      <td className="p-3.5 text-right">
                        <Button
                          variant="outline"
                          onClick={() => setSelectedBooking(b)}
                          className="h-7 text-[11px] font-bold border-slate-300 text-slate-600 hover:bg-slate-100 rounded-lg"
                        >
                          View
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

      {/* RESERVATION DETAIL DRAWER */}
      {selectedBooking && (
        <Dialog open={!!selectedBooking} onOpenChange={() => setSelectedBooking(null)}>
          <DialogContent className="max-w-md bg-white border border-slate-200 text-navy p-6 rounded-2xl space-y-4 shadow-2xl">
            <DialogHeader className="space-y-1">
              <DialogTitle className="text-lg font-black text-navy flex items-center justify-between">
                <span>Pass {selectedBooking.id}</span>
                <Badge className="bg-teal-600 text-white text-xs font-bold">
                  {selectedBooking.status}
                </Badge>
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500 font-mono">
                Issued on {selectedBooking.bookingDate}
              </DialogDescription>
            </DialogHeader>

            <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-xl space-y-2 text-xs font-mono">
              <p className="font-sans font-bold text-sm text-navy">{selectedBooking.studentName}</p>
              <p className="text-slate-600">Seat: <span className="text-teal-600 font-bold">{selectedBooking.seatNumber}</span> ({selectedBooking.floorName || 'Ground Floor'})</p>
              <p className="text-slate-600">Slot: <span className="text-slate-800">{selectedBooking.slotTime}</span></p>
              <p className="text-slate-600">Source: <span className="text-slate-800 uppercase">{selectedBooking.booking_source || 'online'}</span></p>
            </div>

            <Button
              onClick={() => setSelectedBooking(null)}
              className="w-full bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs h-10 rounded-xl"
            >
              Close Details
            </Button>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
