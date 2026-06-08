// src/routes/workspaces.js
import { Router }           from 'express';
import { createHash, randomBytes } from 'crypto';
import { asyncHandler }     from '../middleware/errorHandler.js';
import { requirePermission, clearWorkspaceCache, clearUserContext } from '../middleware/workspace.js';
import { validate }         from '../middleware/validate.js';
import { createWorkspaceSchema, inviteSchema, updateRoleSchema, transferOwnershipSchema, nudgeSchema } from '../validators/workspace.js';
import { sendWorkspaceInviteEmail } from '../services/email.js';
import { notifyUser }       from '../services/notifications.js';
import supabaseAdmin        from '../config/supabase.js';
import { ACTIVITY_EVENTS }  from '../config/constants.js';
import { createLogger }     from '../utils/logger.js';

const router = Router();
const { log, logError } = createLogger('Workspaces');

export const writeActivity = async (workspaceId, userId, eventType, metadata = {}) => {
  await supabaseAdmin.from('workspace_activity').insert({
    workspace_id: workspaceId, user_id: userId, event_type: eventType, metadata,
  }).catch(err => console.error('[Workspaces] activity write failed:', err.message));
};

const getActiveMemberIds = async (workspaceId) => {
  const { data } = await supabaseAdmin.from('workspace_members').select('user_id')
    .eq('workspace_id', workspaceId).eq('status', 'active');
  return (data || []).map(m => m.user_id);
};

