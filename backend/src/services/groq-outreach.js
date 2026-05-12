// src/services/groq-outreach.js
// ============================================================
// OUTREACH LAYER — Message generation, opportunity scoring,
//                  performance summarization, and event prep
// ============================================================

import { parseTextResponse, parseJSONObject, validateAndFill } from '../utils/parser.js';
import { callGroq, PRO_MODEL }  from './groq-client.js';
import { SYSTEM_PROMPTS }       from './groq-prompts.js';

// ──────────────────────────────────────────
// OUTREACH MESSAGE GENERATION
// ──────────────────────────────────────────
export const generateOutreachMessage = async (user, opportunity, performanceProfile = null) => {
  const vp         = user.voice_profile || {};
  const wordTarget = performanceProfile?.best_message_length === 'short' ? 70 : 100;

  const prompt = `${SYSTEM_PROMPTS.MESSAGE_GENERATOR}

Write ONE cold outreach message. Return ONLY the message text — no subject line, no label, no explanation.

═══ FOUNDER CONTEXT ═══
Their product: ${user.product_description}
What makes them different: ${vp.unique_value_prop || 'not specified'}
Their best proof point: ${vp.best_proof_point || 'not specified'}
Their ideal customer: ${vp.target_customer_description || user.target_audience}
How they naturally talk: ${vp.voice_style || 'conversational'}
Their outreach persona: ${vp.outreach_persona || 'Direct and genuine'}
Their ICP trigger: ${vp.icp_trigger || 'not specified'}
Their main objection they face: ${vp.main_objection || 'not specified'}
Avoid sounding like: ${(vp.avoid_phrases || []).join(', ') || 'generic AI'}

═══ THE OPPORTUNITY ═══
Platform: ${opportunity.platform}
What this person said/posted: ${opportunity.target_context}

${performanceProfile?.learned_patterns ? `═══ WHAT WORKS FOR THIS FOUNDER ═══\n${performanceProfile.learned_patterns}` : ''}

Target ~${wordTarget} words. Sound like a real human, not a template.`;

  const fallback = `Saw your post about ${opportunity.target_context?.slice(0, 50) || 'this'}. I'm building something relevant — happy to share context. No pitch.`;

  try {
    const { content, tokens_in, tokens_out } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.85,
      maxTokens:   300,
      modelName:   PRO_MODEL
    });

    let result = parseTextResponse(content, fallback);
    if (result.length <= 20) result = fallback;

    // Post-generation avoid_phrases validation
    const avoidPhrases = vp.avoid_phrases || [];
    const violatedPhrases = avoidPhrases.filter(phrase =>
      phrase?.trim() && result.toLowerCase().includes(phrase.toLowerCase().trim())
    );

    if (violatedPhrases.length > 0) {
      console.warn(`[Groq] generateOutreachMessage: message contains ${violatedPhrases.length} avoided phrase(s): ${violatedPhrases.join(', ')} — regenerating`);
      const retryPrompt = `${prompt}

CRITICAL: The previous attempt contained these forbidden phrases — do NOT use them in any form: ${violatedPhrases.map(p => `"${p}"`).join(', ')}`;
      try {
        const { content: retryContent, tokens_in: rIn, tokens_out: rOut } = await callGroq({
          messages:    [{ role: 'user', content: retryPrompt }],
          temperature: 0.75,
          maxTokens:   300,
          modelName:   PRO_MODEL,
        });
        const retryResult = parseTextResponse(retryContent, result);
        if (retryResult.length > 20) {
          return {
            message:    retryResult,
            tokens_in:  (tokens_in  || 0) + (rIn  || 0),
            tokens_out: (tokens_out || 0) + (rOut || 0),
          };
        }
      } catch (retryErr) {
        console.warn('[Groq] avoid_phrases retry failed, using original:', retryErr.message);
      }
    }

    return {
      message:    result,
      tokens_in:  tokens_in  || 0,
      tokens_out: tokens_out || 0,
    };
  } catch (err) {
    console.error('[Groq] generateOutreachMessage FAILED:', err.message);
    return { message: fallback, tokens_in: 0, tokens_out: 0 };
  }
};

