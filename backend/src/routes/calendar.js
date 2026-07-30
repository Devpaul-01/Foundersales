// src/routes/calendar.js
// ============================================================
// CALENDAR — WORKSPACE REFACTOR + IMPLEMENTATION PASS (merged)
//
// This merges two parallel changesets:
//
//  1) Workspace-scoping refactor: every query is workspace_id-scoped, AI
//     job context is built via buildUserContext/toAiJobContext, the
//     calendar AI rate limiter is backed by the shared Redis store
//     (config/rateLimitStore.js) so limits are enforced correctly across
//     every instance in a horizontally-scaled deployment, and Issue 14's
//     fire-and-forget AI calls (research + prep) were replaced with
//     retryable BullMQ jobs.
//
//  2) Implementation pass: cursor-based pagination for GET / and the new
//     GET /search, manager-scoped team views, bulk attendees, quick
//     outcome logging, reschedule handling, prep regeneration, follow-up
//     generation/send, prospect timeline, and voice memo upload/retry/list
//     routes (delegated to services/voiceMemoService.js). Prospect
//     auto-creation is now conditional (heuristic or explicit flag) rather
//     than automatic, and PUT/DELETE mutations are additionally filtered
//     by user_id as a security hardening fix.
//
// Scope note: calendar sync, booking pages, and every other Integrations
// item are intentionally NOT part of this pass — no sync/booking imports,
// no meeting_url/external_provider/sync_status fields.
//
// PHASE 3 (Redis Store & Rate Limiting Consistency refactor): the
// calendarAiRateLimiter previously defined inline in this file called
// `createRateLimitStore()` with no namespace, silently sharing the
// 'default' Redis key space with several other unrelated limiters. It's
// now LIMITERS.calendarAiLimiter, defined once in config/limiters.js with
// its own 'calendar_ai' namespace. Behavior (10 req / 5 min / user) is
// unchanged.
// ============================================================

import { Router }    from 'express';
import multer        from 'multer';
import { asyncHandler } from '../middleware/errorHandler.js';
import { buildUserContext, toAiJobContext, requirePermission } from '../middleware/workspace.js';
import {
  generateMeetingDebrief,
  generatePostMeetingFollowUp,
} from '../services/groqCalendarIntelligence.js';
import { extractCommitmentsAndSignals } from '../services/calendarCommitmentsSignals.js';
import { generateAndPersistPrep } from '../services/calendarPrep.js';
import { resolveOrCreateProspect } from '../services/prospectDedup.js';
import { shouldGenerateFollowUp, recordGateDecision } from '../services/calendarAiGate.js';
import { FollowUpOptionsSchema, MeetingDebriefSchema, validateOrFallback } from '../schemas/calendarAiSchemas.js';
import { encodeCursor, decodeCursor, applyCursor, buildPageResponse } from '../utils/pagination.js';
import * as voiceMemoService from '../services/voiceMemoService.js';
import { backgroundQueue }            from '../jobs/queues.js';
import { BACKGROUND_JOB_TYPES, VOICE_MEMO_LIMITS } from '../config/constants.js';
import supabaseAdmin from '../config/supabase.js';
import { createLogger } from '../utils/logger.js';
import { LIMITERS } from '../config/limiters.js';

const router = Router();
const { log, logError, logDB } = createLogger('Calendar');

// Dedicated multer instance for voice memo uploads — memory storage
// (buffer handed directly to storage.js's Cloudinary upload, never
// written to disk), size-limited to VOICE_MEMO_LIMITS.MAX_SIZE_BYTES.
const voiceMemoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: VOICE_MEMO_LIMITS.MAX_SIZE_BYTES },
});

// PHASE 3: LIMITERS.calendarAiLimiter (was calendarAiRateLimiter, defined
// inline here with a namespace-less, and therefore 'default'-namespaced,
// store). See config/limiters.js for the full registry.
const calendarAiRateLimiter = LIMITERS.calendarAiLimiter;

const isValidIsoDatetime = (v) => v == null || !Number.isNaN(Date.parse(v));

const looksExternalAttendee = (context) => {
  if (!context?.trim()) return false;
  return /@|\.com\b|\.io\b|\.co\b|inc\.|llc\b/i.test(context);
};

function energyFromOutcome(outcome) {
  return { hot: 5, positive: 4, neutral: 3, cold: 2, dead: 1 }[outcome] || 3;
}

