// src/services/groq-onboarding.js
// ============================================================
// ONBOARDING LAYER — Voice profile, burst questions, memory seeding,
//                    sample outreach, and archetype detection
// ============================================================

import { parseTextResponse, parseJSONObject, parseJSONArray, validateAndFill } from '../utils/parser.js';
import supabaseAdmin from '../config/supabase.js';
import { callGroq }  from './groq-client.js';
import { PRO_MODEL } from './groq-client.js';
import { SYSTEM_PROMPTS } from './groq-prompts.js';

// ──────────────────────────────────────────
// VOICE PROFILE BUILDER
// ──────────────────────────────────────────
export const buildVoiceProfile = async (basicInfo, onboardingAnswers) => {
  const answersText = Object.entries(onboardingAnswers)
    .map(([q, a]) => `Q: ${q}\nA: ${a}`)
    .join('\n\n');

  const prompt = `${SYSTEM_PROMPTS.ONBOARDING_STRATEGIST}

You have completed an onboarding conversation with this founder.

Your job is NOT to summarize what they said.
Your job is to UPGRADE their raw answers into a complete, actionable voice profile.

---

CRITICAL INSTRUCTIONS:

The user may:
- Answer casually
- Be vague
- Not understand strategy
- Not use strong language

You MUST:
- Infer meaning from simple answers
- Combine multiple answers into stronger insights
- Turn everyday words into clear advantages
- Add context (who, when, why)

SPECIFICITY RULES (MOST IMPORTANT):
- If user gave a NUMBER (e.g. "4 hours", "$12k", "70%"), KEEP the exact number
- If user gave a NAME (e.g. "Sarah", "AdVantage"), KEEP the name
- If user gave a DIRECT QUOTE (e.g. "I didn't know reporting could be painless"), KEEP the quote
- If user gave a SPECIFIC TIMEFRAME (e.g. "Friday at 2 PM", "Sunday night"), KEEP it

BAD: "Cuts reporting time significantly"
GOOD: "Cuts reporting from 4 hours to 20 minutes (70% faster)"

BAD: "A client said something positive"
GOOD: "Client said: 'I checked the dashboard at 11pm Sunday and saw ROAS up 22%'"

BAD: "Agency owners get busy on Fridays"
GOOD: "The Friday afternoon reporting scramble — 2-4 hours of pulling screenshots before the weekend"

DO NOT:
- Repeat their words directly (upgrade them)
- Use generic phrases like "high quality", "great service", "streamline workflow"
- Leave numbers or quotes generic when you can keep them specific

ALWAYS:
- Make outputs more specific than the input
- Anchor in real situations (busy days, urgency, specific moments)
- Sound natural, not corporate

---

BASIC INFO:
Business: ${basicInfo.business_name || 'Not provided'}
Product: ${basicInfo.product_description}
Audience: ${basicInfo.target_audience}
Role: ${basicInfo.role || 'founder'}
Industry: ${basicInfo.industry || 'not specified'}
Founder bio: ${basicInfo.bio || 'not provided'}
Business stage: ${basicInfo.business_stage || 'not specified'}
Experience level: ${basicInfo.experience_level || 'not specified'}
Preferred platforms: ${(basicInfo.preferred_platforms || []).join(', ') || 'not specified'}
Location: ${basicInfo.country || 'not specified'}${basicInfo.state ? ', ' + basicInfo.state : ''}
Primary goal: ${basicInfo.primary_goal || 'not specified'}

---

FULL ANSWERS:
${answersText}

---

BUILD THE PROFILE:

Be specific. Keep numbers, names, quotes, and timeframes.

---

FIELD INSTRUCTIONS:

unique_value_prop:
- One sharp sentence (max 15 words)
- Must include a specific outcome or number if available
- Must feel like something a customer would say

icp_trigger:
- The REAL moment someone becomes ready to buy
- Must be situational and specific (not abstract)
- Include timing or urgency (e.g. "Friday at 2 PM", "after a missed deadline")

target_customer_description:
- 2-3 sentences
- Describe their real-life situation AND daily struggle
- Include specific tools they use (e.g. "Slack + Sheets + Asana")
- Mention a specific time waste or pain point

main_objection:
- The REAL reason people hesitate (not generic "price")
- If user gave specific objection words, use them verbatim
- Include the fear behind the objection

objection_reframe:
- Natural, non-salesy response (max 1 sentence)
- Use logic or specific proof from their answers
- Address the fear, not just the surface objection

best_proof_point:
- Include specific numbers, client names, or quotes
- Format: "[Specific result] achieved by [who] in [timeframe]"
- Example: "Beta agencies cut reporting from 4hrs→20min (70%); 80% of live Slack-demo calls convert"

opening_hooks:
- 3 specific first-sentence templates for cold email/LinkedIn
- Each must reference a specific pain moment or unexpected result
- Example: "Does your Friday still disappear into client reports?"

channel_tone_map:
- Object with keys: cold_email, linkedin, reddit, x_twitter
- Each value: 3-5 word tone description
- Example: "cold_email: direct, problem-first, data"

cta_style:
- What action do you want? (e.g. "book a 12-min live dashboard audit")
- Not generic "click here" or "learn more"

voice_style:
- 3-5 words max
- Based on how they naturally communicate (NOT generic traits like "professional")

outreach_persona:
- One clear identity with a hint of experience
- Example: "Ex-agency owner who knows the Friday reporting grind"

avoid_phrases:
- 8-10 real phrases to avoid (spammy, corporate, or overused)
- Include "click here", "free trial", "best-in-class", "leverage", "synergy", "excited to announce", "hope this finds you well", "just checking in", "streamline", "optimize"

story_vault:
- Array of 2-3 objects with: title, quote, outcome, channel_use
- Extract from their answers wherever possible
- Example: {"title": "The Sunday night save", "quote": "I checked the dashboard at 11pm Sunday...", "outcome": "$12k client renewed", "channel_use": ["email", "linkedin"]}

follow_up_sequence:
- Array of 3 follow-up actions (day 3, day 7, day 14)
- Must be specific actions, not just "follow up"

---

RETURN EXACT JSON:

{
  "unique_value_prop": "",
  "icp_trigger": "",
  "target_customer_description": "",
  "main_objection": "",
  "objection_reframe": "",
  "best_proof_point": "",
  "opening_hooks": ["", "", ""],
  "channel_tone_map": {
    "cold_email": "",
    "linkedin": "",
    "reddit": "",
    "x_twitter": ""
  },
  "cta_style": "",
  "voice_style": "",
  "outreach_persona": "",
  "avoid_phrases": ["", "", "", "", "", "", "", ""],
  "story_vault": [
    {"title": "", "quote": "", "outcome": "", "channel_use": []}
  ],
  "follow_up_sequence": ["", "", ""]
}`;

  const FALLBACK = {
    unique_value_prop: "Helps customers get what they need without stress",
    icp_trigger: "When someone realizes their current workflow is taking too long",
    target_customer_description: basicInfo.target_audience || "Not specified",
    main_objection: "Uncertainty about switching from current process",
    objection_reframe: "Works with what you already use, no migration needed",
    best_proof_point: "Customers report saving significant time and reducing missed requests",
    opening_hooks: [
      "Does your Friday still disappear into [specific task]?",
      "Most [audience] don't realize they're losing [X] hours each week to [problem].",
      "One [customer type] saved a [$X] client by doing this one thing differently."
    ],
    channel_tone_map: {
      cold_email: "direct, problem-first",
      linkedin: "story-driven, engagement-focused",
      reddit: "helpful, question-first, no link",
      x_twitter: "short, punchy, value-packed"
    },
    cta_style: "Book a short call or see a live example",
    voice_style: "direct, simple, helpful",
    outreach_persona: "Helpful insider who understands the daily grind",
    avoid_phrases: ["click here", "free trial", "best-in-class", "leverage", "synergy", "excited to announce", "hope this finds you well", "just checking in"],
    story_vault: [],
    follow_up_sequence: [
      "Day 3: Share a specific result or case study",
      "Day 7: Ask a low-friction question about their current process",
      "Day 14: Breakup email — offer a resource or final note"
    ]
  };

  try {
    const { content } = await callGroq({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      maxTokens: 2500,
      modelName: PRO_MODEL
    });

    const parsed = parseJSONObject(content, FALLBACK);
    return validateAndFill(parsed, FALLBACK);

  } catch (err) {
    console.error('[Groq] buildVoiceProfile FAILED:', err.message);
    return FALLBACK;
  }
};

