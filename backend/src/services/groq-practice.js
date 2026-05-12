// src/services/groq-practice.js — Bug D fix only
// Bug D: `const patience = buyerState.patience_remaining || 7` on line 673
// was extracted inside generatePracticeProspectReplyV3 but never referenced
// in the V3 prompt construction — pure dead code. Removed.
// All other logic is unchanged.
//
// TARGETED CHANGE: only the generatePracticeProspectReplyV3 function is
// modified. Everything else in this file remains exactly as uploaded.

import { parseTextResponse }                        from '../utils/parser.js';
import { callGroq, PRO_MODEL, FLASH_MODEL }         from './groq-client.js';
import { SYSTEM_PROMPTS, PRESSURE_MODIFIER_BLOCKS, getContactLabel } from './groq-prompts.js';

// ──────────────────────────────────────────
// INTERNAL: Message quality analyser
// ──────────────────────────────────────────
const analyzeMessageQuality = (userMessage) => {
  const words      = userMessage.trim().split(/\s+/).filter(Boolean);
  const wordCount  = words.length;
  const hasMetric  = /\d+%|\d+x|\$[\d,]+|\d+\s*(day|week|month|hour|minute|customer|user|client)/i.test(userMessage);
  const hasQuestion = userMessage.includes('?');
  const hasResultWord = /(result|outcome|increase|decrease|improve|grow|save|double|triple|reduce|boost|generate|revenue|close)/i.test(userMessage);
  const isPersonalized = /(you |your |noticed|saw|read|following|posted|mentioned|struggling|dealing with)/i.test(userMessage);

  return {
    wordCount,
    tooLong:        wordCount > 50,
    veryLong:       wordCount > 80,
    vague:          !hasMetric && !hasResultWord,
    noAsk:          !hasQuestion,
    noPersonalization: !isPersonalized,
    hasMetric,
    hasQuestion,
    hasResultWord,
    isPersonalized,
    score: (hasMetric ? 1 : 0) + (hasQuestion ? 1 : 0) + (hasResultWord ? 1 : 0) + (isPersonalized ? 1 : 0),
  };
};

// ──────────────────────────────────────────
// V3 REPLY PARSER — safe JSON extraction
// ──────────────────────────────────────────
export const parseV3Reply = (content) => {
  const FALLBACK_V3 = {
    reply: "Not right now, but appreciate the message.",
    internal_monologue: "I didn't have enough information to decide.",
    monologue_severity: "neutral",
    conversation_outcome: { type: 'continuing', reason: null, internal_reaction: null },
    goal_achieved: false,
    state_delta: { interest_delta: 0, trust_delta: 0, confusion_delta: 0, reasoning: '' },
    coaching_tip: null,
    needs_search: false,
  };

  try {
    const clean  = content.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    return {
      reply:               parsed.reply              || FALLBACK_V3.reply,
      internal_monologue:  parsed.internal_monologue || null,
      monologue_severity:  parsed.monologue_severity || 'neutral',
      conversation_outcome: {
        type:              parsed.conversation_outcome?.type             || 'continuing',
        reason:            parsed.conversation_outcome?.reason           || null,
        internal_reaction: parsed.conversation_outcome?.internal_reaction || null,
      },
      goal_achieved: typeof parsed.goal_achieved === 'boolean' ? parsed.goal_achieved : false,
      state_delta: {
        interest_delta:  parsed.state_delta?.interest_delta  ?? 0,
        trust_delta:     parsed.state_delta?.trust_delta     ?? 0,
        confusion_delta: parsed.state_delta?.confusion_delta ?? 0,
        reasoning:       parsed.state_delta?.reasoning       || '',
      },
      coaching_tip: parsed.coaching_tip || null,
      needs_search: parsed.needs_search === true,
    };
  } catch {
    const textOnly = content.split('{')[0].trim();
    return {
      ...FALLBACK_V3,
      reply: textOnly || FALLBACK_V3.reply,
    };
  }
};

// ──────────────────────────────────────────
// UTILITY: Split message into progressive render chunks
// ──────────────────────────────────────────
export const splitIntoChunks = (text) => {
  if (!text) return [text];

  if (text.includes('\n')) {
    const parts = text.split('\n').filter(Boolean);
    if (parts.length <= 3) return parts;
    return [parts.slice(0, -2).join('\n'), parts[parts.length - 2], parts[parts.length - 1]];
  }

  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  if (sentences.length <= 1) return [text];
  if (sentences.length === 2) return sentences;
  if (sentences.length === 3) return sentences;

  const first  = sentences[0];
  const last   = sentences[sentences.length - 1];
  const middle = sentences.slice(1, -1).join(' ');
  return [first, middle, last].filter(Boolean);
};