// ── GET /api/calendar — cursor-paginated ────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const { from, to, cursor, limit = 50 } = req.query;
  const userId = req.user.id;
  const workspaceId = req.workspace.id;
  const cappedLimit = Math.min(Number(limit) || 50, 200);

  const defaultFrom = new Date();
  defaultFrom.setDate(defaultFrom.getDate() - 14);
  const fromDate = from || defaultFrom.toISOString().split('T')[0];
  const toDate = to || (() => { const d = new Date(fromDate); d.setDate(d.getDate() + 90); return d.toISOString().split('T')[0]; })();

  let query = supabaseAdmin
    .from('user_events')
    .select('*, prospects(id, name, company, relationship_health_score)')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .gte('event_date', fromDate)
    .lte('event_date', toDate)
    .order('event_date', { ascending: false })
    .order('seq', { ascending: false });

  const decodedCursor = decodeCursor(cursor);
  query = applyCursor(query, decodedCursor);
  query = query.limit(cappedLimit + 1); // fetch one extra to detect has_more

  const { data: events, error } = await query;
  if (error) throw error;

  const now = new Date();
  const enriched = (events || []).map(e => ({
    ...e,
    debrief_needed: new Date(e.start_time || e.event_date) < now && !e.debrief_completed_at,
    health_score:   e.prospects?.relationship_health_score || null,
  }));

  const { items, pagination } = buildPageResponse(enriched, cappedLimit);
  res.json({ events: items, pagination });
}));

// ── GET /api/calendar/alerts ──────────────────────────────────────────
router.get('/alerts', asyncHandler(async (req, res) => {
  const now = new Date().toISOString();
  const userId = req.user.id;
  const workspaceId = req.workspace.id;

  const [eventsRes, commitmentsRes, eventsTotalRes, commitmentsTotalRes] = await Promise.all([
    supabaseAdmin.from('user_events').select('id, title, event_date, start_time, event_type, attendee_name, outcome')
      .eq('workspace_id', workspaceId).eq('user_id', userId)
      .lt('event_date', now.split('T')[0]).is('debrief_completed_at', null)
      .order('event_date', { ascending: false }).limit(5),
    supabaseAdmin.from('conversation_commitments').select('id, commitment_text, due_date, prospect_id, prospects(name)')
      .eq('workspace_id', workspaceId).eq('user_id', userId)
      .eq('owner', 'founder').in('status', ['pending', 'overdue'])
      .order('due_date', { ascending: true }).limit(10),
    supabaseAdmin.from('user_events').select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId).eq('user_id', userId)
      .lt('event_date', now.split('T')[0]).is('debrief_completed_at', null),
    supabaseAdmin.from('conversation_commitments').select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId).eq('user_id', userId)
      .eq('owner', 'founder').in('status', ['pending', 'overdue']),
  ]);

  const today = new Date().toISOString().split('T')[0];
  const commitments = (commitmentsRes.data || []).map(c => ({ ...c, is_overdue: c.due_date && c.due_date < today }));

  res.json({
    debriefs_needed:       eventsRes.data     || [],
    debriefs_needed_total: eventsTotalRes.count || 0,
    overdue_commitments:   commitments.filter(c => c.is_overdue),
    pending_commitments:   commitments.filter(c => !c.is_overdue),
    commitments_total:     commitmentsTotalRes.count || 0,
  });
}));

// ── GET /api/calendar/search — cursor-paginated ─────────────────────────
// Registered before /:id, matching the existing /alerts ordering convention.
router.get('/search', asyncHandler(async (req, res) => {
  const { q, event_type, outcome, prospect_id, from, to, cursor, limit = 30 } = req.query;
  const workspaceId = req.workspace.id, userId = req.user.id;
  const cappedLimit = Math.min(Number(limit) || 30, 200);

  let query = supabaseAdmin.from('user_events')
    .select('*, prospects(id, name)')
    .eq('workspace_id', workspaceId).eq('user_id', userId);

  if (q?.trim()) query = query.or(`title.ilike.%${q}%,notes.ilike.%${q}%,attendee_name.ilike.%${q}%`);
  if (event_type) query = query.eq('event_type', event_type);
  if (outcome) query = query.eq('outcome', outcome);
  if (prospect_id) query = query.eq('prospect_id', prospect_id);
  if (from) query = query.gte('event_date', from);
  if (to) query = query.lte('event_date', to);

  query = query.order('event_date', { ascending: false }).order('seq', { ascending: false });
  const decodedCursor = decodeCursor(cursor);
  query = applyCursor(query, decodedCursor);
  query = query.limit(cappedLimit + 1);

  const { data, error } = await query;
  if (error) throw error;

  const { items, pagination } = buildPageResponse(data || [], cappedLimit);
  res.json({ events: items, pagination });
}));