// ──────────────────────────────────────────
// BURST QUESTION GENERATORS (Onboarding Steps 2 & 3)
// ──────────────────────────────────────────
export const generateNextBurst = async ({ burst_number, previous_answers, basic_info }) => {

  const answersText = Object.entries(previous_answers)
    .map(([q, a]) => `Q: ${q}\nA: ${a}`)
    .join('\n\n');

  const isBurst2 = burst_number === 2;

  const burstConfig = isBurst2
    ? {
        label: 'BURST 2 — THE CUSTOMER (Real Behavior)',
        // In generateNextBurst, for burst_number === 2
// Replace the focus array with this:

focus: [
  "What exact moment or problem makes a customer start looking for a solution (e.g. missed deadline, Friday reporting scramble, client complaint)",
  "What specific concern or obstacle makes them hesitate or say 'no' at first (e.g. 'too many tools already', 'my team will resist change')",
  "What concrete result or event finally convinces them to try or buy (e.g. seeing a live example with their own data, a specific client save story)"
],
    
        interlideInstruction: `Write a short natural reaction (max 40 words).
- Reference something specific they said
- Sound human and conversational
- Smoothly move into learning more about their customers`
      }
    : {
        label: 'BURST 3 — HOW THEY SELL (Real Communication)',
        // In generateNextBurst, for burst_number === 3
// Replace the focus array with this:

focus: [
  "How they write to customers in email or DMs that actually gets a reply (e.g. short sentence, specific subject line, question at the end)",
  "What they say during a demo or call that makes someone say 'yes' (e.g. showing their own Slack messages turn into tasks live)",
  "What they do when someone doesn't reply after a few days (e.g. send a case study, ask a simple question, break up email)"
],
        interlideInstruction: `Write a short natural reaction (max 40 words).
- Reference something specific from earlier answers
- Transition into understanding how they communicate`
      };

  const isBeginnerModeNext = basic_info?.experience_level === 'beginner';

  const prompt = `${SYSTEM_PROMPTS.ONBOARDING_STRATEGIST}

CONTEXT — What this founder told us so far:
Business: ${basic_info?.product_description || 'not specified'}
Target audience: ${basic_info?.target_audience || 'not specified'}
Industry: ${basic_info?.industry || 'not specified'}
Role: ${basic_info?.role || 'not specified'}
Founder bio: ${basic_info?.bio || 'not provided'}
Business stage: ${basic_info?.business_stage || 'not specified'}
Experience level: ${basic_info?.experience_level || 'not specified'}
Preferred platforms: ${(basic_info?.preferred_platforms || []).join(', ') || 'not specified'}
Primary goal: ${basic_info?.primary_goal || 'not specified'}
Location: ${basic_info?.country || 'not specified'}${basic_info?.state ? ', ' + basic_info.state : ''}

${isBeginnerModeNext ? `BEGINNER MODE:
- Keep questions very simple
- Avoid deep thinking or analysis
- Ask about real-life situations only
` : ''}

THEIR PREVIOUS ANSWERS:
${answersText}

---

${burstConfig.label}

You have read everything above. Ask exactly 3 questions.

FOCUS:
${burstConfig.focus.map((f, i) => `${i + 1}. ${f}`).join('\n')}

IMPORTANT:
- The user may not think deeply about their business
- Ask about real experiences, not strategy
- Let them answer simply — you will extract insights later

RULES:
- Each question must be 1 sentence
- Use simple, everyday language
- Avoid marketing jargon or abstract concepts
- Do NOT ask about emotions, psychology, tone, or strategy
- Include examples in parentheses
- Build naturally from what they already shared

Also write a short interlude message.

${burstConfig.interlideInstruction}

Return ONLY this JSON:
{
  "questions": ["Q1?", "Q2?", "Q3?"],
  "interlude_message": "message"
}`;

  const FALLBACK_QUESTIONS = isBurst2
    ? [
        "Why do people usually come to you or need what you offer? (e.g. busy schedule, hunger, convenience)",
        "What sometimes stops people from buying at first? (e.g. price, delay, not sure about quality)",
        "What usually makes them finally decide to buy? (e.g. seeing your post, recommendation, urgent need)"
      ]
    : [
        "How do you usually talk to customers when they message you? (e.g. friendly, direct, casual)",
        "What kind of posts or messages get the most response from people? (e.g. pictures, short captions, offers)",
        "How do you normally convince someone to try your product or service? (e.g. explaining value, showing results)"
      ];

  try {
    const { content } = await callGroq({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      maxTokens: 2000,
      modelName: PRO_MODEL
    });

    const clean = content.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    if (
      Array.isArray(parsed.questions) &&
      parsed.questions.length >= 3 &&
      parsed.interlude_message
    ) {
      return {
        questions: parsed.questions,
        interlude_message: parsed.interlude_message,
        source: 'ai'
      };
    }

    throw new Error('Invalid structure');
  } catch (err) {
    console.error('[Groq] generateNextBurst FAILED:', err.message);

    return {
      questions: FALLBACK_QUESTIONS,
      interlude_message: isBurst2
        ? "Got it — that gives a clearer picture. Now I want to understand how your customers think and what makes them take action."
        : "Nice — I can see how you interact with customers. Let's look at how your communication actually drives responses.",
      source: 'fallback'
    };
  }
};

