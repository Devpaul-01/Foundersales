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
//  FIX:       Added onboarding_questions JSONB column to persist generated questions
//             so users see the same questions when returning to a burst.
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
import { createConcurrencyGuard } from '../utils/concurrencyGuard.js';

const router = Router();
const { log, logError, logDB, logAI, logJob } = createLogger('Onboarding');
const timer = () => { const s = Date.now(); return () => `${Date.now() - s}ms`; };

// ── ConcurrencyGuard (Redis-backed) ─────────────────────────
// IMPL-H5-01 (Phase 2 refactor): replaced the previous inline
// ConcurrencyGuard class, which had two independent bugs only visible
// under real multi-instance load:
//   1. When the global Redis counter was over cap, this process pushed
//      itself into a LOCAL, per-process #pending array and awaited a
//      Promise that could only ever be resolved by this SAME process's
//      own later completions. A process with zero in-flight local work,
//      hitting a cap saturated by OTHER instances, could hang forever —
//      nothing local would ever exist to service its own pending queue.
//   2. incrementCounter's TTL-refresh-only-on-0→1-transition behavior
//      (correct for a windowed rate-limit counter, the helper's original
//      intended use) is the wrong fit for a live "how many things are
//      running right now" gauge — under continuous traffic the counter
//      might never return to zero, so its TTL could silently lapse while
//      the application still believed slots were held.
// Now uses the generic, Redis sorted-set-backed createConcurrencyGuard
// (utils/concurrencyGuard.js), which is self-healing (no reliance on a
// single shared TTL) and correctly coordinates across every instance.
// Same public run(label, fn) interface, same constants — every call site
// below is unchanged.
const groqQueue = createConcurrencyGuard({
  redisKey:         'stagger:groq_queue:active',
  maxConcurrent:    15,
  staggerMsPerSlot: 150,
  staggerCapSlots:  6,
  staleMs:          90_000, // comfortably above the longest onboarding AI call (buildVoiceProfile, ~2500 max tokens)
  pollIntervalMs:   250,
  maxWaitMs:        20_000, // fail-open beyond this — never block a real onboarding request indefinitely
});

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

const updateWorkspaceProfile = async (workspaceId, userId, updates) => {
  const { error } = await supabaseAdmin
    .from('workspace_profiles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId).eq('user_id', userId);
  if (error) throw error;
};

// Helper to format questions with IDs
const formatQuestions = (burstResult, startIndex = 1) => {
  const questions = burstResult.questions || [];
  return questions.map((q, idx) => ({
    id: `q${startIndex + idx}`,
    question: q
  }));
};

// Helper to save generated questions for a burst
const saveQuestionsForBurst = async (workspaceId, userId, burstNumber, questions) => {
  const { data: currentProfile } = await supabaseAdmin
    .from('workspace_profiles')
    .select('onboarding_questions')
    .eq('workspace_id', workspaceId).eq('user_id', userId)
    .single();
  
  const currentQuestions = currentProfile?.onboarding_questions || {};
  const updatedQuestions = {
    ...currentQuestions,
    [`burst_${burstNumber}`]: questions
  };
  
  await updateWorkspaceProfile(workspaceId, userId, { onboarding_questions: updatedQuestions });
  console.log(`[Onboarding] Saved questions for burst ${burstNumber}:`, JSON.stringify(questions, null, 2));
};

// Helper to get saved questions for a burst
const getSavedQuestionsForBurst = async (workspaceId, userId, burstNumber) => {
  const { data: profile } = await supabaseAdmin
    .from('workspace_profiles')
    .select('onboarding_questions')
    .eq('workspace_id', workspaceId).eq('user_id', userId)
    .single();
  
  const savedQuestions = profile?.onboarding_questions?.[`burst_${burstNumber}`];
  if (savedQuestions) {
    console.log(`[Onboarding] Retrieved saved questions for burst ${burstNumber}:`, JSON.stringify(savedQuestions, null, 2));
  }
  return savedQuestions || null;
};
// ============================================================
// VOICE PROFILE EDITING ENDPOINTS
// Add these to your existing onboarding.js
// ============================================================

// GET /api/onboarding/voice-profile
router.get('/voice-profile', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const workspaceId = req.workspace.id;

  const { data: profile, error } = await supabaseAdmin
    .from('workspace_profiles')
    .select('voice_profile, onboarding_completed')
    .eq('workspace_id', workspaceId).eq('user_id', userId)
    .single();

  if (error) throw error;

  if (!profile?.voice_profile) {
    return res.status(404).json({ 
      error: 'NOT_FOUND', 
      message: 'Complete onboarding first to generate a voice profile' 
    });
  }

  res.json({
    voice_profile: profile.voice_profile,
    onboarding_completed: profile.onboarding_completed
  });
}));

