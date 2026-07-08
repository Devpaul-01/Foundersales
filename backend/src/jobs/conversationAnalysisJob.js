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
import { callWithFallbackGroq } from '../services/multiProvider.js';

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

    const { content } = await callWithFallbackGroq({
      systemPrompt: `You are an elite sales communication analyst. You score outreach messages with surgical precision. Return ONLY valid JSON. Never add markdown fences or explanatory text outside the JSON.`,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.15, maxTokens: 1400,
      tier: 'quality', workspaceId, userId, sourceJob: 'conversation_analysis',
    });

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
VOICE PROFILE : ${user.voice_profile}
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

  const patterns = [
    {
      type: 'ghost',
      positive: [
        /\b(no (response|reply|answer|word|callback))\b/i,
        /\b(didn'?t|did not|never|hasn'?t|has not) (respond|reply|answer|get back|hear back)\b/i,
        /\b(ghosted?|ignored?|went (silent|dark|cold)|stopped (responding|replying))\b/i,
        /\b(left on (read|seen)|no follow.?up|fell (off|through))\b/i,
      ],
      negative: [],
    },
    {
      type: 'price',
      positive: [
        /\b(too |very )?(expensive|pricey|costly|overpriced)\b/i,
        /\b(can'?t|cannot|won'?t) (afford|justify|spend)\b/i,
        /\b(out of|over|beyond) (my |our |the )?(budget|price range)\b/i,
        /\b(price|cost|fee|rate|pricing) (is |seems |feels )?(too )?(high|steep|much)\b/i,
        /\bno (money|budget|funds)\b/i,
      ],
      negative: [
        /\bprice (is(n'?t| not)|was(n'?t| not)) (the |an? )?(issue|concern|problem|factor)\b/i,
        /\bnot (about|related to) (the )?price\b/i,
      ],
    },
    {
      type: 'timing',
      positive: [
        /\b(not|bad) (the right |a good )?(time|timing|moment)\b/i,
        /\b(too )?(busy|hectic|overwhelmed) (right now|at the moment|currently|now)\b/i,
        /\b(come back|reach out|talk|revisit|follow.?up) (in |after |later|next) (a few |[0-9]+ )?(weeks?|months?|quarters?|years?)\b/i,
        /\b(need(s)? more time|not ready|on hold|paused?|deferred?)\b/i,
        /\b(too soon|too early|not (the right|a good) time)\b/i,
      ],
      negative: [
        /\btiming (is |looks |seems )?(fine|good|ok|okay|perfect)\b/i,
      ],
    },
    {
      type: 'trust',
      positive: [
        /\b(need(s)?|want(s)?|require(s)?) (more )?(proof|evidence|case studies?|references?|testimonials?|validation)\b/i,
        /\b(skepti(c|cal)|doubtful?|not (sure|convinced|confident)|uncertain)\b/i,
        /\b(how do (i|we) know|prove (it|this)|show (me|us)|can you (verify|demonstrate|prove))\b/i,
        /\b(too good to be true|sounds? (too|like) (good|a pitch))\b/i,
      ],
      negative: [
        /\b(trust(s)?|believe(s)?|confident) (you|in you|it|this)\b/i,
      ],
    },
    {
      type: 'competition',
      positive: [
        /\b(going with|chose|chosen|picked|using|already (have|using|signed|implemented))\b/i,
        /\b(hubspot|salesforce|monday|asana|zendesk|intercom|pipedrive|zoho|freshdesk|notion|clickup|jira)\b/i,
        /\b(happy with|sticking with) (our |the )?(current|existing|another|other)\b/i,
        /\b(competitor|another (vendor|provider|solution|tool|platform))\b/i,
      ],
      negative: [
        /\b(evaluating|comparing|considering) (multiple|several|other)? ?(options|solutions|vendors)\b/i,
      ],
    },
    {
      type: 'fit',
      positive: [
        /\bnot (the right|a( good)?) fit\b/i,
        /\b(different (audience|market|use case|industry|niche))\b/i,
        /\b(not what (we|i|they) (need|want|use|were looking for))\b/i,
        /\b(doesn'?t|does not|won'?t) (work|apply|integrate|fit) (for|with) (us|me|our)\b/i,
        /\b(too (basic|advanced|complex|simple|niche|broad) for (us|me|our))\b/i,
      ],
      negative: [
        /\b(good fit|right fit|perfect fit|works well)\b/i,
      ],
    },
  ];

  // Score each type
  const scores = {};
  for (const p of patterns) {
    let score = 0;
    for (const rx of p.positive) if (rx.test(n)) score += 1;
    for (const rx of p.negative) if (rx.test(n)) score -= 2;
    if (score > 0) scores[p.type] = score;
  }

  if (!Object.keys(scores).length) return 'other';

  // Return the highest scoring type
  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
};

export default { runConversationAnalysis };