// GET /api/workspaces/:id/members
router.get('/:id/members', asyncHandler(async (req, res) => {
  const workspaceId        = req.params.id;
  const requestWorkspaceId = req.workspace?.id;
  const TAG = '[GET-MEMBERS]';
  const { data, error } = await supabaseAdmin
  .from('users')
  .select('id, email');
  console.log(data?.length);
  console.log(data);
  console.log(error);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`${TAG} ========== REQUEST START ==========`);
  console.log(`${TAG} timestamp      :`, new Date().toISOString());
  console.log(`${TAG} param id       :`, workspaceId,        '| type:', typeof workspaceId);
  console.log(`${TAG} req.workspace.id:`, requestWorkspaceId, '| type:', typeof requestWorkspaceId);
  console.log(`${TAG} match          :`, workspaceId === requestWorkspaceId);
  console.log(`${TAG} caller user_id :`, req.user?.id);
  console.log(`${TAG} caller email   :`, req.user?.email);

  if (workspaceId !== requestWorkspaceId) {
    console.log(`${TAG} ❌ PERMISSION_DENIED — workspace id mismatch`);
    return res.status(403).json({ error: 'PERMISSION_DENIED' });
  }

  // ── STEP 1: workspace_members ────────────────────────────────────────────
  console.log(`\n${TAG} ── STEP 1: fetching workspace_members ──`);
  const { data: memberRows, error: memberError } = await supabaseAdmin
    .from('workspace_members')
    .select('id, user_id, role, status, invite_email, invited_by, joined_at, created_at')
    .eq('workspace_id', workspaceId)
    .in('status', ['active', 'pending_invite', 'suspended'])
    .order('created_at', { ascending: true });

  if (memberError) {
    console.log(`${TAG} ❌ workspace_members query error:`, memberError);
    throw memberError;
  }

  console.log(`${TAG} ✅ workspace_members rows returned:`, memberRows?.length ?? 0);
  (memberRows || []).forEach((m, i) => {
    console.log(`${TAG}   [${i}] id=${m.id} | user_id=${m.user_id ?? 'NULL'} | status=${m.status} | role=${m.role} | invite_email=${m.invite_email ?? '-'}`);
  });

  // ── STEP 2: collect user_ids ─────────────────────────────────────────────
  console.log(`\n${TAG} ── STEP 2: collecting user_ids ──`);
  const allUserIds     = (memberRows || []).map(m => m.user_id);
  const userIds        = allUserIds.filter(Boolean);
  const nullCount      = allUserIds.length - userIds.length;

  console.log(`${TAG} all user_id values (raw):`, JSON.stringify(allUserIds));
  console.log(`${TAG} after filter(Boolean)   :`, JSON.stringify(userIds));
  console.log(`${TAG} null/undefined user_ids :`, nullCount);
  console.log(`${TAG} ids to look up          :`, userIds.length);
  userIds.forEach((id, i) => {
    console.log(`${TAG}   [${i}] "${id}" | length=${id.length} | type=${typeof id}`);
  });

  // ── STEP 3: users table lookup ───────────────────────────────────────────
  console.log(`\n${TAG} ── STEP 3: querying users table ──`);
  let userMap = {};

  if (userIds.length > 0) {
    console.log(`${TAG} running: .from('users').select('id, name, email').in('id', [...${userIds.length}])`);

    const { data: users, error: usersError, status: usersStatus, statusText } = await supabaseAdmin
      .from('users')
      .select('id, name, email')
      .in('id', userIds);

    console.log(`${TAG} response HTTP status  :`, usersStatus, statusText ?? '');
    console.log(`${TAG} usersError            :`, usersError ?? 'null');
    console.log(`${TAG} users rows returned   :`, users?.length ?? 0);

    if (usersError) {
      console.log(`${TAG} ❌ users lookup error:`, JSON.stringify(usersError, null, 2));
    } else {
      console.log(`${TAG} ✅ users found:`);
      (users || []).forEach((u, i) => {
        console.log(`${TAG}   [${i}] id="${u.id}" | name="${u.name}" | email="${u.email}"`);
      });

      // Exact match check — compare each requested id against what came back
      console.log(`\n${TAG} ── per-id match check ──`);
      const returnedIds = new Set((users || []).map(u => u.id));
      userIds.forEach(id => {
        const found = returnedIds.has(id);
        console.log(`${TAG}   ${found ? '✅' : '❌ MISSING'} "${id}"`);
      });

      userMap = Object.fromEntries((users || []).map(u => [u.id, u]));
    }

    // ── STEP 3b: individual fallback for any missing ids ──────────────────
    // If .in() returned fewer rows than expected, probe each missing id individually
    // to rule out a query-level issue vs a data issue.
    const missingIds = userIds.filter(id => !userMap[id]);
    if (missingIds.length > 0) {
      console.log(`\n${TAG} ── STEP 3b: individual fallback queries for ${missingIds.length} missing id(s) ──`);
      for (const id of missingIds) {
        // .eq() single-row probe
        const { data: single, error: singleErr } = await supabaseAdmin
          .from('users')
          .select('id, name, email')
          .eq('id', id)
          .maybeSingle();

        console.log(`${TAG}   .eq('id','${id}') →`, singleErr
          ? `ERROR: ${singleErr.message}`
          : single
            ? `FOUND: name="${single.name}" email="${single.email}"`
            : `NOT FOUND (null)`
        );

        // Also probe auth.users via admin API to see if the gap is auth vs public
        try {
          const { data: authUser, error: authErr } = await supabaseAdmin.auth.admin.getUserById(id);
          console.log(`${TAG}   auth.admin.getUserById('${id}') →`, authErr
            ? `ERROR: ${authErr.message}`
            : authUser?.user
              ? `FOUND in auth: email="${authUser.user.email}" created="${authUser.user.created_at}"`
              : `NOT FOUND in auth`
          );
        } catch (e) {
          console.log(`${TAG}   auth.admin.getUserById('${id}') → THREW: ${e.message}`);
        }
      }
    }
  } else {
    console.log(`${TAG} ⚠️  no user_ids to look up — skipping users query`);
  }

  // ── STEP 4: merge ────────────────────────────────────────────────────────
  console.log(`\n${TAG} ── STEP 4: merging rows ──`);
  const members = (memberRows || []).map((m, i) => {
    const user = m.user_id ? userMap[m.user_id] : null;
    const merged = {
      id:           m.id,
      user_id:      m.user_id   || null,
      name:         user?.name  || null,
      email:        user?.email || null,
      role:         m.role,
      status:       m.status,
      joined_at:    m.joined_at,
      invited_by:   m.invited_by,
      invite_email: m.invite_email,
      created_at:   m.created_at,
    };
    const resolved = user ? '✅' : m.user_id ? '❌ no user found' : '— pending (no user_id)';
    console.log(`${TAG}   [${i}] user_id=${m.user_id ?? 'NULL'} → ${resolved} | name="${merged.name}" email="${merged.email}"`);
    return merged;
  });

  console.log(`\n${TAG} ── SUMMARY ──`);
  console.log(`${TAG} total members    :`, members.length);
  console.log(`${TAG} with profile     :`, members.filter(m => m.name || m.email).length);
  console.log(`${TAG} missing profile  :`, members.filter(m => m.user_id && !m.name && !m.email).length);
  console.log(`${TAG} pending (no uid) :`, members.filter(m => !m.user_id).length);
  console.log(`${TAG} ========== REQUEST END ==========\n`);

  res.json({ members });
}));

