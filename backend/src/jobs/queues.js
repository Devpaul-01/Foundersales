// src/jobs/queues.js — IMP-02: backgroundQueue added
import { Queue } from 'bullmq';
import { bullmqConnection } from '../config/bullmq.js';
const defaultOpts = { connection: bullmqConnection };
export const scheduledQueue = new Queue('scheduled-jobs', defaultOpts);
export const practiceQueue  = new Queue('practice-jobs',  defaultOpts);
// IMP-02: general-purpose durable background queue (replaces fire-and-forget IIFEs)
export const backgroundQueue = new Queue('background', {
  connection: bullmqConnection,
  defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
});
