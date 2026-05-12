// src/routes/feedback.js
// ============================================================
// FEEDBACK — WORKSPACE REFACTOR
// All queries filter/insert workspace_id.
// AI context reads from buildUserContext(req).
//
// FIXES APPLIED (refinement plan):
//  Issue 6 / Bug A:  runConversationAnalysis fire-and-forget replaced with
//                    enqueueJob(QUEUE_JOB_TYPES.CONVERSATION_ANALYSIS, ...)
//                    using the BullMQ practiceWorker queue — retryable and
//                    observable in Bull Board.
//  Bug I:            GET /pending replaced 3-query client-side join with a
//                    single Supabase left-join anti-pattern query.
//  Section 6:        Zod feedbackSchema added to POST / with validate middleware.
// ============================================================

import { Router }          from 'express';
import { z }               from 'zod';
import { asyncHandler }    from '../middleware/errorHandler.js';
import { validate }        from '../middleware/validate.js';
import { buildUserContext } from '../middleware/workspace.js';
import {
  FEEDBACK_OUTCOMES,
  PIPELINE_STAGES,
  OPPORTUNITY_STATUS,
  QUEUE_JOB_TYPES,
} from '../config/constants.js';
import { notifyUser, Notifications } from '../services/notifications.js';
import { enqueueJob }      from '../jobs/practiceWorker.js';
// Issue 6: runConversationAnalysis import removed — no longer called inline.
// It is dispatched via enqueueJob → practiceWorker → conversation_analysis handler.
import supabaseAdmin from '../config/supabase.js';
import { createLogger } from '../utils/logger.js';

const router = Router();
const { log, logError } = createLogger('Feedback');

// Section 6: Zod schema for POST /api/feedback
// Validates all body fields before the handler runs, giving the client
// structured validation errors instead of implicit DB constraint failures.
const feedbackSchema = z.object({
  opportunity_id:        z.string().uuid(),
  outcome:               z.enum(['positive', 'negative', 'pending']),
  outcome_note:          z.string().max(500).optional().nullable(),
  is_final:              z.boolean().optional(),
  deal_value_usd:        z.number().int().positive().optional().nullable(),
  scheduled_call:        z.boolean().optional(),
  scheduled_call_date:   z.string().datetime().optional().nullable(),
  scheduled_call_notes:  z.string().max(500).optional().nullable(),
});

// POST /api/feedback
router.post('/', validate(feedbackSchema), asyncHandler(async (req, res) => {
  const {
    opportunity_id,
    outcome,
    outcome_note,
    is_final = true,
    deal_value_usd,
    scheduled_call,
    scheduled_call_date,
    scheduled_call_notes,
  } = req.body;
  const userId      = req.user.id;
  const workspaceId = req.workspace.id;

  const validOutcomes = [...Object.values(FEEDBACK_OUTCOMES), 'pending'];
  if (!validOutcomes.includes(outcome)) {
    return res.status(400).json({
      error:   'VALIDATION_ERROR',
      message: `outcome must be one of: ${validOutcomes.join(', ')}`,
    });
  }

  // Verify opportunity belongs to this workspace + user
  const { data: opp } = await supabaseAdmin
    .from('opportunities').select('id, stage')
    .eq('id', opportunity_id).eq('workspace_id', workspaceId).eq('user_id', userId)
    .single();
  if (!opp) return res.status(404).json({ error: 'NOT_FOUND', message: 'Opportunity not found' });

  const { data: feedback, error } = await supabaseAdmin.from('feedback').insert({
    workspace_id:         workspaceId,
    user_id:              userId,
    opportunity_id,
    outcome,
    outcome_note:         outcome_note?.slice(0, 500) || null,
    is_final:             !!is_final,
    deal_value_usd:       deal_value_usd ? parseInt(deal_value_usd) : null,
    scheduled_call:       !!scheduled_call,
    scheduled_call_date:  scheduled_call_date  || null,
    scheduled_call_notes: scheduled_call_notes?.slice(0, 500) || null,
  }).select().single();

  if (error) throw error;

  // Update opportunity status + stage
  const oppUpdates = { status: outcome === 'positive' ? 'sent' : 'acted' };
  if (outcome === 'positive' && opp.stage === 'new')       oppUpdates.stage = 'contacted';
  if (outcome === 'positive' && opp.stage === 'contacted') oppUpdates.stage = 'replied';
  await supabaseAdmin.from('opportunities').update(oppUpdates).eq('id', opportunity_id);

  // Atomic performance stats update
  if (is_final && outcome !== 'pending') {
    const isPositive = outcome === 'positive';
    await supabaseAdmin.rpc('increment_performance_stats', {
      p_user_id:    userId,
      p_is_positive: isPositive,
    }).catch(() => {});
  }

  // Issue 6 / Bug A: Replace fire-and-forget runConversationAnalysis with
  // a durable BullMQ job. practiceWorker already has the 'conversation_analysis'
  // handler wired up — it just needed a proper enqueue call site.
  // Benefits over the old approach:
  //   - Survives server restarts (persisted in Redis)
  //   - Retries on transient Groq failures
  //   - Visible in Bull Board admin UI
  //   - Uses QUEUE_JOB_TYPES constant (Bug A) — no raw string mismatch risk
  if (is_final && outcome !== 'pending') {
    await enqueueJob(QUEUE_JOB_TYPES.CONVERSATION_ANALYSIS, {
      feedback_id:  feedback.id,
      user_id:      userId,
      workspace_id: workspaceId,
    }).catch(err =>
      logError('enqueueJob conversation_analysis', err, { feedbackId: feedback.id })
    );
  }

  log('POST OK', { userId, workspaceId, feedbackId: feedback.id, outcome });
  res.status(201).json({ feedback });
}));

// GET /api/feedback/history
router.get('/history', asyncHandler(async (req, res) => {
  const { limit = 20, offset = 0 } = req.query;
  const userId      = req.user.id;
  const workspaceId = req.workspace.id;

  const { data: feedback, error } = await supabaseAdmin
    .from('feedback')
    .select('*, opportunities(platform, target_context, target_name, prepared_message)')
    .eq('workspace_id', workspaceId).eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

  if (error) throw error;
  res.json({ feedback: feedback || [] });
}));

// GET /api/feedback/pending
// Bug I: Replaced the old 3-query approach (fetch sentIds → fetch feedbackIds →
// JS filter → re-fetch opps) with a single Supabase left-join anti-pattern query.
// The old approach had O(n) round-trips and would break for large datasets.
// The new approach is one query, workspace-scoped, and returns only rows with no
// matching feedback record.
router.get('/pending', asyncHandler(async (req, res) => {
  const userId      = req.user.id;
  const workspaceId = req.workspace.id;

  // Single query: opportunities with status='sent' that have no feedback row.
  // `feedback!left(opportunity_id)` performs a LEFT JOIN; `.is('feedback.opportunity_id', null)`
  // filters to rows where no feedback row matched — equivalent to NOT IN (feedback).
  const { data: opps, error } = await supabaseAdmin
    .from('opportunities')
    .select('*, feedback!left(opportunity_id)')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .eq('status', 'sent')
    .is('feedback.opportunity_id', null);

  if (error) throw error;

  // Strip the left-join metadata before returning
  const clean = (opps || []).map(({ feedback: _fb, ...opp }) => opp);
  res.json({ opportunities: clean });
}));

export default router;
