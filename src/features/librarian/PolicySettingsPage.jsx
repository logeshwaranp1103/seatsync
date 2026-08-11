import React, { useEffect, useState } from 'react';
import { db } from '../../services/mockDatabase';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Input } from '../../components/shared/Input';
import { Label } from '../../components/shared/Label';
import { Sliders, Save, Clock, ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';

export default function PolicySettingsPage() {
  const [settings, setSettings] = useState({
    libraryName: 'SeatSync Central University Library',
    operatingHours: '08:00 AM – 10:00 PM',
    gracePeriodMinutes: 15,
    noShowLimitBeforeRestriction: 3,
    notice: 'Quiet Study Hours are in effect in Zone A from 6:00 PM onwards.'
  });

  const fetchSettings = async () => {
    try {
      const data = await db.read('seatsync_settings');
      if (data) setSettings(data);
    } catch {
      toast.error('Failed to load library settings.');
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      await db.write('seatsync_settings', settings);
      toast.success('Library policy settings updated!');
    } catch {
      toast.error('Failed to save settings.');
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="space-y-2 pb-2 border-b border-slate-200">
        <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight">Policy & Operating Settings</h1>
        <p className="text-xs sm:text-sm text-slate-500 font-medium">
          Configure operating hours, grace period limits, and broadcast notices.
        </p>
      </div>

      <Card className="border border-slate-200 bg-white rounded-2xl p-6 shadow-xs">
        <form onSubmit={handleSave} className="space-y-5">
          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-slate-700">Library Facility Name</Label>
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
              <Label className="text-xs font-bold text-slate-700">Check-In Grace Period (Minutes)</Label>
              <Input
                type="number"
                value={settings.gracePeriodMinutes}
                onChange={(e) => setSettings({ ...settings, gracePeriodMinutes: Number(e.target.value) })}
                className="h-10 text-xs font-mono rounded-xl"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-slate-700">Broadcast Banner Notice for Students</Label>
            <Input
              value={settings.notice}
              onChange={(e) => setSettings({ ...settings, notice: e.target.value })}
              className="h-10 text-xs rounded-xl"
            />
          </div>

          <Button type="submit" className="h-10 px-6 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl shadow-sm">
            <Save size={14} className="mr-1.5" /> Save Policy Settings
          </Button>
        </form>
      </Card>
    </div>
  );
}