// ──────────────────────────────────────────
// UTILITY: Thinking delay calculator
// ──────────────────────────────────────────
export const computeThinkingDelay = (founderMessage, buyerState, outcomeType) => {
  const wordCount       = (founderMessage || '').split(' ').length;
  const baseDelay       = wordCount > 50 ? 3000 : wordCount > 25 ? 1500 : 500;
  const hasMultipleQs   = (founderMessage.match(/\?/g) || []).length > 1;
  const questionBonus   = hasMultipleQs ? 2000 : 0;
  const interestPenalty = (buyerState?.interest_score || 50) < 35 ? -1000 : 0;
  const outcomeBonus    = outcomeType && outcomeType !== 'continuing' ? 3000 : 0;
  return Math.max(500, baseDelay + questionBonus + interestPenalty + outcomeBonus);
};

// ──────────────────────────────────────────
// SCENARIO PROMPT GENERATORS
// ──────────────────────────────────────────
export const generatePracticeScenarioPrompt = async (user, scenarioType) => {
  const prompt = `${SYSTEM_PROMPTS.PRACTICE_PROSPECT}

Create a realistic social post or message that a prospect would write, to be used for sales practice.
The founder practicing sells: "${user.product_description}" to ${user.target_audience}.
Scenario type: ${scenarioType}

Write a 2-3 sentence realistic post. Make it specific — a real person with a real problem, not a generic situation.
Do NOT mention the scenario type. Just write the situation.
Return ONLY the post text.`;

  const defaults = {
    interested:      `Been dealing with the same problem for months and haven't found a good solution yet. Open to hearing what's out there — if anyone has dealt with this and found something that works, would genuinely like to know.`,
    polite_decline:  `Appreciate the outreach but not in a position to take on anything new right now. Got a lot on my plate and need to stay focused. Maybe check back in a few months.`,
    ghost:           `Trying to figure out the best way to handle something that keeps coming up in my work. Haven't cracked it yet. Anyone else dealt with this?`,
    skeptical:       `Getting a lot of messages from people promising to solve this exact problem. Would love to find something that actually works — just haven't seen it yet.`,
    price_objection: `Every expense feels like a real decision right now. Happy to invest in something if it actually delivers — but I need to be sure before I commit to anything.`,
    not_right_time:  `Got too much on right now to properly evaluate anything new. Not ignoring it — just need a better moment to give it proper attention. Probably in a couple of months.`
  };

  try {
    const { content } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.92,
      maxTokens:   150
    });
    const result = parseTextResponse(content, defaults[scenarioType] || defaults.polite_decline);
    return result.length > 20 ? result : defaults[scenarioType];
  } catch (err) {
    console.error('[Groq] generatePracticeScenarioPrompt FAILED:', err.message);
    return defaults[scenarioType] || defaults.polite_decline;
  }
};

export const generatePracticeScenarioFromOpportunity = async (user, scenarioType, opportunityContext) => {
  const scenarioHints = {
    interested:      'This person is genuinely curious and might be open to a conversation.',
    polite_decline:  'This person is politely not interested for now.',
    ghost:           'This person seems busy and unlikely to respond.',
    skeptical:       'This person is skeptical and will push back on claims.',
    price_objection: 'This person is interested but budget-conscious.',
    not_right_time:  'This person is genuinely interested but has bad timing right now.',
  };

  const prompt = `You are creating a realistic practice scenario for a sales founder.

The founder sells: "${user.product_description}" to "${user.target_audience || 'their target audience'}".
They found this real prospect context online:
"${opportunityContext?.slice(0, 600) || 'A potential customer post'}"

Rewrite or summarize this context as a short 2-3 sentence social post or message that a prospect would write.
The practice scenario type is: ${scenarioType} — ${scenarioHints[scenarioType] || ''}

Write the scenario from the prospect's perspective. Sound like a real human, not a template.
Do NOT reveal the scenario type. Return ONLY the scenario text.`;

  try {
    const { content } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.85,
      maxTokens:   160,
    });
    const result = parseTextResponse(content, opportunityContext?.slice(0, 200) || '');
    return result.length > 20 ? result : (opportunityContext?.slice(0, 300) || '');
  } catch (err) {
    console.error('[Groq] generatePracticeScenarioFromOpportunity FAILED:', err.message);
    return opportunityContext?.slice(0, 300) || '';
  }
};

