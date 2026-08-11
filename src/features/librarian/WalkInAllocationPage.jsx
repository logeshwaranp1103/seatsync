import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { bookingService } from '../../services/bookingService';
import { librarianService } from '../../services/librarianService';
import { Card, CardContent } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/shared/Dialog';
import {
  UserPlus, Search, Calendar, Clock, MapPin, CheckCircle2,
  AlertTriangle, QrCode, Printer, Sparkles, User, Armchair, Wrench, Lock, Check, History, Filter, RefreshCw
} from 'lucide-react';
import toast from 'react-hot-toast';
import { formatSlotTime } from '../../utils/timeUtils.js';

export default function WalkInAllocationPage() {
  const { user: staffUser } = useAuth();
  const [students, setStudents] = useState([]);
  const [slots, setSlots] = useState([]);
  const [walkInSeats, setWalkInSeats] = useState([]);
  const [searchStudent, setSearchStudent] = useState('');
  const [selectedStudent, setSelectedStudent] = useState(null);
  
  const todayStr = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [selectedSlotId, setSelectedSlotId] = useState('');
  const [selectedSeatId, setSelectedSeatId] = useState('');
  const [autoCheckIn, setAutoCheckIn] = useState(true);

  const [loading, setLoading] = useState(false);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [loadingSeats, setLoadingSeats] = useState(false);
  const [bookingResult, setBookingResult] = useState(null);

  // Walk-In History state
  const [historyList, setHistoryList] = useState([]);
  const [historySearch, setHistorySearch] = useState('');
  const [historyStatusFilter, setHistoryStatusFilter] = useState('ALL');

  // Initial load
  useEffect(() => {
    loadInitialData();
  }, [selectedDate]);

  // Debounced Student Search from real public.profiles table
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchActiveStudents(searchStudent);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchStudent]);

  // Load walk-in seats S-41 to S-50 when slot changes
  useEffect(() => {
    if (selectedDate && selectedSlotId) {
      loadWalkInSeats();
    }
  }, [selectedDate, selectedSlotId]);

  const fetchActiveStudents = async (queryStr = '') => {
    setLoadingStudents(true);
    try {
      const activeStudents = await bookingService.searchActiveStudents(queryStr);
      setStudents(activeStudents || []);
    } catch (err) {
      console.warn('Failed to fetch active students:', err);
    } finally {
      setLoadingStudents(false);
    }
  };

  const loadInitialData = async () => {
    try {
      const [slotsData, operationalBookings] = await Promise.all([
        bookingService.getSlotsAvailability(selectedDate),
        librarianService.getOperationalBookings(staffUser?.library_id, selectedDate)
      ]);

      setSlots(slotsData || []);

      if (slotsData && slotsData.length > 0 && !selectedSlotId) {
        setSelectedSlotId(slotsData[0].id);
      }

      // Filter real walk-in bookings for history
      const walkInBookings = (operationalBookings || [])
        .filter(b => String(b.bookingSource || b.booking_source || '').toLowerCase() === 'librarian_walk_in')
        .sort((a, b) => new Date(b.createdAt || b.created_at || 0) - new Date(a.createdAt || a.created_at || 0));
      setHistoryList(walkInBookings);
    } catch (err) {
      console.warn('Failed to load initial walk-in data:', err);
    }
  };

  const loadWalkInSeats = async () => {
    try {
      setLoadingSeats(true);
      const seatsData = await bookingService.getWalkInSeatsForSlot(null, selectedDate, selectedSlotId);
      setWalkInSeats(seatsData || []);
    } catch (err) {
      console.warn('Failed to load walk-in seats:', err);
    } finally {
      setLoadingSeats(false);
    }
  };

  const selectedSeatObj = walkInSeats.find(s => String(s.id) === String(selectedSeatId) || String(s.seat_number) === String(selectedSeatId));
  const selectedSlotObj = slots.find(s => String(s.id) === String(selectedSlotId));

  const handleCreateWalkIn = async (e) => {
    if (e) e.preventDefault();
    if (!selectedStudent || !selectedStudent.id) {
      toast.error('Please select an active student for the walk-in allocation.');
      return;
    }
    if (!selectedSlotId) {
      toast.error('Please select an operational time slot.');
      return;
    }
    if (!selectedSeatId || !selectedSeatObj) {
      toast.error('Please select an available walk-in pool seat (S-41 to S-50).');
      return;
    }
    if (selectedSeatObj.computed_status !== 'available') {
      toast.error(`Seat ${selectedSeatObj.seat_number} is currently ${selectedSeatObj.computed_status}. Select an available seat.`);
      return;
    }

    const studentGenderGroup = ['female', 'girls', 'girl'].includes(String(selectedStudent.gender || selectedStudent.genderGroup || 'boys').toLowerCase()) ? 'girls' : 'boys';
    const seatNum = parseInt(String(selectedSeatObj.seat_number || selectedSeatObj.seatNumber || '').replace(/\D+/g, ''), 10) || 41;
    const seatGenderGroup = String(selectedSeatObj.gender_group || selectedSeatObj.genderGroup || (seatNum <= 45 ? 'boys' : 'girls')).toLowerCase();

    if (studentGenderGroup !== seatGenderGroup) {
      toast.error("This seat is not allocated to the selected student's group.");
      return;
    }

    setLoading(true);
    try {
      const res = await bookingService.allocateWalkInSeat({
        studentId: selectedStudent.id,
        seatId: selectedSeatObj.id,
        slotId: selectedSlotId,
        bookingDate: selectedDate,
        instantCheckIn: autoCheckIn
      });

      setBookingResult(res);
      toast.success(`Walk-In seat ${selectedSeatObj.seat_number} successfully allocated for ${selectedStudent.name || 'Student'}!`);
      setSelectedSeatId('');
      setSelectedStudent(null);
      await loadInitialData();
      await loadWalkInSeats();
    } catch (err) {
      toast.error(err.message || 'Failed to create walk-in allocation.');
    } finally {
      setLoading(false);
    }
  };

  const filteredHistory = historyList.filter(b => {
    const matchesSearch = (b.studentName || b.student_name || '').toLowerCase().includes(historySearch.toLowerCase()) ||
      (b.seatNumber || b.seat_number || '').toLowerCase().includes(historySearch.toLowerCase()) ||
      (b.bookingCode || b.booking_code || '').toLowerCase().includes(historySearch.toLowerCase());
    const matchesStatus = historyStatusFilter === 'ALL' || String(b.status || '').toLowerCase() === historyStatusFilter.toLowerCase();
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-8 max-w-7xl mx-auto animate-in fade-in duration-300 pb-12">

      {/* HEADER & DEDICATED POOL BANNER */}
      <div className="pb-3 border-b border-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
              <UserPlus className="text-teal-600" size={30} /> Walk-In Seat Allocation Desk
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
              Allocate instant library seats for students arriving at the desk without online reservations.
            </p>
          </div>

          <Badge className="bg-amber-500 text-white font-mono font-extrabold text-xs px-3.5 py-1.5 rounded-2xl shadow-xs">
            Walk-In Reserved Pool: S-41 to S-50
          </Badge>
        </div>
      </div>

      {/* DEDICATED POOL NOTICE */}
      <div className="bg-amber-50/70 border border-amber-200 rounded-3xl p-4 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-900 font-medium">
        <div className="flex items-center gap-2.5">
          <Sparkles size={18} className="text-amber-600 shrink-0" />
          <span>
            <strong>Walk-In Dedicated Pool:</strong> Seats <strong>S-41 through S-50</strong> are exclusively reserved for librarian desk allocation. They are isolated from student online bookings and student waitlists.
          </span>
        </div>
        <span className="text-[11px] font-bold text-amber-700 uppercase font-mono">10 Reserved Desks</span>
      </div>

      <div className="grid lg:grid-cols-3 gap-6 items-start">
        
        {/* STEP 1: STUDENT SELECTION FROM PUBLIC.PROFILES */}
        <Card className="border border-slate-200/90 bg-white rounded-3xl p-5 shadow-xs space-y-4 lg:col-span-1">
          <h2 className="text-sm font-extrabold text-navy uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 pb-3">
            <User size={18} className="text-teal-600" /> 1. Select Active Student
          </h2>

          <div className="relative">
            <Search size={14} className="absolute left-3 top-3 text-slate-400" />
            <input
              type="text"
              placeholder="Search student name, ID or email..."
              value={searchStudent}
              onChange={(e) => setSearchStudent(e.target.value)}
              className="w-full h-11 pl-9 pr-3 rounded-2xl border border-slate-300 text-xs font-medium bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600 min-h-[44px]"
            />
          </div>

          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {loadingStudents ? (
              <div className="p-6 text-center text-xs text-slate-400 font-mono animate-pulse">Querying public.profiles...</div>
            ) : students.length === 0 ? (
              <div className="p-6 text-center space-y-1">
                <p className="text-xs text-slate-500 font-bold">No active student profile found.</p>
                <p className="text-[11px] text-slate-400">Search for active student name, register ID, or email.</p>
              </div>
            ) : (
              students.map(student => {
                const isSelected = selectedStudent?.id === student.id;
                return (
                  <div
                    key={student.id}
                    onClick={() => setSelectedStudent(student)}
                    className={`
                      p-3 rounded-2xl border text-xs cursor-pointer transition-all flex items-center justify-between min-h-[44px]
                      ${isSelected
                        ? 'bg-teal-50/70 border-teal-600 text-teal-900 font-bold shadow-xs'
                        : 'bg-slate-50/60 border-slate-200/80 hover:bg-slate-100 text-slate-700'
                      }
                    `}
                  >
                    <div>
                      <div className="font-bold text-navy flex items-center gap-2">
                        {student.name || student.full_name}
                        <Badge className={`text-[9px] font-mono font-bold px-1.5 py-0.5 ${
                          (['female', 'girls', 'girl'].includes(String(student.gender || student.genderGroup || 'boys').toLowerCase()))
                            ? 'bg-pink-600 text-white'
                            : 'bg-blue-600 text-white'
                        }`}>
                          {(['female', 'girls', 'girl'].includes(String(student.gender || student.genderGroup || 'boys').toLowerCase())) ? 'GIRLS' : 'BOYS'}
                        </Badge>
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        {student.collegeId || student.registrationNumber || 'N/A'} • {student.department || 'Student'}
                      </div>
                    </div>
                    {isSelected && <CheckCircle2 size={16} className="text-teal-600 shrink-0" />}
                  </div>
                );
              })
            )}
          </div>

          {selectedStudent && (
            <div className="p-3 bg-teal-50 border border-teal-200 rounded-2xl text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-extrabold text-teal-700 block">Selected Candidate</span>
                <Badge className={`text-[10px] font-mono font-extrabold px-2 py-0.5 ${
                  (['female', 'girls', 'girl'].includes(String(selectedStudent.gender || selectedStudent.genderGroup || 'boys').toLowerCase()))
                    ? 'bg-pink-600 text-white'
                    : 'bg-blue-600 text-white'
                }`}>
                  {(['female', 'girls', 'girl'].includes(String(selectedStudent.gender || selectedStudent.genderGroup || 'boys').toLowerCase())) ? 'GIRLS GROUP' : 'BOYS GROUP'}
                </Badge>
              </div>
              <div className="font-extrabold text-navy text-sm">{selectedStudent.name || selectedStudent.full_name}</div>
              <div className="text-[11px] text-teal-800 font-mono">
                {selectedStudent.collegeId || selectedStudent.registrationNumber || 'N/A'} • {selectedStudent.email}
              </div>
            </div>
          )}
        </Card>

        {/* STEP 2 & 3: DATE, SLOT & WALK-IN SEATS MATRIX */}
        <Card className="border border-slate-200/90 bg-white rounded-3xl p-5 shadow-xs space-y-5 lg:col-span-2">
          <h2 className="text-sm font-extrabold text-navy uppercase tracking-wider flex items-center justify-between border-b border-slate-100 pb-3">
            <span className="flex items-center gap-2"><Armchair size={18} className="text-teal-600" /> 2. Date, Slot & Walk-In Seat Selection</span>
            <Badge className="bg-amber-100 text-amber-800 border-amber-300 font-mono text-[10px] font-bold">
              Walk-In Pool Only
            </Badge>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Date Selector */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block flex items-center gap-1">
                <Calendar size={12} /> Allocation Date
              </label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full h-11 bg-slate-50 border border-slate-300 text-navy font-bold text-xs rounded-2xl px-3 font-mono min-h-[44px]"
              />
            </div>

            {/* Slot Selector */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block flex items-center gap-1">
                <Clock size={12} /> Time Slot
              </label>
              <select
                value={selectedSlotId}
                onChange={(e) => setSelectedSlotId(e.target.value)}
                className="w-full h-11 bg-slate-50 border border-slate-300 text-navy font-bold text-xs rounded-2xl px-3 font-mono min-h-[44px]"
              >
                {slots.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({formatSlotTime(s.startTime || s.start_time)} – {formatSlotTime(s.endTime || s.end_time)})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* DEDICATED SEAT POOL S-41 TO S-50 SELECTION MATRIX */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-extrabold text-navy uppercase text-[10px] tracking-wider">
                Select Walk-In Pool Desk (S-41 to S-50):
              </span>
              {selectedStudent ? (
                <Badge className={`text-[10px] font-mono font-bold px-2 py-0.5 ${
                  (['female', 'girls', 'girl'].includes(String(selectedStudent.gender || selectedStudent.genderGroup || 'boys').toLowerCase()))
                    ? 'bg-pink-600 text-white'
                    : 'bg-blue-600 text-white'
                }`}>
                  Showing {(['female', 'girls', 'girl'].includes(String(selectedStudent.gender || selectedStudent.genderGroup || 'boys').toLowerCase())) ? 'GIRLS' : 'BOYS'} Seats Only
                </Badge>
              ) : (
                <span className="text-[11px] text-amber-700 font-mono font-bold">10 Desk Pool</span>
              )}
            </div>

            {loadingSeats ? (
              <div className="p-8 text-center text-xs text-slate-400 font-mono animate-pulse">Loading walk-in seats S-41 to S-50 from Supabase...</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {walkInSeats.filter(seat => {
                  if (!selectedStudent) return true;
                  const candidateGender = (['female', 'girls', 'girl'].includes(String(selectedStudent.gender || selectedStudent.genderGroup || 'boys').toLowerCase())) ? 'girls' : 'boys';
                  const seatNum = parseInt(String(seat.seat_number || seat.seatNumber || '').replace(/\D+/g, ''), 10) || 41;
                  const seatGender = String(seat.gender_group || seat.genderGroup || (seatNum <= 45 ? 'boys' : 'girls')).toLowerCase();
                  return seatGender === candidateGender;
                }).map(seat => {
                  const isSelected = String(selectedSeatId) === String(seat.id) || String(selectedSeatId) === String(seat.seat_number);
                  const isAvailable = seat.computed_status === 'available';
                  const isCheckedIn = seat.computed_status === 'checked_in';
                  const isAllocated = seat.computed_status === 'allocated';
                  const isMaintenance = seat.computed_status === 'maintenance';

                  return (
                    <button
                      key={seat.id}
                      type="button"
                      disabled={!isAvailable}
                      onClick={() => setSelectedSeatId(seat.id)}
                      className={`
                        h-16 rounded-2xl border flex flex-col items-center justify-center p-2 text-xs font-bold transition-all shadow-xs relative min-h-[44px]
                        ${!isAvailable
                          ? isMaintenance
                            ? 'bg-rose-100 text-rose-800 border-rose-300 cursor-not-allowed'
                            : isCheckedIn
                              ? 'bg-teal-600 text-white border-teal-700 cursor-not-allowed'
                              : 'bg-blue-100 text-blue-800 border-blue-300 cursor-not-allowed'
                          : isSelected
                            ? 'bg-amber-500 text-white border-amber-600 ring-4 ring-amber-500/30 scale-105 shadow-md'
                            : 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100 hover:border-amber-400'
                        }
                      `}
                    >
                      <span className="font-mono font-black text-sm">{seat.seat_number || seat.seatNumber}</span>
                      <span className="text-[9px] font-normal opacity-90">
                        {isMaintenance ? 'Maintenance' : isCheckedIn ? 'Checked-In' : isAllocated ? 'Allocated' : 'Available'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* ALLOCATION OPTIONS & CONFIRM BUTTON */}
          <div className="pt-4 border-t border-slate-100 space-y-4">
            <label className="flex items-center gap-2 text-xs font-bold text-navy cursor-pointer">
              <input
                type="checkbox"
                checked={autoCheckIn}
                onChange={(e) => setAutoCheckIn(e.target.checked)}
                className="w-4 h-4 rounded text-teal-600 focus:ring-teal-500"
              />
              <span>Perform Instant Check-In (Activate Seat Pass Immediately)</span>
            </label>

            <Button
              type="button"
              disabled={loading || !selectedStudent || !selectedSeatId}
              onClick={handleCreateWalkIn}
              className="w-full bg-teal-600 hover:bg-teal-700 text-white font-extrabold text-xs h-11 rounded-2xl shadow-md flex items-center justify-center gap-2 disabled:opacity-50 min-h-[44px]"
            >
              {loading ? (
                <span className="flex items-center gap-2 font-mono">
                  <RefreshCw size={14} className="animate-spin" /> Executing Supabase RPC...
                </span>
              ) : (
                <>
                  <UserPlus size={16} /> Confirm & Allocate Walk-In Seat →
                </>
              )}
            </Button>
          </div>
        </Card>
      </div>

      {/* WALK-IN ALLOCATION HISTORY SECTION */}
      <Card className="border border-slate-200/90 bg-white rounded-3xl p-6 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-base font-black text-navy flex items-center gap-2">
              <History size={18} className="text-teal-600" /> Walk-In Allocation History
            </h2>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Permanent audit records of walk-in seat passes issued by desk staff.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-48 sm:w-64">
              <Search size={14} className="absolute left-3 top-3 text-slate-400" />
              <input
                type="text"
                placeholder="Search student, seat..."
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                className="w-full h-9 pl-9 pr-3 rounded-2xl border border-slate-300 text-xs font-medium bg-slate-50 min-h-[44px]"
              />
            </div>
          </div>
        </div>

        {filteredHistory.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400 font-mono">No walk-in allocation records found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                  <th className="p-4">Pass Code</th>
                  <th className="p-4">Student</th>
                  <th className="p-4">Seat</th>
                  <th className="p-4">Date & Slot</th>
                  <th className="p-4">Allocated By</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredHistory.map(b => (
                  <tr key={b.id} className="hover:bg-slate-50 text-slate-700">
                    <td className="p-4 font-mono font-bold text-teal-600">{b.bookingCode || b.booking_code}</td>
                    <td className="p-4 font-bold text-navy">
                      <div>{b.studentName || b.student_name}</div>
                      <span className="text-[10px] font-mono text-slate-500">{b.studentRegistrationNumber || b.registration_number || 'N/A'}</span>
                    </td>
                    <td className="p-4 font-mono font-extrabold text-amber-700">{b.seatNumber || b.seat_number}</td>
                    <td className="p-4 font-mono text-slate-600">{b.bookingDate || b.booking_date} ({b.slotName || b.slot_name || 'Slot'})</td>
                    <td className="p-4 text-slate-600">{b.allocatedByName || b.allocatedBy || 'Staff Librarian'}</td>
                    <td className="p-4">
                      <Badge className={`text-[10px] font-bold ${
                        String(b.status).toLowerCase() === 'checked_in' ? 'bg-teal-600 text-white' : 'bg-emerald-600 text-white'
                      }`}>
                        {String(b.status).toUpperCase()}
                      </Badge>
                    </td>
                    <td className="p-4 font-mono text-[11px] text-slate-400">
                      {new Date(b.createdAt || b.created_at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* CONFIRMATION RESULT DIALOG */}
      {bookingResult && (
        <Dialog open={!!bookingResult} onOpenChange={() => setBookingResult(null)}>
          <DialogContent className="max-w-md bg-white border border-slate-200 text-navy p-6 rounded-3xl space-y-4 shadow-2xl">
            <DialogHeader className="space-y-1 text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-2">
                <CheckCircle2 size={24} />
              </div>
              <DialogTitle className="text-xl font-black text-navy">Walk-In Pass Generated</DialogTitle>
              <DialogDescription className="text-xs text-slate-500 font-medium">
                Seat pass created and activated for walk-in student.
              </DialogDescription>
            </DialogHeader>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-slate-500">Pass Code:</span>
                <strong className="text-teal-600 font-extrabold">{bookingResult.bookingCode || bookingResult.booking_code}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Student:</span>
                <strong className="text-navy">{bookingResult.studentName}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Allocated Seat:</span>
                <strong className="text-amber-700 font-extrabold">{bookingResult.seatNumber} (Walk-In Pool)</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Date & Slot:</span>
                <strong className="text-slate-800">{bookingResult.bookingDate} ({bookingResult.slotName})</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Allocated By:</span>
                <strong className="text-indigo-600 font-bold">{bookingResult.allocatedByName || 'Staff Librarian'}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Source Standing:</span>
                <span className="text-amber-700 font-bold bg-amber-100/80 px-2 py-0.5 rounded">Walk-In • Allocated by Librarian</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Cancellation:</span>
                <span className="text-rose-700 font-bold bg-rose-100/80 px-2 py-0.5 rounded">Non-cancellable</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Initial Status:</span>
                <strong className="text-emerald-600 uppercase font-bold">{bookingResult.status}</strong>
              </div>
            </div>

            <Button
              onClick={() => setBookingResult(null)}
              className="w-full bg-navy hover:bg-slate-900 text-white font-bold text-xs h-11 rounded-2xl min-h-[44px]"
            >
              Done & Issue Pass →
            </Button>
          </DialogContent>
        </Dialog>
      )}

    </div>
  );
}
