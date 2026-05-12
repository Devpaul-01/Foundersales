// src/services/groq-coaching.js
// ============================================================
// COACHING LAYER — AI coach responses, daily tips, check-in flow,
//                  weekly plan, coaching annotations, and reflection
// ============================================================

import { parseTextResponse }                from '../utils/parser.js';
import { callGroq, PRO_MODEL }              from './groq-client.js';
import {
  SYSTEM_PROMPTS,
  getRoleAwareCoachPrompt,
  getGrowthStrategistPrompt,
  archetypeFocus,
} from './groq-prompts.js';

// ──────────────────────────────────────────
// INTERNAL: Memory relevance splitter
// Partitions memory facts into "relevant to this message" vs "background"
// ──────────────────────────────────────────
const findRelevantMemories = (message, memoryFacts) => {
  if (!memoryFacts?.length) return { relevant: [], background: [] };
  if (!message?.trim())     return { relevant: [], background: memoryFacts };

  const msgLower = message.toLowerCase();
  const meaningful = (text) =>
    (text || '').toLowerCase().split(/\s+/).filter(w => w.length >= 4);

  const relevant   = [];
  const background = [];

  for (const fact of memoryFacts) {
    const factWords = meaningful(fact.fact);
    const isRelevant = factWords.some(word => msgLower.includes(word));
    if (isRelevant) {
      relevant.push(fact);
    } else {
      background.push(fact);
    }
  }

  return { relevant, background };
};

// ──────────────────────────────────────────
// AI COACH — General chat response builder
// Returns { systemPrompt, messages, contextMode } — caller streams these.
// ──────────────────────────────────────────
export const getCoachResponse = async (user, question, conversationHistory = [], performanceProfile = null, attachments = [], extraContext = {}) => {
  const vp           = user.voice_profile || {};
  const msgCount     = conversationHistory.length + 1;
  const isFullContext = msgCount === 1 || msgCount % 10 === 0;

  const moodLine = extraContext.recentCheckIn?.mood_score
    ? `Their mood today (1-5): ${extraContext.recentCheckIn.mood_score}/5${extraContext.recentCheckIn.mood_score <= 2 ? ' — they may be feeling stuck or low energy, be extra supportive' : extraContext.recentCheckIn.mood_score >= 4 ? ' — they\'re in a good place, push for bold action' : ''}`
    : '';

  const streakLine = user.check_in_streak > 0
    ? `Check-in streak: ${user.check_in_streak} days — acknowledge this momentum if it comes up naturally`
    : '';

  const ROLE_LABELS = {
    founder:      'FOUNDER',
    freelancer:   'FREELANCER',
    creator:      'CREATOR',
    professional: 'PROFESSIONAL',
    sales:        'SALES REP',
    marketer:     'MARKETER',
  };
  const contextLabel = ROLE_LABELS[user.role?.toLowerCase()] || 'SELLER';

  const { relevant: relevantFacts, background: backgroundFacts } =
    findRelevantMemories(question, extraContext.memoryFacts || []);

  const fullContextBlock = `YOU ARE COACHING ${contextLabel}: ${user.business_name || 'Not specified'} — ${user.product_description || 'No description'}
Role: ${user.role || 'seller'} | Archetype: ${user.archetype || 'seller'} | Industry: ${user.industry || 'not specified'}
Business stage: ${user.business_stage || 'not specified'}
Their ICP: ${vp.target_customer_description || user.target_audience || 'not specified'}
Their differentiator: ${vp.unique_value_prop || 'not specified'}
Their ICP trigger: ${vp.icp_trigger || 'not specified'}
The main objection they face: ${vp.main_objection || 'not specified'}
How to handle that objection: ${vp.objection_reframe || 'not specified'}
Their best proof point: ${vp.best_proof_point || 'not specified'}
Voice style: ${vp.voice_style || 'not specified'} | Persona: ${vp.outreach_persona || 'not specified'}
Preferred platforms: ${(user.preferred_platforms || []).join(', ') || 'not specified'}
${performanceProfile?.learned_patterns ? `What works for them in outreach: ${performanceProfile.learned_patterns}` : ''}
${performanceProfile ? `Outreach: ${performanceProfile.total_sent || 0} messages sent, ${Math.round((performanceProfile.positive_rate || 0) * 100)}% positive rate` : 'No outreach data yet.'}
${extraContext.activeGoals?.length ? `Active goal: "${extraContext.activeGoals[0]?.goal_text}"${extraContext.activeGoals[0]?.target_value ? ` (${extraContext.activeGoals[0].current_value || 0}/${extraContext.activeGoals[0].target_value} ${extraContext.activeGoals[0].target_unit})` : ''}` : ''}
${extraContext.recentCheckIn ? `Recent check-in: mood ${extraContext.recentCheckIn.mood_score || '?'}/5 | answers: ${JSON.stringify(extraContext.recentCheckIn.answers || {}).slice(0, 250)}` : ''}
${moodLine}
${streakLine}
${relevantFacts.length > 0 ? `
DIRECTLY RELEVANT TO THIS CONVERSATION — reference these naturally:
${relevantFacts.map(f => `- ${f.fact}`).join('\n')}
When appropriate, say things like "You mentioned [X]" or "Last time you said [Y] — has that changed?"
Do NOT list these back at them. Weave the most relevant 1-2 into your response naturally.` : ''}
${backgroundFacts.length > 0 ? `
BACKGROUND KNOWLEDGE (you know this about them — use when relevant):
${backgroundFacts.map(f => `- ${f.fact}`).join('\n')}` : ''}`;

  const minimalContextBlock = `[Context: ${user.business_name || 'Founder'} — ${user.product_description?.slice(0, 80) || 'building a product'}. Archetype: ${user.archetype || 'seller'}. ICP: ${user.target_audience?.slice(0, 60) || 'not specified'}. Differentiator: ${vp.unique_value_prop?.slice(0, 60) || 'not specified'}.]`;

  const contextBlock     = isFullContext ? fullContextBlock : minimalContextBlock;
  const attachmentContext = attachments.length > 0
    ? `\nThey shared ${attachments.length} file(s): ${attachments.map(a => a.original_filename).join(', ')}`
    : '';

  const history = conversationHistory.slice(-8).map(m => ({ role: m.role, content: m.content }));

  return {
    systemPrompt: `${getRoleAwareCoachPrompt(user)}\n\n${contextBlock}${attachmentContext}`,
    messages:     [...history, { role: 'user', content: question }],
    contextMode:  isFullContext ? 'full' : 'minimal',
  };
};

