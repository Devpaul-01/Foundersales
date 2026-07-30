// src/routes/auth.js
// ============================================================
// AUTH ROUTES — HTTP-ONLY COOKIE REFRESH TOKEN
// ============================================================
//
// PHASE 3 (Redis Store & Rate Limiting Consistency refactor): the
// emailSendingRateLimiter previously defined inline in this file called
// `createRateLimitStore()` with no namespace, silently defaulting to the
// 'default' Redis key space shared by several other unrelated limiters
// (see config/rateLimitStore.js header comment). It's now
// LIMITERS.authEmailLimiter, defined once in config/limiters.js with its
// own 'auth_email' namespace. Behavior (5/hour/IP) is unchanged.

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import supabaseAdmin from '../config/supabase.js';
import authenticate from '../middleware/auth.js';
import { createLogger } from '../utils/logger.js';
import { LIMITERS } from '../config/limiters.js';

const router = Router();
const { log, logError, logDB, logJob } = createLogger('Auth');

const elapsedMs = (startMs) => `${Date.now() - startMs}ms`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Cookie configuration
const cookieConfig = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/api/auth/refresh', // Only sent to refresh endpoint
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
};

// Same as cookieConfig but without maxAge — use this with res.clearCookie(),
// since Express deprecates passing maxAge there (it now always expires immediately).
const { maxAge: _unusedMaxAge, ...clearCookieConfig } = cookieConfig;

const registerSchema = z.object({
  email: z.string().email('Invalid email format').max(255),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  name: z.string().max(100).optional(),
});

const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1, 'Password required'),
});

// ──────────────────────────────────────────
// POST /api/auth/register
// ──────────────────────────────────────────
router.post('/register', validate(registerSchema), asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const { name, email, password } = req.body;
  const clientIp = req.ip || req.headers['x-forwarded-for'] || 'unknown';

  log('REGISTER Request', { ip: clientIp });

  const normalizedEmail = email.trim().toLowerCase();

  const { data: authData, error: authError } = await supabaseAdmin.auth.signUp({
    email: normalizedEmail,
    password,
    options: {
      data: { name: name?.trim() || '' },
      emailRedirectTo: process.env.OAUTH_REDIRECT_URL || `${process.env.FRONTEND_URL}/auth/callback`,
    },
  });

  if (authData?.user?.identities?.length === 0) {
    return res.status(409).json({
      error: 'EMAIL_TAKEN',
      message: 'An account with this email already exists. Please sign in.',
    });
  }

  if (authError) {
    const isEmailTaken = authError.message?.toLowerCase().includes('already registered') ||
                         authError.message?.toLowerCase().includes('user already registered');
    if (isEmailTaken) {
      return res.status(409).json({
        error: 'EMAIL_TAKEN',
        message: 'An account with this email already exists. Please sign in.',
      });
    }
    logError('POST /register → signUp', authError, { ip: clientIp });
    return res.status(400).json({
      error: 'REGISTRATION_ERROR',
      message: authError.message || 'Registration failed. Please try again.',
    });
  }

  const userId = authData.user?.id;
  if (!userId) {
    logError('POST /register → signUp', new Error('No userId returned'), { ip: clientIp });
    return res.status(500).json({
      error: 'REGISTRATION_FAILED',
      message: 'Account setup failed. Please try again.',
    });
  }

  log('REGISTER Step 1 Done — Auth User Created', { userId, elapsed: elapsedMs(startTime) });

  const profileCreated = await createUserWithWorkspaceRetry(userId, {
    name: name?.trim() || null,
    email: normalizedEmail,
    tier: 'free',
  });

  if (!profileCreated) {
    logError('POST /register → createUserWithWorkspaceRetry', new Error('All retries exhausted'), { userId });
    await deleteAuthUserWithRetry(userId);
    return res.status(500).json({
      error: 'REGISTRATION_FAILED',
      message: 'Account setup failed. Please try again in a moment.',
    });
  }

  log('REGISTER Complete', { userId, needsVerification: true, elapsed: elapsedMs(startTime) });
  return res.status(201).json({
    success: true,
    needsVerification: true,
    message: 'Account created! Please check your email to verify your account before signing in.',
    email: normalizedEmail,
  });
}));

