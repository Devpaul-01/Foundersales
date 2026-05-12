// src/routes/auth.js
// ============================================================
// AUTH ROUTES — WORKSPACE REFACTOR
//
// FIXES APPLIED (refinement plan):
//  Section 6: Zod registerSchema and loginSchema added to POST /register
//             and POST /login using the existing validate middleware.
//             This adds structured validation errors before any DB call,
//             replacing the ad-hoc if/else checks (kept inline as fallbacks
//             but now redundant for the validated fields).
// ============================================================

import { Router }       from 'express';
import { z }            from 'zod';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validate }     from '../middleware/validate.js';
import supabaseAdmin    from '../config/supabase.js';
import authenticate     from '../middleware/auth.js';
import { createLogger } from '../utils/logger.js';

const router = Router();
const { log, logError, logDB, logJob } = createLogger('Auth');

const elapsedMs = (startMs) => `${Date.now() - startMs}ms`;
const sleep     = (ms) => new Promise(r => setTimeout(r, ms));

// Section 6: Zod schemas
// registerSchema: validates before the auth.signUp call so invalid payloads
// never hit Supabase, giving the client a structured VALIDATION_ERROR response.
const registerSchema = z.object({
  email:    z.string().email('Invalid email format').max(255),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  name:     z.string().max(100).optional(),
});

// loginSchema: light validation — email/password presence and format.
// The full auth check (wrong credentials) is still handled by Supabase.
const loginSchema = z.object({
  email:    z.string().email().max(255),
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

  // Inline guards are now redundant for email/password (Zod handles them)
  // but kept for explicitness in error messaging.
  if (!email?.trim()) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Email is required' });
  }
  if (!password) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Password is required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Password must be at least 8 characters' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  log('REGISTER Validation Passed', { hasName: !!name?.trim(), ip: clientIp });

  log('REGISTER Step 1 — Creating Supabase Auth User', { ip: clientIp });
  const { data: authData, error: authError } = await supabaseAdmin.auth.signUp({
    email:    normalizedEmail,
    password,
    options: {
      data: { name: name?.trim() || '' },
      emailRedirectTo:
        process.env.OAUTH_REDIRECT_URL ||
        `${process.env.FRONTEND_URL}/auth/callback`,
    },
  });

  if (authData?.user?.identities?.length === 0) {
    log('REGISTER Blocked — Email Already Registered (identities=[])', { ip: clientIp });
    return res.status(409).json({
      error:   'EMAIL_TAKEN',
      message: 'An account with this email already exists. Please sign in.',
    });
  }

  if (authError) {
    const isEmailTaken =
      authError.message?.toLowerCase().includes('already registered') ||
      authError.message?.toLowerCase().includes('user already registered');
    if (isEmailTaken) {
      return res.status(409).json({
        error:   'EMAIL_TAKEN',
        message: 'An account with this email already exists. Please sign in.',
      });
    }
    logError('POST /register → signUp', authError, { ip: clientIp });
    return res.status(400).json({
      error:   'REGISTRATION_ERROR',
      message: authError.message || 'Registration failed. Please try again.',
    });
  }

  const userId = authData.user?.id;
  if (!userId) {
    logError('POST /register → signUp', new Error('No userId returned'), { ip: clientIp });
    return res.status(500).json({
      error:   'REGISTRATION_FAILED',
      message: 'Account setup failed. Please try again.',
    });
  }

  log('REGISTER Step 1 Done — Auth User Created', { userId, elapsed: elapsedMs(startTime) });

  log('REGISTER Step 2 — Creating User + Workspace (atomic RPC)', { userId });
  logDB('RPC', 'create_user_with_workspace', { userId, tier: 'free', hasName: !!name?.trim() });

  const profileCreated = await createUserWithWorkspaceRetry(userId, {
    name:  name?.trim() || null,
    email: normalizedEmail,
    tier:  'free',
  });

  if (!profileCreated) {
    logError('POST /register → createUserWithWorkspaceRetry', new Error('All retries exhausted'), { userId });
    logJob('deleteAuthUser', { userId, reason: 'workspace_creation_failed', action: 'rollback' });
    await deleteAuthUserWithRetry(userId);
    return res.status(500).json({
      error:   'REGISTRATION_FAILED',
      message: 'Account setup failed. Please try again in a moment.',
    });
  }

  log('REGISTER Complete', { userId, needsVerification: true, elapsed: elapsedMs(startTime) });
  return res.status(201).json({
    success:           true,
    needsVerification: true,
    message:           'Account created! Please check your email to verify your account before signing in.',
    email:             normalizedEmail,
  });
}));