// ──────────────────────────────────────────
// BUYER PROFILE GENERATOR (V2/V3 Sessions)
// ──────────────────────────────────────────
export const generateBuyerProfile = async (user, scenarioType, bioNote = '') => {
  const vp = user.voice_profile || {};

  const bioInstruction = bioNote
    ? `The user has described the prospect they want to practice with:\n"${bioNote}"\nHonor this description — use it to shape the name, role, company, and personality. Fill in any gaps with realistic detail.`
    : `Generate a contextually appropriate profile for someone the founder is likely to sell to.`;

  const prompt = `You are generating a realistic buyer persona for a sales training simulator.

Founder's product: "${user.product_description}"
Target audience: "${user.target_audience || 'not specified'}"
Scenario type: ${scenarioType}

${bioInstruction}

Rules:
- Match the persona to the actual product type — not every buyer is a corporate software buyer. If the product is a service, physical product, or targets consumers or small businesses, generate a persona that reflects that world.
- Make the person feel like a real, specific individual — not a generic archetype
- Include at least one hidden motivation the founder would need to ask a discovery question to uncover
- The interest_score should start between 20–45 (they haven't heard a pitch yet)
- The trust_score should start between 10–30 (they don't know this founder)
- The patience_remaining is how many more messages before they naturally disengage (5–10)
- opening_mood reflects how they're feeling when the first message arrives

Return ONLY valid JSON, no markdown, no explanation:
{
  "name": "realistic first + last name",
  "role": "specific job title or description",
  "company_size": "e.g. 12 employees or null if not applicable",
  "stage": "e.g. bootstrapped / growing / established / consumer / null if not applicable",
  "current_tools": ["tool or approach 1", "tool or approach 2"],
  "main_pain": "1-2 sentences describing their real, specific problem",
  "budget_ceiling": number_monthly_in_dollars_or_null,
  "skepticism_about": "what specifically makes them hesitant",
  "decision_authority": "e.g. sole decision maker / needs partner approval",
  "time_pressure": "low|medium|high",
  "hidden_motivations": ["hidden motivation 1 (must be discovered)", "hidden motivation 2"],
  "competitor_awareness": ["competitor name or alternative 1", "competitor name or alternative 2"],
  "personality_base": "3-5 words describing communication style",
  "opening_mood": "neutral|skeptical|curious|busy",
  "interest_score": number_20_to_45,
  "trust_score": number_10_to_30,
  "confusion_score": 0,
  "patience_remaining": number_5_to_10
}`;

  const FALLBACK = {
    name: 'Jamie Rivera', role: 'Small business owner', company_size: null,
    stage: 'established', current_tools: ['spreadsheets', 'email', 'word of mouth'],
    main_pain: 'Spending too much time on tasks that should be simpler, and not sure what to change first.',
    budget_ceiling: null, skepticism_about: 'Whether this actually saves real time or just adds complexity',
    decision_authority: 'sole decision maker', time_pressure: 'medium',
    hidden_motivations: ['Wants to appear more professional to clients', 'Secretly overwhelmed but won\'t admit it'],
    competitor_awareness: ['doing it manually', 'free tools from Google'],
    personality_base: 'direct, practical, skeptical of hype',
    opening_mood: 'neutral', interest_score: 28, trust_score: 12, confusion_score: 0, patience_remaining: 7,
  };

  try {
    const { content } = await callGroq({ messages: [{ role: 'user', content: prompt }], temperature: 0.75, maxTokens: 500 });
    const clean = content.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return {
      name:               parsed.name               || FALLBACK.name,
      role:               parsed.role               || FALLBACK.role,
      company_size:       parsed.company_size       || null,
      stage:              parsed.stage              || null,
      current_tools:      parsed.current_tools      || FALLBACK.current_tools,
      main_pain:          parsed.main_pain          || FALLBACK.main_pain,
      budget_ceiling:     parsed.budget_ceiling     || null,
      skepticism_about:   parsed.skepticism_about   || FALLBACK.skepticism_about,
      decision_authority: parsed.decision_authority || FALLBACK.decision_authority,
      time_pressure:      parsed.time_pressure      || 'medium',
      hidden_motivations: parsed.hidden_motivations || FALLBACK.hidden_motivations,
      competitor_awareness: parsed.competitor_awareness || FALLBACK.competitor_awareness,
      personality_base:   parsed.personality_base   || FALLBACK.personality_base,
      opening_mood:       parsed.opening_mood       || 'neutral',
      interest_score:     parsed.interest_score     || FALLBACK.interest_score,
      trust_score:        parsed.trust_score        || FALLBACK.trust_score,
      confusion_score:    parsed.confusion_score    || 0,
      patience_remaining: parsed.patience_remaining || FALLBACK.patience_remaining,
    };
  } catch (err) {
    console.error('[Groq] generateBuyerProfile FAILED:', err.message);
    return FALLBACK;
  }
};

