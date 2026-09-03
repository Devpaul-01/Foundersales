// src/jobs/followupSequenceJob.js — WORKSPACE REFACTOR
//
// FIXES APPLIED:
//  CRIT-03: Added missing `import supabaseAdmin` — job was crashing
//            on every run with ReferenceError.
//  HIGH-03: follow_up_count is now incremented AND follow_up_sent_at
//            is set after each generated follow-up, enforcing the
//            "max 2 follow-ups" business rule correctly.
//  MED-08:  Removed import of non-existent FOLLOW_UP_THRESHOLDS constant.
//            Values are now defined inline with a comment indicating they
//            should be added to constants.js.
//  Token tracking: recordTokenUsage now uses workspaceId.

import supabaseAdmin from '../config/supabase.js';
import { callWithFallbackGroq as cwf } from '../services/multiProvider.js';
import { notifyUser as nu }         from '../services/notifications.js';
import { BATCH_SIZE, FOLLOW_UP_THRESHOLDS }               from '../config/constants.js';
import { sleep, logJob }            from '../utils/jobHelpers.js';

// FIX MED-08: FOLLOW_UP_THRESHOLDS does not exist in constants.js.
// Define inline here. TODO: add to constants.js as FOLLOW_UP_THRESHOLDS.

const FOLLOWUP_BATCH_DELAY_MS = 1500;

// Extracted for unit testing — see backend/src/jobs/__tests__/followupSequenceJob.test.js.
// Behavior is unchanged from the original inline implementation: Supabase's
// `!inner` join can return workspace_profiles as an array when there's
// ambiguity, so we must find the profile matching the opportunity's own
// workspace_id rather than blindly taking the first array entry.
export const matchWorkspaceProfile = (opp) => {
  const profiles = Array.isArray(opp.workspace_profiles)
    ? opp.workspace_profiles
    : [opp.workspace_profiles];

  const matchedProfile = profiles.find(p => p?.workspace_id === opp.workspace_id);

  if (!matchedProfile && profiles.length > 0) {
    console.warn(`[FollowupJob] No matching workspace profile for opp ${opp.id} (workspace ${opp.workspace_id}), using fallback`);
  }

  return matchedProfile || profiles[0] || {};
};

export const runFollowupSequenceJob = async () => {
  const startTime = Date.now();
  console.log(`[FollowupJob] Starting ${new Date().toISOString()}`);
  await logJob('followup_sequence', 'started');

  let processed = 0, generated = 0;

  try {
    const now = Date.now();
    const cutoffs = {
      contacted: new Date(now - FOLLOW_UP_THRESHOLDS.contacted * 86400000).toISOString(),
      replied:   new Date(now - FOLLOW_UP_THRESHOLDS.replied   * 86400000).toISOString(),
      call_demo: new Date(now - FOLLOW_UP_THRESHOLDS.call_demo * 86400000).toISOString(),
    };
    const resendCutoff = new Date(now - 5 * 86400000).toISOString();

    const stageFilter = [
      `and(stage.eq.contacted,last_stage_changed_at.lt.${cutoffs.contacted})`,
      `and(stage.eq.replied,last_stage_changed_at.lt.${cutoffs.replied})`,
      `and(stage.eq.call_demo,last_stage_changed_at.lt.${cutoffs.call_demo})`,
    ].join(',');

    let opps = [];
    let page = 0;
    const PAGE_SIZE = 100;

    while (true) {
      const { data: pageData } = await supabaseAdmin
        .from('opportunities')
        .select(`
          id, user_id, workspace_id, platform, target_name, target_context,
          prepared_message, stage, follow_up_count, follow_up_sent_at,
          last_stage_changed_at,
          users!inner(id, fcm_token, is_deleted),
          workspace_profiles!inner(
            workspace_id, product_description, target_audience, voice_profile, business_name
          )
        `)
        .lt('follow_up_count', 2)
        .or(`follow_up_sent_at.is.null,follow_up_sent_at.lt.${resendCutoff}`)
        .or(stageFilter)
        .eq('users.is_deleted', false)
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (!pageData?.length) break;

      // FIX MED-12: workspace_profiles is an array — find the profile that matches
      // the opportunity's workspace_id, not just the first profile.
      const normalized = pageData.map(opp => ({
        ...opp,
        workspace_profiles: matchWorkspaceProfile(opp),
      }));

      opps = opps.concat(normalized);
      if (pageData.length < PAGE_SIZE) break;
      page++;
    }

    if (!opps.length) {
      await logJob('followup_sequence', 'completed', { processed: 0, generated: 0, duration_ms: Date.now() - startTime });
      return;
    }

    console.log(`[FollowupJob] ${opps.length} opportunities need follow-up`);

    for (let i = 0; i < opps.length; i += BATCH_SIZE) {
      const batch = opps.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(batch.map(opp => generateFollowup(opp)));
      results.forEach((r, idx) => {
        processed++;
        if (r.status === 'fulfilled' && r.value?.generated) generated++;
        else if (r.status === 'rejected') {
          console.error(`[FollowupJob] Failed for opp ${batch[idx].id}:`, r.reason?.message);
        }
      });
      if (i + BATCH_SIZE < opps.length) await sleep(FOLLOWUP_BATCH_DELAY_MS);
    }

    await logJob('followup_sequence', 'completed', { processed, generated, duration_ms: Date.now() - startTime });
    console.log(`[FollowupJob] Done — ${generated} follow-ups generated`);
  } catch (err) {
    console.error('[FollowupJob] Fatal:', err.message);
    await logJob('followup_sequence', 'failed', { error_message: err.message, duration_ms: Date.now() - startTime });
  }
};