// ──────────────────────────────────────────
// POST /api/auth/login
// ──────────────────────────────────────────
router.post('/login', validate(loginSchema), asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const { email, password } = req.body;
  const clientIp = req.ip || req.headers['x-forwarded-for'] || 'unknown';

  log('LOGIN Request', { ip: clientIp });

  if (!email?.trim() || !password) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Email and password are required' });
  }

  const { data, error } = await supabaseAdmin.auth.signInWithPassword({
    email:    email.trim().toLowerCase(),
    password,
  });

  if (error) {
    log('LOGIN Failed', { reason: error.message, ip: clientIp });
    const isInvalid =
      error.message?.toLowerCase().includes('invalid') ||
      error.message?.toLowerCase().includes('credentials');
    return res.status(isInvalid ? 401 : 400).json({
      error:   isInvalid ? 'INVALID_CREDENTIALS' : 'LOGIN_ERROR',
      message: isInvalid ? 'Incorrect email or password.' : error.message,
    });
  }

  log('LOGIN Success', { userId: data.user?.id, elapsed: elapsedMs(startTime) });
  return res.json({
    access_token:  data.session?.access_token,
    refresh_token: data.session?.refresh_token,
    expires_in:    data.session?.expires_in,
    user: {
      id:    data.user?.id,
      email: data.user?.email,
    },
  });
}));

// ──────────────────────────────────────────
// POST /api/auth/logout
// ──────────────────────────────────────────
router.post('/logout', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    await supabaseAdmin.auth.admin.signOut(token).catch(() => {});
  }
  res.json({ success: true });
}));

// ──────────────────────────────────────────
// POST /api/auth/refresh
// ──────────────────────────────────────────
router.post('/refresh', asyncHandler(async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'refresh_token required' });
  }

  const { data, error } = await supabaseAdmin.auth.refreshSession({ refresh_token });
  if (error) {
    return res.status(401).json({ error: 'REFRESH_FAILED', message: error.message });
  }

  res.json({
    access_token:  data.session?.access_token,
    refresh_token: data.session?.refresh_token,
    expires_in:    data.session?.expires_in,
  });
}));

// ──────────────────────────────────────────
// GET /api/auth/me
// ──────────────────────────────────────────
router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const [profileResult, workspaceResult] = await Promise.all([
    supabaseAdmin
      .from('users')
      .select(
        'id, name, email, tier, active_workspace_id, ' +
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

  if (!profileResult.data) {
    return res.status(404).json({ error: 'PROFILE_NOT_FOUND', message: 'User profile not found' });
  }

  const profile    = profileResult.data;
  const membership = workspaceResult.data;

  res.json({
    user:               profile,
    active_workspace:   membership?.workspaces || null,
    active_membership:  membership
      ? { role: membership.role, status: membership.status, joined_at: membership.joined_at }
      : null,
  });
}));

// ──────────────────────────────────────────
// POST /api/auth/profile/ensure
// ──────────────────────────────────────────
router.post('/profile/ensure', authenticate, asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const authUser  = req.user;
  const { name, provider = 'email' } = req.body;
  const email = authUser.email;

  log('PROFILE/ENSURE Request', { userId: authUser.id, provider });

  logDB('SELECT', 'users', { userId: authUser.id, purpose: 'exists_check' });
  const { data: existingProfile } = await supabaseAdmin
    .from('users')
    .select('id, email, name, tier, onboarding_completed, active_workspace_id')
    .eq('id', authUser.id)
    .single();

  if (existingProfile) {
    log('PROFILE/ENSURE — Profile Already Exists', { userId: authUser.id, provider });
    return res.json({ user: existingProfile, isNewUser: false });
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
    .select('id, email, name, tier, onboarding_completed, active_workspace_id')
    .eq('id', authUser.id)
    .single();

  log('PROFILE/ENSURE Complete — New Profile Created', { userId: authUser.id, provider, elapsed: elapsedMs(startTime) });
  res.status(201).json({ user: newProfile || { id: authUser.id, email, tier: 'free' }, isNewUser: true });
}));

// ──────────────────────────────────────────
// GET /api/auth/google/url
// ──────────────────────────────────────────
router.get('/google/url', asyncHandler(async (req, res) => {
  const redirectTo =
    process.env.OAUTH_REDIRECT_URL ||
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
// POST /api/auth/resend-verification
// ──────────────────────────────────────────
router.post('/resend-verification', asyncHandler(async (req, res) => {
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
      if (!error) return;
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
