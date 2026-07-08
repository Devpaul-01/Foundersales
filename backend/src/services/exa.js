// src/services/exa.js
// ============================================================
// EXA SEARCH SERVICE
// Replaces perplexity.js. The old file was functionally Exa already
// (migrated from Perplexity) but kept Perplexity naming throughout,
// which is exactly the kind of thing that confuses a future maintainer —
// renamed cleanly here, no behavior carried over by accident.
//
// Quota/usage logic has been extracted entirely into tokenTracker.js
// (checkWorkspaceExaUsage, recordExaUsage) — this file no longer owns any
// usage-tracking tables or RPCs directly. See migrations/001 for the
// dropped legacy tables this replaces (perplexity_usage,
// workspace_perplexity_usage, global_usage).
//
// CALL SITE CHANGES vs. the old perplexity.js (see CHANGES.md):
//   - discoverOpportunities(userId, workspaceId, user)            — unchanged signature
//   - searchForChat(message, systemContext, { workspaceId, userId, sourceJob }) — NEW required 3rd arg for usage tracking
//   - checkPerplexityUsage / checkWorkspacePerplexityUsage / incrementUsage /
//     incrementWorkspaceUsage — REMOVED. Use tokenTracker.checkWorkspaceExaUsage /
//     tokenTracker.recordExaUsage directly.
//
// MULTI-KEY SUPPORT (added):
//   EXA_API_KEY_1 … EXA_API_KEY_5      (checked in order)
//   EXA_API_KEY                        (single-key fallback, no suffix)
// This is intentionally a lighter version of multiProvider.js's key
// rotation — one provider (Exa), no model discovery, no streaming.
// A key that fails with a rate-limit/auth/server error is cooled down
// in-memory for an hour and skipped; the next key in the pool is tried.
// This is NOT a provider fallback (the Groq fallback below is unchanged) —
// it's just resilience across multiple Exa accounts/keys.
// ============================================================

import Exa from 'exa-js';
import { parseJSONArray } from '../utils/parser.js';
import {
  OPPORTUNITIES_PER_RUN,
  SUPPORTED_PLATFORMS,
} from '../config/constants.js';
import { callWithFallbackGroq } from './multiProvider.js';
import { checkWorkspaceExaUsage, recordExaUsage } from './tokenTracker.js';

// ──────────────────────────────────────────────────────────────
// EXA KEY POOL
// ──────────────────────────────────────────────────────────────
const EXA_ENV_PREFIX = 'EXA_API_KEY';
const EXA_MAX_KEYS   = 5;

const buildExaKeyPool = () => {
  const keys = [];
  for (let i = 1; i <= EXA_MAX_KEYS; i++) {
    const key = process.env[`${EXA_ENV_PREFIX}_${i}`];
    if (key?.trim()) keys.push({ key: key.trim(), index: i });
  }
  // Single-key fallback (no suffix)
  if (keys.length === 0 && process.env[EXA_ENV_PREFIX]?.trim()) {
    keys.push({ key: process.env[EXA_ENV_PREFIX].trim(), index: 0 });
  }
  if (keys.length > 0) {
    console.log(`[Exa] ${keys.length} key(s) loaded`);
  }
  return keys;
};

const EXA_KEY_POOL  = buildExaKeyPool();
const EXA_AVAILABLE = EXA_KEY_POOL.length > 0;

if (!EXA_AVAILABLE) {
  console.warn('[Exa] No EXA_API_KEY(s) set — all calls will use Groq fallback.');
}

// key index -> Exa client, built lazily/once per key
const clientCache = new Map();
const getClientForKey = (keyEntry) => {
  if (!clientCache.has(keyEntry.index)) {
    clientCache.set(keyEntry.index, new Exa(keyEntry.key));
  }
  return clientCache.get(keyEntry.index);
};

// ──────────────────────────────────────────────────────────────
// KEY COOLDOWN (in-memory) — mirrors multiProvider.js's approach,
// scoped to just Exa keys.
// ──────────────────────────────────────────────────────────────
const KEY_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const keyCooldowns    = new Map();

const markKeyFailed = (keyIndex) => {
  const existing = keyCooldowns.get(keyIndex) || { failCount: 0 };
  keyCooldowns.set(keyIndex, { failedAt: Date.now(), failCount: existing.failCount + 1 });
  console.warn(`[Exa] key #${keyIndex} cooling down (fail #${existing.failCount + 1}) — retrying in 1h`);
};

