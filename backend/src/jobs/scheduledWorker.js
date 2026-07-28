// src/jobs/scheduledWorker.js
// ============================================================
// SCHEDULED JOB WORKER
//
// Processes jobs from the 'scheduled-jobs' BullMQ queue.
// Runs on ONE instance at a time across all replicas thanks to
// BullMQ's distributed lock — no duplicate job runs on deploy.
//
// concurrency: 1  → only one scheduled job runs at a time (no overlap
//                   even if the previous run took longer than the interval)
// lockDuration    → 10 minutes; extend this if any single job can
//                   take longer than that to complete
//
// FIX: Removed duplicate `export const startScheduledWorker` declaration
//      that was nested inside the outer function body. ES modules do not
//      allow `export` statements inside function scope — this caused a
//      SyntaxError that crashed the entire worker on startup, silencing
//      all scheduled jobs.
// FIX MED-07: process.exit(0) removed from SIGTERM/SIGINT handler.
//      The previous implementation called process.exit(0) after
//      worker.close(), killing the process before practiceWorker's
//      shutdown handler could drain in-flight jobs. Shutdown is now
//      cooperative — the process exits naturally when all workers close.
//
// IMPL-SENTRY-01 (Phase 2 refactor / L4): the existing 'failed' handler's
// console.error is now paired with a Sentry.captureException call, tagged
// with the job name/id, so a scheduled job failure has external
// visibility instead of only ever being seen if someone happens to be
// watching server logs at the moment it fails. No-ops safely if Sentry
// was never initialized (SENTRY_DSN unset) — see config/sentry.js.
//
// NEW HANDLERS (implementation pass): calendar_reminder_scan,
// calendar_debrief_digest, prospect_dedup_scan.
// ============================================================

import { Worker } from 'bullmq';
import { bullmqConnection } from '../config/bullmq.js';
import * as Sentry from '@sentry/node';

// Scheduled/recurring jobs
import { runMemoryExtractionJob }        from './memoryExtractionJob.js';
import { runFollowupSequenceJob }        from './followupSequenceJob.js';
import { runEmailDigestJob }             from './emailDigestJob.js';
import { runPatternDetectionJob }        from './patternDetectionJob.js';
import { runPatternInsightsJob }         from './patternInsightsJob.js';
import { runSkillProgressionJob }        from './skillProgressionJob.js';
import { runMorningGrowthPush,
         runEveningGrowthPush }          from './growthPushNotificationJob.js';
import {
  runDailyTipGeneration,
  runCheckInScheduler,
  runWeeklyPlanGeneration,
  runGoalNudgeJob,
  runAdaptiveCurriculumJob,
  runSkillProfileAggregationJob,
}                                        from './growthIntelligenceScheduler.js';

// Core inline jobs
import {
  runOpportunityJob,
  runFeedbackPromptJob,
  runPerformanceSummaryJob,
  runMetricsJob,
  runCalendarPrepJob,
  runCalendarReminderScan,      // NEW
  runCalendarDebriefDigest,     // NEW
}                                        from './coreJobs.js';

import { enqueueDedupScanForAllWorkspaces } from '../services/prospectDedup.js'; // NEW

// ──────────────────────────────────────────
// JOB HANDLER MAP
// ──────────────────────────────────────────
const HANDLERS = {
  // High frequency
  memory_extraction:      runMemoryExtractionJob,
  opportunity_fetch:      runOpportunityJob,
  feedback_prompts:       runFeedbackPromptJob,
  calendar_reminder_scan: runCalendarReminderScan,      // NEW

  // Daily
  performance_summary:    runPerformanceSummaryJob,
  metrics_aggregation:    runMetricsJob,
  daily_tip_generation:   runDailyTipGeneration,
  calendar_prep:          runCalendarPrepJob,
  calendar_debrief_digest: runCalendarDebriefDigest,    // NEW
  morning_growth_push:    runMorningGrowthPush,
  goal_nudge:             runGoalNudgeJob,
  follow_up_check:        runFollowupSequenceJob,
  check_in_scheduler:     runCheckInScheduler,
  evening_growth_push:    runEveningGrowthPush,

  // Sunday pipeline
  weekly_plan:            runWeeklyPlanGeneration,
  email_digest:           runEmailDigestJob,
  pattern_detection:      runPatternDetectionJob,
  // ⚠️  pattern_insights intentionally NOT registered here — per the
  //     pre-existing comment, it is (reportedly) enqueued by
  //     patternDetectionJob on completion. VERIFY this is actually true
  //     in the live system before changing it either way; registering it
  //     both ways would double-execute pattern insight generation, which
  //     is the exact class of bug this implementation pass was written to
  //     eliminate elsewhere. See IMPLEMENTATION_SUMMARY.md.
  skill_progression:      runSkillProgressionJob,
  skill_profile_agg:      runSkillProfileAggregationJob,
  adaptive_curriculum:    runAdaptiveCurriculumJob,

  // Weekly (NEW)
  prospect_dedup_scan:    enqueueDedupScanForAllWorkspaces,
};

// ──────────────────────────────────────────
// WORKER
// ──────────────────────────────────────────
export const startScheduledWorker = () => {
  const worker = new Worker(
    'scheduled-jobs',
    async (job) => {
      const handler = HANDLERS[job.name];

      if (!handler) {
        throw new Error(`[ScheduledWorker] No handler registered for job: "${job.name}"`);
      }

      console.log(`[ScheduledWorker] ▶ Starting: ${job.name}`);
      const start = Date.now();

      await handler();

      console.log(`[ScheduledWorker] ✓ Finished: ${job.name} (${Date.now() - start}ms)`);
    },
    {
      connection:   bullmqConnection,
      concurrency:  1,
      lockDuration: 10 * 60_000,
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`[ScheduledWorker] ✗ Failed: ${job?.name} — ${err.message}`);
    // IMPL-SENTRY-01: external visibility for job failures, see file header.
    try {
      Sentry.captureException(err, { tags: { source: 'scheduledWorker', jobName: job?.name, jobId: job?.id } });
    } catch { /* Sentry itself must never be able to break a job */ }
  });

  worker.on('error', (err) => {
    console.error('[ScheduledWorker] Worker error:', err.message);
  });

  const shutdown = async (signal) => {
    console.log(`[ScheduledWorker] ${signal} received — draining...`);
    await worker.close();
    console.log('[ScheduledWorker] Drained.');
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  console.log('[ScheduledWorker] Started — listening for scheduled jobs');
  return worker;
};
