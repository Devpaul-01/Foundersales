// src/app.js — v4.3
// Issue 16: aiRateLimiter added to /api/practice
// Bug G:    coachRoutes was imported but never mounted — now at /api/coach
// Issue 8:  clearProfileCache is async; call sites use fire-and-forget .catch(()=>{})
//
// IMPL-SENTRY-01 (Phase 2 refactor / L4): Sentry is now initialized as the
// very first meaningful statement (right after dotenv/validateEnv), and
// its error-capturing middleware is registered after every route but
// before errorHandler.js's own error handling — see config/sentry.js for
// the full reasoning and for why this is fully optional at runtime
// (no-ops entirely if SENTRY_DSN is unset).
//
// PHASE 3 (Redis Store & Rate Limiting Consistency refactor, this
// revision): every rate limiter previously defined inline in this file
// (authRateLimiter, aiRateLimiter, pipelineRateLimiter,
// analyticsRateLimiter) is now defined once in config/limiters.js and
// imported here as LIMITERS.*. Two real bugs this fixes:
//   1. All four limiters below called `createRateLimitStore()` with NO
//      namespace argument, which silently defaulted to the 'default'
//      namespace — meaning all four shared one Redis key prefix AND (for
//      the three keyed on `req.user?.id || req.ip`) could merge counters
//      across logically-unrelated routers. See config/rateLimitStore.js
//      and config/limiters.js header comments for the full explanation.
//   2. A single aiRateLimiter (30/min/user) was applied uniformly across
//      seven routers (onboarding, opportunities, goals, growth, calendar,
//      chat, practice) with wildly different per-request cost profiles.
//      Each AI-calling router now gets its own right-sized limiter — see
//      config/limiters.js for the reasoning behind each one's specific
//      numbers. sharedStore (the old single Redis-backed store variable)
//      is gone; each limiter now owns its own namespaced store internally.
import 'dotenv/config';
import { validateEnv }                from './config/validateEnv.js';
validateEnv();
import { initSentry, setupSentryErrorHandler } from './config/sentry.js';
initSentry();
import { LIMITERS } from './config/limiters.js';
import cookieParser from 'cookie-parser';

// Add this before your routes

import express       from 'express';
import cors          from 'cors';
import helmet        from 'helmet';
import morgan        from 'morgan';
import { initFirebase }            from './config/firebase.js';
import authenticate, { clearProfileCache } from './middleware/auth.js';
import { resolveWorkspace }        from './middleware/workspace.js';
import { errorHandler }            from './middleware/errorHandler.js';
import { traceId }                 from './middleware/traceId.js';
import authRoutes                  from './routes/auth.js';
import userRoutes, { updateProfile, deleteAccount } from './routes/user.js';
import workspaceRoutes, { createWorkspaceHandler } from './routes/workspaces.js';
import onboardingRoutes            from './routes/onboarding.js';
import opportunitiesRoutes         from './routes/opportunities.js';
import feedbackRoutes              from './routes/feedback.js';
import practiceRoutes              from './routes/practice.js';
import metricsRoutes               from './routes/metrics.js';
import pipelineRoutes              from './routes/pipeline.js';
import chatRoutes                  from './routes/chat.js';
import calendarRoutes              from './routes/calendar.js';
import uploadRoutes                from './routes/upload.js';
import suggestionsRoutes           from './routes/suggestions.js';
import goalsRoutes                 from './routes/goals.js';
import followupRoutes              from './routes/followup.js';
import prospectsRoutes             from './routes/prospects.js';
import commitmentsRoutes           from './routes/commitments.js';
import insightsRoutes              from './routes/insights.js';
import growthRoutes                from './routes/growth.js';
import workspaceActivityRoutes     from './routes/workspace-activity.js';
import { startAllJobs, serverAdapter } from './jobs/index.js';
import supabaseAdmin from './config/supabase.js';

const app  = express();
const PORT = 3001;