// ──────────────────────────────────────────
// OPPORTUNITY SCORING
// ──────────────────────────────────────────
export const scoreOpportunities = async (user, opportunities) => {
  if (!opportunities?.length) return opportunities;

  const vp = user.voice_profile || {};

  const prompt = `Score these opportunities for outreach fit. Return ONLY a JSON array.

FOUNDER:
Product: ${user.product_description}
ICP: ${vp.target_customer_description || user.target_audience}
ICP Trigger: ${vp.icp_trigger || 'not specified'}
Best proof point: ${vp.best_proof_point || 'not specified'}

SCORING RUBRIC (score each dimension 1–10):
- fit_score: How well does this person match the ICP? 
  Score 8–10 ONLY if the ICP trigger is clearly present.
  Score 4–6 if they match the audience but trigger is absent.
  Score 1–3 if it's a poor match.
- timing_score: Is this person expressing an active, urgent need RIGHT NOW?
  Score 8–10 if they're actively asking for help or announcing a relevant problem.
  Score 4–6 if there's passive relevance.
  Score 1–3 if timing is unclear or stale.
- intent_score: How receptive are they likely to be to outreach?
  Score 8–10 if they're publicly asking for solutions or recommendations.
  Score 4–6 if they're sharing a pain but not seeking help.
  Score 1–3 if they'd likely see outreach as spam.

OPPORTUNITIES (score each):
${opportunities.map((o, i) => `${i}. [${o.platform}] ${o.target_context?.slice(0, 200)}`).join('\n')}

Return ONLY: [{"index": 0, "fit_score": 7, "timing_score": 8, "intent_score": 6}, ...]`;

  try {
    const { content } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.2,
      maxTokens:   600,
      modelName:   PRO_MODEL,
    });
    const clean   = content.replace(/```json|```/g, '').trim();
    const scores  = JSON.parse(clean);
    return opportunities.map((o, i) => {
      const s = scores.find(x => x.index === i) || {};
      return {
        ...o,
        fit_score:    s.fit_score    || 5,
        timing_score: s.timing_score || 5,
        intent_score: s.intent_score || 5,
      };
    });
  } catch (err) {
    console.error('[Groq] scoreOpportunities FAILED:', err.message);
    return opportunities.map(o => ({ ...o, fit_score: 5, timing_score: 5, intent_score: 5 }));
  }
};

// ──────────────────────────────────────────
// MESSAGE STRENGTH EVALUATOR
// Returns a 0-100 quality score for probabilistic ghost revival.
// ──────────────────────────────────────────
export const evaluateMessageStrength = async (user, userMessage) => {
  const vp = user.voice_profile || {};

  const prompt = `Evaluate this cold outreach message on a scale of 0-100.

Founder's product: "${user.product_description}"
Their ideal customer: "${vp.target_customer_description || user.target_audience}"
Their main differentiator: "${vp.unique_value_prop || 'not specified'}"

The message:
"${userMessage}"

Score it on:
- Specificity: does it reference something real about the prospect's situation? (0-25)
- Value clarity: is it immediately obvious what benefit they'd get? (0-25)
- Tone: does it sound human and genuine, not templated? (0-25)
- Ask: is the call-to-action lightweight and easy to say yes to? (0-25)

Return ONLY: {"score": <0-100>, "strongest_element": "<one phrase from the message that's best>", "weakest_element": "<what most hurt the score>"}`;

  try {
    const { content } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.3,
      maxTokens:   150,
    });
    const clean  = content.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return {
      score:             Math.min(100, Math.max(0, parsed.score || 50)),
      strongest_element: parsed.strongest_element || null,
      weakest_element:   parsed.weakest_element || null,
    };
  } catch {
    return { score: 50, strongest_element: null, weakest_element: null };
  }
};

