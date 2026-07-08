// src/utils/jobHelpers.js
//
// Shared utilities used by every job file.
// Previously each job defined its own copy of sleep / logJob
// (sometimes aliased as sleep4, logJob4, etc.) — LOW-09 fix.

import supabaseAdmin from '../config/supabase.js';

/**
 * Pause execution for `ms` milliseconds.
 * @param {number} ms
 */
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Insert a row into job_logs.
 * Errors are silently swallowed so a logging failure never kills a job.
 *
 * @param {string} name   - job_name value (e.g. 'opportunity_fetch')
 * @param {string} status - 'started' | 'completed' | 'failed'
 * @param {object} data   - any extra columns to merge in (duration_ms, error_message, …)
 */
const JOB_LOGS_KNOWN_COLUMNS = ['users_processed', 'opportunities_found', 'error_message', 'duration_ms'];

export const logJob = async (name, status, data = {}) => {
  const row = { job_name: name, status };
  const extra = {};
  for (const [key, value] of Object.entries(data)) {
    if (JOB_LOGS_KNOWN_COLUMNS.includes(key)) row[key] = value;
    else extra[key] = value;
  }
  if (Object.keys(extra).length) row.metadata = extra;

  try {
    await supabaseAdmin.from('job_logs').insert(row);
  } catch (err) {
    // Still must never kill a job — but now at least visible in logs.
    console.warn(`[jobHelpers] logJob failed for "${name}" (${status}):`, err.message);
  }
};
