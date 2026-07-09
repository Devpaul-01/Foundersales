# Product Intelligence Document
## [Working Name: "Dryrun"] — AI Sales Conversation Rehearsal

*Version 1.0 — Source of truth for product, not architecture. Written for a human founder and for an AI agent that will later use this to design database, backend, frontend, and API specs.*

---

## 0. How To Read This Document

This document describes a **standalone product**, extracted and redesigned from the "Practice Mode" subsystem of a larger platform (Foundersales/Clutch AI). It is not a port — several things are deliberately redesigned, simplified, or removed because they only made sense inside the bigger platform. Anywhere this document diverges from the original implementation, that's intentional, and the reasoning is stated.

---

## 1. Product Vision

### The problem

Salespeople — SDRs, AEs, founders doing their own sales, freelancers pitching clients — get almost no real repetition before the moments that matter most: the cold open, the first objection, the price pushback, the "not right now." The only practice available today is either:

1. **On real prospects** — expensive, because every fumbled call burns a real lead and a real relationship, or
2. **With a manager or peer** — valuable but unscalable, scheduled, and socially awkward (nobody wants to look bad roleplaying in front of their boss), or
3. **Not at all** — most people just wing it and learn by losing deals.

Meanwhile, the skill that actually separates good sellers from bad ones — reading a room, handling pushback, staying calm under objection — is a *rehearsable* skill, like a scale on a piano or a sparring round in boxing. Nobody expects to walk into the ring cold. Salespeople do it every day.

### Why it deserves to exist

Because the alternative isn't "a worse version of this app" — the alternative is **doing it for real, for the first time, on someone else's dime.** That's a bad trade for the rep, and a worse one for the business. A cheap, honest, always-available sparring partner that doesn't get tired, doesn't judge, and remembers exactly what you struggled with last time is a genuinely new capability for most of the people who'd use it — not an incremental improvement on an existing workflow.

### Why people would choose it over alternatives

- **Over "just do it in ChatGPT"** (the real, free competitor for individuals): ChatGPT doesn't track your progress, doesn't calibrate difficulty to your history, doesn't have a buyer that gets harder to convince as your interest score rises, and doesn't tell you what the buyer was *actually thinking* versus what they said. It's a blank text box. This product is a structured training system with memory, scoring, and progression.
- **Over enterprise roleplay platforms** (Hyperbound, Second Nature, Quantified, Mindtickle): those are built and priced for sales orgs with an enablement budget and a procurement process — $15K–$100K+/year contracts, multi-week setup, sales-team-only. They are not built for, and mostly don't want, a single freelancer, solo founder, or 3-person startup team. This product is self-serve, usable in under two minutes, and priced for an individual.
- **Over Yoodli** (the closest self-serve competitor): Yoodli is a *communication coach* — it scores filler words, pacing, and delivery, across many use cases (interviews, presentations, sales). It is not sales-specific. It has no buyer persona that gets annoyed, curious, or skeptical based on what you actually said. This product is a *sales conversation simulator*, not a speech coach — the AI is a buyer with a psychology, not a rubric.

### What makes it unique

The core mechanic that no direct competitor is doing publicly at this depth: **the buyer has a hidden internal state that evolves per message, and reveals its true reaction after the fact.** Every message you send shifts the buyer's interest, trust, and confusion — invisibly, in the moment, exactly like a real conversation. After the session, you see the buyer's *actual unfiltered thought* at each turn ("this felt like a script," "okay, that number got my attention") next to what they *said* out loud. That gap — between performance and true reaction — is the single most useful and most emotionally memorable thing this product can show a user, and it is not something I found any competitor doing publicly in this form.

---

## 2. Product Positioning

**Product category:** AI sales conversation rehearsal / practice simulator (adjacent to, but distinct from, "AI sales coaching" and "communication coaching" categories).

**Primary users:**
- Individual B2B/B2C salespeople (SDRs, AEs) who want to practice on their own initiative, without waiting for a manager to assign it.
- Solo founders and early-stage teams doing their own outbound sales for the first time, with no formal sales training.
- Freelancers and service providers (consultants, agencies, coaches) who need to pitch and close clients but have no sales background.

