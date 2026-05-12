// src/jobs/emailDigestJob.js — WORKSPACE REFACTOR
//
// FIXES APPLIED:
//  CRIT-02: Added missing `import supabaseAdmin` — job was crashing on
//            every Sunday run with ReferenceError before writing a single row.
//  HIGH-12: Fixed double `.data` access bug.
//            `currentSkill` and `prevSkill` are already destructured from
//            `.data`, so `currentSkill?.data?.composite_score_avg` was always
//            undefined. Changed to `currentSkill?.composite_score_avg`.
//            The skill movement section of every digest now shows real deltas.
//  Token tracking: recordTokenUsage now uses workspaceId (workspace-level
//            tracking per business requirement).

import nodemailer from 'nodemailer';
import { Resend }  from 'resend';
import { callWithFallback as cwfDigest } from '../services/multiProvider.js';
import { recordTokenUsage as rtuDigest } from '../services/tokenTracker.js';
import { searchForChat, checkPerplexityUsage, incrementUsage } from '../services/perplexity.js';
import { BATCH_DELAY_MS } from '../config/constants.js';
import supabaseAdmin from '../config/supabase.js';
import { sleep, logJob } from '../utils/jobHelpers.js';

const BATCH_SIZE4   = 10;
const FRONTEND_URL4 = process.env.FRONTEND_URL || 'https://app.clutch.ai';

let gmailTransport = null;
let resendClient   = null;
const getGmailTransport = () => {
  if (!gmailTransport && process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    gmailTransport = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 587, secure: false,
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });
  }
  return gmailTransport;
};
const getResendClient = () => {
  if (!resendClient && process.env.RESEND_API_KEY) resendClient = new Resend(process.env.RESEND_API_KEY);
  return resendClient;
};

export const runEmailDigestJob = async () => {
  const startTime = Date.now();
  console.log(`[EmailDigest] Starting V4 Intelligence Brief ${new Date().toISOString()}`);
  await logJob('email_digest', 'started');
  let sent = 0, failed = 0;

  try {
    const { data: users } = await supabaseAdmin
      .from('users')
      .select(`
        id, name, email, tier, email_digest_enabled, active_workspace_id,
        workspace_profiles!inner(
          workspace_id, product_description, target_audience, industry,
          archetype, business_name
        )
      `)
      .eq('is_deleted', false)
      .eq('email_digest_enabled', true)
      .not('email', 'is', null)
      .not('active_workspace_id', 'is', null);

    if (!users?.length) {
      await logJob('email_digest', 'completed', { sent: 0, failed: 0, duration_ms: Date.now() - startTime });
      return;
    }

    // workspace_profiles is an array from Supabase — find the one matching active_workspace_id
    const eligible = users
      .map(u => {
        const profiles = Array.isArray(u.workspace_profiles) ? u.workspace_profiles : [u.workspace_profiles];
        const wp = profiles.find(p => p?.workspace_id === u.active_workspace_id) || profiles[0];
        return wp?.product_description ? { ...u, workspace_profiles: wp } : null;
      })
      .filter(Boolean);

    console.log(`[EmailDigest] Sending to ${eligible.length} users`);

    for (let i = 0; i < eligible.length; i += BATCH_SIZE4) {
      const batch   = eligible.slice(i, i + BATCH_SIZE4);
      const results = await Promise.allSettled(batch.map(user => sendDigestForUser(user)));
      results.forEach((r, idx) => {
        if (r.status === 'fulfilled') sent++;
        else { failed++; console.error(`[EmailDigest] Failed for ${batch[idx].email}:`, r.reason?.message); }
      });
      if (i + BATCH_SIZE4 < eligible.length) await sleep(BATCH_DELAY_MS);
    }

    await logJob('email_digest', 'completed', { sent, failed, duration_ms: Date.now() - startTime });
    console.log(`[EmailDigest] Done — ${sent} sent, ${failed} failed`);
  } catch (err) {
    console.error('[EmailDigest] Fatal:', err.message);
    await logJob('email_digest', 'failed', { error_message: err.message, duration_ms: Date.now() - startTime });
  }
};