// ──────────────────────────────────────────
// COACHING TIP — Post-message structured feedback
// Returns what_worked, what_didnt, improvement, hint
// ──────────────────────────────────────────
export const generateCoachingTip = async (user, userMessage, scenarioType, prospectResponse) => {
  const vp = user.voice_profile || {};

  // Inline quality analysis (mirrors analyzeMessageQuality in groq-practice.js)
  const words      = userMessage.trim().split(/\s+/).filter(Boolean);
  const wordCount  = words.length;
  const hasMetric  = /\d+%|\d+x|\$[\d,]+|\d+\s*(day|week|month|hour|minute|customer|user|client)/i.test(userMessage);
  const hasQuestion = userMessage.includes('?');
  const hasResultWord = /(result|outcome|increase|decrease|improve|grow|save|double|triple|reduce|boost|generate|revenue|close)/i.test(userMessage);
  const isPersonalized = /(you |your |noticed|saw|read|following|posted|mentioned|struggling|dealing with)/i.test(userMessage);
  const q = {
    wordCount, tooLong: wordCount > 50, veryLong: wordCount > 80,
    vague: !hasMetric && !hasResultWord, noAsk: !hasQuestion,
    noPersonalization: !isPersonalized, hasMetric, hasQuestion, hasResultWord, isPersonalized,
    score: (hasMetric ? 1 : 0) + (hasQuestion ? 1 : 0) + (hasResultWord ? 1 : 0) + (isPersonalized ? 1 : 0),
  };

  const outcomeContext = {
    interested:      'The prospect was curious and engaged.',
    polite_decline:  'The prospect politely declined.',
    ghost:           'The prospect did not reply (ghosted).',
    skeptical:       'The prospect was skeptical and pushed back.',
    price_objection: 'The prospect raised a pricing concern.',
    not_right_time:  'The prospect said timing was off.',
  };

  const needs_reflection = ['polite_decline', 'ghost', 'skeptical'].includes(scenarioType);

  const qualityContext = [
    q.veryLong     && `Message was ${q.wordCount} words — too long for cold outreach. Strong messages are under 30 words.`,
    q.tooLong      && !q.veryLong && `Message was ${q.wordCount} words — lean toward 20-35 for cold outreach.`,
    q.vague        && 'No specific result, number, or outcome was mentioned.',
    q.noAsk        && 'No question was asked — the message didn\'t invite a response.',
    q.noPersonalization && 'The message doesn\'t reference anything specific about this prospect\'s situation.',
    q.hasMetric    && 'A specific metric was included — this is a strength.',
    q.isPersonalized && 'The message referenced the prospect\'s situation — this is a strength.',
  ].filter(Boolean).join('\n');

  const prompt = `${SYSTEM_PROMPTS.SALES_COACH}

Analyze this practice outreach message and give structured coaching.

FOUNDER'S CONTEXT:
Product: "${user.product_description}"
Business stage: ${user.business_stage || 'not specified'}
ICP: "${vp.target_customer_description || user.target_audience || 'not specified'}"
Differentiator: "${vp.unique_value_prop || 'not specified'}"
Their most common objection: "${vp.main_objection || 'not specified'}"

THEIR MESSAGE:
"${userMessage}"

OUTCOME: ${outcomeContext[scenarioType] || 'The prospect responded.'}
${prospectResponse ? `PROSPECT SAID: "${prospectResponse}"` : ''}

QUALITY SIGNALS DETECTED:
${qualityContext || 'No specific issues detected.'}

Provide coaching in this EXACT JSON format:
{
  "what_worked": "<1 specific sentence. If something genuinely worked, quote it. If NOTHING worked, say 'N/A — nothing landed this time.' Be honest.>",
  "what_didnt": "<1-2 sentences. Be specific. Reference their actual words. Explain WHY it hurt them.>",
  "improvement": "<1-2 sentences. Give a concrete, specific suggestion with a rewritten example in quotes. Format: 'Try: \\"[example message]\\"'>",
  "hint": "<One short tip (under 12 words) to show as a retry hint. E.g. 'Try mentioning a specific result with a number.'>",
  "coaching_summary": "<Plain text version of what_worked + what_didnt + improvement combined, under 80 words total. This is the fallback display.>"
}`;

  try {
    const { content } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.55,
      maxTokens:   800,
    });
    const clean  = content.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return {
      what_worked:      parsed.what_worked || 'N/A — keep iterating.',
      what_didnt:       parsed.what_didnt  || 'The value proposition wasn\'t specific enough to get a response.',
      improvement:      parsed.improvement || 'Try adding a specific result with a number and ending with a direct question.',
      hint:             parsed.hint        || 'Mention a specific outcome with a number.',
      coaching_summary: parsed.coaching_summary || `${parsed.what_worked || ''} ${parsed.what_didnt || ''} ${parsed.improvement || ''}`.trim(),
      needs_reflection,
    };
  } catch {
    return {
      what_worked:      'N/A — keep iterating.',
      what_didnt:       'The message needed more specificity to get engagement.',
      improvement:      'Try opening with their specific situation, then mention one result you\'ve achieved for similar people, then ask one easy question.',
      hint:             'Mention a specific outcome with a number.',
      coaching_summary: 'The pitch needed more specificity. Try referencing their situation directly, add a specific result, and end with a question.',
      needs_reflection,
    };
  }
};

