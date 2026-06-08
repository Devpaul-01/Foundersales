// src/services/perplexity.js
// ============================================================
// EXA SEARCH SERVICE — MIGRATED FROM PERPLEXITY
//
// CHANGES:
//  - Replaced Perplexity API client with Exa (exa-js)
//  - callPerplexity() replaced with callExa() using neural search
//  - parseSearchResults() updated: Exa returns { text } not { snippet }
//  - buildSearchQueries() updated: removed site: operator (Exa uses includeDomains)
//  - searchForChat() now uses Exa neural search instead of Perplexity chat completions
//  - PERPLEXITY_AVAILABLE kept as variable name so opportunities.js needs no changes
//  - All quota logic, Groq fallback, workspace refactor unchanged
// ============================================================

import Exa from 'exa-js';
import { parseJSONArray } from '../utils/parser.js';
import {
  PERPLEXITY_LIMITS,
  PERPLEXITY_GLOBAL_DAILY_CAP,
  PERPLEXITY_COST_PER_CALL_CENTS,
  OPPORTUNITIES_PER_RUN,
  SUPPORTED_PLATFORMS,
  ARCHETYPE_PLATFORM_DEFAULTS,
  WORKSPACE_PERPLEXITY_LIMITS,
} from '../config/constants.js';
import supabaseAdmin from '../config/supabase.js';

// ── API key availability ──────────────────────────────────────
const EXA_API_KEY          = process.env.EXA_API_KEY;
const PERPLEXITY_AVAILABLE = !!(EXA_API_KEY?.trim()); // name kept so other files need no changes

if (!PERPLEXITY_AVAILABLE) {
  console.warn('[Exa] EXA_API_KEY not set — all calls will use Groq fallback.');
}

const exaClient = PERPLEXITY_AVAILABLE ? new Exa(EXA_API_KEY) : null;

// ──────────────────────────────────────────────────────────────
// WORKSPACE QUOTA CHECK
// Checks the pooled workspace-level daily call count.
// Used by opportunity discovery and intel lookups.
// Plan limits are sourced from constants.js (WORKSPACE_PERPLEXITY_LIMITS)
// to ensure a single source of truth — no local copies.
// ──────────────────────────────────────────────────────────────
export const checkWorkspacePerplexityUsage = async (workspaceId, plan = 'free') => {
  const today = new Date().toISOString().split('T')[0];
  const limit = WORKSPACE_PERPLEXITY_LIMITS[plan] ?? WORKSPACE_PERPLEXITY_LIMITS.free;

  // Check global daily cap first
  const { data: globalUsage } = await supabaseAdmin
    .from('global_usage').select('perplexity_calls').eq('date', today).single();

  if ((globalUsage?.perplexity_calls || 0) >= PERPLEXITY_GLOBAL_DAILY_CAP) {
    return { allowed: false, reason: 'global_cap_reached', used: globalUsage.perplexity_calls, limit };
  }

  // Check workspace-level usage
  const { data: wsUsage } = await supabaseAdmin
    .from('workspace_perplexity_usage')
    .select('call_count').eq('workspace_id', workspaceId).eq('date', today).single();

  const used = wsUsage?.call_count || 0;

  if (used >= limit) {
    return { allowed: false, reason: 'workspace_limit_reached', used, limit };
  }

  return { allowed: true, used, limit };
};

// ──────────────────────────────────────────────────────────────
// INCREMENT WORKSPACE USAGE (atomic)
// ──────────────────────────────────────────────────────────────
export const incrementWorkspaceUsage = async (workspaceId) => {
  const today = new Date().toISOString().split('T')[0];

  try {
    await supabaseAdmin
      .rpc('increment_workspace_perplexity_usage', {
        p_workspace_id: workspaceId,
        p_date:         today,
      });
  } catch (rpcErr) {
    console.warn('[Exa] increment_workspace_perplexity_usage RPC not found, using fallback:', rpcErr.message);
    try {
      const { data: existing } = await supabaseAdmin
        .from('workspace_perplexity_usage')
        .select('call_count').eq('workspace_id', workspaceId).eq('date', today).maybeSingle();
      await supabaseAdmin.from('workspace_perplexity_usage').upsert(
        { workspace_id: workspaceId, date: today, call_count: (existing?.call_count || 0) + 1 },
        { onConflict: 'workspace_id,date', ignoreDuplicates: false }
      );
    } catch (_) {}
  }

  // Also increment global counter
  try {
    await supabaseAdmin.rpc('increment_perplexity_global_usage', { p_date: today });
  } catch (_) {}
};

