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

export const startAllJobs = async () => {
  console.log('[Jobs] Initializing BullMQ workers...');
  
  await registerSchedules();
  
  // FIX MED-11: Only start the new BullMQ-based workers
  // The old message_queue polling worker is DEPRECATED and not started
  startScheduledWorker();   // BullMQ scheduled jobs
  startPracticeWorker();    // BullMQ practice jobs (replaces message_queue)
  startBackgroundWorker();  // BullMQ background jobs
  
  console.log('[Jobs] All workers started ✓');
  console.log('  Scheduled:   1 concurrent  (overlap-safe)');
  console.log('  Practice:   10 concurrent  (event-driven, replaces message_queue polling)');
  console.log('  Background:  5 concurrent  (fire-and-forget)');
  console.log('  Bull Board:  /admin/jobs   (x-admin-secret required)');
  
  // FIX MED-11: Log warning if message_queue still has pending jobs
  const { count } = await supabaseAdmin
    .from('message_queue')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  
  if (count > 0) {
    console.warn(`[Jobs] ⚠️ Found ${count} pending jobs in message_queue table.`);
    console.warn('[Jobs] These will NOT be processed. Migrate to enqueueJob() calls.');
  }
};
