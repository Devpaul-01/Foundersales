// src/workers/index.js
// ============================================================
// WORKER-ONLY PROCESS ENTRY POINT
//
// Runs the scheduler and all three BullMQ workers (scheduled-jobs,
// practice-jobs, background) with NO HTTP server. Use this alongside
// server.js in any deployment where background-job throughput should
// scale independently of API request capacity — see ARCHITECTURE.md §11.
//
// Deliberately does NOT import app.js or anything that constructs an
// Express app — this process's only job is consuming queues.
//
// validateEnv() runs first, same as the combined process and the API
// process, so a missing required var fails loudly at boot rather than
// surfacing as a confusing runtime error on the first job that touches
// the missing config.
//
// Run with: node src/workers/index.js
// or:       npm run worker   (if wired into package.json)
// ============================================================
import 'dotenv/config';
import { validateEnv } from '../config/validateEnv.js';
validateEnv();
import { initSentry } from '../config/sentry.js';
initSentry();

import { startAllJobs } from '../jobs/index.js';

console.log('\n⚙️  FounderSales Workers — workers/index.js (worker-only process)');
console.log(`   Mode: ${process.env.NODE_ENV || 'development'}`);
console.log('   No HTTP server in this process — API requests are handled by server.js separately.\n');

let shuttingDown = false;

const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[Workers] ${signal} received — draining in-flight jobs...`);

  // Each worker (scheduledWorker.js, practiceWorker.js) already registers
  // its own SIGTERM/SIGINT handler that calls worker.close() and lets
  // in-flight jobs finish. This top-level handler exists as a final,
  // bounded safety net so the process always actually exits even if one
  // of those per-worker handlers hangs — 10 seconds is generous relative
  // to typical job durations in this system (the longest single-job lock
  // duration configured anywhere is 10 minutes for the scheduled-jobs
  // queue, but that reflects worst-case AI-fanout runtime, not typical
  // shutdown drain time).
  const forceExitTimer = setTimeout(() => {
    console.warn('[Workers] Graceful shutdown exceeded 10s — forcing exit.');
    process.exit(1);
  }, 10_000);
  forceExitTimer.unref();

  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  console.error('[Workers] Uncaught exception (non-fatal to the process, but investigate):', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Workers] Unhandled rejection (non-fatal to the process, but investigate):', reason);
});

startAllJobs().catch(err => {
  console.error('[Workers] Failed to start background jobs — exiting:', err.message);
  // Unlike app.js's non-fatal startAllJobs().catch() (where the HTTP
  // server is already serving traffic and should keep doing so even if
  // jobs fail to start), this process has no other purpose — if job
  // startup fails here, there's nothing else for the process to do.
  process.exit(1);
});
