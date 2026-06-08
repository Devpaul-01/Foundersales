// src/routes/calendar.js
// ============================================================
// CALENDAR — WORKSPACE REFACTOR
//
// CHANGES:
//  - All queries now filter/insert with workspace_id
//  - AI context reads from req.workspaceProfile via buildUserContext
//  - researchProspectForMeeting now passes workspaceId
//  - All audit fixes from single-user version preserved
//
// FIXES APPLIED (refinement plan):
//  Issue 14: POST / — replaced two fire-and-forget calls with
//            proper backgroundQueue.add() jobs:
//              researchProspectForMeeting → CALENDAR_RESEARCH_PROSPECT
//              generateAndSaveEnrichedPrep → CALENDAR_PREP_GENERATE
//            Fire-and-forget with .catch(()=>{}) silently dropped Groq/Perplexity
//            failures on event creation. Both are now retryable BullMQ jobs,
//            observable in Bull Board, with full payload for idempotent re-run.
//            generateAndSaveEnrichedPrep kept as internal helper for POST /:id/prep
//            (user-triggered, synchronous path — returns prep in response).
// ============================================================

import { Router }    from 'express';
import rateLimit     from 'express-rate-limit';
import { asyncHandler } from '../middleware/errorHandler.js';
import { buildUserContext } from '../middleware/workspace.js';
import {
  generateEnrichedEventPrep,
  generateMeetingDebrief,
  extractCommitmentsFromText,
  generateSignalAnalysis,
  generatePostMeetingFollowUp,
} from '../services/groqCalendarIntelligence.js';
import { researchProspectForMeeting } from '../services/perplexityCalendar.js';
import { backgroundQueue }            from '../jobs/queues.js';
import { BACKGROUND_JOB_TYPES }       from '../config/constants.js';
import supabaseAdmin from '../config/supabase.js';
import { createLogger } from '../utils/logger.js';

const router = Router();
const { log, logError, logDB, logAI } = createLogger('Calendar');

const calendarAiRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user.id,
  message: { error: 'RATE_LIMIT_EXCEEDED', message: 'Too many AI requests. Please wait a few minutes.' },
});

// GET /api/calendar
router.get('/', asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const userId = req.user.id;
  const workspaceId = req.workspace.id;

  const defaultFrom = new Date();
  defaultFrom.setDate(defaultFrom.getDate() - 14);
  const fromDate = from || defaultFrom.toISOString().split('T')[0];

  let query = supabaseAdmin
    .from('user_events')
    .select('*, prospects(id, name, company, relationship_health_score)')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .gte('event_date', fromDate)
    .order('event_date', { ascending: true });

  if (to) query = query.lte('event_date', to);
  const { data: events, error } = await query;
  if (error) throw error;

  const now = new Date();
  const enriched = (events || []).map(e => ({
    ...e,
    debrief_needed: new Date(e.start_time || e.event_date) < now && !e.debrief_completed_at,
    health_score:   e.prospects?.relationship_health_score || null,
  }));

  res.json({ events: enriched });
}));

// GET /api/calendar/alerts
router.get('/alerts', asyncHandler(async (req, res) => {
  const now = new Date().toISOString();
  const userId = req.user.id;
  const workspaceId = req.workspace.id;

  const [eventsRes, commitmentsRes] = await Promise.all([
    supabaseAdmin.from('user_events').select('id, title, event_date, start_time, event_type, attendee_name, outcome')
      .eq('workspace_id', workspaceId).eq('user_id', userId)
      .lt('event_date', now.split('T')[0]).is('debrief_completed_at', null)
      .order('event_date', { ascending: false }).limit(5),
    supabaseAdmin.from('conversation_commitments').select('id, commitment_text, due_date, prospect_id, prospects(name)')
      .eq('workspace_id', workspaceId).eq('user_id', userId)
      .eq('owner', 'founder').in('status', ['pending', 'overdue'])
      .order('due_date', { ascending: true }).limit(10),
  ]);

  const today = new Date().toISOString().split('T')[0];
  const commitments = (commitmentsRes.data || []).map(c => ({ ...c, is_overdue: c.due_date && c.due_date < today }));

  res.json({
    debriefs_needed:     eventsRes.data     || [],
    overdue_commitments: commitments.filter(c => c.is_overdue),
    pending_commitments: commitments.filter(c => !c.is_overdue),
  });
}));

