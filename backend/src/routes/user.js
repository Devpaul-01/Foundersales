// src/routes/user.js
import { Router }        from 'express';
import { asyncHandler }  from '../middleware/errorHandler.js';
import { createLogger }  from '../utils/logger.js';
import { clearUserContext } from '../middleware/workspace.js';
import supabaseAdmin     from '../config/supabase.js';
import { createHash }    from 'crypto';
import { DEFAULT_NOTIFICATION_PREFS, ACTIVITY_EVENTS } from '../config/constants.js';

const router = Router();
const { log, logError, logDB } = createLogger('User');

// PUT /api/user/fcm-token
router.put('/fcm-token', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { token } = req.body;
  if (!token?.trim()) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'token is required' });
  }
  logDB('UPDATE', 'users', { userId, field: 'fcm_token' });
  const { error } = await supabaseAdmin.from('users').update({ fcm_token: token.trim() }).eq('id', userId);
  if (error) { logError('PUT /fcm-token', error, { userId }); return res.status(500).json({ error: 'DB_ERROR', message: error.message }); }
  res.json({ success: true });
}));

// PUT /api/user/debug
router.put('/debug', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { enabled } = req.body;
  logDB('UPDATE', 'users', { userId, field: 'debug_mode', value: !!enabled });
  const { error } = await supabaseAdmin.from('users').update({ debug_mode: !!enabled }).eq('id', userId);
  if (error) return res.status(500).json({ error: 'DB_ERROR', message: error.message });
  res.json({ success: true, debug_mode: !!enabled });
}));

// PUT /api/user/notification-preferences
router.put('/notification-preferences', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const ALLOWED_PREF_KEYS = Object.keys(DEFAULT_NOTIFICATION_PREFS);

  const prefs = {};
  for (const key of ALLOWED_PREF_KEYS) {
    if (req.body[key] !== undefined) prefs[key] = !!req.body[key];
  }

  const hasMemoryEnabled      = req.body.memory_enabled !== undefined;
  const hasEmailDigestEnabled = req.body.email_digest_enabled !== undefined;

  if (!Object.keys(prefs).length && !hasMemoryEnabled && !hasEmailDigestEnabled) {
    return res.status(400).json({
      error:   'VALIDATION_ERROR',
      message: `At least one valid preference key required: ${ALLOWED_PREF_KEYS.join(', ')}`,
    });
  }

  const { data: existing } = await supabaseAdmin.from('users')
    .select('notification_preferences').eq('id', userId).single();

  const mergedPrefs = { ...(existing?.notification_preferences || DEFAULT_NOTIFICATION_PREFS), ...prefs };
  const userUpdates = { notification_preferences: mergedPrefs };
  if (hasMemoryEnabled)      userUpdates.memory_enabled       = !!req.body.memory_enabled;
  if (hasEmailDigestEnabled) userUpdates.email_digest_enabled = !!req.body.email_digest_enabled;

  logDB('UPDATE', 'users', { userId, fields: Object.keys(userUpdates).join(',') });
  const { error } = await supabaseAdmin.from('users').update(userUpdates).eq('id', userId);
  if (error) { logError('PUT /notification-preferences', error, { userId }); return res.status(500).json({ error: 'DB_ERROR', message: error.message }); }

  res.json({ success: true, notification_preferences: mergedPrefs });
}));

// GET /api/user/memory
router.get('/memory', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { data: facts, error } = await supabaseAdmin
    .from('user_memory')
    .select('id, fact, fact_category, reinforcement_count, last_reinforced_at, created_at')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('reinforcement_count', { ascending: false })
    .limit(30);
  if (error) throw error;
  res.json({ facts: facts || [] });
}));

// DELETE /api/user/memory/:id
router.delete('/memory/:id', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { data: fact, error: lookupError } = await supabaseAdmin
    .from('user_memory').select('id').eq('id', req.params.id).eq('user_id', userId).single();
  if (lookupError || !fact) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Memory fact not found' });
  }
  const { error } = await supabaseAdmin.from('user_memory').update({ is_active: false }).eq('id', req.params.id);
  if (error) throw error;
  res.json({ success: true });
}));

// GET /api/user/workspaces
router.get('/workspaces', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  log('LIST WORKSPACES', { userId });

  const { data: memberships, error } = await supabaseAdmin
    .from('workspace_members')
    .select(`role, status, joined_at, workspaces!inner(id, name, slug, plan, owner_user_id, created_at)`)
    .eq('user_id', userId)
    .eq('status', 'active')
    .eq('workspaces.is_deleted', false)
    .order('joined_at', { ascending: true });

  if (error) throw error;

  const workspaces = (memberships || []).map(m => ({
    ...m.workspaces,
    role:      m.role,
    joined_at: m.joined_at,
    is_active: m.workspaces.id === req.user.active_workspace_id,
  }));

  log('LIST WORKSPACES OK', { userId, count: workspaces.length });
  res.json({ workspaces });
}));