// POST /api/workspaces
export const createWorkspaceHandler = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'name is required' });
  const workspaceName = name.trim();
  const slug = workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + userId.slice(0, 8);
  log('CREATE', { userId, name: workspaceName, slug });
  const { data: workspace, error } = await supabaseAdmin.rpc('create_workspace_for_user', {
    p_user_id: userId, p_name: workspaceName, p_slug: slug, p_plan: req.user.tier || 'free',
  });
  if (error) { logError('POST / rpc', error, { userId }); return res.status(500).json({ error: 'CREATE_FAILED', message: error.message }); }
  // Clear profile cache so next request picks up new active_workspace_id
  await clearUserContext(userId, null);
  log('CREATE OK', { userId, workspaceId: workspace?.id });
  res.status(201).json({ workspace });
});
router.post('/', createWorkspaceHandler);

// POST /api/workspaces/switch
router.post('/switch', asyncHandler(async (req, res) => {
  const userId        = req.user.id;
  const { workspace_id } = req.body;

  if (!workspace_id) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'workspace_id is required' });
  }

  const { data: workspace, error: wsErr } = await supabaseAdmin
    .from('workspaces').select('id, name, plan').eq('id', workspace_id).eq('is_deleted', false).single();
  if (wsErr || !workspace) {
    return res.status(404).json({ error: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found.' });
  }

  const { data: membership } = await supabaseAdmin
    .from('workspace_members').select('id, role')
    .eq('workspace_id', workspace_id).eq('user_id', userId).eq('status', 'active').single();
  if (!membership) {
    return res.status(403).json({ error: 'NOT_A_MEMBER', message: 'You are not an active member of this workspace.' });
  }

  const { error: updateErr } = await supabaseAdmin
    .from('users').update({ active_workspace_id: workspace_id }).eq('id', userId);
  if (updateErr) { logError('POST /switch update', updateErr, { userId, workspace_id }); throw updateErr; }

  // Unified invalidation — clears both caches for old and new workspace
  await clearUserContext(userId, req.user.active_workspace_id);
  await clearUserContext(userId, workspace_id);

  log('SWITCH OK', { userId, from: req.user.active_workspace_id, to: workspace_id });
  res.json({ success: true, workspace: { id: workspace.id, name: workspace.name, plan: workspace.plan, role: membership.role } });
}));

// GET /api/workspaces/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (req.workspace.id !== id) {
    const { data: member } = await supabaseAdmin.from('workspace_members').select('role')
      .eq('workspace_id', id).eq('user_id', req.user.id).eq('status', 'active').single();
    if (!member) return res.status(403).json({ error: 'NOT_A_MEMBER' });
  }
  const { data: workspace, error } = await supabaseAdmin
    .from('workspaces').select('id, name, slug, plan, owner_user_id, settings, created_at')
    .eq('id', id).eq('is_deleted', false).single();
  if (error || !workspace) return res.status(404).json({ error: 'NOT_FOUND' });
  const { count } = await supabaseAdmin
    .from('workspace_members').select('id', { count: 'exact', head: true })
    .eq('workspace_id', id).eq('status', 'active');
  res.json({ workspace: { ...workspace, member_count: count || 0 } });
}));

// PUT /api/workspaces/:id
router.put('/:id', requirePermission('owner'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (req.workspace.id !== id) return res.status(403).json({ error: 'PERMISSION_DENIED' });
  const { name, settings } = req.body;
  const updates = {};
  if (name?.trim()) updates.name = name.trim();
  if (settings && typeof settings === 'object') updates.settings = { ...req.workspace.settings, ...settings };
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Nothing to update' });
  const { error } = await supabaseAdmin.from('workspaces').update(updates).eq('id', id);
  if (error) throw error;
  await clearUserContext(req.user.id, id);
  res.json({ success: true });
}));

