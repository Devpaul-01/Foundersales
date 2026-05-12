// src/jobs/conversationAnalysisJob.js
// ============================================================
// CONVERSATION AUTOPSY ENGINE — WORKSPACE REFACTOR
//
// CHANGES:
//  - runConversationAnalysis now accepts workspaceId param
//  - All inserts now include workspace_id
//  - Reads product context from workspace_profiles (not users)
//  - updateObjectionTracker now passes workspace_id to RPC
// ============================================================

import supabaseAdmin from '../config/supabase.js';
import { callWithFallback } from '../services/multiProvider.js';
import { recordTokenUsage } from '../services/tokenTracker.js';
import { PRO_MODEL } from '../services/groq.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ──────────────────────────────────────────
// MAIN ENTRY POINT
// feedbackId: UUID of the newly created feedback record
// userId:     UUID of the user
// workspaceId: UUID of the workspace (NEW)
// ──────────────────────────────────────────
export const runConversationAnalysis = async (feedbackId, userId, workspaceId) => {
  try {
    // Load feedback + joined opportunity
    const { data: fb, error: fbErr } = await supabaseAdmin
      .from('feedback')
      .select(`id, outcome, outcome_note, opportunities(id, prepared_message, platform, target_context, target_name, fit_score, timing_score, intent_score)`)
      .eq('id', feedbackId)
      .single();

    if (fbErr || !fb) { console.warn(`[ConvAnalysis] Feedback ${feedbackId} not found`); return; }

    const message = fb.opportunities?.prepared_message;
    if (!message?.trim()) { console.warn(`[ConvAnalysis] No message for feedback ${feedbackId} — skipping`); return; }

    // Avoid re-analyzing the same feedback
    const { data: existing } = await supabaseAdmin.from('conversation_analyses')
      .select('id').eq('feedback_id', feedbackId).maybeSingle();
    if (existing) { console.log(`[ConvAnalysis] Already analyzed feedback ${feedbackId} — skipping`); return; }

    // WORKSPACE REFACTOR: read context from workspace_profiles
    let userCtx = {};
    if (workspaceId) {
      const { data: wp } = await supabaseAdmin.from('workspace_profiles')
        .select('product_description, target_audience, voice_profile, archetype, industry')
        .eq('workspace_id', workspaceId).eq('user_id', userId).single();
      userCtx = wp || {};
    } else {
      // Fallback: try to find active workspace
      const { data: userRow } = await supabaseAdmin.from('users').select('active_workspace_id').eq('id', userId).single();
      if (userRow?.active_workspace_id) {
        const { data: wp } = await supabaseAdmin.from('workspace_profiles')
          .select('product_description, target_audience, voice_profile, archetype, industry')
          .eq('workspace_id', userRow.active_workspace_id).eq('user_id', userId).single();
        userCtx = wp || {};
        workspaceId = userRow.active_workspace_id;
      }
    }

    console.log(`[ConvAnalysis] Analyzing message for feedback ${feedbackId} (outcome: ${fb.outcome})`);

    const prompt = buildAnalysisPrompt(fb, userCtx);

    const { content, tokens_in, tokens_out } = await callWithFallback({
      systemPrompt: `You are an elite sales communication analyst. You score outreach messages with surgical precision. Return ONLY valid JSON. Never add markdown fences or explanatory text outside the JSON.`,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.15, maxTokens: 1400, modelName: PRO_MODEL,
    });

    await recordTokenUsage(userId, 'groq', tokens_in, tokens_out);

    let analysis;
    try {
      const clean = content.replace(/```json|```/g, '').trim();
      analysis = JSON.parse(clean);
    } catch (parseErr) {
      console.error(`[ConvAnalysis] JSON parse failed for feedback ${feedbackId}:`, parseErr.message);
      return;
    }

    if (analysis.hook_score == null || analysis.clarity_score == null) {
      console.warn(`[ConvAnalysis] Incomplete analysis for feedback ${feedbackId} — not stored`);
      return;
    }

    const compositeScore = ((analysis.hook_score || 0) + (analysis.clarity_score || 0) + (analysis.value_prop_score || 0) + (analysis.personalization_score || 0) + (analysis.cta_score || 0) + (analysis.tone_score || 0)) / 6;

    const { error: insertErr } = await supabaseAdmin.from('conversation_analyses').insert({
      workspace_id:           workspaceId,      // WORKSPACE SCOPING
      user_id:                userId,
      opportunity_id:         fb.opportunities?.id || null,
      feedback_id:            fb.id,
      message_text:           message,
      outcome:                fb.outcome,
      outcome_note:           fb.outcome_note || null,
      platform:               fb.opportunities?.platform || null,
      hook_score:             clamp(analysis.hook_score, 0, 10),
      clarity_score:          clamp(analysis.clarity_score, 0, 10),
      value_prop_score:       clamp(analysis.value_prop_score, 0, 10),
      personalization_score:  clamp(analysis.personalization_score, 0, 10),
      cta_score:              clamp(analysis.cta_score, 0, 10),
      tone_score:             clamp(analysis.tone_score, 0, 10),
      composite_score:        parseFloat(compositeScore.toFixed(2)),
      word_count:             analysis.word_count || countWords(message),
      self_referential_ratio: clamp(analysis.self_referential_ratio || 0, 0, 1),
      has_social_proof:       !!analysis.has_social_proof,
      has_specific_ask:       !!analysis.has_specific_ask,
      failure_categories:     Array.isArray(analysis.failure_categories) ? analysis.failure_categories : [],
      success_signals:        Array.isArray(analysis.success_signals) ? analysis.success_signals : [],
      analysis_text:          analysis.analysis_text || null,
      improvement_suggestions: analysis.improvement_suggestions || [],
      rewritten_message:      analysis.rewritten_message || null,
      line_annotations:       Array.isArray(analysis.line_annotations) ? analysis.line_annotations : [],
      analysis_model:         'groq_pro',
    });

    if (insertErr) { console.error(`[ConvAnalysis] Insert failed for feedback ${feedbackId}:`, insertErr.message); return; }

    console.log(`[ConvAnalysis] ✓ Stored analysis for feedback ${feedbackId} | composite: ${compositeScore.toFixed(1)}/10`);

    if (fb.outcome === 'negative' && fb.outcome_note && workspaceId) {
      await updateObjectionTracker(userId, workspaceId, fb.outcome_note, analysis).catch(err =>
        console.warn(`[ConvAnalysis] Objection tracker update failed:`, err.message)
      );
    }
  } catch (err) {
    console.error(`[ConvAnalysis] Fatal error for feedback ${feedbackId}:`, err.message);
  }
};

