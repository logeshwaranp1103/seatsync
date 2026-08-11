import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Enhanced useSync hook that subscribes to Supabase Realtime postgres_changes
 * while remaining backwards compatible with local broadcast events.
 */
export function useSync(tablesOrCallback, onSyncCallback) {
  let tables = [];
  let callback = null;

  if (Array.isArray(tablesOrCallback)) {
    tables = tablesOrCallback.map(t => t.replace('seatsync_', ''));
    callback = onSyncCallback;
  } else if (typeof tablesOrCallback === 'function') {
    callback = tablesOrCallback;
    tables = ['bookings', 'profiles', 'seats', 'rooms', 'slots', 'waitlist_entries', 'notifications', 'seat_maintenance'];
  }

  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!tables || tables.length === 0) return;

    const channelName = `seatsync-realtime-${Math.random().toString(36).substring(2, 7)}`;
    const channel = supabase.channel(channelName);

    tables.forEach(t => {
      // Map mock names if any
      const tableName = t === 'users' ? 'profiles' : t === 'checkins' ? 'check_in_logs' : t;
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: tableName },
        (payload) => {
          if (callbackRef.current) {
            callbackRef.current({
              type: 'realtime_change',
              table: tableName,
              payload
            });
          }
        }
      );
    });

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tables.join(',')]);

  const broadcast = (data) => {
    try {
      const bc = new BroadcastChannel('seatsync_channel');
      bc.postMessage(data);
      bc.close();
    } catch { /* fallback */ }
  };

  return { broadcast };
}