// PUT /api/onboarding/voice-profile
const voiceProfileEditSchema = z.object({
  unique_value_prop: z.string().max(200).optional(),
  icp_trigger: z.string().max(300).optional(),
  target_customer_description: z.string().max(500).optional(),
  main_objection: z.string().max(300).optional(),
  objection_reframe: z.string().max(300).optional(),
  best_proof_point: z.string().max(400).optional(),
  opening_hooks: z.array(z.string().max(150)).max(5).optional(),
  channel_tone_map: z.object({
    cold_email: z.string().max(60).optional(),
    linkedin: z.string().max(60).optional(),
    reddit: z.string().max(60).optional(),
    x_twitter: z.string().max(60).optional(),
  }).optional(),
  cta_style: z.string().max(100).optional(),
  voice_style: z.string().max(40).optional(),
  outreach_persona: z.string().max(100).optional(),
  avoid_phrases: z.array(z.string().max(50)).max(15).optional(),
  story_vault: z.array(z.object({
    title: z.string().max(100),
    quote: z.string().max(400),
    outcome: z.string().max(200),
    channel_use: z.array(z.string())
  })).max(5).optional(),
  follow_up_sequence: z.array(z.string().max(200)).max(5).optional(),
});

router.put('/voice-profile', validate(voiceProfileEditSchema), asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const workspaceId = req.workspace.id;
  const updates = req.body;

  // Get existing profile
  const { data: existing } = await supabaseAdmin
    .from('workspace_profiles')
    .select('voice_profile')
    .eq('workspace_id', workspaceId).eq('user_id', userId)
    .single();

  if (!existing?.voice_profile) {
    return res.status(404).json({ 
      error: 'NOT_FOUND', 
      message: 'No voice profile found. Complete onboarding first.' 
    });
  }

  // Deep merge
  const mergedProfile = {
    ...existing.voice_profile,
    ...updates,
    // Handle nested objects
    channel_tone_map: {
      ...(existing.voice_profile.channel_tone_map || {}),
      ...(updates.channel_tone_map || {})
    },
    // Handle arrays (replace, not merge)
    opening_hooks: updates.opening_hooks ?? existing.voice_profile.opening_hooks,
    avoid_phrases: updates.avoid_phrases ?? existing.voice_profile.avoid_phrases,
    story_vault: updates.story_vault ?? existing.voice_profile.story_vault,
    follow_up_sequence: updates.follow_up_sequence ?? existing.voice_profile.follow_up_sequence,
  };

  const { error } = await supabaseAdmin
    .from('workspace_profiles')
    .update({ 
      voice_profile: mergedProfile, 
      updated_at: new Date().toISOString() 
    })
    .eq('workspace_id', workspaceId).eq('user_id', userId);

  if (error) throw error;

  await clearWorkspaceCache(userId, workspaceId);

  res.json({ 
    success: true, 
    voice_profile: mergedProfile,
    message: 'Voice profile updated successfully'
  });
}));

// POST /api/onboarding/voice-profile/regenerate

// GET /api/onboarding/questions
router.get('/questions', asyncHandler(async (req, res) => {
  const elapsed = timer();
  const userId = req.user.id, workspaceId = req.workspace.id;
  
  console.log('\n========================================');
  console.log('[Onboarding] GET /questions called');
  console.log(`[Onboarding] userId: ${userId}, workspaceId: ${workspaceId}`);
  
  log('GET /questions', { userId, workspaceId });

  const { data: profile } = await supabaseAdmin
    .from('workspace_profiles')
    .select('business_name, product_description, target_audience, role, industry, experience_level, business_stage, preferred_platforms, onboarding_answers, onboarding_step, onboarding_questions')
    .eq('workspace_id', workspaceId).eq('user_id', userId).single();

  const currentProfile = profile || {};
  const currentStep    = currentProfile.onboarding_step || 0;
  const currentAnswers = currentProfile.onboarding_answers || {};
  const nextStep       = currentStep === 0 ? 1 : currentStep + 1;
  
  console.log(`[Onboarding] currentStep: ${currentStep}, nextStep: ${nextStep}`);

  // Check if questions for this step are already saved
  const savedQuestions = await getSavedQuestionsForBurst(workspaceId, userId, nextStep);
  
  if (savedQuestions && savedQuestions.length > 0) {
    console.log(`[Onboarding] Using saved questions for burst ${nextStep}`);
    console.log(`[Onboarding] Returning ${savedQuestions.length} questions`);
    return res.json({ 
      questions: savedQuestions, 
      burst: nextStep, 
      step: nextStep 
    });
  }

  console.log(`[Onboarding] No saved questions found for burst ${nextStep}, generating new ones...`);

  let burstResult;
  if (nextStep === 1) {
    console.log('[Onboarding] Generating burst 1 questions...');
    burstResult = await groqQueue.run('burst1', () =>
      groqService.generateBurst1Questions(buildUserContext(req))
    );
    console.log('[Onboarding] Burst 1 result:', JSON.stringify(burstResult, null, 2));
  } else {
    console.log(`[Onboarding] Generating burst ${nextStep} questions...`);
    burstResult = await groqQueue.run(`burst${nextStep}`, () =>
      groqService.generateNextBurst({
        burst_number: nextStep,
        previous_answers: currentAnswers,
        basic_info: buildUserContext(req)
      })
    );
    console.log(`[Onboarding] Burst ${nextStep} result:`, JSON.stringify(burstResult, null, 2));
  }

  const formattedQuestions = formatQuestions(burstResult, 1);
  console.log(`[Onboarding] Formatted questions:`, JSON.stringify(formattedQuestions, null, 2));
  
  // Save generated questions
  await saveQuestionsForBurst(workspaceId, userId, nextStep, formattedQuestions);
  console.log(`[Onboarding] Saved questions for burst ${nextStep}`);

  log('GET /questions DONE', { userId, workspaceId, elapsed: elapsed() });
  console.log('========================================\n');
  
  res.json({ 
    questions: formattedQuestions, 
    burst: nextStep, 
    step: nextStep 
  });
}));