const isKeyCooling = (keyIndex) => {
  const cd = keyCooldowns.get(keyIndex);
  if (!cd) return false;
  if (Date.now() - cd.failedAt >= KEY_COOLDOWN_MS) {
    keyCooldowns.delete(keyIndex);
    console.log(`[Exa] key #${keyIndex} cooldown expired — back in rotation`);
    return false;
  }
  return true;
};

const RATE_LIMIT_SIGNALS = ['rate_limit', 'rate limit', '429', 'too many requests', 'quota exceeded'];
const AUTH_ERROR_SIGNALS = ['401', 'unauthorized', 'invalid api key', 'invalid_api_key', 'authentication'];
const UNAVAIL_SIGNALS    = ['503', '502', '500', 'unavailable', 'overloaded', 'server error'];

const matchesAny = (msg, signals) => signals.some(s => msg.includes(s));

const shouldCoolKey = (err) => {
  const msg = (err?.message || '').toLowerCase();
  return matchesAny(msg, RATE_LIMIT_SIGNALS) || matchesAny(msg, AUTH_ERROR_SIGNALS) || matchesAny(msg, UNAVAIL_SIGNALS);
};

const getHealthyKeys = () => EXA_KEY_POOL.filter(k => !isKeyCooling(k.index));

// ──────────────────────────────────────────────────────────────
// runWithExaKeys — tries `fn(client)` against each healthy key in turn,
// cooling down any key that fails with a rate-limit/auth/server error,
// and moving on to the next key. Throws EXA_UNAVAILABLE if no keys are
// configured/healthy, or the last error if every key was tried and failed.
// ──────────────────────────────────────────────────────────────
const runWithExaKeys = async (fn) => {
  const healthy = getHealthyKeys();
  if (healthy.length === 0) {
    throw new Error('EXA_UNAVAILABLE: no Exa API keys configured or all keys cooling down');
  }

  let lastError;
  for (const keyEntry of healthy) {
    try {
      const client = getClientForKey(keyEntry);
      return await fn(client);
    } catch (err) {
      lastError = err;
      console.warn(`[Exa] key #${keyEntry.index} failed: ${err.message}`);
      if (shouldCoolKey(err)) markKeyFailed(keyEntry.index);
      // try the next key regardless of error type — a bad key shouldn't
      // block the whole search when another key is available
    }
  }

  throw lastError || new Error('EXA_UNAVAILABLE: all Exa keys exhausted');
};

// ──────────────────────────────────────────────────────────────
// SMART COST ROUTER — decides whether a search is worth the spend
// ──────────────────────────────────────────────────────────────
export const needsRealTimeSearch = async (user) => {
  if (!user.product_description || user.product_description.length < 30) {
    return { needed: false, reason: 'profile_too_thin' };
  }
  if (!user.target_audience || user.target_audience.length < 20) {
    return { needed: false, reason: 'no_target_audience' };
  }
  if (!EXA_AVAILABLE) {
    return { needed: false, reason: 'exa_not_configured' };
  }

  const prompt = `You are deciding whether to make an expensive real-time web search API call.
Analyze this user profile and decide: does a live search right now have a GOOD CHANCE of finding specific, relevant people expressing the problem this product solves?
Product: "${user.product_description}"
Target audience: "${user.target_audience}"
ICP trigger: "${user.voice_profile?.icp_trigger || 'not specified'}"
Preferred platforms: ${JSON.stringify(user.preferred_platforms || [])}
Archetype: "${user.archetype || 'seller'}"
User location: "${user.country ? (user.state ? `${user.state}, ${user.country}` : user.country) : 'not specified'}"
Answer ONLY with this exact JSON (no markdown, no explanation):
{"needed": true, "reason": "one short sentence why"}
OR
{"needed": false, "reason": "one short sentence why not"}`;

  try {
    const { content } = await callWithFallbackGroq({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1, maxTokens: 200, tier: 'fast',
      workspaceId: user.workspace_id, userId: user.id, sourceJob: 'needs_real_time_search',
    });
    const clean  = content.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    if (typeof parsed.needed === 'boolean') return parsed;
    return { needed: true, reason: 'parse_fallback' };
  } catch (err) {
    console.warn('[SmartRouter] Decision failed, defaulting to Groq fallback:', err.message);
    return { needed: false, reason: 'error_fallback' };
  }
};

