// src/services/groq-session.js
// ============================================================
// SESSION ANALYSIS LAYER — Post-session debrief, multi-axis scoring,
//                          adaptive curriculum, playbook, and retry diff
// ============================================================

import { callGroq, PRO_MODEL } from './groq-client.js';

// ──────────────────────────────────────────
// SESSION DEBRIEF — V1
// Structured feedback on a completed practice session.
// ──────────────────────────────────────────
export const generateSessionDebrief = async (user, messageHistory, scenarioType, difficulty = 'standard') => {
  const vp = user.voice_profile || {};

  const transcript = messageHistory
    .filter(m => m.role !== 'system')
    .map(m => `${m.role === 'user' ? 'Founder' : 'Prospect'}: ${m.content}`)
    .join('\n');

  const outcomeContext = {
    interested:      'The prospect engaged positively.',
    polite_decline:  'The prospect politely declined.',
    ghost:           'The prospect never replied (ghosted).',
    skeptical:       'The prospect was skeptical throughout.',
    price_objection: 'The prospect raised a pricing concern.',
    not_right_time:  'The prospect said timing was off.',
  };

  const prompt = `You are a brutally honest but empathetic sales coach reviewing a practice session.

FOUNDER'S CONTEXT:
Product: ${user.product_description}
ICP: ${vp.target_customer_description || user.target_audience || 'not specified'}
Differentiator: ${vp.unique_value_prop || 'not specified'}
Main objection they face: ${vp.main_objection || 'not specified'}

SCENARIO: ${scenarioType} (${outcomeContext[scenarioType] || 'Completed session.'})
DIFFICULTY: ${difficulty}

FULL TRANSCRIPT:
${transcript || '(No messages exchanged)'}

Provide a structured debrief. Be specific — quote their exact words when relevant.

Return ONLY this JSON:
{
  "strength": "One thing they did well — quote the specific phrase or approach that worked. 1 sentence.",
  "improvement": "One concrete thing to do differently next time. Be specific to their ICP and product. 1-2 sentences.",
  "coachable_moment": "The single most important insight from this session. Could be about their message, their mindset, or a pattern. 1 sentence — make it stick.",
  "message_score": <integer 1-10>,
  "would_real_prospect_engage": <true|false>
}`;

  const FALLBACK = {
    strength:                   'You completed the session — that\'s the starting point. Every rep builds the pattern.',
    improvement:                'Next time, try opening with a direct reference to something specific from their post before mentioning your product.',
    coachable_moment:           'The founders who get replies are the ones who sound like they actually read what the prospect wrote.',
    message_score:              5,
    would_real_prospect_engage: false,
  };

  try {
    const { content } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.5,
      maxTokens:   400,
      modelName:   PRO_MODEL
    });
    const clean  = content.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    if (!parsed.strength || !parsed.improvement) return FALLBACK;
    return { ...FALLBACK, ...parsed };
  } catch (err) {
    console.error('[Groq] generateSessionDebrief FAILED:', err.message);
    return FALLBACK;
  }
};