**Secondary users:**
- Sales managers who want a lightweight way to give their team extra reps between formal training sessions, without an enablement platform's procurement overhead.
- Career changers / job seekers moving into sales roles who want to build confidence before interviews or their first weeks on the job.

**Ideal customer profile (ICP) for launch:** An individual seller — solo founder, freelancer, or early-career SDR — who does cold outreach regularly, has no formal sales training, feels anxious or under-prepared before conversations, and is currently practicing (if at all) by either winging it on real prospects or using a general-purpose chatbot informally.

**Value proposition (one line):** *"Have the conversation before you have the conversation — practice cold calls, objections, and pitches against a realistic AI buyer that reacts, resists, and remembers, so the first time you say it for real isn't the first time you've said it at all."*

**Core differentiators:**
1. Hidden buyer psychology (interest/trust/confusion) that shifts per message and is revealed after the session.
2. Adaptive difficulty that responds to your actual track record, not a fixed setting.
3. A "ghost" mode that trains the hardest and most common real-world outcome — silence — instead of only ever training against a buyer who's willing to talk.
4. Self-serve, individual-first pricing and onboarding in a market that is overwhelmingly built for enterprise procurement.
5. (Longer-term) A closed loop back to real-world outcomes — practice that's provably connected to better reply rates, not just a "good job" score.

---

## 3. Branding

### Name recommendations (ranked)

1. **Dryrun** — *(top recommendation)*. A dry run is universally understood as "practice before the real thing, without the risk." It's a real word, short, ownable as a brand, and works as a verb ("dryrun your next cold call"). Domain-friendly (dryrun.ai / dryrun.so / trydryrun.com).
2. **Spar** — boxing metaphor: a sparring partner doesn't fight to hurt you, they fight to make you better. Very brandable, very short, strong verb form ("spar before your next call"). Slight risk of confusion with unrelated "Spar" products in other categories — needs a trademark check.
3. **Nerve** — evokes the exact emotional problem (cold-call anxiety, "losing your nerve") and the desired outcome (building nerve). Strong emotional hook, slightly more abstract as a category signal.
4. **Coldcraft** — leans into the "cold call" pain point directly, has a "craft/mastery" undertone. Slightly more literal/less premium-feeling than the above three.
5. **Rehearsal** (styled lowercase, "rehearsal.ai" or similar) — extremely literal, very clear, less distinctive as a brand name but zero explanation needed.