// ── GET /api/calendar/team — manager-scoped, NOT wired into nav ────────
router.get('/team', requirePermission('manager'), asyncHandler(async (req, res) => {
  const workspaceId = req.workspace.id;
  const { from, to } = req.query;
  const fromDate = from || new Date().toISOString().split('T')[0];
  const toDate = to || (() => { const d = new Date(); d.setDate(d.getDate() + 14); return d.toISOString().split('T')[0]; })();

  const { data: members } = await supabaseAdmin.from('workspace_members')
    .select('user_id, users(name, email)').eq('workspace_id', workspaceId).eq('status', 'active');

  const { data: events } = await supabaseAdmin.from('user_events')
    .select('id, user_id, title, event_date, start_time, event_type, outcome, debrief_completed_at, attendee_name')
    .eq('workspace_id', workspaceId)
    .gte('event_date', fromDate).lte('event_date', toDate);

  const byUser = {};
  for (const e of (events || [])) { (byUser[e.user_id] ||= []).push(e); }

  const team = (members || []).map(m => ({
    user_id: m.user_id,
    name: m.users?.name,
    event_count: (byUser[m.user_id] || []).length,
    debriefs_needed: (byUser[m.user_id] || []).filter(e => new Date(e.event_date) < new Date() && !e.debrief_completed_at).length,
    events: byUser[m.user_id] || [],
  }));

  res.json({ team, workspace_id: workspaceId });
}));

router.get('/team/:userId', requirePermission('manager'), asyncHandler(async (req, res) => {
  const workspaceId = req.workspace.id;
  const { data: member } = await supabaseAdmin.from('workspace_members').select('id')
    .eq('workspace_id', workspaceId).eq('user_id', req.params.userId).eq('status', 'active').single();
  if (!member) return res.status(404).json({ error: 'NOT_FOUND', message: 'Not an active member of this workspace.' });

  const { data: events } = await supabaseAdmin.from('user_events')
    .select('*, prospects(id, name, relationship_health_score)')
    .eq('workspace_id', workspaceId).eq('user_id', req.params.userId)
    .order('event_date', { ascending: true });

  res.json({ events: events || [] });
}));

// ── POST /api/calendar ────────────────────────────────────────────────
router.post('/', asyncHandler(async (req, res) => {
  const {
    title, event_date, start_time, end_time, event_type = 'meeting', event_timezone,
    notes, attendee_name, attendee_context, opportunity_id, prospect_id, create_prospect,
    recurrence_rule,
  } = req.body;
  const userId = req.user.id;
  const workspaceId = req.workspace.id;

  if (!title || !event_date) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'title and event_date are required' });
  }
  if (attendee_context && attendee_context.length > 2000) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'attendee_context must be under 2000 characters' });
  }
  if (!isValidIsoDatetime(start_time) || !isValidIsoDatetime(end_time)) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'start_time and end_time must be full ISO 8601 datetimes, not bare time strings.',
    });
  }

  const workspaceProfile = req.workspaceProfile;
  const effectiveTimezone = event_timezone || workspaceProfile?.default_timezone || 'UTC';

  const shouldCreateProspect = create_prospect ?? (!!attendee_name?.trim() && looksExternalAttendee(attendee_context));

  let resolvedProspectId = prospect_id || null;
  let prospectAutoCreated = false;
  if (shouldCreateProspect && !resolvedProspectId && attendee_name?.trim()) {
    resolvedProspectId = await resolveOrCreateProspect(userId, workspaceId, {
      name: attendee_name, context: attendee_context,
    });
    prospectAutoCreated = !!resolvedProspectId;
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
      timezone:         effectiveTimezone,
      event_type,
      notes:            notes?.trim()            || null,
      attendee_name:    attendee_name?.trim()    || null,
      attendee_context: attendee_context?.trim() || null,
      opportunity_id:   opportunity_id           || null,
      prospect_id:      resolvedProspectId,
      prospect_auto_created: prospectAutoCreated,
      recurrence_rule:  recurrence_rule || null,
    })
    .select()
    .single();

  if (error) throw error;

  const userCtx = toAiJobContext(buildUserContext(req));

  if (attendee_name || attendee_context) {
    await backgroundQueue.add(
      BACKGROUND_JOB_TYPES.CALENDAR_RESEARCH_PROSPECT,
      { userId, workspaceId, eventId: event.id, userCtx },
      { jobId: `research:${event.id}`, attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
    ).catch(err => logError('backgroundQueue calendar_research_prospect', err, { eventId: event.id }));
  }

  await backgroundQueue.add(
    BACKGROUND_JOB_TYPES.CALENDAR_PREP_GENERATE,
    { userId, workspaceId, eventId: event.id, source: 'create' },
    { jobId: `prep:${event.id}`, attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
  ).catch(err => logError('backgroundQueue calendar_prep_generate', err, { eventId: event.id }));

  res.status(201).json({ event });
}));

