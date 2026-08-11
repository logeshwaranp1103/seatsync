import React, { useState, useEffect } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { db } from '../../services/mockDatabase';
import { adminService } from '../../services/adminService';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Input } from '../../components/shared/Input';
import { Badge } from '../../components/shared/Badge';
import { Sliders, CheckCircle2, ShieldCheck, Clock, BookOpen, Send } from 'lucide-react';
import toast from 'react-hot-toast';

export default function BookingRulesPage() {
  const { user: adminUser } = useAuth();
  const [currentPolicy, setCurrentPolicy] = useState({
    title: 'Default Student Booking Policy',
    maxActiveBookings: 1,
    gracePeriodMins: 15,
    maxNoShows: 3,
    advanceBookingDays: 1
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadPolicy();
  }, []);

  const loadPolicy = async () => {
    try {
      const policies = (await db.read('seatsync_booking_policies')) || [];
      const pub = policies.find(p => p.isPublished) || policies[0];
      if (pub) setCurrentPolicy(pub);
    } catch (err) {
      console.warn('Failed to load booking policy:', err);
    }
  };

  const handlePublishPolicy = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await adminService.publishPolicy(currentPolicy, adminUser);
      toast.success('Booking Policy published & active across all student & librarian portals!');
      await loadPolicy();
    } catch (err) {
      toast.error('Failed to publish policy.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
            <Sliders className="text-indigo-600" size={28} /> Booking Rules & Policy Control
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Configure student reservation limits, desk check-in grace period countdowns, and no-show thresholds.
          </p>
        </div>

        <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs px-3 py-1 font-mono">
          Policy Status: PUBLISHED & ENFORCED
        </Badge>
      </div>

      <Card className="border border-slate-200/80 bg-white rounded-2xl p-6 sm:p-8 shadow-xs space-y-6">
        <form onSubmit={handlePublishPolicy} className="space-y-6">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 block">Policy Title</label>
            <Input
              type="text"
              value={currentPolicy.title || ''}
              onChange={(e) => setCurrentPolicy({ ...currentPolicy, title: e.target.value })}
              className="h-10 bg-slate-50 border-slate-300 text-navy text-xs rounded-xl"
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-xl space-y-2">
              <label className="text-xs font-bold text-navy block">Max Active Bookings Per Student</label>
              <Input
                type="number"
                min="1"
                max="5"
                value={currentPolicy.maxActiveBookings || 1}
                onChange={(e) => setCurrentPolicy({ ...currentPolicy, maxActiveBookings: Number(e.target.value) })}
                className="h-10 bg-white border-slate-300 text-navy text-xs font-mono rounded-xl"
              />
              <p className="text-[11px] text-slate-500">Prevents multiple simultaneous active bookings.</p>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-xl space-y-2">
              <label className="text-xs font-bold text-navy block">Check-In Grace Period (Minutes)</label>
              <Input
                type="number"
                min="5"
                max="60"
                value={currentPolicy.gracePeriodMins || 15}
                onChange={(e) => setCurrentPolicy({ ...currentPolicy, gracePeriodMins: Number(e.target.value) })}
                className="h-10 bg-white border-slate-300 text-navy text-xs font-mono rounded-xl"
              />
              <p className="text-[11px] text-slate-500">Time allowed for student to check in before seat release.</p>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-xl space-y-2">
              <label className="text-xs font-bold text-navy block">Max No-Show Offenses Limit</label>
              <Input
                type="number"
                min="1"
                max="10"
                value={currentPolicy.maxNoShows || 3}
                onChange={(e) => setCurrentPolicy({ ...currentPolicy, maxNoShows: Number(e.target.value) })}
                className="h-10 bg-white border-slate-300 text-navy text-xs font-mono rounded-xl"
              />
              <p className="text-[11px] text-slate-500">Number of missed grace periods before account restriction.</p>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-xl space-y-2">
              <label className="text-xs font-bold text-navy block">Advance Booking Limit (Days)</label>
              <Input
                type="number"
                min="1"
                max="30"
                value={currentPolicy.advanceBookingDays || 1}
                onChange={(e) => setCurrentPolicy({ ...currentPolicy, advanceBookingDays: Number(e.target.value) })}
                className="h-10 bg-white border-slate-300 text-navy text-xs font-mono rounded-xl"
              />
              <p className="text-[11px] text-slate-500">How many days in advance students can reserve seats.</p>
            </div>
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center justify-center gap-2"
          >
            <Send size={16} /> {loading ? 'Publishing Policy...' : 'Publish Policy & Sync Platform Validation →'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