// ──────────────────────────────────────────
// REFLECTION CONTEXT
// Deeper coaching after user submits a reflection answer
// ──────────────────────────────────────────
export const generateReflectionContext = async (user, userMessage, reflectionAnswer, prospectResponse) => {
  const vp = user.voice_profile || {};

  const reflectionMap = {
    too_generic:        'The user recognized their message was too generic — it could have been sent to anyone.',
    no_value:           'The user recognized they didn\'t communicate clear value — the recipient couldn\'t picture what they\'d actually get.',
    weak_question:      'The user recognized they didn\'t ask a compelling question or the ask was unclear.',
    too_long:           'The user recognized their message was too long — the key point got buried.',
    too_much_pitch:     'The user recognized they pitched too hard, too fast — before building any rapport.',
    wrong_timing:       'The user recognized the timing or context of their message was off.',
    no_personalization: 'The user recognized they didn\'t reference anything specific about this person\'s situation.',
    missed_pain:        'The user recognized they missed the real pain point and spoke to the wrong problem.',
    assumed_too_much:   'The user recognized they made assumptions about what the person wanted without checking.',
    too_formal:         'The user recognized their tone was too formal or corporate — it didn\'t feel human.',
    too_pushy:          'The user recognized their message came across as pushy or salesy.',
    no_credibility:     'The user recognized they didn\'t establish any credibility or reason to trust them.',
    not_sure:           'The user isn\'t sure why the message got this response — they need guidance.',
  };

  const insight = reflectionMap[reflectionAnswer] || 'The user submitted a reflection.';

  const prompt = `${SYSTEM_PROMPTS.SALES_COACH}

A founder is practicing outreach. They just got rejected and reflected on why.

Their message: "${userMessage}"
Prospect replied: "${prospectResponse || '[No reply]'}"
Their reflection: ${insight}

Their product: "${user.product_description}"
Their ICP: "${vp.target_customer_description || 'not specified'}"

${reflectionAnswer === 'not_sure'
  ? 'Gently explain what actually happened in 2-3 sentences, then give a specific rewrite example.'
  : `Confirm their insight in 1 sentence, then give the specific fix with a rewrite example.`}

Keep response under 60 words. End with a rewrite in quotes starting with "Try:"`;

  try {
    const { content } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.5,
      maxTokens:   180,
    });
    return parseTextResponse(content, 'Good self-awareness. The key is specificity — name the result, reference their situation, and ask one easy question.');
  } catch {
    return 'Good self-awareness. Now try rewriting with a specific result and a single direct question.';
  }
};

