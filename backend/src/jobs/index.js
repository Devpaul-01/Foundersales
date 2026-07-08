// src/jobs/index.js — MISS-03 (Bull Board active + protected), IMP-02 (backgroundWorker)
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter }   from '@bull-board/api/bullMQAdapter.js';
import { ExpressAdapter }  from '@bull-board/express';
import { registerSchedules }     from './registerSchedules.js';
import { startScheduledWorker }  from './scheduledWorker.js';
import { startPracticeWorker }   from './practiceWorker.js';
import { startBackgroundWorker } from './backgroundWorker.js';
import { scheduledQueue, practiceQueue, backgroundQueue } from './queues.js';
import supabaseAdmin from '../config/supabase.js';
export { enqueueJob }      from './practiceWorker.js';
export { backgroundQueue } from './queues.js';
export { runOpportunityJob, runFeedbackPromptJob, runPerformanceSummaryJob, runMetricsJob, runCalendarPrepJob } from './coreJobs.js';

// MISS-03: Bull Board now active — mount in app.js with x-admin-secret guard
export const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/jobs');
createBullBoard({ queues: [new BullMQAdapter(scheduledQueue), new BullMQAdapter(practiceQueue), new BullMQAdapter(backgroundQueue)], serverAdapter });

// Wrap each independent job-startup step so a Redis/network failure in one
// (e.g. Upstash DNS unreachable) doesn't stop the others from starting,
// and doesn't bubble up as an unhandled rejection.
const safeStart = async (label, fn) => {
  try {
    await fn();
    console.log(`  ✓ ${label} started`);
  } catch (err) {
    console.error(`  ✗ ${label} failed to start (non-fatal):`, err.message);
  }
};

export const startAllJobs = async () => {
  console.log('[Jobs] Initializing BullMQ workers...');

  await safeStart('Schedule registration', registerSchedules);

  // FIX MED-11: Only start the new BullMQ-based workers
  // The old message_queue polling worker is DEPRECATED and not started
  await safeStart('Scheduled worker (1 concurrent, overlap-safe)', startScheduledWorker);
  await safeStart('Practice worker (10 concurrent, replaces message_queue polling)', startPracticeWorker);
  await safeStart('Background worker (5 concurrent, fire-and-forget)', startBackgroundWorker);

  console.log('[Jobs] Startup sequence complete (see ✓/✗ above for per-worker status)');
  console.log('  Bull Board:  /admin/jobs   (x-admin-secret required)');

  // FIX MED-11: Log warning if message_queue still has pending jobs.
  // This hits Supabase, not Redis, but we still don't want it to take the
  // whole startAllJobs() call down if it fails for any reason.
  try {
    const { count } = await supabaseAdmin
      .from('message_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');

    if (count > 0) {
      console.warn(`[Jobs] ⚠️ Found ${count} pending jobs in message_queue table.`);
      console.warn('[Jobs] These will NOT be processed. Migrate to enqueueJob() calls.');
    }
  } catch (err) {
    console.warn('[Jobs] Could not check message_queue pending count (non-fatal):', err.message);
  }
};