// ──────────────────────────────────────────────────────────────
// PLATFORM DETECTION
// ──────────────────────────────────────────────────────────────
const PLATFORM_URL_PATTERNS = [
  { platform: SUPPORTED_PLATFORMS.REDDIT,       pattern: /reddit\.com/i },
  { platform: SUPPORTED_PLATFORMS.LINKEDIN,     pattern: /linkedin\.com/i },
  { platform: SUPPORTED_PLATFORMS.TWITTER,      pattern: /twitter\.com|x\.com/i },
  { platform: SUPPORTED_PLATFORMS.FACEBOOK,     pattern: /facebook\.com/i },
  { platform: SUPPORTED_PLATFORMS.INSTAGRAM,    pattern: /instagram\.com/i },
  { platform: SUPPORTED_PLATFORMS.PRODUCTHUNT,  pattern: /producthunt\.com/i },
  { platform: SUPPORTED_PLATFORMS.INDIEHACKERS, pattern: /indiehackers\.com/i },
  { platform: SUPPORTED_PLATFORMS.HACKERNEWS,   pattern: /news\.ycombinator\.com/i },
];

const detectPlatformFromUrl = (url) => {
  if (!url) return 'other';
  for (const { platform, pattern } of PLATFORM_URL_PATTERNS) {
    if (pattern.test(url)) return platform;
  }
  return 'other';
};

// ──────────────────────────────────────────────────────────────
// CORE EXA SEARCH
// ──────────────────────────────────────────────────────────────
const callExa = async (query, domains = []) => {
  const result = await runWithExaKeys((client) => client.searchAndContents(query, {
    type: 'neural',
    numResults: 10,
    ...(domains.length > 0 && { includeDomains: domains }),
    text: { maxCharacters: 600 },
    useAutoprompt: true,
  }));
  return { results: result.results || [] };
};

const parseSearchResults = (results) => (results || [])
  .filter(r => r?.url && r?.text)
  .map(r => ({
    source_url:     r.url,
    target_context: r.text?.slice(0, 600) || '',
    target_name:    null,
    platform:       detectPlatformFromUrl(r.url),
  }))
  .filter(r => r.target_context.length > 30);

const buildSearchQueries = (user) => {
  const product    = user.product_description?.slice(0, 100) || '';
  const audience    = user.target_audience?.slice(0, 80)      || '';
  const icpTrigger  = user.voice_profile?.icp_trigger?.slice(0, 80) || '';
  const platforms   = (user.preferred_platforms || ['reddit']).slice(0, 2);

  return platforms.map(p => {
    const platformDomains = {
      reddit:       ['reddit.com'],
      linkedin:     ['linkedin.com'],
      twitter:      ['twitter.com', 'x.com'],
      indiehackers: ['indiehackers.com'],
      hackernews:   ['news.ycombinator.com'],
    };
    const query = [icpTrigger || audience, product.slice(0, 50)].filter(Boolean).join(' ');
    return { query, domains: platformDomains[p] || [] };
  });
};

// ──────────────────────────────────────────────────────────────
// GROQ FALLBACK — practice examples when Exa is unavailable/over quota
// ──────────────────────────────────────────────────────────────
const searchWithGroqFallback = async (user) => {
  const platforms = (user.preferred_platforms || ['reddit']).slice(0, 3);

  const prompt = `Generate ${OPPORTUNITIES_PER_RUN} realistic practice examples of people online who would genuinely benefit from: "${user.product_description}".
Target audience: "${user.target_audience}"
Platforms to simulate: ${platforms.join(', ')}
Return ONLY a JSON array:
[{
  "platform": "reddit",
  "source_url": "https://reddit.com/r/[relevant_subreddit]/comments/example",
  "target_context": "Vivid description of a real-seeming person and what specific problem they posted about",
  "note": "Practice example"
}]
Make contexts feel real — include specific details, realistic frustrations, and platform-appropriate language.`;

  try {
    const { content } = await callWithFallbackGroq({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.75, maxTokens: 900, tier: 'quality',
      workspaceId: user.workspace_id, userId: user.id, sourceJob: 'opportunity_fetch_fallback',
    });
    const examples = parseJSONArray(content, []);
    return {
      opportunities: examples.map(e => ({ ...e, is_example: true, prepared_message: null })),
      model_used:    'groq_fallback',
      notice: EXA_AVAILABLE
        ? "Today's live search is used up. These are practice examples — not real people. Real leads refresh at midnight."
        : "Live search is not active. These are practice examples, not real leads",
      is_fallback: true,
    };
  } catch (err) {
    console.error('[Exa] Groq fallback failed:', err.message);
    return { opportunities: [], model_used: 'groq_fallback', notice: "Could not generate examples right now.", is_fallback: true };
  }
};

