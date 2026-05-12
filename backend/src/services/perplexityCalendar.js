// src/services/perplexityCalendar.js
// ============================================================
// PERPLEXITY PRE-MEETING RESEARCH — WORKSPACE REFACTOR
//
// CHANGES:
//  - researchProspectForMeeting() now accepts workspaceId param
//  - Uses workspace-level Perplexity quota check (Option A)
//  - user param is now the merged userContext (identity + workspaceProfile)
//    so product_description, industry are read correctly
//  - incrementWorkspaceUsage() called instead of per-user increment
// ============================================================

import axios from 'axios';
import supabaseAdmin from '../config/supabase.js';
import { enrichPrepWithResearch } from './groqCalendarIntelligence.js';
import { recordTokenUsage } from './tokenTracker.js';
import { checkWorkspacePerplexityUsage, incrementWorkspaceUsage } from './perplexity.js';

const PERPLEXITY_API_KEY   = process.env.PERPLEXITY_API_KEY;
const PERPLEXITY_AVAILABLE = !!(PERPLEXITY_API_KEY?.trim());

const perplexityClient = PERPLEXITY_AVAILABLE
  ? axios.create({
      baseURL: process.env.PERPLEXITY_API_URL || 'https://api.perplexity.ai',
      headers: { 'Authorization': `Bearer ${PERPLEXITY_API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 30000,
    })
  : null;

// ── Build research query (reads product context from merged user object) ──
const buildResearchQuery = (event, user) => {
  const parts = [];
  if (event.attendee_name)    parts.push(`information about ${event.attendee_name}`);
  if (event.attendee_context) parts.push(`context: ${event.attendee_context.slice(0, 200)}`);

  const industry = user.industry || '';
  const product  = user.product_description || '';

  return `Find recent, relevant information for a sales meeting.
Attendee/company: ${event.attendee_name || 'unknown'}
${event.attendee_context ? `Background: ${event.attendee_context.slice(0, 300)}` : ''}
Meeting type: ${event.event_type || 'meeting'}
Founder sells: ${product.slice(0, 150)}
Industry: ${industry}

Please find:
1. Any recent news about this person or their company (last 6 months)
2. Current challenges or trends in their industry that are relevant to this meeting
3. Any signals of growth, change, or pain that make this meeting timely
4. One specific, credible fact the founder could reference to show they did their homework

Keep it concise and actionable — the founder reads this 10 minutes before the meeting.`;
};

// ──────────────────────────────────────────────────────────────
// MAIN EXPORT — researchProspectForMeeting
// WORKSPACE REFACTOR: accepts workspaceId, checks workspace quota
// user param = merged context from buildUserContext(req)
// ──────────────────────────────────────────────────────────────
export const researchProspectForMeeting = async (userId, workspaceId, eventId, event, user) => {
  // Skip if meeting is in the past
  const meetingDate = new Date(event.start_time || event.event_date);
  if (meetingDate < new Date()) {
    console.log(`[PerplexityCalendar] Skipping research for past event ${eventId}`);
    return;
  }

  // Skip if no useful context to research
  const hasContext = event.attendee_name || event.attendee_context;
  if (!hasContext) {
    console.log(`[PerplexityCalendar] Skipping research — no attendee context for event ${eventId}`);
    return;
  }

  // Skip if research already done
  if (event.research_generated_at) {
    console.log(`[PerplexityCalendar] Research already done for event ${eventId}`);
    return;
  }

  // Check workspace-level quota (Option A: pooled)
  const workspacePlan = user.tier || 'free';
  const usageCheck = await checkWorkspacePerplexityUsage(workspaceId, workspacePlan);
  if (!usageCheck.allowed) {
    console.log(`[PerplexityCalendar] Workspace quota exceeded for ${workspaceId} — skipping research`);
    return;
  }

  let rawContent = null;

  if (PERPLEXITY_AVAILABLE) {
    try {
      const query = buildResearchQuery(event, user);
      const response = await perplexityClient.post('/chat/completions', {
        model:       process.env.PERPLEXITY_MODEL || 'sonar-pro',
        messages:    [{ role: 'user', content: query }],
        max_tokens:  600,
        temperature: 0.2,
      });

      rawContent = response.data.choices?.[0]?.message?.content || null;

      // Track token usage per user
      const tokensOut = response.data.usage?.completion_tokens || Math.ceil((rawContent?.length || 0) / 4);
      await recordTokenUsage(userId, 'perplexity', 0, tokensOut).catch(() => {});

      // Increment workspace-level quota
      await incrementWorkspaceUsage(workspaceId).catch(() => {});

      console.log(`[PerplexityCalendar] Research complete for event ${eventId}`);
    } catch (err) {
      console.warn(`[PerplexityCalendar] Perplexity failed for event ${eventId}: ${err.message} — skipping research`);
    }
  }

  if (!rawContent) return;

  // Enrich raw Perplexity output with Groq
  const structured = await enrichPrepWithResearch(user, event, rawContent).catch(() => null);
  if (!structured) return;

  // Save to the event — scoped to workspace
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