export const generateBurst1Questions = async (basicInfo) => {
  const bioContext = basicInfo.bio
    ? `\nFounder backstory: ${basicInfo.bio}`
    : '';

  const industryContext = basicInfo.industry_deep_dive
    ? `\nIndustry-specific insight: ${basicInfo.industry_deep_dive}`
    : '';

  const stageContext = basicInfo.business_stage
    ? `\nBusiness stage: ${basicInfo.business_stage}`
    : '';

  const experienceContext = basicInfo.experience_level
    ? `\nExperience level: ${basicInfo.experience_level}`
    : '';

  const goalContext = basicInfo.primary_goal
    ? `\nPrimary goal: ${basicInfo.primary_goal}`
    : '';

  const productDescription = basicInfo.product_description?.trim();
  const hasProductContext =
    productDescription &&
    productDescription.length > 20 &&
    !['n/a', 'none', 'not sure', 'unknown'].includes(
      productDescription.toLowerCase()
    );

  const isBeginnerMode = basicInfo.experience_level === 'beginner';

  const prompt = `${SYSTEM_PROMPTS.ONBOARDING_STRATEGIST}

A founder just told you this about their business:

Product: ${productDescription || 'not provided'}
Target customer: ${basicInfo.target_audience || 'not specified'}
Industry: ${basicInfo.industry || 'not specified'}
Role: ${basicInfo.role || 'founder'}${bioContext}${industryContext}${stageContext}${experienceContext}${goalContext}

IMPORTANT:
- This user may be a beginner
- Do NOT assume they understand marketing, strategy, or metrics
- Ask simple, real-life questions anyone can answer
- Questions should feel natural and conversational
- Avoid sounding robotic or survey-like

${isBeginnerMode
  ? `BEGINNER MODE:
- Keep everything extremely simple
- Do NOT ask for numbers, analytics, funnels, CAC, or structured business data
- Use everyday language`
  : ''}

CRITICAL LOGIC:
${
  hasProductContext
    ? `- The founder ALREADY explained what their product/business is about
- Do NOT ask them again what the product does`
    : `- The founder has NOT clearly explained what their product/business is
- ONE of the 3 questions MUST ask them what they are building, selling, or helping people do
- Ask this in a natural way (e.g. "What exactly does your product help people do?" or "What are you building right now?")`
}

YOUR GOAL:
Ask exactly 3 questions to understand:

${
  hasProductContext
    ? `1. What customers love most
   - Ask what people repeatedly praise, mention, or get excited about

2. When people decide to buy
   - Ask about the situation, frustration, or trigger moment that makes someone want this

3. What channel or platform gets the best response
   - Ask where they’ve gotten the most replies, interest, DMs, or engagement`
    : `1. What the product/business actually is
   - Understand what they are building, selling, or helping people do

2. What customers/users seem to love most
   - Ask about reactions, compliments, or unexpected benefits

3. Where they’ve gotten the best response or attention
   - Ask about posts, messages, communities, or platforms that worked unexpectedly well`
}

RULES:
- Each question must be exactly 1 sentence
- Use natural, conversational language
- Include examples in parentheses where helpful
- Do NOT ask for exact numbers or deep analysis
- Avoid generic startup jargon
- Make the questions feel human and easy to answer

Return ONLY a JSON array of exactly 3 question strings.`;

  const FALLBACK = hasProductContext
    ? [
        "What do customers or users seem to like most about what you offer? (e.g. simplicity, speed, convenience, a specific feature)",
        "What usually happens right before someone decides they need your product or service? (e.g. a stressful task, an urgent request, a repeated problem)",
        "Where have you gotten the best reactions or replies so far? (e.g. LinkedIn posts, Reddit comments, cold DMs, WhatsApp groups)"
      ]
    : [
        "What exactly are you building or helping people do right now? (e.g. a tool, service, marketplace, AI app)",
        "What reactions or compliments have you gotten from people who’ve seen or tried it? (e.g. 'this saves me time' or 'I’ve been needing this')",
        "Where have you gotten the most interest or replies so far? (e.g. Twitter/X, LinkedIn, Reddit, Discord, cold outreach)"
      ];

  try {
    const { content } = await callGroq({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      maxTokens: 500,
      modelName: PRO_MODEL
    });

    const questions = parseJSONArray(content, FALLBACK);

    const valid = questions.filter(
      q => typeof q === 'string' && q.length > 10
    );

    if (valid.length >= 3) {
      return { questions: valid, source: 'ai' };
    }

    return { questions: FALLBACK, source: 'fallback' };
  } catch (err) {
    console.error('[Groq] generateBurst1Questions FAILED:', err.message);

    return { questions: FALLBACK, source: 'fallback' };
  }
};