// DELETE /api/workspaces/:id
router.delete('/:id', requirePermission('owner'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (req.workspace.id !== id) return res.status(403).json({ error: 'PERMISSION_DENIED' });
  const memberIds = await getActiveMemberIds(id);
  await supabaseAdmin.from('workspaces')
    .update({ is_deleted: true, deleted_at: new Date().toISOString() }).eq('id', id);
  if (memberIds.length) {
    await supabaseAdmin.from('users').update({ active_workspace_id: null })
      .in('id', memberIds).eq('active_workspace_id', id);
    await clearUserContext(memberIds, id);
  }
  res.json({ success: true });
}));

// POST /api/workspaces/:id/invite
router.post('/:id/invite', requirePermission('admin'), validate(inviteSchema), asyncHandler(async (req, res) => {
  const workspaceId = req.params.id;
  const { email, role = 'member' } = req.body;
  if (workspaceId !== req.workspace.id) return res.status(403).json({ error: 'PERMISSION_DENIED' });
  const normalizedEmail = email.trim().toLowerCase();
  const { data: existingMember } = await supabaseAdmin.from('workspace_members')
    .select('id, status').eq('workspace_id', workspaceId).eq('invite_email', normalizedEmail).maybeSingle();
  if (existingMember?.status === 'active')         return res.status(409).json({ error: 'ALREADY_A_MEMBER' });
  if (existingMember?.status === 'pending_invite') return res.status(409).json({ error: 'INVITE_ALREADY_PENDING' });
  const { data: existingUser } = await supabaseAdmin.from('users').select('id').eq('email', normalizedEmail).single();
  if (existingUser) {
    const { data: m } = await supabaseAdmin.from('workspace_members').select('id')
      .eq('workspace_id', workspaceId).eq('user_id', existingUser.id).eq('status', 'active').maybeSingle();
    if (m) return res.status(409).json({ error: 'ALREADY_A_MEMBER' });
  }
  const plaintextToken = randomBytes(32).toString('hex');
  const tokenHash      = createHash('sha256').update(plaintextToken).digest('hex');
  const expiresAt      = new Date(Date.now() + 7 * 86400000).toISOString();
  const { error: insertErr } = await supabaseAdmin.from('workspace_members').insert({
    workspace_id: workspaceId, user_id: null, role, status: 'pending_invite',
    invited_by: req.user.id, invite_token: tokenHash,
    invite_email: normalizedEmail, invite_expires_at: expiresAt,
  });
  if (insertErr) throw insertErr;
  sendWorkspaceInviteEmail({
    inviteEmail:   normalizedEmail,
    inviterName:   req.user.name || req.user.email,
    workspaceName: req.workspace.name,
    token:         plaintextToken,
  }).catch(() => {});
  log('INVITE OK', { workspaceId, inviteEmail: normalizedEmail, role });
  res.status(201).json({ success: true, message: `Invite sent to ${normalizedEmail}`, expires_at: expiresAt });
}));

// GET /api/workspaces/:id/invites — list pending invites (admin+)
// Allows admins to see who has been invited and revoke stale invites.
router.get('/:id/invites', requirePermission('admin'), asyncHandler(async (req, res) => {
  const workspaceId = req.params.id;
  if (workspaceId !== req.workspace.id) return res.status(403).json({ error: 'PERMISSION_DENIED' });

  const { data: invites, error } = await supabaseAdmin
    .from('workspace_members')
    .select('id, invite_email, role, invite_expires_at, invited_by, created_at')
    .eq('workspace_id', workspaceId)
    .eq('status', 'pending_invite')
    .order('created_at', { ascending: false });

  if (error) throw error;

  const now = new Date();
  const enriched = (invites || []).map(inv => ({
    ...inv,
    is_expired: inv.invite_expires_at ? new Date(inv.invite_expires_at) < now : false,
  }));

  res.json({ invites: enriched });
}));

