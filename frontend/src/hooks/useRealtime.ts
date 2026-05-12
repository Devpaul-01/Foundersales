import { useEffect } from 'react';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

interface UseRealtimeChannelOptions {
  channelName: string;
  table:       string;
  event?:      'INSERT' | 'UPDATE' | 'DELETE' | '*';
  filter?:     string;
  onPayload:   (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void;
  enabled?:    boolean;
}

/**
 * Subscribe to a Supabase postgres_changes channel.
 * Used for:
 *  1. Practice session delivery status (chat_messages UPDATE on chat_id)
 *  2. Calendar event prep_generated (user_events UPDATE on event_id)
 */
export function useRealtimeChannel({
  channelName,
  table,
  event   = 'UPDATE',
  filter,
  onPayload,
  enabled = true,
}: UseRealtimeChannelOptions) {
  useEffect(() => {
    if (!enabled) return;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event,
          schema: 'public',
          table,
          ...(filter ? { filter } : {}),
        },
        onPayload,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  // onPayload intentionally excluded — wrap in useCallback at call site
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, table, event, filter, enabled]);
}