// ──────────────────────────────────────────
// SESSION DEBRIEF — V3
// Adds monologue_insights using internal monologues from session
// ──────────────────────────────────────────
export const generateSessionDebriefV3 = async (
  user,
  messages,
  scenarioType,
  difficulty = 'standard',
  internalMonologues = []
) => {
  const vp = user.voice_profile || {};

  const founderMessages = messages.filter(m => m.role === 'user');
  const prospectMsgs    = messages.filter(m => m.role === 'assistant');

  if (founderMessages.length === 0) {
    return {
      strength:                'Not enough data.',
      improvement:             'Send at least one message to get feedback.',
      coachable_moment:        '',
      example_rewrite:         '',
      message_score:           0,
      would_real_prospect_engage: false,
      monologue_insights:      [],
    };
  }

  const transcript = messages
    .filter(m => m.role !== 'system')
    .map(m => `${m.role === 'user' ? 'Founder' : 'Prospect'}: ${m.content}`)
    .join('\n');

  const monologueContext = internalMonologues.length > 0
    ? `\nINTERNAL MONOLOGUE INSIGHTS:\nThe following are the buyer's hidden thoughts at key moments. Use these to identify the exact moments where trust was built or lost.\n${
        internalMonologues.slice(0, 5).map((m, i) => `Exchange ${i + 1}: "${m.thought}" (founder said: "${m.founder_summary}")`).join('\n')
      }`
    : '';

  const prompt = `You are a brutally honest but empathetic sales coach reviewing a practice session.

Product: "${user.product_description}"
Audience: "${user.target_audience || vp.target_customer_description || 'not specified'}"
Scenario: ${scenarioType} | Difficulty: ${difficulty}

Full transcript:
${transcript}
${monologueContext}

Evaluate the founder's messages.

Return ONLY this JSON:
{
  "strength": "1-2 sentences: what specifically worked (quote from message if possible)",
  "improvement": "1-2 sentences: the single most important thing to fix",
  "coachable_moment": "the key insight from this session in one sentence",
  "example_rewrite": "a concrete rewrite of the weakest message",
  "message_score": number_0_to_10,
  "would_real_prospect_engage": true_or_false,
  "monologue_insights": [
    {
      "moment": exchange_number,
      "founder_message_summary": "brief description of what founder said",
      "buyer_thought": "the actual internal monologue text",
      "coaching_takeaway": "one sentence: what this reveals and what to do differently"
    }
  ]
}`;

  const FALLBACK = {
    strength:                'You sent a message — that\'s the most important step.',
    improvement:             'Try opening with a specific reference to the prospect\'s situation before mentioning your product.',
    coachable_moment:        'The founders who get replies are the ones who sound like they actually read what the prospect wrote.',
    example_rewrite:         '',
    message_score:           5,
    would_real_prospect_engage: false,
    monologue_insights:      [],
  };

  try {
    const { content } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.5,
      maxTokens:   600,
      modelName:   PRO_MODEL,
    });
    const clean  = content.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    if (!parsed.strength || !parsed.improvement) return FALLBACK;
    return { ...FALLBACK, ...parsed, monologue_insights: parsed.monologue_insights || [] };
  } catch (err) {
    console.error('[Groq] generateSessionDebriefV3 FAILED:', err.message);
    return FALLBACK;
  }
};