// ──────────────────────────────────────────
// DAILY TIPS
// Mood-aware, archetype-specific growth cards
// ──────────────────────────────────────────
export const generateDailyTips = async (user, archetype, activeGoals = [], recentCheckIns = []) => {
  const vp = user.voice_profile || {};

  const goalsContext = activeGoals.length
    ? `Active goal: "${activeGoals[0]?.goal_text}"${activeGoals[0]?.target_value ? ` (target: ${activeGoals[0].target_value} ${activeGoals[0].target_unit}, current: ${activeGoals[0].current_value || 0})` : ''}`
    : 'No specific goal set yet';

  const checkInContext = recentCheckIns.length
    ? `Recent check-in context: ${JSON.stringify(recentCheckIns[0]?.answers || {}).slice(0, 300)}`
    : '';

  const moodScore = recentCheckIns[0]?.mood_score;
  const moodInstruction = moodScore
    ? moodScore <= 2
      ? 'IMPORTANT: User is feeling low (mood 1-2/5). Their cards should be: supportive, low-pressure, focus on small wins. Avoid challenge cards. Normalize slow days. One easy action.'
      : moodScore >= 4
      ? 'User is feeling great (mood 4-5/5). Go bolder — bigger challenges, bigger asks. Push them to make a move they\'ve been putting off.'
      : 'User is feeling neutral. Balance encouragement with practical action.'
    : '';

  const memoryContext = user._memoryFacts?.length
    ? `\nKEY FACTS ABOUT THIS FOUNDER (from their memory):\n${user._memoryFacts.map(f => `- ${f.fact}`).join('\n')}`
    : '';

  const prompt = `${getGrowthStrategistPrompt(user)}

Generate exactly 3 personalized daily growth cards for this user. Each card must feel DISTINCT — different card types, different focus areas, no overlap.

USER CONTEXT:
Business: ${user.business_name || 'Not specified'} — ${user.product_description}
Audience: ${user.target_audience}
Archetype: ${archetype} (focused on: ${archetypeFocus[archetype] || archetypeFocus.seller})
Their differentiator: ${vp.unique_value_prop || 'not specified'}
${goalsContext}
${checkInContext}
${memoryContext}
${moodInstruction}
${user._recentActivity ? `\n${user._recentActivity}\n` : ''}

CRITICAL RULE — SPECIFICITY:
Every card body MUST reference something concrete from the user's actual situation above.
If recent activity is provided, at least one card MUST reference a specific number,
platform, score, or pattern from that activity.

BAD example body: "Try improving your outreach personalization."
GOOD example body: "Your last analyzed message scored 4.2/10 on personalization — the failure pattern was 'too_generic'. The fastest fix: replace your opening sentence with one that names something specific from their post before you mention your product."

RULES FOR ALL 3 CARDS:
- Each must be actionable TODAY, not "over the next few weeks"
- Each must reference something concrete from their specific situation
- Body: 2-4 sentences max — punchy, specific, zero fluff
- action_type must ALWAYS be "internal_chat"

CARD TYPE DISTRIBUTION (use each once):
- Card 1 — card_type: "tip" — A quick, high-leverage action they can do in under 15 minutes
- Card 2 — card_type: "challenge" — A stretch goal or experiment to do within 24 hours (skip if mood is low, use "tip" instead)
- Card 3 — card_type: "reflection" — A sharp question or reframe that shifts their thinking

Return ONLY a JSON array of exactly 3 objects (no markdown):
[
  {
    "card_type": "tip",
    "title": "Short punchy title under 8 words",
    "body": "2-4 sentence actionable body. Reference their specific situation, scores, or recent activity.",
    "action_label": "Explore this with Clutch AI",
    "action_type": "internal_chat",
    "metadata": {"estimated_time": "10 minutes", "difficulty": "easy"}
  },
  { ... },
  { ... }
]`;

  const FALLBACK = [
    {
      card_type:    'tip',
      title:        'Your most important move today',
      body:         `Based on your profile, the highest-leverage thing you can do right now is reach out to ${user.target_audience}. Pick one person. Send one message. Real progress beats perfect planning every time.`,
      action_label: 'Explore this with Clutch AI',
      action_type:  'internal_chat',
      metadata:     { estimated_time: '15 minutes', difficulty: 'medium' }
    },
    {
      card_type:    'challenge',
      title:        '24-hour outreach challenge',
      body:         `Send 3 cold messages before tomorrow. Don't wait until they're perfect. Your job right now is to collect data on what resonates with ${user.target_audience}, not to close deals.`,
      action_label: 'Start with Clutch AI',
      action_type:  'internal_chat',
      metadata:     { estimated_time: '30 minutes', difficulty: 'medium' }
    },
    {
      card_type:    'reflection',
      title:        "What's actually stopping you?",
      body:         `If you could only do one thing today to move your business forward, what would it be — and what's the real reason you haven't done it yet? Identifying that blocker is half the battle.`,
      action_label: 'Think this through with Clutch',
      action_type:  'internal_chat',
      metadata:     { estimated_time: '5 minutes', difficulty: 'easy' }
    }
  ];

  try {
    const { content } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.78,
      maxTokens:   800,
      modelName:   PRO_MODEL
    });
    const clean  = content.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    if (!Array.isArray(parsed) || parsed.length === 0) return FALLBACK;

    return parsed.slice(0, 3).map((tip, i) => {
      if (!tip.title || !tip.body) return FALLBACK[i];
      return {
        ...FALLBACK[i],
        ...tip,
        action_type:  'internal_chat',
        action_label: tip.action_label || 'Explore with Clutch AI',
      };
    });
  } catch (err) {
    console.error('[Groq] generateDailyTips FAILED:', err.message);
    return FALLBACK;
  }
};

