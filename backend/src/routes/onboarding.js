// src/routes/onboarding.js
// ============================================================
// FIXES APPLIED (refinement plan):
//  Bug H:     Removed `buildContextForAI` local function — it was a duplicate
//             of `buildUserContext(req)` from workspace.js (already imported).
//             Both 2 call sites in GET /questions now use buildUserContext(req).
//             Keeping the local helper was a silent maintenance trap: any changes
//             to buildUserContext would not have been reflected here.
//  Issue 4:   ConcurrencyGuard is the Redis-backed version (already correct in
//             this version — no require() or top-level await issue present).
//  Section 6: Zod schemas onboardingBasicSchema + onboardingAnswersSchema added
//             to POST /basic and POST /answers routes.
// ============================================================
import { Router }          from 'express';
import { z }               from 'zod';
import { asyncHandler }    from '../middleware/errorHandler.js';
import { validate }        from '../middleware/validate.js';
import { createLogger }    from '../utils/logger.js';
import groqService         from '../services/groq.js';
import supabaseAdmin       from '../config/supabase.js';
import { clearWorkspaceCache, buildUserContext } from '../middleware/workspace.js';
import { backgroundQueue } from '../jobs/queues.js';
import { BACKGROUND_JOB_TYPES } from '../config/constants.js';
import { incrementCounter, decrementCounter } from '../services/redis.js';

const router = Router();
const { log, logError, logDB, logAI, logJob } = createLogger('Onboarding');
const timer = () => { const s = Date.now(); return () => `${Date.now() - s}ms`; };

// ── ConcurrencyGuard (Redis-backed) ─────────────────────────
const MAX_CONCURRENT_GROQ = 15, STAGGER_MS_PER_SLOT = 150;
const REDIS_GROQ_KEY = 'groq_queue:running', REDIS_GROQ_TTL_S = 120;

