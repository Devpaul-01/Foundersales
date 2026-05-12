import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL     = import.meta.env.VITE_SUPABASE_URL     as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    '[Foundersales] Missing Supabase env vars. ' +
    'Realtime subscriptions will not work. ' +
    'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
  );
}

/**
 * Supabase client — used ONLY for Realtime subscriptions.
 * All data fetching goes through the Foundersales Express API.
 */
export const supabase = createClient(
  SUPABASE_URL  || 'https://placeholder.supabase.co',
  SUPABASE_ANON_KEY || 'placeholder',
  {
    auth: {
      persistSession:   false,
      autoRefreshToken: false,
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  },
);

export function isRealtimeConnected(): boolean {
  const channels = supabase.getChannels();
  return channels.some((ch) => (ch as unknown as { state: string }).state === 'joined');
}