// ──────────────────────────────────────────
// COACHING ANNOTATIONS
// Background job: called after session completes (5s delay).
// Returns timestamped annotations with word highlights.
// ──────────────────────────────────────────
export const generateCoachingAnnotations = async (user, messages, stateHistory = [], buyerProfile = {}) => {
  const vp = user.voice_profile || {};

  const founderMessages = messages.filter(m => m.role === 'user');
  if (founderMessages.length === 0) return [];

  const sessionStart = messages[0] ? new Date(messages[0].created_at).getTime() : Date.now();

  const transcript = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      id:      m.id,
      role:    m.role,
      content: m.content,
      seconds: Math.round((new Date(m.created_at).getTime() - sessionStart) / 1000),
    }));

  const stateHistoryContext = stateHistory.length > 0
    ? `Buyer state changes during session:\n${JSON.stringify(stateHistory.slice(0, 30), null, 1)}`
    : '';

  const prompt = `You are generating coaching annotations for a completed sales practice session.

Buyer: ${buyerProfile.name || 'the prospect'}, ${buyerProfile.role || 'decision maker'}
Buyer pain: ${buyerProfile.main_pain || 'not specified'}
Founder sells: "${user.product_description}"
ICP: "${vp.target_customer_description || user.target_audience || 'not specified'}"

Full conversation:
${transcript.map(m => `[${m.seconds}s] [${m.role}] [id:${m.id}]: ${m.content}`).join('\n')}

${stateHistoryContext}

For each FOUNDER message that deserves coaching, generate an annotation.
Only annotate when it adds real value. Skip unremarkable messages.

Prioritize annotating:
- Missed discovery questions (pitching before diagnosing)  → severity: critical
- Vague value claims with no metrics or specifics          → severity: warning
- Price introduced before trust was established           → severity: critical
- Messages over 80 words (too long)                       → severity: warning
- No question / weak CTA                                  → severity: warning
- Filler language ("basically," "kind of," "you guys")    → severity: warning
- Strong discovery question asked                         → severity: positive
- Specific metric or outcome cited                        → severity: positive
- Objection handled well                                  → severity: positive

Return ONLY a JSON array. Each item:
{
  "message_id": "the id string from [id:xxx]",
  "timestamp_seconds": number,
  "severity": "critical|warning|positive",
  "type": "missed_discovery|weak_value|price_too_early|vague_claim|filler_language|no_cta|strong_discovery|specific_metric|good_objection_handle",
  "issue": "one sentence describing what happened",
  "better_approach": "one sentence describing what to do instead",
  "example_rewrite": "concrete rewrite of the actual message",
  "word_highlights": [
    {"phrase": "exact phrase from the message", "issue": "why it's weak", "type": "filler|vague|informal|overlong|strong"}
  ],
  "interest_delta_caused": estimated_number
}

Only return the JSON array. No explanation, no markdown.`;

  try {
    const { content } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.35,
      maxTokens:   2500,
      modelName:   PRO_MODEL,
    });
    const clean  = content.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('[Groq] generateCoachingAnnotations FAILED:', err.message);
    return [];
  }
};

// ──────────────────────────────────────────
// MULTI-AXIS SKILL SCORING — V1 (6 axes)
// Background job: 2s delay after session completes.
// ──────────────────────────────────────────
export const generateMultiAxisScores = async (user, messages, buyerProfile = {}) => {
  const vp = user.voice_profile || {};

  const founderMessages = messages.filter(m => m.role === 'user');
  if (founderMessages.length === 0) {
    return {
      session_score: 0,
      axes: { clarity: 0, value: 0, discovery: 0, objection_handling: 0, brevity: 0, cta_strength: 0 },
      weakest_axis: 'discovery',
      strongest_axis: 'clarity',
      one_line_verdict: 'No messages to score.'
    };
  }

  const fullConversation = messages
    .filter(m => m.role !== 'system')
    .map(m => `${m.role === 'user' ? 'Founder' : 'Prospect'}: ${m.content}`)
    .join('\n');

  const prompt = `Score this completed sales practice session across 6 axes.

Product being sold: "${user.product_description}"
Target audience: "${user.target_audience || vp.target_customer_description || 'not specified'}"
Buyer profile: ${JSON.stringify(buyerProfile)}

Full conversation:
${fullConversation}

Score each axis 0–100 based on the ENTIRE conversation:
- clarity: Were messages easy to understand in one read?
- value: Were specific outcomes or metrics communicated?
- discovery: Did the founder ask diagnostic questions before pitching?
- objection_handling: Were pushbacks addressed thoughtfully with specifics?
- brevity: Were messages appropriately concise (not over-explained)?
- cta_strength: Did messages end with clear next steps or questions?

Scoring notes:
- discovery is the most commonly weak axis — score it critically
- brevity: >80 words per message = significant deduction
- cta_strength: score 0 if the founder never asked a question

Return ONLY this JSON:
{
  "session_score": weighted_average_0_to_100,
  "axes": {
    "clarity": 0-100,
    "value": 0-100,
    "discovery": 0-100,
    "objection_handling": 0-100,
    "brevity": 0-100,
    "cta_strength": 0-100
  },
  "weakest_axis": "axis_name",
  "strongest_axis": "axis_name",
  "one_line_verdict": "one honest, specific sentence summarizing overall performance"
}`;

  const FALLBACK = {
    session_score: 50,
    axes: { clarity: 55, value: 45, discovery: 40, objection_handling: 50, brevity: 60, cta_strength: 45 },
    weakest_axis: 'discovery',
    strongest_axis: 'brevity',
    one_line_verdict: 'Decent attempt — focus on asking discovery questions before pitching.'
  };

  try {
    const { content } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.3,
      maxTokens:   400,
      modelName:   PRO_MODEL,
    });
    const clean  = content.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    if (!parsed.axes || parsed.session_score == null) return FALLBACK;
    return { ...FALLBACK, ...parsed };
  } catch (err) {
    console.error('[Groq] generateMultiAxisScores FAILED:', err.message);
    return FALLBACK;
  }
};