router.post('/set-password', asyncHandler(async (req, res) => {
  const { access_token, new_password } = req.body;

  if (!access_token || !new_password) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Access token and new password are required',
    });
  }

  if (new_password.length < 8) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Password must be at least 8 characters',
    });
  }

  const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(access_token);

  if (userError || !user) {
    return res.status(401).json({
      error: 'INVALID_TOKEN',
      message: 'Invalid or expired reset link.',
    });
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
    password: new_password,
  });

  if (error) {
    logError('POST /set-password', error);
    return res.status(400).json({
      error: 'SET_PASSWORD_FAILED',
      message: error.message || 'Failed to set password. Please try again.',
    });
  }

  // Stamp has_password: true so future logins can detect it correctly.
  // (Supabase auto-creates an email identity for OAuth users, so we can't
  //  use identity presence as a proxy — only this metadata flag is reliable.)
  await supabaseAdmin.auth.admin.updateUserById(user.id, {
    user_metadata: { has_password: true },
  });

  res.json({
    success: true,
    message: 'Password set successfully! You can now log in with email and password.',
  });
}));

router.post('/reset-password', asyncHandler(async (req, res) => {
  const { access_token, new_password } = req.body;

  if (!access_token || !new_password) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Access token and new password are required',
    });
  }

  if (new_password.length < 8) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Password must be at least 8 characters',
    });
  }

  const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(access_token);

  if (userError || !user) {
    return res.status(401).json({
      error: 'INVALID_TOKEN',
      message: 'Invalid or expired reset link.',
    });
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
    password: new_password,
  });

  if (error) {
    logError('POST /reset-password', error);
    return res.status(400).json({
      error: 'RESET_FAILED',
      message: error.message || 'Failed to reset password. Please request a new reset link.',
    });
  }

  // Stamp has_password: true — same reasoning as /set-password.
  await supabaseAdmin.auth.admin.updateUserById(user.id, {
    user_metadata: { has_password: true },
  });

  res.json({
    success: true,
    message: 'Password reset successfully! You can now log in with your new password.',
  });
}));

// ──────────────────────────────────────────
// POST /api/auth/login — WITH HTTP-ONLY COOKIE
// ──────────────────────────────────────────
// POST /api/auth/login — WITH HTTP-ONLY COOKIE + ONBOARDING STATUS
router.post('/login', validate(loginSchema), asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const { email, password } = req.body;
  const clientIp = req.ip || req.headers['x-forwarded-for'] || 'unknown';

  log('LOGIN Request', { ip: clientIp });

  const { data, error } = await supabaseAdmin.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });

  if (error) {
    log('LOGIN Failed', { reason: error.message, ip: clientIp });
    const isInvalid = error.message?.toLowerCase().includes('invalid') ||
                      error.message?.toLowerCase().includes('credentials');
    return res.status(isInvalid ? 401 : 400).json({
      error: isInvalid ? 'INVALID_CREDENTIALS' : 'LOGIN_ERROR',
      message: isInvalid ? 'Incorrect email or password.' : error.message,
    });
  }

  // Set refresh_token as HTTP-only cookie
  res.cookie('refresh_token', data.session.refresh_token, cookieConfig);

  const userId = data.user?.id;
  
  // ✅ Fetch onboarding status for this user
  let onboardingStatus = { step: 0, completed: false };
  
  if (userId) {
    try {
      // Get user's active workspace
      // Fetch the user's profile to get active_workspace_id and fallback onboarding values.
      // We skip workspace_members entirely — the is_active column doesn't exist and
      // silently fails, leaving onboarding_step stuck at 0.
      const { data: userProfile } = await supabaseAdmin
        .from('users')
        .select('active_workspace_id, onboarding_step, onboarding_completed')
        .eq('id', userId)
        .maybeSingle();

      if (userProfile?.active_workspace_id) {
        const { data: profile } = await supabaseAdmin
          .from('workspace_profiles')
          .select('onboarding_step, onboarding_completed')
          .eq('workspace_id', userProfile.active_workspace_id)
          .eq('user_id', userId)
          .maybeSingle();

        if (profile) {
          onboardingStatus = {
            step: profile.onboarding_step || 0,
            completed: profile.onboarding_completed || false,
          };
        } else if (userProfile) {
          onboardingStatus = {
            step: userProfile.onboarding_step || 0,
            completed: userProfile.onboarding_completed || false,
          };
        }
      } else if (userProfile) {
        onboardingStatus = {
          step: userProfile.onboarding_step || 0,
          completed: userProfile.onboarding_completed || false,
        };
      }
    } catch (err) {
      log('LOGIN Onboarding fetch warning', { error: err.message });
    }
  }

  log('LOGIN Success', { 
    userId: data.user?.id, 
    onboarding_step: onboardingStatus.step, 
    elapsed: elapsedMs(startTime) 
  });
  
  // ✅ Return access_token + onboarding status together
  return res.json({
    access_token: data.session?.access_token,
    refresh_token: data.session?.refresh_token,
    expires_in: data.session?.expires_in,
    token_type: 'Bearer',
    user: {
      id: data.user?.id,
      email: data.user?.email,
      name: data.user?.user_metadata?.name,
    },
    onboarding: onboardingStatus,
  });
}));