app.use(cookieParser());
app.use(helmet({ crossOriginEmbedderPolicy: false }));
app.use(cors({
  origin: (origin, callback) => {
    // IMPL-FRONTEND-URL-01 (Phase 2 refactor): this previously read
    // process.env.FRONTEND_URL_2 — a variable used nowhere else in the
    // codebase (auth.js, email.js, and emailDigestJob.js all already read
    // the singular, unsuffixed FRONTEND_URL for the same purpose). Unless
    // FRONTEND_URL_2 happened to be manually set to the same value as
    // FRONTEND_URL in every deployed environment, the real deployed
    // frontend origin was very likely never actually present in this
    // allowlist, since only the hardcoded localhost entries below would
    // have masked the problem during local development. Renamed to match
    // every other reference in the codebase.
    const allowed = [
      'http://localhost:5173',
      process.env.FRONTEND_URL || null,
      'http://localhost:5173',
      'http://localhost:3000',
    ].filter(Boolean);
    if (!origin || allowed.includes(origin)) callback(null, true);
    else callback(new Error(`CORS: Origin ${origin} not allowed`));
  },
  credentials: true,
}));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '2mb' }));
app.set('trust proxy', 1);
app.use(traceId);

// Bull Board — protected by ADMIN_SECRET header (authentication gate).
// PHASE 3: adminLimiter added as defense-in-depth against
// secret-guessing/replay traffic against an admin-only surface — this is
// on top of, not instead of, the ADMIN_SECRET check, which remains the
// real access control here.
app.use('/admin/jobs',
  LIMITERS.adminLimiter,
  (req, res, next) => {
    if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET) {
      return res.status(401).json({ error: 'UNAUTHORIZED' });
    }
    next();
  },
  serverAdapter.getRouter()
);

app.get('/health', (req, res) => res.json({
  status:    'ok',
  version:   '4.3.0',
  timestamp: new Date().toISOString(),
}));

// PHASE 3: LIMITERS.authLimiter (was authRateLimiter, defined inline here
// with a namespace-less, and therefore 'default'-namespaced, store).
app.use('/api/auth', LIMITERS.authLimiter, authRoutes);

// Issue 8: clearProfileCache is now async — fire-and-forget from the synchronous
// 'finish' event callback so we don't need to await in an event handler.
app.put('/api/auth/me', authenticate, resolveWorkspace, (req, res, next) => {
  res.on('finish', () => { if (res.statusCode < 400) clearProfileCache(req.user?.id).catch(() => {}); });
  next();
}, updateProfile);
app.delete('/api/auth/account', authenticate, (req, res, next) => {
  res.on('finish', () => { if (res.statusCode < 400) clearProfileCache(req.user?.id).catch(() => {}); });
  next();
}, deleteAccount);

app.use('/api/user', authenticate, userRoutes);

app.post('/api/workspaces', authenticate, createWorkspaceHandler);
app.use('/api/workspaces', authenticate, resolveWorkspace, workspaceRoutes);

const ws = [authenticate, resolveWorkspace];

// PHASE 3: each AI-calling router now gets its own right-sized limiter
// instead of one shared aiRateLimiter — see config/limiters.js for the
// per-router cost reasoning behind each specific number.
app.use('/api/onboarding',  ...ws, LIMITERS.onboardingLimiter, onboardingRoutes);
app.use('/api/suggestions', ...ws, LIMITERS.suggestionsLimiter, suggestionsRoutes);
app.use('/api/feedback',    ...ws, feedbackRoutes);
// Upload's rate limiter is applied INSIDE upload.js, scoped to POST /
// only (the actual expensive operation) rather than here at the
// router-mount level — GET / (list files) and DELETE /:id are cheap
// DB-only operations that shouldn't share a budget with file uploads.
// See upload.js for the limiter usage, following the same file-local
// convention already used by calendar.js/opportunities.js/auth.js's own
// dedicated limiters.
app.use('/api/upload',      ...ws, uploadRoutes);

