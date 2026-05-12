// src/services/groqCalendarIntelligence.js
// ============================================================
// CALENDAR & CONVERSATION INTELLIGENCE — AI FUNCTIONS
// All new AI capabilities for the upgraded calendar + chat system.
//
// Functions:
//  generateEnrichedEventPrep()      — upgraded prep with research + history
//  generateMeetingDebrief()         — post-meeting structured analysis
//  extractCommitmentsFromText()     — pulls promises from raw notes
//  generateSignalAnalysis()         — detects buying/risk/timing signals
//  generatePostMeetingFollowUp()    — context-rich follow-up variants
//  generateWeeklyPatternInsights()  — cross-conversation pattern engine
// ============================================================

import { callGroq, PRO_MODEL, PRIMARY_MODEL } from './groq.js';
import { parseJSONObject, parseJSONArray } from '../utils/parser.js';

// ──────────────────────────────────────────────────────────────────────────────
// 1. ENRICHED EVENT PREP
// Upgraded version of generateEventPrep — uses relationship history,
// Perplexity research, and outstanding commitments for a true prep brief.
// ──────────────────────────────────────────────────────────────────────────────
export const generateEnrichedEventPrep = async (user, event, context = {}) => {
  const vp = user.voice_profile || {};
  const {
    prospectTimeline     = null,
    previousSignals      = [],
    outstandingCommitments = [],
    perplexityResearch   = null,
  } = context;

  const signalsText = previousSignals.length
    ? previousSignals.map(s => `- [${s.signal_type.toUpperCase()}] ${s.signal_text}`).join('\n')
    : 'No signals recorded yet.';

  const commitmentsText = outstandingCommitments.length
    ? outstandingCommitments
        .filter(c => c.owner === 'founder' && c.status !== 'done')
        .map(c => `- ${c.commitment_text}${c.due_date ? ` (due ${c.due_date})` : ''}`)
        .join('\n')
    : 'None outstanding.';

  const researchText = perplexityResearch
    ? `${perplexityResearch.summary || ''}\n${(perplexityResearch.bullets || []).map(b => `• ${b}`).join('\n')}`
    : 'No live research available for this meeting.';

  const prompt = `You are preparing a founder for a high-stakes sales meeting.
This prep will be read 10 minutes before the meeting. Be razor specific — every point must be directly applicable to THIS meeting.

═══ FOUNDER PROFILE ═══
Business: ${user.business_name || 'Not specified'}
Product: ${user.product_description || 'Not described'}
Their differentiator: ${vp.unique_value_prop || 'Not specified'}
Best proof point: ${vp.best_proof_point || 'Not specified'}
Their ICP: ${vp.target_customer_description || user.target_audience || 'Not specified'}
Top objection they face: ${vp.main_objection || 'Not specified'}
How to handle that objection: ${vp.objection_reframe || 'Not specified'}
Voice style: ${vp.voice_style || 'conversational'}

═══ MEETING DETAILS ═══
Title: ${event.title}
Type: ${event.event_type || 'meeting'}
Date: ${event.start_time || event.event_date}
Attendee: ${event.attendee_name || 'Not specified'}
Context provided: ${event.attendee_context || event.notes || 'None'}

═══ RELATIONSHIP HISTORY ═══
${prospectTimeline || 'First interaction with this prospect.'}

═══ SIGNALS FROM PAST CONVERSATIONS ═══
${signalsText}

═══ COMMITMENTS YOU OWE THIS PROSPECT ═══
${commitmentsText}

═══ LIVE INTELLIGENCE (Perplexity research) ═══
${researchText}

Generate a complete meeting prep. Use ALL context above — especially the relationship history, signals, and research.

Return ONLY this JSON (no markdown, no explanation):
{
  "opening_line": "First sentence to say — specific to this person and context",
  "talking_points": ["3-4 specific points that address this prospect's known situation"],
  "key_question_to_ask": "The single best question to ask in this meeting",
  "anticipate_objection": "Most likely pushback + specific response to use",
  "intelligence_brief": "2-3 sentences using research + relationship history to give a real edge — should reference something the founder would not otherwise know",
  "commitment_check": "Reminder about any promise you made to this prospect, or null if none",
  "pre_outreach": "Message to send to confirm/prep them before the meeting (2-3 sentences)",
  "follow_up_template": "Draft follow-up to send within 24h of the meeting"
}`;

  const FALLBACK = {
    opening_line: `Hey ${event.attendee_name || 'there'} — really looking forward to our ${event.event_type || 'conversation'} today.`,
    talking_points: [
      `Focus on the specific problem ${user.product_description || 'your product'} solves`,
      'Ask what their current solution looks like and where it falls short',
      'Share your best concrete result with numbers if possible',
      'Keep the next step lightweight — make it easy to say yes',
    ],
    key_question_to_ask: "What would need to be true for this to be worth a second conversation?",
    anticipate_objection: `If they raise concerns about ${vp.main_objection || 'fit or timing'}: ${vp.objection_reframe || 'focus on the specific pain point they have, not your solution features.'}`,
    intelligence_brief: "Review their context carefully before joining — the prep above is based on what you've shared.",
    commitment_check: outstandingCommitments.length ? `You have ${outstandingCommitments.length} outstanding commitment(s) to this prospect — address them early in the meeting.` : null,
    pre_outreach: `Looking forward to our ${event.event_type || 'conversation'} — just wanted to confirm we're still on. Is there anything specific you'd like to cover?`,
    follow_up_template: `Hey ${event.attendee_name || 'there'} — great talking today. [Mention one specific thing they said]. [Next step]. Happy to [specific offer].`,
  };

  try {
    const { content } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.65,
      maxTokens:   800,
      modelName:   PRO_MODEL,
    });
    const parsed = parseJSONObject(content, FALLBACK);
    // Validate required fields exist
    if (!parsed.opening_line || !parsed.talking_points?.length) return FALLBACK;
    return parsed;
  } catch (err) {
    console.error('[CalendarIntel] generateEnrichedEventPrep FAILED:', err.message);
    return FALLBACK;
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// 2. MEETING DEBRIEF
// Called after a meeting. Accepts raw notes + outcome → structured analysis.
// ──────────────────────────────────────────────────────────────────────────────
export const generateMeetingDebrief = async (user, event, rawNotes, outcome) => {
  const vp = user.voice_profile || {};

  const outcomeLabels = {
    hot:      'Very positive — strong buying signals, clear interest',
    positive: 'Good conversation — solid progress made',
    neutral:  'OK meeting — some interest but unclear next steps',
    cold:     'Difficult meeting — low engagement or concerns raised',
    dead:     'Deal is likely dead — clear decline or no path forward',
  };

  const prompt = `Analyze this sales meeting and generate a structured debrief.

FOUNDER CONTEXT:
Product: ${user.product_description || 'not specified'}
ICP: ${vp.target_customer_description || user.target_audience || 'not specified'}
Main objection they typically face: ${vp.main_objection || 'not specified'}

MEETING:
Title: ${event.title}
Type: ${event.event_type || 'meeting'}
Attendee: ${event.attendee_name || 'Prospect'}

FOUNDER'S OUTCOME RATING: ${outcome} (${outcomeLabels[outcome] || outcome})

RAW MEETING NOTES FROM FOUNDER:
${rawNotes || '(No notes provided)'}

Generate a complete debrief. Be specific — extract exact details from the notes.

Return ONLY this JSON:
{
  "summary": "2-3 sentence narrative of what happened in the meeting",
  "what_worked": "One specific thing the founder did or said that landed well (if identifiable from notes)",
  "what_to_improve": "One concrete thing to do differently next time based on how this meeting went",
  "coachable_moment": "The single most important insight from this meeting — make it memorable",
  "next_step_recommendation": "Specific recommended next action with this prospect"
}`;

  const FALLBACK = {
    summary: `${outcome === 'hot' || outcome === 'positive' ? 'Strong meeting' : outcome === 'dead' ? 'Challenging meeting' : 'Meeting completed'} with ${event.attendee_name || 'prospect'}. Follow-up recommended.`,
    what_worked: 'You showed up prepared — that always matters.',
    what_to_improve: 'Next time, try to get a specific commitment before ending the call.',
    coachable_moment: 'The meeting outcome is set — what determines the deal is what you do in the next 48 hours.',
    next_step_recommendation: outcome === 'hot' ? 'Follow up within 24 hours while momentum is high.' : outcome === 'dead' ? 'Send a graceful close and ask for a referral.' : 'Send a follow-up that confirms one specific next action.',
  };

  try {
    const { content } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.5,
      maxTokens:   500,
      modelName:   PRO_MODEL,
    });
    const parsed = parseJSONObject(content, FALLBACK);
    if (!parsed.summary) return FALLBACK;
    return parsed;
  } catch (err) {
    console.error('[CalendarIntel] generateMeetingDebrief FAILED:', err.message);
    return FALLBACK;
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// 3. EXTRACT COMMITMENTS
// Fast extraction of promises from meeting notes or chat text.
// Uses cheap model — called frequently.
// ──────────────────────────────────────────────────────────────────────────────
export const extractCommitmentsFromText = async (text, attendeeName = 'Prospect') => {
  if (!text?.trim() || text.trim().length < 20) return [];

  const prompt = `Extract any commitments, promises, or action items from this text.
Look for: "I'll send...", "I'll follow up...", "Let me check...", "I'll introduce...", "send me...", "I'll share by...", "will review...", "going to...", "promised to..."

Text:
"${text.slice(0, 2000)}"

Attendee name: ${attendeeName}

Return ONLY a JSON array (empty array if none found):
[{"text": "the specific commitment", "owner": "founder" or "prospect", "implicit_due": "tomorrow|this week|this month|unclear"}]

Only include clear, actionable commitments — not vague intentions.`;

  try {
    const { content } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.1,
      maxTokens:   300,
      modelName:   PRIMARY_MODEL,
    });
    const results = parseJSONArray(content, []);
    return results.filter(c => c.text && c.owner && c.text.length > 5);
  } catch (err) {
    console.error('[CalendarIntel] extractCommitmentsFromText FAILED:', err.message);
    return [];
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// 4. SIGNAL ANALYSIS
// Detects buying/risk/timing/engagement signals from notes or conversation.
// ──────────────────────────────────────────────────────────────────────────────
export const generateSignalAnalysis = async (text, attendeeName = 'Prospect', outcome = null) => {
  if (!text?.trim() || text.trim().length < 20) return [];

  const prompt = `Analyze this sales meeting or conversation text for important signals.

Prospect: ${attendeeName}
Outcome: ${outcome || 'not specified'}

Text to analyze:
"${text.slice(0, 2000)}"

Signal types to detect:
- BUYING: Strong interest, asking about implementation/pricing/timeline, wanting to involve others
- RISK: Budget concerns, competitor mention, internal politics, timing issues, lack of decision power
- TIMING: Urgency signals, timeline constraints, decision deadlines, upcoming events
- ENGAGEMENT: Response quality, depth of questions asked, enthusiasm level

Return ONLY a JSON array (empty if no significant signals):
[{"type": "buying|risk|timing|engagement", "text": "what was said/observed that signals this", "confidence": 0.6-1.0}]

Only include signals that are genuinely meaningful for forecasting this deal.`;

  try {
    const { content } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.2,
      maxTokens:   400,
      modelName:   PRIMARY_MODEL,
    });
    const results = parseJSONArray(content, []);
    return results.filter(s =>
      ['buying', 'risk', 'timing', 'engagement'].includes(s.type) &&
      s.text && s.confidence >= 0.5
    );
  } catch (err) {
    console.error('[CalendarIntel] generateSignalAnalysis FAILED:', err.message);
    return [];
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// 5. POST-MEETING FOLLOW-UP GENERATOR
// Context-rich — knows exactly what was said, promised, and signalled.
// Returns 3 variants the founder can choose from.
// ──────────────────────────────────────────────────────────────────────────────
export const generatePostMeetingFollowUp = async (user, event, debrief, commitments, signals) => {
  const vp = user.voice_profile || {};

  const buyingSignals  = signals.filter(s => s.type === 'buying');
  const riskSignals    = signals.filter(s => s.type === 'risk');
  const founderOwes    = commitments.filter(c => c.owner === 'founder' && c.status === 'pending');
  const prospectOwes   = commitments.filter(c => c.owner === 'prospect' && c.status === 'pending');

  const signalContext = buyingSignals.length
    ? `STRONG BUYING SIGNALS DETECTED:\n${buyingSignals.map(s => `- ${s.text}`).join('\n')}`
    : riskSignals.length
    ? `RISK SIGNALS TO ADDRESS:\n${riskSignals.map(s => `- ${s.text}`).join('\n')}`
    : 'No strong signals detected in this meeting.';

  const commitmentContext = founderOwes.length
    ? `YOU PROMISED:\n${founderOwes.map(c => `- ${c.commitment_text}`).join('\n')}`
    : '';

  const prospectContext = prospectOwes.length
    ? `THEY SAID THEY WOULD:\n${prospectOwes.map(c => `- ${c.commitment_text}`).join('\n')}`
    : '';

  const prompt = `Write 3 follow-up message variants for a founder to send after this sales meeting.

FOUNDER VOICE:
Style: ${vp.voice_style || 'conversational, direct'}
Persona: ${vp.outreach_persona || 'genuine founder'}
Avoid: ${(vp.avoid_phrases || []).join(', ') || 'generic AI language'}

MEETING:
Title: ${event.title}
With: ${event.attendee_name || 'Prospect'}
Debrief summary: ${debrief?.summary || 'Meeting completed'}
Outcome: ${event.outcome || 'not specified'}

${signalContext}
${commitmentContext}
${prospectContext}

Write 3 variants — each for a different situation:
1. BRIEF: Short check-in (1-2 sentences). Good when meeting was neutral or you just want to stay on their radar.
2. SUBSTANTIVE: Proper follow-up that delivers on any promises made and reinforces the conversation's strongest moment. 3-4 sentences.
3. RE-ENGAGEMENT: Use if they go quiet. Gentle, value-first re-opener. 2-3 sentences.

Each message must:
- Sound like a real human, not a template
- Reference something specific from the meeting (use the debrief/signals/commitments)
- Have a clear, low-pressure next step
- Be under 80 words

Return ONLY this JSON:
{
  "brief": "message text",
  "substantive": "message text",
  "re_engagement": "message text"
}`;

  const FALLBACK = {
    brief: `Hey ${event.attendee_name || 'there'} — great talking today. Happy to answer any questions that come up.`,
    substantive: `Hey ${event.attendee_name || 'there'} — really appreciated our conversation. ${debrief?.summary ? 'Loved that we got to discuss your situation.' : 'Looking forward to following up on what we discussed.'} What would be the most useful next step from your side?`,
    re_engagement: `Hey ${event.attendee_name || 'there'} — wanted to check back in after our chat. Any thoughts since we last spoke? Happy to keep it low-key.`,
  };

  try {
    const { content } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.75,
      maxTokens:   500,
      modelName:   PRO_MODEL,
    });
    const parsed = parseJSONObject(content, FALLBACK);
    if (!parsed.brief || !parsed.substantive) return FALLBACK;
    return parsed;
  } catch (err) {
    console.error('[CalendarIntel] generatePostMeetingFollowUp FAILED:', err.message);
    return FALLBACK;
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// 6. MEETING NOTES MODE — AI PARTNER RESPONSE
// Called during live note-taking. Accepts a fragment → returns a short
// smart observation or clarifying question. Fast model only.
// ──────────────────────────────────────────────────────────────────────────────
export const generateMeetingNotesResponse = async (noteFragment, conversationHistory = [], eventContext = {}) => {
  const history = conversationHistory.slice(-6).map(m => ({
    role:    m.role,
    content: m.content,
  }));

  const systemPrompt = `You are a silent partner helping a founder capture notes DURING or RIGHT AFTER a live sales meeting.

MEETING CONTEXT:
Title: ${eventContext.title || 'Sales meeting'}
With: ${eventContext.attendee_name || 'prospect'}
Type: ${eventContext.event_type || 'meeting'}

YOUR JOB:
- Accept raw, fragmented notes from the founder
- Confirm you captured it in 1 short sentence
- Ask ONE smart follow-up question that would make the note more useful, OR
- Flag something important you noticed (buying signal, risk, missed question)
- If the founder types "done" or "end" or "finished": reply EXACTLY "__END_MEETING__"

RULES:
- Never lecture or give long responses
- 1-2 sentences MAXIMUM
- If a note mentions a number, pricing, timeline, or competitor — flag it
- If a note sounds like a buying signal — surface it briefly
- Sound like a sharp colleague, not an AI assistant`;

  // Check if founder is ending the meeting
  const trimmed = noteFragment.trim().toLowerCase();
  if (['done', 'end', 'finished', 'meeting over', 'that\'s it', 'end meeting'].some(k => trimmed.includes(k))) {
    return { content: '__END_MEETING__', is_end: true };
  }

  try {
    const { content } = await callGroq({
      systemPrompt,
      messages:    [...history, { role: 'user', content: noteFragment }],
      temperature: 0.6,
      maxTokens:   100,
      modelName:   PRIMARY_MODEL,
    });

    const isEnd = content.trim() === '__END_MEETING__';
    return { content: isEnd ? '__END_MEETING__' : content.trim(), is_end: isEnd };
  } catch (err) {
    console.error('[CalendarIntel] generateMeetingNotesResponse FAILED:', err.message);
    return { content: 'Got it. Anything else to capture?', is_end: false };
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// 7. SYNTHESIZE MEETING NOTES → DEBRIEF
// Called when founder ends a meeting notes session.
// Takes the full notes conversation and produces a structured summary.
// ──────────────────────────────────────────────────────────────────────────────
export const synthesizeMeetingNotes = async (user, event, noteMessages) => {
  const notesText = noteMessages
    .filter(m => m.role === 'user')
    .map(m => m.content)
    .join('\n');

  if (!notesText.trim()) {
    return { summary: 'No notes captured during this meeting.', commitments: [], signals: [] };
  }

  const [debrief, commitments, signals] = await Promise.all([
    generateMeetingDebrief(user, event, notesText, 'neutral'),
    extractCommitmentsFromText(notesText, event.attendee_name),
    generateSignalAnalysis(notesText, event.attendee_name, null),
  ]);

  return { summary: debrief.summary, full_debrief: debrief, commitments, signals };
};

// ──────────────────────────────────────────────────────────────────────────────
// 8. WEEKLY PATTERN INSIGHTS
// Analyzes across recent meetings/chats to find patterns worth surfacing.
// Called by patternInsightsJob — runs weekly.
// ──────────────────────────────────────────────────────────────────────────────
export const generateWeeklyPatternInsights = async (user, analysisData) => {
  const {
    recentDebriefs       = [],
    signalFrequency      = {},
    commitmentStats      = {},
    stageProgressions    = [],
    repeatQuestions      = [],
  } = analysisData;

  if (!recentDebriefs.length && !repeatQuestions.length) return [];

  const debriefSummaries = recentDebriefs.slice(0, 10).map((d, i) =>
    `Meeting ${i + 1}: ${d.outcome || 'unknown'} outcome. Notes: ${(d.meeting_notes || '').slice(0, 150)}`
  ).join('\n');

  const questionsText = repeatQuestions.length
    ? `REPEATED QUESTIONS/TOPICS (appeared 2+ times):\n${repeatQuestions.map(q => `- "${q.topic}" (${q.count}x)`).join('\n')}`
    : '';

  const stageText = stageProgressions.length
    ? `STAGE PROGRESSION DATA:\n${stageProgressions.map(s => `- ${s.from_stage} → ${s.to_stage}: ${s.count} times`).join('\n')}`
    : '';

  const commitmentText = commitmentStats.total
    ? `COMMITMENT STATS:\n- Total made: ${commitmentStats.total}\n- Completed on time: ${commitmentStats.completed}\n- Overdue: ${commitmentStats.overdue}`
    : '';

  const prompt = `You are an AI advisor analyzing a founder's recent sales meetings and conversations to find actionable patterns.

FOUNDER:
Product: ${user.product_description || 'not specified'}
ICP: ${user.voice_profile?.target_customer_description || user.target_audience || 'not specified'}

RECENT MEETING OUTCOMES (last 30 days):
${debriefSummaries || '(No debriefs logged)'}

${questionsText}
${stageText}
${commitmentText}

Identify 2-4 genuinely useful insights from this data.
Each insight must be:
- Specific to THIS founder's data (reference actual patterns you see)
- Actionable — include a concrete suggested action
- Honest — if something is working, say so; if something is hurting deals, say that too

Return ONLY a JSON array:
[{
  "type": "pattern|stall|question_cluster|timing_alert|win_pattern",
  "title": "Short punchy title (under 10 words)",
  "body": "2-3 sentences explaining what you noticed and why it matters",
  "suggested_action": "One specific thing to do this week",
  "affected_count": <number of meetings/prospects this applies to>
}]

Return an empty array [] if there's not enough data for meaningful insights.`;

  try {
    const { content } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.4,
      maxTokens:   600,
      modelName:   PRO_MODEL,
    });
    const results = parseJSONArray(content, []);
    return results.filter(i => i.title && i.body && i.type);
  } catch (err) {
    console.error('[CalendarIntel] generateWeeklyPatternInsights FAILED:', err.message);
    return [];
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// 9. ENRICH PREP WITH PERPLEXITY RESEARCH
// Takes raw Perplexity response and formats it into a structured research brief.
// ──────────────────────────────────────────────────────────────────────────────
export const enrichPrepWithResearch = async (user, event, perplexityContent) => {
  if (!perplexityContent?.trim()) return null;

  const prompt = `A founder is about to meet with "${event.attendee_name || 'a prospect'}".
You have research about them and their company below.

Extract the 2-4 most USEFUL pieces of information that would:
1. Give the founder a conversation hook or opening angle
2. Flag a potential objection or timing issue
3. Reveal a recent event that creates urgency or relevance
4. Help them personalize their pitch

FOUNDER'S PRODUCT: ${user.product_description || 'not specified'}
MEETING TYPE: ${event.event_type || 'meeting'}

RAW RESEARCH:
${perplexityContent.slice(0, 2000)}

Return ONLY this JSON:
{
  "summary": "1-2 sentence intelligence brief the founder should know",
  "bullets": ["Key point 1 with direct implication", "Key point 2", "Key point 3 (optional)"],
  "urgency_signal": "Any timing-based reason this conversation matters right now, or null",
  "conversation_hook": "One specific thing to reference that shows you did your homework, or null"
}`;

  try {
    const { content } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.3,
      maxTokens:   350,
      modelName:   PRIMARY_MODEL,
    });
    return parseJSONObject(content, null);
  } catch (err) {
    console.error('[CalendarIntel] enrichPrepWithResearch FAILED:', err.message);
    return null;
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// 10. PROSPECT RELATIONSHIP SUMMARY
// Generates an AI-written narrative of the entire relationship history.
// Called when prospect profile is viewed — cached on the prospects record.
// ──────────────────────────────────────────────────────────────────────────────
export const generateProspectSummary = async (user, prospect, timeline) => {
  if (!timeline?.length) {
    return `No interactions recorded yet with ${prospect.name}. Add a meeting or start a conversation to begin building relationship history.`;
  }

  const timelineText = timeline.slice(0, 15).map(item => {
    if (item.type === 'event') return `[MEETING] ${item.date}: ${item.title} — Outcome: ${item.outcome || 'no debrief'}`;
    if (item.type === 'chat')  return `[CHAT] ${item.date}: ${item.message_count || 0} messages`;
    if (item.type === 'signal') return `[SIGNAL] ${item.date}: ${item.signal_type?.toUpperCase()} — ${item.signal_text}`;
    return null;
  }).filter(Boolean).join('\n');

  const prompt = `Write a brief, honest narrative summary of a founder's relationship with this prospect.

PROSPECT: ${prospect.name}${prospect.company ? ` at ${prospect.company}` : ''}
HEALTH SCORE: ${prospect.relationship_health_score || 50}/100

INTERACTION TIMELINE:
${timelineText}

Write 2-3 sentences that capture:
- Where the relationship is right now (honest assessment)
- Any notable signals or patterns
- What the founder's most important next move is

Sound like a sharp advisor, not a report generator. Be direct.`;

  try {
    const { content } = await callGroq({
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.5,
      maxTokens:   200,
      modelName:   PRIMARY_MODEL,
    });
    return content.trim() || `${timeline.length} interactions recorded with ${prospect.name}. Review the timeline for details.`;
  } catch (err) {
    console.error('[CalendarIntel] generateProspectSummary FAILED:', err.message);
    return `${timeline.length} interactions recorded with ${prospect.name}.`;
  }
};