// ──────────────────────────────────────────────────────────────
// PER-USER INCREMENT (kept for email digest individual quota)
// ──────────────────────────────────────────────────────────────
export const incrementUsage = async (userId) => {
  const today = new Date().toISOString().split('T')[0];

  try {
    await supabaseAdmin
      .rpc('increment_perplexity_user_usage', { p_user_id: userId, p_date: today });
  } catch (rpcErr) {
    console.warn('[Exa] increment_perplexity_user_usage RPC not found, using upsert fallback:', rpcErr.message);
    try {
      const { data: existing } = await supabaseAdmin
        .from('perplexity_usage').select('call_count').eq('user_id', userId).eq('date', today).maybeSingle();
      await supabaseAdmin.from('perplexity_usage').upsert(
        { user_id: userId, date: today, call_count: (existing?.call_count || 0) + 1 },
        { onConflict: 'user_id,date', ignoreDuplicates: false }
      );
    } catch (_) {}
  }

  try {
    await supabaseAdmin.rpc('increment_perplexity_global_usage', { p_date: today });
  } catch (rpcErr) {
    console.warn('[Exa] increment_perplexity_global_usage RPC not found, using upsert fallback:', rpcErr.message);
    try {
      const { data: existingGlobal } = await supabaseAdmin
        .from('global_usage').select('perplexity_calls').eq('date', today).maybeSingle();
      await supabaseAdmin.from('global_usage').upsert(
        { date: today, perplexity_calls: (existingGlobal?.perplexity_calls || 0) + 1 },
        { onConflict: 'date', ignoreDuplicates: false }
      );
    } catch (_) {}
  }
};

// ──────────────────────────────────────────────────────────────
// PER-USER QUOTA CHECK (kept for email digest)
// ──────────────────────────────────────────────────────────────
export const checkPerplexityUsage = async (userId, tier = 'free') => {
  const today = new Date().toISOString().split('T')[0];
  const limit = PERPLEXITY_LIMITS[tier] ?? PERPLEXITY_LIMITS.free;

  const { data: globalUsage } = await supabaseAdmin
    .from('global_usage').select('perplexity_calls').eq('date', today).single();
  if ((globalUsage?.perplexity_calls || 0) >= PERPLEXITY_GLOBAL_DAILY_CAP) {
    return { allowed: false, reason: 'global_cap_reached', used: globalUsage.perplexity_calls, limit };
  }

  const { data: userUsage } = await supabaseAdmin
    .from('perplexity_usage').select('call_count').eq('user_id', userId).eq('date', today).single();
  const used = userUsage?.call_count || 0;
  if (used >= limit) {
    return { allowed: false, reason: 'user_limit_reached', used, limit };
  }
  return { allowed: true, used, limit };
};

