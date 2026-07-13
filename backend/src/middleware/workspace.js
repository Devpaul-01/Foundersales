// src/middleware/workspace.js
import supabaseAdmin from '../config/supabase.js';
import { getCache, setCache, deleteCache } from '../services/redis.js';
import { WORKSPACE_MANAGER_ROLES } from '../config/constants.js';
import { clearProfileCache } from './auth.js';

const WS_CTX_TTL_S = 30;

const ROLE_ORDER = ['member', 'manager', 'admin', 'owner'];
const roleRank = (role) => ROLE_ORDER.indexOf(role);

const cacheKey = (userId, workspaceId) => `ws:ctx:${userId}:${workspaceId}`;

export const clearWorkspaceCache = async (userIdOrIds, workspaceId = null) => {
  const ids = Array.isArray(userIdOrIds) ? userIdOrIds : [userIdOrIds];
  if (!workspaceId) return;
  await Promise.all(ids.map(uid => deleteCache(cacheKey(uid, workspaceId)).catch(() => {})));
};

// Unified cache invalidation — clears BOTH the in-memory profile cache (auth.js)
// AND the Redis workspace context cache in one atomic call.
// Every code path that changes a user's role, membership, or profile MUST use this.
// Split calls risk serving a stale role for up to 30s in a permission-critical path.
export const clearUserContext = async (userIdOrIds, workspaceId = null) => {
  const ids = Array.isArray(userIdOrIds) ? userIdOrIds : [userIdOrIds];
  ids.forEach(uid => clearProfileCache(uid));
  if (workspaceId) {
    await clearWorkspaceCache(ids, workspaceId);
  }
};

export const resolveWorkspace = async (req, res, next) => {
  const userId      = req.user?.id;
  const workspaceId = req.user?.active_workspace_id;

  if (!workspaceId) {
    return res.status(400).json({ error: 'NO_ACTIVE_WORKSPACE', message: 'No active workspace.' });
  }

  const ck = cacheKey(userId, workspaceId);
  try {
    const cached = await getCache(ck);
    if (cached) {
      req.workspace        = cached.workspace;
      req.membership       = cached.membership;
      req.workspaceProfile = cached.workspaceProfile;
      return next();
    }
  } catch {}

  try {
    const [wsResult, memberResult, profileResult] = await Promise.all([
      supabaseAdmin.from('workspaces').select('*').eq('id', workspaceId).eq('is_deleted', false).single(),
      supabaseAdmin.from('workspace_members').select('*').eq('workspace_id', workspaceId).eq('user_id', userId).eq('status', 'active').single(),
      supabaseAdmin.from('workspace_profiles').select('*').eq('workspace_id', workspaceId).eq('user_id', userId).maybeSingle(),
    ]);

    if (!wsResult.data) {
      return res.status(404).json({ error: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found or deleted.' });
    }
    if (!memberResult.data) {
      return res.status(403).json({ error: 'NOT_A_MEMBER', message: 'You are not an active member.' });
    }

    req.workspace        = wsResult.data;
    req.membership       = memberResult.data;
    req.workspaceProfile = profileResult.data ?? null;

    try {
      await setCache(ck, {
        workspace:        req.workspace,
        membership:       req.membership,
        workspaceProfile: req.workspaceProfile,
      }, WS_CTX_TTL_S);
    } catch {}

    next();
  } catch (dbError) {
    console.error('[Workspace] DB error in resolveWorkspace:', dbError.message);
    return res.status(503).json({
      error:   'DATABASE_UNAVAILABLE',
      message: 'Unable to verify workspace access. Please try again.',
    });
  }
};

export const requirePermission = (minRole) => (req, res, next) => {
  if (!req.membership) return res.status(403).json({ error: 'PERMISSION_DENIED', message: 'Workspace context not loaded.' });
  if (minRole === 'owner') {
    if (req.membership.role !== 'owner') return res.status(403).json({ error: 'PERMISSION_DENIED', message: "Requires 'owner' role." });
    return next();
  }
  if (roleRank(req.membership.role) < roleRank(minRole)) {
    return res.status(403).json({ error: 'PERMISSION_DENIED', message: `Requires '${minRole}' role or higher.` });
  }
  next();
};

// tier reads exclusively from req.user.tier (the billing source of truth).
// workspaces.plan is a denormalised copy that can silently diverge from
// users.tier after a billing event — removed from this read path entirely.
export const buildUserContext = (req) => ({
  ...(req.workspaceProfile || {}),
  id:                  req.user.id,
  user_id:             req.user.id,
  email:               req.user.email,
  name:                req.user.name,
  archetype: req.user.archetype,
  tier:                req.user.tier,
  fcm_token:           req.user.fcm_token,
  debug_mode:          req.user.debug_mode,
  workspace_id:        req.workspace?.id,
  active_workspace_id: req.workspace?.id,
});

export const isManagerOrAbove = (role) => WORKSPACE_MANAGER_ROLES.includes(role);