// POST /api/calendar
router.post('/', asyncHandler(async (req, res) => {
  const {
    title, event_date, start_time, end_time, event_type = 'meeting',
    notes, attendee_name, attendee_context, opportunity_id, prospect_id,
  } = req.body;
  const userId = req.user.id;
  const workspaceId = req.workspace.id;

  if (!title || !event_date) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'title and event_date are required' });
  }

  if (attendee_context && attendee_context.length > 2000) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'attendee_context must be under 2000 characters' });
  }

  let resolvedProspectId = prospect_id || null;
  if (attendee_name?.trim() && !resolvedProspectId) {
    resolvedProspectId = await upsertProspect(userId, workspaceId, { name: attendee_name, context: attendee_context });
  }

  const { data: event, error } = await supabaseAdmin
    .from('user_events')
    .insert({
      workspace_id:     workspaceId,
      user_id:          userId,
      title:            title.trim(),
      event_date,
      start_time:       start_time || null,
      end_time:         end_time   || null,
      event_type,
      notes:            notes?.trim()            || null,
      attendee_name:    attendee_name?.trim()    || null,
      attendee_context: attendee_context?.trim() || null,
      opportunity_id:   opportunity_id           || null,
      prospect_id:      resolvedProspectId,
    })
    .select()
    .single();

  if (error) throw error;

  const userCtx = buildUserContext(req);

  // Issue 14: Replace fire-and-forget calls with durable BullMQ jobs.
  //
  // BEFORE (broken):
  //   researchProspectForMeeting(...).catch(() => {});
  //   generateAndSaveEnrichedPrep(...).catch(() => {});
  // These silently dropped Groq/Perplexity failures — no retry, no visibility.
  //
  // AFTER (fixed):
  //   backgroundQueue.add(CALENDAR_RESEARCH_PROSPECT, ...) — retryable, logged
  //   backgroundQueue.add(CALENDAR_PREP_GENERATE, ...)     — retryable, logged
  //
  // jobId deduplication: `prep:${event.id}` and `research:${event.id}` prevent
  // double-generation if a race condition triggers two creates for the same event.

  if (attendee_name || attendee_context) {
    await backgroundQueue.add(
      BACKGROUND_JOB_TYPES.CALENDAR_RESEARCH_PROSPECT,
      { userId, workspaceId, eventId: event.id, userCtx },
      { jobId: `research:${event.id}`, attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
    ).catch(err => logError('backgroundQueue calendar_research_prospect', err, { eventId: event.id }));
  }

  await backgroundQueue.add(
    BACKGROUND_JOB_TYPES.CALENDAR_PREP_GENERATE,
    { userId, workspaceId, eventId: event.id, userCtx },
    { jobId: `prep:${event.id}`, attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
  ).catch(err => logError('backgroundQueue calendar_prep_generate', err, { eventId: event.id }));

  res.status(201).json({ event });
}));

// GET /api/calendar/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const workspaceId = req.workspace.id;

  const [eventRes, commitmentsRes, signalsRes] = await Promise.all([
    supabaseAdmin.from('user_events').select('*, prospects(*)').eq('id', req.params.id).eq('workspace_id', workspaceId).eq('user_id', userId).single(),
    supabaseAdmin.from('conversation_commitments').select('*').eq('event_id', req.params.id).eq('workspace_id', workspaceId).eq('user_id', userId),
    supabaseAdmin.from('conversation_signals').select('*').eq('event_id', req.params.id).eq('workspace_id', workspaceId).eq('user_id', userId).eq('is_active', true),
  ]);

  if (!eventRes.data) return res.status(404).json({ error: 'NOT_FOUND' });

  res.json({ event: eventRes.data, commitments: commitmentsRes.data || [], signals: signalsRes.data || [] });
}));