// ──────────────────────────────────────────
// MULTI-AXIS SKILL SCORING — V3 (7 axes + monologue_alignment)
// ──────────────────────────────────────────
export const generateMultiAxisScoresV3 = async (user, messages, buyerProfile = {}, internalMonologues = []) => {
  const vp = user.voice_profile || {};

  const founderMessages = messages.filter(m => m.role === 'user');
  if (founderMessages.length === 0) {
    return {
      session_score: 0,
      axes: { clarity: 0, value: 0, discovery: 0, objection_handling: 0, brevity: 0, cta_strength: 0, monologue_alignment: 0 },
      weakest_axis:   'discovery',
      strongest_axis: 'clarity',
      one_line_verdict: 'No messages to score.'
    };
  }

  const fullConversation = messages
    .filter(m => m.role !== 'system')
    .map(m => `${m.role === 'user' ? 'Founder' : 'Prospect'}: ${m.content}`)
    .join('\n');

  const monologueContext = internalMonologues.length > 0
    ? `\nBuyer's hidden thoughts during session (revealed post-session):\n${
        internalMonologues.map((m, i) => `Exchange ${i + 1}: "${m}"`).join('\n')
      }`
    : '';

  const prompt = `Score this completed sales practice session across 7 axes.

Product being sold: "${user.product_description}"
Target audience: "${user.target_audience || vp.target_customer_description || 'not specified'}"
Buyer profile: ${JSON.stringify({ name: buyerProfile.name, role: buyerProfile.role, main_pain: buyerProfile.main_pain })}

Full conversation:
${fullConversation}
${monologueContext}

Score each axis 0–100 based on the ENTIRE conversation:
- clarity: Were messages easy to understand in one read?
- value: Were specific outcomes or metrics communicated?
- discovery: Did the founder ask diagnostic questions before pitching?
- objection_handling: Were pushbacks addressed thoughtfully with specifics?
- brevity: Were messages appropriately concise (not over-explained)?
- cta_strength: Did messages end with clear next steps or questions?
- monologue_alignment: How well did the founder's responses address what the buyer was ACTUALLY thinking (internal monologues)?${internalMonologues.length === 0 ? ' Score 50 if no monologue data available.' : ' Score based on the hidden thoughts revealed above.'}

Scoring notes:
- discovery is the most commonly weak axis — score it critically
- brevity: >80 words per message = significant deduction
- cta_strength: score 0 if the founder never asked a question
- monologue_alignment: 0–40 = consistently missed real concerns, 41–70 = partial, 71–100 = strong alignment

Return ONLY this JSON:
{
  "session_score": weighted_average_0_to_100,
  "axes": {
    "clarity": 0-100,
    "value": 0-100,
    "discovery": 0-100,
    "objection_handling": 0-100,
    "brevity": 0-100,
    "cta_strength": 0-100,
    "monologue_alignment": 0-100
  },
  "weakest_axis": "axis_name",
  "strongest_axis": "axis_name",
  "one_line_verdict": "one honest, specific sentence summarizing overall performance"
}`;

  const FALLBACK = {
    session_score: 50,
    axes: { clarity: 55, value: 45, discovery: 40, objection_handling: 50, brevity: 60, cta_strength: 45, monologue_alignment: 50 },
    weakest_axis:   'discovery',
    strongest_axis: 'brevity',
    one_line_verdict: 'Decent attempt — focus on asking discovery questions before pitching.'
  };

  try {
    const { content } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.3,
      maxTokens:   450,
      modelName:   PRO_MODEL,
    });
    const clean  = content.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    if (!parsed.axes || parsed.session_score == null) return FALLBACK;
    return { ...FALLBACK, ...parsed };
  } catch (err) {
    console.error('[Groq] generateMultiAxisScoresV3 FAILED:', err.message);
    return FALLBACK;
  }
};

