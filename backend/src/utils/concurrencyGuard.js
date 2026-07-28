// src/utils/concurrencyGuard.js
// ============================================================
// DISTRIBUTED CONCURRENCY GUARD — Phase 2 refactor (H5)
//
// Replaces onboarding.js's inline ConcurrencyGuard class, which used a
// Redis counter (correctly global) for the hard cap, but a purely
// LOCAL, per-process array of pending Promises for what happens when
// that cap is exceeded. That local pending queue could only ever be
// resolved by THIS SAME process's own later completions — meaning a
// process with zero in-flight local work, hitting a cap that's
// saturated by OTHER instances, would await a promise nothing would
// ever resolve. A second, independent issue: the Redis counter helper
// (incrementCounter) only refreshes its TTL on the 0→1 transition,
// which is correct for a windowed rate-limit counter but wrong for a
// live "how many things are running right now" gauge — under
// continuous traffic the counter might never return to zero, so its
// TTL could lapse while still conceptually "active."
//
// This implementation replaces both the counter and the local pending
// queue with a Redis SORTED SET "slot registry": each in-flight call is
// a member (a random token) with its acquisition timestamp as score.
// This is self-healing (a crashed holder's slot simply ages past a
// staleness cutoff and gets swept by the next acquire attempt, with no
// separate reaper job needed) and has no single shared TTL to race
// against.
//
// Generic and reusable — not onboarding-specific. Exported as a factory
// so any bursty AI-call path in this codebase can get the same
// smoothing/capping behavior by constructing its own guard with its own
// Redis key and limits, rather than each hand-rolling its own version of
// this pattern (which is exactly how onboarding.js ended up with a
// subtly-broken bespoke implementation in the first place).
//
// Fail-open by design: if Redis is unreachable, or the maximum wait is
// reached without acquiring a slot, the wrapped function still runs —
// this mechanism exists purely to smooth bursts as a courtesy to
// external providers' rate limits, not to enforce a hard business rule.
// A real user should never be blocked indefinitely, or see an error,
// because of an internal traffic-shaping mechanism.
// ============================================================

import {
  sortedSetAdd, sortedSetRemove, sortedSetRemoveRangeByScore, sortedSetCard,
} from '../services/redis.js';
import { reportDegradedMode } from './reportDegradation.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * @param {object} opts
 * @param {string} opts.redisKey        - sorted-set key, e.g. 'stagger:groq_queue:active'
 * @param {number} opts.maxConcurrent   - hard cap on simultaneous in-flight calls, cross-instance
 * @param {number} opts.staggerMsPerSlot - base stagger delay per concurrently-active slot
 * @param {number} opts.staggerCapSlots  - cap on how many slots' worth of stagger delay applies
 * @param {number} opts.staleMs         - how old a slot can be before it's considered abandoned (crashed holder) and swept
 * @param {number} opts.pollIntervalMs  - how often to recheck capacity while waiting
 * @param {number} opts.maxWaitMs       - maximum total time to wait for a slot before proceeding anyway (fail-open)
 * @returns {{ run: (label: string, fn: () => Promise<any>) => Promise<any> }}
 */
export const createConcurrencyGuard = ({
  redisKey,
  maxConcurrent,
  staggerMsPerSlot,
  staggerCapSlots,
  staleMs,
  pollIntervalMs,
  maxWaitMs,
}) => {
  const acquire = async (label) => {
    const startedWaitingAt = Date.now();

    while (true) {
      try {
        // Sweep stale (abandoned/crashed) slots before checking capacity —
        // this is what makes the registry self-healing with no separate
        // reaper job.
        await sortedSetRemoveRangeByScore(redisKey, '-inf', Date.now() - staleMs);

        const activeCount = await sortedSetCard(redisKey);

        if (activeCount < maxConcurrent) {
          const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
          await sortedSetAdd(redisKey, Date.now(), token);
          return { token, activeCountAtAcquire: activeCount };
        }
      } catch (err) {
        // Redis unreachable — fail open immediately rather than looping
        // on a broken dependency. This mechanism exists purely to smooth
        // bursts, never to block a real request.
        reportDegradedMode('concurrency-guard-redis-unavailable', { redisKey, label, error: err.message });
        return { token: null, activeCountAtAcquire: 0 };
      }

      if (Date.now() - startedWaitingAt >= maxWaitMs) {
        console.warn(`[ConcurrencyGuard] "${label}" waited ${maxWaitMs}ms for a slot on ${redisKey} — proceeding anyway (fail-open).`);
        return { token: null, activeCountAtAcquire: maxConcurrent };
      }

      await sleep(pollIntervalMs);
    }
  };

  const release = async (token) => {
    if (!token) return; // fail-open path never acquired a real slot
    try {
      await sortedSetRemove(redisKey, token);
    } catch (err) {
      // Non-fatal — the slot will still self-heal via the staleness
      // sweep on a future acquire attempt even if this explicit release
      // fails.
      console.warn(`[ConcurrencyGuard] release failed for ${redisKey} (non-fatal, will self-heal via staleness sweep):`, err.message);
    }
  };

  const run = async (label, fn) => {
    const { token, activeCountAtAcquire } = await acquire(label);

    const staggerDelay = staggerMsPerSlot * Math.min(activeCountAtAcquire, staggerCapSlots);
    if (staggerDelay > 0) await sleep(staggerDelay);

    try {
      return await fn();
    } finally {
      await release(token);
    }
  };

  return { run };
};

export default { createConcurrencyGuard };
