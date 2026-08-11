import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

export function useRealtimeSync(tables = [], onRealtimeEvent) {
  const callbackRef = useRef(onRealtimeEvent);
  callbackRef.current = onRealtimeEvent;

  useEffect(() => {
    if (!tables || tables.length === 0) return;

    const channelName = `realtime-sync-${tables.join('-')}-${Math.random().toString(36).substring(2, 7)}`;
    const channel = supabase.channel(channelName);

    tables.forEach(table => {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        (payload) => {
          if (callbackRef.current) {
            callbackRef.current({ table, payload, eventType: payload.eventType });
          }
        }
      );
    });

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        // Connected to Supabase Realtime
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tables.join(',')]);
}