app.use('/api/opportunities', ...ws, opportunitiesRoutes);
app.use('/api/goals',         ...ws, LIMITERS.goalsLimiter, goalsRoutes);
app.use('/api/growth',        ...ws, LIMITERS.growthLimiter, growthRoutes);
app.use('/api/calendar',      ...ws, LIMITERS.calendarLimiter, calendarRoutes);
app.use('/api/chat',          ...ws, LIMITERS.chatLimiter, chatRoutes);

// Issue 16: POST /:sessionId/message calls Groq PRO_MODEL synchronously
// on every request; practiceLimiter throttles this specifically.
app.use('/api/practice',    ...ws, LIMITERS.practiceLimiter, practiceRoutes);

app.use('/api/pipeline',    ...ws, LIMITERS.pipelineLimiter, pipelineRoutes);
app.use('/api/followup',    ...ws, followupRoutes);
app.use('/api/prospects',   ...ws, prospectsRoutes);
app.use('/api/commitments', ...ws, LIMITERS.commitmentsLimiter, commitmentsRoutes);
// insights.js has six distinct callWithFallbackGroq call sites but nearly
// all are cache-shielded (4h-24h TTLs) — insightsLimiter is sized for
// that cache-hit-majority profile. See config/limiters.js.
app.use('/api/insights',    ...ws, LIMITERS.insightsLimiter, insightsRoutes);
// metrics.js is not AI-cost-driven (no LLM calls anywhere in the file)
// but has 20+ endpoints including several heavy manager+/owner+
// workspace-wide multi-query aggregations (leaderboard, team-overview,
// workspace/dashboard) — exactly the "expensive analytics" category this
// limiter exists for. See analyticsLimiter's definition in
// config/limiters.js.
app.use('/api/metrics',     ...ws, LIMITERS.analyticsLimiter, metricsRoutes);

// Bug G: coachRoutes was imported but never registered — mount point was missing entirely.


// Gap 3: Workspace activity feed
app.use('/api/workspace', ...ws, workspaceActivityRoutes);

app.post('/api/user/feature-event', authenticate, resolveWorkspace, async (req, res) => {
  try {
    const { feature, action, metadata = {} } = req.body;
    if (!feature || !action) return res.status(400).json({ error: 'feature and action required' });
    await supabaseAdmin.from('feature_usage_events').insert({
      user_id:      req.user.id,
      workspace_id: req.workspace?.id || null,
      feature:      String(feature).slice(0, 50),
      action:       String(action).slice(0, 50),
      metadata:     typeof metadata === 'object' ? metadata : {},
    });
    res.json({ success: true });
  } catch { res.json({ success: false }); }
});

app.use('*', (req, res) => res.status(404).json({
  error:   'NOT_FOUND',
  message: `${req.method} ${req.originalUrl} not found`,
}));

// IMPL-SENTRY-01: registered after every route above but before
// errorHandler.js's own error-handling middleware below, so Sentry
// captures first and then hands off to the existing custom error handler
// unchanged. No-op if SENTRY_DSN is unset — see config/sentry.js.
setupSentryErrorHandler(app);

app.use(errorHandler);

const startServer = async () => {
  initFirebase();

  // Start listening FIRST so a Redis/BullMQ outage never takes down the
  // whole API — only background jobs are affected, not incoming requests.
  app.listen(PORT, () => {
    console.log('\n🚀 Clutch AI Backend v4.3');
    console.log(`   Port: ${PORT} | Mode: ${process.env.NODE_ENV}`);
    console.log('   Bull Board: GET /admin/jobs (x-admin-secret required)\n');
  });

  // Jobs start after the server is already accepting traffic. If Redis is
  // unreachable (bad network, DNS failure, etc.) this logs and moves on
  // instead of blocking/crashing the whole process.
  startAllJobs().catch(err => {
    console.error('[Jobs] Failed to start background jobs (non-fatal):', err.message);
  });
};

startServer().catch(err => { console.error('Failed to start:', err); process.exit(1); });
export default app;
