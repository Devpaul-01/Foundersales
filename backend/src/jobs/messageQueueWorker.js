// src/jobs/messageQueueWorker.js
// ============================================================
// FIXES APPLIED (refinement plan):
//  Issue 12: handlePlaybook notifyUser call updated to include
//            chat_id and redirect_url in the data payload.
//            Previously only session_id was passed — the frontend
//            could not open the chat directly on tap.
//  Issue 13: handleReply chat_messages inserts now include workspace_id.
//            session.workspace_id is extracted after the session fetch
//            and added to every chat_messages row — consistent with all
//            other insert sites in the codebase.
//            (handleReply itself, along with handleGhost, was later
//            removed entirely as confirmed dead code — see
//            docs/backend-takeover/AUDIT.md. This note is left as
//            historical record of the fix at the time it applied.)
// ============================================================

import supabaseAdmin    from '../config/supabase.js';
import { QUEUE_JOB_TYPES, DELIVERY_STATUS } from '../config/constants.js';
import groqService      from '../services/groq.js';
import { notifyUser }   from '../services/notifications.js';
import { checkAndGenerateWeaknessCard } from './practiceWeaknessDetector.js';
import { createLogger } from '../utils/logger.js';

const { log, logError, logDB } = createLogger('Practice:Queue');

const isDebugMode = process.env.DEBUG_MODE === 'true';

const logAIRequest = (fn, payload) => {
  if (!isDebugMode) return;
  const safePayload = typeof payload === 'object'
    ? { ...payload, message: payload.message?.slice(0, 200) }
    : payload;
  console.log(`[Practice:Queue] 🤖 AI Request [${fn}] →`, JSON.stringify(safePayload, null, 2));
};

const logAIResponse = (fn, response) => {
  if (!isDebugMode) return;
  const safeResponse = typeof response === 'object' && response?.reply
    ? { ...response, reply: response.reply?.slice(0, 200) }
    : response;
  console.log(`[Practice:Queue] 🤖 AI Response [${fn}] →`, JSON.stringify(safeResponse, null, 2));
};

export const executeJob = async (job) => {
  log('Dispatching Job', { jobId: job.id, type: job.job_type });

  switch (job.job_type) {
    case QUEUE_JOB_TYPES.PRACTICE_DELIVERED:             return handleDelivered(job.payload, job.id);
    case QUEUE_JOB_TYPES.PRACTICE_SEEN:                  return handleSeen(job.payload, job.id);
    case QUEUE_JOB_TYPES.PRACTICE_SKILL_SCORES:          return handleSkillScores(job.payload, job.id);
    case QUEUE_JOB_TYPES.PRACTICE_COACHING_ANNOTATIONS:  return handleCoachingAnnotations(job.payload, job.id);
    case QUEUE_JOB_TYPES.PRACTICE_PLAYBOOK:              return handlePlaybook(job.payload, job.id);
    default:
      logError('executeJob', new Error(`Unknown job type: ${job.job_type}`), { jobId: job.id });
      throw new Error(`Unknown job type: ${job.job_type}`);
  }
};

// ──────────────────────────────────────────
// DELIVERED
// ──────────────────────────────────────────
const handleDelivered = async ({ message_id }, jobId) => {
  log('Delivered Handler Start', { jobId, messageId: message_id });

  logDB('UPDATE', 'chat_messages', { messageId: message_id, delivery_status: 'delivered' });
  await supabaseAdmin.from('chat_messages')
    .update({ delivery_status: DELIVERY_STATUS.DELIVERED, delivered_at: new Date().toISOString() })
    .eq('id', message_id);

  log('Message Marked Delivered', { jobId, messageId: message_id });
};

