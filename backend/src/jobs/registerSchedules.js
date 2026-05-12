// src/jobs/registerSchedules.js
// ============================================================
// SCHEDULE REGISTRATION — Idempotent, runs once on startup.
//
// FIX MED-08: Added transaction-like behavior with verification
// and rollback on partial failure.
// ============================================================

import { scheduledQueue } from './queues.js';

const SCHEDULES = [
  // ── HIGH FREQUENCY ─────────────────────────────────────────
  { name: 'memory_extraction',    cron: '*/30 * * * *'  },  // every 30 min
  { name: 'opportunity_fetch',    cron: '0 */6 * * *'   },  // every 6 hours
  { name: 'feedback_prompts',     cron: '0 * * * *'     },  // every hour

  // ── DAILY ──────────────────────────────────────────────────
  { name: 'performance_summary',  cron: '0 2 * * *'     },  // 2am
  { name: 'metrics_aggregation',  cron: '0 3 * * *'     },  // 3am
  { name: 'daily_tip_generation', cron: '0 7 * * *'     },  // 7am
  { name: 'calendar_prep',        cron: '0 8 * * *'     },  // 8am
  { name: 'morning_growth_push',  cron: '0 9 * * *'     },  // 9am
  { name: 'goal_nudge',           cron: '5 9 * * *'     },  // 9:05am
  { name: 'follow_up_check',      cron: '0 10 * * *'    },  // 10am
  { name: 'check_in_scheduler',   cron: '0 14 * * *'    },  // 2pm
  { name: 'evening_growth_push',  cron: '0 18 * * *'    },  // 6pm

  // ── SUNDAY PIPELINE ────────────────────────────────────────
  { name: 'weekly_plan',          cron: '0 18 * * 0'    },  // 6pm Sunday
  { name: 'email_digest',         cron: '0 18 * * 0'    },  // 6pm Sunday
  { name: 'pattern_detection',    cron: '0 20 * * 0'    },  // 8pm Sunday
  { name: 'skill_progression',    cron: '0 21 * * 0'    },  // 9pm Sunday
  { name: 'skill_profile_agg',    cron: '0 22 * * 0'    },  // 10pm Sunday
  { name: 'adaptive_curriculum',  cron: '0 23 * * 0'    },  // 11pm Sunday
];

export const registerSchedules = async () => {
  console.log('[Jobs] Registering BullMQ schedules...');

  // FIX MED-08: Store existing jobs before wiping
  const existing = await scheduledQueue.getRepeatableJobs();
  const existingKeys = existing.map(j => j.key);
  
  // Wipe existing repeatable jobs
  await Promise.all(existingKeys.map(key => scheduledQueue.removeRepeatableByKey(key)));

  // FIX MED-08: Register with verification and partial rollback
  const registered = [];
  const failed = [];

  for (const { name, cron } of SCHEDULES) {
    try {
      await scheduledQueue.add(name, {}, {
        repeat:          { pattern: cron },
        removeOnComplete: { count: 100 },
        removeOnFail:     { count: 200 },
      });
      registered.push(name);
      console.log(`[Jobs] ✓ Registered: ${name} (${cron})`);
    } catch (err) {
      console.error(`[Jobs] ✗ Failed to register: ${name}`, err.message);
      failed.push({ name, cron, error: err.message });
    }
  }

  // FIX MED-08: If any failed, log and attempt to restore wiped jobs
  if (failed.length > 0) {
    console.error(`[Jobs] ⚠️ ${failed.length} schedules failed to register. Attempting to restore...`);
    
    // Restore original jobs that were wiped
    for (const key of existingKeys) {
      const originalJob = existing.find(j => j.key === key);
      if (originalJob) {
        await scheduledQueue.add(originalJob.name, {}, {
          repeat: { pattern: originalJob.pattern },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 200 },
        }).catch(e => console.error(`[Jobs] Failed to restore ${originalJob.name}:`, e.message));
      }
    }
    
    throw new Error(`Schedule registration partial failure: ${failed.length} of ${SCHEDULES.length} failed`);
  }

  // FIX MED-08: Verify registration count
  const afterRegistration = await scheduledQueue.getRepeatableJobs();
  if (afterRegistration.length !== SCHEDULES.length) {
    console.warn(`[Jobs] ⚠️ Expected ${SCHEDULES.length} schedules, found ${afterRegistration.length}`);
  } else {
    console.log(`[Jobs] ✓ ${SCHEDULES.length} schedules registered and verified in Redis`);
  }
};