// src/routes/workspace-activity.js — Gap 3
// FIX Issue 11: requirePermission('manager') added — this endpoint surfaces
//   member actions and deal details; any authenticated member must not be
//   able to read all workspace activity. Only manager-and-above may access.
// FIX Section 5: count: 'exact' added + total returned in response body
//   so the frontend can implement pagination without a second count query.
import { Router }             from 'express';
import { asyncHandler }       from '../middleware/errorHandler.js';
import { requirePermission }  from '../middleware/workspace.js';
import { createLogger }       from '../utils/logger.js';
import supabaseAdmin          from '../config/supabase.js';

const router = Router();
const { log, logError } = createLogger('WorkspaceActivity');

// GET /api/workspace/activity
router.get('/activity', requirePermission('manager'), asyncHandler(async (req, res) => {
  const workspaceId = req.workspace.id;
  const limit  = Math.min(parseInt(req.query.limit) || 20, 100);
  const offset = parseInt(req.query.offset) || 0;
  log('FEED', { workspaceId, userId: req.user.id, limit, offset });

  const { data: events, error, count } = await supabaseAdmin
    .from('workspace_activity')
    .select('id, event_type, metadata, created_at, users(id, name, email)', { count: 'exact' })
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) { logError('GET /activity', error, { workspaceId }); throw error; }
  res.json({ events: events || [], total: count || 0, workspace_id: workspaceId, limit, offset });
}));

export default router;