// ──────────────────────────────────────────
// SEEN
// ──────────────────────────────────────────
const handleSeen = async ({ message_id }, jobId) => {
  log('Seen Handler Start', { jobId, messageId: message_id });

  logDB('UPDATE', 'chat_messages', { messageId: message_id, delivery_status: 'seen' });
  await supabaseAdmin.from('chat_messages')
    .update({ delivery_status: DELIVERY_STATUS.SEEN, seen_at: new Date().toISOString() })
    .eq('id', message_id);

  log('Message Marked Seen (Frontend Should Show Typing Indicator)', { jobId, messageId: message_id });
};

// ──────────────────────────────────────────
// SKILL SCORES
// ──────────────────────────────────────────
const handleSkillScores = async ({ session_id, user_id }, jobId) => {
  log('Skill Scores Handler Start', { jobId, sessionId: session_id, userId: user_id });
  console.log(`[Practice:Queue] Scoring session ${session_id}`);

  const [{ data: session }, { data: user }] = await Promise.all([
    supabaseAdmin.from('practice_sessions').select('*').eq('id', session_id).single(),
    supabaseAdmin.from('users').select('*').eq('id', user_id).single(),
  ]);

  if (!session || !user) {
    log('Skill Scores Aborted', { jobId, sessionId: session_id, userId: user_id });
    return;
  }

  const { data: messages } = await supabaseAdmin.from('chat_messages')
    .select('id, role, content, created_at').eq('chat_id', session.chat_id)
    .order('created_at', { ascending: true });

  // Idempotency guard: this job has `attempts: 3` (practiceWorker.js), so a
  // transient failure after the AI call but before/during the DB write (or
  // a worker crash/restart mid-job) causes BullMQ to redeliver it. Without
  // this check, redelivery re-ran the Groq call from scratch every time —
  // same end result, but real duplicate AI cost on every retry. Matches
  // the guard handlePlaybook already uses for the same reason, just not
  // previously applied here. skill_scores is only ever set by this
  // handler, so its presence reliably means a prior attempt already
  // completed the expensive part.
  let skillScores = session.skill_scores;
  if (skillScores) {
    log('Skill Scores Already Present — Skipping Regeneration', { jobId, sessionId: session_id });
  } else {
    logAIRequest('generateMultiAxisScores', { userId: user_id, sessionId: session_id, messageCount: messages?.length });
    skillScores = await groqService.generateMultiAxisScores(user, messages || [], session.buyer_profile || {});
    await supabaseAdmin.from('practice_sessions').update({ skill_scores: skillScores }).eq('id', session_id);
  }

  // Same idempotency reasoning as skillScores above, applied to this
  // separate AI call: skip only if a prior attempt already saved a
  // comparison for this session.
  if (session.retry_of_session_id && !session.retry_comparison) {
    const { data: origSession } = await supabaseAdmin.from('practice_sessions')
      .select('*').eq('id', session.retry_of_session_id).single();
    if (origSession) {
      const { data: origMessages } = await supabaseAdmin.from('chat_messages')
        .select('role, content').eq('chat_id', origSession.chat_id)
        .order('created_at', { ascending: true });
      const comparison = await groqService.generateRetryComparison(
        user, origMessages || [], messages || [],
        origSession.skill_scores?.session_score || origSession.message_strength_score,
        skillScores.session_score
      );
      if (comparison) {
        await supabaseAdmin.from('practice_sessions').update({ retry_comparison: comparison }).eq('id', session_id);
      }
    }
  }

  log('Skill Scores Handler Complete', { jobId, sessionId: session_id, score: skillScores?.session_score });
  console.log(`[Practice:Queue] Skill scores saved for ${session_id}: ${skillScores.session_score}/100`);
  await checkAndGenerateWeaknessCard({ user_id, session_id, skillScores }).catch(err =>
    logError('handleSkillScores → weaknessCard', err, { sessionId: session_id })
  );
};