// ── POST /api/calendar/:id/attendees — bulk add secondary attendees ────
router.post('/:id/attendees', asyncHandler(async (req, res) => {
  const { attendees } = req.body; // [{ name, email, role }]
  const workspaceId = req.workspace.id;

  const { data: event } = await supabaseAdmin.from('user_events').select('id')
    .eq('id', req.params.id).eq('workspace_id', workspaceId).eq('user_id', req.user.id).single();
  if (!event) return res.status(404).json({ error: 'NOT_FOUND' });

  if (!Array.isArray(attendees) || !attendees.length) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'attendees must be a non-empty array' });
  }

  const rows = attendees.map(a => ({
    event_id: req.params.id, workspace_id: workspaceId,
    name: a.name?.trim(), email: a.email?.trim() || null, role: a.role || 'attendee',
  })).filter(a => a.name);

  const { data, error } = await supabaseAdmin.from('event_attendees').insert(rows).select();
  if (error) throw error;
  res.status(201).json({ attendees: data });
}));

// ── GET /api/calendar/:id ─────────────────────────────────────────────
router.get('/:id', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const workspaceId = req.workspace.id;

  const [eventRes, commitmentsRes, signalsRes, attendeesRes] = await Promise.all([
    supabaseAdmin.from('user_events').select('*, prospects(*)').eq('id', req.params.id).eq('workspace_id', workspaceId).eq('user_id', userId).single(),
    supabaseAdmin.from('conversation_commitments').select('*').eq('event_id', req.params.id).eq('workspace_id', workspaceId).eq('user_id', userId),
    supabaseAdmin.from('conversation_signals').select('*').eq('event_id', req.params.id).eq('workspace_id', workspaceId).eq('user_id', userId).eq('is_active', true),
    supabaseAdmin.from('event_attendees').select('*').eq('event_id', req.params.id).eq('workspace_id', workspaceId),
  ]);

  if (!eventRes.data) return res.status(404).json({ error: 'NOT_FOUND' });

  res.json({
    event: eventRes.data,
    commitments: commitmentsRes.data || [],
    signals: signalsRes.data || [],
    attendees: attendeesRes.data || [],
  });
}));

// ── PUT /api/calendar/:id ──────────────────────────────────────────────
router.put('/:id', asyncHandler(async (req, res) => {
  const workspaceId = req.workspace.id;
  const userId = req.user.id;
  const { title, event_date, start_time, end_time, event_type, notes, attendee_name, attendee_context, outcome } = req.body;

  if (attendee_context !== undefined && attendee_context?.length > 2000) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'attendee_context must be under 2000 characters' });
  }
  if (!isValidIsoDatetime(start_time) || !isValidIsoDatetime(end_time)) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'start_time and end_time must be full ISO 8601 datetimes, not bare time strings.',
    });
  }

  const { data: existing } = await supabaseAdmin.from('user_events').select('id').eq('id', req.params.id).eq('workspace_id', workspaceId).eq('user_id', userId).single();
  if (!existing) return res.status(404).json({ error: 'NOT_FOUND' });

  const updates = {};
  if (title            !== undefined) updates.title            = title?.trim();
  if (event_date       !== undefined) updates.event_date       = event_date;
  if (start_time       !== undefined) updates.start_time       = start_time;
  if (end_time         !== undefined) updates.end_time         = end_time;
  if (event_type       !== undefined) updates.event_type       = event_type;
  if (notes            !== undefined) updates.notes            = notes?.trim();
  if (attendee_name    !== undefined) updates.attendee_name    = attendee_name?.trim();
  if (attendee_context !== undefined) updates.attendee_context = attendee_context?.trim();
  if (outcome          !== undefined) { updates.outcome = outcome; updates.energy_score = energyFromOutcome(outcome); }

  // SECURITY FIX: mutating call now also filters by user_id, not just the
  // pre-check above.
  const { error } = await supabaseAdmin.from('user_events').update(updates)
    .eq('id', req.params.id).eq('workspace_id', workspaceId).eq('user_id', userId);
  if (error) throw error;
  res.json({ success: true });
}));

