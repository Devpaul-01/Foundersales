// src/routes/suggestions.js
// ============================================================
// SUGGESTIONS — WITH CACHING (7 DAY EXPIRY)
// ============================================================

import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { callWithFallback } from '../services/multiProvider.js';
import { createLogger } from '../utils/logger.js';
import { createHash } from 'crypto';
import supabaseAdmin from '../config/supabase.js';

const router = Router();
const { log, logError, logAI } = createLogger('Suggestions');

const DEFAULT_SUGGESTIONS = [
  'Help me write a better cold message',
  'Why am I getting ghosted?',
  'Review my outreach approach',
  'What should I say after no response?',
  'Help me handle a price objection',
];

// Generate a hash of all profile data to detect changes
function generateProfileHash(profileData, userData) {
  const hashString = JSON.stringify({
    product_description: profileData.product_description,
    target_audience: profileData.target_audience,
    business_name: profileData.business_name,
    industry: profileData.industry,
    primary_goal: profileData.primary_goal,
    archetype: profileData.archetype,
    experience_level: profileData.experience_level,
    preferred_platforms: profileData.preferred_platforms,
    business_stage: profileData.business_stage,
    role: profileData.role,
    voice_profile: profileData.voice_profile,
    tier: userData.tier,
    outreach_goals: userData.outreach_goals,
    onboarding_step: userData.onboarding_step,
  });
  
  return createHash('sha256').update(hashString).digest('hex');
}

// Build rich prompt with all user context
function buildSuggestionsPrompt(profile, user) {
  return `You are an AI sales coach assistant. Generate 5 personalized conversation starters for this sales professional.

BUSINESS CONTEXT:
- Business: ${profile.business_name || 'Not specified'}
- Product/Service: ${profile.product_description || 'Not specified'}
- Target Audience: ${profile.target_audience || 'Not specified'}
- Industry: ${profile.industry || 'Not specified'}
- Business Stage: ${profile.business_stage || 'Not specified'}

PERSONAL CONTEXT:
- Role: ${profile.role || 'Sales professional'}
- Experience Level: ${profile.experience_level || 'Intermediate'}
- Sales Archetype: ${profile.archetype || 'Adaptable'}
- Primary Goal: ${profile.primary_goal || 'Improve outreach effectiveness'}
- Preferred Platforms: ${profile.preferred_platforms?.join(', ') || 'Multiple platforms'}
- Voice Style: ${profile.voice_profile?.voice_style || 'Professional yet approachable'}

ACCOUNT CONTEXT:
- Plan: ${user.tier === 'pro' ? 'Pro - can use advanced tactics' : 'Free - focus on fundamentals'}
- Outreach Goals: ${user.outreach_goals?.join(', ') || 'Generate more conversations'}
- Onboarding Progress: Step ${user.onboarding_step || 0} of 4
- Engagement Streak: ${user.check_in_streak || 0} days active

REQUIREMENTS:
1. Suggest 5 short action phrases (under 8 words each)
2. Make them specific to their industry and role
3. ${user.tier === 'pro' ? 'Include advanced tactics like sequences or analytics' : 'Focus on foundational skills'}
4. ${user.check_in_streak > 3 ? 'Suggest deeper strategic questions' : 'Suggest getting-started tactics'}
5. Reference their actual business context when possible

Return ONLY a JSON array of 5 strings. No preamble, no markdown.
Example format: ["Help me write a cold DM for CEOs", "What's my best platform?", "How to handle price objections?"]`;
}

// GET /api/suggestions
router.get('/', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const workspaceId = req.workspace.id;
  const workspaceProfile = req.workspaceProfile;
  
  log('GET_SUGGESTIONS', { userId, workspaceId });
  
  // Get user data
  const { data: userData } = await supabaseAdmin
    .from('users')
    .select('tier, outreach_goals, check_in_streak, onboarding_step')
    .eq('id', userId)
    .single();
  
  // If no product description, return defaults immediately
  if (!workspaceProfile?.product_description) {
    log('NO_PRODUCT_DESC', { userId, workspaceId });
    return res.json({ suggestions: DEFAULT_SUGGESTIONS, cached: false });
  }
  
  // Generate hash of current data
  const currentHash = generateProfileHash(workspaceProfile, userData || {});
  const now = new Date().toISOString();
  
  // Check for valid cached suggestions
  const { data: cached, error: cacheError } = await supabaseAdmin
    .from('cached_suggestions')
    .select('suggestions, profile_hash, expires_at')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .single();
  
  // Use cache if valid (not expired AND hash matches)
  if (cached && !cacheError && cached.expires_at > now && cached.profile_hash === currentHash) {
    log('CACHE_HIT', { userId, workspaceId, expiresAt: cached.expires_at });
    return res.json({ 
      suggestions: cached.suggestions,
      cached: true,
      expires_at: cached.expires_at
    });
  }
  
  log('CACHE_MISS', { 
    userId, 
    workspaceId, 
    reason: !cached ? 'no_cache' : cached.expires_at <= now ? 'expired' : 'hash_mismatch' 
  });
  
  // Generate new suggestions
  try {
    const prompt = buildSuggestionsPrompt(workspaceProfile, userData || {});
    
    logAI('GENERATE_SUGGESTIONS', { userId, workspaceId });
    
    const { content } = await callWithFallback({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.8,
      maxTokens: 400,
    });
    
    // Parse JSON response
    let suggestions = DEFAULT_SUGGESTIONS;
    const cleanedContent = content.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleanedContent);
    
    if (Array.isArray(parsed) && parsed.length >= 3) {
      suggestions = parsed.slice(0, 5);
    }
    
    // Calculate expiry (7 days from now)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    
    // Save to cache (upsert)
    const { error: upsertError } = await supabaseAdmin
      .from('cached_suggestions')
      .upsert({
        workspace_id: workspaceId,
        user_id: userId,
        suggestions: suggestions,
        profile_hash: currentHash,
        expires_at: expiresAt.toISOString(),
        created_at: now,
      }, {
        onConflict: 'workspace_id,user_id'
      });
    
    if (upsertError) {
      logError('CACHE_SAVE_ERROR', upsertError, { userId, workspaceId });
    } else {
      log('CACHE_SAVED', { userId, workspaceId, expiresAt });
    }
    
    log('SUGGESTIONS_GENERATED', { userId, workspaceId, count: suggestions.length });
    res.json({ 
      suggestions: suggestions,
      cached: false,
      expires_at: expiresAt.toISOString()
    });
    
  } catch (err) {
    logError('GENERATION_ERROR', err, { userId, workspaceId });
    // Return stale cache if available, otherwise defaults
    if (cached?.suggestions) {
      return res.json({ suggestions: cached.suggestions, cached: true, stale: true });
    }
    res.json({ suggestions: DEFAULT_SUGGESTIONS, cached: false, error: true });
  }
}));

export default router;