// DELETE /api/workspaces/:id/invites/:token — revoke a pending invite (admin+)
// Deletes the invite row so the token becomes permanently invalid.
router.delete('/:id/invites/:inviteId', requirePermission('admin'), asyncHandler(async (req, res) => {
  const { id: workspaceId, inviteId } = req.params;
  if (workspaceId !== req.workspace.id) return res.status(403).json({ error: 'PERMISSION_DENIED' });

  const { data: invite } = await supabaseAdmin
    .from('workspace_members')
    .select('id')
    .eq('id', inviteId)
    .eq('workspace_id', workspaceId)
    .eq('status', 'pending_invite')
    .single();

  if (!invite) return res.status(404).json({ error: 'NOT_FOUND', message: 'Pending invite not found.' });

  await supabaseAdmin.from('workspace_members').delete().eq('id', inviteId);

  log('INVITE REVOKED', { workspaceId, inviteId, byUserId: req.user.id });
  res.json({ success: true });
}));

/*
// GET /api/workspaces/:id/members
router.get('/:id/members', asyncHandler(async (req, res) => {
  const workspaceId = req.params.id;
  if (workspaceId !== req.workspace.id) return res.status(403).json({ error: 'PERMISSION_DENIED' });
  
  const { data: members, error } = await supabaseAdmin
    .from('workspace_members')
    .select(`
      id, 
      role, 
      status, 
      joined_at, 
      invited_by, 
      invite_email, 
      created_at,
      users!workspace_members_user_id_fkey(id, name, email)
    `)  // ← Explicitly specify the foreign key
    .eq('workspace_id', workspaceId)
    .in('status', ['active', 'pending_invite', 'suspended'])
    .order('created_at', { ascending: true });
  
  if (error) throw error;
  
  // Transform the response to match what frontend expects
  const transformed = (members || []).map(m => ({
    ...m,
    users: m.users || null
  }));
  
  res.json({ members: transformed });
}));
*/

// PUT /api/workspaces/:id/members/:uid/role
router.put('/:id/members/:uid/role', requirePermission('admin'), validate(updateRoleSchema), asyncHandler(async (req, res) => {
  const { id: workspaceId, uid: targetUserId } = req.params;
  const { role } = req.body;
  if (workspaceId !== req.workspace.id) return res.status(403).json({ error: 'PERMISSION_DENIED' });
  if (targetUserId === req.workspace.owner_user_id) return res.status(403).json({ error: 'PERMISSION_DENIED', message: 'Cannot change owner role.' });
  const { data, error } = await supabaseAdmin.from('workspace_members')
    .update({ role }).eq('workspace_id', workspaceId).eq('user_id', targetUserId).eq('status', 'active')
    .select('id').single();
  if (error || !data) return res.status(404).json({ error: 'NOT_FOUND' });
  // Unified invalidation — a role change must clear BOTH caches atomically.
  // Previously only clearWorkspaceCache was called, leaving the profile cache
  // serving the old role for up to 30s in a permission-gated path.
  await clearUserContext(targetUserId, workspaceId);
  res.json({ success: true, role });
}));

// DELETE /api/workspaces/:id/members/:uid
router.delete('/:id/members/:uid', requirePermission('admin'), asyncHandler(async (req, res) => {
  const { id: workspaceId, uid: targetUserId } = req.params;
  if (workspaceId !== req.workspace.id) return res.status(403).json({ error: 'PERMISSION_DENIED' });
  if (targetUserId === req.workspace.owner_user_id) return res.status(403).json({ error: 'PERMISSION_DENIED', message: 'Cannot remove workspace owner.' });
  await supabaseAdmin.from('workspace_members').update({ status: 'removed' })
    .eq('workspace_id', workspaceId).eq('user_id', targetUserId);
  await supabaseAdmin.from('users').update({ active_workspace_id: null })
    .eq('id', targetUserId).eq('active_workspace_id', workspaceId);
  await clearUserContext(targetUserId, workspaceId);
  res.json({ success: true });
}));

// DELETE /api/workspaces/:id/leave
router.delete('/:id/leave', asyncHandler(async (req, res) => {
  const workspaceId = req.params.id;
  const userId      = req.user.id;
  if (req.workspace.id !== workspaceId) return res.status(403).json({ error: 'PERMISSION_DENIED' });
  if (userId === req.workspace.owner_user_id) return res.status(403).json({ error: 'OWNER_CANNOT_LEAVE', message: 'Transfer ownership before leaving.' });
  await supabaseAdmin.from('workspace_members').update({ status: 'removed' })
    .eq('workspace_id', workspaceId).eq('user_id', userId);
  await supabaseAdmin.from('users').update({ active_workspace_id: null })
    .eq('id', userId).eq('active_workspace_id', workspaceId);
  await clearUserContext(userId, workspaceId);
  log('MEMBER LEFT', { workspaceId, userId });
  res.json({ success: true });
}));