// ──────────────────────────────────────────
// POST /api/auth/refresh — READ REFRESH TOKEN FROM COOKIE
// ──────────────────────────────────────────
router.post('/refresh', asyncHandler(async (req, res) => {
  // Get refresh_token from cookie instead of request body
  const refresh_token = req.cookies?.refresh_token;
  
  if (!refresh_token) {
    return res.status(401).json({ 
      error: 'REFRESH_FAILED', 
      message: 'No refresh token found' 
    });
  }

  const { data, error } = await supabaseAdmin.auth.refreshSession({ refresh_token });
  
  if (error) {
    // Clear the invalid cookie
    res.clearCookie('refresh_token', clearCookieConfig);
    return res.status(401).json({ 
      error: 'REFRESH_FAILED', 
      message: error.message 
    });
  }


  // Set the new refresh_token as HTTP-only cookie
  if (data.session?.refresh_token) {
    res.cookie('refresh_token', data.session.refresh_token, cookieConfig);
  }

  res.json({
    access_token: data.session?.access_token,
    expires_in: data.session?.expires_in,
    token_type: 'Bearer',
  });
}));

// ──────────────────────────────────────────
// POST /api/auth/logout — CLEAR COOKIE
// ──────────────────────────────────────────
router.post('/logout', asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const authHeader = req.headers.authorization;
  const refresh_token = req.cookies?.refresh_token;
  const clientIp = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  
  log('LOGOUT Request', { ip: clientIp, hasToken: !!authHeader });

  // Clear the refresh token cookie first
  res.clearCookie('refresh_token', clearCookieConfig);
  

  // Invalidate the access token if present
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      await supabaseAdmin.auth.admin.signOut(token);
      log('LOGOUT Success — Access token invalidated', { elapsed: elapsedMs(startTime) });
    } catch (error) {
      log('LOGOUT Warning — Token invalidation failed', { reason: error.message });
    }
  }

  // If we have a refresh token, try to revoke it too
  if (refresh_token) {
    try {
      // Attempt to sign out with refresh token
      await supabaseAdmin.auth.refreshSession({ refresh_token });
    } catch (err) {
      // Ignore errors here
    }
  }

  res.json({ 
    success: true, 
    message: 'Logged out successfully' 
  });
}));