// ──────────────────────────────────────────
// PROSPECT REPLY V1 — Simple (legacy)
// ──────────────────────────────────────────
export const generatePracticeProspectReply = async (user, userMessage, scenarioType, difficulty = 'standard', conversationHistory = []) => {
  const vp = user.voice_profile || {};
  const q  = analyzeMessageQuality(userMessage);

  const icpPersona = vp.target_customer_description
    ? `You are specifically: ${vp.target_customer_description}`
    : '';

  const difficultyInstructions = {
    beginner: 'Keep it simple. If the message was OK, give a gentle warm response. If it was weak, be briefly unclear rather than harsh.',
    standard: 'Be realistic. Show normal busy-professional behavior. Push back naturally when warranted.',
    advanced:  'Be demanding. Probe hard on specifics, ROI, alternatives. Make the founder earn your interest.',
    expert:    'Be very difficult. Reference skepticism from past experiences. Only the most specific, compelling message will get a genuine response.',
  };
  const difficultyNote = difficultyInstructions[difficulty] || difficultyInstructions.standard;

  const qualityModifier = q.veryLong
    ? 'The message was unusually long — you skimmed it. React naturally but briefly.'
    : q.vague && q.noAsk
    ? 'The message was a bit vague with no clear question — be slightly less engaged than usual.'
    : '';

  const scenarioMap = {
    interested: (() => {
      if (q.score >= 3) return "You're genuinely intrigued. The specifics caught your attention. Ask ONE pointed follow-up question that shows you're seriously considering it.";
      if (q.hasMetric)      return "The number caught your attention but you're unsure it applies to you. Ask 'Is that typical or best-case?'";
      if (q.isPersonalized) return "You appreciate they noticed your situation. Ask ONE clarifying question about how it actually works.";
      return "You're curious but the value isn't fully clear. Ask a pointed question like 'What exactly do you help with?'";
    })(),
    polite_decline:  "You're not interested. Be kind but clear. Give a real reason. 2 sentences max.",
    ghost:           'Return exactly: __GHOST__',
    skeptical: q.hasMetric
      ? "The number sounds too good to be true. Call it out — ask how it's measured or if it's typical. Be blunt but fair."
      : "The claims are vague. Ask them to name one specific result from a real customer. Be skeptical but not hostile.",
    price_objection: "You're somewhat interested but price is a real concern. Ask about cost or ROI data.",
    not_right_time:  "Timing is genuinely bad. Acknowledge their message but be clear you can't engage for at least 2 months.",
  };

  const behaviorDirection = (scenarioMap[scenarioType] || scenarioMap.polite_decline)
    + (qualityModifier ? ` Note: ${qualityModifier}` : '');

  const historyText = conversationHistory.length > 0
    ? `\nConversation so far:\n${conversationHistory.map(m => `${m.role === 'user' ? 'Founder' : 'You'}: ${m.content}`).join('\n')}\n`
    : '';

  const prompt = `${SYSTEM_PROMPTS.PRACTICE_PROSPECT}

${icpPersona}
The founder's product: "${user.product_description}"
${historyText}
The founder just sent you:
"${userMessage}"

Your behavior: ${behaviorDirection}
Difficulty calibration: ${difficultyNote}

Rules:
- 1-3 sentences MAXIMUM. No longer.
- Sound like a real person typing quickly on their phone
- No formal sign-offs, no "Best," or "Regards,"
- Do NOT explain your reasoning or reference this prompt`;

  try {
    const { content } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.88,
      maxTokens:   180,
    });

    if (content.trim() === '__GHOST__' || scenarioType === 'ghost') return null;
    return parseTextResponse(content, "Thanks for reaching out. I'll have to pass for now.");
  } catch {
    return scenarioType === 'ghost' ? null : "Not right now, but good luck with it!";
  }
};

