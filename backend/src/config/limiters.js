// src/config/limiters.js
// ============================================================
// CENTRALIZED RATE LIMITER REGISTRY
// ============================================================
// PHASE 3 refactor (Redis Store & Rate Limiting Consistency).
//
// WHY THIS FILE EXISTS
// ---------------------
// Before this refactor, individual route files each called
// `rateLimit({...})` inline, and several of them called
// `createRateLimitStore()` with NO namespace argument — which defaults to
// 'default' (see config/rateLimitStore.js). That meant authRateLimiter,
// aiRateLimiter, pipelineRateLimiter, analyticsRateLimiter (all four
// defined in app.js), the email-sending limiter (auth.js), the calendar
// AI limiter (calendar.js), the upload limiter (upload.js), and BOTH of
// opportunities.js's limiters were all sharing the exact same
// 'ratelimit:default:' Redis key prefix. Several of those also share the
// same keyGenerator shape (`req.user?.id || req.ip`), meaning a single
// user hitting two logically-unrelated endpoints (e.g. an onboarding
// question burst and a goals check-in) could decrement the SAME Redis
// counter — the "independent" limits were silently merged. This is the
// exact bug class IMPL-RATELIMIT-02's own header comment describes fixing
// for the per-namespace-store mechanism, but the mechanism only helps if
// every call site actually supplies a distinct namespace — several didn't.
//
// This file is the single place every limiter is now defined. Every
// limiter here is built via `buildLimiter()`, which forces the caller to
// supply an explicit, unique `namespace` — there is no default namespace
// available from this file, so a collision like the one above can't
// silently reoccur.
//
// WHY GRANULARITY CHANGED (not just the namespace bug)
// ------------------------------------------------------
// Previously, ONE aiRateLimiter (30 req/min/user) was shared across
// onboarding, opportunities, goals, growth, calendar, chat, and practice
// — seven routers with wildly different per-request cost:
//   - chat.js / practice.js: every single user message triggers a Groq
//     call, often streaming, sometimes with vision or web search
//     attached. This is the highest-frequency, highest-cost path in the
//     app and deserves the most headroom of the "chat-shaped" limiters,
//     but also the most protection against a runaway client retry loop.
//   - goals.js / commitments.js: one cheap, short-output Groq call per
//     user action (a note, a follow-up message) — nowhere near the same
//     cost profile as a chat turn, and gating it behind the same 30/min
//     ceiling as chat was needlessly restrictive for a light feature.
//   - growth.js: a handful of Groq calls per day per user (check-in
//     question generation, check-in response, weekly plan, archetype
//     detection) — inherently self-limiting by product design (once/day
//     check-in, once/week plan), so a per-minute ceiling barely matters,
//     but still worth a real number rather than borrowing chat's.
//   - onboarding.js: bursty (3-5 Groq calls) but ONLY during a single
//     onboarding flow per user, essentially once in the user's lifetime
//     (plus rare voice-profile rebuilds). Needs enough headroom to not
//     break a legitimate onboarding burst, without being wide open.
//   - opportunities.js / calendar.js: already had dedicated, tighter
//     limiters for their most expensive endpoints (refresh, intel,
//     debrief/prep/research) layered UNDER the general aiRateLimiter —
//     this pattern was correct and is preserved, just re-homed here.
//   - insights.js: multiple endpoints, but nearly every one is
//     cache-shielded (4h-24h TTLs) — the underlying AI call only runs on
//     a cache miss, so the router-level ceiling can be more generous
//     than a raw-per-request-cost estimate would suggest.
//   - metrics.js: ZERO AI calls anywhere in the file — it was previously
//     given no AI limiter at all (correctly) but also had NO limiter of
//     any kind despite containing several heavy workspace-wide
//     multi-query aggregations (leaderboard, team-overview, dashboard).
//     This already had its own analyticsRateLimiter — preserved here.
//
// NAMING CONVENTION
// ------------------
// Every limiter is named `<domain>Limiter` and lives in the LIMITERS
// object keyed by the same name, e.g. LIMITERS.chatLimiter. Each has a
// unique `namespace` matching its key, so the Redis-backed store and the
// in-code name are always trivially traceable to each other.
// ============================================================