*(Recommendation: lead with Dryrun. It's the rare name that is simultaneously a real, understood word, an accurate description of the product, and unclaimed as a strong sales-tech brand today. Do a trademark/domain check before committing.)*

### Branding direction

- **Personality:** A calm, competent sparring partner — not a hype-y "AI coach" cheerleader, and not a clinical enterprise training platform. Think: the experienced colleague who says "let's run through that once before you call them," not a chatbot with exclamation points.
- **Tone of voice:** Direct, a little dry-humored, respectful of the user's competence. Avoid generic SaaS enthusiasm ("Supercharge your sales!!"). Avoid corporate enablement-speak ("readiness," "certification," "competency framework") — that's the enterprise category's language, and this product should sound like it's for an individual, not a training department.
- **Visual identity:** Dark, focused, almost "practice room" or "studio" aesthetic — think a boxing gym or a music practice room, not a bright, clip-art SaaS dashboard. Muted, confident color palette (deep charcoal/near-black backgrounds, one sharp accent color — an amber or deep red works well for "pressure/heat" without being alarmist). Typography should feel editorial and calm, not playful.
- **Design philosophy:** Every screen should feel like a **quiet room to practice in**, not a dashboard full of metrics competing for attention. Save the data-density (scores, trends, badges) for a dedicated progress view — the practice screen itself should have almost nothing on it but the conversation.

---

## 4. Feature Intelligence

This is the exhaustive breakdown. Each feature includes: why it exists, the user problem it solves, how it's used, how it connects to other features, and where it could expand. Where the original implementation had a flaw or unnecessary complexity, it's called out and redesigned here.

### 4.1 Instant Scenario Setup (redesigned onboarding)

**Why it exists:** The single biggest risk to adoption is time-to-first-value. The original platform required a multi-burst, multi-screen onboarding interview (three rounds of AI-generated questions) before a user could do *anything* — that was appropriate for a platform trying to build a rich, permanent voice profile across many features. A standalone practice product does not need that much upfront investment before a user gets to try it.

**Redesign:** A **60–90 second setup**, not an interview:
1. "What do you sell?" (free text, 1–2 sentences)
2. "Who do you sell it to?" (free text, 1–2 sentences)
3. Pick a scenario to start with (see 4.2) — or let the product pick for you.
That's it. A session should be possible within 2 minutes of landing on the product. Everything else (tone, ICP nuance, objection focus) can be refined *after* the first session, informed by what actually happened in it — not guessed at cold.

**Connects to:** Feeds the buyer persona generator (4.3) directly. Refined later by Voice Calibration (4.10, expansion feature).

### 4.2 Scenario Selection

**Why it exists:** Different situations require different skills — a cold opener is a different skill from handling a price objection. Users should be able to target what they're weak at, not just get random practice.

**How it works:** A small set of clearly-named scenarios, not a maze of settings:
- **Cold Open** — first contact, breaking the ice
- **The Skeptic** — buyer pushes back and challenges your claims
- **Price Pushback** — buyer is interested but says it costs too much
- **Bad Timing** — buyer is receptive but says "not right now"
- **The Long Goodbye** — polite, firm decline (practice ending gracefully / getting a real "no" instead of a fade)
- **Radio Silence** — the buyer may not respond at all unless your message earns it (this is the "ghost" mechanic, see 4.6 — it deserves top billing as a *named* scenario, not a hidden mode, because it trains the single most common real outcome in cold outreach)

**Redesign vs. original:** The original weighted-random scenario selection (a hidden probability distribution) is *removed* as the default entry point. Users should choose intentionally, or hit "Surprise me" for random selection — hiding the mechanic behind an invisible weighted dice roll adds no value and removes agency.

**Connects to:** Feeds difficulty calibration (4.4), buyer persona generation (4.3), and post-session scoring (4.7 — different scenarios weight different skills).

### 4.3 Realistic Buyer Persona Generation

**Why it exists:** A generic chatbot buyer ("Sure, tell me more!") teaches nothing. A specific, plausible person with a real job, a real reason to be skeptical, and a hidden agenda is what makes practice transferable to real conversations.

**How it works:** From the setup info (or a specific real prospect description, if the user has one — see 4.11 expansion), the system generates a named buyer: role, company context, their actual pain point, what they're skeptical about, and — critically — one or two **hidden motivations** the user would only discover by asking good questions. This is not shown to the user up front; it's the "answer key" the buyer is playing against.

**Connects to:** Drives every reply the buyer gives during the session (4.5), and is the basis for the "what you missed" insight in the debrief (4.8) — e.g., "the buyer's hidden motivation was budget approval timing, and you never asked about it."

**Future expansion:** Let users paste in real context — a LinkedIn bio, a company description, a real email thread — and generate a persona grounded in that specific person, for high-stakes call prep (see 4.11).

### 4.4 Adaptive Difficulty

**Why it exists:** A beginner who gets steamrolled in their first session quits. An experienced rep who gets a pushover buyer learns nothing and doesn't come back either. Difficulty has to track the user's actual demonstrated skill, not a manual toggle most users will never touch.

**How it works:** Automatically calculated from session history — number of sessions completed, and historical success rate (did buyers actually respond/engage). Early sessions are calibrated to build confidence; as a track record accumulates, buyers get more skeptical, more likely to push back hard, and less patient.

**Redesign vs. original:** Keep a manual override ("make this one harder/easier") for the user who wants to deliberately stress-test themselves before a big real call — the original had no way to intentionally seek a harder session outside the automatic curve, which is a real use case (e.g., "I have a call with a hard CFO tomorrow, let me practice something tougher tonight").

**Connects to:** Session history (4.9), Pressure Modifiers (4.5 expansion).

### 4.5 Pressure Modifiers (optional overlay)

**Why it exists:** Real high-stakes conversations often have an extra layer of pressure beyond the base scenario — someone important is listening in, the buyer already has a competitor in mind, there's a compliance hurdle. These change *how* a buyer behaves without changing the base scenario.

**How it works:** Optional toggles a user can add to any scenario: "A decision-maker is watching this conversation," "They've already been talking to a competitor," "This is a rushed, impatient buyer," "Compliance/approval concerns are in play." Each meaningfully changes the buyer's tone and requirements without needing an entirely new scenario type.

**Connects to:** Layered on top of Scenario Selection (4.2) and Buyer Persona (4.3); referenced in scoring and debrief.

### 4.6 Radio Silence / Ghost Training

**Why it exists:** The single most common outcome in real cold outreach is *no response at all* — and it's the outcome almost nobody trains for, because "practicing against silence" sounds like a non-feature. But the skill of writing a message good enough to *earn* a reply from someone who has no obligation to give you one is exactly the skill that matters most in cold outreach.

**How it works:** In this scenario, the buyer stays silent by default. Each message the user sends is evaluated for real quality — specificity, relevance, a genuine reason to respond — and if (and only if) a message clears that bar, the buyer breaks silence and engages for a turn. If not, the user gets a short, honest note on *why* it didn't land, and the silence continues. This turns "getting ghosted" from a frustrating dead end into a trainable skill with visible cause and effect.

**Connects to:** Direct feed into the Debrief (4.8) and a distinct badge/milestone track ("first time you earned a reply from silence").

### 4.7 Live Session Mechanics: Buyer State & Internal Monologue

**Why it exists:** This is the product's signature mechanic and its clearest differentiator from every competitor reviewed. Real buyers don't just "reply" or "not reply" — internally, their interest, trust, and confusion shift with every sentence you say, even when their outward tone doesn't show it. Making that visible after the fact is the single most instructive and most *memorable* thing the product can do.

**How it works during a session:** Nothing is shown live — the conversation feels like a normal back-and-forth text or voice exchange, so it doesn't turn into a video-game stat-watching exercise. Behind the scenes, every message shifts three hidden values (interest, trust, confusion) based on what was actually said.

**How it's revealed:** After the session ends, a **replay view** shows the conversation again, but this time with the buyer's true internal reaction surfaced at key moments — what they were actually thinking, next to what they actually said. E.g., you said: *"We help you close more deals faster."* Buyer said: *"Interesting, tell me more."* Buyer actually thought: *"That's what everyone says. I've heard this exact line three times this month."* That contrast is the "aha" moment that teaches more than any generic feedback ever could.

**Connects to:** Directly feeds the Debrief (4.8) and Skill Scoring (4.9); this is also the best marketing/demo asset the product has — a screenshot or share of a monologue reveal is inherently interesting to anyone in sales, even if they've never used the product.

### 4.8 Post-Session Debrief

**Why it exists:** A session without a clear "here's what to do differently" is just an interesting conversation, not training. The debrief is where practice becomes improvement.

**How it works:** After each session, a structured, human-readable debrief: one specific thing that worked (quoted, not generic), one specific thing to fix, and the single most important insight from the session — plus, if the session ended in rejection or a stall, a short reflection prompt ("What do you think went wrong?") that leads to a more personal, specific coaching response rather than a canned one.

**Redesign vs. original:** The original had two overlapping debrief systems (a simpler V1 and a richer V3 with monologue insights) coexisting in the code. For a clean standalone product, there should be **one** debrief system, always including the monologue-insight layer — the richer version, not both.

**Connects to:** Feeds Skill Scoring (4.9), Session Replay (4.7), and the "what to practice next" recommendation (4.9 expansion).

### 4.9 Skill Scoring & Progress Tracking

**Why it exists:** Users need to see whether they're actually getting better, not just that they "did a session." This is also the core retention mechanic — visible progress is what brings people back.

**How it works:** Each completed session is scored across a small set of clear skill axes (not a confusing 9-axis spreadsheet): **Clarity** (is your point easy to follow), **Value** (did you communicate a real, specific benefit), **Discovery** (did you ask questions before pitching), **Objection Handling**, **Brevity**, and **Call-to-Action strength**. A simple trend view shows movement over time and flags your current weakest area with one clear, specific recommendation for what to practice next.

**Redesign vs. original:** The original blended real-world outreach data into this score (50/50 blending with `conversation_analyses`). That blending is **removed** for the standalone product — there is no real-world outreach data source day one, and pretending there is would be misleading. If/when a real-world data connection is built later (see 4.11), it should be an *additive*, clearly-labeled second data source, not silently blended into the same number.

**Connects to:** Debrief (4.8), Adaptive Difficulty (4.4), Curriculum (4.9 continued), Badges (4.9 continued).

### 4.10 Adaptive Curriculum ("What to practice next")

**Why it exists:** Open-ended practice without direction leads to users repeating what they're already good at (it feels better) instead of what they need. A simple, short, personalized plan removes the "what should I even practice today" friction.

**How it works:** Based on the user's weakest measured skill axis and recent session history, the product suggests a focused short sequence (e.g., a 3-session plan: one drill targeting the weak axis directly, one combining it with the second-weakest, one full realistic scenario). This is presented as a lightweight, optional nudge — "Here's what I'd focus on this week" — not a mandatory locked path.

**Connects to:** Skill Scoring (4.9), Session history, and (in the daily-use flow) can double as the "come back today" hook.

### 4.11 Progress & Achievement Layer

**Why it exists:** Habit formation for a practice tool benefits from visible milestones — this is a legitimate, well-understood mechanic (same reason language apps and fitness apps use streaks/badges), as long as it stays lightweight and doesn't become the point of the product.

**How it works:** A small set of meaningful milestones (first session, first time earning a reply from silence, first "objection handled well," session-count milestones, first meaningfully improved retry). Explicitly **not** a daily streak/guilt mechanic — see redesign note below.

**Redesign vs. original:** The original platform had a broader daily check-in / mood-tracking / streak system layered on top of practice. That entire layer is **cut** from the standalone product. It belongs to a different product category (habit/wellness apps) and adds notification and engagement-loop complexity without being anyone's reason to use a sales rehearsal tool. Keep the badges; drop the streak-guilt mechanics, mood check-ins, and daily push cadence logic.

**Connects to:** Session completion events; surfaced on the Progress dashboard, not pushed aggressively via notification.

### 4.12 Retry & Comparison

**Why it exists:** The fastest way to *feel* concrete improvement is to immediately redo a session you didn't do well in and see the difference, side-by-side.

**How it works:** After any completed session, "Try that again" starts a fresh session with the same scenario type and a newly generated (but comparable) buyer, then — once the retry is complete — shows a direct comparison: what changed, what's still weak, and whether the score moved.

**Connects to:** Debrief (4.8), Skill Scoring (4.9).

### 4.13 Session Library & Replay

**Why it exists:** Users should be able to revisit past sessions — both to review their own growth and, in the team context, potentially to share a session as a coaching example.

**How it works:** A simple, searchable/filterable history of past sessions (by scenario type, date, or outcome), each fully replayable with the monologue-reveal layer intact.

**Connects to:** Debrief (4.8), and — expansion opportunity — shareable session links for coaching or social proof ("look at this exchange").

---

### 4.14 Team / Manager View *(Phase 2+, not MVP — see Roadmap)*

**Why it exists:** Sales managers are a real secondary buyer, and a lightweight team layer is a natural expansion once the individual product has proven itself. This should **not** be built into the MVP — it changes the pricing model, the onboarding, and the entire go-to-market motion, and building it early is exactly the kind of premature enterprise-shaped complexity the original platform over-invested in before validating the core loop.

**How it would work (future):** A manager can see aggregate (not necessarily message-level private) progress across their team, assign a specific scenario, and see who's practicing and who isn't.

---

## 5. Complete User Flows

### 5.1 Landing Page

A single, sharp above-the-fold message (e.g., *"Practice the conversation before you have it"*), one visible interactive demo element (a live sample exchange with a buyer, including a teaser of the monologue-reveal — this is the best possible above-the-fold demo, since it's the product's most differentiated moment), and a single primary CTA: **Try a free session — no signup required for the first one.**

*Design decision:* Allow at least one full practice session before requiring signup. Given how thin the "time to value" window is in this category (competitors' free tiers exist specifically because "just try ChatGPT" is the real competitor), removing the signup wall for session #1 meaningfully lowers the biggest drop-off point.

### 5.2 Registration

Minimal fields (email + password, or social auth). No credit card. Immediately into Instant Scenario Setup (4.1) — never a dead-end "welcome" screen with nothing to do.

### 5.3 Login

Standard. Returning users land directly on their Progress dashboard (4.9) with a clear "Continue practicing" or "Try today's suggested scenario" (4.10) primary action — not a marketing homepage.

### 5.4 Onboarding / First-Time Experience

1. Instant Scenario Setup (60–90 seconds, 4.1)
2. Straight into a live session (Cold Open recommended as the default first scenario — lowest-stakes, most universal)
3. Full debrief with the monologue reveal shown prominently as the closing moment of the first session — this is the single most important first impression in the product.
4. A short, honest nudge into account creation *if not already registered* ("Save this session and start your progress history").

### 5.5 Daily / Returning Usage

Home screen = Progress dashboard: last session summary, current weakest skill, one suggested next scenario (from Curriculum, 4.10), and a simple "Start practicing" entry point into scenario selection. No mandatory daily ritual, no guilt-based streak messaging (see 4.11 redesign).

### 5.6 Practice Session Creation

Scenario Selection (4.2) → optional Pressure Modifier (4.5) → optional "make this harder/easier" override (4.4) → session starts immediately (buyer persona generation happens in the background, near-instantly).

### 5.7 Live Practice Conversation

A clean, distraction-free conversation view — text-based at launch (see Section 11 for the voice discussion) — with no visible scores or meters during the session, preserving the illusion of a real conversation. A single, unobtrusive "end session" control.

### 5.8 Post-Session Debrief & Replay

Structured debrief (4.8) → optional full replay with monologue reveal (4.7) → clear next actions: "Try again," "New scenario," or "Back to progress."

### 5.9 Progress / Analytics

A single, clean progress view: skill trend over time, current weakest axis with one concrete recommendation, badges/milestones, and session history/library (4.13). Deliberately not a data-dense BI dashboard — this is a mirror, not a spreadsheet.

### 5.10 Settings

Product/audience description (editable — this is the lightweight replacement for a full "voice profile," see 4.1), notification preferences (opt-in, minimal by default), account/billing, data export/delete.

### 5.11 Notifications

Minimal and opt-in only. No daily-cadence engagement engine at launch (explicitly removed from the original design — see 4.11). The only default notification: "Your [scenario] session and debrief are ready" if any async processing is used, plus optional weekly "here's your progress" summary email.

### 5.12 Subscription / Upgrade Flow

Free tier: a small fixed number of sessions (e.g., 3–5) to fully evaluate the core loop before paying — enough to reach the monologue-reveal moment more than once, since that's the conversion hook. Paid tier: unlimited sessions, full history, curriculum, and (later) advanced features like custom persona-from-real-prospect (4.3 expansion) or voice mode (Section 11).

### 5.13 Team Flow *(Phase 2+)*

Not part of MVP flows. Documented separately once individual product-market fit is established (see Roadmap).

---

## 6. Infrastructure Overview

*(Conceptual roles only — not implementation.)*

- **Authentication:** Standard email/social auth; must support a no-signup-required first session (session state can be held client-side or against a temporary anonymous identity until the user registers).
- **AI infrastructure:** A conversational AI layer capable of (a) generating a buyer persona from a short product/audience description, (b) sustaining an in-character multi-turn conversation with a consistent hidden internal state, (c) producing structured debrief/scoring output. Given cost sensitivity for a self-serve/individual product, a multi-provider fallback approach (as in the original platform) is worth preserving conceptually — AI cost is the primary variable cost of this business.
- **Background processing:** Needed for anything that shouldn't block the live conversation response — skill scoring, debrief generation, curriculum updates. Should be near-real-time (seconds, not the multi-hour delays used for some derivative features in the original platform, which don't apply here since there's no "playbook generation" concept carried over).
- **Storage:** Session transcripts, buyer persona state, skill score history, user profile (product/audience description). Modest scale requirements at launch — this product does not need the CRM-scale data model of the original platform.
- **Analytics (product, not sales):** Event tracking for activation (time-to-first-session, time-to-first-debrief), retention (session frequency, day-7/day-30 return), and conversion (free-to-paid session count at time of upgrade) — these are the metrics that actually matter for this business and should be instrumented from day one.
- **Notifications:** Email for session-ready and weekly summary; push only if a mobile app exists, and only opt-in.
- **Email:** Transactional (session ready, receipt) + a light weekly digest — not the daily-cadence system from the original platform.
- **File handling:** Not required at MVP. Becomes relevant only if "paste real prospect context" (4.3 expansion, e.g., LinkedIn bio upload or pasted text) is built.
- **Future integrations:** CRM/outreach tool connections (to close the loop between practice and real-world outcomes — this is the single highest-leverage integration for long-term differentiation, per the competitive research), calendar (to prep for a specific real upcoming call), and a public/shareable session-replay link (for organic growth via the monologue-reveal moment).

---

## 7. Product Roadmap

### MVP (Launch)
- Instant Scenario Setup (4.1)
- Core scenario set (4.2), including Radio Silence (4.6)
- Buyer persona generation (4.3) + Adaptive Difficulty (4.4)
- Live text-based conversation (Section 11: voice deferred)
- Buyer state + Internal Monologue reveal (4.7) — **the flagship mechanic, must be in MVP**
- Post-Session Debrief (4.8, single unified version)
- Skill Scoring (4.9) with clear trend view
- Retry & Comparison (4.12)
- Session Library/Replay (4.13)
- Free tier + individual paid subscription
- No signup required for session #1

### Phase 2
- Adaptive Curriculum recommendations (4.10)
- Pressure Modifiers (4.5)
- Achievement/badge layer (4.11, lightweight version only)
- Custom persona from real prospect info — paste a bio/description (4.3 expansion)
- Shareable session replay links (growth loop)
- Voice mode evaluation begins here (see Section 11) — likely built and shipped in this phase, not later, given competitive findings

### Phase 3
- Team/Manager view (4.14) — lightweight, self-serve, not enterprise-shaped
- CRM/outreach tool integration — pull real reply-rate data to prove the practice → real-outcome connection (this is the product's long-term moat opportunity)
- Calendar-aware "prep for this specific real call tomorrow" mode

### Long-Term Vision
- The verified, data-backed claim that "people who practice on this product see measurably better real-world reply/close rates" — this requires the CRM/outreach integration above and enough usage data to be true, but it is the single most defensible long-term position in the category, and something no competitor reviewed has convincingly demonstrated in public materials.
- Possible expansion beyond sales into other high-stakes conversation categories (interview prep, negotiation, difficult customer conversations) — but only after sales-specific product-market fit is unambiguous. Yoodli's experience is instructive here: broadening to "communication coaching in general" is exactly why sales-specific competitors call them out as *less* sales-relevant, not more.

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **Voice is now a near-standard expectation in this category** (see Section 11) and a text-only launch may read as "behind" to anyone who's shopped competitors | Launch text-first for speed and cost control, but commit publicly to voice in Phase 2, and make sure the monologue-reveal mechanic (the actual differentiator) doesn't depend on voice to land — it doesn't. |
| **"Just use ChatGPT" is genuinely free competition** for the core use case | Win on structure, progression, and the monologue mechanic — not on "AI roleplay exists," which is now commoditized knowledge. |
| **AI cost is the core variable cost**, and heavy users could make the free tier or low-tier pricing unprofitable | Cap free-tier sessions tightly; monitor cost-per-session by provider; keep the multi-provider fallback approach for cost arbitrage. |
| **Adoption drop-off after month one** is an explicitly reported complaint about the closest competitor (Hyperbound) when not enforced by a manager | For an individual-first product, retention must come from felt progress (visible skill trend, curriculum nudges) rather than management enforcement — this makes the Skill Scoring and Curriculum features retention-critical, not optional polish. |
| **Realism ceiling** — if the AI buyer feels scripted or repetitive after a few sessions, the core value proposition collapses | Continued prompt investment specifically in buyer persona variety and the monologue-reveal quality; this is the product's core IP and deserves the largest ongoing investment of any feature. |
| **Positioning confusion with "communication coaching"** (Yoodli's category) | Stay disciplined in messaging: this is a sales-buyer simulator, not a delivery/filler-word coach. Never add general-purpose public-speaking framing. |
| **Underestimating enterprise-shaped feature creep** | Explicitly defer team/manager features, SSO, and admin dashboards to Phase 3+ — resist the pull to build these early just because competitors have them; they solve a different buyer's problem. |
| **Data/privacy sensitivity** — users will paste real prospect info into personas eventually | Be explicit and simple about data handling and retention from day one, especially once "paste a real prospect's info" ships. |

---

## 9. AI Voice Practice — Direct Evaluation

You asked me not to reflexively defer this, so here's the honest read, informed by real competitive research, not intuition.

**Does it strengthen the product?** Yes, meaningfully — more than I expected before researching. Real cold calls and sales conversations are spoken, not typed, and voice removes a layer of artificiality that a chat window can't fully escape.

**Does it create a meaningful competitive advantage?** No — and this is the important correction to your framing. **Voice is not a differentiator in this category anymore; it's closer to table stakes.** Every serious competitor I researched (Hyperbound, Second Nature, Quantified, Yoodli, Virti, Mindtickle) is voice or avatar-based, not text-only. Text-based roleplay is explicitly described in competitor comparisons as *"what you'd do for free in ChatGPT"* — the unpaid fallback option, not a real product tier. If this product launches text-only and stays text-only, it risks being perceived as a lighter, cheaper knockoff of the category rather than a genuine entrant, regardless of how good the underlying mechanics are.

**Would users actually value it?** Yes. It's the natural medium for the use case, and it directly enables practicing under time pressure (a real skill — thinking on your feet out loud, not composing a written reply).

**Should it be in the MVP?** No, for a practical reason, not a strategic one: voice adds real-time latency, speech-to-text/text-to-speech infrastructure, and materially higher AI cost per session, at exactly the moment you need to ship fast and cheaply to test the core loop. Shipping text-first lets you validate the flagship mechanic (buyer state + monologue reveal) and the core retention loop (scoring, curriculum, progress) without betting the initial build on voice infrastructure working well on day one.

**When, then?** Phase 2, not "someday." Given that voice is functionally a category expectation rather than a nice-to-have, I would not let it drift past the second real release. The sequencing I'd recommend: ship text-first to prove the mechanic and the retention loop with a smaller build, then move fast to add voice once you have real usage data telling you which scenarios most need it (my guess, without data: Cold Open and Radio Silence are the two where voice matters most, since both are inherently spoken-first situations in real life).

**One more nuance worth stating plainly:** because voice is now closer to expected-baseline than differentiator, your actual moat has to live somewhere else — which reinforces that the buyer-state/monologue mechanic, not voice, is what this document treats as the flagship feature. Voice is necessary to be taken seriously in the category; it is not what makes you win it.

---

## 10. Foundersales — What I'd Actually Do

You asked directly, so here's the direct answer, not a hedge.

**I would pause active feature-building on Foundersales and put full effort into launching this product first — but "pause" does not mean "abandon" or even "stop testing."**

Here's the reasoning:

- You are one person. The scarce resource right now is not code — it's your attention and the market's attention. Running two go-to-market motions at once (a comprehensive platform with an unclear pitch, and a sharp new single-purpose product) splits exactly the thing you can't split.
- Foundersales is, by your own account and my review, "essentially done" on both backend and frontend. It is not going to rot by sitting in a testing/maintenance state for a few months. Bugs found by nobody don't need fixing today.
- This new product, by contrast, has zero real users and zero real validation. Every week spent elsewhere is a week the actual open question — will anyone pay for this — goes unanswered.
- The specific path I'd recommend: **treat light Foundersales maintenance as a background task, not a project.** If something breaks or a tester finds a real blocker, fix it. Do not resume active feature development, redesign, or "just one more polish pass" on it until the new product has told you something real — either "people want this and will pay" or "this isn't working, here's why."
- Practically, this also directly serves Foundersales' long-term future, not just the new product's: if the new product succeeds, you now have a validated first product, real users, and real revenue signal to decide whether Foundersales-the-platform becomes phase two of a company (with this product as its wedge and first paying customer base) — a far stronger position than launching the full platform cold with no market feedback at all, which is exactly the outcome my last review warned against.

To answer your three options directly: not (1) continue testing/polishing Foundersales in parallel as the main focus, not (3) "maintain both as equal priorities" — but a version of (2): **pause new development on Foundersales, keep it stable and testable in the background, and put your real focus on shipping and validating this product.** The moment this product tells you something real about market demand, revisit Foundersales with that evidence in hand, not before.

---

*End of Product Intelligence Document. See companion file `practice-competitive-research.md` for the full competitor analysis referenced throughout this document.*