// ── PATCH /api/calendar/:id/outcome — quick outcome log, no full debrief ─
router.patch('/:id/outcome', asyncHandler(async (req, res) => {
  const { outcome } = req.body;
  if (!['hot','positive','neutral','cold','dead'].includes(outcome)) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Invalid outcome' });
  }
  const workspaceId = req.workspace.id, userId = req.user.id;
  const { data: existing } = await supabaseAdmin.from('user_events').select('id')
    .eq('id', req.params.id).eq('workspace_id', workspaceId).eq('user_id', userId).single();
  if (!existing) return res.status(404).json({ error: 'NOT_FOUND' });

  await supabaseAdmin.from('user_events')
    .update({ outcome, energy_score: energyFromOutcome(outcome) })
    .eq('id', req.params.id).eq('workspace_id', workspaceId).eq('user_id', userId);
  res.json({ success: true, outcome });
}));

// ── POST /api/calendar/:id/reschedule ──────────────────────────────────
router.post('/:id/reschedule', asyncHandler(async (req, res) => {
  const { event_date, start_time, end_time } = req.body;
  const workspaceId = req.workspace.id, userId = req.user.id;

  if (!isValidIsoDatetime(start_time) || !isValidIsoDatetime(end_time)) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'start_time/end_time must be full ISO 8601 datetimes.' });
  }

  const { data: existing } = await supabaseAdmin.from('user_events').select('*')
    .eq('id', req.params.id).eq('workspace_id', workspaceId).eq('user_id', userId).single();
  if (!existing) return res.status(404).json({ error: 'NOT_FOUND' });

  const updates = {
    event_date, start_time: start_time || null, end_time: end_time || null,
    reschedule_count: (existing.reschedule_count || 0) + 1,
    original_event_date: existing.original_event_date || existing.event_date,
    original_start_time: existing.original_start_time || existing.start_time,
  };

  const daysMoved = Math.abs((new Date(event_date) - new Date(existing.event_date)) / 86400000);
  if (existing.prep_generated && daysMoved >= 3) {
    updates.prep_generated = false;
    updates.prep_generated_at = null;
  }

  await supabaseAdmin.from('user_events').update(updates)
    .eq('id', req.params.id).eq('workspace_id', workspaceId).eq('user_id', userId);

  if (updates.reschedule_count >= 2 && existing.prospect_id) {
    await supabaseAdmin.from('conversation_signals').insert({
      workspace_id: workspaceId, user_id: userId, prospect_id: existing.prospect_id,
      source_type: 'reschedule_pattern', source_id: existing.id, event_id: existing.id,
      signal_type: 'risk', signal_text: `Meeting rescheduled ${updates.reschedule_count} times.`,
      confidence: 0.7,
    }).catch(err => logError('reschedule risk signal insert', err, { eventId: existing.id }));
  }

  if (updates.prep_generated === false) {
    await backgroundQueue.add(BACKGROUND_JOB_TYPES.CALENDAR_PREP_GENERATE,
      { userId, workspaceId, eventId: existing.id, source: 'reschedule' },
      { jobId: `prep:${existing.id}:reschedule:${Date.now()}`, attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
    ).catch(err => logError('backgroundQueue reschedule prep', err, { eventId: existing.id }));
  }

  res.json({ success: true, reschedule_count: updates.reschedule_count });
}));