// ──────────────────────────────────────────
// ADAPTIVE CURRICULUM
// Generates a personalized 3-session practice plan based on skill gaps.
// ──────────────────────────────────────────
export const generateAdaptiveCurriculum = async (user, skillProfileRows = [], recentSessions = []) => {
  const vp = user.voice_profile || {};
  const axes = ['clarity', 'value', 'discovery', 'objection_handling', 'brevity', 'cta_strength'];

  const averages = {};
  for (const axis of axes) {
    const colMap = {
      clarity: 'clarity_avg', value: 'value_avg', discovery: 'discovery_avg',
      objection_handling: 'objection_avg', brevity: 'brevity_avg', cta_strength: 'cta_avg',
    };
    const col  = colMap[axis];
    const vals = skillProfileRows.filter(r => r[col] != null).map(r => parseFloat(r[col]));
    averages[axis] = vals.length > 0
      ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
      : 50;
  }

  const weakest  = Object.entries(averages).sort((a, b) => a[1] - b[1]);
  const strongest = Object.entries(averages).sort((a, b) => b[1] - a[1]);
  const recentTypes = recentSessions.slice(0, 10).map(s => s.scenario_type).join(', ') || 'none';

  const prompt = `Generate a personalized 3-session practice plan for a sales founder.

Founder: "${user.product_description}"
Audience: "${user.target_audience || vp.target_customer_description || 'not specified'}"

Their current skill averages:
${axes.map(a => `${a}: ${averages[a]}/100`).join('\n')}

Weakest axis: ${weakest[0][0]} (${weakest[0][1]}/100)
Strongest axis: ${strongest[0][0]} (${strongest[0][1]}/100)
Recently practiced scenarios: ${recentTypes}

Generate a targeted 3-session weekly plan. Session 1 should target the weakest axis directly.
Session 2 should combine weakest + second weakest. Session 3 should be a full scenario.

Return ONLY this JSON:
{
  "weakness_identified": "axis_name",
  "weakness_score": number,
  "goal_description": "what they should achieve by end of week (specific and actionable)",
  "sessions": [
    {
      "session_number": 1,
      "title": "short punchy title",
      "type": "drill",
      "drill_type": "discovery|brevity|value|cta",
      "scenario_type": "interested|skeptical|price_objection|polite_decline|not_right_time",
      "focus_axis": "axis_name",
      "description": "1-2 sentences on what to focus on and why",
      "target_score": number_0_to_100
    },
    {
      "session_number": 2,
      "title": "short punchy title",
      "type": "drill",
      "drill_type": "discovery|brevity|value|cta",
      "scenario_type": "interested|skeptical|price_objection|polite_decline|not_right_time",
      "focus_axis": "axis_name",
      "description": "1-2 sentences",
      "target_score": number
    },
    {
      "session_number": 3,
      "title": "short punchy title",
      "type": "full_scenario",
      "drill_type": null,
      "scenario_type": "interested|skeptical|price_objection|polite_decline|not_right_time",
      "focus_axis": "axis_name",
      "description": "1-2 sentences",
      "target_score": number
    }
  ]
}`;

  try {
    const { content } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.5,
      maxTokens:   700,
      modelName:   PRO_MODEL,
    });
    const clean  = content.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (err) {
    console.error('[Groq] generateAdaptiveCurriculum FAILED:', err.message);
    return null;
  }
};