// POST /api/user/switch-workspace
router.post('/switch-workspace', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { workspace_id } = req.body;

  if (!workspace_id) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'workspace_id is required' });
  }

  log('SWITCH WORKSPACE', { userId, targetWorkspaceId: workspace_id });

  const { data: membership } = await supabaseAdmin
    .from('workspace_members')
    .select('role, status')
    .eq('workspace_id', workspace_id)
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();

  if (!membership) {
    return res.status(403).json({ error: 'NOT_A_MEMBER', message: 'You are not an active member of this workspace.' });
  }

  const { data: workspace } = await supabaseAdmin
    .from('workspaces').select('id, name, plan').eq('id', workspace_id).eq('is_deleted', false).single();

  if (!workspace) return res.status(404).json({ error: 'WORKSPACE_NOT_FOUND' });

  logDB('UPDATE', 'users', { userId, active_workspace_id: workspace_id });
  await supabaseAdmin.from('users').update({ active_workspace_id: workspace_id }).eq('id', userId);

  // Clear old workspace context and new workspace context atomically
  await clearUserContext(userId, req.user.active_workspace_id);
  await clearUserContext(userId, workspace_id);

  log('SWITCH WORKSPACE OK', { userId, workspaceId: workspace_id, role: membership.role });
  res.json({ success: true, workspace: { ...workspace, role: membership.role } });
}));

// POST /api/user/accept-invite/:token
router.post('/accept-invite/:token', asyncHandler(async (req, res) => {
  const userId         = req.user.id;
  const plaintextToken = req.params.token;

  if (!plaintextToken) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Invite token is required' });
  }

  log('ACCEPT INVITE', { userId });
  const tokenHash = createHash('sha256').update(plaintextToken).digest('hex');

  const { data: result, error } = await supabaseAdmin.rpc('accept_workspace_invite', {
    p_user_id:    userId,
    p_token_hash: tokenHash,
  });

  if (error) {
    logError('accept_workspace_invite RPC', error, { userId });
    return res.status(500).json({ error: 'INVITE_FAILED', message: 'Failed to process invite' });
  }

  if (result?.error) {
    const statusMap = { INVALID_OR_EXPIRED_TOKEN: 410, ALREADY_A_MEMBER: 409 };
    return res.status(statusMap[result.error] || 400).json({
      error:   result.error,
      message: result.error === 'INVALID_OR_EXPIRED_TOKEN'
        ? 'This invite link is invalid or has expired.'
        : 'You are already a member of this workspace.',
    });
  }

  const workspaceId = result?.workspace_id;
  const role        = result?.role || 'member';

  await supabaseAdmin.from('users').update({ active_workspace_id: workspaceId }).eq('id', userId);

  // Unified invalidation — clears profile + workspace context in one call
  await clearUserContext(userId, req.user.active_workspace_id);
  await clearUserContext(userId, workspaceId);

  await supabaseAdmin.from('workspace_activity').insert({
    workspace_id: workspaceId,
    user_id:      userId,
    event_type:   ACTIVITY_EVENTS.MEMBER_JOINED,
    metadata:     { name: req.user.name || req.user.email },
  }).catch(() => {});

  const { data: workspace } = await supabaseAdmin
    .from('workspaces').select('id, name, slug, plan').eq('id', workspaceId).single();

  log('ACCEPT INVITE OK', { userId, workspaceId, role });
  res.json({
    success:             true,
    workspace,
    role,
    message:             `Welcome to ${workspace?.name || 'the workspace'}!`,
    needs_profile_setup: true,
  });
}));

// GET /api/user/notifications
// Returns the most recent in-app notification history for the current user.
router.get('/notifications', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const limit  = Math.min(parseInt(req.query.limit || '30', 10), 100);
  const offset = parseInt(req.query.offset || '0', 10);

  const { data: notifications, error } = await supabaseAdmin
    .from('user_notifications')
    .select('id, title, body, data, is_read, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;

  const { count: unreadCount } = await supabaseAdmin
    .from('user_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_read', false);

  res.json({ notifications: notifications || [], unread_count: unreadCount || 0 });
}));

// POST /api/user/notifications/:id/read
// Marks a single notification as read. Scoped to the requesting user.
router.post('/notifications/:id/read', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;

  const { data: notification } = await supabaseAdmin
    .from('user_notifications')
    .select('id')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (!notification) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Notification not found' });
  }

  await supabaseAdmin
    .from('user_notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('id', id);

  res.json({ success: true });
}));

