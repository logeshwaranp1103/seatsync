import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { librarianService } from '../../services/librarianService';
import { adminService } from '../../services/adminService';
import { useSync } from '../../hooks/useSync';
import { db } from '../../services/mockDatabase';
import { Card, CardContent } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Input } from '../../components/shared/Input';
import { Label } from '../../components/shared/Label';
import { Badge } from '../../components/shared/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/shared/Dialog';
import { Armchair, Plus, Search, RefreshCw, Zap, Sun, Layers } from 'lucide-react';
import toast from 'react-hot-toast';

export default function SeatManagementPage() {
  const [seats, setSeats] = useState([]);
  const [search, setSearch] = useState('');
  const [genderFilter, setGenderFilter] = useState('ALL'); // 'ALL' | 'BOYS' | 'GIRLS'
  const [loading, setLoading] = useState(true);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [creationMode, setCreationMode] = useState('single'); // 'single' | 'bulk'

  const [newSeat, setNewSeat] = useState({
    seatNumber: '',
    zoneId: 'zone-a',
    genderGroup: 'boys',
    powerOutlet: true,
    nearWindow: false
  });

  const [bulkSeat, setBulkSeat] = useState({
    prefix: 'S-',
    startNum: 21,
    endNum: 40,
    genderGroup: 'girls',
    zoneId: 'zone-a',
    powerOutlet: true,
    nearWindow: false
  });

  const [bulkRange, setBulkRange] = useState({
    startNumber: 1,
    endNumber: 20,
    targetGenderGroup: 'boys'
  });

  const DEFAULT_ROOM_ID = 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a44';

  const fetchSeats = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase.from('seats').select('*').order('seat_number');
      if (error) {
        toast.error(`Database error: ${error.message}`);
        return;
      }

      if (data && data.length > 0) {
        setSeats(data.map(s => {
          const numMatch = String(s.seat_number || '').match(/\d+/);
          const num = numMatch ? parseInt(numMatch[0], 10) : 1;
          const gGroup = s.gender_group ? String(s.gender_group).toLowerCase() : (num <= 20 ? 'boys' : 'girls');
          return {
            id: s.id,
            seatNumber: s.seat_number,
            type: s.seat_type || 'Standard Desk',
            zoneId: s.is_accessible ? 'zone-a' : 'zone-b',
            genderGroup: gGroup,
            powerOutlet: s.has_power_socket,
            nearWindow: s.is_accessible,
            status: s.status === 'available' ? 'active' : s.status
          };
        }));
      } else {
        setSeats([]);
      }
    } catch (err) {
      toast.error(`Failed to fetch seats from database: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSeats();
  }, []);

  useSync(['seats'], fetchSeats);

  const handleAddSeat = async (e) => {
    e.preventDefault();

    try {
      let roomId = DEFAULT_ROOM_ID;
      const { data: existingRoom } = await supabase.from('rooms').select('id').limit(1).maybeSingle();
      if (existingRoom && existingRoom.id) {
        roomId = existingRoom.id;
      }

      if (creationMode === 'single') {
        const seatNumStr = newSeat.seatNumber.trim();
        if (!seatNumStr) {
          toast.error('Please enter Seat Number.');
          return;
        }

        const { error: insertErr } = await supabase.from('seats').insert({
          room_id: roomId,
          seat_number: seatNumStr,
          seat_type: newSeat.zoneId === 'zone-a' ? 'Quiet Study' : 'Group Discussion',
          gender_group: newSeat.genderGroup,
          has_power_socket: newSeat.powerOutlet,
          is_accessible: newSeat.nearWindow,
          status: 'available'
        });

        if (insertErr) {
          toast.error(`Failed to store seat in database: ${insertErr.message}`);
          return;
        }

        toast.success(`Seat ${seatNumStr} saved directly to Supabase database!`);
      } else {
        // BULK SEAT CREATION
        const start = Math.min(bulkSeat.startNum, bulkSeat.endNum);
        const end = Math.max(bulkSeat.startNum, bulkSeat.endNum);
        const prefix = bulkSeat.prefix.trim() || 'S-';
        const targetGroup = bulkSeat.genderGroup;

        const { data: existingSeats } = await supabase.from('seats').select('seat_number');
        const existingSet = new Set((existingSeats || []).map(s => String(s.seat_number || '').toUpperCase()));

        const seatsToCreate = [];
        const skippedSeats = [];

        for (let i = start; i <= end; i++) {
          const seatNo = `${prefix}${String(i).padStart(2, '0')}`;
          if (existingSet.has(seatNo.toUpperCase())) {
            skippedSeats.push(seatNo);
          } else {
            seatsToCreate.push({
              room_id: roomId,
              seat_number: seatNo,
              seat_type: bulkSeat.zoneId === 'zone-a' ? 'Quiet Study' : 'Group Discussion',
              gender_group: targetGroup,
              has_power_socket: bulkSeat.powerOutlet,
              is_accessible: bulkSeat.nearWindow,
              status: 'available'
            });
          }
        }

        if (seatsToCreate.length === 0) {
          toast.error(`All seats in range ${prefix}${start} to ${prefix}${end} already exist in database.`);
          return;
        }

        const { data: inserted, error: bulkErr } = await supabase
          .from('seats')
          .insert(seatsToCreate)
          .select();

        if (bulkErr) {
          toast.error(`Database Bulk Creation Error: ${bulkErr.message}`);
          return;
        }

        const createdCount = inserted ? inserted.length : seatsToCreate.length;
        toast.success(`Successfully created ${createdCount} new ${targetGroup.toUpperCase()} seats (${prefix}${start} to ${prefix}${end}) in database!${skippedSeats.length > 0 ? ` (${skippedSeats.length} already existed)` : ''}`);
      }

      setAddModalOpen(false);
      setNewSeat({ seatNumber: '', zoneId: 'zone-a', genderGroup: 'boys', powerOutlet: true, nearWindow: false });
      fetchSeats();
    } catch (err) {
      toast.error(`Database error: ${err.message}`);
    }
  };

  const handleUpdateSeatGroup = async (seat, newGroup) => {
    try {
      await adminService.updateSeatGenderGroup(seat.id, newGroup);
      
      // Update local state immediately
      setSeats(prev => prev.map(s => s.id === seat.id ? { ...s, genderGroup: newGroup } : s));

      toast.success(`Seat ${seat.seatNumber} group updated to ${newGroup.toUpperCase()}!`);
      fetchSeats();
    } catch (err) {
      toast.error(err.message || 'Failed to update seat group.');
    }
  };

  const handleBulkRangeAssign = async (e) => {
    e.preventDefault();
    const start = Math.min(bulkRange.startNumber, bulkRange.endNumber);
    const end = Math.max(bulkRange.startNumber, bulkRange.endNumber);
    const targetGroup = bulkRange.targetGenderGroup;

    try {
      const res = await adminService.bulkAllocateOrUpdateSeatRange(start, end, targetGroup);

      toast.success(res.message || `Bulk allocation complete for seats S-${start} to S-${end}.`);
      setBulkModalOpen(false);
      fetchSeats();
    } catch (err) {
      toast.error(err.message || 'Failed to complete bulk seat allocation.');
    }
  };

  const handleToggleMaintenance = async (seat) => {
    try {
      const isCurrentlyMaintenance = seat.status === 'maintenance';
      if (isCurrentlyMaintenance) {
        await supabase.from('seats').update({ status: 'available' }).eq('id', seat.id);
      } else {
        await librarianService.reportSeatMaintenance({
          seatNumber: seat.seatNumber,
          category: 'Desk Maintenance',
          description: 'Flagged for maintenance by administrator',
          priority: 'Medium'
        });
      }

      // Local fallback sync
      const data = (await db.read('seatsync_seats')) || [];
      const target = data.find(s => s.id === seat.id || s.seatNumber === seat.seatNumber);
      if (target) {
        target.status = isCurrentlyMaintenance ? 'active' : 'maintenance';
        await db.write('seatsync_seats', data);
      }

      toast.success(`Seat ${seat.seatNumber} status updated.`);
      fetchSeats();
    } catch {
      toast.error('Failed to update seat status.');
    }
  };

  const filtered = seats.filter(s => {
    const matchesSearch = (s.seatNumber || '').toLowerCase().includes(search.toLowerCase()) ||
      (s.type || '').toLowerCase().includes(search.toLowerCase());
    const matchesGender = genderFilter === 'ALL' || String(s.genderGroup || '').toLowerCase() === genderFilter.toLowerCase();
    return matchesSearch && matchesGender;
  });

  const boysCount = useMemo(() => seats.filter(s => String(s.genderGroup || '').toLowerCase() === 'boys').length, [seats]);
  const girlsCount = useMemo(() => seats.filter(s => String(s.genderGroup || '').toLowerCase() === 'girls').length, [seats]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300 pb-12">
      
      {/* HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
            <Armchair className="text-brandBlue" size={30} /> Seat Inventory & Gender Allocation Management
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Configure seat groups (Boys / Girls), inspect live allocation statuses, and enforce dynamic access boundaries.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button onClick={() => setBulkModalOpen(true)} variant="outline" className="text-xs font-bold rounded-xl h-9 border-slate-300 text-slate-700">
            <Layers size={14} className="mr-1.5" /> Bulk Group Allocation
          </Button>
          <Button onClick={fetchSeats} variant="outline" className="text-xs font-bold rounded-xl h-9">
            <RefreshCw size={14} className="mr-1.5" /> Refresh Inventory
          </Button>
          <Button onClick={() => setAddModalOpen(true)} className="bg-brandBlue hover:bg-blue-700 text-white font-bold text-xs rounded-xl h-9">
            <Plus size={16} className="mr-1.5" /> Add New Seat / Bulk Seats
          </Button>
        </div>
      </div>

      {/* GENDER GROUP SUMMARY METRICS */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border border-blue-200 bg-blue-50/60 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-extrabold text-blue-900 uppercase tracking-wider">Boys Allocated Seats</p>
              <h3 className="text-2xl font-black text-blue-950 mt-1">{boysCount} Desks</h3>
            </div>
            <Badge className="bg-blue-600 text-white font-mono font-bold text-xs px-3 py-1 rounded-xl">
              BOYS GROUP
            </Badge>
          </div>
        </Card>

        <Card className="border border-pink-200 bg-pink-50/60 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-extrabold text-pink-900 uppercase tracking-wider">Girls Allocated Seats</p>
              <h3 className="text-2xl font-black text-pink-950 mt-1">{girlsCount} Desks</h3>
            </div>
            <Badge className="bg-pink-600 text-white font-mono font-bold text-xs px-3 py-1 rounded-xl">
              GIRLS GROUP
            </Badge>
          </div>
        </Card>

        <Card className="border border-slate-200 bg-slate-50/70 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">Total Configured Desks</p>
              <h3 className="text-2xl font-black text-slate-900 mt-1">{seats.length} Total Desks</h3>
            </div>
            <Badge variant="outline" className="text-xs font-bold text-slate-700 border-slate-300">
              FULL INVENTORY
            </Badge>
          </div>
        </Card>
      </div>

      {/* FILTER & SEARCH BAR */}
      <Card className="border border-slate-200 bg-white rounded-2xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="relative max-w-md w-full">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            type="text"
            placeholder="Search seat number, type..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-10 text-xs rounded-xl border-slate-300 text-navy"
          />
        </div>

        {/* GENDER FILTER TABS */}
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
          <button
            onClick={() => setGenderFilter('ALL')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
              genderFilter === 'ALL' ? 'bg-white text-navy shadow-xs' : 'text-slate-500 hover:text-navy'
            }`}
          >
            All Seats ({seats.length})
          </button>
          <button
            onClick={() => setGenderFilter('BOYS')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
              genderFilter === 'BOYS' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-500 hover:text-navy'
            }`}
          >
            Boys Seats ({boysCount})
          </button>
          <button
            onClick={() => setGenderFilter('GIRLS')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
              genderFilter === 'GIRLS' ? 'bg-pink-600 text-white shadow-xs' : 'text-slate-500 hover:text-navy'
            }`}
          >
            Girls Seats ({girlsCount})
          </button>
        </div>
      </Card>

      {/* TABLE INVENTORY */}
      <Card className="border border-slate-200 rounded-2xl shadow-xs overflow-hidden bg-white">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400">Loading seat inventory...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">No matching seats found for filter.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                    <th className="p-3.5">Seat Number</th>
                    <th className="p-3.5">Allocated Group</th>
                    <th className="p-3.5">Zone / Type</th>
                    <th className="p-3.5">Power / Window</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {filtered.map(s => {
                    const isBoys = String(s.genderGroup || '').toLowerCase() === 'boys';
                    return (
                      <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                        <td className="p-3.5 font-extrabold text-navy text-sm">{s.seatNumber}</td>
                        <td className="p-3.5 font-sans">
                          <Badge className={`text-[11px] font-extrabold px-3 py-1 rounded-xl font-mono ${
                            isBoys ? 'bg-blue-600 text-white' : 'bg-pink-600 text-white'
                          }`}>
                            {isBoys ? 'BOYS' : 'GIRLS'}
                          </Badge>
                        </td>
                        <td className="p-3.5 font-semibold text-slate-700 font-sans">{s.type} ({s.zoneId === 'zone-a' ? 'Zone A' : 'Zone B'})</td>
                        <td className="p-3.5 font-sans flex items-center gap-3">
                          {s.powerOutlet ? <span className="text-emerald-700 font-bold flex items-center gap-1"><Zap size={13} /> Power</span> : <span className="text-slate-400">No Power</span>}
                          {s.nearWindow ? <span className="text-amber-700 font-bold flex items-center gap-1"><Sun size={13} /> Window</span> : null}
                        </td>
                        <td className="p-3.5 font-sans">
                          <Badge className={`text-[10px] font-bold ${s.status === 'active' || s.status === 'available' ? 'bg-emerald-600 text-white' : 'bg-amber-600 text-white'}`}>
                            {s.status}
                          </Badge>
                        </td>
                        <td className="p-3.5 text-right font-sans space-x-2">
                          {/* GENDER GROUP SWITCH ACTION */}
                          <Button
                            onClick={() => handleUpdateSeatGroup(s, isBoys ? 'girls' : 'boys')}
                            variant="outline"
                            className={`h-7 text-[11px] font-bold rounded-lg ${
                              isBoys ? 'border-pink-300 text-pink-700 hover:bg-pink-50' : 'border-blue-300 text-blue-700 hover:bg-blue-50'
                            }`}
                          >
                            Change to {isBoys ? 'Girls' : 'Boys'}
                          </Button>

                          {/* MAINTENANCE TOGGLE */}
                          <Button
                            onClick={() => handleToggleMaintenance(s)}
                            variant="outline"
                            className="h-7 text-[11px] font-bold rounded-lg border-slate-300 text-slate-700"
                          >
                            {s.status === 'active' || s.status === 'available' ? 'Set Maint.' : 'Activate'}
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

      {/* ADD NEW SEAT / BULK CREATE SEATS MODAL */}
      <Dialog open={addModalOpen} onOpenChange={setAddModalOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl p-6 bg-white text-navy">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-navy flex items-center gap-2">
              <Armchair className="text-brandBlue" size={22} /> Add Study Seats
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 pt-1">
              Create a single seat or bulk generate a range of seats assigned to a gender group.
            </DialogDescription>
          </DialogHeader>

          {/* MODE TOGGLE SWITCH */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl gap-1 border border-slate-200">
            <button
              type="button"
              onClick={() => setCreationMode('single')}
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                creationMode === 'single' ? 'bg-white text-navy shadow-xs border border-slate-200' : 'text-slate-500 hover:text-navy'
              }`}
            >
              Single Seat
            </button>
            <button
              type="button"
              onClick={() => setCreationMode('bulk')}
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                creationMode === 'bulk' ? 'bg-brandBlue text-white shadow-xs' : 'text-slate-500 hover:text-navy'
              }`}
            >
              <Layers size={13} className="inline mr-1" /> Bulk Create (Range)
            </button>
          </div>

          <form onSubmit={handleAddSeat} className="space-y-4 pt-2">
            {creationMode === 'single' ? (
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700">Seat Number / Code</Label>
                <Input
                  placeholder="e.g. S-51"
                  value={newSeat.seatNumber}
                  onChange={(e) => setNewSeat({ ...newSeat, seatNumber: e.target.value })}
                  className="h-10 text-xs font-bold bg-slate-50 border-slate-300 text-navy"
                  required
                />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[11px] font-bold text-slate-700">Prefix</Label>
                    <Input
                      placeholder="S-"
                      value={bulkSeat.prefix}
                      onChange={(e) => setBulkSeat({ ...bulkSeat, prefix: e.target.value })}
                      className="h-9 text-xs font-bold bg-slate-50 border-slate-300 text-navy"
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] font-bold text-slate-700">Start No.</Label>
                    <Input
                      type="number"
                      min="1"
                      max="500"
                      value={bulkSeat.startNum}
                      onChange={(e) => setBulkSeat({ ...bulkSeat, startNum: parseInt(e.target.value, 10) || 1 })}
                      className="h-9 text-xs font-bold bg-slate-50 border-slate-300 text-navy"
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] font-bold text-slate-700">End No.</Label>
                    <Input
                      type="number"
                      min="1"
                      max="500"
                      value={bulkSeat.endNum}
                      onChange={(e) => setBulkSeat({ ...bulkSeat, endNum: parseInt(e.target.value, 10) || 1 })}
                      className="h-9 text-xs font-bold bg-slate-50 border-slate-300 text-navy"
                      required
                    />
                  </div>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-xl p-2.5 text-[11px] text-blue-900 font-medium">
                  Will create up to <span className="font-bold">{Math.max(0, bulkSeat.endNum - bulkSeat.startNum + 1)}</span> seats: <span className="font-mono font-bold">{bulkSeat.prefix}{String(bulkSeat.startNum).padStart(2, '0')}</span> to <span className="font-mono font-bold">{bulkSeat.prefix}{String(bulkSeat.endNum).padStart(2, '0')}</span>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Allocated Gender Group</Label>
              <select
                value={creationMode === 'single' ? newSeat.genderGroup : bulkSeat.genderGroup}
                onChange={(e) => {
                  if (creationMode === 'single') setNewSeat({ ...newSeat, genderGroup: e.target.value });
                  else setBulkSeat({ ...bulkSeat, genderGroup: e.target.value });
                }}
                className="w-full h-10 rounded-xl border border-slate-300 px-3 text-xs font-bold bg-slate-50 text-navy"
              >
                <option value="boys">BOYS SEATS</option>
                <option value="girls">GIRLS SEATS</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Zone Type</Label>
              <select
                value={creationMode === 'single' ? newSeat.zoneId : bulkSeat.zoneId}
                onChange={(e) => {
                  if (creationMode === 'single') setNewSeat({ ...newSeat, zoneId: e.target.value });
                  else setBulkSeat({ ...bulkSeat, zoneId: e.target.value });
                }}
                className="w-full h-10 rounded-xl border border-slate-300 px-3 text-xs font-semibold bg-slate-50 text-navy"
              >
                <option value="zone-a">Zone A — Quiet Study</option>
                <option value="zone-b">Zone B — Group Discussion</option>
              </select>
            </div>

            <div className="flex justify-end gap-3 pt-3">
              <Button type="button" variant="outline" onClick={() => setAddModalOpen(false)} className="rounded-xl text-xs">
                Cancel
              </Button>
              <Button type="submit" className="bg-brandBlue hover:bg-blue-700 text-white font-bold rounded-xl text-xs">
                {creationMode === 'single' ? 'Create Seat' : `Bulk Create ${Math.max(0, bulkSeat.endNum - bulkSeat.startNum + 1)} Seats`}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* BULK RANGE ASSIGNMENT MODAL */}
      <Dialog open={bulkModalOpen} onOpenChange={setBulkModalOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl p-6 bg-white text-navy">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-navy flex items-center gap-2">
              <Layers className="text-brandBlue" size={20} /> Bulk Seat Group Allocation
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 pt-1">
              Assign a range of seats to Boys or Girls group in one bulk action. Missing seats in the range will be automatically created in the database.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleBulkRangeAssign} className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700">Start Seat Number</Label>
                <Input
                  type="number"
                  min="1"
                  max="500"
                  value={bulkRange.startNumber}
                  onChange={(e) => setBulkRange({ ...bulkRange, startNumber: parseInt(e.target.value, 10) || 1 })}
                  className="h-10 text-xs font-bold bg-slate-50 border-slate-300 text-navy"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700">End Seat Number</Label>
                <Input
                  type="number"
                  min="1"
                  max="500"
                  value={bulkRange.endNumber}
                  onChange={(e) => setBulkRange({ ...bulkRange, endNumber: parseInt(e.target.value, 10) || 1 })}
                  className="h-10 text-xs font-bold bg-slate-50 border-slate-300 text-navy"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Target Seat Group</Label>
              <select
                value={bulkRange.targetGenderGroup}
                onChange={(e) => setBulkRange({ ...bulkRange, targetGenderGroup: e.target.value })}
                className="w-full h-10 rounded-xl border border-slate-300 px-3 text-xs font-bold bg-slate-50 text-navy"
              >
                <option value="boys">BOYS SEATS (S-{bulkRange.startNumber} to S-{bulkRange.endNumber})</option>
                <option value="girls">GIRLS SEATS (S-{bulkRange.startNumber} to S-{bulkRange.endNumber})</option>
              </select>
            </div>

            <div className="flex justify-end gap-3 pt-3">
              <Button type="button" variant="outline" onClick={() => setBulkModalOpen(false)} className="rounded-xl text-xs">
                Cancel
              </Button>
              <Button type="submit" className="bg-brandBlue hover:bg-blue-700 text-white font-bold rounded-xl text-xs">
                Apply Bulk Allocation
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
