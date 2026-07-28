// src/routes/prospects.js
import { Router }            from 'express';
import { z }                 from 'zod';
import { asyncHandler }      from '../middleware/errorHandler.js';
import { requirePermission, buildUserContext } from '../middleware/workspace.js';
import { createLogger }      from '../utils/logger.js';
import { generateProspectSummary } from '../services/groqCalendarIntelligence.js';
import { resolveMergeCandidate } from '../services/prospectDedup.js';
import supabaseAdmin         from '../config/supabase.js';

export const prospectsRouter = Router();
const { log, logError } = createLogger('Prospects');

// Zod schema for prospect updates.
// .strict() rejects any key not explicitly listed — this is the critical guard
// against workspace_id / user_id injection via the request body.
const updateProspectSchema = z.object({
  name:         z.string().min(1).max(200).optional(),
  company:      z.string().max(200).optional().nullable(),
  title:        z.string().max(200).optional().nullable(),
  email:        z.string().email().optional().nullable(),
  linkedin_url: z.string().url().optional().nullable(),
  platform:     z.string().max(50).optional().nullable(),
  notes:        z.string().max(2000).optional().nullable(),
  stage:        z.enum(['prospect', 'engaged', 'negotiating', 'closed_won', 'closed_lost', 'dormant']).optional(),
}).strict(); // rejects workspace_id, user_id, or any unlisted key

// GET /api/prospects
prospectsRouter.get('/', asyncHandler(async (req, res) => {
  const { sort = 'health', limit = 50 } = req.query;
  const userId      = req.user.id;
  const workspaceId = req.workspace.id;

  let query = supabaseAdmin
    .from('prospects')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .order('relationship_health_score', { ascending: sort === 'health_asc' })
    .limit(parseInt(limit));

  if (sort === 'recent') {
    query = supabaseAdmin
      .from('prospects')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .order('last_contact_at', { ascending: false, nullsFirst: false })
      .limit(parseInt(limit));
  }

  const { data: prospects, error } = await query;
  if (error) throw error;

  const prospectIds = (prospects || []).map(p => p.id);
  let commitmentCounts = {};
  if (prospectIds.length) {
    const { data: counts } = await supabaseAdmin
      .from('conversation_commitments')
      .select('prospect_id, id')
      .eq('workspace_id', workspaceId)
      .in('prospect_id', prospectIds)
      .eq('owner', 'founder')
      .in('status', ['pending', 'overdue']);
    (counts || []).forEach(c => {
      commitmentCounts[c.prospect_id] = (commitmentCounts[c.prospect_id] || 0) + 1;
    });
  }

  const enriched = (prospects || []).map(p => ({
    ...p,
    pending_commitments: commitmentCounts[p.id] || 0,
  }));
  res.json({ prospects: enriched });
}));

// ============================================================
// Merge-candidate review endpoints — the human-review step for Layer 3
// of the dedup engine (services/prospectDedup.js). No UI is built for
// this in the current pass (flagged in the implementation guide as a
// Prospects-page item outside Calendar's scope); the endpoints exist so
// the mechanism is actionable via API now.
//
// NOTE: these two routes must stay above GET /api/prospects/:id — Express
// matches routes in registration order, and '/:id' would otherwise
// swallow '/merge-candidates' as if "merge-candidates" were an :id.
// ============================================================

// GET /api/prospects/merge-candidates
prospectsRouter.get('/merge-candidates', asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin.from('prospect_merge_candidates')
    .select('*, prospect_a:prospects!prospect_id_a(id, name, company), prospect_b:prospects!prospect_id_b(id, name, company)')
    .eq('workspace_id', req.workspace.id).eq('status', 'pending')
    .order('similarity_score', { ascending: false });
  if (error) throw error;
  res.json({ candidates: data || [] });
}));

// POST /api/prospects/merge-candidates/:id/resolve
prospectsRouter.post('/merge-candidates/:id/resolve', asyncHandler(async (req, res) => {
  const { action } = req.body; // 'merge' | 'dismiss'
  if (!['merge', 'dismiss'].includes(action)) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: "action must be 'merge' or 'dismiss'" });
  }
  const result = await resolveMergeCandidate(req.workspace.id, req.params.id, action, req.user.id);
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ success: true, action: result.action });
}));