// PUT /api/workspaces/:id/transfer-ownership
router.put('/:id/transfer-ownership', requirePermission('owner'), validate(transferOwnershipSchema), asyncHandler(async (req, res) => {
  const workspaceId           = req.params.id;
  const { new_owner_user_id } = req.body;
  if (req.workspace.id !== workspaceId) return res.status(403).json({ error: 'PERMISSION_DENIED' });
  if (new_owner_user_id === req.user.id) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'You are already the owner.' });
  const { data: targetMember } = await supabaseAdmin.from('workspace_members').select('id')
    .eq('workspace_id', workspaceId).eq('user_id', new_owner_user_id).eq('status', 'active').single();
  if (!targetMember) return res.status(404).json({ error: 'NOT_FOUND', message: 'Target user is not an active member.' });
  const { error } = await supabaseAdmin.rpc('transfer_workspace_ownership', {
    p_workspace_id: workspaceId, p_current_owner_id: req.user.id, p_new_owner_id: new_owner_user_id,
  });
  if (error) { logError('transfer-ownership RPC', error); return res.status(500).json({ error: 'TRANSFER_FAILED', message: error.message }); }
  await clearUserContext([req.user.id, new_owner_user_id], workspaceId);
  res.json({ success: true });
}));

// POST /api/workspaces/:id/nudge
router.post('/:id/nudge', requirePermission('manager'), validate(nudgeSchema), asyncHandler(async (req, res) => {
  const workspaceId = req.params.id;
  const { user_id: targetUserId, message } = req.body;
  if (req.workspace.id !== workspaceId) return res.status(403).json({ error: 'PERMISSION_DENIED' });
  const { data: member } = await supabaseAdmin.from('workspace_members').select('id')
    .eq('workspace_id', workspaceId).eq('user_id', targetUserId).eq('status', 'active').single();
  if (!member) return res.status(404).json({ error: 'NOT_FOUND', message: 'Target user is not an active member.' });
  await notifyUser(targetUserId, { title: 'Message from your manager', body: message, data: { type: 'nudge', workspace_id: workspaceId } });
  await writeActivity(workspaceId, req.user.id, ACTIVITY_EVENTS.NUDGE_SENT, { target_user_id: targetUserId, message });
  log('NUDGE SENT', { workspaceId, from: req.user.id, to: targetUserId });
  res.json({ success: true });
}));