export const generateDailyTip = async (...args) => {
  const tips = await generateDailyTips(...args);
  return tips[0];
};

// ──────────────────────────────────────────
// CHECK-IN QUESTIONS
// ──────────────────────────────────────────
export const generateCheckInQuestions = async (user, archetype, chatContext = '', activeGoals = []) => {
  const vp = user.voice_profile || {};

  const goalContext = activeGoals.length
    ? `Their active goal: "${activeGoals[0]?.goal_text}"${activeGoals[0]?.target_value ? ` (${activeGoals[0].current_value || 0}/${activeGoals[0].target_value} ${activeGoals[0].target_unit})` : ''}`
    : '';

  const chatSummary = chatContext
    ? `Recent AI coach discussion covered: ${chatContext.slice(0, 400)}`
    : '';

  const archetypeQuestions = {
    seller:       ['How many outreach messages did you send today?', 'Any positive replies or leads to follow up on?'],
    builder:      ['Did you talk to any potential customers today?', 'What did you learn or test today?'],
    freelancer:   ['Did you reach out to any potential clients today?', 'Any proposals or projects in progress?'],
    creator:      ['Did you create or publish anything today?', 'How is your audience engagement looking?'],
    professional: ['Did you connect with anyone valuable today?', 'Any career progress or opportunities this week?'],
    learner:      ['What did you practice or learn today?', 'Are you applying what you\'ve been learning?'],
  };

  const prompt = `${getGrowthStrategistPrompt(user)}

Generate 3 personalized check-in questions for this user's afternoon reflection.

USER CONTEXT:
Business: ${user.product_description}
Archetype: ${archetype}
${goalContext}
${chatSummary}

RULES:
1. Question 1: Ask directly about what the AI coach recently discussed or advised. If there's chat context, reference a SPECIFIC topic from it. If no context, ask about their most important archetype activity.
2. Question 2: Ask about their goal progress (if they have one) OR about a specific win or challenge today.
3. Question 3: Ask one forward-looking question about tomorrow or this week.

Each question should feel like it's from a coach who actually remembers your last conversation.
Questions should be 1 sentence, conversational, specific.

Return ONLY a JSON array of 3 question strings:
["Question 1?", "Question 2?", "Question 3?"]`;

  const defaultQuestions = archetypeQuestions[archetype] || archetypeQuestions.seller;
  const FALLBACK = [
    defaultQuestions[0],
    defaultQuestions[1] || 'What was your biggest win or challenge today?',
    'What\'s your most important move tomorrow?'
  ];

  try {
    const { content } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.65,
      maxTokens:   200,
      modelName:   PRO_MODEL
    });
    const clean     = content.replace(/```json|```/g, '').trim();
    const questions = JSON.parse(clean);
    if (!Array.isArray(questions) || questions.length < 2) return FALLBACK;
    return questions.slice(0, 3);
  } catch (err) {
    console.error('[Groq] generateCheckInQuestions FAILED:', err.message);
    return FALLBACK;
  }
};