// GET /api/prospects/:id
prospectsRouter.get('/:id', asyncHandler(async (req, res) => {
  const userId      = req.user.id;
  const workspaceId = req.workspace.id;

  const { data: prospect, error } = await supabaseAdmin
    .from('prospects')
    .select('*')
    .eq('id', req.params.id)
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .single();

  if (error || !prospect) return res.status(404).json({ error: 'NOT_FOUND' });

  const [eventsRes, chatsRes, signalsRes, commitmentsRes] = await Promise.all([
    supabaseAdmin.from('user_events')
      .select('id, title, event_type, event_date, start_time, outcome, energy_score, debrief_completed_at, debrief_content')
      .eq('prospect_id', prospect.id).eq('workspace_id', workspaceId).eq('user_id', userId)
      .order('event_date', { ascending: false }),
    supabaseAdmin.from('chats')
      .select('id, title, chat_mode, message_count, last_message_at, created_at')
      .eq('prospect_id', prospect.id).eq('workspace_id', workspaceId).eq('user_id', userId)
      .eq('is_archived', false).order('last_message_at', { ascending: false }),
    supabaseAdmin.from('conversation_signals')
      .select('*')
      .eq('prospect_id', prospect.id).eq('workspace_id', workspaceId).eq('user_id', userId)
      .eq('is_active', true).order('detected_at', { ascending: false }).limit(20),
    supabaseAdmin.from('conversation_commitments')
      .select('*')
      .eq('prospect_id', prospect.id).eq('workspace_id', workspaceId).eq('user_id', userId)
      .order('created_at', { ascending: false }),
  ]);

  const timeline = [
    ...(eventsRes.data || []).map(e => ({
      type: 'event', id: e.id, date: e.start_time || e.event_date, title: e.title,
      subtype: e.event_type, outcome: e.outcome, energy: e.energy_score,
      has_debrief: !!e.debrief_completed_at, summary: e.debrief_content?.summary || null,
    })),
    ...(chatsRes.data || []).map(c => ({
      type: 'chat', id: c.id, date: c.last_message_at || c.created_at,
      title: c.title, subtype: c.chat_mode, message_count: c.message_count,
    })),
    ...(signalsRes.data || []).map(s => ({
      type: 'signal', id: s.id, date: s.detected_at,
      title: `${s.signal_type.charAt(0).toUpperCase() + s.signal_type.slice(1)} signal detected`,
      signal_type: s.signal_type, signal_text: s.signal_text,
    })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  res.json({
    prospect,
    timeline,
    signals:     signalsRes.data    || [],
    commitments: commitmentsRes.data || [],
    meetings:    eventsRes.data     || [],
    chats:       chatsRes.data      || [],
  });
}));

// POST /api/prospects
prospectsRouter.post('/', requirePermission('member'), asyncHandler(async (req, res) => {
  const { name, company, title, email, linkedin_url, platform, notes } = req.body;
  const userId      = req.user.id;
  const workspaceId = req.workspace.id;

  if (!name?.trim()) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'name is required' });
  }

  const { data: prospect, error } = await supabaseAdmin
    .from('prospects')
    .insert({
      workspace_id:     workspaceId,
      user_id:          userId,
      name:             name.trim(),
      company:          company?.trim()      || null,
      title:            title?.trim()        || null,
      email:            email?.trim()        || null,
      linkedin_url:     linkedin_url?.trim() || null,
      platform:         platform             || null,
      notes:            notes?.trim()        || null,
      first_contact_at: new Date().toISOString(),
      last_contact_at:  new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  res.status(201).json({ prospect });
}));

// PUT /api/prospects/:id
// Validated with Zod .strict() — workspace_id and user_id cannot be updated by client.
prospectsRouter.put('/:id', requirePermission('member'), asyncHandler(async (req, res) => {
  const workspaceId = req.workspace.id;

  const parsed = updateProspectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error:   'VALIDATION_ERROR',
      message: 'Invalid or disallowed fields in request body.',
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const updates = parsed.data;
  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'No valid fields to update.' });
  }

  const { error } = await supabaseAdmin
    .from('prospects')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('workspace_id', workspaceId)
    .eq('user_id', req.user.id);

  if (error) throw error;
  res.json({ success: true });
}));

// POST /api/prospects/:id/refresh-summary
prospectsRouter.post('/:id/refresh-summary', requirePermission('member'), asyncHandler(async (req, res) => {
  const userId      = req.user.id;
  const workspaceId = req.workspace.id;

  const { data: prospect } = await supabaseAdmin
    .from('prospects')
    .select('*')
    .eq('id', req.params.id)
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .single();

  if (!prospect) return res.status(404).json({ error: 'NOT_FOUND' });

  const [{ data: events }, { data: signals }] = await Promise.all([
    supabaseAdmin.from('user_events')
      .select('title, event_type, outcome, event_date, debrief_content')
      .eq('prospect_id', prospect.id).eq('workspace_id', workspaceId).eq('user_id', userId)
      .order('event_date', { ascending: false }).limit(10),
    supabaseAdmin.from('conversation_signals')
      .select('signal_type, signal_text, detected_at')
      .eq('prospect_id', prospect.id).eq('workspace_id', workspaceId).eq('user_id', userId)
      .eq('is_active', true).limit(10),
  ]);

  const timeline = [
    ...(events  || []).map(e => ({ type: 'event',  date: e.event_date,  title: e.title,      outcome: e.outcome })),
    ...(signals || []).map(s => ({ type: 'signal', date: s.detected_at, signal_type: s.signal_type, signal_text: s.signal_text })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  const userCtx = buildUserContext(req);
  const summary = await generateProspectSummary(userCtx, prospect, timeline);

  await supabaseAdmin.from('prospects')
    .update({ ai_summary: summary, ai_summary_updated_at: new Date().toISOString() })
    .eq('id', prospect.id)
    .eq('workspace_id', workspaceId);

  res.json({ success: true, summary });
}));

// DELETE /api/prospects/:id
prospectsRouter.delete('/:id', requirePermission('member'), asyncHandler(async (req, res) => {
  const workspaceId = req.workspace.id;
  await supabaseAdmin.from('prospects')
    .delete()
    .eq('id', req.params.id)
    .eq('workspace_id', workspaceId)
    .eq('user_id', req.user.id);
  res.json({ success: true });
}));

export default prospectsRouter;
