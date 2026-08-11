import React, { useState, useEffect } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { db } from '../../services/mockDatabase';
import { adminService } from '../../services/adminService';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Input } from '../../components/shared/Input';
import { Badge } from '../../components/shared/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/shared/Dialog';
import { Building2, Plus, Lock, CheckCircle2, AlertTriangle, Layers, Clock } from 'lucide-react';
import toast from 'react-hot-toast';

import { supabase } from '../../lib/supabase';

export default function LibrariesRoomsPage() {
  const { user: adminUser } = useAuth();
  const [libraries, setLibraries] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [isRoomModalOpen, setIsRoomModalOpen] = useState(false);

  // Form State
  const [roomName, setRoomName] = useState('');
  const [floor, setFloor] = useState('Ground Floor');
  const [capacity, setCapacity] = useState(40);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [{ data: libDb }, { data: rmDb }] = await Promise.all([
        supabase.from('libraries').select('*'),
        supabase.from('rooms').select('*, floors(name, floor_number)')
      ]);

      if (libDb && libDb.length > 0) {
        setLibraries(libDb.map(l => ({ id: l.id, name: l.name, code: l.code || 'LIB-01' })));
      } else {
        const localLibs = (await db.read('seatsync_libraries')) || [];
        setLibraries(localLibs);
      }

      if (rmDb && rmDb.length > 0) {
        setRooms(rmDb.map(r => ({
          id: r.id,
          libraryId: r.library_id,
          name: r.name,
          floor: r.floors?.name || `Floor ${r.floor_id || 1}`,
          capacity: r.total_capacity || 40,
          status: r.status === 'temporarily_closed' ? 'closed' : r.status
        })));
      } else {
        const localRooms = (await db.read('seatsync_rooms')) || [];
        setRooms(localRooms);
      }
    } catch (err) {
      console.warn('Failed to load libraries & rooms:', err);
      try {
        const libData = (await db.read('seatsync_libraries')) || [];
        const rmData = (await db.read('seatsync_rooms')) || [];
        setLibraries(libData);
        setRooms(rmData);
      } catch {
        setLibraries([]);
        setRooms([]);
      }
    }
  };

  const handleCreateRoom = async (e) => {
    e.preventDefault();
    if (!roomName.trim()) {
      toast.error('Please enter a room name.');
      return;
    }

    setLoading(true);
    try {
      const existingRooms = (await db.read('seatsync_rooms')) || [];
      const newRoom = {
        id: `RM-${Date.now()}`,
        libraryId: libraries[0]?.id || 'LIB-01',
        name: roomName,
        floor,
        capacity: Number(capacity) || 40,
        status: 'active'
      };

      existingRooms.push(newRoom);
      await db.write('seatsync_rooms', existingRooms);
      toast.success(`Room ${roomName} created!`);
      setIsRoomModalOpen(false);
      setRoomName('');
      await loadData();
    } catch (err) {
      toast.error('Failed to create room.');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleRoom = async (room) => {
    const newStatus = room.status === 'closed' ? 'active' : 'closed';
    try {
      await adminService.toggleRoomStatus(room.id, newStatus, newStatus === 'closed' ? 'Maintenance / Closure' : '', adminUser);
      toast.success(`Room ${room.name} updated to ${newStatus}.`);
      await loadData();
    } catch (err) {
      toast.error('Failed to update room status.');
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
            <Building2 className="text-indigo-600" size={28} /> Library & Room Management
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Configure library campuses, floor layouts, room capacity limits, and emergency suspensions.
          </p>
        </div>

        <Button
          onClick={() => setIsRoomModalOpen(true)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs h-10 px-5 rounded-xl shadow-xs flex items-center gap-2"
        >
          <Plus size={16} /> Add New Reading Room
        </Button>
      </div>

      {/* ROOMS GRID */}
      <div className="grid md:grid-cols-2 gap-6">
        {(rooms || []).map(room => (
          <Card key={room.id} className="border border-slate-200/80 bg-white rounded-2xl p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-extrabold text-navy">{room.name}</h3>
                <p className="text-xs font-mono text-slate-500">{room.floor} • Capacity: {room.capacity} seats</p>
              </div>
              <Badge className={`text-xs font-bold ${
                room.status === 'closed' ? 'bg-red-500 text-white' : 'bg-emerald-600 text-white'
              }`}>
                {room.status.toUpperCase()}
              </Badge>
            </div>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-4">
              <span className="text-xs text-slate-500">Hours: 08:00 AM - 10:00 PM</span>
              <Button
                onClick={() => handleToggleRoom(room)}
                className={`h-9 px-4 text-xs font-bold rounded-xl shadow-xs ${
                  room.status === 'closed' ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-red-600 hover:bg-red-700 text-white'
                }`}
              >
                {room.status === 'closed' ? 'Reopen Room' : 'Suspend Room'}
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {/* ADD ROOM MODAL */}
      {isRoomModalOpen && (
        <Dialog open={isRoomModalOpen} onOpenChange={setIsRoomModalOpen}>
          <DialogContent className="max-w-md bg-white border border-slate-200 text-navy p-6 rounded-2xl space-y-4 shadow-2xl">
            <DialogHeader className="space-y-1">
              <DialogTitle className="text-lg font-black text-navy flex items-center gap-2">
                <Building2 className="text-indigo-600" size={20} /> Add Reading Room
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500 font-medium">
                Create a new reading room or reference hall on campus.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleCreateRoom} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">Room Name</label>
                <Input
                  type="text"
                  placeholder="e.g. Quiet Study Room 3"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  className="h-10 bg-slate-50 border-slate-300 text-navy text-xs rounded-xl"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">Floor</label>
                  <select
                    value={floor}
                    onChange={(e) => setFloor(e.target.value)}
                    className="w-full h-10 bg-slate-50 border border-slate-300 text-navy text-xs font-medium rounded-xl px-3"
                  >
                    <option value="Ground Floor">Ground Floor</option>
                    <option value="First Floor">First Floor</option>
                    <option value="Second Floor">Second Floor</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">Capacity</label>
                  <Input
                    type="number"
                    value={capacity}
                    onChange={(e) => setCapacity(e.target.value)}
                    className="h-10 bg-slate-50 border-slate-300 text-navy text-xs rounded-xl"
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs mt-2"
              >
                {loading ? 'Creating...' : 'Create Room →'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