// ──────────────────────────────────────────
// MEMORY SEEDING FROM ONBOARDING
// Seeds user_memory after onboarding so day-1 context is rich.
// ──────────────────────────────────────────
export const seedMemoryFromOnboarding = async (userId, basicInfo, onboardingAnswers, voiceProfile, isRebuild = false) => {
  try {
    // On rebuild, clear stale onboarding-seeded memories to prevent duplicates
    if (isRebuild) {
      await supabaseAdmin
        .from('user_memory')
        .delete()
        .eq('user_id', userId)
        .is('source_chat_id', null)
        .lte('reinforcement_count', 2);
      console.log(`[Groq] seedMemoryFromOnboarding: cleared stale onboarding memories for rebuild (user ${userId})`);
    }

    const answersText = Object.entries(onboardingAnswers || {})
      .map(([q, a]) => `Q: ${q}\nA: ${a}`)
      .join('\n\n');

    const vp = voiceProfile || {};

    const prompt = `Extract 8-10 key facts about this founder from their onboarding profile. These facts will be used to personalize AI coaching in every future session.

BASIC INFO:
Business: ${basicInfo.business_name || 'not provided'}
Product: ${basicInfo.product_description}
Target audience: ${basicInfo.target_audience}
Industry: ${basicInfo.industry || 'not specified'}
Role: ${basicInfo.role || 'founder'}
Bio: ${basicInfo.bio || 'not provided'}
Business stage: ${basicInfo.business_stage || 'not specified'}
Experience level: ${basicInfo.experience_level || 'not specified'}
Preferred platforms: ${(basicInfo.preferred_platforms || []).join(', ') || 'not specified'}
Location: ${basicInfo.country || 'not specified'}${basicInfo.state ? ', ' + basicInfo.state : ''}
Primary goal: ${basicInfo.primary_goal || 'not specified'}

ONBOARDING ANSWERS:
${answersText || 'No answers provided'}

SYNTHESIZED VOICE PROFILE:
Differentiator: ${vp.unique_value_prop || 'not available'}
ICP trigger: ${vp.icp_trigger || 'not available'}
Main objection: ${vp.main_objection || 'not available'}
Best proof point: ${vp.best_proof_point || 'not available'}
Voice style: ${vp.voice_style || 'not available'}

Extract facts that are:
- Specific to this founder (not generic)
- About their business, ICP, differentiators, proof points, challenges, communication style, or goals
- Worth remembering across ALL future sessions

Each fact must also have a category from: business_context | differentiator | proof_point | icp_description | objection | voice_style | goal | challenge

Return ONLY a JSON array of objects:
[
  { "fact": "fact text here", "category": "category name" },
  ...
]`;

    const { content } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.3,
      maxTokens:   600,
      modelName:   PRO_MODEL
    });

    const clean  = content.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    if (!Array.isArray(parsed) || parsed.length === 0) return;

    const validFacts = parsed.filter(f => f.fact && f.category && f.fact.length > 10);
    if (validFacts.length === 0) return;

    const MEMORY_CAP = 100;
    const { count: existingCount } = await supabaseAdmin
      .from('user_memory')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_active', true);

    const slotsAvailable = Math.max(0, MEMORY_CAP - (existingCount || 0));
    if (slotsAvailable === 0) {
      console.log(`[Groq] seedMemoryFromOnboarding: MEMORY_CAP reached (${MEMORY_CAP}) for user ${userId}, skipping insert`);
      return;
    }

    const factsToInsert = validFacts
      .sort((a, b) => a.fact.length - b.fact.length)
      .slice(0, slotsAvailable);

    await supabaseAdmin.from('user_memory').insert(
      factsToInsert.map(f => ({
        user_id:             userId,
        fact:                f.fact,
        fact_category:       f.category,
        source_chat_id:      null,
        reinforcement_count: 2,
        last_reinforced_at:  new Date().toISOString(),
        is_active:           true,
      }))
    );

    console.log(`[Groq] seedMemoryFromOnboarding: seeded ${factsToInsert.length} facts for user ${userId} (cap: ${MEMORY_CAP}, slots available: ${slotsAvailable})`);
  } catch (err) {
    console.error('[Groq] seedMemoryFromOnboarding FAILED (non-fatal):', err.message);
  }
};