// POST /api/onboarding/basic
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
router.post('/answers', validate(onboardingAnswersSchema), asyncHandler(async (req, res) => {
  const elapsed = timer();
  const userId = req.user.id, workspaceId = req.workspace.id;
  const { answers, burst } = req.body;
  
  console.log('\n========================================');
  console.log('[Onboarding] POST /answers called');
  console.log(`[Onboarding] userId: ${userId}, workspaceId: ${workspaceId}`);
  console.log(`[Onboarding] burst: ${burst}`);
  console.log(`[Onboarding] answers received:`, JSON.stringify(answers, null, 2));
  
  log('POST /answers START', { userId, workspaceId, burst });

  const { data: currentProfileData } = await supabaseAdmin
    .from('workspace_profiles').select('*')
    .eq('workspace_id', workspaceId).eq('user_id', userId).single();

  const currentProfile = currentProfileData || {};
  const mergedAnswers  = { ...(currentProfile.onboarding_answers || {}), ...answers };
  const newStep        = Math.min(3, (currentProfile.onboarding_step || 0) + 1);
  
  console.log(`[Onboarding] current onboarding_step: ${currentProfile.onboarding_step || 0}`);
  console.log(`[Onboarding] newStep: ${newStep}`);
  console.log(`[Onboarding] mergedAnswers:`, JSON.stringify(mergedAnswers, null, 2));

  if (newStep < 3) {
    console.log(`[Onboarding] Saving partial progress (step ${newStep})`);
    await updateWorkspaceProfile(workspaceId, userId, { onboarding_answers: mergedAnswers, onboarding_step: newStep });
    log('POST /answers partial', { userId, burst, newStep, elapsed: elapsed() });
    console.log('========================================\n');
    return res.json({ success: true, step: newStep, complete: false });
  }

  // Final burst — build voice profile
  console.log('[Onboarding] Final burst — building voice profile...');
  const userContext = { ...req.user, ...currentProfile, onboarding_answers: mergedAnswers, workspace_id: workspaceId };
  logAI('buildVoiceProfile', { userId, workspaceId });
  let voiceProfile;
  try {
    voiceProfile = await groqQueue.run('buildVoiceProfile', () =>
      groqService.buildVoiceProfile(userContext, mergedAnswers)
    );
    console.log('[Onboarding] voiceProfile generated:', JSON.stringify(voiceProfile, null, 2));
    logAI('buildVoiceProfile DONE', { userId, elapsed: elapsed() });
  } catch (vpError) {
    console.error('[Onboarding] buildVoiceProfile error:', vpError);
    logError('buildVoiceProfile', vpError, { userId });
    voiceProfile = buildFallbackVoiceProfile(currentProfile);
    console.log('[Onboarding] Using fallback voiceProfile');
  }

  console.log('[Onboarding] Updating workspace_profiles with completed onboarding...');
  await updateWorkspaceProfile(workspaceId, userId, {
    onboarding_answers:   mergedAnswers,
    voice_profile:        voiceProfile,
    onboarding_completed: true,
    onboarding_step:      3,
  });

  // Update users table (non-fatal)
  try {
    console.log('[Onboarding] Updating users table...');
    await supabaseAdmin.from('users')
      .update({ onboarding_completed: true, onboarding_step: 3 })
      .eq('id', userId);
  } catch (userWriteErr) {
    console.error('[Onboarding] users.update error (non-fatal):', userWriteErr);
    logError('POST /answers users.update (non-fatal)', userWriteErr, { userId });
  }

  await clearWorkspaceCache(userId, workspaceId);
  const freshContext = { ...userContext, ...currentProfile, ...mergedAnswers };
  const fullContext  = { ...req.user, ...currentProfile, voice_profile: voiceProfile, onboarding_answers: mergedAnswers };

  // Background jobs (fire and forget)
  console.log('[Onboarding] Queueing background jobs...');
  await backgroundQueue.add(BACKGROUND_JOB_TYPES.SEED_MEMORY, {
  userId,
  workspaceId,                 // ✅ ADD THIS
  context: freshContext,
  answers: mergedAnswers,
  voiceProfile,
  isRebuild: false,
}).catch(err => logError('backgroundQueue seed_memory', err, { userId }));
  

  await backgroundQueue.add(BACKGROUND_JOB_TYPES.ARCHETYPE_DETECT, {
    userId, workspaceId, userContext: freshContext,
  }).catch(err => logError('backgroundQueue archetype_detect', err, { userId }));

  await backgroundQueue.add(BACKGROUND_JOB_TYPES.OPPORTUNITIES_REFRESH, {
    userId, workspaceId, userContext: fullContext,
  }).catch(err => logError('backgroundQueue opportunities_refresh', err, { userId }));

  log('POST /answers COMPLETE', { userId, workspaceId, elapsed: elapsed() });
  console.log('========================================\n');
  
  res.json({ success: true, voice_profile: voiceProfile });
}));