// ── DELETE /api/calendar/:id ───────────────────────────────────────────
router.delete('/:id', asyncHandler(async (req, res) => {
  const workspaceId = req.workspace.id;
  const userId = req.user.id;
  const { data: existing } = await supabaseAdmin.from('user_events').select('id').eq('id', req.params.id).eq('workspace_id', workspaceId).eq('user_id', userId).single();
  if (!existing) return res.status(404).json({ error: 'NOT_FOUND' });

  // Clean up voice memo storage objects before the DB cascade fires.
  await voiceMemoService.deleteMemosForEvent(workspaceId, req.params.id).catch(err =>
    logError('voice memo cleanup on event delete', err, { eventId: req.params.id })
  );

  // SECURITY FIX: mutating call now also filters by user_id.
  await supabaseAdmin.from('user_events').delete().eq('id', req.params.id).eq('workspace_id', workspaceId).eq('user_id', userId);
  res.json({ success: true });
}));

// ── POST /api/calendar/:id/debrief ─────────────────────────────────────
router.post('/:id/debrief', calendarAiRateLimiter, asyncHandler(async (req, res) => {
  const { raw_notes, outcome } = req.body;
  const userId = req.user.id;
  const workspaceId = req.workspace.id;

  if (!outcome) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'outcome is required' });

  const { data: event } = await supabaseAdmin.from('user_events').select('*').eq('id', req.params.id).eq('workspace_id', workspaceId).eq('user_id', userId).single();
  if (!event) return res.status(404).json({ error: 'NOT_FOUND' });

  if (event.debrief_completed_at) {
    return res.json({ success: true, debrief: event.debrief_content, message: 'Debrief already completed.' });
  }

  const userCtx = buildUserContext(req);
  const rawDebrief = await generateMeetingDebrief(userCtx, event, raw_notes, outcome);
  const FALLBACK_DEBRIEF = {
    summary: `Meeting completed with ${event.attendee_name || 'prospect'}.`,
    what_worked: 'You showed up prepared.',
    what_to_improve: 'Try to get a specific next-step commitment before ending the call.',
    coachable_moment: 'What you do in the next 48 hours matters more than the meeting outcome itself.',
    next_step_recommendation: 'Send a follow-up confirming one specific next action.',
  };
  const debrief = validateOrFallback(MeetingDebriefSchema, rawDebrief, FALLBACK_DEBRIEF, { context: `debrief:${event.id}` });
  const persistedDebrief = { ...debrief, generated_at: new Date().toISOString() };

  await supabaseAdmin.from('user_events').update({
    debrief_content:      persistedDebrief,
    debrief_completed_at: new Date().toISOString(),
    meeting_notes:        raw_notes || null,
    outcome,
    energy_score:         energyFromOutcome(outcome),
  }).eq('id', event.id).eq('workspace_id', workspaceId);

  // DURABILITY FIX: both of these were previously bare fire-and-forget
  // (.catch(() => {})) — now durable jobs.
  if (raw_notes?.trim()) {
    await backgroundQueue.add(
      BACKGROUND_JOB_TYPES.CALENDAR_EXTRACT_COMMITMENTS_SIGNALS,
      { userId, workspaceId, eventId: event.id, rawNotes: raw_notes },
      { jobId: `extract:${event.id}`, attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
    ).catch(err => logError('enqueue extract_commitments_signals', err, { eventId: event.id }));
  }

  if (event.prospect_id) {
    await backgroundQueue.add(
      BACKGROUND_JOB_TYPES.CALENDAR_UPDATE_PROSPECT_HEALTH,
      { userId, workspaceId, prospectId: event.prospect_id },
      { jobId: `health:${event.prospect_id}:${event.id}`, attempts: 3, backoff: { type: 'exponential', delay: 3000 } }
    ).catch(err => logError('enqueue update_prospect_health', err, { eventId: event.id }));
  }

  // Auto-trigger follow-up generation immediately after debrief.
  await backgroundQueue.add(
    BACKGROUND_JOB_TYPES.CALENDAR_GENERATE_FOLLOWUP,
    { userId, workspaceId, eventId: event.id },
    { jobId: `followup:${event.id}`, attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
  ).catch(err => logError('enqueue generate_followup', err, { eventId: event.id }));

  res.json({ success: true, debrief: persistedDebrief });
}));

// ── POST /api/calendar/:id/prep ────────────────────────────────────────
router.post('/:id/prep', calendarAiRateLimiter, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const workspaceId = req.workspace.id;

  const { data: event } = await supabaseAdmin.from('user_events').select('*').eq('id', req.params.id).eq('workspace_id', workspaceId).eq('user_id', userId).single();
  if (!event) return res.status(404).json({ error: 'NOT_FOUND' });

  if (event.prep_content && event.prep_generated_at) {
    return res.json({ prep: event.prep_content, cached: true });
  }

  const userCtx = buildUserContext(req);
  const prep = await generateAndPersistPrep(userCtx, event, workspaceId);
  res.json({ prep, cached: false });
}));

