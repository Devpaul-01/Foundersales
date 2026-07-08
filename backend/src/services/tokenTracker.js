// src/services/tokenTracker.js
// ============================================================
// AI USAGE TRACKING — REDESIGN
//
// Replaces the old user-only, Perplexity-named tracking system.
// Tables: ai_usage_events (granular, append-only, billing-ready)
//         workspace_ai_usage_daily (fast rollup for quota checks)
// See migrations/001_audit_remediation.sql for schema.
//
// Design notes:
//  - Every call requires BOTH workspaceId and userId. The old system
//    took a single `id` param that meant "user" in some call sites and
//    "workspace" in others — that ambiguity is exactly what broke cost
//    reporting. There is no longer a way to call this without being
//    explicit about both.
//  - workspaceId/userId are still accepted as nullable at the call site
//    (see recordGroqUsage/recordExaUsage) so callers that don't yet have
//    full context degrade to a console.warn instead of throwing. This
//    matters because multiProvider.js's callWithFallbackGroq() calls into
//    this file automatically when given ids, and some groq-practice.js
//    functions (evaluateBuyerStateChange, generatePracticeInterruption)
//    aren't reachable from any route in this codebase's scope — their
//    real call sites may or may not have workspace context, and adding a
//    hard requirement here would risk breaking an unseen caller.
//  - Global daily totals are derived by summing workspace_ai_usage_daily
//    for the day, rather than maintaining a separate counter. The old
//    system had THREE separate counters (user-level, workspace-level,
//    global-level) that could drift independently — this design has one
//    source of truth.
// ============================================================

import supabaseAdmin from '../config/supabase.js';

// ──────────────────────────────────────────
// Plan limits — replaces PERPLEXITY_LIMITS / WORKSPACE_PERPLEXITY_LIMITS /
// PERPLEXITY_GLOBAL_DAILY_CAP from constants.js. Groq has no limits
// (matches the old GROQ_LIMITS = Infinity convention).
// ──────────────────────────────────────────
export const EXA_WORKSPACE_DAILY_LIMITS = { free: 5, pro: 50, enterprise: 200 };
export const EXA_GLOBAL_DAILY_CAP_CALLS = 500;
export const EXA_COST_PER_SEARCH_CENTS  = 5; // matches old PERPLEXITY_COST_PER_CALL_CENTS

// ──────────────────────────────────────────
// CORE WRITE PATH
// ──────────────────────────────────────────
const writeUsageEvent = async ({
  workspaceId, userId, provider, eventType, model = null, tier = null,
  tokensIn = 0, tokensOut = 0, creditsUsed = 0, costCents = 0,
  sourceJob = null, metadata = {},
}) => {
  if (!workspaceId || !userId) {
    console.warn(`[tokenTracker] Skipping ${provider} usage record — missing workspaceId or userId (sourceJob: ${sourceJob || 'unknown'})`);
    return null;
  }

  try {
    const { data, error } = await supabaseAdmin.rpc('record_ai_usage', {
      p_workspace_id: workspaceId,
      p_user_id:      userId,
      p_provider:     provider,
      p_event_type:   eventType,
      p_model:        model,
      p_tier:         tier,
      p_tokens_in:    tokensIn,
      p_tokens_out:   tokensOut,
      p_credits_used: creditsUsed,
      p_cost_cents:   costCents,
      p_source_job:   sourceJob,
      p_metadata:     metadata,
    });
    if (error) {
      console.warn(`[tokenTracker] record_ai_usage failed for ${provider}:`, error.message);
      return null;
    }
    return data; // event id
  } catch (err) {
    console.warn(`[tokenTracker] record_ai_usage threw for ${provider}:`, err.message);
    return null;
  }
};

// ──────────────────────────────────────────
// GROQ (LLM completions)
// ──────────────────────────────────────────
export const recordGroqUsage = async ({
  workspaceId, userId, model, tier, tokensIn, tokensOut, sourceJob, metadata,
}) => writeUsageEvent({
  workspaceId, userId, provider: 'groq', eventType: 'completion',
  model, tier, tokensIn, tokensOut, sourceJob, metadata,
});