// PUT /api/calendar/:id
router.put('/:id', asyncHandler(async (req, res) => {
  const workspaceId = req.workspace.id;
  const { title, event_date, start_time, end_time, event_type, notes, attendee_name, attendee_context, outcome } = req.body;

  const { data: existing } = await supabaseAdmin.from('user_events').select('id').eq('id', req.params.id).eq('workspace_id', workspaceId).eq('user_id', req.user.id).single();
  if (!existing) return res.status(404).json({ error: 'NOT_FOUND' });

  const updates = {};
  if (title            !== undefined) updates.title            = title?.trim();
  if (event_date       !== undefined) updates.event_date       = event_date;
  if (start_time       !== undefined) updates.start_time       = start_time;
  if (end_time         !== undefined) updates.end_time         = end_time;
  if (event_type       !== undefined) updates.event_type       = event_type;
  if (notes            !== undefined) updates.notes            = notes?.trim();
  if (attendee_name    !== undefined) updates.attendee_name    = attendee_name?.trim();
  if (attendee_context !== undefined) updates.attendee_context = attendee_context?.trim()?.slice(0, 2000);
  if (outcome          !== undefined) updates.outcome          = outcome;

  const { error } = await supabaseAdmin.from('user_events').update(updates).eq('id', req.params.id).eq('workspace_id', workspaceId);
  if (error) throw error;
  res.json({ success: true });
}));

// DELETE /api/calendar/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const workspaceId = req.workspace.id;
  const { data: existing } = await supabaseAdmin.from('user_events').select('id').eq('id', req.params.id).eq('workspace_id', workspaceId).eq('user_id', req.user.id).single();
  if (!existing) return res.status(404).json({ error: 'NOT_FOUND' });
  await supabaseAdmin.from('user_events').delete().eq('id', req.params.id).eq('workspace_id', workspaceId);
  res.json({ success: true });
}));

// POST /api/calendar/:id/debrief
router.post('/:id/debrief', calendarAiRateLimiter, asyncHandler(async (req, res) => {
  const { raw_notes, outcome } = req.body;
  const userId = req.user.id;
  const workspaceId = req.workspace.id;

  if (!outcome) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'outcome is required' });

  const { data: event } = await supabaseAdmin.from('user_events').select('*').eq('id', req.params.id).eq('workspace_id', workspaceId).eq('user_id', userId).single();
  if (!event) return res.status(404).json({ error: 'NOT_FOUND' });

  // Idempotency guard
  if (event.debrief_completed_at) {
    return res.json({ success: true, debrief: event.debrief_content, message: 'Debrief already completed.' });
  }

  const userCtx = buildUserContext(req);
  const debrief = await generateMeetingDebrief(userCtx, event, raw_notes, outcome);

  // Critical DB write — decoupled from follow-up generation
  await supabaseAdmin.from('user_events').update({
    debrief_content:      debrief,
    debrief_completed_at: new Date().toISOString(),
    meeting_notes:        raw_notes || null,
    outcome,
    energy_score:         energyFromOutcome(outcome),
  }).eq('id', event.id).eq('workspace_id', workspaceId);

  // Extract commitments and signals (fire-and-forget — low stakes, no retry needed)
  if (raw_notes?.trim()) {
    extractAndSaveCommitmentsSignals(userId, workspaceId, event, raw_notes).catch(() => {});
  }

  // Update prospect health (fire-and-forget — derived data, safe to retry on next debrief)
  if (event.prospect_id) {
    updateProspectHealth(userId, workspaceId, event.prospect_id).catch(() => {});
  }

  res.json({ success: true, debrief });
}));

// POST /api/calendar/:id/prep
// User-triggered: runs synchronously and returns prep in the response.
// (Not replaced with a job — the user is waiting for the result.)
router.post('/:id/prep', calendarAiRateLimiter, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const workspaceId = req.workspace.id;

  const { data: event } = await supabaseAdmin.from('user_events').select('*').eq('id', req.params.id).eq('workspace_id', workspaceId).eq('user_id', userId).single();
  if (!event) return res.status(404).json({ error: 'NOT_FOUND' });

  if (event.prep_content && event.prep_generated_at) {
    return res.json({ prep: event.prep_content, cached: true });
  }

  const userCtx = buildUserContext(req);
  const context = await buildPrepContext(userId, workspaceId, event);
  const prep    = await generateEnrichedEventPrep(userCtx, event, context);

  await supabaseAdmin.from('user_events').update({
    prep_content:      prep,
    prep_generated:    true,
    prep_generated_at: new Date().toISOString(),
  }).eq('id', event.id).eq('workspace_id', workspaceId);

  res.json({ prep, cached: false });
}));

