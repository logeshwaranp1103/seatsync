import { supabase, isUUID } from '../lib/supabase.js';
import { db } from './mockDatabase.js';

export const notificationService = {
  async getNotifications(userId) {
    if (isUUID(userId)) {
      try {
        const { data, error } = await supabase
          .from('notifications')
          .select('*')
          .eq('recipient_id', userId)
          .order('created_at', { ascending: false });

        if (!error && data) {
          return data.map(n => ({
            id: n.id,
            userId: n.recipient_id,
            title: n.title,
            message: n.message,
            priority: n.priority,
            isRead: n.is_read,
            read: n.is_read,
            createdAt: n.created_at,
            timestamp: n.created_at
          }));
        }
      } catch { /* fallback */ }
    }

    const raw = (await db.read('seatsync_notifications')) || [];
    return raw
      .filter(n => n && (n.userId === userId || n.studentId === userId))
      .map(n => ({
        ...n,
        createdAt: n.createdAt || new Date().toISOString(),
        isRead: Boolean(n.isRead || n.read)
      }));
  },

  async addNotification({ userId, title, message, priority = 'NORMAL' }) {
    if (isUUID(userId)) {
      try {
        const { data, error } = await supabase
          .from('notifications')
          .insert({
            recipient_id: userId,
            type: 'OPERATIONAL_NOTICE',
            title,
            message,
            priority,
            is_read: false
          })
          .select()
          .single();

        if (!error && data) {
          return {
            id: data.id,
            userId: data.recipient_id,
            title: data.title,
            message: data.message,
            priority: data.priority,
            isRead: false,
            createdAt: data.created_at
          };
        }
      } catch { /* fallback */ }
    }

    const notifications = (await db.read('seatsync_notifications')) || [];
    const nowIso = new Date().toISOString();
    const newNotif = {
      id: `NOTIF-${Date.now()}`,
      userId,
      title,
      message,
      createdAt: nowIso,
      isRead: false
    };
    notifications.unshift(newNotif);
    await db.write('seatsync_notifications', notifications);
    return newNotif;
  },

  async markAsRead(notificationId) {
    try {
      await supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', notificationId);
    } catch { /* fallback */ }

    const notifications = (await db.read('seatsync_notifications')) || [];
    const target = notifications.find(n => n.id === notificationId);
    if (target) {
      target.isRead = true;
      target.read = true;
      await db.write('seatsync_notifications', notifications);
    }
  },

  async markAllAsRead(userId) {
    try {
      await supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('recipient_id', userId);
    } catch { /* fallback */ }

    const notifications = (await db.read('seatsync_notifications')) || [];
    notifications.forEach(n => {
      if (n.userId === userId || n.studentId === userId) {
        n.isRead = true;
        n.read = true;
      }
    });
    await db.write('seatsync_notifications', notifications);
  }
};