// GET /api/workspaces/:id/analytics (manager+)
router.get('/:id/analytics', requirePermission('manager'), asyncHandler(async (req, res) => {
  const workspaceId = req.params.id;
  if (req.workspace.id !== workspaceId) return res.status(403).json({ error: 'PERMISSION_DENIED' });

  const sevenDaysAgo  = new Date(Date.now() - 7  * 86400000).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  const [
    { data: members },
    { data: recentOpps },
    { data: recentFeedback },
    { data: skillSnapshots },
    { data: patterns },
  ] = await Promise.all([
    supabaseAdmin.from('workspace_members').select('user_id, role, users(id, name, email)').eq('workspace_id', workspaceId).eq('status', 'active'),
    supabaseAdmin.from('opportunities').select('user_id, status, marked_sent_at, composite_score, created_at').eq('workspace_id', workspaceId).gte('created_at', thirtyDaysAgo),
    supabaseAdmin.from('feedback').select('user_id, outcome, created_at').eq('workspace_id', workspaceId).gte('created_at', thirtyDaysAgo),
    supabaseAdmin.from('skill_progression').select('user_id, composite_score_avg, top_weakness, top_strength, week_start, composite_delta').eq('workspace_id', workspaceId).gte('week_start', sevenDaysAgo).order('week_start', { ascending: false }),
    supabaseAdmin.from('communication_patterns').select('user_id, pattern_label, pattern_type, confidence_score, affected_outcome').eq('workspace_id', workspaceId).eq('is_active', true).order('confidence_score', { ascending: false }).limit(20),
  ]);

  const memberStats = (members || []).map(m => {
    const uid            = m.user_id;
    const memberOpps     = (recentOpps     || []).filter(o => o.user_id === uid);
    const memberFeedback = (recentFeedback || []).filter(f => f.user_id === uid);
    const memberSkill    = (skillSnapshots || []).find(s => s.user_id === uid);
    const sent           = memberOpps.filter(o => o.marked_sent_at).length;
    const positive       = memberFeedback.filter(f => f.outcome === 'positive').length;
    return {
      user_id: uid, name: m.users?.name || m.users?.email || uid, role: m.role,
      opportunities_created: memberOpps.length, messages_sent: sent, positive_outcomes: positive,
      execution_rate:  memberOpps.length > 0 ? +(sent / memberOpps.length).toFixed(2) : 0,
      positive_rate:   sent > 0 ? +(positive / sent).toFixed(2) : 0,
      composite_skill: memberSkill?.composite_score_avg ?? null,
      skill_delta:     memberSkill?.composite_delta ?? null,
      top_weakness:    memberSkill?.top_weakness ?? null,
      top_strength:    memberSkill?.top_strength ?? null,
    };
  });

  const totalSent     = (recentOpps     || []).filter(o => o.marked_sent_at).length;
  const totalPositive = (recentFeedback || []).filter(f => f.outcome === 'positive').length;

  log('ANALYTICS', { workspaceId, memberCount: memberStats.length });
  res.json({
    workspace_id: workspaceId, period_days: 30, member_count: memberStats.length,
    totals: {
      opportunities_created: (recentOpps || []).length, messages_sent: totalSent, positive_outcomes: totalPositive,
      execution_rate: (recentOpps || []).length > 0 ? +(totalSent / (recentOpps || []).length).toFixed(2) : 0,
      positive_rate:  totalSent > 0 ? +(totalPositive / totalSent).toFixed(2) : 0,
    },
    members: memberStats, patterns: patterns || [],
  });
}));
// TEMPORARY TEST ENDPOINT - Returns invite URL directly (no email)
// POST /api/workspaces/:id/invite-test
router.post('/:id/invite-test', requirePermission('admin'), validate(inviteSchema), asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const workspaceId = req.params.id;
  const { email, role = 'member' } = req.body;
  const userId = req.user.id;
  
  // Log request start
  console.log('\n========== INVITE TEST REQUEST START ==========');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Workspace ID:', workspaceId);
  console.log('Email:', email);
  console.log('Role:', role);
  console.log('Requested by User ID:', userId);
  console.log('Requested by User Email:', req.user.email);
  console.log('Workspace Name:', req.workspace?.name);
  console.log('===============================================\n');
  
  // Permission check
  if (workspaceId !== req.workspace.id) {
    console.log('❌ Permission denied: workspace mismatch');
    console.log('  Expected:', req.workspace.id);
    console.log('  Got:', workspaceId);
    return res.status(403).json({ error: 'PERMISSION_DENIED' });
  }
  
  const normalizedEmail = email.trim().toLowerCase();
  console.log('📧 Normalized email:', normalizedEmail);
  
  // Check if already a member or invite pending
  console.log('\n--- Checking existing member status ---');
  const { data: existingMember, error: memberCheckError } = await supabaseAdmin
    .from('workspace_members')
    .select('id, status, role, user_id')
    .eq('workspace_id', workspaceId)
    .eq('invite_email', normalizedEmail)
    .maybeSingle();
    
  if (memberCheckError) {
    console.log('⚠️ Error checking existing member:', memberCheckError.message);
  }
  
  if (existingMember) {
    console.log('📋 Found existing record:', {
      id: existingMember.id,
      status: existingMember.status,
      role: existingMember.role,
      user_id: existingMember.user_id
    });
    
    if (existingMember?.status === 'active') {
      console.log('❌ User is already an active member');
      return res.status(409).json({ 
        error: 'ALREADY_A_MEMBER',
        message: `User ${normalizedEmail} is already an active member of this workspace.`,
        status: existingMember.status
      });
    }
    
    if (existingMember?.status === 'pending_invite') {
      console.log('⚠️ Invite already pending for this email');
      return res.status(409).json({ 
        error: 'INVITE_ALREADY_PENDING',
        message: `An invite has already been sent to ${normalizedEmail}. Please wait or revoke the existing invite.`,
        status: existingMember.status
      });
    }
  } else {
    console.log('✅ No existing member record found');
  }
  
  // Check if user exists in the system
  console.log('\n--- Checking if user exists in system ---');
  const { data: existingUser, error: userCheckError } = await supabaseAdmin
    .from('users')
    .select('id, name, email, tier')
    .eq('email', normalizedEmail)
    .single();
    
  if (userCheckError && userCheckError.code !== 'PGRST116') {
    console.log('⚠️ Error checking existing user:', userCheckError.message);
  }
  
  if (existingUser) {
    console.log('✅ User exists in system:', {
      id: existingUser.id,
      name: existingUser.name,
      email: existingUser.email,
      tier: existingUser.tier
    });
    
    // Check if user is already a member (by user_id)
    console.log('\n--- Checking if user is already a member (by user_id) ---');
    const { data: memberByUserId, error: memberByUserIdError } = await supabaseAdmin
      .from('workspace_members')
      .select('id, status, role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', existingUser.id)
      .eq('status', 'active')
      .maybeSingle();
      
    if (memberByUserIdError) {
      console.log('⚠️ Error checking membership by user_id:', memberByUserIdError.message);
    }
    
    if (memberByUserId) {
      console.log('❌ User is already an active member (by user_id):', {
        id: memberByUserId.id,
        status: memberByUserId.status,
        role: memberByUserId.role
      });
      return res.status(409).json({ 
        error: 'ALREADY_A_MEMBER',
        message: `User ${normalizedEmail} is already an active member of this workspace.`,
        user_id: existingUser.id
      });
    }
  } else {
    console.log('📝 User does not exist in system yet - will create invite for new user');
  }
  
  // Create invite
  console.log('\n--- Creating invite ---');
  const plaintextToken = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(plaintextToken).digest('hex');
  const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
  
  console.log('Invite details:', {
    token_hash_preview: tokenHash.substring(0, 16) + '...',
    expires_at: expiresAt,
    role: role
  });
  
  const { data: insertData, error: insertErr } = await supabaseAdmin
    .from('workspace_members')
    .insert({
      workspace_id: workspaceId,
      user_id: null,  // always null on creation — consistent with production /invite
      role: role,
      status: 'pending_invite',
      invited_by: req.user.id,
      invite_token: tokenHash,
      invite_email: normalizedEmail,
      invite_expires_at: expiresAt,
    })
    .select();
    
  if (insertErr) {
    console.log('❌ Failed to create invite:', {
      error: insertErr.message,
      code: insertErr.code,
      details: insertErr.details
    });
    throw insertErr;
  }
  
  console.log('✅ Invite created successfully:', {
    id: insertData?.[0]?.id,
    status: 'pending_invite',
    expires_at: expiresAt
  });
  
  // Generate invite URL
  const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
  const inviteUrl = `${FRONTEND_URL}/accept-invite?token=${plaintextToken}`;
  
  const duration = Date.now() - startTime;
  
  // Log success
  console.log('\n--- INVITE TEST COMPLETED SUCCESSFULLY ---');
  console.log('✅ Invite URL generated:', inviteUrl);
  console.log('📧 Email:', normalizedEmail);
  console.log('🔑 Token (plaintext):', plaintextToken);
  console.log('⏰ Expires at:', expiresAt);
  console.log('🏢 Workspace:', req.workspace.name);
  console.log('👤 Invited by:', req.user.email);
  console.log('⏱️ Duration:', duration, 'ms');
  console.log('==========================================\n');
  
  // Log to your logger as well
  log('INVITE_TEST', { 
    workspaceId, 
    inviteEmail: normalizedEmail, 
    role, 
    invitedBy: req.user.id,
    userExists: !!existingUser,
    existingUserId: existingUser?.id,
    tokenPreview: plaintextToken.substring(0, 8),
    duration
  });
  
  res.status(201).json({
    success: true,
    invite_url: inviteUrl,
    token: plaintextToken,
    expires_at: expiresAt,
    email: normalizedEmail,
    workspace_name: req.workspace.name,
    workspace_id: workspaceId,
    role: role,
    user_exists: !!existingUser,
    debug: process.env.NODE_ENV !== 'production' ? {
      token_hash: tokenHash,
      invite_id: insertData?.[0]?.id,
      expires_at: expiresAt
    } : undefined
  });
}));
export default router;
