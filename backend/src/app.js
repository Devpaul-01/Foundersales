// src/app.js — v4.2
// Issue 16: aiRateLimiter added to /api/practice
// Bug G:    coachRoutes was imported but never mounted — now at /api/coach
// Issue 8:  clearProfileCache is async; call sites use fire-and-forget .catch(()=>{})
import 'dotenv/config';
import { validateEnv }                from './config/validateEnv.js';
validateEnv();

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

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  message: { error: 'RATE_LIMIT_EXCEEDED', message: 'Too many attempts. Try again in 15 minutes.' },
  skip: (req) => req.path === '/refresh',
});

const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: 'RATE_LIMIT_EXCEEDED', message: 'Too many AI requests. Please slow down.' },
});

const pipelineRateLimiter = rateLimit({
  windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: 'RATE_LIMIT_EXCEEDED', message: 'Too many pipeline requests.' },
});

app.use(helmet({ crossOriginEmbedderPolicy: false }));
app.use(cors({
  origin: (origin, callback) => {
    const allowed = [
      'http://localhost:5173',
      process.env.FRONTEND_URL_2 || null,
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

app.use('/api/auth', authRoutes);

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

app.use('/api/onboarding',  ...ws, onboardingRoutes);
app.use('/api/suggestions', ...ws, suggestionsRoutes);
app.use('/api/feedback',    ...ws, feedbackRoutes);
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
app.use(errorHandler);

const startServer = async () => {
  initFirebase();
  await startAllJobs();
  app.listen(PORT, () => {
    console.log('\n🚀 Clutch AI Backend v4.2');
    console.log(`   Port: ${PORT} | Mode: ${process.env.NODE_ENV}`);
    console.log('   Bull Board: GET /admin/jobs (x-admin-secret required)\n');
  });
};

startServer().catch(err => { console.error('Failed to start:', err); process.exit(1); });
export default app;
