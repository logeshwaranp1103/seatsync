import React, { useState, useEffect } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { adminService } from '../../services/adminService';
import { db } from '../../services/mockDatabase';
import { useSync } from '../../hooks/useSync';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import {
  Activity, RefreshCw, Armchair, Users, ShieldAlert, AlertTriangle,
  Building2, QrCode, Lock, Megaphone, Wrench, CheckCircle2, Clock
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function LiveOperationsPage() {
  const { user: adminUser } = useAuth();
  const [metrics, setMetrics] = useState({
    totalSeats: 40,
    occupiedSeats: 0,
    availableSeats: 40,
    todayBookingsCount: 0,
    checkedInCount: 0,
    activeWaitlist: 0,
    maintenanceSeats: 0,
    openIncidents: 0,
    dutyLibrariansCount: 0,
    rooms: []
  });
  const [loading, setLoading] = useState(true);

  const fetchLiveMetrics = async () => {
    try {
      setLoading(true);
      const res = await adminService.getLiveOperationsMetrics();
      setMetrics(res);
    } catch (err) {
      console.warn('Failed to load live ops metrics:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLiveMetrics();
  }, []);

  useSync(['seatsync_bookings', 'seatsync_seats', 'seatsync_rooms', 'seatsync_maintenance', 'seatsync_incidents'], fetchLiveMetrics);

  const handleToggleRoom = async (room) => {
    const newStatus = room.status === 'closed' ? 'active' : 'closed';
    try {
      await adminService.toggleRoomStatus(room.id, newStatus, newStatus === 'closed' ? 'Admin Emergency Closure' : '', adminUser);
      toast.success(`Room ${room.name} is now ${newStatus.toUpperCase()}.`);
      fetchLiveMetrics();
    } catch (err) {
      toast.error('Failed to toggle room status.');
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
            <Activity className="text-indigo-600" size={28} /> Live Platform Operations Control
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Real-time command center monitoring live student bookings, desk check-ins, room closures, and maintenance.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 font-mono text-xs px-3 py-1 flex items-center gap-1.5 rounded-full">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span> Realtime Engine Active
          </Badge>
          <Button onClick={fetchLiveMetrics} variant="outline" className="border-slate-300 text-slate-600 hover:bg-slate-100 text-xs font-bold rounded-xl h-9">
            <RefreshCw size={14} className="mr-1.5" /> Sync State
          </Button>
        </div>
      </div>

      {/* METRICS GRID */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border border-slate-200/80 bg-white rounded-2xl p-5 shadow-xs">
          <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">Active Occupancy</p>
          <h3 className="text-2xl font-black text-navy mt-1">{metrics.occupiedSeats} / {metrics.totalSeats}</h3>
          <p className="text-[11px] text-teal-600 mt-1 font-mono">{metrics.checkedInCount} Checked-In Students</p>
        </Card>
        <Card className="border border-slate-200/80 bg-white rounded-2xl p-5 shadow-xs">
          <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">Available Seats</p>
          <h3 className="text-2xl font-black text-emerald-600 mt-1">{metrics.availableSeats}</h3>
          <p className="text-[11px] text-slate-500 mt-1 font-mono">Ready for bookings</p>
        </Card>
        <Card className="border border-slate-200/80 bg-white rounded-2xl p-5 shadow-xs">
          <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">Waitlist Queue</p>
          <h3 className="text-2xl font-black text-amber-600 mt-1">{metrics.activeWaitlist}</h3>
          <p className="text-[11px] text-slate-500 mt-1 font-mono">Students in FIFO queue</p>
        </Card>
        <Card className="border border-slate-200/80 bg-white rounded-2xl p-5 shadow-xs">
          <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">Maintenance / Issues</p>
          <h3 className="text-2xl font-black text-rose-600 mt-1">{metrics.maintenanceSeats} Seats / {metrics.openIncidents} Incidents</h3>
          <p className="text-[11px] text-slate-500 mt-1 font-mono">Requires attention</p>
        </Card>
      </div>

      {/* ROOM STATUS & EMERGENCY CLOSURE CONTROLS */}
      <Card className="border border-slate-200/80 bg-white rounded-2xl p-6 shadow-xs space-y-4">
        <h2 className="text-base font-bold text-navy flex items-center gap-2">
          <Building2 size={18} className="text-indigo-600" /> Library Rooms & Emergency Closure Controls
        </h2>

        <div className="grid sm:grid-cols-2 gap-4">
          {(metrics.rooms || []).map(room => (
            <div key={room.id} className="p-4 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between gap-4">
              <div className="space-y-1">
                <span className="font-extrabold text-navy text-sm block">{room.name}</span>
                <p className="text-xs text-slate-500 font-mono">{room.floor} • Capacity: {room.capacity}</p>
                {room.closureReason && (
                  <p className="text-[10px] text-rose-600 font-medium">Reason: {room.closureReason}</p>
                )}
              </div>
              <Button
                onClick={() => handleToggleRoom(room)}
                className={`h-9 px-4 text-xs font-bold rounded-xl shadow-xs ${room.status === 'closed' ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-red-600 hover:bg-red-700 text-white'
                  }`}
              >
                {room.status === 'closed' ? 'Reopen Room' : 'Close Room'}
              </Button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
