import React, { useState, useEffect } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { db } from '../../services/mockDatabase';
import { adminService } from '../../services/adminService';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Input } from '../../components/shared/Input';
import { Badge } from '../../components/shared/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/shared/Dialog';
import { Megaphone, Plus, Bell, Send, CheckCircle2, Clock, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function AnnouncementsPage() {
  const { user: adminUser } = useAuth();
  const [announcements, setAnnouncements] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form State
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [targetRole, setTargetRole] = useState('ALL');
  const [priority, setPriority] = useState('NORMAL');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadAnnouncements();
  }, []);

  const loadAnnouncements = async () => {
    try {
      const data = (await db.read('seatsync_announcements')) || [];
      setAnnouncements(data.reverse());
    } catch (err) {
      console.warn('Failed to load announcements:', err);
    }
  };

  const handleBroadcast = async (e) => {
    e.preventDefault();
    if (!title.trim() || !message.trim()) {
      toast.error('Please enter announcement title and message.');
      return;
    }

    setLoading(true);
    try {
      await adminService.createAnnouncement({
        title,
        message,
        targetRole,
        priority,
        adminUser
      });

      toast.success('Announcement broadcasted across platform!');
      setIsModalOpen(false);
      setTitle('');
      setMessage('');
      await loadAnnouncements();
    } catch (err) {
      toast.error('Failed to broadcast announcement.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      const list = (await db.read('seatsync_announcements')) || [];
      const updated = list.filter(a => a.id !== id);
      await db.write('seatsync_announcements', updated);
      toast.success('Announcement removed.');
      await loadAnnouncements();
    } catch (err) {
      toast.error('Failed to remove announcement.');
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
            <Megaphone className="text-indigo-600" size={28} /> Announcements & Broadcast Centre
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Dispatch platform announcements, emergency alerts, maintenance notices, and targeted broadcasts.
          </p>
        </div>

        <Button
          onClick={() => setIsModalOpen(true)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs h-10 px-5 rounded-xl shadow-xs flex items-center gap-2"
        >
          <Plus size={16} /> Broadcast Announcement
        </Button>
      </div>

      {/* ANNOUNCEMENT LIST */}
      <Card className="border border-slate-200/80 bg-white rounded-2xl p-6 shadow-xs space-y-4">
        <h2 className="text-base font-bold text-navy flex items-center gap-2">
          <Bell size={18} className="text-indigo-600" /> Active Broadcasted Announcements
        </h2>

        {announcements.length === 0 ? (
          <p className="text-xs text-slate-400 py-8 text-center">No announcements broadcasted yet.</p>
        ) : (
          <div className="space-y-3">
            {(announcements || []).map(ann => (
              <div key={ann.id} className="p-4 bg-slate-50 border border-slate-200/80 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge className={`text-[10px] font-bold ${
                      ann.priority === 'URGENT' ? 'bg-red-600 text-white' : 'bg-indigo-600 text-white'
                    }`}>
                      {ann.priority}
                    </Badge>
                    <span className="text-xs font-bold text-navy">{ann.title}</span>
                  </div>
                  <button
                    onClick={() => handleDelete(ann.id)}
                    className="p-1 text-slate-400 hover:text-red-600 rounded-lg hover:bg-slate-100"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <p className="text-xs text-slate-600 font-sans">{ann.message}</p>
                <div className="flex items-center justify-between pt-1 text-[10px] font-mono text-slate-400 border-t border-slate-200/60">
                  <span>Target: {ann.targetRole}</span>
                  <span>Issued: {new Date(ann.createdAt).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* CREATE MODAL */}
      {isModalOpen && (
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogContent className="max-w-md bg-white border border-slate-200 text-navy p-6 rounded-2xl space-y-4 shadow-2xl">
            <DialogHeader className="space-y-1">
              <DialogTitle className="text-lg font-black text-navy flex items-center gap-2">
                <Megaphone className="text-indigo-600" size={20} /> Broadcast System Announcement
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500 font-medium">
                Dispatch an emergency alert or general announcement across student & staff portals.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleBroadcast} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">Announcement Title</label>
                <Input
                  type="text"
                  placeholder="e.g., Scheduled Server Maintenance Tonight"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="h-10 bg-slate-50 border-slate-300 text-navy text-xs rounded-xl"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">Target Audience</label>
                  <select
                    value={targetRole}
                    onChange={(e) => setTargetRole(e.target.value)}
                    className="w-full h-10 bg-slate-50 border border-slate-300 text-navy text-xs font-medium rounded-xl px-3"
                  >
                    <option value="ALL">All Platform Users</option>
                    <option value="STUDENT">Students Only</option>
                    <option value="LIBRARIAN">Librarians Only</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">Priority Level</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    className="w-full h-10 bg-slate-50 border border-slate-300 text-navy text-xs font-medium rounded-xl px-3"
                  >
                    <option value="NORMAL">Normal</option>
                    <option value="HIGH">High Priority</option>
                    <option value="URGENT">Urgent / Emergency</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">Announcement Message</label>
                <textarea
                  rows={3}
                  placeholder="Write clear notification message..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="w-full p-3 bg-slate-50 border border-slate-300 text-navy text-xs font-medium rounded-xl focus:border-indigo-500 outline-none"
                />
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs mt-2 flex items-center justify-center gap-2"
              >
                <Send size={16} /> {loading ? 'Broadcasting...' : 'Broadcast Announcement Now →'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
