// src/services/calendarCommitmentsSignals.js
// ============================================================
// MERGED COMMITMENT + SIGNAL EXTRACTION
//
// Previously, every debrief with notes fired TWO independent Groq calls
// on the same input text: extractCommitmentsFromText() and
// generateSignalAnalysis() (both in groqCalendarIntelligence.js). This
// module replaces both call sites with ONE call that returns both arrays
// — the single highest-value AI cost optimization identified, since
// debrief submission is the highest-frequency AI trigger in the feature.
//
// extractCommitmentsFromText / generateSignalAnalysis in
// groqCalendarIntelligence.js are left in place (still used by
// synthesizeMeetingNotes and any other call sites outside Calendar's
// debrief flow) — this module is additive, not a replacement of those
// exports.
// ============================================================

import { callWithFallbackGroq } from './multiProvider.js';
import { parseJSONObject } from '../utils/parser.js';
import { shouldExtractCommitmentsSignals, recordGateDecision } from './calendarAiGate.js';

const IMPLICIT_DUE_TO_DAYS = { tomorrow: 1, 'this week': 5, 'this month': 21, unclear: null };

const resolveImplicitDue = (implicitDue) => {
  const offsetDays = IMPLICIT_DUE_TO_DAYS[implicitDue] ?? null;
  return offsetDays != null
    ? new Date(Date.now() + offsetDays * 86400000).toISOString().split('T')[0]
    : null;
};

/**
 * Extracts commitments AND signals from meeting text in a single Groq call.
 * existingOpenCommitments (optional) lets the model recognize an already-
 * tracked commitment ("I'll send the proposal") instead of duplicating it
 * as a new row every time it's mentioned across multiple meetings.
 */
export const extractCommitmentsAndSignals = async (
  text,
  attendeeName = 'Prospect',
  outcome = null,
  existingOpenCommitments = [],
  { workspaceId, userId, eventId } = {},
) => {
  const gate = shouldExtractCommitmentsSignals(text);
  await recordGateDecision({
    workspaceId, userId, eventId, aiFunction: 'extract_commitments_signals', gateResult: gate,
  });
  if (!gate.proceed) return { commitments: [], signals: [] };

  const existingText = existingOpenCommitments.length
    ? `\n\nALREADY-TRACKED OPEN COMMITMENTS (do not create duplicates of these — only extract NEW commitments not already listed):\n${existingOpenCommitments.map(c => `- ${c.commitment_text}`).join('\n')}`
    : '';

  const prompt = `Analyze this sales meeting text for BOTH commitments/promises AND buying/risk/timing/engagement signals in one pass.

Text:
"${text.slice(0, 2000)}"

Attendee: ${attendeeName}
Outcome: ${outcome || 'not specified'}
${existingText}

Signal types:
- BUYING: strong interest, asking about implementation/pricing/timeline
- RISK: budget concerns, competitor mention, internal politics, lack of decision power
- TIMING: urgency signals, deadlines, upcoming events
- ENGAGEMENT: response quality, depth of questions, enthusiasm

Return ONLY this JSON (both arrays may be empty):
{
  "commitments": [{"commitment_text": "...", "owner": "founder"|"prospect", "implicit_due": "tomorrow|this week|this month|unclear"}],
  "signals": [{"signal_type": "buying|risk|timing|engagement", "signal_text": "...", "confidence": 0.6}]
}
Only include clear, actionable NEW commitments and genuinely meaningful signals.`;

  try {
    const { content } = await callWithFallbackGroq({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.15,
      maxTokens: 1000,
      tier: 'fast',
      workspaceId, userId,
      sourceJob: 'extract_commitments_and_signals',
    });

    const parsed = parseJSONObject(content, { commitments: [], signals: [] });

    const commitments = (parsed.commitments || [])
      .filter(c => c.commitment_text && c.owner && c.commitment_text.length > 5)
      .map(c => ({
        commitment_text: c.commitment_text,
        owner: c.owner,
        due_date: resolveImplicitDue(c.implicit_due),
      }));

    const signals = (parsed.signals || []).filter(s =>
      ['buying', 'risk', 'timing', 'engagement'].includes(s.signal_type) &&
      s.signal_text && s.confidence >= 0.5
    );

    return { commitments, signals };
  } catch (err) {
    console.error('[CalendarCommitmentsSignals] extractCommitmentsAndSignals FAILED:', err.message);
    return { commitments: [], signals: [] };
  }
};

export default { extractCommitmentsAndSignals };
