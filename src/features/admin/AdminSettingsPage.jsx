import React, { useEffect, useState } from 'react';
import { db } from '../../services/mockDatabase';
import { Card, CardContent } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Input } from '../../components/shared/Input';
import { Label } from '../../components/shared/Label';
import { Settings, Save, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState({
    libraryName: 'SeatSync Central University Library',
    operatingHours: '08:00 AM – 10:00 PM',
    maxBookingsPerStudent: 1,
    gracePeriodMinutes: 15,
    noShowLimitBeforeRestriction: 3,
    restrictionDurationDays: 7,
    notice: 'Quiet Study Hours are in effect in Zone A from 6:00 PM onwards.'
  });

  useEffect(() => {
    const fetchSettings = async () => {
      const data = await db.read('seatsync_settings');
      if (data) setSettings(data);
    };
    fetchSettings();
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      await db.write('seatsync_settings', settings);
      toast.success('System global settings saved successfully!');
    } catch {
      toast.error('Failed to save settings.');
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="space-y-2 pb-2 border-b border-slate-200">
        <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight">Global System Settings</h1>
        <p className="text-xs sm:text-sm text-slate-500 font-medium">
          Configure system-wide booking rules, grace periods, and restriction thresholds.
        </p>
      </div>

      <Card className="border border-slate-200 bg-white rounded-2xl p-6 shadow-xs">
        <form onSubmit={handleSave} className="space-y-5">
          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-slate-700">Library Name</Label>
            <Input
              value={settings.libraryName}
              onChange={(e) => setSettings({ ...settings, libraryName: e.target.value })}
              className="h-10 text-xs rounded-xl"
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Operating Hours</Label>
              <Input
                value={settings.operatingHours}
                onChange={(e) => setSettings({ ...settings, operatingHours: e.target.value })}
                className="h-10 text-xs font-mono rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Max Active Bookings Per Student</Label>
              <Input
                type="number"
                value={settings.maxBookingsPerStudent}
                onChange={(e) => setSettings({ ...settings, maxBookingsPerStudent: Number(e.target.value) })}
                className="h-10 text-xs font-mono rounded-xl"
              />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Grace Period (Minutes)</Label>
              <Input
                type="number"
                value={settings.gracePeriodMinutes}
                onChange={(e) => setSettings({ ...settings, gracePeriodMinutes: Number(e.target.value) })}
                className="h-10 text-xs font-mono rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">No-Show Limit Before Restriction</Label>
              <Input
                type="number"
                value={settings.noShowLimitBeforeRestriction}
                onChange={(e) => setSettings({ ...settings, noShowLimitBeforeRestriction: Number(e.target.value) })}
                className="h-10 text-xs font-mono rounded-xl"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-slate-700">Student Broadcast Announcement</Label>
            <Input
              value={settings.notice}
              onChange={(e) => setSettings({ ...settings, notice: e.target.value })}
              className="h-10 text-xs rounded-xl"
            />
          </div>

          <Button type="submit" className="h-10 px-6 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-sm">
            <Save size={14} className="mr-1.5" /> Save Global Configuration
          </Button>
        </form>
      </Card>
    </div>
  );
}
