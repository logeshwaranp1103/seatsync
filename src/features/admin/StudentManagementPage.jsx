import React, { useEffect, useState, useCallback, useRef } from 'react';
import { supabase, isUUID } from '../../lib/supabase';
import { authService } from '../../services/authService';
import { useAuth } from '../../auth/AuthProvider';
import { Card, CardContent } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Input } from '../../components/shared/Input';
import { Label } from '../../components/shared/Label';
import { Badge } from '../../components/shared/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/shared/Dialog';
import {
  Users, UserX, ShieldAlert, ShieldCheck, Search, Filter, RefreshCw, Plus,
  Download, FileSpreadsheet, FileText, Calendar, Clock, AlertTriangle, CheckCircle2, Info
} from 'lucide-react';
import toast from 'react-hot-toast';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export default function StudentManagementPage() {
  const { user: currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState('all'); // 'all' | 'blocked' | 'history'

  // Data States
  const [students, setStudents] = useState([]);
  const [blockHistory, setBlockHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Search & Filters
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Modals
  const [blockModalOpen, setBlockModalOpen] = useState(false);
  const [unblockModalOpen, setUnblockModalOpen] = useState(false);

  // Selected Target Student for Action
  const [selectedStudent, setSelectedStudent] = useState(null);

  // Form States
  const [blockForm, setBlockForm] = useState({
    reason: '',
    category: 'Policy violation',
    durationType: 'manual', // 'manual' | 'date'
    expiresAt: ''
  });

  const [unblockForm, setUnblockForm] = useState({
    unblockReason: ''
  });

  const isMountedRef = useRef(true);

  // Fetch Students & Active Bookings Count
  const fetchStudentData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // 1. Fetch Student Profiles via aggregate getStudentAccessManagement RPC
      const studentProfiles = await authService.getStudentAccessManagement();

      // 2. Fetch Active Bookings count per student
      const { data: activeBookings } = await supabase
        .from('bookings')
        .select('student_id')
        .in('status', ['confirmed', 'awaiting_check_in', 'checked_in']);

      const bookingCounts = new Map();
      (activeBookings || []).forEach(b => {
        if (b.student_id) {
          bookingCounts.set(b.student_id, (bookingCounts.get(b.student_id) || 0) + 1);
        }
      });

      const formatted = studentProfiles.map(s => ({
        ...s,
        activeBookingsCount: bookingCounts.get(s.id) || 0
      }));

      if (isMountedRef.current) {
        setStudents(formatted);
      }

      // 3. Fetch Full Block History Report
      const historyReport = await authService.getStudentAccessBlockReport();
      if (isMountedRef.current) {
        setBlockHistory(historyReport || []);
      }
    } catch (err) {
      console.error('Failed to load student management data:', err);
      if (isMountedRef.current) {
        setError(err.message || 'Unable to fetch student records.');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  function LOWER_STATUS(s) {
    return String(s || 'active').toLowerCase();
  }

  useEffect(() => {
    isMountedRef.current = true;
    fetchStudentData();

    // Supabase Realtime Subscription
    const channel = supabase
      .channel('student_management_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => fetchStudentData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_restrictions' }, () => fetchStudentData())
      .subscribe();

    return () => {
      isMountedRef.current = false;
      supabase.removeChannel(channel);
    };
  }, [fetchStudentData]);

  // Action Handlers
  const handleOpenBlockModal = (student) => {
    setSelectedStudent(student);
    setBlockForm({
      reason: '',
      category: 'Policy violation',
      durationType: 'manual',
      expiresAt: ''
    });
    setBlockModalOpen(true);
  };

  const handleBlockSubmit = async (e) => {
    e.preventDefault();
    if (!selectedStudent) return;

    const cleanReason = blockForm.reason.trim();
    if (!cleanReason) {
      toast.error('Reason for blocking access is required.');
      return;
    }

    try {
      await authService.blockStudentAccess({
        studentId: selectedStudent.id,
        reason: cleanReason,
        category: blockForm.category,
        expiresAt: blockForm.durationType === 'date' && blockForm.expiresAt ? blockForm.expiresAt : null
      });

      toast.success(`Access blocked for ${selectedStudent.name}.`);
      setBlockModalOpen(false);
      fetchStudentData();
    } catch (err) {
      toast.error(err.message || 'Failed to block student access.');
    }
  };

  const handleOpenUnblockModal = (student) => {
    setSelectedStudent(student);
    setUnblockForm({ unblockReason: 'Student completed counselling & warning acknowledged.' });
    setUnblockModalOpen(true);
  };

  const handleUnblockSubmit = async (e) => {
    e.preventDefault();
    if (!selectedStudent) return;

    const cleanReason = unblockForm.unblockReason.trim();
    if (!cleanReason) {
      toast.error('Resolution reason is required.');
      return;
    }

    try {
      await authService.unblockStudentAccess({
        studentId: selectedStudent.id,
        unblockReason: cleanReason
      });

      toast.success(`Access restored for ${selectedStudent.name}. Account is now active.`);
      setUnblockModalOpen(false);
      fetchStudentData();
    } catch (err) {
      toast.error(err.message || 'Failed to unblock student access.');
    }
  };

  // Filter Logic
  const filteredStudents = students.filter(s => {
    // Tab Filter
    if (activeTab === 'blocked' && s.accountStatus !== 'blocked' && !s.isBlocked) return false;

    // Search Filter
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchName = (s.name || '').toLowerCase().includes(q);
      const matchReg = (s.registrationNumber || '').toLowerCase().includes(q);
      const matchEmail = (s.email || '').toLowerCase().includes(q);
      const matchDept = (s.department || '').toLowerCase().includes(q);
      if (!matchName && !matchReg && !matchEmail && !matchDept) return false;
    }

    // Department Filter
    if (departmentFilter !== 'all' && (s.department || '').toLowerCase() !== departmentFilter.toLowerCase()) {
      return false;
    }

    // Status Filter
    if (statusFilter !== 'all' && s.accountStatus !== statusFilter) {
      return false;
    }

    return true;
  });

  const filteredHistory = blockHistory.filter(h => {
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchName = (h.studentName || '').toLowerCase().includes(q);
      const matchReg = (h.registrationNumber || '').toLowerCase().includes(q);
      const matchReason = (h.blockReason || '').toLowerCase().includes(q);
      if (!matchName && !matchReg && !matchReason) return false;
    }

    if (statusFilter !== 'all' && h.blockStatus !== statusFilter) return false;
    if (categoryFilter !== 'all' && (h.blockCategory || '').toLowerCase() !== categoryFilter.toLowerCase()) return false;
    if (departmentFilter !== 'all' && (h.department || '').toLowerCase() !== departmentFilter.toLowerCase()) return false;

    if (fromDate && h.blockedAt && new Date(h.blockedAt) < new Date(fromDate)) return false;
    if (toDate && h.blockedAt && new Date(h.blockedAt) > new Date(toDate + 'T23:59:59')) return false;

    return true;
  });

  // Summary Counts
  const counts = {
    total: students.length,
    active: students.filter(s => s.accountStatus === 'active' && !s.isBlocked).length,
    blocked: students.filter(s => s.accountStatus === 'blocked' || s.isBlocked).length,
    historyTotal: blockHistory.length
  };

  // CSV Export Handler
  const handleExportCSV = () => {
    try {
      const timestamp = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata' });
      const recordsToExport = activeTab === 'history' ? filteredHistory : filteredStudents.map(s => ({
        studentName: s.name,
        registrationNumber: s.registrationNumber,
        email: s.email,
        department: s.department,
        currentAccountStatus: s.accountStatus,
        blockStatus: s.accountStatus === 'blocked' ? 'active' : 'none',
        blockCategory: s.latestRestriction?.category || 'N/A',
        blockReason: s.blockedReason || 'N/A',
        blockedByName: 'Library Staff',
        blockedAt: s.blockedAt || 'N/A',
        expiresAt: 'N/A',
        unblockedByName: 'N/A',
        unblockedAt: 'N/A',
        unblockReason: 'N/A',
        duration: 'N/A'
      }));

      if (recordsToExport.length === 0) {
        toast.error('No data available to export.');
        return;
      }

      const headers = [
        'Student Name',
        'Registration Number',
        'Email',
        'Department',
        'Current Status',
        'Block Status',
        'Category',
        'Block Reason',
        'Blocked By',
        'Blocked At',
        'Expiry Date',
        'Unblocked By',
        'Unblocked At',
        'Unblock Reason',
        'Duration'
      ];

      const rows = recordsToExport.map(r => [
        `"${(r.studentName || '').replace(/"/g, '""')}"`,
        `"${(r.registrationNumber || '').replace(/"/g, '""')}"`,
        `"${(r.email || '').replace(/"/g, '""')}"`,
        `"${(r.department || '').replace(/"/g, '""')}"`,
        `"${(r.currentAccountStatus || r.accountStatus || '').toUpperCase()}"`,
        `"${(r.blockStatus || '').toUpperCase()}"`,
        `"${(r.blockCategory || '').replace(/"/g, '""')}"`,
        `"${(r.blockReason || '').replace(/"/g, '""')}"`,
        `"${(r.blockedByName || '').replace(/"/g, '""')}"`,
        `"${r.blockedAt ? new Date(r.blockedAt).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata' }) : 'N/A'}"`,
        `"${r.expiresAt ? new Date(r.expiresAt).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata' }) : 'N/A'}"`,
        `"${(r.unblockedByName || 'N/A').replace(/"/g, '""')}"`,
        `"${r.unblockedAt ? new Date(r.unblockedAt).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata' }) : 'N/A'}"`,
        `"${(r.unblockReason || 'N/A').replace(/"/g, '""')}"`,
        `"${r.duration || 'N/A'}"`
      ]);

      const csvContent = [
        `SeatSync Student Access Management Report - Exported at ${timestamp}`,
        headers.join(','),
        ...rows.map(row => row.join(','))
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `SeatSync_Student_Access_Report_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast.success('CSV Report downloaded successfully!');
    } catch (err) {
      toast.error('Failed to export CSV: ' + err.message);
    }
  };

  // PDF Export Handler
  const handleExportPDF = () => {
    try {
      const timestamp = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata' });
      const doc = new jsPDF('landscape');

      // Title & Header
      doc.setFontSize(18);
      doc.setTextColor(15, 23, 42); // Navy
      doc.text('SeatSync Student Access & Restriction Report', 14, 18);

      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.text(`Generated on: ${timestamp} (Asia/Kolkata) | Total Students: ${counts.total} | Active: ${counts.active} | Blocked: ${counts.blocked}`, 14, 25);

      const recordsToExport = activeTab === 'history' ? filteredHistory : filteredStudents.map(s => ({
        studentName: s.name,
        registrationNumber: s.registrationNumber,
        department: s.department,
        currentAccountStatus: s.accountStatus,
        blockStatus: s.accountStatus === 'blocked' ? 'active' : 'none',
        blockCategory: s.latestRestriction?.category || 'N/A',
        blockReason: s.blockedReason || 'N/A',
        blockedByName: 'Library Staff',
        blockedAt: s.blockedAt || 'N/A',
        unblockReason: 'N/A'
      }));

      if (recordsToExport.length === 0) {
        toast.error('No data available to export.');
        return;
      }

      const tableHeaders = [
        ['Student Name', 'Reg No', 'Dept', 'Status', 'Category', 'Block Reason', 'Blocked By', 'Blocked At', 'Resolution Notes']
      ];

      const tableData = recordsToExport.map(r => [
        r.studentName || 'N/A',
        r.registrationNumber || 'N/A',
        r.department || 'General',
        (r.currentAccountStatus || r.accountStatus || '').toUpperCase(),
        r.blockCategory || 'N/A',
        r.blockReason || 'N/A',
        r.blockedByName || 'Library Staff',
        r.blockedAt ? new Date(r.blockedAt).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' }) : 'N/A',
        r.unblockReason || 'N/A'
      ]);

      autoTable(doc, {
        startY: 30,
        head: tableHeaders,
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
        bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { top: 30, left: 14, right: 14 }
      });

      doc.save(`SeatSync_Student_Access_Report_${Date.now()}.pdf`);
      toast.success('PDF Report downloaded successfully!');
    } catch (err) {
      toast.error('Failed to export PDF: ' + err.message);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300 pb-12">
      {/* PAGE HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
            <Users className="text-teal-600" size={28} /> Student Access Management
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Real-time student account management, access restriction enforcement, and block history auditing.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={fetchStudentData} variant="outline" className="border-slate-300 text-slate-600 hover:bg-slate-100 text-xs font-bold rounded-xl h-9">
            <RefreshCw size={14} className={`mr-1.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button onClick={handleExportCSV} variant="outline" className="border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-bold rounded-xl h-9">
            <FileSpreadsheet size={14} className="mr-1.5 text-emerald-600" /> Export CSV
          </Button>
          <Button onClick={handleExportPDF} className="bg-navy hover:bg-slate-800 text-white font-bold text-xs rounded-xl h-9">
            <FileText size={14} className="mr-1.5 text-rose-400" /> Download PDF
          </Button>
        </div>
      </div>

      {/* SUMMARY STAT CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border border-slate-200 bg-white rounded-2xl p-4 shadow-xs">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Total Registered</p>
          {loading ? (
            <div className="h-8 w-16 bg-slate-200 animate-pulse rounded-lg mt-1" />
          ) : (
            <p className="text-2xl font-black text-navy mt-1">{counts.total}</p>
          )}
        </Card>
        <Card className="border border-emerald-200 bg-emerald-50/50 rounded-2xl p-4 shadow-xs">
          <p className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">Active Access</p>
          {loading ? (
            <div className="h-8 w-16 bg-emerald-200/60 animate-pulse rounded-lg mt-1" />
          ) : (
            <p className="text-2xl font-black text-emerald-700 mt-1">{counts.active}</p>
          )}
        </Card>
        <Card className="border border-rose-200 bg-rose-50/50 rounded-2xl p-4 shadow-xs">
          <p className="text-[11px] font-bold text-rose-700 uppercase tracking-wider">Currently Blocked</p>
          {loading ? (
            <div className="h-8 w-16 bg-rose-200/60 animate-pulse rounded-lg mt-1" />
          ) : (
            <p className="text-2xl font-black text-rose-700 mt-1">{counts.blocked}</p>
          )}
        </Card>
        <Card className="border border-indigo-200 bg-indigo-50/50 rounded-2xl p-4 shadow-xs">
          <p className="text-[11px] font-bold text-indigo-700 uppercase tracking-wider">Total Block Events</p>
          {loading ? (
            <div className="h-8 w-16 bg-indigo-200/60 animate-pulse rounded-lg mt-1" />
          ) : (
            <p className="text-2xl font-black text-indigo-700 mt-1">{counts.historyTotal}</p>
          )}
        </Card>
      </div>

      {/* TABS NAVIGATION */}
      <div className="flex border-b border-slate-200 gap-6 text-xs font-bold text-slate-500">
        <button
          onClick={() => setActiveTab('all')}
          className={`pb-3 border-b-2 transition-all flex items-center gap-1.5 ${
            activeTab === 'all' ? 'border-teal-600 text-teal-700 font-extrabold' : 'border-transparent hover:text-navy'
          }`}
        >
          <Users size={15} /> All Students ({counts.total})
        </button>
        <button
          onClick={() => setActiveTab('blocked')}
          className={`pb-3 border-b-2 transition-all flex items-center gap-1.5 ${
            activeTab === 'blocked' ? 'border-rose-600 text-rose-700 font-extrabold' : 'border-transparent hover:text-navy'
          }`}
        >
          <ShieldAlert size={15} /> Currently Blocked ({counts.blocked})
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`pb-3 border-b-2 transition-all flex items-center gap-1.5 ${
            activeTab === 'history' ? 'border-indigo-600 text-indigo-700 font-extrabold' : 'border-transparent hover:text-navy'
          }`}
        >
          <Clock size={15} /> Block Lifecycle History ({counts.historyTotal})
        </button>
      </div>

      {/* SEARCH AND MULTI-CRITERIA FILTERS BAR */}
      <Card className="border border-slate-200 bg-white rounded-2xl p-4 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              type="text"
              placeholder="Search student name, registration number, email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-10 text-xs rounded-xl border-slate-300 text-navy"
            />
          </div>

          <div className="flex items-center gap-2">
            <Label className="text-xs font-bold text-slate-500 flex items-center gap-1">
              <Filter size={13} /> Dept:
            </Label>
            <select
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className="h-10 rounded-xl border border-slate-300 px-3 text-xs font-semibold bg-white text-navy"
            >
              <option value="all">All Departments</option>
              <option value="Computer Science & Engineering">Computer Science & Eng</option>
              <option value="Information Technology">Information Tech</option>
              <option value="Electrical & Electronics">Electrical Eng</option>
              <option value="Mechanical Engineering">Mechanical Eng</option>
            </select>
          </div>

          {activeTab !== 'blocked' && (
            <div className="flex items-center gap-2">
              <Label className="text-xs font-bold text-slate-500">Status:</Label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-10 rounded-xl border border-slate-300 px-3 text-xs font-semibold bg-white text-navy"
              >
                <option value="all">All Statuses</option>
                <option value="active">Active Only</option>
                <option value="blocked">Blocked Only</option>
                <option value="resolved">Resolved History</option>
              </select>
            </div>
          )}

          {activeTab === 'history' && (
            <div className="flex items-center gap-2">
              <Label className="text-xs font-bold text-slate-500">Category:</Label>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="h-10 rounded-xl border border-slate-300 px-3 text-xs font-semibold bg-white text-navy"
              >
                <option value="all">All Categories</option>
                <option value="Repeated no-show">Repeated no-show</option>
                <option value="Misconduct">Misconduct</option>
                <option value="Policy violation">Policy violation</option>
                <option value="Damage to property">Damage to property</option>
                <option value="Unpaid penalty">Unpaid penalty</option>
                <option value="Other">Other</option>
              </select>
            </div>
          )}
        </div>
      </Card>

      {/* ERROR BANNER */}
      {error && (
        <Card className="border border-rose-300 bg-rose-50 rounded-2xl p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="text-rose-600 shrink-0" size={24} />
            <div>
              <p className="text-sm font-bold text-rose-900">Data Fetching Warning</p>
              <p className="text-xs text-rose-700 mt-0.5">{error}</p>
            </div>
          </div>
          <Button onClick={fetchStudentData} className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl h-9">
            <RefreshCw size={14} className="mr-1.5" /> Retry
          </Button>
        </Card>
      )}

      {/* MAIN DATA TABLES */}
      <Card className="border border-slate-200 rounded-2xl shadow-xs overflow-hidden bg-white">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 text-center text-xs font-medium text-slate-400 flex flex-col items-center justify-center gap-2">
              <RefreshCw size={24} className="animate-spin text-teal-600" />
              <span>Fetching student access records from database...</span>
            </div>
          ) : activeTab === 'history' ? (
            /* BLOCK HISTORY TABLE */
            filteredHistory.length === 0 ? (
              <div className="p-12 text-center text-xs text-slate-400 font-medium">
                No block lifecycle records found matching the selected filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                      <th className="p-3.5">Student Details</th>
                      <th className="p-3.5">Category & Reason</th>
                      <th className="p-3.5">Block State</th>
                      <th className="p-3.5">Blocked By / Date</th>
                      <th className="p-3.5">Resolution Notes</th>
                      <th className="p-3.5">Unblocked By / Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-sans">
                    {filteredHistory.map(h => (
                      <tr key={h.blockRecordId} className="hover:bg-slate-50 transition-colors">
                        <td className="p-3.5">
                          <p className="font-bold text-navy text-sm">{h.studentName}</p>
                          <p className="text-[11px] text-slate-500 font-mono">{h.registrationNumber} • {h.department}</p>
                          <p className="text-[10px] text-slate-400">{h.email}</p>
                        </td>
                        <td className="p-3.5">
                          <Badge className="bg-slate-100 text-slate-700 font-bold text-[10px] mb-1">
                            {h.blockCategory || 'Policy violation'}
                          </Badge>
                          <p className="font-medium text-slate-800 text-[11px] line-clamp-2">{h.blockReason}</p>
                        </td>
                        <td className="p-3.5">
                          <Badge className={`font-bold text-[10px] ${
                            h.blockStatus === 'active' ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'
                          }`}>
                            {h.blockStatus === 'active' ? 'Active Block' : 'Resolved'}
                          </Badge>
                        </td>
                        <td className="p-3.5">
                          <p className="font-semibold text-slate-700">{h.blockedByName}</p>
                          <p className="text-[10px] text-slate-400 font-mono">
                            {h.blockedAt ? new Date(h.blockedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : 'N/A'}
                          </p>
                        </td>
                        <td className="p-3.5">
                          {h.unblockReason ? (
                            <p className="text-[11px] text-teal-800 font-medium bg-teal-50 p-2 rounded-lg border border-teal-100">
                              ✓ {h.unblockReason}
                            </p>
                          ) : (
                            <span className="text-slate-400 text-[11px] italic">Block active (unresolved)</span>
                          )}
                        </td>
                        <td className="p-3.5">
                          {h.unblockedByName ? (
                            <div>
                              <p className="font-semibold text-slate-700">{h.unblockedByName}</p>
                              <p className="text-[10px] text-slate-400 font-mono">
                                {h.unblockedAt ? new Date(h.unblockedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : 'N/A'}
                              </p>
                            </div>
                          ) : (
                            <span className="text-slate-400 text-[11px]">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            /* ALL STUDENTS & CURRENTLY BLOCKED TABLE */
            filteredStudents.length === 0 ? (
              <div className="p-12 text-center text-xs text-slate-400 font-medium">
                No student profiles found matching the criteria.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                      <th className="p-3.5">Student Information</th>
                      <th className="p-3.5">Department & Year</th>
                      <th className="p-3.5">Account Access Status</th>
                      <th className="p-3.5">Active Bookings</th>
                      <th className="p-3.5">Previous Blocks</th>
                      <th className="p-3.5">Latest Block Details</th>
                      <th className="p-3.5 text-right">Access Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-sans">
                    {filteredStudents.map(s => (
                      <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                        <td className="p-3.5">
                          <p className="font-bold text-navy text-sm">{s.name}</p>
                          <p className="text-[11px] text-slate-500 font-mono">{s.registrationNumber}</p>
                          <p className="text-[10px] text-slate-400">{s.email}</p>
                        </td>
                        <td className="p-3.5">
                          <p className="font-semibold text-slate-700">{s.department}</p>
                          <p className="text-[10px] text-slate-400">Year {s.yearOfStudy}</p>
                        </td>
                        <td className="p-3.5">
                          {s.accountStatus === 'blocked' ? (
                            <Badge className="bg-rose-600 text-white font-bold text-[10px]">Access Blocked</Badge>
                          ) : (
                            <Badge className="bg-emerald-600 text-white font-bold text-[10px]">Active</Badge>
                          )}
                        </td>
                        <td className="p-3.5">
                          {s.activeBookingsCount > 0 ? (
                            <span className="font-bold text-brandBlue bg-blue-50 px-2 py-0.5 rounded text-[11px]">
                              {s.activeBookingsCount} active
                            </span>
                          ) : (
                            <span className="text-slate-400">0 active</span>
                          )}
                        </td>
                        <td className="p-3.5 font-mono">
                          {s.previousBlocksCount > 0 ? (
                            <span className="font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded text-[11px]">
                              {s.previousBlocksCount} events
                            </span>
                          ) : (
                            <span className="text-slate-400">0</span>
                          )}
                        </td>
                        <td className="p-3.5">
                          {s.accountStatus === 'blocked' ? (
                            <div>
                              <p className="font-bold text-rose-800 text-[11px] line-clamp-1">{s.blockedReason || 'Policy violation'}</p>
                              <p className="text-[10px] text-slate-400">
                                Blocked: {s.blockedAt ? new Date(s.blockedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' }) : 'N/A'}
                              </p>
                            </div>
                          ) : (
                            <span className="text-slate-400 text-[11px]">No active restrictions</span>
                          )}
                        </td>
                        <td className="p-3.5 text-right font-sans">
                          {s.accountStatus === 'blocked' ? (
                            <Button
                              onClick={() => handleOpenUnblockModal(s)}
                              className="h-8 text-[11px] font-bold rounded-xl bg-teal-600 hover:bg-teal-700 text-white shadow-xs"
                            >
                              <ShieldCheck size={13} className="mr-1" /> Unblock Access
                            </Button>
                          ) : (
                            <Button
                              onClick={() => handleOpenBlockModal(s)}
                              variant="outline"
                              className="h-8 text-[11px] font-bold rounded-xl border-rose-300 text-rose-700 hover:bg-rose-50"
                            >
                              <UserX size={13} className="mr-1" /> Block Access
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </CardContent>
      </Card>

      {/* BLOCK STUDENT MODAL */}
      <Dialog open={blockModalOpen} onOpenChange={setBlockModalOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl p-6 bg-white text-navy">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-navy flex items-center gap-2">
              <UserX size={20} className="text-rose-600" /> Block Student Access
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 pt-1">
              Restrict student from accessing SeatSync Student dashboard & booking features.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleBlockSubmit} className="space-y-4 pt-2">
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs space-y-1">
              <p className="font-bold text-navy text-sm">{selectedStudent?.name}</p>
              <p className="text-slate-500 font-mono">Reg No: {selectedStudent?.registrationNumber} • {selectedStudent?.email}</p>
              {selectedStudent?.activeBookingsCount > 0 && (
                <p className="text-amber-700 font-semibold pt-1 flex items-center gap-1 text-[11px]">
                  <AlertTriangle size={12} /> Student currently has {selectedStudent.activeBookingsCount} active bookings.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Reason for Blocking (Required)</Label>
              <textarea
                value={blockForm.reason}
                onChange={(e) => setBlockForm({ ...blockForm, reason: e.target.value })}
                placeholder="Enter exact violation reason (e.g. Repeated no-shows without cancellation, damage to reading carrel, misconduct)..."
                rows={3}
                className="w-full rounded-xl border border-slate-300 p-3 text-xs bg-white text-navy focus:ring-2 focus:ring-rose-500"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Violation Category</Label>
              <select
                value={blockForm.category}
                onChange={(e) => setBlockForm({ ...blockForm, category: e.target.value })}
                className="w-full h-10 rounded-xl border border-slate-300 px-3 text-xs font-semibold bg-white text-navy"
              >
                <option value="Repeated no-show">Repeated no-show</option>
                <option value="Misconduct">Misconduct</option>
                <option value="Policy violation">Policy violation</option>
                <option value="Damage to property">Damage to property</option>
                <option value="Unpaid penalty">Unpaid penalty</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Block Duration</Label>
              <select
                value={blockForm.durationType}
                onChange={(e) => setBlockForm({ ...blockForm, durationType: e.target.value })}
                className="w-full h-10 rounded-xl border border-slate-300 px-3 text-xs font-semibold bg-white text-navy"
              >
                <option value="manual">Until manually unblocked by staff</option>
                <option value="date">Until specified expiry date</option>
              </select>
            </div>

            {blockForm.durationType === 'date' && (
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700">Expiry Date & Time</Label>
                <Input
                  type="datetime-local"
                  value={blockForm.expiresAt}
                  onChange={(e) => setBlockForm({ ...blockForm, expiresAt: e.target.value })}
                  className="h-10 text-xs font-semibold bg-white border-slate-300 text-navy"
                  required
                />
              </div>
            )}

            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-[11px] text-rose-800 font-medium">
              ⚠️ This student will be signed out immediately and denied access to the Student dashboard.
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setBlockModalOpen(false)} className="rounded-xl text-xs">
                Cancel
              </Button>
              <Button type="submit" className="bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs">
                Block Student
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* UNBLOCK STUDENT MODAL */}
      <Dialog open={unblockModalOpen} onOpenChange={setUnblockModalOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl p-6 bg-white text-navy">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-navy flex items-center gap-2">
              <ShieldCheck size={20} className="text-teal-600" /> Unblock Student Access
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 pt-1">
              Restore login and booking privileges for {selectedStudent?.name}.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleUnblockSubmit} className="space-y-4 pt-2">
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs space-y-1">
              <p className="font-bold text-navy">{selectedStudent?.name}</p>
              <p className="text-slate-500 font-mono">Reg No: {selectedStudent?.registrationNumber}</p>
              <div className="pt-2 border-t border-slate-200 mt-2">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Original Block Reason</span>
                <p className="text-rose-800 font-medium text-xs pt-0.5">
                  "{selectedStudent?.blockedReason || 'Policy violation'}"
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Resolution Reason (Required)</Label>
              <textarea
                value={unblockForm.unblockReason}
                onChange={(e) => setUnblockForm({ ...unblockForm, unblockReason: e.target.value })}
                placeholder="Enter resolution reason (e.g. Student completed counselling, Penalty cleared, Warning acknowledged)..."
                rows={3}
                className="w-full rounded-xl border border-slate-300 p-3 text-xs bg-white text-navy focus:ring-2 focus:ring-teal-500"
                required
              />
            </div>

            <div className="space-y-1">
              <span className="text-[11px] font-bold text-slate-500 block">Quick Example Resolutions:</span>
              <div className="flex flex-wrap gap-1.5">
                {[
                  'Student completed counselling',
                  'Penalty was cleared',
                  'Suspension period completed',
                  'Warning acknowledged'
                ].map(ex => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => setUnblockForm({ unblockReason: ex })}
                    className="text-[10px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1 rounded-lg transition-colors text-left"
                  >
                    + {ex}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-3">
              <Button type="button" variant="outline" onClick={() => setUnblockModalOpen(false)} className="rounded-xl text-xs">
                Cancel
              </Button>
              <Button type="submit" className="bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl text-xs">
                Confirm & Unblock Student
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