// ── POST /api/calendar/:id/prep/regenerate — backs the failure-retry UI ─
router.post('/:id/prep/regenerate', calendarAiRateLimiter, asyncHandler(async (req, res) => {
  const workspaceId = req.workspace.id, userId = req.user.id;
  const { data: event } = await supabaseAdmin.from('user_events').select('*')
    .eq('id', req.params.id).eq('workspace_id', workspaceId).eq('user_id', userId).single();
  if (!event) return res.status(404).json({ error: 'NOT_FOUND' });

  const userCtx = buildUserContext(req);
  const prep = await generateAndPersistPrep(userCtx, event, workspaceId);
  res.json({ prep, cached: false });
}));

// ── POST /api/calendar/:id/research ────────────────────────────────────
router.post('/:id/research', calendarAiRateLimiter, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const workspaceId = req.workspace.id;

  const { data: event } = await supabaseAdmin.from('user_events').select('*').eq('id', req.params.id).eq('workspace_id', workspaceId).eq('user_id', userId).single();
  if (!event) return res.status(404).json({ error: 'NOT_FOUND' });

  const userCtx = toAiJobContext(buildUserContext(req));

  // DURABILITY FIX: now routes through the SAME job type POST / already
  // uses for the same underlying function, closing the prior inconsistency
  // (fire-and-forget here vs. durable job on creation).
  await backgroundQueue.add(
    BACKGROUND_JOB_TYPES.CALENDAR_RESEARCH_PROSPECT,
    { userId, workspaceId, eventId: event.id, userCtx },
    { jobId: `research:${event.id}:manual:${Date.now()}`, attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
  );

  res.json({ success: true, message: 'Research started in the background. Check back in a moment.' });
}));

// ── POST /api/calendar/:id/follow-up ───────────────────────────────────
router.post('/:id/follow-up', calendarAiRateLimiter, asyncHandler(async (req, res) => {
  const userId = req.user.id, workspaceId = req.workspace.id;
  const { data: event } = await supabaseAdmin.from('user_events')
    .select('*').eq('id', req.params.id).eq('workspace_id', workspaceId).eq('user_id', userId).single();
  if (!event) return res.status(404).json({ error: 'NOT_FOUND' });
  if (!event.debrief_completed_at) {
    return res.status(400).json({ error: 'DEBRIEF_REQUIRED', message: 'Submit a debrief before generating a follow-up.' });
  }
  if (event.follow_up_options && event.follow_up_generated_at) {
    return res.json({ follow_up: event.follow_up_options, cached: true });
  }

  const gate = shouldGenerateFollowUp(event);
  await recordGateDecision({ workspaceId, userId, eventId: event.id, aiFunction: 'follow_up', gateResult: gate });
  if (!gate.proceed) {
    return res.status(400).json({ error: 'NOT_APPLICABLE', message: 'No follow-up recommended for this meeting outcome.' });
  }

  const [{ data: commitments }, { data: signals }] = await Promise.all([
    supabaseAdmin.from('conversation_commitments').select('*').eq('event_id', event.id).eq('workspace_id', workspaceId),
    supabaseAdmin.from('conversation_signals').select('*').eq('event_id', event.id).eq('workspace_id', workspaceId),
  ]);

  const userCtx = buildUserContext(req);
  const rawFollowUp = await generatePostMeetingFollowUp(userCtx, event, event.debrief_content, commitments || [], signals || []);
  const followUp = validateOrFallback(FollowUpOptionsSchema, rawFollowUp, {
    brief: `Hey ${event.attendee_name || 'there'} — great talking today.`,
    substantive: `Hey ${event.attendee_name || 'there'} — appreciated our conversation. What's the best next step from your side?`,
    re_engagement: `Hey ${event.attendee_name || 'there'} — checking back in after our chat. Any thoughts since we last spoke?`,
  }, { context: `followup:${event.id}` });

  await supabaseAdmin.from('user_events').update({
    follow_up_options: followUp,
    follow_up_generated_at: new Date().toISOString(),
  }).eq('id', event.id).eq('workspace_id', workspaceId);

  res.json({ follow_up: followUp, cached: false });
}));