import rateLimit from 'express-rate-limit';
import { createRateLimitStore } from './rateLimitStore.js';

const minutes = (n) => n * 60 * 1000;
const hours   = (n) => n * 60 * 60 * 1000;

// Standard key generators — reused so every limiter's keying strategy is
// visibly intentional rather than copy-pasted with subtle drift.
const byUserOrIp = (req) => req.user?.id || req.ip;
const byIp       = (req) => req.ip;

/**
 * Builds a single rate limiter backed by its own namespaced Redis store.
 * `namespace` is REQUIRED and must be unique across the whole app — this
 * is what config/rateLimitStore.js uses to partition the Redis keyspace
 * (prefix: `ratelimit:<namespace>:`). There is no default; every call
 * site must think about and name its own namespace.
 */
async function buildLimiter({ namespace, windowMs, max, message, keyGenerator = byUserOrIp, skip }) {
  if (!namespace || typeof namespace !== 'string') {
    throw new Error('buildLimiter: a unique string `namespace` is required (no default is provided on purpose).');
  }
  const store = await createRateLimitStore(namespace);
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    message: { error: 'RATE_LIMIT_EXCEEDED', message },
    store,
    ...(skip ? { skip } : {}),
  });
}

// ── AUTH ─────────────────────────────────────────────────────
// General auth-abuse guard (login/register/password-reset brute forcing).
// Keyed by IP since most of these endpoints are unauthenticated by
// definition. /refresh is skipped — a legitimately-active user's silent
// token refresh should never be throttled by the same budget that guards
// against credential-stuffing.
const authLimiter = buildLimiter({
  namespace: 'auth',
  windowMs: minutes(15),
  max: 10,
  message: 'Too many attempts. Try again in 15 minutes.',
  keyGenerator: byIp,
  skip: (req) => req.path === '/refresh',
});

// Tighter, purpose-specific limit for the two endpoints that send an
// email to a caller-supplied address on every request
// (/forgot-password, /resend-verification). The general authLimiter
// above would still allow emailing up to 10 different addresses per IP
// per 15 minutes — a distinct abuse vector whose cost lands on a third
// party (recipient inbox / email-provider reputation), not just this API.
const authEmailLimiter = buildLimiter({
  namespace: 'auth_email',
  windowMs: hours(1),
  max: 5,
  message: 'Too many requests. Please wait before trying again.',
  keyGenerator: byIp,
});

// ── CHAT ─────────────────────────────────────────────────────
// Every user message in chat.js triggers a Groq call (often streaming,
// sometimes with vision/web-search attached) — the single
// highest-frequency AI path in the app. Generous enough for real
// conversational use, still a real ceiling against a runaway client loop.
const chatLimiter = buildLimiter({
  namespace: 'chat',
  windowMs: minutes(1),
  max: 40,
  message: 'Too many chat messages. Please slow down.',
});

// ── PRACTICE ─────────────────────────────────────────────────
// Same shape as chat (one Groq call per user turn), kept as its own
// namespace/limiter rather than sharing chat's because practice sessions
// are a structurally separate product surface with their own usage
// pattern (bursty within a single roleplay session).
const practiceLimiter = buildLimiter({
  namespace: 'practice',
  windowMs: minutes(1),
  max: 30,
  message: 'Too many AI requests. Please slow down.',
});

// ── ONBOARDING ───────────────────────────────────────────────
// Bursty (3-5 Groq calls: burst-question generation, voice profile
// build) but essentially once per user lifetime, plus rare rebuilds.
// Wide enough to never break a legitimate onboarding burst.
const onboardingLimiter = buildLimiter({
  namespace: 'onboarding',
  windowMs: minutes(1),
  max: 20,
  message: 'Too many onboarding requests. Please slow down.',
});

// ── GOALS ────────────────────────────────────────────────────
// Single cheap, short-output Groq call per user action (a goal note).
// Does not belong behind the same ceiling as chat/practice.
const goalsLimiter = buildLimiter({
  namespace: 'goals',
  windowMs: minutes(1),
  max: 20,
  message: 'Too many requests. Please slow down.',
});