router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const userId = req.user.id;
  const workspaceId = req.user.active_workspace_id;

  log('GET /me START', { 
    userId, 
    workspaceId,
    hasActiveWorkspace: !!workspaceId,
    timestamp: new Date().toISOString(),
  });

  try {
    // ── Step 1: Fetch user profile ──────────────────────────────────────────
    log('GET /me FETCH_PROFILE', { userId });

    const [profileResult, workspaceResult] = await Promise.all([
      supabaseAdmin
        .from('users')
        .select(
          'id, name, email, tier, check_in_streak, active_workspace_id, ' +
          'onboarding_completed, onboarding_step, debug_mode, fcm_token, ' +
          'notification_preferences, memory_enabled, email_digest_enabled'
        )
        .eq('id', userId)
        .single(),
      
      req.user.active_workspace_id
        ? supabaseAdmin
            .from('workspace_members')
            .select(`
              role, status, joined_at,
              workspaces!inner(id, name, slug, plan, owner_user_id)
            `)
            .eq('workspace_id', req.user.active_workspace_id)
            .eq('user_id', userId)
            .eq('status', 'active')
            .single()
        : Promise.resolve({ data: null }),
    ]);

    // ── Step 2: Log query results ──────────────────────────────────────────
    log('GET /me QUERY_RESULTS', {
      userId,
      profileFound: !!profileResult.data,
      profileError: profileResult.error?.message || null,
      membershipFound: !!workspaceResult.data,
      membershipError: workspaceResult.error?.message || null,
      elapsed: `${Date.now() - startTime}ms`,
    });

    // ── Step 3: Handle missing profile ─────────────────────────────────────
    if (!profileResult.data) {
      log('GET /me PROFILE_NOT_FOUND', {
        userId,
        error: profileResult.error?.message || 'No profile found',
        elapsed: `${Date.now() - startTime}ms`,
      });

      return res.status(404).json({
        error: 'PROFILE_NOT_FOUND',
        message: 'User profile not found',
        details: profileResult.error?.message || null,
      });
    }

    // ── Step 4: Build response ──────────────────────────────────────────────
    const profile = profileResult.data;
    const membership = workspaceResult.data;

    // ── Step 5: Log successful response ────────────────────────────────────
    log('GET /me SUCCESS', {
      userId,
      email: profile.email,
      tier: profile.tier,
      activeWorkspaceId: profile.active_workspace_id,
      onboardingCompleted: profile.onboarding_completed,
      onboardingStep: profile.onboarding_step,
      hasActiveMembership: !!membership,
      membershipRole: membership?.role || null,
      workspaceName: membership?.workspaces?.name || null,
      workspaceSlug: membership?.workspaces?.slug || null,
      elapsed: `${Date.now() - startTime}ms`,
    });

    res.json({
      user: profile,
      active_workspace: membership?.workspaces || null,
      active_membership: membership
        ? {
            role: membership.role,
            status: membership.status,
            joined_at: membership.joined_at,
          }
        : null,
    });

  } catch (err) {
    // ── Step 6: Handle unexpected errors ──────────────────────────────────
    logError('GET /me UNEXPECTED_ERROR', err, {
      userId,
      workspaceId,
      elapsed: `${Date.now() - startTime}ms`,
      stack: err.stack,
    });

    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Could not fetch user profile. Please try again.',
    });
  }
}));
// ──────────────────────────────────────────
// POST /api/auth/profile/ensure
// ──────────────────────────────────────────
// src/routes/auth.js - Update the profile/ensure endpoint
router.post('/profile/ensure', authenticate, asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const authUser  = req.user;
  const { name, provider = 'email' } = req.body;
  const email = authUser.email;

  log('PROFILE/ENSURE Request', { userId: authUser.id, provider });

  // Only trust user_metadata.has_password — Supabase auto-creates an email
  // identity for every Google OAuth user, so identity presence ≠ password set.
  const hasPassword = authUser?.user_metadata?.has_password === true;

  logDB('SELECT', 'users', { userId: authUser.id, purpose: 'exists_check' });
  const { data: existingProfile } = await supabaseAdmin
    .from('users')
    .select('id, email, name, tier, onboarding_completed, active_workspace_id, onboarding_step')
    .eq('id', authUser.id)
    .single();

  if (existingProfile) {
    log('PROFILE/ENSURE — Profile Already Exists', { userId: authUser.id, provider });
    return res.json({ 
      user: {
        ...existingProfile,
        has_password: hasPassword,
      }, 
      isNewUser: false 
    });
  }

  logDB('RPC', 'create_user_with_workspace', { userId: authUser.id, email, tier: 'free' });
  const profileCreated = await createUserWithWorkspaceRetry(authUser.id, {
    name:  name?.trim() || null,
    email,
    tier:  'free',
  });

  if (!profileCreated) {
    logError('POST /profile/ensure → createUserWithWorkspaceRetry', new Error('All retries exhausted'), { userId: authUser.id });
    return res.status(500).json({
      error:   'PROFILE_CREATION_FAILED',
      message: 'Could not create your profile. Please try again.',
    });
  }

  const { data: newProfile } = await supabaseAdmin
    .from('users')
    .select('id, email, name, tier, onboarding_completed, active_workspace_id, onboarding_step')
    .eq('id', authUser.id)
    .single();

  log('PROFILE/ENSURE Complete — New Profile Created', { userId: authUser.id, provider, elapsed: elapsedMs(startTime) });
  
  res.status(201).json({ 
    user: { 
      ...(newProfile || { id: authUser.id, email, tier: 'free' }),
      has_password: hasPassword,
      onboarding_step: newProfile?.onboarding_step || 0,
      onboarding_completed: newProfile?.onboarding_completed || false,
    }, 
    isNewUser: true,
  });
}));
// ──────────────────────────────────────────
// GET /api/auth/google/url
// ──────────────────────────────────────────
router.get('/google/url', asyncHandler(async (req, res) => {
  const redirectTo =
    `${process.env.FRONTEND_URL || 'http://localhost:5173'}/auth/callback`;

  const { data, error } = await supabaseAdmin.auth.signInWithOAuth({
    provider: 'google',
    options:  { redirectTo, queryParams: { access_type: 'offline', prompt: 'consent' } },
  });

  if (error || !data?.url) {
    logError('GET /google/url → signInWithOAuth', error || new Error('No URL returned'));
    return res.status(500).json({ error: 'OAUTH_ERROR', message: 'Could not generate Google sign-in URL.' });
  }

  res.json({ url: data.url });
}));