router.post('/:id/follow-up/send', asyncHandler(async (req, res) => {
  const { variant } = req.body;
  if (!['brief', 'substantive', 're_engagement'].includes(variant)) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Invalid variant' });
  }
  const workspaceId = req.workspace.id;
  await supabaseAdmin.from('user_events').update({
    follow_up_variant_sent: variant,
    follow_up_sent_at: new Date().toISOString(),
  }).eq('id', req.params.id).eq('workspace_id', workspaceId).eq('user_id', req.user.id);
  res.json({ success: true });
}));

// ── GET /api/calendar/:id/timeline — prospect history + signals ────────
router.get('/:id/timeline', asyncHandler(async (req, res) => {
  const workspaceId = req.workspace.id, userId = req.user.id;
  const { data: event } = await supabaseAdmin.from('user_events').select('prospect_id')
    .eq('id', req.params.id).eq('workspace_id', workspaceId).eq('user_id', userId).single();
  if (!event?.prospect_id) return res.json({ narrative: null, timeline: [] });

  const [{ data: prospect }, eventsRes, signalsRes] = await Promise.all([
    supabaseAdmin.from('prospects').select('ai_summary').eq('id', event.prospect_id).eq('workspace_id', workspaceId).maybeSingle(),
    supabaseAdmin.from('user_events').select('id, title, event_type, outcome, event_date')
      .eq('prospect_id', event.prospect_id).eq('workspace_id', workspaceId).eq('user_id', userId)
      .order('event_date', { ascending: false }).limit(15),
    supabaseAdmin.from('conversation_signals').select('signal_type, signal_text, detected_at')
      .eq('prospect_id', event.prospect_id).eq('workspace_id', workspaceId).eq('user_id', userId)
      .eq('is_active', true).order('detected_at', { ascending: false }).limit(10),
  ]);

  const timeline = [
    ...(eventsRes.data || []).map(e => ({ type: 'event', ...e, date: e.event_date })),
    ...(signalsRes.data || []).map(s => ({ type: 'signal', ...s, date: s.detected_at })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  res.json({ narrative: prospect?.ai_summary || null, timeline });
}));

// ── Voice memo routes — delegated to services/voiceMemoService.js ──────
// Single-step multipart upload supports BOTH in-app recording (browser
// MediaRecorder blob) and uploading an existing audio file, distinguished
// only by the `source` field.
router.post('/:id/voice-memo', voiceMemoUpload.single('audio'), asyncHandler(async (req, res) => {
  const workspaceId = req.workspace.id, userId = req.user.id;
  if (!req.file) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'No audio file provided (field name: audio)' });

  const { source, duration_seconds } = req.body; // source: 'recorded' | 'uploaded'

  const result = await voiceMemoService.createMemo({
    workspaceId, userId, eventId: req.params.id,
    buffer: req.file.buffer,
    mimeType: req.file.mimetype,
    originalFilename: req.file.originalname,
    source: source === 'uploaded' ? 'uploaded' : 'recorded',
    clientDurationSeconds: duration_seconds ? Number(duration_seconds) : null,
  });
  if (result.error) return res.status(400).json({ error: 'VALIDATION_ERROR', message: result.error });

  res.status(201).json({ memo: result.memo });
}));

router.post('/:id/voice-memo/:memoId/retry', calendarAiRateLimiter, asyncHandler(async (req, res) => {
  const workspaceId = req.workspace.id;
  const result = await voiceMemoService.retryTranscription({ memoId: req.params.memoId, workspaceId, userId: req.user.id });
  if (result.error) return res.status(400).json({ error: 'VALIDATION_ERROR', message: result.error });
  res.json({ success: true });
}));

router.get('/:id/voice-memos', asyncHandler(async (req, res) => {
  const workspaceId = req.workspace.id, userId = req.user.id;
  const memos = await voiceMemoService.listMemosForEvent(workspaceId, userId, req.params.id);
  res.json({ voice_memos: memos });
}));

// ── POST /api/calendar/:id/start-meeting-notes (unchanged) ─────────────
router.post('/:id/start-meeting-notes', calendarAiRateLimiter, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const workspaceId = req.workspace.id;

  const { data: event } = await supabaseAdmin.from('user_events').select('*').eq('id', req.params.id).eq('workspace_id', workspaceId).eq('user_id', userId).single();
  if (!event) return res.status(404).json({ error: 'NOT_FOUND' });

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

export default router;