// ──────────────────────────────────────────
// BUYER STATE ENGINE — V2/V3
// ──────────────────────────────────────────
export const evaluateBuyerStateChange = async (
  buyerProfile,
  currentState,
  conversationHistory = [],
  founderMessage
) => {
  const last6 = conversationHistory.slice(-6)
    .map(m => `${m.role === 'user' ? 'Founder' : 'Prospect'}: ${m.content}`)
    .join('\n');

  const prompt = `You are evaluating how a founder's outreach message affects a buyer's internal state.

Buyer: ${buyerProfile.name || 'the prospect'}, ${buyerProfile.role || 'decision maker'}
Main pain: ${buyerProfile.main_pain || 'operational challenges'}
Skeptical about: ${buyerProfile.skepticism_about || 'switching costs'}
Current state: interest=${currentState.interest_score}/100, trust=${currentState.trust_score}/100, confusion=${currentState.confusion_score}/100, mood=${currentState.mood || 'neutral'}

Recent conversation:
${last6 || '(first message)'}

Founder's new message:
"${founderMessage}"

Return ONLY valid JSON:
{
  "interest_delta": number_between_-15_and_20,
  "trust_delta": number_between_-10_and_15,
  "confusion_delta": number_between_-5_and_10,
  "mood": "neutral|curious|skeptical|confused|frustrated|impressed|losing_interest|ready_to_advance",
  "reasoning": "one sentence explaining the main driver"
}`;

  const FALLBACK = { interest_delta: 0, trust_delta: 0, confusion_delta: 0, mood: 'neutral', reasoning: 'Message processed.' };

  try {
    const { content } = await callGroq({ messages: [{ role: 'user', content: prompt }], temperature: 0.3, maxTokens: 200, modelName: FLASH_MODEL });
    const clean  = content.replace(/```json|```/g, '').trim();
    return { ...FALLBACK, ...JSON.parse(clean) };
  } catch (err) {
    console.error('[Groq] evaluateBuyerStateChange FAILED:', err.message);
    return FALLBACK;
  }
};

// ──────────────────────────────────────────
// GHOST QUALITY GATE
// ──────────────────────────────────────────
export const evaluateMessageQualityForGhost = async (user, message, conversationHistory = []) => {
  const isFirstMessage = conversationHistory.filter(m => m.role === 'user').length <= 1;

  const prompt = `You are evaluating the quality of an outreach message.
Sender's offering: "${user.product_description}"
Target: "${user.target_audience || 'general audience'}"
Message: "${message}"
Is this the first message? ${isFirstMessage ? 'Yes' : 'No'}

Score this message's quality on a scale of 0-100 based on:
- Specificity (does it reference a real situation or just generic claims?)
- Value clarity (does the recipient understand what they'd get?)
- Personalization (does it feel written for this person or copy-pasted?)
- Ask quality (is there a clear, easy next step?)
- Length appropriateness (not too long, not too short)

A score below 40 means the message is too generic/weak to deserve a response from a real busy person.
A score of 40+ means the message has enough quality that a real person MIGHT respond.

Be honest and critical. Most first messages score 20-45.

Return ONLY valid JSON:
{
  "quality_score": <0-100>,
  "reply_worthy": <true if score >= 40>,
  "weak_because": "1 sentence on the main weakness (even for good messages)",
  "hint": "one short actionable fix (under 12 words)"
}`;

  const FALLBACK = { quality_score: 25, reply_worthy: false, weak_because: 'Message needs more specificity.', hint: 'Reference their specific situation.' };

  try {
    const { content } = await callGroq({ messages: [{ role: 'user', content: prompt }], temperature: 0.3, maxTokens: 200, modelName: FLASH_MODEL });
    const clean  = content.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return {
      quality_score: parsed.quality_score ?? 25,
      reply_worthy:  parsed.reply_worthy  ?? (parsed.quality_score >= 40),
      weak_because:  parsed.weak_because  || FALLBACK.weak_because,
      hint:          parsed.hint          || FALLBACK.hint,
    };
  } catch (err) {
    console.error('[Groq] evaluateMessageQualityForGhost FAILED:', err.message);
    return FALLBACK;
  }
};

