// src/services/tokenTracker.js
// ============================================================
// TOKEN-BASED USAGE TRACKING
// Tracks actual token consumption across all AI services.
// Grok is free — tracked for analytics only, no limits enforced.
// Perplexity is paid — limits enforced strictly.
//
// FIX C-05: Replaced read-modify-write pattern (race condition under
// concurrent AI calls) with atomic increment_token_usage RPC.
//
// FIX MONTHLY-RACE: updateMonthlyRollup previously did:
//   SELECT → compute new values → UPDATE
// This is a classic read-modify-write race condition. Two concurrent
// AI calls would both read the same value and each increment from it,
// causing one increment to be lost. Fixed by using an atomic
// increment_monthly_token_usage RPC (INSERT ... ON CONFLICT DO UPDATE
// SET col = col + $1 at the Postgres level).
// ============================================================

import supabaseAdmin from '../config/supabase.js';
import {
  PERPLEXITY_TOKEN_LIMITS,
  PERPLEXITY_GLOBAL_DAILY_CAP_TOKENS,
  COST_PER_1K_TOKENS
} from '../config/constants.js';

/**
 * Record token usage after an AI call.
 * Uses atomic DB-level increment to prevent race conditions.
 *
 * @param {string} userId
 * @param {'grok'|'perplexity'|string} model
 * @param {number} tokensIn
 * @param {number} tokensOut
 */
export const recordTokenUsage = async (userId, model, tokensIn = 0, tokensOut = 0) => {
  const today = new Date().toISOString().split('T')[0];
  const totalTokens = tokensIn + tokensOut;

  const costRate  = model === 'perplexity' ? COST_PER_1K_TOKENS.perplexity_sonar_pro : 0;
  const costCents = Math.ceil((totalTokens / 1000) * costRate * 100);

  try {
    // ── Daily tracking (atomic RPC) ────────────────────────────────────────
    const { error: rpcError } = await supabaseAdmin.rpc('increment_token_usage', {
      p_user_id:    userId,
      p_date:       today,
      p_model:      model,
      p_tokens_in:  tokensIn,
      p_tokens_out: tokensOut,
      p_cost_cents: costCents
    });

    if (rpcError) {
      console.warn('[TokenTracker] Daily RPC unavailable, using upsert fallback:', rpcError.message);
      await atomicUpsertFallback(userId, today, model, tokensIn, tokensOut, totalTokens, costCents);
    }

    // ── Monthly rollup (async, non-blocking) ──────────────────────────────
    // FIX MONTHLY-RACE: now uses atomic RPC instead of read-modify-write
    const month = today.slice(0, 8) + '01';
    updateMonthlyRollupAtomic(userId, model, totalTokens, costCents, month).catch(err =>
      console.warn('[TokenTracker] Monthly rollup failed:', err.message)
    );

  } catch (err) {
    // Never let tracking errors break the main flow
    console.warn('[TokenTracker] Record failed:', err.message);
  }
};

/**
 * Atomic fallback for daily tracking when the RPC isn't available.
 * Still approximate for counters (no true col + N without RPC),
 * but acceptable for free Grok analytics.
 */
const atomicUpsertFallback = async (userId, today, model, tokensIn, tokensOut, totalTokens, costCents) => {
  if (model === 'grok' || !['grok', 'perplexity'].includes(model)) {
    await supabaseAdmin.from('usage_tracking').upsert({
      user_id:         userId,
      date:            today,
      grok_calls:      1,
      grok_tokens:     totalTokens,
      grok_tokens_in:  tokensIn,
      grok_tokens_out: tokensOut
    }, { onConflict: 'user_id,date', ignoreDuplicates: false });
  } else {
    await supabaseAdmin.from('usage_tracking').upsert({
      user_id:               userId,
      date:                  today,
      perplexity_calls:      1,
      perplexity_tokens:     totalTokens,
      perplexity_tokens_in:  tokensIn,
      perplexity_tokens_out: tokensOut,
      estimated_cost_cents:  costCents
    }, { onConflict: 'user_id,date', ignoreDuplicates: false });
  }
};

/**
 * FIX MONTHLY-RACE: Atomic monthly rollup using RPC.
 * The RPC does: INSERT ... ON CONFLICT DO UPDATE SET col = col + $delta
 * This is fully atomic at the Postgres level — no race condition possible.
 *
 * Falls back to upsert-from-scratch if RPC not available yet.
 */
