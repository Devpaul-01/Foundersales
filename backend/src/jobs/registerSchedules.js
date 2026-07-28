// src/jobs/registerSchedules.js
// ============================================================
// SCHEDULE REGISTRATION
//
// NEW SCHEDULES (this revision):
//  - calendar_reminder_scan (every 5 min)   — pre-meeting reminders
//  - calendar_debrief_digest (8am daily)    — combined debrief/commitment
//    push digest, same time slot as calendar_prep since both are
//    "start of day" summaries a founder should see together
//  - prospect_dedup_scan (3am Monday)       — weekly catch-up fuzzy scan
//
// NOT added: a second `pattern_insights` cron entry. The existing comment
// in scheduledWorker.js claims pattern_insights is chained off
// pattern_detection's completion rather than run on its own schedule —
// registering it BOTH ways would reintroduce exactly the kind of
// duplicate-execution bug this implementation pass exists to fix
// elsewhere. This needs to be verified against the live system (see
// IMPLEMENTATION_SUMMARY.md) before either approach is finalized.
// ============================================================

import { scheduledQueue } from './queues.js';

const SCHEDULES = [
  // ── HIGH FREQUENCY ─────────────────────────────────────────
  { name: 'memory_extraction',      cron: '*/30 * * * *'  },
  { name: 'opportunity_fetch',      cron: '0 */6 * * *'   },
  { name: 'feedback_prompts',       cron: '0 * * * *'     },
  { name: 'calendar_reminder_scan', cron: '*/5 * * * *'   }, // NEW

  // ── DAILY ──────────────────────────────────────────────────
  { name: 'performance_summary',    cron: '0 2 * * *'     },
  { name: 'metrics_aggregation',    cron: '0 3 * * *'     },
  { name: 'daily_tip_generation',   cron: '0 7 * * *'     },
  { name: 'calendar_prep',          cron: '0 8 * * *'     },
  { name: 'calendar_debrief_digest',cron: '0 8 * * *'     }, // NEW
  { name: 'morning_growth_push',    cron: '0 9 * * *'     },
  { name: 'goal_nudge',             cron: '5 9 * * *'     },
  { name: 'follow_up_check',        cron: '0 10 * * *'    },
  { name: 'check_in_scheduler',     cron: '0 14 * * *'    },
  { name: 'evening_growth_push',    cron: '0 18 * * *'    },

  // ── SUNDAY PIPELINE ────────────────────────────────────────
  { name: 'weekly_plan',            cron: '0 18 * * 0'    },
  { name: 'email_digest',           cron: '0 18 * * 0'    },
  { name: 'pattern_detection',      cron: '0 20 * * 0'    },
  { name: 'skill_progression',      cron: '0 21 * * 0'    },
  { name: 'skill_profile_agg',      cron: '0 22 * * 0'    },
  { name: 'adaptive_curriculum',    cron: '0 23 * * 0'    },

  // ── WEEKLY (NEW) ─────────────────────────────────────────────
  { name: 'prospect_dedup_scan',    cron: '0 3 * * 1'     }, // 3am Monday
];

export const registerSchedules = async () => {
  console.log('[Jobs] Registering BullMQ schedules...');

  const existing = await scheduledQueue.getRepeatableJobs();
  const existingKeys = existing.map(j => j.key);

  await Promise.all(existingKeys.map(key => scheduledQueue.removeRepeatableByKey(key)));

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

  if (failed.length > 0) {
    console.error(`[Jobs] ⚠️ ${failed.length} schedules failed to register. Attempting to restore...`);

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

  const afterRegistration = await scheduledQueue.getRepeatableJobs();
  if (afterRegistration.length !== SCHEDULES.length) {
    console.warn(`[Jobs] ⚠️ Expected ${SCHEDULES.length} schedules, found ${afterRegistration.length}`);
  } else {
    console.log(`[Jobs] ✓ ${SCHEDULES.length} schedules registered and verified in Redis`);
  }
};