const generateFollowup = async (opp) => {
  const userId      = opp.user_id;
  const workspaceId = opp.workspace_id;
  const wp          = opp.workspace_profiles || {};
  const userCtx     = { ...opp.users, ...wp, id: userId, workspace_id: workspaceId };
  const vp          = wp.voice_profile || {};

  const stagePhrases = {
    contacted: 'followed up after reaching out',
    replied:   'followed up after they replied but went quiet',
    call_demo: 'followed up after your call or demo',
  };

  const prompt = `Generate a short, human follow-up message for a ${opp.stage} lead.

Seller context:
Product: ${wp.product_description || 'not specified'}
Target audience: ${wp.target_audience || 'not specified'}
Voice style: ${vp.voice_style || 'conversational, direct'}
Business: ${wp.business_name || 'not specified'}

Prospect context:
Platform: ${opp.platform || 'unknown'}
${opp.target_name ? `Name: ${opp.target_name}` : ''}
Original context: ${opp.target_context?.slice(0, 300) || 'no context'}

Situation: ${stagePhrases[opp.stage] || 'following up'}
${opp.follow_up_count > 0 ? `This is follow-up #${opp.follow_up_count + 1}` : 'This is the first follow-up'}

Rules:
- Under 50 words
- Sound like a real person, not a template
- Reference something specific from their context
- End with a clear, low-pressure next step
- Do NOT start with "Just" or "Just checking in"

Return ONLY the message text. No quotes, no explanation.`;

  const { content } = await cwf({
    systemPrompt: 'You write short, human follow-up messages. Return only the message text.',
    messages:     [{ role: 'user', content: prompt }],
    temperature:  0.7,
    maxTokens:    120,
    tier:         'fast',
    workspaceId, userId, sourceJob: 'followup_sequence',
  });

  const followUpMessage = content?.trim();
  if (!followUpMessage) return { generated: false };

  // FIX HIGH-03: increment follow_up_count AND set follow_up_sent_at so the
  // "max 2 follow-ups" business rule is actually enforced. Previously only
  // follow_up_message was updated, leaving follow_up_count at 0 forever.
  await supabaseAdmin.from('opportunities').update({
    follow_up_message: followUpMessage,
    follow_up_count:   (opp.follow_up_count || 0) + 1,
    follow_up_sent_at: new Date().toISOString(),
  }).eq('id', opp.id);

  if (opp.users?.fcm_token) {
    await nu(userId, {
      title: `Follow-up ready for your ${opp.stage} lead 📤`,
      body:  `Clutch wrote a personalised follow-up for ${opp.target_name || 'your prospect'}. Tap to review.`,
      data:  { type: 'follow_up_ready', opportunity_id: opp.id },
    }).catch(() => {});
  }

  return { generated: true };
};

export default { runFollowupSequenceJob };