// ──────────────────────────────────────────
// PLAYBOOK GENERATION
// Background job: 2 hours after session completes (score > 60 only).
// ──────────────────────────────────────────
export const generatePlaybook = async (user, messages, buyerProfile = {}, annotations = [], scenarioType = '') => {
  const vp = user.voice_profile || {};

  const transcript = messages
    .filter(m => m.role !== 'system')
    .map(m => `${m.role === 'user' ? 'Founder' : 'Prospect'}: ${m.content}`)
    .join('\n');

  const positiveAnnotations = annotations
    .filter(a => a.severity === 'positive')
    .map(a => a.issue)
    .join('; ');

  const prompt = `Generate a personalized sales playbook based on a completed practice session.

Founder's product: "${user.product_description}"
Target audience: "${user.target_audience || vp.target_customer_description || 'not specified'}"
Their differentiator: "${vp.unique_value_prop || 'not specified'}"
Their best proof point: "${vp.best_proof_point || 'not specified'}"
Their main objection: "${vp.main_objection || 'not specified'}"
Their objection reframe: "${vp.objection_reframe || 'not specified'}"
Scenario practiced: ${scenarioType}
Buyer type: ${buyerProfile.role || 'decision maker'} at ${buyerProfile.stage || 'a company'}

What worked in this session: ${positiveAnnotations || 'general engagement'}

Practice conversation:
${transcript.slice(0, 2500)}

Generate a practical, reusable playbook for this specific buyer type. Be specific — use their actual product, audience, proof points.

Return ONLY this JSON:
{
  "opening_message": "best opening message template (50-80 words, ready to use)",
  "discovery_questions": [
    "discovery question 1",
    "discovery question 2",
    "discovery question 3"
  ],
  "objection_responses": [
    {"objection": "specific objection", "response": "how to handle it concisely"},
    {"objection": "specific objection 2", "response": "how to handle it"},
    {"objection": "specific objection 3", "response": "how to handle it"}
  ],
  "closing_cta": "best closing call to action for this buyer type",
  "key_insight": "the single most important thing to remember with this buyer type"
}`;

  try {
    const { content } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.55,
      maxTokens:   900,
      modelName:   PRO_MODEL,
    });
    const clean  = content.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (err) {
    console.error('[Groq] generatePlaybook FAILED:', err.message);
    return null;
  }
};

// ──────────────────────────────────────────
// RETRY COMPARISON
// Generates a structured diff between original and retry session.
// ──────────────────────────────────────────
export const generateRetryComparison = async (
  user, originalMessages, retryMessages, originalScore, retryScore
) => {
  const origMsgs  = (originalMessages || []).filter(m => m.role === 'user').map(m => m.content);
  const retryMsgs = (retryMessages    || []).filter(m => m.role === 'user').map(m => m.content);

  if (!origMsgs.length || !retryMsgs.length) return null;

  const prompt = `Compare two attempts at a sales practice session.

Attempt 1 (session score: ${originalScore || '?'}/100):
${origMsgs.slice(0, 5).join('\n---\n')}

Attempt 2 (session score: ${retryScore || '?'}/100):
${retryMsgs.slice(0, 5).join('\n---\n')}

Generate a precise side-by-side comparison showing what changed and why it worked or didn't.

Return ONLY this JSON:
{
  "score_improvement": ${(retryScore || 0) - (originalScore || 0)},
  "improved": ${(retryScore || 0) > (originalScore || 0)},
  "key_improvements": ["specific improvement 1", "specific improvement 2"],
  "still_needs_work": ["specific thing still weak"],
  "best_new_phrase": "the single strongest new phrase or approach in attempt 2",
  "verdict": "one honest sentence summarizing whether the retry was meaningfully better"
}`;

  try {
    const { content } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.4,
      maxTokens:   500,
      modelName:   PRO_MODEL,
    });
    const clean  = content.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (err) {
    console.error('[Groq] generateRetryComparison FAILED:', err.message);
    return null;
  }
};