const sendDigestForUser = async (user) => {
  const userId      = user.id;
  const workspaceId = user.active_workspace_id;
  const wp          = user.workspace_profiles || {};

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const [
    { data: weekAnalyses },
    { data: currentSkill },
    { data: prevSkill },
    { data: patterns },
    { data: sentOpps },
    { data: feedback },
  ] = await Promise.all([
    supabaseAdmin.from('conversation_analyses').select('*').eq('workspace_id', workspaceId).eq('user_id', userId).gte('created_at', sevenDaysAgo),
    supabaseAdmin.from('skill_progression').select('*').eq('workspace_id', workspaceId).eq('user_id', userId).order('week_start', { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from('skill_progression').select('composite_score_avg').eq('workspace_id', workspaceId).eq('user_id', userId).lt('week_start', new Date().toISOString().split('T')[0]).order('week_start', { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from('communication_patterns').select('pattern_label, pattern_detail, recommendation').eq('workspace_id', workspaceId).eq('user_id', userId).eq('is_active', true).order('confidence_score', { ascending: false }).limit(3),
    supabaseAdmin.from('opportunities').select('platform, marked_sent_at').eq('workspace_id', workspaceId).eq('user_id', userId).not('marked_sent_at', 'is', null).gte('marked_sent_at', sevenDaysAgo),
    supabaseAdmin.from('feedback').select('outcome').eq('workspace_id', workspaceId).eq('user_id', userId).gte('created_at', sevenDaysAgo),
  ]);

  if (!weekAnalyses?.length && !sentOpps?.length) return;

  const positiveCount = (feedback || []).filter(f => f.outcome === 'positive').length;
  const totalFeedback = (feedback || []).length;
  const positiveRate  = totalFeedback > 0 ? Math.round(positiveCount / totalFeedback * 100) : 0;

  // FIX HIGH-12: currentSkill and prevSkill are already the .data value
  // (destructured above). Do NOT add .data again — that was the bug.
  const compositeDelta =
    currentSkill?.composite_score_avg != null && prevSkill?.composite_score_avg != null
      ? parseFloat((currentSkill.composite_score_avg - prevSkill.composite_score_avg).toFixed(2))
      : null;

  const avg = (arr, field) => {
    const vals = (arr || []).filter(a => a[field] != null).map(a => a[field]);
    return vals.length ? (vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(1) : 'N/A';
  };

  const positiveAnalyses = (weekAnalyses || []).filter(a => a.outcome === 'positive');

  // Perplexity market intel (pro/enterprise only, per-user quota)
  let marketIntel = null;
  if (user.tier === 'pro' || user.tier === 'enterprise') {
    const usageCheck = await checkPerplexityUsage(userId, user.tier);
    if (usageCheck.allowed && wp.target_audience) {
      try {
        const { content } = await searchForChat(
          `What are the most effective cold outreach approaches for ${wp.target_audience} in ${new Date().getFullYear()}?`,
          'Find specific, data-backed insights about effective outreach messaging for this audience.'
        );
        if (content?.trim()) {
          marketIntel = content.slice(0, 400);
          await incrementUsage(userId).catch(() => {});
        }
      } catch { /* non-fatal */ }
    }
  }

  const digestPrompt = `Generate a Strategic Intelligence Brief for a seller's weekly email digest.

SELLER CONTEXT:
Product: ${wp.product_description || 'not specified'}
Target audience: ${wp.target_audience || 'not specified'}
Name: ${user.name || 'there'}

WEEK ACTIVITY:
Messages sent: ${sentOpps?.length || 0}
Outcomes tracked: ${totalFeedback} (${positiveRate}% positive)
Messages analyzed: ${weekAnalyses?.length || 0}

SKILL SCORES THIS WEEK:
Composite: ${currentSkill?.composite_score_avg || 'N/A'}/10
Delta vs last week: ${compositeDelta != null ? (compositeDelta > 0 ? '+' : '') + compositeDelta : 'N/A'}
Weakest: ${currentSkill?.top_weakness || 'N/A'}
Strongest: ${currentSkill?.top_strength || 'N/A'}

WINNING MESSAGE PATTERNS:
Hook avg: ${avg(positiveAnalyses, 'hook_score')}/10
Personalization avg: ${avg(positiveAnalyses, 'personalization_score')}/10
CTA avg: ${avg(positiveAnalyses, 'cta_score')}/10

COMMUNICATION PATTERNS DETECTED:
${(patterns || []).map(p => `• ${p.pattern_label}: ${p.pattern_detail}`).join('\n') || 'None yet'}

${marketIntel ? `MARKET INTEL:\n${marketIntel}` : ''}

Generate a concise, specific email digest with:
1. ONE headline insight from this week's data
2. THE ONE THING to fix this week (specific to their data, not generic)
3. What's working (from winning messages)
4. A data-based encouraging note

Return ONLY JSON:
{
  "subject": "Your weekly sales brief — [one specific insight]",
  "headline": "1-2 sentences: the most important thing from this week",
  "one_thing": "specific, evidence-based action item",
  "whats_working": "what pattern/element is driving wins",
  "encouragement": "data-specific genuine note (not generic praise)",
  "skill_summary": "one sentence on skill movement"
}`;

  const { content, tokens_in, tokens_out } = await cwfDigest({
    systemPrompt: 'You generate strategic sales intelligence briefs. Return only valid JSON.',
    messages: [{ role: 'user', content: digestPrompt }],
    temperature: 0.4, maxTokens: 600,
  });

  // Token usage tracked at workspace level
  await rtuDigest(workspaceId, 'groq', tokens_in, tokens_out);

  const digest = JSON.parse(content.replace(/```json|```/g, '').trim());

  const htmlBody = `
<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a1a}h2{margin:0 0 4px}h3{margin:16px 0 4px;color:#374151}.section{background:#f9fafb;border-radius:8px;padding:16px;margin:12px 0}.badge{display:inline-block;background:#6366f1;color:#fff;border-radius:4px;padding:2px 8px;font-size:12px;font-weight:600}a.cta{display:inline-block;background:#6366f1;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;margin-top:16px}</style></head>
<body>
<h2>Hi ${user.name || 'there'} 👋</h2>
<p style="color:#6b7280;margin:0 0 20px">Your weekly sales intelligence brief</p>

<div class="section">
  <span class="badge">THIS WEEK</span>
  <p style="margin:8px 0 0"><strong>${digest.headline}</strong></p>
</div>

<h3>🎯 The One Thing</h3>
<p>${digest.one_thing}</p>

<h3>✅ What's Working</h3>
<p>${digest.whats_working}</p>

<h3>📊 Skill Movement</h3>
<p>${digest.skill_summary}</p>

${patterns?.length ? `<h3>🔍 Patterns Detected</h3><ul>${patterns.map(p => `<li><strong>${p.pattern_label}</strong> — ${p.recommendation || p.pattern_detail.slice(0, 100)}</li>`).join('')}</ul>` : ''}

${marketIntel ? `<h3>🌐 Market Intel</h3><p>${marketIntel}</p>` : ''}

<p style="color:#6b7280;font-style:italic">${digest.encouragement}</p>

<a href="${FRONTEND_URL4}/insights" class="cta">View Full Intelligence Report →</a>

<p style="color:#bbb;font-size:12px;margin-top:24px">Clutch AI · <a href="${FRONTEND_URL4}/settings" style="color:#bbb">Manage email preferences</a></p>
</body></html>`.trim();

  await sendEmail4({ to: user.email, subject: digest.subject, html: htmlBody });
};

const sendEmail4 = async ({ to, subject, html }) => {
  const gmail = getGmailTransport();
  if (gmail) {
    try {
      await gmail.sendMail({ from: process.env.GMAIL_USER, to, subject, html });
      return;
    } catch (err) {
      console.warn('[EmailDigest] Gmail failed, trying Resend:', err.message);
    }
  }

  const resend = getResendClient();
  if (resend) {
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'Clutch <digest@clutch.ai>',
      to, subject, html,
    });
    if (error) throw new Error(error.message);
    return;
  }

  console.log(`[EmailDigest] CONSOLE MODE — Would send to: ${to} | Subject: ${subject}`);
};

export default { runEmailDigestJob };
