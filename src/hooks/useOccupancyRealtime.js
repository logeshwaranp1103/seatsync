import { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Custom hook to subscribe to real-time events for Occupancy management.
 * Subscribes to changes in: bookings, seats, seat_maintenance, slot_occurrences.
 *
 * Features:
 * - Filtered by library where applicable
 * - Debounced callback (300ms) to prevent UI thrashing
 * - Tracks connection status ('live' | 'reconnecting' | 'offline' | 'updating')
 * - Automatic channel cleanup on unmount or filter changes
 */
export function useOccupancyRealtime({ libraryId, onRefetch }) {
  const [connectionStatus, setConnectionStatus] = useState('live');
  const debounceTimerRef = useRef(null);
  const callbackRef = useRef(onRefetch);

  useEffect(() => {
    callbackRef.current = onRefetch;
  }, [onRefetch]);

  const triggerDebouncedRefetch = useCallback(() => {
    setConnectionStatus('updating');
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(async () => {
      try {
        if (callbackRef.current) {
          await callbackRef.current();
        }
        setConnectionStatus('live');
      } catch (err) {
        console.error('[useOccupancyRealtime] Refetch error:', err);
        setConnectionStatus('offline');
      }
    }, 300);
  }, []);

  useEffect(() => {
    const channelName = `occupancy-realtime-${libraryId || 'all'}-${Math.random().toString(36).substring(2, 7)}`;
    const channel = supabase.channel(channelName);

    const tables = ['bookings', 'seats', 'seat_maintenance', 'slot_occurrences'];

    tables.forEach(table => {
      let filterOptions = { event: '*', schema: 'public', table };
      
      // Apply library filter to tables with library_id if libraryId is provided
      if (libraryId && (table === 'bookings' || table === 'slot_occurrences')) {
        filterOptions.filter = `library_id=eq.${libraryId}`;
      }

      channel.on('postgres_changes', filterOptions, (payload) => {
        triggerDebouncedRefetch();
      });
    });

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setConnectionStatus('live');
      } else if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') {
        setConnectionStatus('reconnecting');
      } else if (status === 'CLOSED') {
        setConnectionStatus('offline');
      }
    });

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      supabase.removeChannel(channel);
    };
  }, [libraryId, triggerDebouncedRefetch]);

  return {
    connectionStatus,
    triggerRefetch: triggerDebouncedRefetch
  };
}