// ──────────────────────────────────────────
// PROSPECT REPLY V2 — Full buyer profile + live state
// ──────────────────────────────────────────
export const generatePracticeProspectReplyV2 = async (
  user,
  founderMessage,
  session,
  conversationHistory = [],
  options = {}
) => {
  const { attachmentContext = '' } = options;
  const vp           = user.voice_profile || {};
  const buyerProfile = session.buyer_profile || {};
  const buyerState   = session.buyer_state   || {};
  const scenarioType = session.scenario_type;
  const difficulty   = session.difficulty_level || 'standard';
  const drillType    = session.drill_type || null;

  const interest = buyerState.interest_score || 30;
  const trust    = buyerState.trust_score    || 15;
  const patience = buyerState.patience_remaining || 7;

  if (scenarioType === 'ghost') return null;

  if (patience <= 0) {
    return `Look, I appreciate the outreach but I have to be straight with you — this isn't the right time. Good luck with it.`;
  }

  const historyText = conversationHistory.length > 0
    ? `\n--- Conversation so far ---\n${conversationHistory.map(m =>
        `${m.role === 'user' ? 'Founder' : 'You (prospect)'}: ${m.content}`
      ).join('\n')}\n---`
    : '';

  const thresholdBehavior =
    interest >= 85 ? 'IMPORTANT: You are very interested. Consider suggesting next steps.' :
    interest >= 70 ? 'You are highly interested. Ask a strong next-step question.' :
    interest >= 50 ? 'You want more information. Ask something concrete.' :
    '';

  const difficultyMap = {
    beginner: 'If the message is OK, be warm and encouraging. If weak, be briefly unclear rather than harsh.',
    standard: 'Be a realistic busy professional. Push back naturally when warranted.',
    advanced:  'Be demanding. Probe hard on specifics, ROI, proof points, and alternatives.',
    expert:    'Only a highly specific, compelling message gets genuine engagement. Be very difficult.',
  };

  const drillOverride = drillType === 'discovery' && !founderMessage.includes('?')
    ? `No question was asked. Respond with confusion — ask "What are you actually asking me?"`
    : drillType === 'cta' && !founderMessage.includes('?')
    ? `No call to action. Respond briefly and don't engage.`
    : '';

  const contactLabel = getContactLabel(buyerProfile);
  const editableDetailsText = buyerProfile.editable_details
    ? Object.entries(buyerProfile.editable_details).map(([k, v]) => `${k}: ${v}`).join('\n') : '';

  const personaIntro = buyerProfile.name
    ? `You are ${buyerProfile.name}, ${buyerProfile.role}${buyerProfile.stage && buyerProfile.stage !== 'not applicable' ? ` (${buyerProfile.stage})` : ''}.
Your situation: ${buyerProfile.main_pain}
You're skeptical about: ${buyerProfile.skepticism_about}
${buyerProfile.current_tools?.length ? `Currently using: ${buyerProfile.current_tools.join(', ')}` : ''}
${editableDetailsText}
Personality: ${buyerProfile.personality_base || 'practical and direct'}`
    : `You are a realistic ${scenarioType} ${contactLabel.toLowerCase()}.`;

  const prompt = `${SYSTEM_PROMPTS.PRACTICE_PROSPECT}

${personaIntro}

They offer: "${user.product_description}" to "${user.target_audience || 'their target audience'}"
${historyText}

Their new message:
"${founderMessage}${attachmentContext}"

Interest: ${interest}/100, Trust: ${trust}/100
Difficulty: ${difficultyMap[difficulty] || difficultyMap.standard}
${thresholdBehavior ? `Note: ${thresholdBehavior}` : ''}
${drillOverride ? `Drill override: ${drillOverride}` : ''}

REPLY RULES:
- 1–3 sentences MAXIMUM. Real human texting on their phone.
- No sign-offs, no bullet points, no structure.
- Stay in character as ${buyerProfile.name || `this ${contactLabel.toLowerCase()}`} completely.

Also return coaching tip and state delta in same response.

STATE DELTA:
- interest_delta: -15 to +15
- trust_delta: -10 to +10
- confusion_delta: -5 to +5

COACHING TIP:
- what_worked: 1 specific sentence or "N/A"
- what_didnt: 1-2 specific sentences
- improvement: 1-2 sentences with a rewrite example
- needs_reflection: true if rejection or skepticism is particularly instructive

Return ONLY valid JSON:
{
  "reply": "response text",
  "state_delta": { "interest_delta": 0, "trust_delta": 0, "confusion_delta": 0, "reasoning": "..." },
  "coaching_tip": { "what_worked": "...", "what_didnt": "...", "improvement": "...", "needs_reflection": false }
}`;

  try {
    const { content } = await callGroq({ messages: [{ role: 'user', content: prompt }], temperature: 0.88, maxTokens: 500, modelName: PRO_MODEL });
    try {
      const clean  = content.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      return {
        reply:        parsed.reply || "Not right now, but appreciate the message.",
        state_delta:  parsed.state_delta  || { interest_delta: 0, trust_delta: 0, confusion_delta: 0, reasoning: '' },
        coaching_tip: parsed.coaching_tip || null,
      };
    } catch {
      return {
        reply:        parseTextResponse(content, "Not right now, but appreciate the message."),
        state_delta:  { interest_delta: 0, trust_delta: 0, confusion_delta: 0, reasoning: '' },
        coaching_tip: null,
      };
    }
  } catch (err) {
    console.error('[Groq] generatePracticeProspectReplyV2 FAILED:', err.message);
    return { reply: "Not right now, but appreciate the message.", state_delta: { interest_delta: 0, trust_delta: 0, confusion_delta: 0, reasoning: '' }, coaching_tip: null };
  }
};