// POST /api/user/notifications/read-all
// Marks all unread notifications as read for the current user.
router.post('/notifications/read-all', asyncHandler(async (req, res) => {
  const userId = req.user.id;

  await supabaseAdmin
    .from('user_notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('is_read', false);

  res.json({ success: true });
}));

// ─── EXPORTED HANDLERS ────────────────────────────────────────

export const updateProfile = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  log('Profile Update — Request', { userId, receivedFields: Object.keys(req.body).join(',') || 'none' });

  const USER_FIELDS              = ['name'];
  const WORKSPACE_PROFILE_FIELDS = [
    'business_name', 'product_description', 'target_audience',
    'website', 'role', 'industry', 'experience_level', 'bio', 'preferred_platforms',
  ];

  const userUpdates    = {};
  const profileUpdates = {};

  for (const key of USER_FIELDS)              { if (req.body[key] !== undefined) userUpdates[key]    = req.body[key]; }
  for (const key of WORKSPACE_PROFILE_FIELDS) { if (req.body[key] !== undefined) profileUpdates[key] = req.body[key]; }

  if (!Object.keys(userUpdates).length && !Object.keys(profileUpdates).length) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'No valid fields to update' });
  }

  if (Object.keys(profileUpdates).length && !req.user.active_workspace_id) {
    return res.status(400).json({
      error:   'NO_ACTIVE_WORKSPACE',
      message: 'Cannot update profile fields without an active workspace.',
    });
  }

  const ops = [];
  if (Object.keys(userUpdates).length) {
    logDB('UPDATE', 'users', { userId, fields: Object.keys(userUpdates).join(',') });
    ops.push(supabaseAdmin.from('users').update(userUpdates).eq('id', userId));
  }
  if (Object.keys(profileUpdates).length) {
    logDB('UPDATE', 'workspace_profiles', { userId, fields: Object.keys(profileUpdates).join(',') });
    ops.push(
      supabaseAdmin.from('workspace_profiles')
        .update({ ...profileUpdates, updated_at: new Date().toISOString() })
        .eq('workspace_id', req.user.active_workspace_id)
        .eq('user_id', userId)
    );
  }

  const results    = await Promise.all(ops);
  const firstError = results.find(r => r.error)?.error;
  if (firstError) {
    logError('PUT /auth/me', firstError, { userId });
    return res.status(500).json({ error: 'DB_ERROR', message: firstError.message });
  }

  // Unified invalidation — clears both profile cache (auth.js) AND workspace
  // context cache (Redis). Previously only clearWorkspaceCache was called,
  // leaving the in-memory profileCache stale for up to 30s after a name change.
  if (req.user.active_workspace_id) {
    await clearUserContext(userId, req.user.active_workspace_id);
  }

  log('Profile Update — Done', { userId });
  res.json({ success: true });
});

export const deleteAccount = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  log('Account Delete — Request', { userId });

  const { data: ownedWorkspaces } = await supabaseAdmin
    .from('workspaces').select('id').eq('owner_user_id', userId).eq('is_deleted', false);

  const ownedWorkspaceIds = (ownedWorkspaces || []).map(w => w.id);

  if (ownedWorkspaceIds.length) {
    const { data: affectedMembers } = await supabaseAdmin
      .from('workspace_members').select('user_id')
      .in('workspace_id', ownedWorkspaceIds).eq('status', 'active').neq('user_id', userId);

    const affectedIds = (affectedMembers || []).map(m => m.user_id);

    if (affectedIds.length) {
      for (const wsId of ownedWorkspaceIds) {
        await supabaseAdmin.from('users')
          .update({ active_workspace_id: null })
          .in('id', affectedIds).eq('active_workspace_id', wsId);
        await clearUserContext(affectedIds, wsId);
      }
    }

    await supabaseAdmin.from('workspaces')
      .update({ is_deleted: true, deleted_at: new Date().toISOString() })
      .in('id', ownedWorkspaceIds);
  }

  const { data: nonOwnedMemberships } = await supabaseAdmin
    .from('workspace_members').select('id, workspace_id')
    .eq('user_id', userId).eq('status', 'active')
    .not('workspace_id', 'in', `(${ownedWorkspaceIds.length ? ownedWorkspaceIds.join(',') : 'null'})`);

  if (nonOwnedMemberships?.length) {
    await supabaseAdmin.from('workspace_members')
      .update({ status: 'removed' })
      .in('id', nonOwnedMemberships.map(m => m.id));
  }

  logDB('UPDATE', 'users', { userId, purpose: 'soft_delete_pii_scrub' });
  const { error: softDeleteError } = await supabaseAdmin.from('users').update({
    is_deleted:          true,
    fcm_token:           null,
    active_workspace_id: null,
    deleted_at:          new Date().toISOString(),
    name:                null,
    email:               `deleted_${userId}@deleted.invalid`,
  }).eq('id', userId);

  if (softDeleteError) {
    logError('DELETE /auth/account → soft_delete', softDeleteError, { userId });
    return res.status(500).json({ error: 'DELETE_FAILED', message: 'Account deletion failed.' });
  }

  const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (authDeleteError) {
    logError('DELETE /auth/account → auth_hard_delete (non-fatal)', authDeleteError, { userId });
  }

  await clearUserContext(userId, null);
  log('Account Delete — Done', { userId, authRevoked: !authDeleteError });
  res.json({ success: true, message: 'Your account has been deleted.' });
});

export default router;