// ── Zod schema for /abbreviated ─────────────────────────────
const onboardingAbbreviatedSchema = z.object({
  name:             z.string().max(100).optional(),
  role:             z.string().max(50).optional(),
  primary_goal:     z.string().max(200).optional(),
  experience_level: z.string().max(50).optional(),
  bio:              z.string().max(2000).optional(),
  websites:         z.array(z.string().max(500)).max(10).optional(),
});

// POST /api/onboarding/abbreviated
router.post('/abbreviated', validate(onboardingAbbreviatedSchema), asyncHandler(async (req, res) => {
  const userId = req.user.id, workspaceId = req.workspace.id;
  const { role, primary_goal, name, experience_level, bio, websites } = req.body;
  log('POST /abbreviated', { userId, workspaceId });

  // Build profile updates conditionally.
  // IMPORTANT: do NOT include role when it is absent from the request body.
  // Invited users already have their role (member / manager / admin) saved from
  // the invite row at the moment the invitation was created. Falling back to
  // 'member' here would silently strip any elevated role given by the admin.
  const profileUpdates = {
    primary_goal:         primary_goal || null,
    onboarding_completed: true,
    onboarding_step:      3,
  };
  
  if (experience_level) profileUpdates.experience_level = experience_level;
  if (bio?.trim())      profileUpdates.bio              = bio.trim();
  if (websites?.length) profileUpdates.websites         = websites;

  // Use upsert instead of a plain UPDATE so that if the profile row was never
  // created (e.g. accept-invite profile upsert failed silently), we create it
  // here rather than returning a false { success: true } with nothing saved.
  const { error: profileUpsertErr } = await supabaseAdmin
    .from('workspace_profiles')
    .upsert(
      { workspace_id: workspaceId, user_id: userId, ...profileUpdates, updated_at: new Date().toISOString() },
      { onConflict: 'workspace_id,user_id', ignoreDuplicates: false }
    );
  if (profileUpsertErr) throw profileUpsertErr;

  try {
    const userUpdates = { onboarding_completed: true, onboarding_step: 3 };
    // Save name if provided — invited users may not have set one yet.
    if (name?.trim()) userUpdates.name = name.trim();
    await supabaseAdmin.from('users').update(userUpdates).eq('id', userId);
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
// GET /api/onboarding/status
router.get('/status', asyncHandler(async (req, res) => {
  const userId = req.user.id, workspaceId = req.workspace.id;
  log('GET /status', { userId, workspaceId });

  // ✅ Disable all caching
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const { data: profile, error } = await supabaseAdmin
    .from('workspace_profiles')
    .select('onboarding_completed, onboarding_step, voice_profile, primary_goal, business_name')
    .eq('workspace_id', workspaceId).eq('user_id', userId).single();

  if (error) throw error;
  
  const currentStep = profile?.onboarding_step || 0;
  console.log(`[Onboarding] GET /status: step=${currentStep}, completed=${profile?.onboarding_completed}`);

  res.json({
    completed:        profile?.onboarding_completed || false,
    step:             currentStep,
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
  userId,
  workspaceId,                 // ✅ ADD THIS
  context: userContext,
  answers: profile.onboarding_answers,
  voiceProfile,
  isRebuild: true,
});

  

  log('POST /rebuild-voice-profile COMPLETE', { userId, elapsed: elapsed() });
  res.json({ success: true, voice_profile: voiceProfile });
}));

export default router;