// ──────────────────────────────────────────
// POST /api/auth/google/callback
// ──────────────────────────────────────────

router.post('/google/callback', asyncHandler(async (req, res) => {
  const { access_token, refresh_token, expires_in } = req.body;
  const clientIp = req.ip || req.headers['x-forwarded-for'] || 'unknown';

  if (!access_token) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Access token required' });
  }

  try {
    // ── Step 1: Verify token with Supabase ─────────────────────
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(access_token);

    if (error || !user) {
      logError('POST /google/callback → getUser', error, { ip: clientIp });
      return res.status(401).json({
        error: 'GOOGLE_AUTH_FAILED',
        message: 'Could not authenticate with Google. Please try again.',
      });
    }

    if (refresh_token) {
      res.cookie('refresh_token', refresh_token, cookieConfig);
    }

    const userId    = user.id;
    const userEmail = user.email;
    const userName  = user.user_metadata?.full_name || user.user_metadata?.name;
    // Only trust user_metadata.has_password — Supabase auto-creates an email
    // identity for every Google OAuth user, so identity presence ≠ password set.
    const hasPassword = user?.user_metadata?.has_password === true;

    let onboardingStatus = { step: 0, completed: false };
    let isNewUser = false;

    // ── Step 2: Check users table ──────────────────────────────
    const { data: existingProfile, error: profileError } = await supabaseAdmin
      .from('users')
      .select('id, onboarding_completed, onboarding_step, active_workspace_id')
      .eq('id', userId)
      .single();

    if (existingProfile) {
      // ── Step 3: Onboarding lookup via active_workspace_id ─────
      // Skip workspace_members entirely — the is_active column doesn't exist
      // and silently fails. active_workspace_id on the users row is the
      // canonical source of truth.
      try {
        if (existingProfile.active_workspace_id) {
          const { data: wsProfile, error: wsError } = await supabaseAdmin
            .from('workspace_profiles')
            .select('onboarding_step, onboarding_completed')
            .eq('workspace_id', existingProfile.active_workspace_id)
            .eq('user_id', userId)
            .maybeSingle();

          if (wsProfile) {
            onboardingStatus = {
              step: wsProfile.onboarding_step || 0,
              completed: wsProfile.onboarding_completed || false,
            };
          } else {
            // Workspace profile not populated yet — fall back to users table
            onboardingStatus = {
              step: existingProfile.onboarding_step || 0,
              completed: existingProfile.onboarding_completed || false,
            };
          }
        } else {
          // No active workspace yet — use users table directly
          onboardingStatus = {
            step: existingProfile.onboarding_step || 0,
            completed: existingProfile.onboarding_completed || false,
          };
        }
      } catch (err) {
        log('GOOGLE CALLBACK onboarding fetch warning', { error: err.message });
        // Safe fallback
        onboardingStatus = {
          step: existingProfile.onboarding_step || 0,
          completed: existingProfile.onboarding_completed || false,
        };
      }

      // ── Step 5: isNewUser determination ───────────────────────
      isNewUser = !onboardingStatus.completed && onboardingStatus.step === 0;

    } else {
      // ── No profile — brand new user ───────────────────────────
      isNewUser = true;
      const profileCreated = await createUserWithWorkspaceRetry(userId, {
        name: userName || null,
        email: userEmail,
        tier: 'free',
      });

      if (!profileCreated) {
        logError('POST /google/callback → createUserWithWorkspaceRetry', new Error('Profile creation failed'), { userId });
      }
    }

    // ── Step 6: Final response ─────────────────────────────────
    const responsePayload = {
      access_token,
      expires_in: expires_in || 3600,
      token_type: 'Bearer',
      user: {
        id: user.id,
        email: user.email,
        name: userName,
        has_password: hasPassword,
      },
      isNewUser,
      onboarding: onboardingStatus,
    };

    log('GOOGLE CALLBACK Success', { userId, isNewUser, onboarding: onboardingStatus });
    res.json(responsePayload);

  } catch (err) {
    logError('POST /google/callback', err, { ip: clientIp });
    res.status(500).json({
      error: 'GOOGLE_AUTH_FAILED',
      message: 'Authentication failed. Please try again.',
    });
  }
}));
// ──────────────────────────────────────────
// POST /api/auth/resend-verification
// ──────────────────────────────────────────
// PHASE 3: LIMITERS.authEmailLimiter — see file header for why this
// endpoint specifically needs a tighter, purpose-specific limit beyond
// the general router-level authLimiter.
router.post('/resend-verification', LIMITERS.authEmailLimiter, asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email?.trim()) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Email is required' });
  }

  const { error } = await supabaseAdmin.auth.resend({
    type:  'signup',
    email: email.trim().toLowerCase(),
  });

  if (error) {
    log('RESEND-VERIFICATION Supabase Non-Fatal Warning', { reason: error.message });
  }

  res.json({
    success: true,
    message: 'If an account with this email exists, a verification email has been sent.',
  });
}));