class ConcurrencyGuard {
  #localRunning = 0; #pending = [];
  async run(label, fn) {
    const globalRunning = await incrementCounter(REDIS_GROQ_KEY, REDIS_GROQ_TTL_S);
    if (globalRunning > MAX_CONCURRENT_GROQ) {
      await decrementCounter(REDIS_GROQ_KEY);
      logJob('GroqQueue', { status: 'queued', label, globalRunning });
      await new Promise((resolve, reject) => this.#pending.push({ resolve, reject }));
      await incrementCounter(REDIS_GROQ_KEY, REDIS_GROQ_TTL_S);
    }
    this.#localRunning++;
    if (this.#localRunning > 1) {
      await new Promise(r => setTimeout(r, STAGGER_MS_PER_SLOT * Math.min(this.#localRunning - 1, 6)));
    }
    try { return await fn(); }
    finally {
      this.#localRunning--;
      await decrementCounter(REDIS_GROQ_KEY);
      const next = this.#pending.shift();
      if (next) next.resolve();
    }
  }
}
const groqQueue = new ConcurrencyGuard();

// ── Section 6: Zod schemas ───────────────────────────────────
const onboardingBasicSchema = z.object({
  name:                z.string().max(100).optional(),
  business_name:       z.string().max(200).optional(),
  product_description: z.string().max(2000).optional(),
  target_audience:     z.string().max(1000).optional(),
  role:                z.enum(['founder','sales','freelancer','marketer','developer','other']).optional(),
  industry:            z.enum(['saas','ecommerce','services','fintech','health','education','other']).optional(),
  experience_level:    z.string().max(50).optional(),
  business_stage:      z.string().max(50).optional(),
  preferred_platforms: z.array(z.string()).max(10).optional(),
  primary_goal:        z.string().max(200).optional(),
  country:             z.string().max(100).optional(),
  state:               z.string().max(100).optional(),
  websites:            z.any().optional(),
  website:             z.string().max(500).optional(),
  bio:                 z.string().max(2000).optional(),
});

const onboardingAnswersSchema = z.object({
  answers: z.record(z.string(), z.unknown()),
  burst:   z.number().int().min(1).max(5).optional(),
});

// ── Helpers ──────────────────────────────────────────────────
const buildFallbackVoiceProfile = (basicInfo = {}) => ({
  unique_value_prop:           basicInfo.product_description
    ? `${basicInfo.product_description.slice(0, 80)} — update your profile to personalise further`
    : 'Update your profile to complete personalisation',
  icp_trigger:                 'When the core pain is acute and they need a solution now',
  target_customer_description: basicInfo.target_audience || 'Your ideal customer',
  main_objection:              'Price or timing concerns',
  objection_reframe:           'Focus on specific ROI and proof points',
  best_proof_point:            'Complete your profile settings to add specific proof points',
  voice_style:                 'conversational, direct',
  outreach_persona:            'Genuine founder sharing something useful',
  avoid_phrases:               ['just checking in', 'hope this finds you well', 'revolutionary'],
});

// Bug H: buildContextForAI removed — it was a duplicate of buildUserContext(req)
// from workspace.js which is already imported above. The two call sites in
// GET /questions now call buildUserContext(req) directly.

const updateWorkspaceProfile = async (workspaceId, userId, updates) => {
  const { error } = await supabaseAdmin
    .from('workspace_profiles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId).eq('user_id', userId);
  if (error) throw error;
};




// GET /api/onboarding/questions
router.get('/questions', asyncHandler(async (req, res) => {
  const elapsed = timer();
  const userId = req.user.id, workspaceId = req.workspace.id;
  const formatQuestions = (burstResult, startIndex = 1) => {
  const questions = burstResult.questions || [];
  return questions.map((q, idx) => ({
    id: `q${startIndex + idx}`,
    question: q
  }));
};
  log('GET /questions', { userId, workspaceId });

  const { data: profile } = await supabaseAdmin
    .from('workspace_profiles')
    .select('business_name, product_description, target_audience, role, industry, experience_level, business_stage, preferred_platforms, onboarding_answers, onboarding_step')
    .eq('workspace_id', workspaceId).eq('user_id', userId).single();

  const currentProfile = profile || {};
  const currentStep    = currentProfile.onboarding_step || 0;
  const currentAnswers = currentProfile.onboarding_answers || {};

  if (currentStep === 0) {
  const burst1 = await groqQueue.run('burst1', () =>
    groqService.generateBurst1Questions(buildUserContext(req))
  );
  return res.json({ 
    questions: formatQuestions(burst1, 1), 
    burst: 1, 
    step: 1 
  });
}

  // Bug H: was buildContextForAI(req) — replaced with buildUserContext(req)
  const burst = await groqQueue.run(`burst${currentStep + 1}`, () =>
  groqService.generateNextBurst(buildUserContext(req), currentAnswers, currentStep + 1)
);
  
  );
  log('GET /questions DONE', { userId, workspaceId, elapsed: elapsed() });
  res.json({ 
  questions: formatQuestions(burst, 1), 
  burst: currentStep + 1, 
  step: currentStep + 1 
});
});

// POST /api/onboarding/basic
// Section 6: onboardingBasicSchema validates known fields; unknown extra fields
// are stripped by Zod's default behaviour (non-strict mode), preventing accidental
// injection of unintended DB columns.
router.post('/basic', validate(onboardingBasicSchema), asyncHandler(async (req, res) => {
  const elapsed = timer();
  const userId = req.user.id, workspaceId = req.workspace.id;
  log('POST /basic', { userId, workspaceId });

  const { name } = req.body;
  if (name?.trim()) {
    await supabaseAdmin.from('users').update({ name: name.trim() }).eq('id', userId);
  }

  const profileFields = [
    'business_name','product_description','target_audience','role','industry',
    'experience_level','business_stage','preferred_platforms','primary_goal',
    'country','state','websites','website','bio',
  ];
  const profileUpdates = {};
  for (const field of profileFields) {
    if (req.body[field] !== undefined) profileUpdates[field] = req.body[field];
  }

  if (Object.keys(profileUpdates).length) {
    logDB('UPDATE', 'workspace_profiles', { userId, workspaceId, fields: Object.keys(profileUpdates).join(',') });
    await updateWorkspaceProfile(workspaceId, userId, profileUpdates);
  }

  await clearWorkspaceCache(userId, workspaceId);
  log('POST /basic DONE', { userId, elapsed: elapsed() });
  res.json({ success: true });
}));

// POST /api/onboarding/answers
// Section 6: onboardingAnswersSchema ensures `answers` is a non-null object
// and `burst` (if present) is a valid integer in range.
router.post('/answers', validate(onboardingAnswersSchema), asyncHandler(async (req, res) => {
  const elapsed = timer();
  const userId = req.user.id, workspaceId = req.workspace.id;
  const { answers, burst } = req.body;
  log('POST /answers START', { userId, workspaceId, burst });

  const { data: currentProfileData } = await supabaseAdmin
    .from('workspace_profiles').select('*')
    .eq('workspace_id', workspaceId).eq('user_id', userId).single();

  const currentProfile = currentProfileData || {};
  const mergedAnswers  = { ...(currentProfile.onboarding_answers || {}), ...answers };
  const newStep        = Math.min(3, (currentProfile.onboarding_step || 0) + 1);

  if (newStep < 3) {
    await updateWorkspaceProfile(workspaceId, userId, { onboarding_answers: mergedAnswers, onboarding_step: newStep });
    log('POST /answers partial', { userId, burst, newStep, elapsed: elapsed() });
    return res.json({ success: true, step: newStep, complete: false });
  }

  // Final burst — build voice profile
  const userContext = { ...req.user, ...currentProfile, onboarding_answers: mergedAnswers, workspace_id: workspaceId };
  logAI('buildVoiceProfile', { userId, workspaceId });
  let voiceProfile;
  try {
    voiceProfile = await groqQueue.run('buildVoiceProfile', () =>
      groqService.buildVoiceProfile(userContext, mergedAnswers)
    );
    logAI('buildVoiceProfile DONE', { userId, elapsed: elapsed() });
  } catch (vpError) {
    logError('buildVoiceProfile', vpError, { userId });
    voiceProfile = buildFallbackVoiceProfile(currentProfile);
  }

  // RECONSIDER-03: workspace_profiles is PRIMARY — throw on failure
  logDB('UPDATE', 'workspace_profiles', { userId, workspaceId, step: 'completed' });
  await updateWorkspaceProfile(workspaceId, userId, {
    onboarding_answers:   mergedAnswers,
    voice_profile:        voiceProfile,
    onboarding_completed: true,
    onboarding_step:      3,
  });

  // RECONSIDER-03: users write is SECONDARY — non-fatal
  try {
    logDB('UPDATE', 'users', { userId, onboarding_completed: true });
    await supabaseAdmin.from('users')
      .update({ onboarding_completed: true, onboarding_step: 3 })
      .eq('id', userId);
  } catch (userWriteErr) {
    logError('POST /answers users.update (non-fatal)', userWriteErr, { userId });
  }

  await clearWorkspaceCache(userId, workspaceId);
  const freshContext = { ...userContext, ...currentProfile, ...mergedAnswers };
  const fullContext  = { ...req.user, ...currentProfile, voice_profile: voiceProfile, onboarding_answers: mergedAnswers };

  // IMP-02: durable background queue — retryable, observable in Bull Board
  await backgroundQueue.add(BACKGROUND_JOB_TYPES.SEED_MEMORY, {
    userId, context: freshContext, answers: mergedAnswers, voiceProfile, isRebuild: false,
  }).catch(err => logError('backgroundQueue seed_memory', err, { userId }));

  await backgroundQueue.add(BACKGROUND_JOB_TYPES.ARCHETYPE_DETECT, {
    userId, workspaceId, userContext: freshContext,
  }).catch(err => logError('backgroundQueue archetype_detect', err, { userId }));

  await backgroundQueue.add(BACKGROUND_JOB_TYPES.OPPORTUNITIES_REFRESH, {
    userId, workspaceId, userContext: fullContext,
  }).catch(err => logError('backgroundQueue opportunities_refresh', err, { userId }));

  log('POST /answers COMPLETE', { userId, workspaceId, elapsed: elapsed() });
  res.json({ success: true, voice_profile: voiceProfile });
}));

// POST /api/onboarding/abbreviated — for invited members
router.post('/abbreviated', asyncHandler(async (req, res) => {
  const userId = req.user.id, workspaceId = req.workspace.id;
  const { role, primary_goal } = req.body;
  log('POST /abbreviated', { userId, workspaceId });
  await updateWorkspaceProfile(workspaceId, userId, {
    role:                 role || 'member',
    primary_goal:         primary_goal || null,
    onboarding_completed: true,
    onboarding_step:      1,
  });
  try {
    await supabaseAdmin.from('users').update({ onboarding_completed: true }).eq('id', userId);
  } catch (e) {
    logError('abbreviated users.update (non-fatal)', e, { userId });
  }
  await clearWorkspaceCache(userId, workspaceId);
  res.json({ success: true });
}));

// POST /api/onboarding/sample-message
router.post('/sample-message', asyncHandler(async (req, res) => {
  const elapsed = timer();
  const userId = req.user.id, workspaceId = req.workspace.id;
  log('POST /sample-message START', { userId, workspaceId });

  const { data: profile } = await supabaseAdmin
    .from('workspace_profiles')
    .select('product_description, target_audience, voice_profile, business_name')
    .eq('workspace_id', workspaceId).eq('user_id', userId).single();

  if (!profile?.voice_profile || !profile?.product_description) {
    return res.status(400).json({ error: 'VOICE_PROFILE_MISSING', message: 'Complete onboarding questions first.' });
  }

  const { data: firstOpportunity } = await supabaseAdmin
    .from('opportunities')
    .select('target_context, platform, target_name')
    .eq('workspace_id', workspaceId).eq('user_id', userId)
    .in('status', ['pending', 'viewed'])
    .order('composite_score', { ascending: false }).limit(1).single();

  let sampleProspectContext = null;
  if (firstOpportunity?.target_context) {
    const platformName = firstOpportunity.platform
      ? firstOpportunity.platform.charAt(0).toUpperCase() + firstOpportunity.platform.slice(1)
      : 'Web';
    sampleProspectContext = `[${platformName}] ${firstOpportunity.target_context.slice(0, 400)}`;
  }

  logAI('generateSampleOutreachMessage', { userId, hasRealProspect: !!sampleProspectContext });
  const userContext   = { ...req.user, ...profile, workspace_id: workspaceId };
  const sampleMessage = await groqQueue.run('sampleMessage', () =>
    groqService.generateSampleOutreachMessage(userContext, sampleProspectContext)
  );
  logAI('generateSampleOutreachMessage DONE', { userId, elapsed: elapsed() });

  res.json({
    success:              true,
    sample_message:       sampleMessage,
    based_on_opportunity: !!sampleProspectContext,
    opportunity_context:  sampleProspectContext?.slice(0, 200) || null,
    message:              'This is what your outreach sounds like when Clutch knows your business.',
  });
}));

// GET /api/onboarding/status
router.get('/status', asyncHandler(async (req, res) => {
  const userId = req.user.id, workspaceId = req.workspace.id;
  log('GET /status', { userId, workspaceId });

  const { data: profile, error } = await supabaseAdmin
    .from('workspace_profiles')
    .select('onboarding_completed, onboarding_step, voice_profile, primary_goal, business_name')
    .eq('workspace_id', workspaceId).eq('user_id', userId).single();

  if (error) throw error;
  res.json({
    completed:        profile?.onboarding_completed || false,
    step:             profile?.onboarding_step      || 0,
    has_voice_profile: !!profile?.voice_profile,
    has_primary_goal:  !!profile?.primary_goal,
    name:             req.user.name,
    business_name:    profile?.business_name,
  });
}));

// PUT /api/onboarding/profile
router.put('/profile', asyncHandler(async (req, res) => {
  const userId = req.user.id, workspaceId = req.workspace.id;
  const { voice_profile } = req.body;
  if (!voice_profile || typeof voice_profile !== 'object') {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Invalid voice profile format' });
  }
  logDB('UPDATE', 'workspace_profiles', { userId, workspaceId, fields: 'voice_profile' });
  await updateWorkspaceProfile(workspaceId, userId, { voice_profile });
  await clearWorkspaceCache(userId, workspaceId);
  res.json({ success: true, message: 'Profile updated.' });
}));

// POST /api/onboarding/rebuild-voice-profile
router.post('/rebuild-voice-profile', asyncHandler(async (req, res) => {
  const elapsed = timer();
  const userId = req.user.id, workspaceId = req.workspace.id;
  log('POST /rebuild-voice-profile START', { userId, workspaceId });

  const { data: profile, error: selectError } = await supabaseAdmin
    .from('workspace_profiles')
    .select('business_name, product_description, target_audience, websites, website, bio, industry, role, experience_level, business_stage, preferred_platforms, country, state, primary_goal, onboarding_answers, voice_profile')
    .eq('workspace_id', workspaceId).eq('user_id', userId).single();

  if (selectError) throw selectError;
  if (!profile?.onboarding_answers || !profile?.product_description) {
    return res.status(400).json({ error: 'ONBOARDING_REQUIRED', message: 'Complete onboarding first' });
  }

  const userContext = { ...req.user, ...profile, workspace_id: workspaceId };
  logAI('buildVoiceProfile (rebuild)', { userId });
  let voiceProfile;
  try {
    voiceProfile = await groqQueue.run('rebuildVoiceProfile', () =>
      groqService.buildVoiceProfile(userContext, profile.onboarding_answers)
    );
    logAI('buildVoiceProfile (rebuild) DONE', { userId, elapsed: elapsed() });
  } catch (vpError) {
    logError('rebuild buildVoiceProfile', vpError, { userId });
    voiceProfile = buildFallbackVoiceProfile(profile);
  }

  logDB('UPDATE', 'workspace_profiles', { userId, workspaceId, fields: 'voice_profile' });
  await updateWorkspaceProfile(workspaceId, userId, { voice_profile: voiceProfile });
  await clearWorkspaceCache(userId, workspaceId);

  await backgroundQueue.add(BACKGROUND_JOB_TYPES.SEED_MEMORY, {
    userId, context: userContext, answers: profile.onboarding_answers, voiceProfile, isRebuild: true,
  }).catch(err => logError('backgroundQueue seed_memory (rebuild)', err, { userId }));

  log('POST /rebuild-voice-profile COMPLETE', { userId, elapsed: elapsed() });
  res.json({ success: true, voice_profile: voiceProfile });
}));

export default router;