// POST /api/calendar/:id/research
// User-triggered explicit research — fire-and-forget is acceptable here
// because the endpoint immediately returns 200 with "check back in a moment".
// The user initiated this manually and expects an async result.
router.post('/:id/research', calendarAiRateLimiter, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const workspaceId = req.workspace.id;

  const { data: event } = await supabaseAdmin.from('user_events').select('*').eq('id', req.params.id).eq('workspace_id', workspaceId).eq('user_id', userId).single();
  if (!event) return res.status(404).json({ error: 'NOT_FOUND' });

  const userCtx = buildUserContext(req);
  researchProspectForMeeting(userId, workspaceId, event.id, event, userCtx).catch(() => {});

  res.json({ success: true, message: 'Research started in the background. Check back in a moment.' });
}));

// POST /api/calendar/:id/start-meeting-notes
router.post('/:id/start-meeting-notes', calendarAiRateLimiter, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const workspaceId = req.workspace.id;

  const { data: event } = await supabaseAdmin.from('user_events').select('*').eq('id', req.params.id).eq('workspace_id', workspaceId).eq('user_id', userId).single();
  if (!event) return res.status(404).json({ error: 'NOT_FOUND' });

  // Idempotency — return existing chat if already started
  const { data: existingChat } = await supabaseAdmin.from('chats')
    .select('id').eq('event_id', event.id).eq('workspace_id', workspaceId).eq('user_id', userId)
    .eq('chat_mode', 'meeting_notes').maybeSingle();

  if (existingChat) return res.json({ chat_id: existingChat.id, is_existing: true });

  const { data: newChat, error } = await supabaseAdmin.from('chats').insert({
    workspace_id: workspaceId,
    user_id:      userId,
    event_id:     event.id,
    prospect_id:  event.prospect_id || null,
    title:        `Meeting Notes: ${event.title}`,
    chat_type:    'general',
    chat_mode:    'meeting_notes',
  }).select('id').single();

  if (error) throw error;
  res.status(201).json({ chat_id: newChat.id, is_existing: false });
}));

// ── Internal helpers ──────────────────────────────────────────

// generateAndSaveEnrichedPrep: still used by backgroundWorker CALENDAR_PREP_GENERATE handler.
// Also kept as internal helper for the /:id/prep synchronous user-triggered path.
async function generateAndSaveEnrichedPrep(userCtx, event, workspaceId) {
  try {
    const context = await buildPrepContext(userCtx.id, workspaceId, event);
    const prep    = await generateEnrichedEventPrep(userCtx, event, context);
    await supabaseAdmin.from('user_events').update({
      prep_content: prep, prep_generated: true, prep_generated_at: new Date().toISOString(),
    }).eq('id', event.id).eq('workspace_id', workspaceId);
  } catch (err) {
    logError('generateAndSaveEnrichedPrep', err, { eventId: event.id });
  }
}

async function buildPrepContext(userId, workspaceId, event) {
  const context = {};
  if (event.prospect_id) {
    const [eventsRes, signalsRes, commitmentsRes] = await Promise.all([
      supabaseAdmin.from('user_events')
        .select('title, event_type, outcome, event_date, debrief_content')
        .eq('prospect_id', event.prospect_id).eq('workspace_id', workspaceId).eq('user_id', userId)
        .neq('id', event.id).order('event_date', { ascending: false }).limit(5),
      supabaseAdmin.from('conversation_signals')
        .select('signal_type, signal_text, detected_at')
        .eq('prospect_id', event.prospect_id).eq('workspace_id', workspaceId).eq('user_id', userId)
        .eq('is_active', true).order('detected_at', { ascending: false }).limit(10),
      supabaseAdmin.from('conversation_commitments')
        .select('commitment_text, owner, status, due_date')
        .eq('prospect_id', event.prospect_id).eq('workspace_id', workspaceId).eq('user_id', userId)
        .in('status', ['pending', 'overdue']).eq('owner', 'founder'),
    ]);
    if (eventsRes.data?.length) {
      context.prospectTimeline = eventsRes.data
        .map(e => `${e.event_date}: ${e.event_type} — ${e.outcome || 'no debrief'}. ${e.debrief_content?.summary || ''}`)
        .join('\n');
    }
    context.previousSignals        = signalsRes.data    || [];
    context.outstandingCommitments = commitmentsRes.data || [];
  }
  if (event.perplexity_research) context.perplexityResearch = event.perplexity_research;
  return context;
}

