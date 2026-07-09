// src/middleware/auth.js
// ============================================================
// JWT AUTHENTICATION MIDDLEWARE — WORKSPACE REFACTOR
//
// CHANGES FROM SINGLE-USER VERSION:
//  - SELECT now fetches active_workspace_id (new column on users)
//  - Removed from SELECT: business_name, product_description,
//    target_audience, voice_profile, role, industry, archetype,
//    preferred_platforms — these now live in workspace_profiles
//    and are loaded by resolveWorkspace middleware.
//  - onboarding_completed KEPT on users (Option A) for fast
//    auth-middleware checks without needing a workspace join.
//
// req.user contains: identity + device fields only.
// req.workspaceProfile contains: product/business context.
// resolveWorkspace sets req.workspace, req.membership, req.workspaceProfile.
//
// FIX Issue 8: replaced in-memory Map cache with Redis cache so
// profile invalidations propagate across all instances. clearProfileCache
// is now async — call sites in app.js use fire-and-forget (.catch(()=>{})).
// ============================================================

import supabaseAdmin from '../config/supabase.js';
import { getCache, setCache, deleteCache } from '../services/redis.js';

// ── Redis profile cache (30s TTL) ───────────────────────────
const PROFILE_CACHE_TTL_S = 30;
const profileCacheKey = (userId) => `profile:${userId}`;

export const clearProfileCache = async (userId) => {
  if (userId) await deleteCache(profileCacheKey(userId)).catch(() => {});
};

const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({
      error:   'UNAUTHORIZED',
      message: 'Authentication required. Please log in.',
    });
  }


  const token = authHeader.slice(7);

  try {
    // Verify JWT with Supabase — handles expiry, signature, everything
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({
        error:   'INVALID_TOKEN',
        message: 'Session expired. Please log in again.',
      });
    }

    // Fetch profile — check Redis cache first
    let profile = null;
    const ck = profileCacheKey(user.id);
    profile = await getCache(ck).catch(() => null);

    if (!profile) {
      // WORKSPACE REFACTOR: product/business fields removed from SELECT.
      // They are fetched by resolveWorkspace from workspace_profiles.
      const { data: freshProfile, error: profileError } = await supabaseAdmin
        .from('users')
        .select(
          'id, name, email, tier, active_workspace_id, ' +
          'onboarding_completed, onboarding_step, ' +
          'debug_mode, is_deleted, fcm_token, ' +
          'notification_preferences, memory_enabled, email_digest_enabled, ' +
          'check_in_streak, last_tip_generated_at'
        )
        .eq('id', user.id)
        .single();

      // FIX MED-06: Handle case where user row doesn't exist in database
      if (profileError && profileError.code === 'PGRST116') {
        // No user row found - JWT is valid but account was deleted from DB
        await clearProfileCache(user.id);
        return res.status(404).json({
          error:   'ACCOUNT_NOT_FOUND',
          message: 'Account not found. Please contact support.',
        });
      }

      profile = freshProfile;
      if (profile && !profile.is_deleted) {
        await setCache(ck, profile, PROFILE_CACHE_TTL_S).catch(() => {});
      }
    }

    // Deleted accounts rejected even with a valid JWT
    if (profile?.is_deleted) {
      await clearProfileCache(user.id);
      return res.status(403).json({
        error:   'ACCOUNT_DELETED',
        message: 'This account has been deleted.',
      });
    }

    // FIX MED-06: Additional safety check — profile must exist
    if (!profile) {
      await clearProfileCache(user.id);
      return res.status(404).json({
        error:   'ACCOUNT_NOT_FOUND',
        message: 'Account not found. Please contact support.',
      });
    }

    // Attach identity + device fields only.
    // The raw JWT token is intentionally NOT forwarded on req.user —
    // it has no legitimate use in route handlers and risks accidental
    // logging or leakage in error responses.
    req.user = {
      id:    user.id,
      email: user.email,
      ...profile,
    };

    next();
  } catch (err) {
    console.error('[Auth] Middleware error:', err.message);
    return res.status(401).json({
      error:   'AUTH_ERROR',
      message: 'Authentication failed. Please log in again.',
    });
  }
};

export default authenticate;
