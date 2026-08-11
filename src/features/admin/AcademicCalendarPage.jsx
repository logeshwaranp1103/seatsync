import React, { useState, useEffect } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { db } from '../../services/mockDatabase';
import { adminService } from '../../services/adminService';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Input } from '../../components/shared/Input';
import { Badge } from '../../components/shared/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/shared/Dialog';
import { Calendar, Plus, Lock, CheckCircle2, AlertTriangle, Clock, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function AcademicCalendarPage() {
  const { user: adminUser } = useAuth();
  const [events, setEvents] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form State
  const [title, setTitle] = useState('');
  const [eventType, setEventType] = useState('HOLIDAY');
  const [dateStr, setDateStr] = useState(new Date().toISOString().split('T')[0]);
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadEvents();
  }, []);

  const loadEvents = async () => {
    try {
      const data = (await db.read('seatsync_academic_calendar')) || [];
      setEvents(data);
    } catch (err) {
      console.warn('Failed to load academic calendar:', err);
    }
  };

  const handleCreateEvent = async (e) => {
    e.preventDefault();
    if (!title.trim() || !dateStr) {
      toast.error('Please enter a title and date.');
      return;
    }

    setLoading(true);
    try {
      const list = (await db.read('seatsync_academic_calendar')) || [];
      const newEvt = {
        id: `CAL-${Date.now()}`,
        title,
        eventType,
        dateStr,
        description: description || 'Library closed for academic event',
        createdBy: adminUser?.name || 'Administrator',
        createdAt: new Date().toISOString()
      };

      list.push(newEvt);
      await db.write('seatsync_academic_calendar', list);

      await adminService.logAudit({
        userName: adminUser?.name || 'Administrator',
        action: 'ACADEMIC_CALENDAR_EVENT_ADDED',
        affectedRecord: `${eventType}: ${title} (${dateStr})`,
        result: 'SUCCESS',
        notes: description
      });

      toast.success(`Academic calendar event "${title}" added!`);
      setIsModalOpen(false);
      setTitle('');
      await loadEvents();
    } catch (err) {
      toast.error('Failed to create calendar event.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteEvent = async (id) => {
    try {
      const list = (await db.read('seatsync_academic_calendar')) || [];
      const updated = list.filter(e => e.id !== id);
      await db.write('seatsync_academic_calendar', updated);
      toast.success('Calendar event removed.');
      await loadEvents();
    } catch (err) {
      toast.error('Failed to delete event.');
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-indigo-900/60">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight flex items-center gap-2">
            <Calendar className="text-indigo-400" size={28} /> Academic Calendar & Holiday Scheduler
          </h1>
          <p className="text-xs sm:text-sm text-indigo-300/80 font-medium mt-1">
            Set university holidays, examination periods, reduced working hours, and campus closure dates.
          </p>
        </div>

        <Button
          onClick={() => setIsModalOpen(true)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs h-10 px-5 rounded-xl shadow-lg flex items-center gap-2"
        >
          <Plus size={16} /> Add Calendar Event
        </Button>
      </div>

      {/* EVENTS TABLE */}
      <Card className="border border-indigo-900/60 bg-slate-900 rounded-3xl p-6 shadow-xl space-y-4">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <Clock size={18} className="text-indigo-400" /> Scheduled Academic Closures & Events
        </h2>

        {events.length === 0 ? (
          <p className="text-xs text-slate-500 py-8 text-center">No academic calendar events or holidays configured yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-indigo-900/60 text-indigo-300/70 text-[10px] uppercase tracking-wider">
                  <th className="py-3 px-3">Date</th>
                  <th className="py-3 px-3">Event Title</th>
                  <th className="py-3 px-3">Event Type</th>
                  <th className="py-3 px-3">Description</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-indigo-900/40 font-mono">
                {events.map(evt => (
                  <tr key={evt.id} className="hover:bg-indigo-950/40 text-slate-300">
                    <td className="py-3 px-3 font-bold text-white">{evt.dateStr}</td>
                    <td className="py-3 px-3 font-sans font-bold text-indigo-200">{evt.title}</td>
                    <td className="py-3 px-3">
                      <Badge className={`text-[10px] font-bold ${
                        evt.eventType === 'HOLIDAY' ? 'bg-rose-950 text-rose-400 border-rose-800' :
                        evt.eventType === 'EXAM_PERIOD' ? 'bg-amber-950 text-amber-400 border-amber-800' :
                        'bg-purple-950 text-purple-300 border-purple-800'
                      }`}>
                        {evt.eventType}
                      </Badge>
                    </td>
                    <td className="py-3 px-3 font-sans text-slate-400">{evt.description}</td>
                    <td className="py-3 px-3 text-right">
                      <button
                        onClick={() => handleDeleteEvent(evt.id)}
                        className="p-1.5 text-slate-400 hover:text-red-400 rounded-lg hover:bg-slate-800"
                        title="Remove event"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* CREATE EVENT MODAL */}
      {isModalOpen && (
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogContent className="max-w-md bg-slate-900 border border-indigo-900/60 text-white p-6 rounded-3xl space-y-4">
            <DialogHeader className="space-y-1">
              <DialogTitle className="text-lg font-black text-white flex items-center gap-2">
                <Calendar className="text-indigo-400" size={20} /> Add Academic Event / Holiday
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-400 font-medium">
                Mark dates as closed or restricted for student seat bookings.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleCreateEvent} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 block">Event Title</label>
                <Input
                  type="text"
                  placeholder="e.g., Independence Day Holiday"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="h-10 bg-slate-950 border-indigo-900/60 text-white text-xs rounded-xl"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-300 block">Event Type</label>
                  <select
                    value={eventType}
                    onChange={(e) => setEventType(e.target.value)}
                    className="w-full h-10 bg-slate-950 border border-indigo-900/60 text-white text-xs font-medium rounded-xl px-3"
                  >
                    <option value="HOLIDAY">Holiday</option>
                    <option value="EXAM_PERIOD">Exam Period</option>
                    <option value="MAINTENANCE_CLOSURE">Maintenance Closure</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-300 block">Event Date</label>
                  <Input
                    type="date"
                    value={dateStr}
                    onChange={(e) => setDateStr(e.target.value)}
                    className="h-10 bg-slate-950 border-indigo-900/60 text-white text-xs rounded-xl"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 block">Description</label>
                <Input
                  type="text"
                  placeholder="e.g. University closed all day..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="h-10 bg-slate-950 border-indigo-900/60 text-white text-xs rounded-xl"
                />
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-lg mt-2"
              >
                {loading ? 'Adding...' : 'Add Event to Academic Calendar →'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
