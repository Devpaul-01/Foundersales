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
  scheduled_call_date:   z.string().optional().nullable(),  // ← Accept any string
  scheduled_call_notes:  z.string().max(500).optional().nullable(),
});

// POST /api/feedback
router.post('/', validate(feedbackSchema), asyncHandler(async (req, res) => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();

  // ─── Input Extraction ────────────────────────────────────────────────────
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

  console.log(`\n${'═'.repeat(55)}`);
  console.log(`[FEEDBACK POST] requestId=${requestId}`);
  console.log(`[FEEDBACK POST] userId=${userId} | workspaceId=${workspaceId}`);
  console.log(`[FEEDBACK POST] opportunity_id=${opportunity_id}`);
  console.log(`[FEEDBACK POST] outcome=${outcome} | is_final=${is_final}`);
  console.log(`[FEEDBACK POST] deal_value_usd=${deal_value_usd ?? 'null'} | scheduled_call=${scheduled_call ?? false}`);
  console.log(`[FEEDBACK POST] scheduled_call_date(raw)=${scheduled_call_date ?? 'null'}`);

  // ─── Outcome Validation ───────────────────────────────────────────────────
  const validOutcomes = [...Object.values(FEEDBACK_OUTCOMES), 'pending'];
  if (!validOutcomes.includes(outcome)) {
    console.warn(`[FEEDBACK POST] ✖ Invalid outcome="${outcome}" | valid=${validOutcomes.join(', ')} | requestId=${requestId}`);
    return res.status(400).json({
      error:   'VALIDATION_ERROR',
      message: `outcome must be one of: ${validOutcomes.join(', ')}`,
    });
  }

  // ─── Date Normalization ───────────────────────────────────────────────────
  let normalizedCallDate = scheduled_call_date ?? null;
  if (scheduled_call_date) {
    if (!scheduled_call_date.includes('Z')) {
      const parsed = new Date(scheduled_call_date);
      if (!isNaN(parsed.getTime())) {
        normalizedCallDate = parsed.toISOString();
        console.log(`[FEEDBACK POST] Date normalized: "${scheduled_call_date}" → "${normalizedCallDate}"`);
      } else {
        console.warn(`[FEEDBACK POST] ✖ Unparseable scheduled_call_date="${scheduled_call_date}" — storing null`);
        normalizedCallDate = null;
      }
    } else {
      console.log(`[FEEDBACK POST] Date already UTC, no normalization needed: "${scheduled_call_date}"`);
    }
  }

  // ─── Opportunity Authorization ────────────────────────────────────────────
  console.log(`[FEEDBACK POST] Fetching opportunity opportunity_id=${opportunity_id}...`);
  const oppFetchStart = Date.now();

  const { data: opp, error: oppError } = await supabaseAdmin
    .from('opportunities')
    .select('id, stage')
    .eq('id', opportunity_id)
    .eq('workspace_id', workspaceId)
    .or(`user_id.eq.${userId},assigned_to.eq.${userId}`)
    .single();

  console.log(`[FEEDBACK POST] Opportunity fetch: ${Date.now() - oppFetchStart}ms`);

  if (oppError) {
    console.error(`[FEEDBACK POST] ✖ Opportunity DB error: ${oppError.message} | code=${oppError.code} | requestId=${requestId}`);
  }

  if (!opp) {
    console.warn(`[FEEDBACK POST] ✖ Opportunity not found or unauthorized | opportunity_id=${opportunity_id} | userId=${userId} | requestId=${requestId}`);
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Opportunity not found' });
  }

  console.log(`[FEEDBACK POST] ✔ Opportunity found | id=${opp.id} | stage=${opp.stage}`);

  // ─── Feedback Upsert ──────────────────────────────────────────────────────
  const feedbackPayload = {
    workspace_id:         workspaceId,
    user_id:              userId,
    opportunity_id,
    outcome,
    outcome_note:         outcome_note?.slice(0, 500) || null,
  
    is_final:             !!is_final,
    deal_value_usd:       deal_value_usd ? parseInt(deal_value_usd, 10) : null,
    scheduled_call:       !!scheduled_call,
    scheduled_call_date:  normalizedCallDate,
    scheduled_call_notes: scheduled_call_notes?.slice(0, 500) || null,
  };

  console.log(`[FEEDBACK POST] Upserting feedback...`);
  console.log(`[FEEDBACK POST] Payload:`, JSON.stringify(feedbackPayload));

  const upsertStart = Date.now();
  const { data: feedback, error: upsertError } = await supabaseAdmin
    .from('feedback')
    .upsert(feedbackPayload, { onConflict: 'opportunity_id', ignoreDuplicates: false })
    .select()
    .single();

  console.log(`[FEEDBACK POST] Feedback upsert: ${Date.now() - upsertStart}ms`);

  if (upsertError) {
    console.error(`[FEEDBACK POST] ✖ Feedback upsert failed: ${upsertError.message} | code=${upsertError.code} | requestId=${requestId}`);
    throw upsertError;
  }

  console.log(`[FEEDBACK POST] ✔ Feedback upserted | id=${feedback.id}`);

  // ─── Opportunity Stage Advancement ───────────────────────────────────────
  // ✅ CORRECT - Use new Date()
const oppUpdates = { 
  status: OPPORTUNITY_STATUS.SENT, 
  feedback_prompted_at: new Date(),
  marked_sent_at: new Date()  // Returns Date object
};
  let stageAdvanced = false;

  if (outcome === 'positive' && opp.stage === PIPELINE_STAGES.NEW) {
    oppUpdates.stage = PIPELINE_STAGES.CONTACTED;
    stageAdvanced    = true;
  } else if (outcome === 'positive' && opp.stage === PIPELINE_STAGES.CONTACTED) {
    oppUpdates.stage = PIPELINE_STAGES.REPLIED;
    stageAdvanced    = true;
  }

  console.log(`[FEEDBACK POST] Updating opportunity | stageAdvanced=${stageAdvanced}${stageAdvanced ? ` | ${opp.stage} → ${oppUpdates.stage}` : ''}`);

  const oppUpdateStart = Date.now();
  const { error: oppUpdateError } = await supabaseAdmin
  .from('opportunities')
  .update(oppUpdates)
  .eq('id', opportunity_id)
  .eq('workspace_id', workspaceId)
  .or(`user_id.eq.${userId},assigned_to.eq.${userId}`);  // ← CRITICAL!
  

  console.log(`[FEEDBACK POST] Opportunity update: ${Date.now() - oppUpdateStart}ms`);

  if (oppUpdateError) {
    console.error(`[FEEDBACK POST] ✖ Opportunity update failed (non-fatal) | error=${oppUpdateError.message} | code=${oppUpdateError.code} | requestId=${requestId}`);
  } else {
    console.log(`[FEEDBACK POST] ✔ Opportunity updated | status=${OPPORTUNITY_STATUS.SENT}${stageAdvanced ? ` | stage=${oppUpdates.stage}` : ''}`);
  }

  // ─── Performance Stats ────────────────────────────────────────────────────
  const shouldUpdateStats = is_final && outcome !== 'pending';

  if (shouldUpdateStats) {
    const isPositive = outcome === 'positive';
    console.log(`[FEEDBACK POST] Calling increment_performance_stats | isPositive=${isPositive}`);

    const statsStart = Date.now();
    try {
      const { error: statsError } = 
      await supabaseAdmin.rpc('increment_performance_stats', {
        p_user_id: userId,
        p_is_positive: isPositive,
        p_workspace_id: workspaceId  // ← ADD THIS
        });
      console.log(`[FEEDBACK POST] Performance stats RPC: ${Date.now() - statsStart}ms`);

      if (statsError) {
        console.error(`[FEEDBACK POST] ✖ increment_performance_stats failed (non-fatal) | error=${statsError.message} | requestId=${requestId}`);
      } else {
        console.log(`[FEEDBACK POST] ✔ Performance stats incremented`);
      }
    } catch (err) {
      console.error(`[FEEDBACK POST] ✖ increment_performance_stats threw (non-fatal) | error=${err.message} | requestId=${requestId}`);
    }
  } else {
    console.log(`[FEEDBACK POST] Skipping performance stats | is_final=${is_final} | outcome=${outcome}`);
  }

  // ─── Conversation Analysis Job ────────────────────────────────────────────
  if (shouldUpdateStats) {
    const jobPayload = { feedback_id: feedback.id, user_id: userId, workspace_id: workspaceId };
    console.log(`[FEEDBACK POST] Enqueuing ${QUEUE_JOB_TYPES.CONVERSATION_ANALYSIS} job | feedbackId=${feedback.id}`);

    const jobStart = Date.now();
    try {
      await enqueueJob(QUEUE_JOB_TYPES.CONVERSATION_ANALYSIS, jobPayload);
      console.log(`[FEEDBACK POST] ✔ Job enqueued in ${Date.now() - jobStart}ms | feedbackId=${feedback.id}`);
    } catch (err) {
      console.error(`[FEEDBACK POST] ✖ enqueueJob failed (non-fatal) | error=${err.message} | feedbackId=${feedback.id} | requestId=${requestId}`);
      logError('enqueueJob conversation_analysis', err, { feedbackId: feedback.id });
    }
  } else {
    console.log(`[FEEDBACK POST] Skipping conversation analysis job | is_final=${is_final} | outcome=${outcome}`);
  }

  // ─── Response ─────────────────────────────────────────────────────────────
  const totalMs = Date.now() - startTime;
  console.log(`[FEEDBACK POST] ✔ Complete | feedbackId=${feedback.id} | totalMs=${totalMs} | requestId=${requestId}`);
  console.log(`${'═'.repeat(55)}\n`);

  log('POST OK', { userId, workspaceId, feedbackId: feedback.id, outcome, stageAdvanced, totalMs });
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

  // Single query: opportunities with status='viewed' that have no feedback row.
  // viewed = user has opened the card but hasn't logged what happened yet.
  // `feedback!left(opportunity_id)` performs a LEFT JOIN; `.is('feedback.opportunity_id', null)`
  // filters to rows where no feedback row matched — equivalent to NOT IN (feedback).
  const { data: opps, error } = await supabaseAdmin
    .from('opportunities')
    .select('*, feedback!left(opportunity_id)')
    .eq('workspace_id', workspaceId)
    .or(`user_id.eq.${userId},assigned_to.eq.${userId}`)
    .eq('status', OPPORTUNITY_STATUS.VIEWED)
    .is('feedback.opportunity_id', null);

  if (error) throw error;

  // Strip the left-join metadata before returning
  const clean = (opps || []).map(({ feedback: _fb, ...opp }) => opp);
  res.json({ opportunities: clean });
}));

export default router;