// ──────────────────────────────────────────
// ONBOARDING WOW MOMENT: Sample outreach message
// Generates a demo message immediately after onboarding completes.
// ──────────────────────────────────────────
export const generateSampleOutreachMessage = async (user, sampleProspectContext) => {
  const vp = user.voice_profile || {};

  const primaryPlatform = (user.preferred_platforms || [])[0] || null;
  const platformToneHint = primaryPlatform
    ? `Platform: ${primaryPlatform} — match the natural tone of this platform (e.g. LinkedIn = professional warmth; Reddit/X = casual directness; IndieHackers = builder-to-builder honesty)`
    : '';

  const prompt = `${SYSTEM_PROMPTS.MESSAGE_GENERATOR}

Write ONE sample cold outreach message to demonstrate what this founder's AI-personalized outreach looks like.
Return ONLY the message text — no subject line, no label, no explanation.

═══ FOUNDER CONTEXT ═══
Their product: ${user.product_description}
What makes them different: ${vp.unique_value_prop || 'unique in their space'}
Their best proof point: ${vp.best_proof_point || 'growing customer base'}
Their ideal customer: ${vp.target_customer_description || user.target_audience}
How they naturally talk: ${vp.voice_style || 'conversational, direct'}
Outreach persona: ${vp.outreach_persona || 'genuine founder sharing something useful'}
Their ICP trigger: ${vp.icp_trigger || 'when they face the core pain'}
Avoid sounding like: ${(vp.avoid_phrases || []).join(', ') || 'generic AI outreach'}
${platformToneHint ? `\n${platformToneHint}` : ''}

═══ SAMPLE PROSPECT CONTEXT ═══
${sampleProspectContext || `A ${user.target_audience} who has been struggling with the core problem ${user.product_description} solves`}

Write one genuine, specific outreach message. Under 100 words. Sound like a real human founder — not a sales tool.`;

  const fallback = `Hey — I noticed you mentioned [specific pain point]. I'm building ${user.product_description || 'something that might be relevant'} specifically for ${user.target_audience || 'people in your situation'}. Happy to share what we've been seeing work — no pitch, just useful context. Worth a quick look?`;

  try {
    const { content } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.8,
      maxTokens:   200,
      modelName:   PRO_MODEL
    });
    const result = parseTextResponse(content, fallback);
    return result.length > 20 ? result : fallback;
  } catch (err) {
    console.error('[Groq] generateSampleOutreachMessage FAILED:', err.message);
    return fallback;
  }
};

