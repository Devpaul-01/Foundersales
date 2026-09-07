// src/server.js
// ============================================================
// API-ONLY PROCESS ENTRY POINT
//
// Runs the HTTP API without starting any of the three background
// workers (scheduled-jobs, practice-jobs, background). Use this
// alongside workers/index.js in any deployment where API request
// capacity should scale independently of background-job throughput —
// see ARCHITECTURE.md §11 for the reasoning.
//
// This intentionally does NOT call startAllJobs(). Everything else —
// middleware chain, route mounting, Bull Board (read-only monitoring,
// safe to expose from the API process even with no local workers
// running since it reads queue state from Redis, not from in-process
// workers) — mirrors app.js exactly, just without the background-job
// bootstrap at the bottom.
//
// Run with: node src/server.js
// ============================================================
import 'dotenv/config';
import { validateEnv } from './config/validateEnv.js';
validateEnv();
import { initSentry, setupSentryErrorHandler } from './config/sentry.js';
initSentry();
import { LIMITERS } from './config/limiters.js';
import cookieParser from 'cookie-parser';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { initFirebase } from './config/firebase.js';
import authenticate, { clearProfileCache } from './middleware/auth.js';
import { resolveWorkspace } from './middleware/workspace.js';
import { errorHandler } from './middleware/errorHandler.js';
import { traceId } from './middleware/traceId.js';
import authRoutes from './routes/auth.js';
import userRoutes, { updateProfile, deleteAccount } from './routes/user.js';
import workspaceRoutes, { createWorkspaceHandler } from './routes/workspaces.js';
import onboardingRoutes from './routes/onboarding.js';
import opportunitiesRoutes from './routes/opportunities.js';
import feedbackRoutes from './routes/feedback.js';
import practiceRoutes from './routes/practice.js';
import metricsRoutes from './routes/metrics.js';
import pipelineRoutes from './routes/pipeline.js';
import chatRoutes from './routes/chat.js';
import calendarRoutes from './routes/calendar.js';
import uploadRoutes from './routes/upload.js';
import suggestionsRoutes from './routes/suggestions.js';
import goalsRoutes from './routes/goals.js';
import followupRoutes from './routes/followup.js';
import prospectsRoutes from './routes/prospects.js';
import commitmentsRoutes from './routes/commitments.js';
import insightsRoutes from './routes/insights.js';
import growthRoutes from './routes/growth.js';
import workspaceActivityRoutes from './routes/workspace-activity.js';
// serverAdapter is monitoring-only (reads queue state from Redis) — safe
// to mount here even though this process never calls startAllJobs().
import { serverAdapter } from './jobs/index.js';
import supabaseAdmin from './config/supabase.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cookieParser());
app.use(helmet({ crossOriginEmbedderPolicy: false }));
app.use(cors({
  origin: (origin, callback) => {
    const allowed = [
      'http://localhost:5173',
      process.env.FRONTEND_URL || null,
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

// Bull Board — read-only queue monitoring. Protected by ADMIN_SECRET
// header plus a dedicated rate limiter (defense-in-depth against
// secret-guessing traffic; the header check is the real access control).
// Safe to mount in the API-only process: it reads job/queue state
// directly from Redis, it doesn't require a worker to be running
// locally to display anything.
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
  status: 'ok',
  process: 'api',
  version: '4.3.0',
  timestamp: new Date().toISOString(),
}));

app.use('/api/auth', LIMITERS.authLimiter, authRoutes);

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

app.use('/api/onboarding', ...ws, LIMITERS.onboardingLimiter, onboardingRoutes);
app.use('/api/suggestions', ...ws, LIMITERS.suggestionsLimiter, suggestionsRoutes);
app.use('/api/feedback', ...ws, feedbackRoutes);
app.use('/api/upload', ...ws, uploadRoutes);

app.use('/api/opportunities', ...ws, opportunitiesRoutes);
app.use('/api/goals', ...ws, LIMITERS.goalsLimiter, goalsRoutes);
app.use('/api/growth', ...ws, LIMITERS.growthLimiter, growthRoutes);
app.use('/api/calendar', ...ws, LIMITERS.calendarLimiter, calendarRoutes);
app.use('/api/chat', ...ws, LIMITERS.chatLimiter, chatRoutes);
app.use('/api/practice', ...ws, LIMITERS.practiceLimiter, practiceRoutes);
app.use('/api/pipeline', ...ws, LIMITERS.pipelineLimiter, pipelineRoutes);
app.use('/api/followup', ...ws, followupRoutes);
app.use('/api/prospects', ...ws, prospectsRoutes);
app.use('/api/commitments', ...ws, LIMITERS.commitmentsLimiter, commitmentsRoutes);
app.use('/api/insights', ...ws, LIMITERS.insightsLimiter, insightsRoutes);
app.use('/api/metrics', ...ws, LIMITERS.analyticsLimiter, metricsRoutes);

app.use('/api/workspace', ...ws, workspaceActivityRoutes);

app.post('/api/user/feature-event', authenticate, resolveWorkspace, async (req, res) => {
  try {
    const { feature, action, metadata = {} } = req.body;
    if (!feature || !action) return res.status(400).json({ error: 'feature and action required' });
    await supabaseAdmin.from('feature_usage_events').insert({
      user_id: req.user.id,
      workspace_id: req.workspace?.id || null,
      feature: String(feature).slice(0, 50),
      action: String(action).slice(0, 50),
      metadata: typeof metadata === 'object' ? metadata : {},
    });
    res.json({ success: true });
  } catch { res.json({ success: false }); }
});

app.use('*', (req, res) => res.status(404).json({
  error: 'NOT_FOUND',
  message: `${req.method} ${req.originalUrl} not found`,
}));

setupSentryErrorHandler(app);

app.use(errorHandler);

const startServer = async () => {
  initFirebase();

  app.listen(PORT, () => {
    console.log('\n🚀 FounderSales API — server.js (API-only process)');
    console.log(`   Port: ${PORT} | Mode: ${process.env.NODE_ENV || 'development'}`);
    console.log('   Bull Board: GET /admin/jobs (x-admin-secret required, read-only from this process)');
    console.log('   Background jobs are NOT running in this process —');
    console.log('   start them separately with: node src/workers/index.js\n');
  });
};

startServer().catch(err => { console.error('Failed to start:', err); process.exit(1); });
export default app;
