import React, { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { librarianService } from '../../services/librarianService';
import { Card, CardContent } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Input } from '../../components/shared/Input';
import { Label } from '../../components/shared/Label';
import { Badge } from '../../components/shared/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/shared/Dialog';
import {
  Armchair, Plus, Search, RefreshCw, Zap, Sun, Wrench, AlertTriangle,
  CheckCircle2, Clock, ShieldAlert, Filter, AlertCircle, FileText, Check
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function SeatMaintenancePage() {
  const [seats, setSeats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters & Search
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [selectedLibraryId, setSelectedLibraryId] = useState(null);
  const [selectedFloorId, setSelectedFloorId] = useState(null);
  const [selectedRoomId, setSelectedRoomId] = useState(null);

  // Structural options
  const [libraries, setLibraries] = useState([]);
  const [floors, setFloors] = useState([]);
  const [rooms, setRooms] = useState([]);

  // Modals
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [resolveModalOpen, setResolveModalOpen] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);

  // Target Seat for Action
  const [selectedSeat, setSelectedSeat] = useState(null);
  const [selectedMaintenance, setSelectedMaintenance] = useState(null);

  // Form states
  const [reportForm, setReportForm] = useState({
    issueType: 'General Maintenance',
    description: '',
    severity: 'medium',
    expectedResolutionAt: ''
  });

  const [resolveForm, setResolveForm] = useState({
    resolutionNotes: ''
  });

  const [updateForm, setUpdateForm] = useState({
    status: 'in_progress',
    severity: 'medium',
    expectedResolutionAt: ''
  });

  const [newSeat, setNewSeat] = useState({
    seatNumber: '',
    seatType: 'Standard Study Desk',
    hasPowerSocket: true,
    isAccessible: false,
    libraryId: '',
    floorId: '',
    roomId: ''
  });

  const isMountedRef = useRef(true);

  // Load Structure Options
  const loadStructures = useCallback(async () => {
    try {
      const { data: libs } = await supabase.from('libraries').select('id, name');
      const { data: fls } = await supabase.from('floors').select('id, name, library_id');
      const { data: rms } = await supabase.from('rooms').select('id, name, floor_id');

      if (isMountedRef.current) {
        setLibraries(libs || []);
        setFloors(fls || []);
        setRooms(rms || []);

        if (libs && libs.length > 0 && !selectedLibraryId) {
          setSelectedLibraryId(libs[0].id);
          setNewSeat(prev => ({ ...prev, libraryId: libs[0].id }));
        }
        if (fls && fls.length > 0 && !selectedFloorId) {
          setSelectedFloorId(fls[0].id);
          setNewSeat(prev => ({ ...prev, floorId: fls[0].id }));
        }
        if (rms && rms.length > 0 && !selectedRoomId) {
          setSelectedRoomId(rms[0].id);
          setNewSeat(prev => ({ ...prev, roomId: rms[0].id }));
        }
      }
    } catch (err) {
      console.warn('Structure fetch error:', err);
    }
  }, [selectedLibraryId, selectedFloorId, selectedRoomId]);

  // Main Seat Inventory Fetch with Strict Finally Block
  const fetchSeats = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await librarianService.getSeatInventory({
        libraryId: selectedLibraryId,
        floorId: selectedFloorId,
        roomId: selectedRoomId,
        search: search.trim() || null,
        maintenanceStatus: statusFilter !== 'all' ? statusFilter : null
      });

      if (isMountedRef.current) {
        setSeats(data || []);
      }
    } catch (err) {
      console.error('Seat inventory fetch failed:', err);
      if (isMountedRef.current) {
        setError(err.message || 'Unable to load seat inventory.');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [selectedLibraryId, selectedFloorId, selectedRoomId, search, statusFilter]);

  useEffect(() => {
    isMountedRef.current = true;
    loadStructures();
    fetchSeats();

    // Supabase Realtime Subscription
    const channel = supabase
      .channel('seat_maintenance_realtime_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'seats' }, () => fetchSeats())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'seat_maintenance' }, () => fetchSeats())
      .subscribe();

    return () => {
      isMountedRef.current = false;
      supabase.removeChannel(channel);
    };
  }, [fetchSeats, loadStructures]);

  // Action Handlers
  const handleOpenReportModal = (seat) => {
    setSelectedSeat(seat);
    setReportForm({
      issueType: 'General Maintenance',
      description: '',
      severity: 'medium',
      expectedResolutionAt: ''
    });
    setReportModalOpen(true);
  };

  const handleReportSubmit = async (e) => {
    e.preventDefault();
    if (!selectedSeat) return;
    if (!reportForm.description.trim()) {
      toast.error('Please enter problem description.');
      return;
    }

    try {
      await librarianService.reportSeatMaintenance({
        seatId: selectedSeat.id,
        issueType: reportForm.issueType,
        description: reportForm.description.trim(),
        severity: reportForm.severity,
        expectedResolutionAt: reportForm.expectedResolutionAt || null
      });

      toast.success(`Maintenance issue reported for Seat ${selectedSeat.seatNumber}!`);
      setReportModalOpen(false);
      fetchSeats();
    } catch (err) {
      toast.error(err.message || 'Failed to report maintenance issue.');
    }
  };

  const handleOpenResolveModal = (seat) => {
    setSelectedSeat(seat);
    setResolveForm({ resolutionNotes: 'Issue inspected and repaired. Returned to service.' });
    setResolveModalOpen(true);
  };

  const handleResolveSubmit = async (e) => {
    e.preventDefault();
    if (!selectedSeat || !selectedSeat.maintenanceId) {
      toast.error('No active maintenance record selected.');
      return;
    }
    if (!resolveForm.resolutionNotes.trim()) {
      toast.error('Resolution notes are required.');
      return;
    }

    try {
      await librarianService.resolveSeatMaintenance(
        selectedSeat.maintenanceId,
        resolveForm.resolutionNotes.trim()
      );

      toast.success(`Seat ${selectedSeat.seatNumber} maintenance resolved! Seat is now active.`);
      setResolveModalOpen(false);
      fetchSeats();
    } catch (err) {
      toast.error(err.message || 'Failed to resolve maintenance issue.');
    }
  };

  const handleOpenUpdateModal = (seat) => {
    setSelectedSeat(seat);
    setUpdateForm({
      status: seat.maintenanceStatus === 'reported' ? 'in_progress' : seat.maintenanceStatus || 'in_progress',
      severity: seat.severity || 'medium',
      expectedResolutionAt: seat.expectedResolutionAt || ''
    });
    setUpdateModalOpen(true);
  };

  const handleUpdateSubmit = async (e) => {
    e.preventDefault();
    if (!selectedSeat || !selectedSeat.maintenanceId) return;

    try {
      await librarianService.updateMaintenanceStatus({
        maintenanceId: selectedSeat.maintenanceId,
        status: updateForm.status,
        severity: updateForm.severity,
        expectedResolutionAt: updateForm.expectedResolutionAt || null
      });

      toast.success(`Maintenance updated to ${updateForm.status}!`);
      setUpdateModalOpen(false);
      fetchSeats();
    } catch (err) {
      toast.error(err.message || 'Failed to update maintenance.');
    }
  };

  const handleAddSeatSubmit = async (e) => {
    e.preventDefault();
    if (!newSeat.seatNumber.trim()) {
      toast.error('Please enter seat number.');
      return;
    }

    try {
      await librarianService.addNewSeat({
        libraryId: newSeat.libraryId || selectedLibraryId,
        floorId: newSeat.floorId || selectedFloorId,
        roomId: newSeat.roomId || selectedRoomId,
        seatNumber: newSeat.seatNumber,
        seatType: newSeat.seatType,
        hasPowerSocket: newSeat.hasPowerSocket,
        isAccessible: newSeat.isAccessible
      });

      toast.success(`Seat ${newSeat.seatNumber.toUpperCase()} added successfully!`);
      setAddModalOpen(false);
      setNewSeat(prev => ({ ...prev, seatNumber: '' }));
      fetchSeats();
    } catch (err) {
      toast.error(err.message || 'Failed to create new seat.');
    }
  };

  // Filtered Seats
  const filteredSeats = seats.filter(s => {
    if (severityFilter !== 'all' && (s.severity || 'low').toLowerCase() !== severityFilter) {
      return false;
    }
    return true;
  });

  // Summary Metrics
  const metrics = {
    total: seats.length,
    available: seats.filter(s => s.operationalStatus === 'available').length,
    maintenance: seats.filter(s => s.operationalStatus === 'maintenance').length,
    critical: seats.filter(s => (s.severity || '').toLowerCase() === 'critical' && s.operationalStatus === 'maintenance').length,
    inactive: seats.filter(s => s.operationalStatus === 'inactive').length
  };

  // Helper Badge Color
  const getStatusBadge = (seat) => {
    if (seat.operationalStatus === 'inactive') {
      return <Badge className="bg-slate-500 text-white font-bold text-[10px]">Inactive</Badge>;
    }
    if (seat.operationalStatus === 'maintenance') {
      if (seat.maintenanceStatus === 'in_progress') {
        return <Badge className="bg-blue-600 text-white font-bold text-[10px]">In Progress</Badge>;
      }
      if (seat.severity === 'critical') {
        return <Badge className="bg-rose-600 text-white font-bold text-[10px]">Critical Damaged</Badge>;
      }
      return <Badge className="bg-amber-600 text-white font-bold text-[10px]">Maintenance Reported</Badge>;
    }
    return <Badge className="bg-emerald-600 text-white font-bold text-[10px]">Available</Badge>;
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300 pb-12">
      {/* PAGE HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
            <Armchair className="text-teal-600" size={28} /> Seat Inventory & Maintenance
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Real-time carrel inventory, power outlet allocations, and maintenance lifecycle management.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={fetchSeats} variant="outline" className="border-slate-300 text-slate-600 hover:bg-slate-100 text-xs font-bold rounded-xl h-9">
            <RefreshCw size={14} className={`mr-1.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button onClick={() => setAddModalOpen(true)} className="bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl h-9">
            <Plus size={16} className="mr-1.5" /> Add New Seat
          </Button>
        </div>
      </div>

      {/* SUMMARY METRICS CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card className="border border-slate-200 bg-white rounded-2xl p-4 shadow-xs">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Total Seats</p>
          <p className="text-2xl font-black text-navy mt-1">{metrics.total}</p>
        </Card>
        <Card className="border border-emerald-200 bg-emerald-50/50 rounded-2xl p-4 shadow-xs">
          <p className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">Available</p>
          <p className="text-2xl font-black text-emerald-700 mt-1">{metrics.available}</p>
        </Card>
        <Card className="border border-amber-200 bg-amber-50/50 rounded-2xl p-4 shadow-xs">
          <p className="text-[11px] font-bold text-amber-700 uppercase tracking-wider">Under Maintenance</p>
          <p className="text-2xl font-black text-amber-700 mt-1">{metrics.maintenance}</p>
        </Card>
        <Card className="border border-rose-200 bg-rose-50/50 rounded-2xl p-4 shadow-xs">
          <p className="text-[11px] font-bold text-rose-700 uppercase tracking-wider">Critical Issues</p>
          <p className="text-2xl font-black text-rose-700 mt-1">{metrics.critical}</p>
        </Card>
        <Card className="border border-slate-200 bg-slate-50/50 rounded-2xl p-4 shadow-xs col-span-2 sm:col-span-1">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Inactive</p>
          <p className="text-2xl font-black text-slate-600 mt-1">{metrics.inactive}</p>
        </Card>
      </div>

      {/* FILTERS & SEARCH */}
      <Card className="border border-slate-200 bg-white rounded-2xl p-4 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              type="text"
              placeholder="Search seat number, room, or issue..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-10 text-xs rounded-xl border-slate-300 text-navy"
            />
          </div>

          <div className="flex items-center gap-2">
            <Label className="text-xs font-bold text-slate-500 flex items-center gap-1">
              <Filter size={13} /> Status:
            </Label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-10 rounded-xl border border-slate-300 px-3 text-xs font-semibold bg-white text-navy"
            >
              <option value="all">All Statuses</option>
              <option value="available">Available Only</option>
              <option value="maintenance">Under Maintenance</option>
              <option value="inactive">Inactive Only</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <Label className="text-xs font-bold text-slate-500">Severity:</Label>
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="h-10 rounded-xl border border-slate-300 px-3 text-xs font-semibold bg-white text-navy"
            >
              <option value="all">All Severities</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
        </div>
      </Card>

      {/* ERROR BANNER */}
      {error && (
        <Card className="border border-rose-300 bg-rose-50 rounded-2xl p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="text-rose-600 shrink-0" size={24} />
            <div>
              <p className="text-sm font-bold text-rose-900">Seat Inventory Error</p>
              <p className="text-xs text-rose-700 mt-0.5">{error}</p>
            </div>
          </div>
          <Button onClick={fetchSeats} className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl h-9">
            <RefreshCw size={14} className="mr-1.5" /> Retry Now
          </Button>
        </Card>
      )}

      {/* SEATS TABLE CARD */}
      <Card className="border border-slate-200 rounded-2xl shadow-xs overflow-hidden bg-white">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 text-center text-xs font-medium text-slate-400 flex flex-col items-center justify-center gap-2">
              <RefreshCw size={24} className="animate-spin text-teal-600" />
              <span>Fetching seat inventory & maintenance records from database...</span>
            </div>
          ) : filteredSeats.length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-400 font-medium">
              No matching seats found. Try adjusting search filters or adding a new seat.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                    <th className="p-3.5">Seat Number</th>
                    <th className="p-3.5">Location / Room</th>
                    <th className="p-3.5">Type & Facilities</th>
                    <th className="p-3.5">Operational Status</th>
                    <th className="p-3.5">Active Issue / Details</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-sans">
                  {filteredSeats.map(s => (
                    <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3.5 font-bold text-navy font-mono text-sm">{s.seatNumber}</td>
                      <td className="p-3.5">
                        <p className="font-semibold text-slate-800">{s.roomName || 'Reading Hall'}</p>
                        <p className="text-[11px] text-slate-400">{s.floorName || 'Ground Floor'} • {s.libraryName || 'Central Library'}</p>
                      </td>
                      <td className="p-3.5">
                        <p className="font-semibold text-slate-700">{s.type}</p>
                        <div className="flex items-center gap-2 mt-1">
                          {s.hasPowerSocket && <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded font-bold flex items-center gap-0.5"><Zap size={11} /> Power Socket</span>}
                          {s.isAccessible && <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded font-bold flex items-center gap-0.5"><Sun size={11} /> Accessible</span>}
                        </div>
                      </td>
                      <td className="p-3.5">{getStatusBadge(s)}</td>
                      <td className="p-3.5">
                        {s.operationalStatus === 'maintenance' ? (
                          <div>
                            <p className="font-bold text-rose-800 text-[11px] flex items-center gap-1">
                              <Wrench size={12} /> {s.issueType || 'Maintenance'}
                            </p>
                            <p className="text-[11px] text-slate-600 line-clamp-1">{s.description || 'No description provided.'}</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">Reported by {s.reportedByName} at {s.reportedAt ? new Date(s.reportedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A'}</p>
                          </div>
                        ) : s.resolvedNotes ? (
                          <div>
                            <p className="text-[11px] font-semibold text-teal-700">✓ Last Resolved: {s.resolvedNotes}</p>
                          </div>
                        ) : (
                          <span className="text-slate-400 text-[11px]">Normal Operating Condition</span>
                        )}
                      </td>
                      <td className="p-3.5 text-right space-x-1.5">
                        {s.operationalStatus === 'maintenance' ? (
                          <>
                            <Button
                              onClick={() => handleOpenUpdateModal(s)}
                              variant="outline"
                              className="h-7 text-[11px] font-bold rounded-lg border-blue-300 text-blue-700 hover:bg-blue-50"
                            >
                              Update Status
                            </Button>
                            <Button
                              onClick={() => handleOpenResolveModal(s)}
                              className="h-7 text-[11px] font-bold rounded-lg bg-teal-600 text-white hover:bg-teal-700"
                            >
                              Resolve Issue
                            </Button>
                          </>
                        ) : (
                          <Button
                            onClick={() => handleOpenReportModal(s)}
                            variant="outline"
                            className="h-7 text-[11px] font-bold rounded-lg border-amber-300 text-amber-700 hover:bg-amber-50"
                          >
                            <Wrench size={12} className="mr-1" /> Report Issue
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

      {/* REPORT MAINTENANCE MODAL */}
      <Dialog open={reportModalOpen} onOpenChange={setReportModalOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl p-6 bg-white text-navy">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-navy flex items-center gap-2">
              <Wrench size={20} className="text-amber-600" /> Report Maintenance Issue
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 pt-1">
              Flag seat {selectedSeat?.seatNumber} as unavailable for repairs.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleReportSubmit} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Seat Number (Read-only)</Label>
              <Input value={selectedSeat?.seatNumber || ''} readOnly className="h-10 text-xs font-bold bg-slate-100 border-slate-300 text-navy cursor-not-allowed" />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Issue Category / Type</Label>
              <select
                value={reportForm.issueType}
                onChange={(e) => setReportForm({ ...reportForm, issueType: e.target.value })}
                className="w-full h-10 rounded-xl border border-slate-300 px-3 text-xs font-semibold bg-white text-navy"
              >
                <option value="General Maintenance">General Maintenance</option>
                <option value="Damaged Desk / Chair">Damaged Desk / Chair</option>
                <option value="Power Socket Fault">Power Socket Fault</option>
                <option value="Network / LAN Port Issue">Network / LAN Port Issue</option>
                <option value="Lighting / Window Shutter">Lighting / Window Shutter</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Severity Level</Label>
              <select
                value={reportForm.severity}
                onChange={(e) => setReportForm({ ...reportForm, severity: e.target.value })}
                className="w-full h-10 rounded-xl border border-slate-300 px-3 text-xs font-semibold bg-white text-navy"
              >
                <option value="low">Low (Minor cosmetic issue)</option>
                <option value="medium">Medium (Requires desk maintenance)</option>
                <option value="high">High (Seat unusable)</option>
                <option value="critical">Critical (Hardware/Electrical hazard)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Detailed Description</Label>
              <textarea
                value={reportForm.description}
                onChange={(e) => setReportForm({ ...reportForm, description: e.target.value })}
                placeholder="Describe broken parts, safety concerns, or maintenance instructions..."
                rows={3}
                className="w-full rounded-xl border border-slate-300 p-3 text-xs bg-white text-navy focus:ring-2 focus:ring-teal-500"
                required
              />
            </div>

            <div className="flex justify-end gap-3 pt-3">
              <Button type="button" variant="outline" onClick={() => setReportModalOpen(false)} className="rounded-xl text-xs">
                Cancel
              </Button>
              <Button type="submit" className="bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs">
                Submit Maintenance Report
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* RESOLVE MAINTENANCE MODAL */}
      <Dialog open={resolveModalOpen} onOpenChange={setResolveModalOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl p-6 bg-white text-navy">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-navy flex items-center gap-2">
              <CheckCircle2 size={20} className="text-teal-600" /> Resolve Maintenance Issue
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 pt-1">
              Mark seat {selectedSeat?.seatNumber} as repaired and activate for student bookings.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleResolveSubmit} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Resolution & Inspection Notes (Required)</Label>
              <textarea
                value={resolveForm.resolutionNotes}
                onChange={(e) => setResolveForm({ ...resolveForm, resolutionNotes: e.target.value })}
                placeholder="Enter repair details, technician notes, and safety verification..."
                rows={4}
                className="w-full rounded-xl border border-slate-300 p-3 text-xs bg-white text-navy focus:ring-2 focus:ring-teal-500"
                required
              />
            </div>

            <div className="flex justify-end gap-3 pt-3">
              <Button type="button" variant="outline" onClick={() => setResolveModalOpen(false)} className="rounded-xl text-xs">
                Cancel
              </Button>
              <Button type="submit" className="bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl text-xs">
                Confirm & Return to Service
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* UPDATE MAINTENANCE MODAL */}
      <Dialog open={updateModalOpen} onOpenChange={setUpdateModalOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl p-6 bg-white text-navy">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-navy flex items-center gap-2">
              <RefreshCw size={20} className="text-blue-600" /> Update Maintenance Progress
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 pt-1">
              Update repair status for seat {selectedSeat?.seatNumber}.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleUpdateSubmit} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Maintenance Status</Label>
              <select
                value={updateForm.status}
                onChange={(e) => setUpdateForm({ ...updateForm, status: e.target.value })}
                className="w-full h-10 rounded-xl border border-slate-300 px-3 text-xs font-semibold bg-white text-navy"
              >
                <option value="in_progress">In Progress (Work started)</option>
                <option value="reported">Reported (Awaiting technician)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Severity Level</Label>
              <select
                value={updateForm.severity}
                onChange={(e) => setUpdateForm({ ...updateForm, severity: e.target.value })}
                className="w-full h-10 rounded-xl border border-slate-300 px-3 text-xs font-semibold bg-white text-navy"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>

            <div className="flex justify-end gap-3 pt-3">
              <Button type="button" variant="outline" onClick={() => setUpdateModalOpen(false)} className="rounded-xl text-xs">
                Cancel
              </Button>
              <Button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs">
                Save Status Updates
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ADD NEW SEAT MODAL */}
      <Dialog open={addModalOpen} onOpenChange={setAddModalOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl p-6 bg-white text-navy">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-navy flex items-center gap-2">
              <Plus size={20} className="text-teal-600" /> Add New Study Seat
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 pt-1">
              Add a new carrel seat directly to database inventory.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAddSeatSubmit} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Seat Number / Code</Label>
              <Input
                placeholder="e.g. S-101 or C-12"
                value={newSeat.seatNumber}
                onChange={(e) => setNewSeat({ ...newSeat, seatNumber: e.target.value })}
                className="h-10 text-xs font-bold bg-slate-50 border-slate-300 text-navy"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Seat Type</Label>
              <select
                value={newSeat.seatType}
                onChange={(e) => setNewSeat({ ...newSeat, seatType: e.target.value })}
                className="w-full h-10 rounded-xl border border-slate-300 px-3 text-xs font-semibold bg-slate-50 text-navy"
              >
                <option value="Standard Study Desk">Standard Study Desk</option>
                <option value="Individual Reading Carrel">Individual Reading Carrel</option>
                <option value="Computer Terminal Workstation">Computer Terminal Workstation</option>
                <option value="Group Discussion Table">Group Discussion Table</option>
              </select>
            </div>

            <div className="flex items-center gap-4 pt-1">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newSeat.hasPowerSocket}
                  onChange={(e) => setNewSeat({ ...newSeat, hasPowerSocket: e.target.checked })}
                  className="rounded text-teal-600 focus:ring-teal-500"
                />
                Has Power Outlet
              </label>

              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newSeat.isAccessible}
                  onChange={(e) => setNewSeat({ ...newSeat, isAccessible: e.target.checked })}
                  className="rounded text-teal-600 focus:ring-teal-500"
                />
                Near Window / Accessible
              </label>
            </div>

            <div className="flex justify-end gap-3 pt-3">
              <Button type="button" variant="outline" onClick={() => setAddModalOpen(false)} className="rounded-xl text-xs">
                Cancel
              </Button>
              <Button type="submit" className="bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl text-xs">
                Create Seat
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