// ── COMMITMENTS ──────────────────────────────────────────────
// Same shape as goals — one cheap Groq call (generate-message) per
// action, on an otherwise near-zero-AI router.
const commitmentsLimiter = buildLimiter({
  namespace: 'commitments',
  windowMs: minutes(1),
  max: 20,
  message: 'Too many requests. Please slow down.',
});

// ── GROWTH ───────────────────────────────────────────────────
// Handful of Groq calls per day per user (check-in questions/response,
// weekly plan, archetype detection) — self-limiting by product design
// (once/day check-in, once/week plan, 7-day archetype cooldown already
// enforced in-route). Generous relative to its natural call volume.
const growthLimiter = buildLimiter({
  namespace: 'growth',
  windowMs: minutes(1),
  max: 20,
  message: 'Too many requests. Please slow down.',
});

// ── SUGGESTIONS ──────────────────────────────────────────────
// One Groq call, 7-day cache per profile-hash — the AI call itself is
// already rare per user. Kept light.
const suggestionsLimiter = buildLimiter({
  namespace: 'suggestions',
  windowMs: minutes(1),
  max: 15,
  message: 'Too many requests. Please slow down.',
});

// ── INSIGHTS ─────────────────────────────────────────────────
// Multiple endpoints, but nearly all are cache-shielded (4h-24h TTLs) —
// the underlying AI call only runs on a cache miss. More generous than a
// raw per-request-cost estimate would suggest, since most requests never
// reach Groq at all.
const insightsLimiter = buildLimiter({
  namespace: 'insights',
  windowMs: minutes(1),
  max: 30,
  message: 'Too many insights requests. Please slow down.',
});

// ── CALENDAR (general AI mount) ──────────────────────────────
// Router-level floor for calendar's AI-adjacent endpoints not already
// covered by calendarAiLimiter below (kept for parity with the general
// pattern; calendar.js's own dedicated limiter is what actually gates
// the expensive per-event AI actions).
const calendarLimiter = buildLimiter({
  namespace: 'calendar',
  windowMs: minutes(1),
  max: 30,
  message: 'Too many requests. Please slow down.',
});

// Dedicated, tighter limit for calendar.js's actual expensive per-event
// AI actions (debrief, prep, prep/regenerate, research, follow-up,
// voice-memo retry, start-meeting-notes) — unchanged from the prior
// dedicated calendarAiRateLimiter, just re-homed to this registry with
// its own explicit namespace.
const calendarAiLimiter = buildLimiter({
  namespace: 'calendar_ai',
  windowMs: minutes(5),
  max: 10,
  message: 'Too many AI requests. Please wait a few minutes.',
});

// ── OPPORTUNITIES ────────────────────────────────────────────
// POST /refresh triggers a full Exa discovery + scoring pass — a
// deliberate, occasional, expensive action.
const opportunitiesRefreshLimiter = buildLimiter({
  namespace: 'opportunities_refresh',
  windowMs: hours(1),
  max: 5,
  message: 'You can refresh up to 5 times per hour.',
});

// GET /:id/intel triggers THREE external paid calls per request (one
// Exa/web search, two parallel Groq calls). Previously this shared a
// module-level `sharedRateLimitStore` variable with opportunitiesRefresh
// — same store, same 'default'-shaped risk if that variable were ever
// reused elsewhere. Now fully independent. Slightly more generous than
// refresh since /intel is triggered more incidentally (viewing a detail
// page) than a deliberate refresh action.
const opportunitiesIntelLimiter = buildLimiter({
  namespace: 'opportunities_intel',
  windowMs: hours(1),
  max: 10,
  message: 'Too many prospect-intel requests. Please wait a bit before trying again.',
});

// ── METRICS / ANALYTICS ──────────────────────────────────────
// Not AI-cost-driven (zero LLM calls in metrics.js) but contains several
// heavy manager+/owner+ workspace-wide multi-query aggregations
// (leaderboard, team-overview, workspace/dashboard). Deliberately more
// generous than the AI limiters (these are cheaper individually than an
// LLM call) but still a real bound, sized between the lighter per-action
// limiters and pipeline's higher-volume ceiling.
const analyticsLimiter = buildLimiter({
  namespace: 'analytics',
  windowMs: minutes(1),
  max: 60,
  message: 'Too many analytics requests. Please slow down.',
});