const updateMonthlyRollupAtomic = async (userId, model, tokens, costCents, month) => {
  const grokDelta       = model === 'grok'       ? tokens : 0;
  const perplexityDelta = model === 'perplexity' ? tokens : 0;

  // Try atomic RPC first
  const { error: rpcError } = await supabaseAdmin.rpc('increment_monthly_token_usage', {
    p_user_id:               userId,
    p_month:                 month,
    p_grok_tokens:           grokDelta,
    p_perplexity_tokens:     perplexityDelta,
    p_cost_cents:            costCents
  });

  if (!rpcError) return; // Success — done

  // RPC not deployed yet — fall back to safe insert (won't double-count on
  // first insert, but concurrent second calls on the same month will be
  // slightly off; acceptable until the RPC is deployed)
  console.warn('[TokenTracker] Monthly RPC unavailable, using insert fallback:', rpcError.message);

  const { data: existing } = await supabaseAdmin
    .from('monthly_token_usage')
    .select('id, grok_tokens_total, perplexity_tokens_total, total_cost_cents, token_allowance')
    .eq('user_id', userId)
    .eq('month', month)
    .single();

  if (existing) {
    const newPerplexityTokens = (existing.perplexity_tokens_total || 0) + perplexityDelta;
    await supabaseAdmin
      .from('monthly_token_usage')
      .update({
        grok_tokens_total:       (existing.grok_tokens_total || 0) + grokDelta,
        perplexity_tokens_total: newPerplexityTokens,
        total_cost_cents:        (existing.total_cost_cents || 0) + costCents,
        allowance_used_pct:      Math.min(100, Math.round(
          newPerplexityTokens / (existing.token_allowance || 50000) * 100
        ))
      })
      .eq('id', existing.id);
  } else {
    await supabaseAdmin
      .from('monthly_token_usage')
      .insert({
        user_id:                 userId,
        month,
        grok_tokens_total:       grokDelta,
        perplexity_tokens_total: perplexityDelta,
        total_cost_cents:        costCents
      });
  }
};

/**
 * Check if user has Perplexity tokens remaining today.
 * Grok always returns allowed: true (no limits).
 */
export const checkPerplexityAllowance = async (userId, tier = 'free') => {
  const today      = new Date().toISOString().split('T')[0];
  const dailyLimit = PERPLEXITY_TOKEN_LIMITS[tier] || PERPLEXITY_TOKEN_LIMITS.free;

  // Check global cap first
  const { data: globalToday } = await supabaseAdmin
    .from('global_usage')
    .select('perplexity_calls')
    .eq('date', today)
    .single();

  if ((globalToday?.perplexity_calls || 0) * 2000 >= PERPLEXITY_GLOBAL_DAILY_CAP_TOKENS) {
    return { allowed: false, reason: 'global_cap', used: 0, limit: dailyLimit, pct_used: 100 };
  }

  const { data: usage } = await supabaseAdmin
    .from('usage_tracking')
    .select('perplexity_tokens')
    .eq('user_id', userId)
    .eq('date', today)
    .single();

  const used     = usage?.perplexity_tokens || 0;
  const pct_used = Math.round((used / dailyLimit) * 100);

  return {
    allowed:   used < dailyLimit,
    reason:    used >= dailyLimit ? 'daily_limit' : null,
    used,
    limit:     dailyLimit,
    pct_used,
    remaining: Math.max(0, dailyLimit - used)
  };
};

/**
 * Get token usage summary for user dashboard.
 */
export const getUsageSummary = async (userId, tier = 'free') => {
  const today = new Date().toISOString().split('T')[0];
  const month = today.slice(0, 8) + '01';

  const [{ data: daily }, { data: monthly }] = await Promise.all([
    supabaseAdmin.from('usage_tracking').select('*').eq('user_id', userId).eq('date', today).single(),
    supabaseAdmin.from('monthly_token_usage').select('*').eq('user_id', userId).eq('month', month).single()
  ]);

  const perplexityLimit = PERPLEXITY_TOKEN_LIMITS[tier] || PERPLEXITY_TOKEN_LIMITS.free;
  const perplexityUsed  = daily?.perplexity_tokens || 0;
  const grokUsed        = daily?.grok_tokens       || 0;

  return {
    today: {
      perplexity: {
        tokens_used: perplexityUsed,
        limit:       perplexityLimit,
        pct_used:    Math.round((perplexityUsed / perplexityLimit) * 100),
        remaining:   Math.max(0, perplexityLimit - perplexityUsed),
        resets_in:   getSecondsUntilMidnight()
      },
      grok: {
        tokens_used: grokUsed,
        limit:       'unlimited',
        note:        'Free model — unlimited use'
      },
      estimated_cost_cents: daily?.estimated_cost_cents || 0
    },
    this_month: {
      perplexity_tokens: monthly?.perplexity_tokens_total || 0,
      grok_tokens:       monthly?.grok_tokens_total       || 0,
      total_cost_cents:  monthly?.total_cost_cents        || 0,
      allowance_used_pct: monthly?.allowance_used_pct     || 0
    }
  };
};

const getSecondsUntilMidnight = () => {
  const now      = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return Math.floor((midnight - now) / 1000);
};

export default { recordTokenUsage, checkPerplexityAllowance, getUsageSummary };
