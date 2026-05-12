// seed-opportunities.js
// ─────────────────────────────────────────────────────────────────────────────
// Seeds 25 realistic opportunities for hellofoundersales@gmail.com so you can
// properly test infinite scroll, tab filtering, and all card states.
//
// SETUP:
//   1. npm install @supabase/supabase-js   (if not already installed)
//   2. Set the two env vars below (or paste them directly for a one-off run)
//   3. node seed-opportunities.js
//
// The script:
//   • Looks up your user by email
//   • Wipes any existing seeded rows (tagged with generated_by='seed')
//   • Inserts 25 opportunities spread across platforms, statuses, and scores
//     so every UI state is covered: active, sent, intel_needed, follow-up, etc.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';

// ── CONFIG — fill these in ────────────────────────────────────────────────────
const SUPABASE_URL     = 'https ://ujzffsljvmmsslodoxvr.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVqemZmc2xqdm1tc3Nsb2RveHZyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTU2OTkzMiwiZXhwIjoyMDg3MTQ1OTMyfQ.BgLnsswYmT6f8nQso6lnzlrPmS_TRYyxaqYH4lSmm0A';
const TARGET_EMAIL     = 'hellofoundersales@gmail.com';
// ─────────────────────────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Seed data ─────────────────────────────────────────────────────────────────
// 25 entries — mix of platforms, statuses, scores, and special states so every
// UI branch (intel, follow-up, stale, sent, low-score) is exercised.
const buildOpportunities = (userId) => {
  const now   = new Date();
  const ago   = (h) => new Date(now - h * 3600 * 1000).toISOString();
  const score = (f, t, i) => ({ fit_score: f, timing_score: t, intent_score: i });

  return [
    // ── HIGH SCORE / ACTIVE ──────────────────────────────────────────────────
    {
      platform: 'reddit',
      source_url: 'https://reddit.com/r/startups/comments/seed01/looking_for_crm_solution',
      target_context: 'u/mike_builds_stuff at r/startups: "We just hit 50 customers and our spreadsheet CRM is falling apart. We\'re missing follow-ups constantly and our sales team is furious. Has anyone found something that doesn\'t require a 6-month implementation?" — 47 upvotes, 23 comments in the last 3 hours.',
      target_name: 'mike_builds_stuff',
      prepared_message: "Hey Mike — saw your post about outgrowing the spreadsheet CRM. We built exactly for this moment (5–100 customer range). The setup is 20 minutes, not 6 months. Happy to show you a quick demo if you want to see if it fits.",
      ...score(8.5, 9.0, 8.8),
      status: 'pending',
      stage: 'new',
      intel_needed: true,
      created_at: ago(2),
    },
    {
      platform: 'linkedin',
      source_url: 'https://linkedin.com/posts/sarah-chen-founder_hiring-outreach-seed02',
      target_context: 'Sarah Chen, Founder at Nexus Labs, posted: "Our SDR team is sending 200 cold emails a day and getting a 0.4% reply rate. I know personalisation is the answer but we literally cannot afford the time it takes. There has to be a smarter way." Post has 312 reactions.',
      target_name: 'Sarah Chen',
      prepared_message: "Sarah — that 0.4% reply rate at 200 emails/day is a painful ratio. The issue is usually signal quality, not volume. We help teams find the 10 people actually showing buying intent today instead of blasting 200. Worth a 15-min call?",
      ...score(9.2, 8.7, 9.0),
      status: 'pending',
      stage: 'new',
      intel_needed: true,
      intel_snapshot: {
        company: 'Nexus Labs',
        bullets: [
          'Nexus Labs raised a $2.4M seed round 4 months ago — likely actively building out their sales team now.',
          'Sarah previously scaled outbound at HubSpot before founding Nexus, so she understands the problem deeply.',
          'Nexus is hiring 2 more SDRs this quarter, meaning the outreach problem will compound.'
        ],
        relevance_note: 'Actively investing in sales infrastructure at exactly the stage where tooling ROI is highest.'
      },
      intel_generated_at: ago(1),
      created_at: ago(1),
    },
    {
      platform: 'twitter',
      source_url: 'https://x.com/devraj_vc/status/seed03',
      target_context: '@devraj_vc tweeted: "Genuinely shocked by how bad most outreach tools are at finding WARM leads vs just contact databases. My inbox is full of cold blasts from people who clearly haven\'t read my bio. Any recs for something actually signal-driven?" — 89 retweets.',
      target_name: '@devraj_vc',
      prepared_message: "Hey Devraj — your tweet about signal-driven vs contact-database outreach is exactly why we built what we did. We surface people actively expressing the problem you solve, not scraped contacts. Would love to show you the difference.",
      ...score(8.8, 9.5, 9.2),
      status: 'pending',
      stage: 'new',
      intel_needed: true,
      created_at: ago(3),
    },
    {
      platform: 'hackernews',
      source_url: 'https://news.ycombinator.com/item?id=seed04',
      target_context: 'Ask HN by user "throwaway_b2b_pain": "We just hired our first sales person. She\'s great but has no tooling — we\'re paying her $80k and she\'s spending 40% of her time manually researching leads. What\'s the minimum viable sales stack for a Series A startup?" — 156 comments.',
      prepared_message: "I saw your HN thread about the sales stack question. The lead research problem is almost always the first thing to fix — a good SDR doing manual research loses 2-3 hours daily. Happy to walk you through what a lean stack looks like for your stage.",
      ...score(7.9, 8.2, 8.5),
      status: 'viewed',
      stage: 'new',
      viewed_at: ago(0.5),
      intel_needed: false,
      created_at: ago(5),
    },

    // ── WITH FOLLOW-UP READY ─────────────────────────────────────────────────
    {
      platform: 'reddit',
      source_url: 'https://reddit.com/r/sales/comments/seed05/follow_up_situation',
      target_context: 'u/james_revenue at r/sales: "I replied to a cold email last week saying I was interested but the founder never followed up. Now I\'m actively looking for alternatives. How do founders drop the ball this badly?" — 201 upvotes.',
      target_name: 'james_revenue',
      prepared_message: "Hey James — saw your post about the dropped follow-up. Painful when that happens. We built our follow-up prompting specifically because founders are terrible at this (I speak from experience). Happy to chat if you\'re still looking.",
      follow_up_message: "Hey James — circling back since it\'s been a few days. Still evaluating options? I know you mentioned you\'d found an alternative but wanted to check in before I close this out.",
      follow_up_count: 1,
      ...score(7.5, 7.8, 7.2),
      status: 'viewed',
      stage: 'new',
      intel_needed: true,
      created_at: ago(48),
      viewed_at: ago(47),
    },
    {
      platform: 'linkedin',
      source_url: 'https://linkedin.com/posts/priya-b2b-seed06',
      target_context: 'Priya Ramachandran, Head of Growth at Stackr, commented on a sales thread: "We tried three different outreach tools this year. All of them are just fancy contact databases. None of them tell me WHO is actually in-market right now. That\'s the gap." Comment has 67 likes.',
      target_name: 'Priya Ramachandran',
      prepared_message: "Priya — your comment about in-market intent vs contact databases is exactly the gap we close. We monitor platforms in real-time for people actively expressing the problem you solve. That\'s a very different starting point than a static database.",
      follow_up_message: "Priya — following up from my earlier message. I noticed Stackr just posted two new SDR job openings, so the timing might be right to chat about tooling before they ramp up. 20 mins this week?",
      follow_up_count: 1,
      ...score(8.1, 7.6, 8.4),
      status: 'acted',
      stage: 'contacted',
      intel_needed: true,
      intel_snapshot: {
        company: 'Stackr',
        bullets: [
          'Stackr is currently hiring 2 SDRs — growth stage, actively investing in outbound.',
          'Priya joined as Head of Growth 6 weeks ago, likely evaluating the entire toolstack.',
        ],
        relevance_note: 'New growth hire evaluating tooling at exactly the right moment.'
      },
      intel_generated_at: ago(12),
      message_copied_at: ago(24),
      created_at: ago(72),
    },

    // ── MID SCORE / ACTIVE ───────────────────────────────────────────────────
    {
      platform: 'indiehackers',
      source_url: 'https://indiehackers.com/post/seed07-finding-customers',
      target_context: 'IH post by @bootstrapped_dan: "Month 3 of my B2B SaaS. Product is solid, got 5 paying customers from my personal network. But now I\'m terrified — I don\'t know how to find customers outside of people I already know. Every cold email guide says something different."',
      target_name: '@bootstrapped_dan',
      prepared_message: "Dan — month 3 with 5 customers and now staring down the cold outreach wall. That transition from warm network to cold is genuinely the hardest part. We built a tool specifically for this stage — finding people actively expressing your exact problem online.",
      ...score(7.2, 6.8, 7.5),
      status: 'pending',
      stage: 'new',
      intel_needed: true,
      created_at: ago(6),
    },
    {
      platform: 'reddit',
      source_url: 'https://reddit.com/r/entrepreneur/comments/seed08/overthinking_outreach',
      target_context: 'u/overthinking_outreach: "I\'ve been writing and deleting cold outreach messages for 3 hours. I know my ICP, I know my value prop, but I just freeze up when it\'s time to actually send something. Is this normal or am I missing something?"',
      target_name: 'overthinking_outreach',
      prepared_message: "Really normal — the gap between knowing your ICP and writing the actual message is where most founders freeze. The key is having the right prospect context so the message writes itself. We help with both finding the right people and the actual message.",
      ...score(6.5, 7.1, 6.8),
      status: 'pending',
      stage: 'new',
      intel_needed: false,
      created_at: ago(8),
    },
    {
      platform: 'quora',
      source_url: 'https://quora.com/What-is-the-best-way-to-find-B2B-leads-seed09',
      target_context: 'Question by Marcus Webb: "What\'s the best way to find qualified B2B leads in 2024 without spending $500/month on ZoomInfo? I\'m a solo founder selling to mid-market ops teams and my budget is tight." — 1.2k views, 14 answers.',
      target_name: 'Marcus Webb',
      prepared_message: "Marcus — saw your Quora question about ZoomInfo alternatives for solo founders. The issue with most lead databases is you\'re buying contacts, not intent. We surface people actively posting about the problem you solve — very different signal quality.",
      ...score(6.9, 6.4, 7.0),
      status: 'pending',
      stage: 'new',
      intel_needed: true,
      created_at: ago(10),
    },
    {
      platform: 'twitter',
      source_url: 'https://x.com/saas_struggles/status/seed10',
      target_context: '@saas_struggles: "Day 47 of trying to get my first 10 customers. I\'ve sent 340 cold emails. 12 replies, 2 demos, 0 closes. I\'m starting to think either my product or my outreach is completely broken and I can\'t tell which." — Quote-tweeted 34 times.',
      prepared_message: "47 days, 340 emails, and that data actually tells you a lot. 12 replies = ~3.5% which isn\'t terrible. 2 demos from 12 replies = conversion issue, not outreach volume. The real question is who you\'re emailing — we can help with that part.",
      ...score(7.8, 8.1, 7.4),
      status: 'pending',
      stage: 'new',
      intel_needed: false,
      created_at: ago(4),
    },

    // ── SENT ─────────────────────────────────────────────────────────────────
    {
      platform: 'linkedin',
      source_url: 'https://linkedin.com/posts/alex-b2b-ops-seed11',
      target_context: 'Alex Torino, VP Operations at Meridian Group, posted: "We just finished a painful 6-month evaluation of 4 different sales tools. The winner had the worst UI but the best data. Lesson: buy the data, not the interface." Post went semi-viral with 892 reactions.',
      target_name: 'Alex Torino',
      prepared_message: "Alex — your post about buying data over interface is exactly our philosophy. The signal quality problem in sales tools is real. Would love to show you what we built around this.",
      ...score(8.3, 7.0, 8.0),
      status: 'sent',
      stage: 'contacted',
      marked_sent_at: ago(24),
      intel_needed: true,
      created_at: ago(50),
    },
    {
      platform: 'reddit',
      source_url: 'https://reddit.com/r/b2bsales/comments/seed12/cold_email_is_dead',
      target_context: 'u/cold_email_skeptic at r/b2bsales: "I\'ve been hearing \'cold email is dead\' for 5 years. It\'s not dead, it\'s just that everyone is doing it terribly. Signal-based outreach (people literally asking for what you sell) converts 10x better in my experience."',
      target_name: 'cold_email_skeptic',
      prepared_message: "Your take on signal-based outreach is exactly right — finding people actively expressing the pain vs blasting a list is the difference between 0.3% and 8% reply rates. We automate finding those signals. Happy to share our data.",
      ...score(7.6, 6.9, 8.2),
      status: 'sent',
      stage: 'contacted',
      marked_sent_at: ago(36),
      intel_needed: false,
      created_at: ago(60),
    },
    {
      platform: 'hackernews',
      source_url: 'https://news.ycombinator.com/item?id=seed13',
      target_context: 'HN comment by user "practical_founder": "Launch HN comment: We\'re 8 months in, $18k MRR, and I still do all sales myself because I\'m terrified to hire someone who\'ll spend all their time on unqualified leads. How do founders solve the lead quality problem at this stage?"',
      prepared_message: "8 months, $18k MRR doing sales solo — you\'re at exactly the stage where getting signal quality right before hiring matters most. One bad SDR hire costs you 3 months. Happy to show you what a lean, high-quality pipeline looks like.",
      ...score(8.0, 7.5, 7.8),
      status: 'sent',
      stage: 'contacted',
      marked_sent_at: ago(12),
      intel_needed: false,
      created_at: ago(18),
    },

    // ── LOWER SCORE ACTIVE (for score variety) ───────────────────────────────
    {
      platform: 'facebook',
      source_url: 'https://facebook.com/groups/saas-founders/posts/seed14',
      target_context: 'Post in SaaS Founders Facebook group by Linda Park: "Anyone using AI for lead generation? I\'ve tried 3 tools and they all just scrape LinkedIn. Looking for something more creative." — 15 comments.',
      target_name: 'Linda Park',
      prepared_message: "Linda — the LinkedIn scraping problem is real, all those tools are pulling from the same static database. We watch for live signals: people actively posting about your exact problem across Reddit, HN, Twitter, etc. Very different quality.",
      ...score(5.8, 6.2, 5.5),
      status: 'pending',
      stage: 'new',
      intel_needed: false,
      created_at: ago(14),
    },
    {
      platform: 'producthunt',
      source_url: 'https://producthunt.com/posts/seed15-outreach-comment',
      target_context: 'Product Hunt comment on a competing tool launch by user "founder_feedback": "Tried the beta. Good idea but the lead quality is still just volume-based. I want to reach people who are actively in pain, not just match my ICP demographics."',
      prepared_message: "Your PH comment about \'in pain\' vs \'matching demographics\' is exactly the distinction we\'ve built around. Demographic match = maybe interested. Active signal = definitely has the problem right now. Happy to show you what that looks like in practice.",
      ...score(6.1, 6.8, 6.0),
      status: 'pending',
      stage: 'new',
      intel_needed: true,
      created_at: ago(16),
    },
    {
      platform: 'twitter',
      source_url: 'https://x.com/b2b_diary_seed16/status/seed16',
      target_context: '@b2b_diary: "Week 12 update: Started doing video loom personalization for outreach. Reply rates went from 1% to 6%. The bar is so low that literally any effort to personalize works. Why does everyone still blast generic templates?"',
      prepared_message: "Your Loom personalisation experiment is real data. The reason templates underperform isn\'t the format — it\'s the lack of actual prospect context. We give you the context so the message (however you send it) actually lands.",
      ...score(5.5, 6.0, 5.8),
      status: 'pending',
      stage: 'new',
      intel_needed: false,
      created_at: ago(20),
    },

    // ── STALE INTEL (to test the auto-refresh edge case) ─────────────────────
    {
      platform: 'linkedin',
      source_url: 'https://linkedin.com/posts/old-intel-seed17',
      target_context: 'Tom Harrington, CEO at DataBridge, posted 4 days ago: "We\'re rebuilding our entire outbound motion from scratch. The old playbook (volume + templates) is completely broken for us. Looking for founders who\'ve successfully transitioned to a quality-over-quantity approach."',
      target_name: 'Tom Harrington',
      prepared_message: "Tom — rebuilding outbound from the volume playbook is exactly what we help with. The quality-over-quantity approach works when you can reliably find the right signals. Happy to share what that looks like for teams at your stage.",
      ...score(8.7, 7.2, 8.9),
      status: 'pending',
      stage: 'new',
      intel_needed: true,
      intel_snapshot: {
        company: 'DataBridge',
        bullets: ['DataBridge processes B2B data for mid-market companies', 'Tom previously built the sales motion at two other SaaS companies'],
        relevance_note: 'CEO directly responsible for sales strategy — high decision-maker access.'
      },
      intel_generated_at: new Date(now - 4 * 86400000).toISOString(), // 4 days ago = stale
      created_at: ago(96),
    },

    // ── PADDING TO 25 — variety of platforms and contexts ────────────────────
    {
      platform: 'reddit',
      source_url: 'https://reddit.com/r/sales/comments/seed18/burned_out_on_prospecting',
      target_context: 'u/burned_on_prospecting: "I spend 3 hours every morning doing research just to find 10 people worth emailing. It\'s killing my productivity. There has to be a better way to find qualified prospects without the manual grind."',
      ...score(7.3, 8.0, 7.6),
      status: 'pending',
      stage: 'new',
      intel_needed: false,
      prepared_message: "3 hours of research for 10 qualified prospects is a brutal ratio. We surface people actively expressing the pain you solve in real time — no manual research needed. Happy to show you what your morning could look like.",
      created_at: ago(7),
    },
    {
      platform: 'indiehackers',
      source_url: 'https://indiehackers.com/post/seed19-milestone',
      target_context: 'IH milestone post by @growingsaas: "$5k MRR! But my biggest bottleneck is I\'m spending 60% of my time on sales and only 40% building. I need to find a way to make the top-of-funnel less manual before I can hire."',
      target_name: '@growingsaas',
      prepared_message: "Congrats on $5k MRR — and that 60/40 split is the exact problem you need to solve before hiring. If top-of-funnel is manual you\'ll just outsource chaos. We help make the signal-finding automatic so sales time actually converts.",
      ...score(7.0, 7.4, 7.1),
      status: 'pending',
      stage: 'new',
      intel_needed: false,
      created_at: ago(9),
    },
    {
      platform: 'twitter',
      source_url: 'https://x.com/outreach_seed20/status/seed20',
      target_context: '@outreach_ops: "Hot take: the best sales tool investment isn\'t a better CRM, it\'s better lead intelligence. If you know who\'s in-market today, everything downstream gets easier. Fighting the last battle by optimising follow-up sequences on bad leads."',
      prepared_message: "Your take is exactly right — upstream lead quality determines everything downstream. A sequence tool on bad leads is just automated noise. We\'re the lead intelligence layer. Happy to show you the difference in signal quality.",
      ...score(8.2, 8.6, 8.0),
      status: 'pending',
      stage: 'new',
      intel_needed: false,
      created_at: ago(3.5),
    },
    {
      platform: 'linkedin',
      source_url: 'https://linkedin.com/posts/elena-founder-seed21',
      target_context: 'Elena Vasquez, Founder at GrowthOS, commented: "I\'ve been testing AI-generated outreach for 2 months. The personalization is impressive but the targeting is still terrible. AI writes better messages to the wrong people." — 134 likes.',
      target_name: 'Elena Vasquez',
      prepared_message: "Elena — your observation is the core problem: AI gets better at messages while targeting stays bad. We flip the priority — find the right people first (signal-based), then generate the message. The targeting problem is harder to automate and we focused on it.",
      ...score(8.9, 8.2, 8.7),
      status: 'pending',
      stage: 'new',
      intel_needed: true,
      created_at: ago(2.5),
    },
    {
      platform: 'hackernews',
      source_url: 'https://news.ycombinator.com/item?id=seed22',
      target_context: 'HN Ask: "Who is building signal-based lead gen?" by user "founder_in_search": "I know the theory — monitor forums for people asking about problems you solve — but I don\'t have time to do this manually across Reddit, Twitter, LinkedIn. Is anyone building automation for this?"',
      prepared_message: "I am — happy to jump on a call. We\'ve automated monitoring across Reddit, LinkedIn, Twitter, HN, and others for exactly this use case. What\'s your product and ICP?",
      ...score(9.5, 9.8, 9.4),
      status: 'viewed',
      stage: 'new',
      viewed_at: ago(0.25),
      intel_needed: false,
      created_at: ago(1),
    },
    {
      platform: 'reddit',
      source_url: 'https://reddit.com/r/startups/comments/seed23/failed_sales_hire',
      target_context: 'u/startup_cto_vent: "Our first sales hire cost us $95k including base, commission, and tooling. He closed 0 deals in 5 months. The #1 problem: we gave him terrible leads and no process. Now we\'re rebuilding from scratch as a technical founder who hates sales."',
      prepared_message: "That $95k lesson is painful — and unfortunately common. The leads problem is almost always upstream of everything else. Happy to talk through what a process built on better signal quality looks like. No obligation.",
      ...score(7.8, 8.3, 7.9),
      status: 'pending',
      stage: 'new',
      intel_needed: false,
      created_at: ago(11),
    },
    {
      platform: 'linkedin',
      source_url: 'https://linkedin.com/posts/cmo-signal-seed24',
      target_context: 'Jamie Ko, CMO at Relay, posted: "We switched from intent data vendors to monitoring actual conversations in real-time. Conversion rate on outreach tripled. Intent data is lagging signal. Forum monitoring is leading signal. The difference matters enormously."',
      target_name: 'Jamie Ko',
      prepared_message: "Jamie — you\'ve arrived at exactly the same conclusion we built the company around. Leading vs lagging signal is the core insight. Would love to compare notes on how you\'re doing the monitoring — might be relevant to what we\'re building.",
      ...score(8.6, 7.9, 8.8),
      status: 'sent',
      stage: 'contacted',
      marked_sent_at: ago(48),
      intel_needed: true,
      created_at: ago(72),
    },
    {
      platform: 'quora',
      source_url: 'https://quora.com/seed25-outreach-timing',
      target_context: 'Quora question by Rachel Osei: "Is there a way to reach B2B prospects at exactly the moment they\'re looking for a solution? I feel like all my outreach is either too early or too late." — 3.4k views.',
      target_name: 'Rachel Osei',
      prepared_message: "Rachel — this is literally what we built. By monitoring where your ICP asks questions and vents frustrations in real time, you reach them at the exact moment of pain — not before, not after. Happy to show you how it works.",
      ...score(9.0, 9.3, 8.9),
      status: 'pending',
      stage: 'new',
      intel_needed: true,
      created_at: ago(1.5),
    },
  ].map(opp => ({
    user_id:        userId,
    message_style:  'conversational',
    message_length: opp.prepared_message ? opp.prepared_message.split(' ').length : 0,
    generated_by:   'seed',  // tag so we can wipe + re-seed easily
    ...opp,
  }));
};

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🌱 Seeding opportunities for', TARGET_EMAIL);

  // 1. Look up user by email
  const { data: { users }, error: listErr } = await supabase.auth.admin.listUsers();
  if (listErr) { console.error('❌ Could not list users:', listErr.message); process.exit(1); }

  const user = users.find(u => u.email === TARGET_EMAIL);
  if (!user) { console.error(`❌ No user found with email ${TARGET_EMAIL}`); process.exit(1); }

  console.log('✅ Found user:', user.id);

  // 2. Wipe existing seeded rows so re-running is safe
  const { error: delErr } = await supabase
    .from('opportunities')
    .delete()
    .eq('user_id', user.id)
    .eq('generated_by', 'seed');

  if (delErr) { console.error('❌ Delete failed:', delErr.message); process.exit(1); }
  console.log('🗑️  Cleared previous seed rows');

  // 3. Insert fresh batch
  const rows = buildOpportunities(user.id);

  const { data, error: insertErr } = await supabase
    .from('opportunities')
    .insert(rows)
    .select('id, platform, status');

  if (insertErr) { console.error('❌ Insert failed:', insertErr.message); process.exit(1); }

  // 4. Summary
  console.log(`\n✅ Seeded ${data.length} opportunities:\n`);
  const summary = data.reduce((acc, o) => {
    const key = `${o.platform}/${o.status}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  Object.entries(summary)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([k, n]) => console.log(`  ${k.padEnd(30)} × ${n}`));

  console.log('\n🎉 Done! Open your app and test:\n');
  console.log('  • Active tab  — 18 cards across all platforms (triggers infinite scroll)');
  console.log('  • Sent tab    — 4 sent opportunities');
  console.log('  • All tab     — all 25');
  console.log('  • Intel       — 3 cards with existing intel_snapshot, 1 with stale intel');
  console.log('  • Follow-up   — 2 cards with follow_up_message populated');
  console.log('  • Intel badge — cards with intel_needed=true show 🔍 badge before expand');
}

main().catch(err => { console.error('❌ Fatal:', err.message); process.exit(1); });