// ──────────────────────────────────────────
// EXA (search)
// ──────────────────────────────────────────
export const recordExaUsage = async ({
  workspaceId, userId, creditsUsed = 1, costCents = EXA_COST_PER_SEARCH_CENTS, sourceJob, metadata,
}) => writeUsageEvent({
  workspaceId, userId, provider: 'exa', eventType: 'search',
  creditsUsed, costCents, sourceJob, metadata,
});

// ──────────────────────────────────────────
// QUOTA CHECKS (Exa only — Groq has no limit, matching prior convention)
// ──────────────────────────────────────────
export const checkWorkspaceExaUsage = async (workspaceId, plan = 'free') => {
  const today = new Date().toISOString().split('T')[0];
  const limit = EXA_WORKSPACE_DAILY_LIMITS[plan] ?? EXA_WORKSPACE_DAILY_LIMITS.free;

  // Global cap first — single source of truth, summed from the same rollup
  // table every workspace writes to (no separate drift-prone counter).
  const { data: globalRows } = await supabaseAdmin
    .from('workspace_ai_usage_daily')
    .select('call_count')
    .eq('date', today)
    .eq('provider', 'exa');

  const globalUsed = (globalRows || []).reduce((sum, r) => sum + (r.call_count || 0), 0);
  if (globalUsed >= EXA_GLOBAL_DAILY_CAP_CALLS) {
    return { allowed: false, reason: 'global_cap_reached', used: globalUsed, limit };
  }

  const { data: wsRow } = await supabaseAdmin
    .from('workspace_ai_usage_daily')
    .select('call_count')
    .eq('workspace_id', workspaceId)
    .eq('date', today)
    .eq('provider', 'exa')
    .maybeSingle();

  const used = wsRow?.call_count || 0;
  if (used >= limit) {
    return { allowed: false, reason: 'workspace_limit_reached', used, limit };
  }
  return { allowed: true, used, limit };
};

// ──────────────────────────────────────────
// USAGE SUMMARY (workspace dashboard)
// ──────────────────────────────────────────
export const getWorkspaceUsageSummary = async (workspaceId) => {
  const today = new Date().toISOString().split('T')[0];
  const monthStart = today.slice(0, 8) + '01';

  const [{ data: todayRows }, { data: monthRows }] = await Promise.all([
    supabaseAdmin.from('workspace_ai_usage_daily').select('*').eq('workspace_id', workspaceId).eq('date', today),
    supabaseAdmin.from('workspace_ai_usage_daily').select('*').eq('workspace_id', workspaceId).gte('date', monthStart),
  ]);

  const sumBy = (rows, provider, field) =>
    (rows || []).filter(r => r.provider === provider).reduce((s, r) => s + (r[field] || 0), 0);

  return {
    today: {
      groq:  { calls: sumBy(todayRows, 'groq', 'call_count'), tokens: sumBy(todayRows, 'groq', 'total_tokens') },
      exa:   { calls: sumBy(todayRows, 'exa', 'call_count'), credits: sumBy(todayRows, 'exa', 'total_credits') },
      estimated_cost_cents: sumBy(todayRows, 'groq', 'estimated_cost_cents') + sumBy(todayRows, 'exa', 'estimated_cost_cents'),
    },
    this_month: {
      groq:  { calls: sumBy(monthRows, 'groq', 'call_count'), tokens: sumBy(monthRows, 'groq', 'total_tokens') },
      exa:   { calls: sumBy(monthRows, 'exa', 'call_count'), credits: sumBy(monthRows, 'exa', 'total_credits') },
      estimated_cost_cents: sumBy(monthRows, 'groq', 'estimated_cost_cents') + sumBy(monthRows, 'exa', 'estimated_cost_cents'),
    },
  };
};

export default {
  recordGroqUsage,
  recordExaUsage,
  checkWorkspaceExaUsage,
  getWorkspaceUsageSummary,
  EXA_WORKSPACE_DAILY_LIMITS,
  EXA_GLOBAL_DAILY_CAP_CALLS,
};