// ── PIPELINE ─────────────────────────────────────────────────
// Zero AI calls, mostly cheap single-row reads/writes (stage changes,
// deal value updates) but a high-frequency router during active pipeline
// management (kanban-style drag/drop UIs can fire many rapid requests).
const pipelineLimiter = buildLimiter({
  namespace: 'pipeline',
  windowMs: minutes(1),
  max: 120,
  message: 'Too many pipeline requests.',
});

// ── UPLOAD ───────────────────────────────────────────────────
// Real resource cost (multipart parsing, Supabase Storage write,
// bandwidth) independent of AI cost. Applied to POST / only — GET
// (list) and DELETE are cheap DB-only operations that share the general
// per-router traffic, not this budget.
const uploadLimiter = buildLimiter({
  namespace: 'upload',
  windowMs: minutes(15),
  max: 20,
  message: 'Too many uploads. Please wait a few minutes.',
});

// ── EXPORT ───────────────────────────────────────────────────
// chat.js's GET /:chatId/export was previously unprotected. It's a
// read-only DB query + string-building operation (no AI, no external
// call) so the cost is low per-request, but a full-history markdown
// export is still meaningfully heavier than an ordinary chat list fetch
// and is the kind of endpoint that's easy to hit in a scripted loop.
// Given its own light limiter rather than folded into chatLimiter, since
// export traffic has a completely different shape (rare, bursty-at-most-
// once-per-conversation) than live chat messages.
const exportLimiter = buildLimiter({
  namespace: 'export',
  windowMs: minutes(15),
  max: 20,
  message: 'Too many export requests. Please wait a few minutes.',
});

// ── ADMIN (Bull Board) ───────────────────────────────────────
// app.js's /admin/jobs mount is protected by a static ADMIN_SECRET
// header check, not a rate limiter — that's an authentication gate, not
// a throughput gate, and is intentionally left as-is. A rate limiter is
// added here anyway as defense-in-depth against secret-guessing/replay
// traffic hitting an admin-only surface, keyed by IP since this sits
// before any user-auth middleware.
const adminLimiter = buildLimiter({
  namespace: 'admin',
  windowMs: minutes(15),
  max: 30,
  message: 'Too many admin requests.',
  keyGenerator: byIp,
});

// ── PUBLIC / WEBHOOK GENERAL-PURPOSE ─────────────────────────
// No webhook-receiving endpoints exist in the reviewed files (no
// Stripe/provider webhook routes were present in the uploaded routers).
// This limiter is defined proactively so any future webhook route has an
// obvious, correct home instead of prompting another ad-hoc inline
// rateLimit({...}) — keyed by IP since webhook callers aren't
// authenticated the way normal users are, generous window since
// legitimate webhook providers can burst-retry.
const webhookLimiter = buildLimiter({
  namespace: 'webhook',
  windowMs: minutes(1),
  max: 100,
  message: 'Too many webhook requests.',
  keyGenerator: byIp,
});

// All limiters are async (each awaits its own store construction). Export
// a single promise so app.js and route files can await once and destructure.
export const LIMITERS = await (async () => ({
  authLimiter:                 await authLimiter,
  authEmailLimiter:             await authEmailLimiter,
  chatLimiter:                  await chatLimiter,
  practiceLimiter:              await practiceLimiter,
  onboardingLimiter:            await onboardingLimiter,
  goalsLimiter:                 await goalsLimiter,
  commitmentsLimiter:           await commitmentsLimiter,
  growthLimiter:                await growthLimiter,
  suggestionsLimiter:           await suggestionsLimiter,
  insightsLimiter:              await insightsLimiter,
  calendarLimiter:              await calendarLimiter,
  calendarAiLimiter:            await calendarAiLimiter,
  opportunitiesRefreshLimiter:  await opportunitiesRefreshLimiter,
  opportunitiesIntelLimiter:    await opportunitiesIntelLimiter,
  analyticsLimiter:             await analyticsLimiter,
  pipelineLimiter:              await pipelineLimiter,
  uploadLimiter:                await uploadLimiter,
  exportLimiter:                await exportLimiter,
  adminLimiter:                 await adminLimiter,
  webhookLimiter:               await webhookLimiter,
}))();

export default LIMITERS;
