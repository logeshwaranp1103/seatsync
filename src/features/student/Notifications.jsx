import React, { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { notificationService } from '../../services/notificationService';
import { useSync } from '../../hooks/useSync';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import { Bell, CheckCircle2, Clock, Check, Sparkles } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import toast from 'react-hot-toast';

function formatRelativeTime(dateInput) {
  if (!dateInput) return 'Recently';
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return 'Recently';
    return formatDistanceToNow(d, { addSuffix: true });
  } catch {
    return 'Recently';
  }
}

export default function Notifications() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifs = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const data = await notificationService.getNotifications(user.id);
      setNotifications(data);
    } catch {
      toast.error('Failed to load notifications');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifs();
  }, [user]);

  useSync((event) => {
    if (event?.type === 'storage_change') {
      fetchNotifs();
    }
  });

  const handleMarkAsRead = async (id) => {
    await notificationService.markAsRead(id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
  };

  const handleMarkAllRead = async () => {
    if (!user) return;
    await notificationService.markAllAsRead(user.id);
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    toast.success('All notifications marked as read');
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight">Notifications</h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-0.5">
            Seat booking updates, waitlist alerts, and library notices.
          </p>
        </div>

        {notifications.some(n => !n.isRead) && (
          <Button
            type="button"
            variant="outline"
            onClick={handleMarkAllRead}
            className="text-xs font-bold rounded-xl"
          >
            Mark All as Read
          </Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-24 bg-white rounded-2xl border border-slate-200 animate-pulse" />)}
        </div>
      ) : notifications.length === 0 ? (
        <Card className="border border-slate-200 shadow-xs rounded-2xl bg-white p-8 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 text-brandBlue flex items-center justify-center mx-auto">
            <Bell size={24} />
          </div>
          <p className="text-xs text-slate-500 font-medium">You have no notifications right now.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {notifications.map(n => (
            <Card
              key={n.id}
              className={`border transition-all rounded-2xl overflow-hidden ${!n.isRead ? 'border-brandBlue/40 bg-blue-50/30' : 'border-slate-200 bg-white'}`}
            >
              <CardContent className="p-4 flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={`font-bold text-sm ${!n.isRead ? 'text-brandBlue' : 'text-navy'}`}>{n.title}</span>
                    {!n.isRead && <Badge className="bg-brandBlue text-white text-[9px] px-2 py-0.5">New</Badge>}
                  </div>
                  <p className="text-slate-600 leading-relaxed text-[11px] font-medium">{n.message}</p>
                  <span className="text-[10px] text-slate-400 font-mono block pt-1">
                    {formatRelativeTime(n.createdAt || n.timestamp)}
                  </span>
                </div>

                {!n.isRead && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleMarkAsRead(n.id)}
                    className="text-xs font-bold text-brandBlue hover:bg-blue-100/60 rounded-xl"
                  >
                    <Check size={14} className="mr-1" /> Read
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