const buildAnalysisPrompt = (fb, user) => {
  const message     = fb.opportunities?.prepared_message || '';
  const platform    = fb.opportunities?.platform || 'unknown';
  const prospect    = fb.opportunities?.target_context?.slice(0, 400) || 'unknown';
  const outcome     = fb.outcome;
  const outcomeNote = fb.outcome_note || 'no additional notes';
  const wordCount    = countWords(message);
  const selfRefCount = countSelfReferentialSentences(message);
  const totalSentences = message.split(/[.!?]+/).filter(s => s.trim().length > 3).length;
  const selfRefRatio    = totalSentences > 0 ? +(selfRefCount / totalSentences).toFixed(3) : 0;

  return `Analyze this outreach message sent by a seller. Be specific — quote phrases from the message when explaining scores.
SELLER CONTEXT:
Product/Service: ${user?.product_description || 'not specified'}
Target customers: ${user?.target_audience || 'not specified'}
Archetype: ${user?.archetype || 'seller'}
PLATFORM: ${platform}
PROSPECT CONTEXT: ${prospect}
OUTREACH MESSAGE (${wordCount} words):
"${message}"
OUTCOME: ${outcome.toUpperCase()} — "${outcomeNote}"
Pre-computed: Word count: ${wordCount} | Self-referential ratio: ${selfRefRatio}
Score each dimension 0–10:
hook_score: Does the FIRST SENTENCE make the reader want to continue?
clarity_score: Is the core offer understandable in one read?
value_prop_score: Does it communicate SPECIFIC value to THIS prospect?
personalization_score: Is this clearly written for THIS specific person?
cta_score: Is there a single clear, low-friction ask?
tone_score: Does the tone match the platform and prospect?
Return ONLY this JSON object:
{"hook_score":0-10,"clarity_score":0-10,"value_prop_score":0-10,"personalization_score":0-10,"cta_score":0-10,"tone_score":0-10,"word_count":${wordCount},"self_referential_ratio":${selfRefRatio},"has_social_proof":true_or_false,"has_specific_ask":true_or_false,"failure_categories":[],"success_signals":[],"analysis_text":"2-3 sentence diagnosis","improvement_suggestions":[{"priority":1,"dimension":"...","suggestion":"...","example":"..."}],"rewritten_message":"...","line_annotations":[]}`;
};

// WORKSPACE REFACTOR: passes workspace_id to RPC
const updateObjectionTracker = async (userId, workspaceId, outcomeNote, analysis) => {
  const objectionType   = classifyObjection(outcomeNote);
  const objectionPhrase = outcomeNote?.slice(0, 300) || '';

  const { error } = await supabaseAdmin.rpc('upsert_objection_count', {
    p_workspace_id:   workspaceId,
    p_user_id:        userId,
    p_objection_type: objectionType,
    p_phrase:         objectionPhrase,
  });

  if (error) {
    console.warn('[ConvAnalysis] RPC upsert_objection_count failed, using fallback:', error.message);
    const { data: existing } = await supabaseAdmin.from('objection_tracker')
      .select('id, occurrence_count').eq('workspace_id', workspaceId).eq('user_id', userId).eq('objection_type', objectionType).maybeSingle();
    if (existing) {
      await supabaseAdmin.from('objection_tracker').update({ occurrence_count: existing.occurrence_count + 1, last_seen_at: new Date().toISOString() }).eq('id', existing.id);
    } else {
      await supabaseAdmin.from('objection_tracker').insert({ workspace_id: workspaceId, user_id: userId, objection_type: objectionType, objection_phrase: objectionPhrase, occurrence_count: 1 });
    }
  }
};

const clamp = (val, min, max) => Math.min(max, Math.max(min, val ?? min));
const countWords = (text) => text?.trim() ? text.trim().split(/\s+/).length : 0;
const countSelfReferentialSentences = (text) => {
  if (!text?.trim()) return 0;
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 3);
  return sentences.filter(s => /^\s*(i |we |our |my )/i.test(s)).length;
};
const classifyObjection = (note) => {
  if (!note) return 'other';
  const n = note.toLowerCase();
  if (/ghost|no response|no reply|didn't respond|never heard|ignored/i.test(n)) return 'ghost';
  if (/price|expensive|cost|budget|afford|spend/i.test(n))                       return 'price';
  if (/timing|later|busy|not (right|a good) time|too soon/i.test(n))             return 'timing';
  if (/trust|prove|evidence|skeptic|doubt|not sure/i.test(n))                    return 'trust';
  if (/competitor|already using|current (solution|vendor)|happy with/i.test(n))  return 'competition';
  if (/not (the right|a) fit|different (audience|market)|not what/i.test(n))     return 'fit';
  return 'other';
};

export default { runConversationAnalysis };