// ──────────────────────────────────────────
// PROSPECT REPLY V3 — Single bundled call (reply + monologue + outcome + coaching)
// Bug D fix: removed `const patience = buyerState.patience_remaining || 7`
// That variable was extracted on the old line 673 but never referenced anywhere
// in the V3 prompt — pure dead code. V3 does not use patience in its logic.
// ──────────────────────────────────────────
export const generatePracticeProspectReplyV3 = async (
  user,
  founderMessage,
  session,
  conversationHistory = [],
  options = {}
) => {
  const { attachmentContext = '' } = options;
  const vp             = user.voice_profile || {};
  const buyerProfile   = session.buyer_profile   || {};
  const buyerState     = session.buyer_state     || {};
  const scenarioType   = session.scenario_type;
  const difficulty     = session.difficulty_level || 'standard';
  const drillType      = session.drill_type        || null;
  const pressureModifier = session.pressure_modifier || null;
  const sessionGoal    = session.session_goal || null;

  if (scenarioType === 'ghost') return null;

  const interest  = buyerState.interest_score    || 30;
  const trust     = buyerState.trust_score       || 15;
  const confusion = buyerState.confusion_score   || 0;
  // Bug D: `const patience = buyerState.patience_remaining || 7` REMOVED.
  // It was extracted here but never used in the prompt below — dead code.
  const mood      = buyerState.mood              || 'neutral';

  const historyText = conversationHistory.length > 0
    ? `\n--- Full conversation so far ---\n${conversationHistory.map(m =>
        `${m.role === 'user' ? 'Founder' : 'You (prospect)'}: ${m.content}`
      ).join('\n')}\n---`
    : '';

  const moodBehavior = {
    neutral:          'Respond professionally. Neither warm nor cold.',
    curious:          'You are engaged. Ask one pointed follow-up question.',
    skeptical:        'You are not sold. Push back on a specific claim or ask for proof.',
    confused:         'Something was unclear. Ask a specific clarifying question.',
    frustrated:       'Keep your response short. Show subtle impatience.',
    impressed:        'You are genuinely impressed — this is rare. Respond warmly.',
    losing_interest:  'Give a short, non-committal answer. You are starting to disengage.',
    ready_to_advance: 'You are interested. Ask about next steps or more details.',
  };

  const thresholdBehavior =
    interest >= 85 ? 'IMPORTANT: You are very interested. This conversation may be reaching a natural positive conclusion — consider suggesting next steps or asking about pricing/demo.' :
    interest >= 70 ? 'You are highly interested. Ask a strong next-step question.' :
    interest >= 50 ? 'You want more information. Ask something concrete about implementation or results.' :
    '';

  const difficultyMap = {
    beginner: 'If the message is OK, be warm and encouraging. If weak, be briefly unclear rather than harsh.',
    standard: 'Be a realistic busy professional. Push back naturally when warranted.',
    advanced:  'Be demanding. Probe hard on specifics, ROI, proof points, and alternatives.',
    expert:    'Only a highly specific, compelling message gets genuine engagement. Be very difficult.',
  };

  const drillOverride = drillType === 'discovery' && !founderMessage.includes('?')
    ? `The founder did not ask a question. Respond with confusion or ask "What are you actually asking me?" because there was no clear question.`
    : drillType === 'cta' && !founderMessage.includes('?')
    ? `The message had no call to action. Respond briefly and don't engage further.`
    : '';

  const prospectIntro = buyerProfile.name
    ? `You are ${buyerProfile.name}, ${buyerProfile.role} at a company with ${buyerProfile.company_size} (${buyerProfile.stage}).
Your main pain: ${buyerProfile.main_pain}
You're skeptical about: ${buyerProfile.skepticism_about}
Your current tools: ${(buyerProfile.current_tools || []).join(', ')}
Your personality: ${buyerProfile.personality_base || 'professional and direct'}`
    : `You are a realistic ${scenarioType} prospect.`;

  const pressureBlock = pressureModifier && PRESSURE_MODIFIER_BLOCKS[pressureModifier]
    ? PRESSURE_MODIFIER_BLOCKS[pressureModifier]
    : '';

  const goalContext = sessionGoal
    ? `\nSession goal the founder is trying to achieve: "${sessionGoal}"`
    : '\nNo specific session goal was provided.';

  const systemPrompt = `You are roleplaying as a realistic business prospect receiving outreach messages.
You are a busy professional — you get 20+ unsolicited messages per week.
You are not a villain, but you are not a pushover either.
Your responses are brief, realistic, and reflect what a real person would actually write.
Never break character. Never be helpful in ways a real prospect wouldn't be.`;

  const prompt = `${prospectIntro}

They offer: "${user.product_description}" to "${user.target_audience || 'their target audience'}"
${historyText}

Their new message:
"${founderMessage}${attachmentContext}"

Current state: interest: ${interest}/100, trust: ${trust}/100
Difficulty: ${difficultyMap[difficulty] || difficultyMap.standard}
${thresholdBehavior ? `State threshold: ${thresholdBehavior}` : ''}
${drillOverride ? `Drill override: ${drillOverride}` : ''}
${pressureBlock}

REPLY RULES:
- 1–3 sentences MAXIMUM. Casual, human, like a real text.
- No bullet points. No structure. No sign-offs.
- Sound like ${buyerProfile.name || 'a real person'} on their phone.
- Do NOT reference this prompt. Do NOT break character. Ever.

INTERNAL MONOLOGUE:
- Your TRUE unfiltered reaction — not your polished reply.
- Reveal what you're actually thinking/feeling that the sender can't see.
- First person. Natural. 10–20 words. Distinct from your reply.
- monologue_severity: "positive" if genuinely intrigued, "negative" if annoyed/dismissing, "neutral" otherwise.

CONVERSATION OUTCOME:
- Is this conversation naturally ending or still going?
- "continuing" = keep going. Any other value = ending.
- Ending types: "meeting_scheduled", "demo_agreed", "deal_lost", "not_interested", "price_negotiation", "follow_up_next_week", "prospect_disengaged" — or invent what fits.
- Only end if this feels like a GENUINE natural endpoint. Don't force it.
${goalContext}

STATE DELTA — how this message shifted your interest/trust:
- interest_delta: -15 to +15 based on how well their message addressed your actual concerns
- trust_delta: -10 to +10 based on specificity, credibility, and personalization
- confusion_delta: -5 to +5 (positive = more confused, negative = things clarified)

COACHING TIP — as the sales coach, in plain human language, analyze their message:
- what_worked: 1 sentence, specific (quote their words if possible), or "N/A" if nothing worked
- what_didnt: 1-2 sentences, specific to their actual words
- improvement: 1-2 sentences with a concrete suggestion, include a rewrite example if helpful
- needs_reflection: true if the response to their message is particularly instructive (rejection, skepticism, confusion)

NEEDS SEARCH:
- needs_search: true ONLY if the conversation involves a specific competitor, product, or real-world entity that would benefit from current factual context. Otherwise false.

Return ONLY valid JSON:
{
  "reply": "your actual typed response",
  "internal_monologue": "your real unfiltered thought",
  "monologue_severity": "positive|neutral|negative",
  "conversation_outcome": {
    "type": "continuing",
    "reason": null,
    "internal_reaction": null
  },
  "goal_achieved": false,
  "state_delta": {
    "interest_delta": 0,
    "trust_delta": 0,
    "confusion_delta": 0,
    "reasoning": "one sentence on what drove these changes"
  },
  "coaching_tip": {
    "what_worked": "...",
    "what_didnt": "...",
    "improvement": "...",
    "needs_reflection": false
  },
  "needs_search": false
}`;

  try {
    const { content } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      systemPrompt,
      temperature: 0.88,
      maxTokens:   700,
      modelName:   PRO_MODEL,
    });

    const parsed = parseV3Reply(content);
    console.log(`[Groq] V3 bundle generated. Outcome: ${parsed.conversation_outcome?.type}. Goal: ${parsed.goal_achieved}. Search needed: ${parsed.needs_search}`);
    return parsed;
  } catch (err) {
    console.error('[Groq] generatePracticeProspectReplyV3 FAILED:', err.message);
    return {
      reply: "Not right now, but appreciate the message.",
      internal_monologue: null,
      monologue_severity: "neutral",
      conversation_outcome: { type: 'continuing', reason: null, internal_reaction: null },
      goal_achieved: false,
      state_delta: { interest_delta: 0, trust_delta: 0, confusion_delta: 0, reasoning: '' },
      coaching_tip: null,
      needs_search: false,
    };
  }
};

// ──────────────────────────────────────────
// MID-SESSION BUYER INTERRUPTION (FLASH_MODEL)
// ──────────────────────────────────────────
export const generatePracticeInterruption = async (
  buyerProfile,
  buyerState,
  lastFounderMessage
) => {
  const interest = buyerState.interest_score || 30;
  const trust    = buyerState.trust_score    || 15;

  const prompt = `You are ${buyerProfile.name || 'a contact'} in the middle of a conversation.
The other person just sent: "${lastFounderMessage?.slice(0, 200) || '...'}"
Your current interest: ${interest}/100, trust: ${trust}/100

Before you reply, you have a quick thought that interrupts the flow.
Write a natural, spontaneous interjection — a question that just popped into your head, a concern that surfaced, or a time constraint.

1-2 sentences. Sound completely human. Return ONLY the text.`;

  try {
    const { content } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.85,
      maxTokens:   80,
      modelName:   FLASH_MODEL,
    });
    const text = content.trim().replace(/^["']|["']$/g, '');
    return text.length > 5 ? text : null;
  } catch (err) {
    console.error('[Groq] generatePracticeInterruption FAILED:', err.message);
    return null;
  }
};
