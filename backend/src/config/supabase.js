// src/config/supabase.js
import { createClient } from '@supabase/supabase-js';

// Regular client (for frontend, respects RLS)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

// Admin client (for backend, bypasses RLS)
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Regular client — used by authenticated routes
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Admin client — used ONLY in trusted server contexts
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,  // Admin doesn't need token refresh
    persistSession: false,     // Don't store sessions for admin
  }
});

export default supabaseAdmin;  // Default export for your auth middleware