// ──────────────────────────────────────────────────────────────
// MAIN EXPORT — discoverOpportunities
// ──────────────────────────────────────────────────────────────
export const discoverOpportunities = async (userId, workspaceId, user) => {
  if (!EXA_AVAILABLE) return await searchWithGroqFallback(user);

  const usageCheck = await checkWorkspaceExaUsage(workspaceId, user.tier || 'free');
  if (!usageCheck.allowed) {
    console.log(`[Exa] Workspace limit hit for ${workspaceId} (${usageCheck.reason}), falling back to Groq`);
    return await searchWithGroqFallback(user);
  }

  const routerDecision = await needsRealTimeSearch(user);
  if (!routerDecision.needed) {
    console.log(`[SmartRouter] Skipping Exa for workspace ${workspaceId}: ${routerDecision.reason}`);
    return await searchWithGroqFallback(user);
  }

  try {
    const queryConfigs = buildSearchQueries(user);
    const seen         = new Set();
    const allResults   = [];

    for (const { query, domains } of queryConfigs) {
      const { results } = await callExa(query, domains);
      for (const r of results) {
        if (r?.url && !seen.has(r.url)) { seen.add(r.url); allResults.push(r); }
      }
      if (allResults.length >= 10) break;
    }

    await recordExaUsage({ workspaceId, userId, creditsUsed: queryConfigs.length, sourceJob: 'opportunity_fetch' });

    const rawOpportunities = parseSearchResults(allResults);
    console.log(`[Exa] ${rawOpportunities.length} unique opportunities from ${queryConfigs.length} queries for workspace ${workspaceId}`);

    if (rawOpportunities.length === 0) {
      console.warn('[Exa] Search returned 0 results — falling back to Groq');
      return await searchWithGroqFallback(user);
    }

    return {
      opportunities: rawOpportunities,
      model_used:    'exa_search_api',
      is_fallback:   false,
      notice:        null,
      usage: { used: usageCheck.used + 1, limit: usageCheck.limit },
    };
  } catch (err) {
    console.error(`[Exa] Search failed for workspace ${workspaceId}:`, err.message);
    const fallback = await searchWithGroqFallback(user);
    return { ...fallback, notice: "Live search had an issue. Showing example opportunities instead." };
  }
};

// ──────────────────────────────────────────────────────────────
// CHAT SEARCH ROUTER
// ──────────────────────────────────────────────────────────────
export const needsChatSearch = async (message, { workspaceId, userId } = {}) => {
  if (!EXA_AVAILABLE) return { needs_search: false, reason: 'exa_not_configured' };

  const prompt = `You decide if a user's question needs a real-time web search to answer accurately.
Question: "${message.slice(0, 400)}"
Answer ONLY with this JSON (no markdown):
{"needs_search": true, "reason": "one short sentence"}
OR
{"needs_search": false, "reason": "one short sentence"}
Search IS needed for: current news, recent events, today's prices/data, "latest" anything, specific current roles/positions.
Search is NOT needed for: sales strategy advice, coaching, product feedback, how-to questions, writing help, explaining concepts.`;

  try {
    const { content } = await callWithFallbackGroq({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1, maxTokens: 100, tier: 'fast',
      workspaceId, userId, sourceJob: 'needs_chat_search',
    });
    const parsed = JSON.parse(content.replace(/```json|```/g, '').trim());
    if (typeof parsed.needs_search === 'boolean') return parsed;
    return { needs_search: false, reason: 'parse_fallback' };
  } catch (err) {
    console.warn('[ChatRouter] needsChatSearch failed:', err.message);
    return { needs_search: false, reason: 'error_fallback' };
  }
};

// ──────────────────────────────────────────────────────────────
// SEARCH FOR CHAT — used by emailDigestJob.js (market intel) and
// messageQueueWorker.js (real-time search trigger during practice replies).
// workspaceId/userId are required for usage tracking; pass sourceJob to
// label where the spend came from in ai_usage_events.
// ──────────────────────────────────────────────────────────────
export const searchForChat = async (message, systemContext = '', { workspaceId, userId, sourceJob = 'search_for_chat' } = {}) => {
  if (!EXA_AVAILABLE) {
    throw new Error('EXA_UNAVAILABLE: no Exa API keys configured');
  }

  const searchQuery = systemContext ? `${message} Context: ${systemContext}` : message;

  const result = await runWithExaKeys((client) => client.searchAndContents(searchQuery, {
    type: 'neural',
    numResults: 5,
    text: { maxCharacters: 1000 },
    useAutoprompt: true,
  }));

  await recordExaUsage({ workspaceId, userId, creditsUsed: 1, sourceJob });

  const results   = result.results || [];
  const content   = results.map(r => `[${r.title || r.url}]\n${r.text || ''}`).join('\n\n');
  const citations = results.map(r => r.url).filter(Boolean);

  return { content, citations };
};

export default { discoverOpportunities, needsRealTimeSearch, needsChatSearch, searchForChat };
