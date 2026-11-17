// src/jobs/dataRetentionJob.js
// ============================================================
// DATA RETENTION (full audit 1.71)
//
// job_logs and push_notification_log only ever grow. Before audit 1.54 / 1.59
// their inserts were silently failing, so nobody noticed; now that they work
// they would grow without bound. This daily job deletes old rows.
//
// 90 days is far more than either table is read for: the growth-push throttle
// looks at the last 24h of push_notification_log, and job_logs is an
// operational trail. Tune RETENTION_DAYS below if you want a different window.
//
// One table failing never stops the other, and the job never throws on a
// delete error (it reports it and finishes) so a transient DB problem does not
// cause BullMQ retries of a job that is safe to simply run again tomorrow.
// ============================================================

import supabaseAdmin from '../config/supabase.js';
import { logJob } from '../utils/jobHelpers.js';

export const RETENTION_DAYS = {
  job_logs:              { days: 90, column: 'created_at' },
  push_notification_log: { days: 90, column: 'sent_at' },
};

export const runDataRetentionJob = async () => {
  const started = Date.now();
  await logJob('data_retention', 'started');

  const deleted = {};
  const failures = [];

  for (const [table, { days, column }] of Object.entries(RETENTION_DAYS)) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    try {
      const { count, error } = await supabaseAdmin
        .from(table)
        .delete({ count: 'exact' })
        .lt(column, cutoff);
      if (error) throw new Error(error.message);
      deleted[table] = count ?? 0;
    } catch (err) {
      failures.push(`${table}: ${err.message}`);
      console.error(`[DataRetention] Failed to prune ${table}:`, err.message);
    }
  }

  console.log(`[DataRetention] Pruned: ${JSON.stringify(deleted)}${failures.length ? ` | failures: ${failures.join('; ')}` : ''}`);
  await logJob('data_retention', failures.length ? 'failed' : 'completed', {
    duration_ms: Date.now() - started,
    ...(failures.length ? { error_message: failures.join('; ') } : {}),
    metadata: { deleted },
  });
  return { deleted, failures };
};
