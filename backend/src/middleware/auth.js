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
  const startTime = Date.now();
  const requestId = req.headers['x-request-id'] || `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  
  console.log(`[AUTH] ⚡ START — ${requestId}`);

  const authHeader = req.headers.authorization;

  // ── Step 1: Check Authorization Header ──────────────────────────────
  console.log(`[AUTH] ${requestId} Checking auth header:`, {
    hasHeader: !!authHeader,
    headerPrefix: authHeader?.startsWith('Bearer ') ? 'Bearer ✓' : 'Invalid',
    method: req.method,
    path: req.path,
    ip: req.ip || req.headers['x-forwarded-for'] || 'unknown',
  });

  if (!authHeader?.startsWith('Bearer ')) {
    console.log(`[AUTH] ${requestId} ❌ No valid Bearer token provided`);
    console.log(`[AUTH] ${requestId} — END (401) — ${Date.now() - startTime}ms`);
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Authentication required. Please log in.',
    });
  }

  const token = authHeader.slice(7);
  console.log(`[AUTH] ${requestId} Token received:`, {
    tokenLength: token.length,
    tokenPreview: token.substring(0, 20) + '...',
  });

  try {
    // ── Step 2: Verify JWT with Supabase ──────────────────────────────
    console.log(`[AUTH] ${requestId} Verifying token with Supabase...`);
    const tokenVerifyStart = Date.now();
    
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    console.log(`[AUTH] ${requestId} Supabase verification:`, {
      success: !!user,
      hasError: !!error,
      errorMessage: error?.message || null,
      errorCode: error?.status || null,
      userId: user?.id || null,
      userEmail: user?.email || null,
      elapsed: `${Date.now() - tokenVerifyStart}ms`,
    });

    if (error || !user) {
      console.log(`[AUTH] ${requestId} ❌ Token verification failed:`, {
        error: error?.message || 'User not found',
        status: error?.status || 401,
      });
      console.log(`[AUTH] ${requestId} — END (401) — ${Date.now() - startTime}ms`);
      return res.status(401).json({
        error: 'INVALID_TOKEN',
        message: error?.message || 'Session expired. Please log in again.',
      });
    }

    // ── Step 3: Fetch/Check Profile ────────────────────────────────────
    console.log(`[AUTH] ${requestId} Fetching user profile for: ${user.id}`);
    
    let profile = null;
    const ck = profileCacheKey(user.id);
    
    console.log(`[AUTH] ${requestId} Checking Redis cache:`, { cacheKey: ck });
    const cacheStart = Date.now();
    
    try {
      profile = await getCache(ck);
      console.log(`[AUTH] ${requestId} Redis cache:`, {
        hit: !!profile,
        elapsed: `${Date.now() - cacheStart}ms`,
      });
    } catch (err) {
      console.warn(`[AUTH] ${requestId} ⚠️ Redis cache error:`, err.message);
    }

    if (!profile) {
      console.log(`[AUTH] ${requestId} Cache miss — fetching from database...`);
      const dbStart = Date.now();

      const { data: freshProfile, error: profileError } = await supabaseAdmin
        .from('users')
        .select(
          'id, name, email, tier, active_workspace_id, ' +
          'onboarding_completed, onboarding_step, ' +
          'debug_mode, is_deleted, fcm_token, ' +
          'notification_preferences, memory_enabled, email_digest_enabled, ' +
          'check_in_streak, last_tip_generated_at, archetype'
        )
        .eq('id', user.id)
        .single();

      console.log(`[AUTH] ${requestId} Database query:`, {
        found: !!freshProfile,
        error: profileError?.message || null,
        errorCode: profileError?.code || null,
        elapsed: `${Date.now() - dbStart}ms`,
      });

      if (profileError && profileError.code === 'PGRST116') {
        console.warn(`[AUTH] ${requestId} ⚠️ User ${user.id} not found in database`);
        console.log(`[AUTH] ${requestId} — END (404) — ${Date.now() - startTime}ms`);
        await clearProfileCache(user.id);
        return res.status(404).json({
          error: 'ACCOUNT_NOT_FOUND',
          message: 'Account not found. Please contact support.',
        });
      }

      profile = freshProfile;
      if (profile && !profile.is_deleted) {
        console.log(`[AUTH] ${requestId} Caching profile in Redis...`);
        await setCache(ck, profile, PROFILE_CACHE_TTL_S).catch((err) => {
          console.warn(`[AUTH] ${requestId} ⚠️ Redis cache set error:`, err.message);
        });
      }
    }

    // ── Step 4: Check if account is deleted ─────────────────────────────
    if (profile?.is_deleted) {
      console.warn(`[AUTH] ${requestId} ⚠️ Account deleted: ${user.id}`);
      console.log(`[AUTH] ${requestId} — END (403) — ${Date.now() - startTime}ms`);
      await clearProfileCache(user.id);
      return res.status(403).json({
        error: 'ACCOUNT_DELETED',
        message: 'This account has been deleted.',
      });
    }

    if (!profile) {
      console.warn(`[AUTH] ${requestId} ⚠️ No profile after fetch for: ${user.id}`);
      console.log(`[AUTH] ${requestId} — END (404) — ${Date.now() - startTime}ms`);
      await clearProfileCache(user.id);
      return res.status(404).json({
        error: 'ACCOUNT_NOT_FOUND',
        message: 'Account not found. Please contact support.',
      });
    }

    // ── Step 5: Attach user to request ──────────────────────────────────
    req.user = {
      id: user.id,
      email: user.email,
      ...profile,
    };

    console.log(`[AUTH] ${requestId} ✅ Authentication successful`, {
      userId: req.user.id,
      email: req.user.email,
      tier: req.user.tier,
      activeWorkspaceId: req.user.active_workspace_id,
      archetype: req.user.archetype || 'Not set',
      onboardingCompleted: req.user.onboarding_completed,
      onboardingStep: req.user.onboarding_step,
      elapsed: `${Date.now() - startTime}ms`,
    });

    console.log(`[AUTH] ${requestId} — END (200, next()) — ${Date.now() - startTime}ms`);
    next();

  } catch (err) {
    // ── Step 6: Handle unexpected errors ───────────────────────────────
    console.error(`[AUTH] ${requestId} ❌ Unexpected error:`, {
      error: err.message,
      stack: err.stack,
      name: err.name,
      code: err.code,
      status: err.status || 500,
    });

    console.log(`[AUTH] ${requestId} — END (500) — ${Date.now() - startTime}ms`);
    return res.status(401).json({
      error: 'AUTH_ERROR',
      message: 'Authentication failed. Please log in again.',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
};

export default authenticate;