async function upsertProspect(userId, workspaceId, { name, context }) {
  const { data: existing } = await supabaseAdmin.from('prospects').select('id')
    .eq('workspace_id', workspaceId).eq('user_id', userId).ilike('name', name.trim()).limit(1).maybeSingle();
  if (existing) return existing.id;
  try {
    const { data: created, error } = await supabaseAdmin.from('prospects').insert({
      workspace_id: workspaceId, user_id: userId, name: name.trim(),
      notes: context?.trim() || null,
      first_contact_at: new Date().toISOString(),
      last_contact_at:  new Date().toISOString(),
    }).select('id').single();
    if (error) {
      if (error.message?.includes('duplicate key') || error.message?.includes('unique constraint')) {
        const { data: fallback } = await supabaseAdmin.from('prospects').select('id')
          .eq('workspace_id', workspaceId).eq('user_id', userId).ilike('name', name.trim()).limit(1).maybeSingle();
        return fallback?.id || null;
      }
      throw error;
    }
    return created?.id || null;
  } catch (err) {
    logError('upsertProspect', err, { userId, workspaceId });
    return null;
  }
}

async function extractAndSaveCommitmentsSignals(userId, workspaceId, event, rawNotes) {
  const [commitments, signals] = await Promise.all([
    extractCommitmentsFromText(rawNotes, event.attendee_name),
    generateSignalAnalysis(rawNotes, event.attendee_name, null),
  ]);

  if (commitments?.length) {
    try {
      await supabaseAdmin.from('conversation_commitments').insert(
        commitments.map(c => ({
          workspace_id:    workspaceId,
          user_id:         userId,
          prospect_id:     event.prospect_id || null,
          event_id:        event.id,
          commitment_text: c.commitment_text,
          owner:           c.owner           || 'founder',
          status:          'pending',
          due_date:        c.due_date        || null,
          implicit_timing: c.implicit_timing || null,
        }))
      );
    } catch {}
  }

  if (signals?.length) {
    try {
      await supabaseAdmin.from('conversation_signals').insert(
        signals.map(s => ({
          workspace_id: workspaceId,
          user_id:      userId,
          prospect_id:  event.prospect_id || null,
          event_id:     event.id,
          signal_type:  s.signal_type,
          signal_text:  s.signal_text,
          confidence:   s.confidence || null,
        }))
      );
    } catch {}
  }
}

async function updateProspectHealth(userId, workspaceId, prospectId) {
  const now = new Date();
  const [eventsRes, signalsRes, commitmentsRes] = await Promise.all([
    supabaseAdmin.from('user_events').select('outcome, energy_score, event_date')
      .eq('prospect_id', prospectId).eq('workspace_id', workspaceId).eq('user_id', userId)
      .order('event_date', { ascending: false }).limit(10),
    supabaseAdmin.from('conversation_signals').select('signal_type, detected_at')
      .eq('prospect_id', prospectId).eq('workspace_id', workspaceId).eq('user_id', userId).eq('is_active', true),
    supabaseAdmin.from('conversation_commitments').select('owner, status, due_date')
      .eq('prospect_id', prospectId).eq('workspace_id', workspaceId).eq('user_id', userId),
  ]);

  let score = 50;
  const lastEvent = eventsRes.data?.[0];
  if (lastEvent) {
    const daysSince = (now - new Date(lastEvent.event_date)) / 86400000;
    if (daysSince < 3)       score += 20;
    else if (daysSince < 7)  score += 10;
    else if (daysSince >= 30) score -= 30;
    else if (daysSince >= 14) score -= 15;
    const outcomeBonus = { hot: 20, positive: 10, neutral: 0, cold: -10, dead: -30 };
    score += outcomeBonus[lastEvent.outcome] || 0;
  }
  const recentSignals = (signalsRes.data || []).filter(s => (now - new Date(s.detected_at)) / 86400000 < 14);
  score += recentSignals.filter(s => s.signal_type === 'buying').length * 8;
  score -= recentSignals.filter(s => s.signal_type === 'risk').length   * 10;
  const overdueCount = (commitmentsRes.data || []).filter(c => c.owner === 'founder' && c.status === 'overdue').length;
  score -= overdueCount * 12;

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  await supabaseAdmin.from('prospects').update({
    relationship_health_score: finalScore,
    health_updated_at:         now.toISOString(),
    last_contact_at:           now.toISOString(),
  }).eq('id', prospectId).eq('workspace_id', workspaceId);
}

function energyFromOutcome(outcome) {
  return { hot: 5, positive: 4, neutral: 3, cold: 2, dead: 1 }[outcome] || 3;
}

export default router;