// ──────────────────────────────────────────────────────────────
// SMART COST ROUTER (unchanged — reads from user context object)
// ──────────────────────────────────────────────────────────────
export const needsRealTimeSearch = async (user) => {
  if (!user.product_description || user.product_description.length < 30) {
    return { needed: false, reason: 'profile_too_thin' };
  }
  if (!user.target_audience || user.target_audience.length < 20) {
    return { needed: false, reason: 'no_target_audience' };
  }
  if (!PERPLEXITY_AVAILABLE) {
    return { needed: false, reason: 'exa_not_configured' };
  }

  const { callGroq } = await import('./groq.js');
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
    const { content } = await callGroq({ messages: [{ role: 'user', content: prompt }], temperature: 0.1, maxTokens: 500 });
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
// PLATFORM DETECTION (unchanged)
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
// CORE EXA SEARCH — replaces callPerplexity()
// Uses neural search to find semantically relevant posts/pages
// with direct URLs — exactly what Perplexity couldn't do.
// ──────────────────────────────────────────────────────────────
const callExa = async (query, domains = []) => {
  if (!exaClient) throw new Error('PERPLEXITY_UNAVAILABLE: Exa API key not configured');

  const result = await exaClient.searchAndContents(query, {
    type: 'neural',
    numResults: 10,
    ...(domains.length > 0 && { includeDomains: domains }),
    text: { maxCharacters: 600 },
    useAutoprompt: true,
  });

  return { results: result.results || [] };
};

// ──────────────────────────────────────────────────────────────
// PARSE EXA RESULTS — updated from Perplexity's { snippet } to Exa's { text }
// ──────────────────────────────────────────────────────────────
const parseSearchResults = (results) => {
  return (results || [])
    .filter(r => r?.url && r?.text)
    .map(r => ({
      source_url:     r.url,
      target_context: r.text?.slice(0, 600) || '',
      target_name:    null,
      platform:       detectPlatformFromUrl(r.url),
    }))
    .filter(r => r.target_context.length > 30);
};

// ──────────────────────────────────────────────────────────────
// BUILD SEARCH QUERIES — updated for Exa (no site: operator needed,
// domains passed as includeDomains directly to callExa)
// ──────────────────────────────────────────────────────────────
const buildSearchQueries = (user) => {
  const product    = user.product_description?.slice(0, 100) || '';
  const audience   = user.target_audience?.slice(0, 80)      || '';
  const icpTrigger = user.voice_profile?.icp_trigger?.slice(0, 80) || '';
  const platforms  = (user.preferred_platforms || ['reddit']).slice(0, 2);

  return platforms.map(p => {
    const platformDomains = {
      reddit:       ['reddit.com'],
      linkedin:     ['linkedin.com'],
      twitter:      ['twitter.com', 'x.com'],
      indiehackers: ['indiehackers.com'],
      hackernews:   ['news.ycombinator.com'],
    };

    // Clean query — no site: operator, Exa handles domain filtering natively
    const query = [
      icpTrigger || audience,
      product.slice(0, 50),
    ].filter(Boolean).join(' ');

    return { query, domains: platformDomains[p] || [] };
  });
};

// ──────────────────────────────────────────────────────────────
// GROQ FALLBACK (unchanged — reads from user context)
// ──────────────────────────────────────────────────────────────
const searchWithGroqFallback = async (user) => {
  const { callGroq } = await import('./groq.js');
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
    const { content } = await callGroq({ messages: [{ role: 'user', content: prompt }], temperature: 0.75, maxTokens: 900 });
    const examples = parseJSONArray(content, []);
    return {
      opportunities: examples.map(e => ({ ...e, is_example: true, prepared_message: null })),
      model_used:    'groq_fallback',
      notice: PERPLEXITY_AVAILABLE
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
// WORKSPACE REFACTOR: now accepts workspaceId, checks workspace quota
// ──────────────────────────────────────────────────────────────
export const discoverOpportunities = async (userId, workspaceId, user) => {
  if (!PERPLEXITY_AVAILABLE) {
    return await searchWithGroqFallback(user);
  }

  // Workspace-level quota check (Option A: pooled)
  const workspacePlan = user.tier || 'free';
  const usageCheck    = await checkWorkspacePerplexityUsage(workspaceId, workspacePlan);

  if (!usageCheck.allowed) {
    console.log(`[Exa] Workspace limit hit for ${workspaceId} (${usageCheck.reason}), falling back to Groq`);
    return await searchWithGroqFallback(user);
  }

  // Smart cost router
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
        if (r?.url && !seen.has(r.url)) {
          seen.add(r.url);
          allResults.push(r);
        }
      }
      if (allResults.length >= 10) break;
    }

    // Increment workspace-level usage
    await incrementWorkspaceUsage(workspaceId);

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
// CHAT SEARCH ROUTER (unchanged)
// ──────────────────────────────────────────────────────────────
export const needsChatSearch = async (message) => {
  if (!PERPLEXITY_AVAILABLE) return { needs_search: false, reason: 'exa_not_configured' };

  const { callGroq: cg } = await import('./groq.js');
  const prompt = `You decide if a user's question needs a real-time web search to answer accurately.
Question: "${message.slice(0, 400)}"
Answer ONLY with this JSON (no markdown):
{"needs_search": true, "reason": "one short sentence"}
OR
{"needs_search": false, "reason": "one short sentence"}
Search IS needed for: current news, recent events, today's prices/data, "latest" anything, specific current roles/positions.
Search is NOT needed for: sales strategy advice, coaching, product feedback, how-to questions, writing help, explaining concepts.`;

  try {
    const { content } = await cg({ messages: [{ role: 'user', content: prompt }], temperature: 0.1, maxTokens: 60 });
    const parsed = JSON.parse(content.replace(/```json|```/g, '').trim());
    if (typeof parsed.needs_search === 'boolean') return parsed;
    return { needs_search: false, reason: 'parse_fallback' };
  } catch (err) {
    console.warn('[ChatRouter] needsChatSearch failed:', err.message);
    return { needs_search: false, reason: 'error_fallback' };
  }
};

// ──────────────────────────────────────────────────────────────
// SEARCH FOR CHAT — now uses Exa neural search instead of
// Perplexity chat completions. Returns content + citations.
// FIX MED-09: systemContext is incorporated into the search query
// ──────────────────────────────────────────────────────────────
export const searchForChat = async (message, systemContext = '') => {
  if (!PERPLEXITY_AVAILABLE || !exaClient) {
    throw new Error('PERPLEXITY_UNAVAILABLE: Exa API key not configured');
  }

  // FIX MED-09: Enhance search query with systemContext if provided
  let searchQuery = message;
  if (systemContext) {
    // Extract key context from system prompt (first 200 chars)
    const contextHint = systemContext;
    searchQuery = `${message} Context: ${contextHint}`;
  }

  const result = await exaClient.searchAndContents(searchQuery, {
    type: 'neural',
    numResults: 5,
    text: { maxCharacters: 1000 },
    useAutoprompt: true,
  });

  const results   = result.results || [];
  const content   = results.map(r => `[${r.title || r.url}]\n${r.text || ''}`).join('\n\n');
  const citations = results.map(r => r.url).filter(Boolean);

  return { content, citations };
};

export default { discoverOpportunities, checkWorkspacePerplexityUsage, checkPerplexityUsage, needsRealTimeSearch };