// ──────────────────────────────────────────
// POST /api/auth/verify-email
// ──────────────────────────────────────────
router.post('/verify-email', asyncHandler(async (req, res) => {
  const { token, email } = req.body;

  if (!token || !email) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Token and email are required',
    });
  }

  // Verify the email confirmation token
  const { error } = await supabaseAdmin.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token,
    type: 'email',
  });

  if (error) {
    logError('POST /verify-email', error);
    return res.status(400).json({
      error: 'VERIFICATION_FAILED',
      message: 'Invalid or expired verification token. Please request a new verification email.',
    });
  }

  res.json({
    success: true,
    message: 'Email verified successfully! You can now log in.',
  });
}));

// ──────────────────────────────────────────
// POST /api/auth/forgot-password
// ──────────────────────────────────────────
// PHASE 3: LIMITERS.authEmailLimiter — see file header.
router.post('/forgot-password', LIMITERS.authEmailLimiter, asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email?.trim()) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Email is required',
    });
  }

  const redirectTo = `${process.env.FRONTEND_URL}/reset-password`;

  const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo,
  });

  if (error) {
    logError('POST /forgot-password', error);
    // Don't reveal if email exists or not for security
    return res.json({
      success: true,
      message: 'If an account exists with this email, you will receive password reset instructions.',
    });
  }

  res.json({
    success: true,
    message: 'Password reset email sent. Please check your inbox.',
  });
}));

// ──────────────────────────────────────────
// POST /api/auth/reset-password
// ──────────────────────────────────────────


// ── Internal helpers ─────────────────────────────────────────

const createUserWithWorkspaceRetry = async (userId, data, maxRetries = 3) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logJob('createUserWithWorkspace', { status: 'attempt', attempt, maxRetries, userId });

      const { error } = await supabaseAdmin.rpc('create_user_with_workspace', {
        p_user_id: userId,
        p_email:   data.email,
        p_name:    data.name  || null,
        p_tier:    data.tier  || 'free',
      });

      if (!error) {
        logJob('createUserWithWorkspace', { status: 'success', attempt, userId });
        return true;
      }

      if (error.message?.includes('duplicate key') || error.message?.includes('unique constraint')) {
        logJob('createUserWithWorkspace', { status: 'already_exists_ok', attempt, userId });
        return true;
      }

      logError(`createUserWithWorkspaceRetry attempt ${attempt}/${maxRetries}`, error, { userId });
      if (attempt < maxRetries) await sleep(attempt * 500);
    } catch (err) {
      logError(`createUserWithWorkspaceRetry exception attempt ${attempt}/${maxRetries}`, err, { userId });
      if (attempt < maxRetries) await sleep(attempt * 500);
    }
  }
  return false;
};

const deleteAuthUserWithRetry = async (userId, maxRetries = 3) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (!error) {
        logJob('deleteAuthUser', { status: 'success', attempt, userId });
        return;
      }
      logError(`deleteAuthUser attempt ${attempt}/${maxRetries}`, error, { userId });
      if (attempt < maxRetries) await sleep(attempt * 1000);
    } catch (err) {
      logError(`deleteAuthUser exception attempt ${attempt}/${maxRetries}`, err, { userId });
      if (attempt < maxRetries) await sleep(attempt * 1000);
    }
  }
  logError('deleteAuthUser', new Error(`CRITICAL: Orphaned auth user ${userId} — manual cleanup required.`));
};

export default router;
