// src/routes/commitments.js — Gap 5 (member+ on writes), CRIT-03 (shared logger)
import { Router }            from 'express';
import { asyncHandler }      from '../middleware/errorHandler.js';
import { requirePermission, buildUserContext } from '../middleware/workspace.js';
import { createLogger }      from '../utils/logger.js';
import { callWithFallbackGroq } from '../services/multiProvider.js';
import supabaseAdmin         from '../config/supabase.js';

const router = Router();
const { log, logError } = createLogger('Commitments');

// GET /api/commitments
router.get('/', asyncHandler(async (req, res) => {
  const { status, owner, limit = 50 } = req.query;
  const userId      = req.user.id;
  const workspaceId = req.workspace.id;
  const today       = new Date().toISOString().split('T')[0];

  let query = supabaseAdmin
    .from('conversation_commitments')
    .select('*, prospects(id, name, company)')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(parseInt(limit));

  if (status) {
    query = status === 'active'
      ? query.in('status', ['pending', 'overdue'])
      : query.eq('status', status);
  } else {
    query = query.in('status', ['pending', 'overdue']);
  }
  if (owner) query = query.eq('owner', owner);

  const { data: commitments, error } = await query;
  if (error) throw error;

  const overdue  = (commitments || []).filter(c =>
    c.status === 'overdue' || (c.status === 'pending' && c.due_date && c.due_date < today)
  );
  const due_soon = (commitments || []).filter(c => {
    if (c.status !== 'pending' || !c.due_date || c.due_date < today) return false;
    return (new Date(c.due_date) - new Date()) / 86400000 <= 2;
  });
  const pending = (commitments || []).filter(c =>
    c.status === 'pending' &&
    !overdue.find(d => d.id === c.id) &&
    !due_soon.find(d => d.id === c.id)
  );

  res.json({ commitments: commitments || [], overdue, due_soon, pending });
}));

// PUT /api/commitments/:id  (Gap 5: member+)
router.put('/:id', requirePermission('member'), asyncHandler(async (req, res) => {
  const { status, due_date } = req.body;
  const workspaceId = req.workspace.id;
  const validStatuses = ['pending', 'done', 'overdue', 'ignored'];

  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({
      error:   'VALIDATION_ERROR',
      message: `status must be one of: ${validStatuses.join(', ')}`,
    });
  }

  const updates = {};
  if (status)   updates.status   = status;
  if (due_date) updates.due_date = due_date;
  if (status === 'done') updates.completed_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('conversation_commitments')
    .update(updates)
    .eq('id', req.params.id)
    .eq('workspace_id', workspaceId)
    .eq('user_id', req.user.id)
    .select()
    .single();

  if (error || !data) return res.status(404).json({ error: 'NOT_FOUND' });

  if (status === 'done' && data.prospect_id) {
    updateCommitmentProspectHealth(req.user.id, workspaceId, data.prospect_id).catch(() => {});
  }

  log('UPDATE', { id: req.params.id, status, workspaceId });
  res.json({ success: true, commitment: data });
}));

// POST /api/commitments/:id/generate-message  (Gap 5: member+)
router.post('/:id/generate-message', requirePermission('member'), asyncHandler(async (req, res) => {
  const workspaceId = req.workspace.id;

  const { data: commitment } = await supabaseAdmin
    .from('conversation_commitments')
    .select('*, prospects(id, name, company)')
    .eq('id', req.params.id)
    .eq('workspace_id', workspaceId)
    .eq('user_id', req.user.id)
    .single();

  if (!commitment) return res.status(404).json({ error: 'NOT_FOUND' });

  const userCtx      = buildUserContext(req);
  const vp           = userCtx.voice_profile || {};
  const prospectName = commitment.prospects?.name || 'there';
  const company      = commitment.prospects?.company ? ` at ${commitment.prospects.company}` : '';

  const { content } = await callWithFallbackGroq({
    systemPrompt: 'You are generating a short, human follow-up message. Under 60 words. No formal sign-offs.',
    messages: [{
      role:    'user',
      content: `Founder voice: ${vp.voice_style || 'conversational, direct'}\nProduct: ${userCtx.product_description || 'not specified'}\nSending to: ${prospectName}${company}\nCommitment: "${commitment.commitment_text}"\nWrite the message now.`,
    }],
    temperature: 0.7,
    maxTokens:   150,
    userId:      req.user.id,
    workspaceId: req.workspace.id,
    sourceJob:   'generate_commitment_message',
  });

  await supabaseAdmin
    .from('conversation_commitments')
    .update({ follow_up_message: content.trim() })
    .eq('id', commitment.id);

  res.json({ success: true, message: content.trim() });
}));

async function updateCommitmentProspectHealth(userId, workspaceId, prospectId) {
  const { data: prospect } = await supabaseAdmin
    .from('prospects')
    .select('relationship_health_score')
    .eq('id', prospectId)
    .eq('workspace_id', workspaceId)
    .single();

  if (!prospect) return;

  const newScore = Math.min(100, (prospect.relationship_health_score || 50) + 8);
  // FIX MED-04: Add workspace_id to UPDATE to prevent cross-workspace data mutation
  await supabaseAdmin
    .from('prospects')
    .update({ relationship_health_score: newScore, health_updated_at: new Date().toISOString() })
    .eq('id', prospectId)
    .eq('workspace_id', workspaceId);  // ✅ ADDED workspace_id guard
}

export default router;
