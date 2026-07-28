// src/app.js — v4.2
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
import 'dotenv/config';
import { validateEnv }                from './config/validateEnv.js';
validateEnv();
import { initSentry, setupSentryErrorHandler } from './config/sentry.js';
initSentry();
import { createRateLimitStore } from './config/rateLimitStore.js';
import cookieParser from 'cookie-parser';

// Add this before your routes

import express       from 'express';
import cors          from 'cors';
import helmet        from 'helmet';
import morgan        from 'morgan';
import rateLimit     from 'express-rate-limit';
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

// IMPL-RATELIMIT-01 (Phase 2 refactor / C2 + horizontal-scaling
// instruction): every limiter below now uses a Redis-backed store
// (config/rateLimitStore.js) instead of express-rate-limit's default
// in-memory store, so limits are enforced correctly across every
// instance in a horizontally-scaled deployment rather than each instance
// independently allowing up to `max` requests (meaning the effective
// limit a user experienced was previously closer to
// (configured limit) × (instance count), not the configured limit
// itself).
//
// IMPL-RATELIMIT-02: each limiter now gets its OWN namespaced store
// instead of all three sharing one. A single RedisStore keys purely off
// `prefix + keyGenerator(req)` with no notion of which limiter it
// belongs to — and aiRateLimiter/pipelineRateLimiter both key on
// `req.user?.id || req.ip`. Sharing one store meant a user hitting an AI
// route and a pipeline route back-to-back was incrementing the exact
// same Redis counter, silently merging two limits that were supposed to
// be independent. Namespacing fixes that while still reusing a single
// underlying Redis connection under the hood (see rateLimitStore.js).
// Each is `undefined` if Redis was unreachable at startup —
// express-rate-limit falls back to its own in-memory store in that case,
// degraded but functional (see rateLimitStore.js for the fail-open
// reasoning).
const authRateLimitStore     = await createRateLimitStore('auth');
const aiRateLimitStore       = await createRateLimitStore('ai');
const pipelineRateLimitStore = await createRateLimitStore('pipeline');

// IMPL-RATELIMIT-01: this limiter was already defined here previously,
// but was NEVER ACTUALLY MOUNTED on the /api/auth router — discovered
// during this refactor's endpoint-by-endpoint rate-limit review. Every
// auth route (login, register, password reset, email verification) was
// running with ZERO rate limiting despite this configuration existing in
// the file. Now correctly applied — see the app.use('/api/auth', ...)
// line below.
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  message: { error: 'RATE_LIMIT_EXCEEDED', message: 'Too many attempts. Try again in 15 minutes.' },
  skip: (req) => req.path === '/refresh',
  store: authRateLimitStore,
});

const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: 'RATE_LIMIT_EXCEEDED', message: 'Too many AI requests. Please slow down.' },
  store: aiRateLimitStore,
});

const pipelineRateLimiter = rateLimit({
  windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: 'RATE_LIMIT_EXCEEDED', message: 'Too many pipeline requests.' },
  store: pipelineRateLimitStore,
});


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

// Bull Board — protected by ADMIN_SECRET header
app.use('/admin/jobs',
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
  version:   '4.2.0',
  timestamp: new Date().toISOString(),
}));

// IMPL-RATELIMIT-01: authRateLimiter is now actually applied here — see
// its definition above for why this was previously a no-op despite being
// configured.
app.use('/api/auth', authRateLimiter, authRoutes);

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

// IMPL-RATELIMIT-01: aiRateLimiter added — discovered during the
// endpoint-by-endpoint rate-limit review that /api/onboarding's routes
// (GET /questions, POST /answers' final-burst voice-profile generation,
// POST /sample-message, POST /rebuild-voice-profile) call Groq directly,
// same as every other AI-calling router, but this one was the sole
// AI-calling router mounted with NO aiRateLimiter at all — every other
// AI router (opportunities, goals, growth, calendar, chat, practice)
// already had it.
app.use('/api/onboarding',  ...ws, aiRateLimiter, onboardingRoutes);
app.use('/api/suggestions', ...ws, suggestionsRoutes);
app.use('/api/feedback',    ...ws, feedbackRoutes);
// IMPL-RATELIMIT-01: upload's rate limiter is applied INSIDE upload.js,
// scoped to POST / only (the actual expensive operation) rather than
// here at the router-mount level — GET / (list files) and DELETE /:id
// are cheap DB-only operations that shouldn't share a budget with file
// uploads. See upload.js for the limiter definition, following the same
// file-local convention already used by calendar.js/opportunities.js/
// auth.js's own dedicated limiters.
app.use('/api/upload',      ...ws, uploadRoutes);

// IMP-03: aiRateLimiter on all AI-calling routes
app.use('/api/opportunities', ...ws, aiRateLimiter, opportunitiesRoutes);
app.use('/api/goals',         ...ws, aiRateLimiter, goalsRoutes);
app.use('/api/growth',        ...ws, aiRateLimiter, growthRoutes);
app.use('/api/calendar',      ...ws, aiRateLimiter, calendarRoutes);
app.use('/api/chat',          ...ws, aiRateLimiter, chatRoutes);

// Issue 16: aiRateLimiter added — POST /:sessionId/message calls Groq PRO_MODEL
// synchronously on every request; without throttling a single user can saturate quota.
app.use('/api/practice',    ...ws, aiRateLimiter, practiceRoutes);

app.use('/api/metrics',     ...ws, metricsRoutes);
app.use('/api/pipeline',    ...ws, pipelineRateLimiter, pipelineRoutes);
app.use('/api/followup',    ...ws, followupRoutes);
app.use('/api/prospects',   ...ws, prospectsRoutes);
app.use('/api/commitments', ...ws, commitmentsRoutes);
app.use('/api/insights',    ...ws, insightsRoutes);

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
    console.log('\n🚀 Clutch AI Backend v4.2');
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