// ──────────────────────────────────────────
// ARCHETYPE DETECTION
// ──────────────────────────────────────────
export const detectUserArchetype = async (basicInfo, onboardingAnswers = {}) => {
  const answersText = Object.entries(onboardingAnswers)
    .slice(0, 5)
    .map(([q, a]) => `Q: ${q}\nA: ${a}`)
    .join('\n\n');

  const prompt = `Analyze this user's profile and classify them into exactly ONE archetype.

PROFILE:
Product/Offering: ${basicInfo.product_description || 'not provided'}
Target Audience: ${basicInfo.target_audience || 'not provided'}
Role: ${basicInfo.role || 'not provided'}
Industry: ${basicInfo.industry || 'not provided'}
Bio: ${basicInfo.bio || 'not provided'}

THEIR OWN WORDS (onboarding):
${answersText || 'No answers provided yet'}

ARCHETYPES:
- seller: Has a product/service and primary goal is finding and closing customers
- builder: Pre-revenue or very early stage, focused on validation and finding first users
- freelancer: Offers skills/services to clients, wants to land projects and grow client base
- creator: Makes content, art, or media — wants to grow audience or monetize their creativity
- professional: Growing career, reputation, or network — not necessarily selling a product
- learner: Developing new skills, career transition, or just getting started in business/sales

Return ONLY this JSON (no markdown):
{"archetype": "seller", "confidence": 0.9, "reasoning": "One sentence explanation"}`;

  const FALLBACK = { archetype: 'seller', confidence: 0.5, reasoning: 'Default based on profile' };

  try {
    const { content } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.2,
      maxTokens:   120,
      modelName:   PRO_MODEL
    });
    const clean  = content.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    const validArchetypes = ['seller', 'builder', 'freelancer', 'creator', 'professional', 'learner'];
    if (!validArchetypes.includes(parsed.archetype)) return FALLBACK;
    return parsed;
  } catch (err) {
    console.error('[Groq] detectUserArchetype FAILED:', err.message);
    return FALLBACK;
  }
};
