// src/services/exaCalendar.js
// ============================================================
// EXA PRE-MEETING RESEARCH
// Replaces perplexityCalendar.js.
//
// IMPORTANT FINDING (documented, not guessed): the old perplexityCalendar.js
// was NOT actually using Exa despite living in a codebase that claims to
// have migrated off Perplexity. It used `axios` to call Perplexity's real
// `/chat/completions` endpoint directly with PERPLEXITY_API_KEY/sonar-pro —
// a separate, parallel integration that perplexity.js's own migration never
// touched. This file replaces that axios/chat-completions call with a real
// Exa neural search (matching exa.js's searchForChat pattern: search via
// Exa, then synthesize the structured brief via Groq through
// enrichPrepWithResearch, which already exists in groqCalendarIntelligence.js
// and needs no changes).
//
// Storage note: `user_events.perplexity_research` keeps its existing column
// name. Renaming it is a pure cosmetic follow-up (touches backgroundWorker.js
// and calendar.js's buildPrepContext reads) — not done here to avoid
// unrelated churn; flagged in CHANGES.md if you want it later.
// ============================================================

import supabaseAdmin from '../config/supabase.js';
import Exa from 'exa-js';
import { enrichPrepWithResearch } from './groqCalendarIntelligence.js';
import { checkWorkspaceExaUsage, recordExaUsage } from './tokenTracker.js';

const EXA_API_KEY   = process.env.EXA_API_KEY;
const EXA_AVAILABLE = !!(EXA_API_KEY?.trim());
const exaClient      = EXA_AVAILABLE ? new Exa(EXA_API_KEY) : null;

const buildResearchQuery = (event, user) => {
  const parts = [];
  if (event.attendee_name)    parts.push(event.attendee_name);
  if (event.attendee_context) parts.push(event.attendee_context.slice(0, 150));
  parts.push(user.industry || '');
  return parts.filter(Boolean).join(' ');
};

// ──────────────────────────────────────────────────────────────
// MAIN EXPORT — researchProspectForMeeting
// ──────────────────────────────────────────────────────────────
export const researchProspectForMeeting = async (userId, workspaceId, eventId, event, user) => {
  const meetingDate = new Date(event.start_time || event.event_date);
  if (meetingDate < new Date()) {
    console.log(`[ExaCalendar] Skipping research for past event ${eventId}`);
    return;
  }

  const hasContext = event.attendee_name || event.attendee_context;
  if (!hasContext) {
    console.log(`[ExaCalendar] Skipping research — no attendee context for event ${eventId}`);
    return;
  }

  if (event.research_generated_at) {
    console.log(`[ExaCalendar] Research already done for event ${eventId}`);
    return;
  }

  const usageCheck = await checkWorkspaceExaUsage(workspaceId, user.tier || 'free');
  if (!usageCheck.allowed) {
    console.log(`[ExaCalendar] Workspace quota exceeded for ${workspaceId} (${usageCheck.reason}) — skipping research`);
    return;
  }

  if (!EXA_AVAILABLE) {
    console.log('[ExaCalendar] EXA_API_KEY not configured — skipping research');
    return;
  }

  let rawContent = null;

  try {
    const query  = buildResearchQuery(event, user);
    const result = await exaClient.searchAndContents(query, {
      type: 'neural',
      numResults: 5,
      text: { maxCharacters: 800 },
      useAutoprompt: true,
    });

    const results = result.results || [];
    rawContent = results.map(r => `[${r.title || r.url}]\n${r.text || ''}`).join('\n\n');

    await recordExaUsage({ workspaceId, userId, creditsUsed: 1, sourceJob: 'calendar_research_prospect' });

    console.log(`[ExaCalendar] Research complete for event ${eventId}`);
  } catch (err) {
    console.warn(`[ExaCalendar] Exa search failed for event ${eventId}: ${err.message} — skipping research`);
    return;
  }

  if (!rawContent?.trim()) return;

  const structured = await enrichPrepWithResearch(user, event, rawContent).catch(() => null);
  if (!structured) return;

  await supabaseAdmin
    .from('user_events')
    .update({
      perplexity_research:   structured,
      research_generated_at: new Date().toISOString(),
    })
    .eq('id', eventId)
    .eq('workspace_id', workspaceId);
};

export default { researchProspectForMeeting };