// ──────────────────────────────────────────
// CHECK-IN RESPONSE
// Cross-references mood with goal progress for intervention triggers
// ──────────────────────────────────────────
export const generateCheckInResponse = async (user, archetype, questions, answers, activeGoals = [], moodScore = null, recentActivity = {}) => {
  const vp = user.voice_profile || {};

  const qaText = Array.isArray(questions)
    ? questions.map((q, i) => `Q: ${q}\nA: ${answers[q] || answers[i] || '(no answer)'}`).join('\n\n')
    : Object.entries(answers).map(([q, a]) => `Q: ${q}\nA: ${a}`).join('\n\n');

  const goalContext = activeGoals.length
    ? activeGoals.map(g => `- "${g.goal_text}"${g.target_value ? ` (${g.current_value || 0}/${g.target_value} ${g.target_unit || ''})` : ''}`).join('\n')
    : 'No active goals';

  const { lastSentMessage, lastAnalysis } = recentActivity;

  const activityLine = (() => {
    if (lastAnalysis) {
      const score   = lastAnalysis.composite_score?.toFixed(1);
      const cats    = (lastAnalysis.failure_categories || []).slice(0, 2).join(', ');
      const outcome = lastAnalysis.outcome;
      if (score) {
        return `Their most recent analyzed message scored ${score}/10${outcome ? ` — outcome was ${outcome}` : ''}${cats ? `. Failure patterns: ${cats}` : ''}.`;
      }
    }
    if (lastSentMessage) {
      return `They recently sent a message on ${lastSentMessage.platform} to: ${(lastSentMessage.target_context || '').slice(0, 120)}.`;
    }
    return null;
  })();

  let interventionNote = '';
  if (moodScore !== null && moodScore <= 2) {
    interventionNote = 'IMPORTANT: User has low mood today (score: ' + moodScore + '/5). Acknowledge the difficulty first. Be warm and supportive. Do NOT give a task list. Give one small, easy action and affirm that slow days are part of the process.';
  } else if (activeGoals.length > 0 && activeGoals[0]?.target_value) {
    const progress = (activeGoals[0].current_value || 0) / activeGoals[0].target_value;
    if (progress < 0.3 && activeGoals[0].target_date) {
      interventionNote = `Note: Their goal "${activeGoals[0].goal_text}" is at ${Math.round(progress * 100)}% with a deadline approaching. Gently surface this — ask what's blocking progress, don't just affirm.`;
    }
  }

  const prompt = `${getGrowthStrategistPrompt(user)}

A user just completed their daily check-in. Respond as their AI co-founder companion.

USER: ${user.business_name || ''} — ${user.product_description}
Archetype: ${archetype}
Active goals:
${goalContext}
${moodScore ? `Mood today: ${moodScore}/5` : ''}
${interventionNote}

RECENT ACTIVITY (reference this specifically — do not be generic):
${activityLine || 'No recent outreach activity recorded yet.'}

CHECK-IN Q&A:
${qaText}

YOUR RESPONSE RULES:
- 3-4 sentences MAX.
- Acknowledge something SPECIFIC from their answers — show you were listening
- If you have recent activity data (message score, failure pattern, sent message), reference it directly by name: "Your last message scored X on personalization" or "The pattern showing up in your messages is [Y] — let's fix that with one specific change." Never give advice that ignores the data you have.
- If they had a win: celebrate it concretely, then give one momentum-building nudge
- If they struggled: normalize it briefly, then give ONE specific thing to try tomorrow
- If goal is behind: surface it gently once, ask what's blocking, don't lecture
- End with a forward-looking note that feels encouraging, not pressuring
- Do NOT give a list of 5 things to do. Give ONE thing.

Also generate a next_tip_seed: a 1-sentence brief that will seed tomorrow's tip generation
(e.g. "User is struggling with pricing objections, hasn't tried the reframe approach yet")

Return ONLY this JSON:
{"response_text": "Your 3-4 sentence response here", "next_tip_seed": "Seed for tomorrow's tip"}`;

  const FALLBACK = {
    response_text: `Thanks for checking in. Every day you show up is progress, even when it doesn't feel like it. Tomorrow, focus on just one thing: the most important move for your business right now.`,
    next_tip_seed: `User completed daily check-in for ${archetype} archetype`
  };

  try {
    const { content } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.7,
      maxTokens:   300,
      modelName:   PRO_MODEL
    });
    const clean  = content.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    if (!parsed.response_text) return FALLBACK;
    return parsed;
  } catch (err) {
    console.error('[Groq] generateCheckInResponse FAILED:', err.message);
    return FALLBACK;
  }
};

