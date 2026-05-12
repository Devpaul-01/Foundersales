// src/jobs/practiceWorker.js
// ============================================================
// PRACTICE / EVENT-DRIVEN JOB WORKER
//
// Replaces the old messageQueueWorker.js polling loop and the
// message_queue Supabase table entirely.
//
// How it works:
//   Instead of INSERT INTO message_queue, you call enqueueJob() anywhere
//   in your app. BullMQ handles persistence, retries, delays, and
//   exactly-once execution across all instances.
//
// Usage (call from your routes/services):
//   import { enqueueJob } from '../jobs/practiceWorker.js';
//
//   // 2 seconds after session completes:
//   await enqueueJob('practice_skill_scores', { session_id, user_id }, { delay: 2_000 });
//
//   // 5 seconds after session completes:
//   await enqueueJob('practice_coaching_annotations', { session_id, user_id }, { delay: 5_000 });
//
//   // 2 hours after session completes:
//   await enqueueJob('practice_playbook', { session_id, user_id }, { delay: 2 * 60 * 60 * 1000 });
//
//   // Immediately after feedback is created (replaces conversationAnalysisJob trigger):
//   await enqueueJob('conversation_analysis', { opportunity_id, user_id, feedback_id });
//
// ⚠️  ACTION REQUIRED in messageQueueWorker.js:
//   Add this one line so practiceWorker can reuse your existing handlers:
//
//     export { executeJob };
//
//   The executeJob function is already defined — just make it a named export.
// ============================================================

import { Worker } from 'bullmq';
import { bullmqConnection } from '../config/bullmq.js';
import { practiceQueue }    from './queues.js';

// Reuses the existing switch-case dispatch from messageQueueWorker.js.
// ⚠️  Requires `export { executeJob }` to be added to messageQueueWorker.js.
import { executeJob }           from './messageQueueWorker.js';
import { runConversationAnalysis } from './conversationAnalysisJob.js';

// ──────────────────────────────────────────
// ENQUEUE HELPER — replaces INSERT into message_queue
//
// Options:
//   delay     (ms)  — run after a delay
//   attempts        — retry count (default 3)
//   backoff         — retry strategy
// ──────────────────────────────────────────
export const enqueueJob = async (jobName, payload, options = {}) => {
  await practiceQueue.add(jobName, payload, {
    attempts: 3,
    backoff: {
      type:  'exponential',
      delay: 60_000, // retry after 1min, then 2min, then 4min
    },
    removeOnComplete: { count: 500 },
    removeOnFail:     { count: 500 },
    ...options,
  });
};

// ──────────────────────────────────────────
// WORKER
// ──────────────────────────────────────────
export const startPracticeWorker = () => {
  const worker = new Worker(
    'practice-jobs',
    async (job) => {
      console.log(`[PracticeWorker] ▶ ${job.name} | id=${job.id}`);
      const start = Date.now();

      if (job.name === 'conversation_analysis') {
        // conversationAnalysisJob was never wired into the old index.
        // It is now properly handled here — enqueue it after every feedback insert.
        await runConversationAnalysis(job.data.feedback_id, job.data.user_id, job.data.workspace_id)
      } else {
        // Delegates to the existing executeJob switch-case in messageQueueWorker.js.
        // job_type matches QUEUE_JOB_TYPES constants from constants.js.
        await executeJob({
          job_type: job.name,
          payload:  job.data,
          id:       job.id,
        });
      }

      console.log(`[PracticeWorker] ✓ ${job.name} done (${Date.now() - start}ms)`);
    },
    {
      connection:  bullmqConnection,
      concurrency: 10, // process up to 10 practice jobs in parallel
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`[PracticeWorker] ✗ Failed: ${job?.name} (id=${job?.id}) — ${err.message}`);
  });

  worker.on('error', (err) => {
    console.error('[PracticeWorker] Worker error:', err.message);
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`[PracticeWorker] ${signal} received — draining...`);
    await worker.close();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  console.log('[PracticeWorker] Started — listening for practice jobs');
  return worker;
};