// ──────────────────────────────────────────
// PERFORMANCE PATTERN SUMMARIZATION
// ──────────────────────────────────────────
export const summarizePerformancePatterns = async (user, sentOpps, feedbackData) => {
  if (!sentOpps?.length || sentOpps.length < 5) return null;

  const positive = feedbackData.filter(f => f.outcome === 'positive').length;
  const total    = feedbackData.length;
  if (total === 0) return null;

  const platformStats = {}, styleStats = {}, lengthStats = {};

  for (const opp of sentOpps) {
    const fb         = feedbackData.find(f => f.opportunity_id === opp.id);
    if (!fb) continue;
    const isPositive = fb.outcome === 'positive' ? 1 : 0;

    if (!platformStats[opp.platform]) platformStats[opp.platform] = { sent: 0, positive: 0 };
    platformStats[opp.platform].sent++;
    platformStats[opp.platform].positive += isPositive;

    if (opp.message_style) {
      if (!styleStats[opp.message_style]) styleStats[opp.message_style] = { sent: 0, positive: 0 };
      styleStats[opp.message_style].sent++;
      styleStats[opp.message_style].positive += isPositive;
    }

    if (opp.message_length) {
      const bucket = opp.message_length < 60 ? 'short' : opp.message_length < 120 ? 'medium' : 'long';
      if (!lengthStats[bucket]) lengthStats[bucket] = { sent: 0, positive: 0 };
      lengthStats[bucket].sent++;
      lengthStats[bucket].positive += isPositive;
    }
  }

  const systemPrompt = `You are a battle-tested sales mentor analyzing outreach performance data. Be specific and data-driven.`;
  const userPrompt   = `Analyze this founder's outreach data and write a 2-sentence insight summary.

Overall: ${total} sent, ${positive} positive (${Math.round(positive / total * 100)}%)
By platform: ${JSON.stringify(platformStats)}
By style:    ${JSON.stringify(styleStats)}
By length:   ${JSON.stringify(lengthStats)}

Return ONLY the 2-sentence summary. No JSON. No preamble.`;

  try {
    const { content } = await callGroq({
      messages:    [{ role: 'user', content: userPrompt }],
      systemPrompt,
      temperature: 0.3,
      maxTokens:   200,
      modelName:   PRO_MODEL
    });
    return parseTextResponse(content, null);
  } catch (err) {
    console.error('[Groq] summarizePerformancePatterns FAILED:', err.message);
    return null;
  }
};

// ──────────────────────────────────────────
// EVENT / CALENDAR PREP
// ──────────────────────────────────────────
export const generateEventPrep = async (user, event) => {
  const vp = user.voice_profile || {};

  const prompt = `${SYSTEM_PROMPTS.SALES_COACH}

Prepare this founder for an upcoming business event.

FOUNDER: ${user.business_name} — ${user.product_description}
Their differentiator: ${vp.unique_value_prop || 'unique in their market'}
Their top proof point: ${vp.best_proof_point || 'growing customer base'}
Their main objection: ${vp.main_objection || 'not specified'}
Their objection reframe: ${vp.objection_reframe || 'focus on specific value'}

EVENT:
Title: ${event.title}
Type: ${event.event_type}
Date: ${event.event_date}
${event.attendee_name    ? `Person/Audience: ${event.attendee_name}` : ''}
${event.attendee_context ? `Context: ${event.attendee_context}`     : ''}
${event.notes            ? `Notes: ${event.notes}`                  : ''}

Return JSON with this structure:
{
  "talking_points": ["3-5 specific, punchy talking points — not generic"],
  "opening_line": "A strong, specific opening line for this exact event",
  "key_question_to_ask": "The ONE most valuable question to ask the other party",
  "anticipate_objection": "The most likely pushback and how to handle it",
  "pre_outreach": "A 2-sentence message to send BEFORE the event (if applicable)",
  "follow_up_template": "A natural follow-up message to send within 24h after"
}

Return ONLY valid JSON.`;

  const FALLBACK = {
    talking_points:      ['What you do and who you help', 'Your best customer result', 'Why now is the right time'],
    opening_line:        `I build ${user.product_description} — I work with ${user.target_audience}.`,
    key_question_to_ask: "What's the biggest challenge you're facing right now with this?",
    anticipate_objection:'They may ask about ROI — have a specific example ready.',
    pre_outreach:        `Looking forward to connecting at ${event.title}. I have something relevant to share.`,
    follow_up_template:  `Great meeting you at ${event.title}. As promised — here's that thing I mentioned. Worth a quick look?`
  };

  try {
    const { content } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.6,
      maxTokens:   800
    });
    const parsed = parseJSONObject(content, FALLBACK);
    return validateAndFill(parsed, FALLBACK);
  } catch (err) {
    console.error('[Groq] generateEventPrep FAILED:', err.message);
    return FALLBACK;
  }
};

// ──────────────────────────────────────────
// COMPETITOR CONTEXT GENERATOR (Groq fallback when Perplexity is unavailable)
// ──────────────────────────────────────────
export const generateCompetitorContext = async (competitor, productDescription) => {
  const prompt = `You are generating realistic competitor context for a sales training simulation.

The prospect's current tool: "${competitor}"
The product the founder is selling: "${productDescription}"

In 2-3 sentences from the prospect's perspective, describe:
1. What they like about ${competitor}
2. One specific reason that makes it hard to switch

Be realistic and specific. Sound like a real user of ${competitor}. Return only plain text.`;

  try {
    const { content } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.7,
      maxTokens:   150,
    });
    return parseTextResponse(content, `${competitor} has been working fine for our needs.`);
  } catch {
    return `We've been using ${competitor} for a while and the team is used to it.`;
  }
};