// ──────────────────────────────────────────
// WEEKLY PLAN
// ──────────────────────────────────────────
export const generateWeeklyPlan = async (user, archetype, metrics, activeGoals = [], recentCheckIns = []) => {
  const vp = user.voice_profile || {};

  const metricsText = metrics
    ? `Performance: ${metrics.total_sent || 0} messages sent, ${Math.round((metrics.positive_rate || 0) * 100)}% positive rate`
    : 'No performance data yet — user is early stage';

  const goalsText = activeGoals.length
    ? activeGoals.map(g => `- "${g.goal_text}"${g.target_date ? ` (by ${g.target_date})` : ''}`).join('\n')
    : 'No specific goals set';

  const checkInContext = recentCheckIns.length
    ? `\nRecent check-in signals (last ${recentCheckIns.length} days):\n${
        recentCheckIns
          .map(c => `- ${JSON.stringify(c.answers || {}).slice(0, 200)}`)
          .join('\n')
      }`
    : '';

  const prompt = `${getGrowthStrategistPrompt(user)}

Generate a weekly growth plan for this user.

USER: ${user.business_name || ''} — ${user.product_description}
Role: ${user.role || archetype} | Archetype: ${archetype}
They are focused on: ${archetypeFocus[archetype] || 'growing their business through outreach'}
Differentiator: ${vp.unique_value_prop || 'not specified'}
${metricsText}
Goals this week:
${goalsText}
${checkInContext}

Create a focused weekly plan — not a generic to-do list. A real strategic brief that reflects what this user has been doing and where they need to push next.

Return ONLY this JSON:
{
  "title": "This Week: [one sharp focus area, under 8 words]",
  "body": "3-4 sentences — what the priority is this week, why, and what success looks like. Specific to their situation.",
  "focus_area": "The ONE thing that matters most this week",
  "daily_actions": [
    "Monday: specific action",
    "Tuesday: specific action",
    "Wednesday: specific action",
    "Thursday: specific action",
    "Friday: specific action"
  ]
}`;

  const FALLBACK = {
    title:        'This Week: Build Your Outreach Habit',
    body:         `Focus on consistency over perfection this week. Aim to reach out to 2-3 people per day from your target audience. The goal isn't to close deals — it's to collect real feedback and build momentum.`,
    focus_area:   'Daily outreach consistency',
    daily_actions: [
      'Monday: Send 3 messages to your warmest leads',
      'Tuesday: Follow up with anyone who hasn\'t replied in 48h',
      'Wednesday: Practice one difficult scenario in practice mode',
      'Thursday: Review what\'s working and adjust your message',
      'Friday: Set next week\'s outreach target based on this week\'s data'
    ]
  };

  try {
    const { content } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.65,
      maxTokens:   500,
      modelName:   PRO_MODEL
    });
    const clean  = content.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    if (!parsed.title || !parsed.body) return FALLBACK;
    return { ...FALLBACK, ...parsed };
  } catch (err) {
    console.error('[Groq] generateWeeklyPlan FAILED:', err.message);
    return FALLBACK;
  }
};