// ──────────────────────────────────────────
// COACHING ANNOTATIONS
// ──────────────────────────────────────────
const handleCoachingAnnotations = async ({ session_id, user_id }, jobId) => {
  log('Coaching Annotations Handler Start', { jobId, sessionId: session_id, userId: user_id });
  console.log(`[Practice:Queue] Generating coaching annotations for ${session_id}`);

  const [{ data: session }, { data: user }] = await Promise.all([
    supabaseAdmin.from('practice_sessions').select('*').eq('id', session_id).single(),
    supabaseAdmin.from('users').select('*').eq('id', user_id).single(),
  ]);

  if (!session || !user) {
    log('Annotations Aborted', { jobId, sessionId: session_id, userId: user_id });
    return;
  }

  // Idempotency guard: same reasoning as handleSkillScores above — this
  // job has attempts: 3 and redelivery previously re-ran the Groq call
  // from scratch every time. coaching_annotations is only ever set by
  // this handler, so a non-empty array reliably means a prior attempt
  // already completed.
  if (Array.isArray(session.coaching_annotations) && session.coaching_annotations.length > 0) {
    log('Coaching Annotations Already Present — Skipping Regeneration', { jobId, sessionId: session_id });
    console.log(`[Practice:Queue] Annotations already saved for ${session_id} — skipping`);
    return;
  }

  const { data: messages } = await supabaseAdmin.from('chat_messages')
    .select('id, role, content, created_at').eq('chat_id', session.chat_id)
    .order('created_at', { ascending: true });

  const annotations = await groqService.generateCoachingAnnotations(
    user, messages || [], session.buyer_state_history || [], session.buyer_profile || {}
  );

  if (annotations.length > 0) {
    await supabaseAdmin.from('practice_sessions')
      .update({ coaching_annotations: annotations }).eq('id', session_id);
  }

  log('Coaching Annotations Handler Complete', { jobId, sessionId: session_id, annotationsCount: annotations.length });
  console.log(`[Practice:Queue] ${annotations.length} annotations saved for ${session_id}`);
};

// ──────────────────────────────────────────
// PLAYBOOK
// ──────────────────────────────────────────
const handlePlaybook = async ({ session_id, user_id }, jobId) => {
  log('Playbook Handler Start', { jobId, sessionId: session_id, userId: user_id });
  console.log(`[Practice:Queue] Generating playbook for ${session_id}`);

  const [{ data: session }, { data: user }] = await Promise.all([
    supabaseAdmin.from('practice_sessions').select('*').eq('id', session_id).single(),
    supabaseAdmin.from('users').select('*').eq('id', user_id).single(),
  ]);

  if (!session || !user) {
    log('Playbook Aborted', { jobId, sessionId: session_id, userId: user_id });
    return;
  }
  if (session.playbook_generated) {
    log('Playbook Already Generated — Skipping', { jobId, sessionId: session_id });
    return;
  }

  const { data: messages } = await supabaseAdmin.from('chat_messages')
    .select('id, role, content').eq('chat_id', session.chat_id)
    .order('created_at', { ascending: true });

  const playbook = await groqService.generatePlaybook(
    user, messages || [], session.buyer_profile || {},
    session.coaching_annotations || [], session.scenario_type
  );

  if (playbook) {
    await supabaseAdmin.from('practice_sessions')
      .update({ playbook, playbook_generated: true }).eq('id', session_id);

    // Issue 12: notify now includes chat_id and redirect_url so the frontend
    // can deep-link directly into the session chat on tap.
    // Previously only session_id was passed — no direct navigation was possible.
    await notifyUser(user_id, {
      title: `Your ${session.scenario_type} playbook is ready 📋`,
      body:  'Opening, discovery questions & objection responses — tap to see.',
      data:  {
        type:         'practice_playbook',
        session_id:   String(session_id),
        chat_id:      String(session.chat_id),          // Issue 12: added
        redirect_url: `/practice/${session_id}`,         // Issue 12: added
      },
    });

    log('User Notified — Playbook Ready', { jobId, userId: user_id, sessionId: session_id });
  }

  log('Playbook Handler Complete', { jobId, sessionId: session_id, generated: !!playbook });
  console.log(`[Practice:Queue] Playbook generated for ${session_id}`);
};
