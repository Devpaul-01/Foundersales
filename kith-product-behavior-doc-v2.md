# 🧾 Application Flow & Product Behavior Document
## Kith — API v4.2.0
> **For AI Agent Use:** This document is the complete source of truth for building the Kith frontend. It covers every screen, every API call, every data shape, every state transition, every error, and every background side effect. Read all sections before building any component.

---

## Table of Contents
1. [Product Overview](#1-product-overview)
2. [User Roles & Permissions](#2-user-roles--permissions)
3. [Full User Journey](#3-full-user-journey)
4. [Feature Flows](#4-feature-flows)
5. [Complete Endpoint Reference](#5-complete-endpoint-reference)
6. [All Data Schemas](#6-all-data-schemas)
7. [System Behavior — Background & Async](#7-system-behavior--background--async)
8. [Error Handling & Failure Flows](#8-error-handling--failure-flows)
9. [Rate Limits Reference](#9-rate-limits-reference)
10. [Product Logic & Business Rules](#10-product-logic--business-rules)
11. [Real-Time & Streaming Behavior](#11-real-time--streaming-behavior)
12. [Notification System](#12-notification-system)
13. [Frontend Routing Map](#13-frontend-routing-map)
14. [Gaps, Inconsistencies & Known Issues](#14-gaps-inconsistencies--known-issues)
15. [UX Improvement Opportunities](#15-ux-improvement-opportunities)
16. [Constants & Enums Reference](#16-constants--enums-reference)

---

## 1. Product Overview

### What is Kith?
**Kith** is an AI-powered sales coaching and outreach platform for founders, freelancers, and sales professionals. The name "Kith" means trusted relationships — the platform's goal is to help users build real, meaningful business relationships rather than spray-and-pray cold outreach.

### Core Value Proposition
> "Kith learns your voice, finds people who need what you build, writes the message, tracks the relationship, and coaches you to close — every single day."

The centerpiece of Kith is the **Voice Profile** — an AI-generated object built during onboarding that captures the user's unique selling style, ICP (ideal customer profile), key proof points, objection reframes, and phrases to avoid. Every AI-generated message, tip, and coaching response is shaped by this profile, making Kith feel like a personal sales advisor, not a generic chatbot.

### Who It's For
| Persona | Primary Use Case |
|---|---|
| **Founder** | Finding first customers, validating product-market fit |
| **Sales rep** | Managing pipeline, improving outreach quality |
| **Freelancer** | Landing clients through personalized cold outreach |
| **Marketer** | Running targeted outreach campaigns |
| **Developer/Builder** | Finding beta users and early adopters |

### Key System Capabilities
| Capability | Description |
|---|---|
| **Opportunity Discovery** | Perplexity AI searches the web for prospects matching ICP |
| **Voice-Matched Messaging** | Groq generates outreach in the user's exact voice/style |
| **AI Practice Mode** | Simulates real buyer conversations across 6 scenario types |
| **Pipeline CRM** | Kanban board: new → contacted → replied → call_demo → closed |
| **AI Coach Chat** | 4-mode chat assistant with memory, goals, and mood context |
| **Growth Feed** | Daily AI tips, weekly plans, and archetype-aware check-ins |
| **Prospect CRM** | Relationship tracking with AI health scoring and signals |
| **Calendar Intelligence** | Meeting prep, post-meeting debrief, commitment extraction |
| **Skill Analytics** | 6-dimension message scoring, pattern detection, "why-losing" |
| **Team Workspaces** | Multi-user collaboration with role-based access control |

### Tech Stack
| Layer | Technology |
|---|---|
| Backend | Node.js / Express v4.2 |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth (JWT + Google OAuth) |
| Cache | Redis |
| Job Queue | BullMQ (3 queues) |
| Primary AI | Groq (`llama-3.1-8b-instant` + PRO_MODEL) |
| Web Search AI | Perplexity API (sonar-pro) |
| Push Notifications | Firebase Cloud Messaging (FCM) |
| File Storage | Supabase Storage (`clutch-uploads` bucket) |

### Base URLs
```
Local:      http://localhost:3001
Production: https://api.kith.app
```

All protected endpoints require:
```
Authorization: Bearer <supabase_jwt>
Content-Type: application/json
```

---

## 2. User Roles & Permissions

### Role Hierarchy
```
owner  >  admin  >  manager  >  member
```
Roles are stored in `workspace_members.role`. All data operations are scoped to the user's `active_workspace_id`.

### Detailed Role Breakdown

| Role | Assigned To | What They Can Do | What They Cannot Do |
|---|---|---|---|
| **owner** | Workspace creator | Everything: delete workspace, transfer ownership, all admin actions | N/A |
| **admin** | Trusted team lead | Invite/remove members, change roles, all manager actions | Transfer ownership |
| **manager** | Team lead | View team pipeline, assign opportunities, nudge members, view analytics, team metrics, coaching queue | Admin operations |
| **member** | Standard rep | Create/edit own opportunities, goals, practice, chat, calendar, prospects, feedback, commitments | View other members' data, team views |

### Member Status Values
`active | pending_invite | suspended | removed`

### Workspace Invite Roles
When inviting, only `admin | manager | member` can be assigned. `owner` cannot be assigned via invite — it's set only at workspace creation or via explicit ownership transfer.

### User Object Shape (returned by `GET /api/auth/me`)
```json
{
  "user": {
    "id": "uuid",
    "name": "string | null",
    "email": "string",
    "tier": "free | pro | enterprise",
    "active_workspace_id": "uuid | null",
    "onboarding_completed": false,
    "onboarding_step": 0,
    "debug_mode": false,
    "fcm_token": "string | null",
    "notification_preferences": { /* NotificationPreferences object */ },
    "memory_enabled": true,
    "email_digest_enabled": false,
    "check_in_streak": 0,
    "last_tip_generated_at": "ISO8601 | null"
  },
  "active_workspace": { /* Workspace object | null */ },
  "active_membership": {
    "role": "owner | admin | manager | member",
    "status": "active",
    "joined_at": "ISO8601"
  }
}
```

### Frontend Routing Rules Based on Auth State
```
No token → /login or /register
Token + onboarding_completed=false → /onboarding (step from onboarding_step)
Token + onboarding_completed=true + active_workspace_id=null → /workspaces (create or join)
Token + onboarding_completed=true + active_workspace_id set → /home (dashboard)
```

---

## 3. Full User Journey

### 3.1 — New User Registration (Email/Password)

**Screen:** Registration form

**Request:**
```
POST /api/auth/register
{
  "email": "jane@example.com",
  "password": "MySecurePass1!",   // min 8 chars, max 128
  "name": "Jane Doe"              // optional, max 100 chars
}
```

**What happens in the backend atomically:**
1. Supabase Auth creates auth user
2. `create_user_with_workspace` RPC runs:
   - Creates `users` row
   - Creates `workspaces` row (default workspace)
   - Creates `workspace_members` row with `role: "owner"`
   - Creates `workspace_profiles` row (empty)
3. Returns `{ success: true, needsVerification: true, email: "..." }`

**Frontend must:**
- Show a "Check your email" screen
- Offer a "Resend verification" button → `POST /api/auth/resend-verification`
- Wait for user to verify, then redirect to login

**Failure states:**
- `409 EMAIL_TAKEN` → show "Account already exists. Sign in instead."
- `429 RATE_LIMIT_EXCEEDED` → show "Too many attempts. Wait 15 minutes."
- `500 REGISTRATION_FAILED` → workspace RPC failed (auth user auto-deleted), show generic error

---

### 3.2 — Google OAuth Registration / Login

**Screen:** Login/Register with Google button

**Flow:**
1. `GET /api/auth/google/url` → returns `{ url: "https://..." }`
2. Redirect user to that URL
3. Google authenticates → redirects to `/auth/callback` with Supabase session
4. Frontend extracts JWT from Supabase session
5. `POST /api/auth/profile/ensure` with JWT in header
   - Body: `{ "name": "...", "provider": "google" }`
   - Returns `{ user, isNewUser: boolean }`
   - `201` if new user created, `200` if existing user
6. If `isNewUser = true` → route to `/onboarding`
7. If `isNewUser = false` + `onboarding_completed = false` → route to `/onboarding`
8. If `isNewUser = false` + `onboarding_completed = true` → route to `/home`

---

### 3.3 — Login (Email/Password)

**Request:**
```
POST /api/auth/login
{ "email": "jane@example.com", "password": "MySecurePass1!" }
```

**Response:**
```json
{
  "access_token": "eyJ...",
  "refresh_token": "...",
  "expires_in": 3600,
  "user": { "id": "uuid", "email": "jane@example.com" }
}
```

**Frontend must:**
- Store `access_token` and `refresh_token` securely
- Schedule token refresh before `expires_in` elapses
- `POST /api/auth/refresh` with `{ "refresh_token": "..." }` to get new tokens
- On 401 response to any request → attempt refresh → retry once → redirect to login

---

### 3.4 — First-Time Onboarding (Full Path)

After registration, check `GET /api/onboarding/status`:
```json
{
  "completed": false,
  "step": 0,
  "has_voice_profile": false,
  "has_primary_goal": false,
  "name": null,
  "business_name": null
}
```

**STEP 0 — Basic Info Form**

Screen collects and submits to `POST /api/onboarding/basic`:
```json
{
  "name": "Jane",                         // required
  "business_name": "AcmeSaaS",
  "product_description": "...",           // max 2000 chars — CRITICAL for AI quality
  "target_audience": "...",              // max 1000 chars
  "role": "founder",                      // founder|sales|freelancer|marketer|developer|other
  "industry": "saas",                     // saas|ecommerce|services|fintech|health|education|other
  "experience_level": "2 years",
  "business_stage": "pre-revenue",
  "preferred_platforms": ["linkedin", "reddit"],  // max 10 items
  "primary_goal": "Close 5 clients this month",
  "country": "US",
  "state": "CA",
  "website": "https://acme.com",
  "bio": "..."
}
```
→ Response: `{ success: true }`
→ Frontend: advance to STEP 1

**STEP 1 — AI Questions Burst 1**

`GET /api/onboarding/questions`
→ Returns:
```json
{
  "questions": [
    { "id": "q1", "question": "What's the biggest pain your product solves?" },
    ...
  ],
  "burst": 1,
  "step": 1
}
```

User answers all questions. Submit:
```
POST /api/onboarding/answers
{ "answers": { "q1": "...", "q2": "..." }, "burst": 1 }
```
→ Returns: `{ success: true, step: 2, complete: false }`
→ Frontend: advance to STEP 2 (burst 2)

**STEP 2 — AI Questions Burst 2**

Fetch burst 2: `GET /api/onboarding/questions`
→ Returns questions for burst 2

Submit burst 2:
```
POST /api/onboarding/answers
{ "answers": { ... }, "burst": 2 }
```
→ Returns: `{ success: true, step: 3, complete: false }`

**STEP 3 — AI Questions Burst 3 (Final)**

Fetch burst 3: `GET /api/onboarding/questions`
Submit burst 3:
```
POST /api/onboarding/answers
{ "answers": { ... }, "burst": 3 }
```

On final burst, response changes to:
```json
{
  "success": true,
  "voice_profile": {
    "unique_value_prop": "...",
    "icp_trigger": "...",
    "target_customer_description": "...",
    "main_objection": "...",
    "objection_reframe": "...",
    "best_proof_point": "...",
    "voice_style": "...",
    "outreach_persona": "...",
    "avoid_phrases": ["...", "..."]
  }
}
```

Backend simultaneously queues 3 background jobs:
- `SEED_MEMORY` — extracts initial memory facts from answers
- `ARCHETYPE_DETECT` — classifies user archetype
- `OPPORTUNITIES_REFRESH` — discovers first batch of prospects

**STEP 4 — Sample Message (Optional, Show After Burst 3)**

`POST /api/onboarding/sample-message`
→ Returns:
```json
{
  "success": true,
  "sample_message": "Hi [Name], saw your post about...",
  "based_on_opportunity": true,
  "opportunity_context": "Reddit post about switching CRMs"
}
```

**Frontend**: Display the generated message as a live preview of what Kith will write for them. This is the "wow moment" of onboarding.

**How to detect if you're on the final burst:**
Check if `POST /api/onboarding/answers` returns a `voice_profile` object in the response. If yes → onboarding is complete. (Note: The YAML shows `complete: false` on partial bursts but does NOT show `complete: true` on final — the presence of `voice_profile` in the response is the signal.)

---

### 3.5 — Invited Member Onboarding (Abbreviated Path)

When a user joins via invite link:
1. User must be authenticated (logged in or registered first)
2. `POST /api/user/accept-invite/:token`
   - Token comes from the invite email URL (plaintext, SHA-256 hashed server-side)
   - Returns: `{ success, workspace, role, message, needs_profile_setup: boolean }`
3. If `needs_profile_setup = true` → `POST /api/onboarding/abbreviated`
   ```json
   { "role": "sales", "primary_goal": "optional" }
   ```
4. User is now fully active with `onboarding_completed: true`

**Invite error states:**
- `409 ALREADY_A_MEMBER` → redirect to workspace switch
- `410 INVALID_OR_EXPIRED_TOKEN` → show "Invite expired. Ask admin to re-send."

---

### 3.6 — App Initialization (Every Session)

Every time the app loads after login, call in this order:

```
1. GET /api/auth/me
   → Determine route (onboarding? workspace needed? home?)
   → Load user tier, role, streak, memory_enabled

2. GET /api/onboarding/status
   → If completed=false → redirect to /onboarding at correct step

3. GET /api/metrics/dashboard
   → Load momentum score, chart data, pipeline summary, goals

4. GET /api/growth/feed
   → Load growth cards, top opportunities, archetype

5. GET /api/growth/checkin/today
   → Check if check-in available (is_new: true = needs to be filled)

6. GET /api/calendar/alerts
   → Get badge counts for debriefs_needed + overdue_commitments

7. GET /api/suggestions
   → Load AI chat starter suggestions

8. PUT /api/user/fcm-token
   → Register device push token (if available)
```

**Performance tip:** Steps 3–8 can be fired in parallel after step 2 confirms onboarding is complete.

---

### 3.7 — Core Daily Loop

**Morning (9am push notification received: "Your morning growth tip")**
1. User opens app → home/growth tab
2. Reads `GET /api/growth/feed` cards
3. Marks each card read: `POST /api/growth/cards/:id/read`
4. Dismisses irrelevant cards: `POST /api/growth/cards/:id/dismiss`

**Outreach Loop:**
1. `GET /api/opportunities?status=pending` → see pending opportunities
2. If `should_refresh: true` → show "Discover New" CTA prominently
3. Tap opportunity → `GET /api/opportunities/:id` (auto-marks viewed)
4. Review prospect context + prepared_message
5. Open chat to refine: `POST /api/chat` with `{ opportunity_id, chat_type: "opportunity" }`
6. Send messages in chat: `POST /api/chat/:chatId/message`
7. Mark message sent: `PUT /api/opportunities/:id/status` with `{ status: "sent" }`
8. Log feedback: `POST /api/feedback`

**Midday (2pm check-in reminder push):**
1. `GET /api/growth/checkin/today` → loads today's questions
2. User answers + rates mood (1–10)
3. `POST /api/growth/checkin` with answers → receives AI coaching response + streak update

**Evening (6pm growth push):**
1. User returns → reviews follow-ups
2. `GET /api/followup` → list of deals needing follow-up messages
3. Send or dismiss each follow-up

---

## 4. Feature Flows

### 4.1 — Opportunity Discovery

**Trigger types:**
- Manual: User taps "Discover" → `POST /api/opportunities/refresh`
- Automatic: BullMQ cron every 6 hours
- Post-onboarding: Immediate background job

**Rate limit:** 5 manual refreshes per hour per user

**Backend process:**
1. Validates voice_profile exists (400 if not)
2. Checks workspace Perplexity quota (free: 5/day, pro: 50/day, enterprise: 200/day)
3. Calls Perplexity with: product_description + voice_profile + target_audience + preferred_platforms
4. Each result scored 0–10 on three axes: `fit_score`, `timing_score`, `intent_score`
5. `composite_score = weighted_avg(fit, timing, intent)`
6. Only results with `composite_score >= 5` are saved
7. Upsert on `(workspace_id, user_id, source_url)` prevents duplicates
8. Activity event logged

**Opportunity list response:**
```json
{
  "opportunities": [ /* Opportunity[] */ ],
  "should_refresh": true,
  "workspace_id": "uuid"
}
```

**`should_refresh: true` when:** no opportunities exist OR newest opportunity is >12 hours old

**Status transition diagram:**
```
pending ──(viewed on GET)──► viewed
viewed  ──(user marks sent)─► sent
sent    ──(feedback submitted)► done
viewed  ──(user skips/acts)──► acted
```

**Stage transition diagram (pipeline position):**
```
new ──(positive feedback)──► contacted
contacted ──(2nd positive)──► replied
replied ──(manual move)──► call_demo ──(manual)──► closed_won
                                               └──► closed_lost
```

**Query params for `GET /api/opportunities`:**
- `status`: `pending | viewed | acted | sent | done | all` (default: `pending`)
- `limit`: 1–100 (default: 20)
- `offset`: 0+ (default: 0)

**Per-opportunity Intel (`GET /api/opportunities/:id/intel`):**
- Returns `null` if no named entity detected in target context
- Otherwise returns: `pain_points[]`, `talking_points[]`, `risks[]`, `confidence: low|medium|high`
- This is expensive (Perplexity + Groq) — only call when user explicitly requests it

---

### 4.2 — AI Chat Coach

**Chat types:** `general | opportunity | practice`
**Chat modes:** `general | meeting_notes | prep | followup_coach`

**Creating a chat:**
```
POST /api/chat
{
  "title": "optional",
  "chat_type": "general",
  "chat_mode": "general",
  "opportunity_id": "uuid | null",
  "prospect_id": "uuid | null",
  "event_id": "uuid | null"
}
```

If `opportunity_id` is provided, the backend automatically injects the opportunity context as a system message — no extra work needed from the frontend.

**Sending a message:**
```
POST /api/chat/:chatId/message
{
  "message": "Write me a follow-up for this prospect",
  "stream": true,          // ALWAYS set true for best UX
  "force_search": false,   // set true to force web search
  "attachments": [
    { "url": "...", "type": "image/png", "name": "screenshot.png" }
  ]
}
```
Max message length: **5000 characters**
Max attachments: **10 files**

**Streaming response (SSE):**
When `stream: true`, the server sends `text/event-stream`. Parse events as:
```
data: {"type": "chunk", "content": "Hello"}
data: {"type": "chunk", "content": " world"}
data: {"type": "done", "message_id": "uuid"}
```

On error:
```
data: {"type": "error", "message": "..."}
```

**Non-streaming response:**
```json
{
  "message": {
    "id": "uuid",
    "role": "assistant",
    "content": "Full response text",
    "created_at": "ISO8601"
  }
}
```

**AI context injected automatically per message:**
- User voice profile (style, avoid_phrases, persona)
- Product description + target audience
- Up to 5 memory facts (if `memory_enabled = true`)
- Up to 3 active goals
- Latest check-in mood score
- Last 8 chat messages as conversation history

**Web search trigger:** The server auto-searches if it detects the message needs current information (keyword detection). Can also force with `force_search: true`.

**Chat list:** `GET /api/chat` — returns non-archived chats, sorted by `last_message_at DESC`
**Archive chat:** `DELETE /api/chat/:chatId` — soft-archives, does not hard-delete

**Meeting Notes Mode:**
- Created via `POST /api/calendar/:id/start-meeting-notes`
- Chat linked to a specific event (`event_id` set)
- Mode = `meeting_notes`
- Idempotent: calling multiple times returns the same chat

---

### 4.3 — Practice Mode (Simulated Buyer Conversations)

This is one of Kith's most complex features. The frontend must handle several async behaviors.

**Starting a session:**
```
POST /api/practice/start
{
  "scenario_type": "ghost",                    // optional — random if omitted
  "session_goal": "Get a reply from a ghost",  // optional free text
  "pressure_modifier": "aggressive_buyer",     // optional
  "drill_type": null,                          // optional
  "opportunity_context": "uuid",               // optional — use real opportunity
  "bio_note": "She runs a 10-person startup"   // optional extra context
}
```

**Response:**
```json
{
  "session_id": "uuid",
  "chat_id": "uuid",
  "scenario_type": "ghost",
  "practice_prompt": "You're reaching out to a busy founder who...",
  "instruction": "Your goal: Get a reply from this ghost",
  "difficulty": "standard",
  "buyer_profile": {
    "name": "Sarah",
    "role": "Head of Sales",
    "company": "TechFlow Inc",
    "interest_score": 45,
    "trust_score": 30,
    "confusion_score": 20,
    "opening_mood": "neutral"
  },
  "buyer_state": { /* same structure */ },
  "realtime_channel": "chat:uuid"
}
```

**⚠️ Important for frontend:** Subscribe to Supabase Realtime channel `chat:{chat_id}` immediately after session start to receive delivery simulation events.

**Difficulty auto-detection:**
- `< 5 sessions` → beginner
- `5–14 sessions` → standard
- `15–29 sessions OR reply_rate < 30%` → advanced
- `30+ sessions AND reply_rate >= 30%` → expert

**Sending a message:**
```
POST /api/practice/:sessionId/message
{ "content": "Hi Sarah, I noticed your team is hiring SDRs..." }
```

**Response:**
```json
{
  "message_ids": ["uuid1", "uuid2"],
  "buyer_state": {
    "interest_score": 52,
    "trust_score": 35,
    "confusion_score": 15,
    "mood": "cautiously interested",
    "last_reasoning": "[hidden during active session]"
  },
  "session_ended": false,
  "conversation_outcome": null,
  "chunk_count_hint": 2,
  "ghost_broke": null,
  "ghosted": null,
  "quality_score": null,
  "hint": null
}
```

**Ghost scenario special responses:**
- `ghosted: true` → message was not reply-worthy; buyer stays silent; show "No reply received" state
- `ghost_broke: true` → message was good enough; ghost finally replies; show buyer response

**Delivery simulation (via Supabase Realtime):**
```
t+0ms:   message saved, delivery_status: "pending"
t+500ms: PRACTICE_DELIVERED job fires → delivery_status: "delivered" → show checkmarks
t+1500ms: PRACTICE_SEEN job fires → delivery_status: "seen" → show "read" indicator
```

**Session states:**
- `completed: false` → session is active
- `completed: true` → session ended (by AI decision, goal achievement, or explicit complete call)
- `session_ended: true` in message response → AI decided to end the session

**Completing a session:**
```
POST /api/practice/:sessionId/complete
{ "rating": 4 }   // optional 1-5 star rating
```
Response: `{ success, session_id, total_completed, already_completed }`

Background jobs triggered (with delays):
- `PRACTICE_SKILL_SCORES` → 2 seconds
- `PRACTICE_COACHING_ANNOTATIONS` → 5 seconds
- `PRACTICE_PLAYBOOK` → 2 hours

**Getting session outcome (after completion):**
```
GET /api/practice/:sessionId/outcome
```
Returns `PracticeSession` object including:
- `session_debrief`: `{ what_worked, what_didnt, improvement, coachable_moment }`
- `skill_scores`: `{ hook, clarity, value_prop, personalization, cta, tone, discovery, objection_handling, brevity }`
- `coaching_annotations`: per-message coaching notes (populated at t+5s)
- `playbook`: full session playbook (populated at t+2h)
- `message_strength_score`: 0–100 composite
- `conversation_outcome`: final outcome string
- `buyer_state`: final buyer state

**Replay (full session review):**
```
GET /api/practice/:sessionId/replay
```
Only available for `completed = true` sessions. Returns:
- All messages
- `internal_monologues[]`: array of `{ message_id, thought }` — the AI buyer's hidden reasoning at each step

**⚠️ IMPORTANT:** `internal_monologue` is HIDDEN during active sessions (stripped from `GET /api/practice/:sessionId/messages`) and only revealed in the replay endpoint. Do NOT show internal monologue while a session is active.

**Skills dashboard:**
```
GET /api/practice/skill-dashboard
```
Returns:
- `skill_history`: last 4 weeks of `SkillProgression` objects
- `recent_sessions`: last 10 scored sessions
- `badges`: all earned badges

**Badges list:**
```
GET /api/practice/badges  (inferred — see GET /api/practice/sessions)
```
Badge types include: `first_session`, `first_rejection`, `ghostbuster`, `5_sessions`, etc.

**Session retry:**
```
POST /api/practice/:sessionId/retry
```
- Original session must be `completed = true`
- Creates new session with same scenario type + fresh buyer profile
- New session has `retry_of_session_id` pointing to original
- Returns same shape as session start

**Paginated history:**
```
GET /api/practice/sessions?limit=20&offset=0&type=ghost
```

**Delete incomplete session:**
```
DELETE /api/practice/:sessionId
```
- Only allowed if `completed = false`
- Returns `409` if session is already completed

---

### 4.4 — Pipeline / CRM Board

The pipeline is a Kanban board with 5 columns. "new" stage opportunities live in the Opportunities view, not here.

**Fetching the board:**
```
GET /api/pipeline           // personal view
GET /api/pipeline?view=team // team view (manager+ only)
```

Response structure:
```json
{
  "pipeline": {
    "contacted": [ /* Opportunity[] with feedback[] */ ],
    "replied": [ /* ... */ ],
    "call_demo": [ /* ... */ ],
    "closed_won": [ /* ... */ ],
    "closed_lost": [ /* ... */ ]
  },
  "view": "individual | team",
  "metrics": { /* PipelineMetrics */ }
}
```

**Moving a deal:**
```
PUT /api/pipeline/:id/stage
{ "stage": "call_demo" }
```

Special behaviors:
- Moving to `call_demo` → response includes `calendar_prompt` object → show "Add to Calendar?" suggestion
- Moving to `closed_won` → logs `DEAL_CLOSED` workspace activity event
- Moving to `closed_lost` → optionally capture `lost_reason`

**Deal card data to display:**
From the `Opportunity` schema: `target_name`, `platform`, `target_context`, `composite_score`, `stage`, `follow_up_count`, `last_stage_changed_at`, `deal_value_usd` (from feedback)

**Setting deal value:**
```
PATCH /api/pipeline/:id/deal-value
{ "deal_value_usd": 5000 }
```

**Pipeline metrics (standalone):**
```
GET /api/pipeline/metrics
```
Returns `PipelineMetrics` with: `total_revenue`, `pipeline_value`, `win_rate_pct`, `contacted_count`, `replied_count`, `call_demo_count`, `closed_won_count`, `closed_lost_count`

---

### 4.5 — Feedback Loop (Critical Data Flow)

Feedback is the primary driver of the entire skill analytics system. Every feedback submission triggers conversation analysis.

**Submitting feedback:**
```
POST /api/feedback
{
  "opportunity_id": "uuid",
  "outcome": "positive | negative | pending",
  "outcome_note": "They replied asking for a demo",  // max 500 chars
  "is_final": true,
  "deal_value_usd": 5000,
  "scheduled_call": true,
  "scheduled_call_date": "2024-12-15T14:00:00Z",
  "scheduled_call_notes": "30-min discovery call"
}
```

**What happens after:**
- `outcome = positive` AND `stage = new` → stage advances to `contacted`
- `outcome = positive` AND `stage = contacted` → stage advances to `replied`
- `is_final = true` AND `outcome != pending` → queues `CONVERSATION_ANALYSIS` background job
  - This job scores the message across 6 skill dimensions
  - Scores feed weekly skill progression tracking

**Retrieving feedback:**
```
GET /api/feedback/:opportunityId
GET /api/feedback/pending         // opportunities waiting for feedback
GET /api/feedback/history?limit=20&offset=0
```

**⚠️ Gap:** `GET /api/feedback/history` does not return a total count, making pagination UI difficult. Use `has_more` pattern.

---

### 4.6 — Goals & Progress Tracking

**Creating a goal:**
```
POST /api/goals
{
  "goal_text": "Close 5 clients this month",
  "goal_type": "custom",
  "target_value": 5,
  "target_unit": "clients",
  "target_date": "2024-12-31"
}
```

**Logging progress (with AI coaching):**
```
POST /api/goals/:goalId/notes
{
  "note_text": "Closed first client today — AcmeCorp!",
  "explicit_delta": 1   // override AI-inferred progress, optional
}
```

Response:
```json
{
  "success": true,
  "note": { /* GoalNote */ },
  "coaching_response": "Fantastic! One down. Here's what to do with the momentum...",
  "progress_delta": 1,
  "new_value": 1,
  "goal_completed": false
}
```

If `goal_completed = true` → show celebration UI → goal auto-marked `completed` → `GOAL_REACHED` activity event logged → optional tip card generated.

**Goal note `sentiment`:** `positive | neutral | negative` — can be used to color-code notes in the UI.

**Goal list:** `GET /api/goals` → returns active goals
**Goal notes:** `GET /api/goals/:goalId/notes` → returns all notes for a goal
**Delete goal:** `DELETE /api/goals/:id`
**Delete note:** `DELETE /api/goals/:goalId/notes/:noteId`

**Pipeline insight for a goal:**
```
GET /api/goals/:goalId/pipeline-insight
```
Returns an AI-generated insight connecting the goal to current pipeline status. Cached 24 hours.

---

### 4.7 — Calendar & Meeting Intelligence

**Fetching events:**
```
GET /api/calendar?from=2024-12-01&to=2024-12-31
```
Default range: last 14 days to future. Each event enriched with:
- `debrief_needed: boolean` — true if event is in the past with no debrief
- `prospect.health_score` — if a prospect is linked

**Creating an event:**
```
POST /api/calendar
{
  "title": "Discovery call with Sarah Chen",
  "event_date": "2024-12-15",
  "start_time": "2024-12-15T14:00:00Z",
  "end_time": "2024-12-15T14:30:00Z",
  "event_type": "call",              // meeting|call|demo|followup|other
  "attendee_name": "Sarah Chen",     // triggers auto prospect upsert
  "attendee_context": "Head of Sales at TechFlow, 10 years experience...",
  "opportunity_id": "uuid | null",
  "prospect_id": "uuid | null"
}
```

**What happens immediately after event creation:**
1. If `attendee_name` provided → auto-upserts a `prospects` row (case-insensitive dedup)
2. BullMQ queues (deduplicated by jobId):
   - `CALENDAR_RESEARCH_PROSPECT` (deduplicated as `"research:{eventId}"`) → Perplexity researches the prospect
   - `CALENDAR_PREP_GENERATE` (deduplicated as `"prep:{eventId}"`) → Groq generates enriched prep doc

**Frontend polling for prep:**
Poll `GET /api/calendar/:id` every 5 seconds until `prep_generated: true`, then show prep content. Alternatively, subscribe to Supabase Realtime on `user_events` table for the event row to update.

**Event detail shape (from `GET /api/calendar/:id`):**
```json
{
  "event": {
    /* CalendarEvent — see schema section */
    "prep_content": {
      "key_topics": [],
      "prospect_background": "...",
      "open_commitments": [],
      "talking_points": [],
      "perplexity_research": {}
    },
    "prep_generated": true,
    "debrief_needed": true
  },
  "prospect": { /* Prospect | null */ }
}
```

**Manual prep generation:**
```
POST /api/calendar/:id/prep
```
Synchronous — generates and returns immediately. Use this if the background job didn't run.

**Post-meeting debrief:**
```
POST /api/calendar/:id/debrief
{
  "meeting_notes": "Sarah was very engaged. She asked about pricing 3 times...",
  "outcome": "positive",       // hot|positive|neutral|cold|dead
  "energy_score": 4            // 1-5
}
```

AI automatically:
1. Structures notes into `debrief_content` object
2. Extracts commitments → saves to `conversation_commitments`
3. Extracts signals (buying/risk/timing/engagement) → saves to `conversation_signals`
4. Generates `follow_up_message`
5. Recalculates prospect health score
6. Returns all extracted data immediately

**Calendar alerts (for badge counts):**
```
GET /api/calendar/alerts
```
Returns: `{ debriefs_needed: N, overdue_commitments: N, due_soon_commitments: N }`
Call this on every app load to populate notification badges.

---

### 4.8 — Prospect CRM & Relationship Intelligence

**Prospect list:**
```
GET /api/prospects?sort=health&limit=50
```
Sort options: `health` (default, highest first), `health_asc`, `recent`
Returns each prospect with `pending_commitments` count appended.

**Prospect detail:**
```
GET /api/prospects/:id
```
Returns:
```json
{
  "prospect": { /* Prospect */ },
  "timeline": [
    { "type": "event|chat|signal", "id": "uuid", "date": "ISO8601", "title": "..." }
  ],
  "signals": [ /* ConversationSignal[] */ ],
  "commitments": [ /* ConversationCommitment[] */ ],
  "meetings": [ /* CalendarEvent[] */ ],
  "chats": [ /* Chat[] */ ]
}
```

**Health score color guide (for UI):**
- 70–100 → green (healthy)
- 40–69 → yellow (at risk)
- 0–39 → red (danger)

**Refresh AI summary:**
```
POST /api/prospects/:id/refresh-summary
```
Regenerates the AI relationship summary from the full timeline. Show loading state while running.

**Prospect stages:** `prospect | engaged | negotiating | closed_won | closed_lost | dormant`
Update via `PUT /api/prospects/:id` with `{ "stage": "engaged" }`.

---

### 4.9 — Commitments

Commitments are action items extracted from meeting debriefs. There are two types: `founder` (you need to do something) and `prospect` (they need to do something).

**Getting commitments:**
```
GET /api/commitments?status=active&owner=founder&limit=50
```
Status options: `active` (pending + overdue), `pending`, `done`, `overdue`, `ignored`

Response structure groups by urgency:
```json
{
  "commitments": [ /* all matching */ ],
  "overdue": [ /* ConversationCommitment[] */ ],
  "due_soon": [ /* ConversationCommitment[] */ ],
  "pending": [ /* ConversationCommitment[] */ ]
}
```

**Marking done:**
```
PUT /api/commitments/:id
{ "status": "done" }
```
If commitment has a linked `prospect_id` → prospect health score gets +8 boost.

**Generate follow-up message for a commitment:**
```
POST /api/commitments/:id/generate-message
```
Returns a <60-word follow-up message using the user's voice style + prospect context. Saved to `commitment.follow_up_message`.

---

### 4.10 — Growth Feed & Daily Check-In

**Growth feed:**
```
GET /api/growth/feed?limit=20&offset=0
```
Returns:
```json
{
  "cards": [ /* GrowthCard[] sorted by priority DESC */ ],
  "opportunities": [ /* top 5 by composite_score */ ],
  "goals": [ /* active UserGoal[] */ ],
  "archetype": "builder",
  "pagination": { "limit": 20, "offset": 0, "total": 45, "has_more": true }
}
```

Cards are filtered: `is_dismissed=false AND (expires_at IS NULL OR expires_at > now())`.

**GrowthCard fields to display:**
- `card_type`: `tip | strategy | resource | reflection | challenge | community | insight`
- `title`, `body` — main content
- `action_label` — CTA button text (e.g., "Try This Now")
- `action_type` — `internal_chat` → open a chat pre-seeded with card context
- `priority` — higher = show first
- `generated_by` — `ai_daily | ai_checkin | ai_weekly | goal_note_ai | ai_pattern_detection`

**Daily check-in:**
```
GET /api/growth/checkin/today
```
Returns: `{ check_in: DailyCheckIn, is_new: boolean }`
- If `is_new = true` → fresh questions just generated; user hasn't answered yet
- If `is_new = false` → already submitted today; show `ai_response`

```
POST /api/growth/checkin
{
  "answers": { "q0": "I sent 3 messages and got 1 reply", "q1": "..." },
  "mood_score": 7,   // 1-10
  "date": "2024-12-10"  // optional, defaults to today
}
```
Returns: `{ success, ai_response, check_in_streak, message }`
- `409` if already submitted today
- `404` if `GET /checkin/today` was not called first

**Weekly plan:**
```
GET /api/growth/plan
```
Returns: `{ plan: GrowthCard, cached: boolean }`
The plan is a `strategy` type card with `daily_actions` and `focus_area` in its metadata.

**Archetype detection:**
```
POST /api/growth/archetype/detect
```
Returns: `{ archetype, confidence, cached: boolean }`
Rate limited to once every 7 days. If called within 7 days, returns `cached: true`.

**Growth card history:**
```
GET /api/growth/history?limit=20&offset=0&type=tips
```
Type filter: `tips` (tip/challenge/reflection/resource) or `plans` (strategy cards)
Returns: `{ cards: GrowthCard[], total: integer }`

---

### 4.11 — Insights & Skill Analytics

**Quick summary (for dashboard widget):**
```
GET /api/insights/summary
```
Returns:
```json
{
  "has_patterns": true,
  "top_pattern": { /* CommunicationPattern | null */ },
  "patterns_count": 3,
  "composite_score": 7.4,
  "composite_delta": 0.8,
  "top_weakness": "cta",
  "top_strength": "personalization",
  "positive_rate_30d": 0.28,
  "messages_analyzed": 15,
  "has_enough_data": true
}
```
`has_enough_data = false` when < 5 analyses → show "Keep sending messages to unlock insights" placeholder.

**Full pattern list:**
```
GET /api/insights/patterns?limit=20&offset=0
```
Returns paginated `CommunicationPattern[]` with `total` count.

Pattern types: `ghost_trigger | success_signal | weakness | objection_type`

**Dismiss a pattern:**
```
DELETE /api/insights/patterns/:id
```

**Weekly prospect insights:**
```
GET /api/insights/weekly
```
Returns AI-generated insights about specific prospects. Undismissed only.

**Why-losing report:**
```
GET /api/insights/why-losing
```
Cached 4 hours. Returns: `{ has_data, report: { primary_diagnosis, evidence_summary, immediate_fix, skill_to_focus, encouraging_note }, generated_at }`

**Skill trend (week-over-week):**
```
GET /api/insights/skill-trend
```
Returns: `{ trend_status, summary, biggest_gain, biggest_drop, dimensions, top_weakness, top_strength }`
`trend_status` values: `improving | declining | mixed_positive | mixed_negative | stable`

**Signals summary:**
```
GET /api/insights/signals/summary
```
Returns breakdown of signal types received in last 30 days.

**Commitments health:**
```
GET /api/insights/commitments/summary
```
Returns overdue and due_soon commitment counts.

**Manager-only insights:**
```
GET /api/insights/workspace/why-losing      // team loss report (cached 4h)
GET /api/insights/workspace/skill-matrix    // per-member skill snapshots
```

---

### 4.12 — Team Management (Manager+ Only)

**Team metrics:**
```
GET /api/metrics/workspace/team-overview      // per-member performance
GET /api/metrics/workspace/leaderboard        // ranked by score
GET /api/metrics/workspace/coaching-queue     // members needing attention
GET /api/metrics/workspace/team-velocity      // week-over-week skill trend
GET /api/workspaces/:id/analytics             // 30-day overview
```

**Leaderboard member shape:**
```json
{
  "user_id": "uuid",
  "name": "John",
  "role": "member",
  "sent_30d": 45,
  "positive_rate": 0.31,
  "closed_won": 3,
  "total_revenue": 15000,
  "score": 78
}
```

**Coaching queue flags:**
`no_outreach_7d | no_practice_7d | score_declining | low_skill_score`
A member appears in the queue if they have ANY of these flags.

**Nudge a member:**
```
POST /api/workspaces/:id/nudge
{ "user_id": "uuid", "message": "Great job this week! Keep it up." }
```
Sends a push notification to the member and logs a `nudge_sent` activity event.

**Activity feed:**
```
GET /api/workspace/activity?limit=20&offset=0
```
Events: `practice_completed | deal_closed | opportunity_created | goal_reached | member_joined | opportunity_assigned | nudge_sent`
Each event includes the `users` object (id, name, email) of who performed the action.

---

### 4.13 — Follow-Up Queue

Follow-ups are AI-generated messages for stalled pipeline deals.

**Auto-generation rules (daily 10am job):**
- `contacted` stage + no activity for 4 days → generate follow-up
- `replied` stage + no activity for 6 days → generate follow-up
- `call_demo` stage + no activity for 3 days → generate follow-up

**Getting pending follow-ups:**
```
GET /api/followup
```
Returns opportunities where `follow_up_message IS NOT NULL` and stage is active.

**Actions:**
```
POST /api/followup/:id/sent       // message sent, increments follow_up_count
POST /api/followup/:id/dismiss    // skip, clears message, increments counter
```

---

### 4.14 — Workspace Management

**Full invite management flow:**
1. Admin invites: `POST /api/workspaces/:id/invite` → returns `{ expires_at }`
2. View pending: `GET /api/workspaces/:id/invites` → `PendingInvite[]`
3. Revoke invite: `DELETE /api/workspaces/:id/invites/:inviteId`
4. Invitee accepts: `POST /api/user/accept-invite/:token`

Invites expire after **7 days**.

**`PendingInvite` shape:**
```json
{
  "id": "uuid",
  "invite_email": "newmember@example.com",
  "role": "member",
  "invite_expires_at": "ISO8601",
  "invited_by": "uuid",
  "created_at": "ISO8601",
  "is_expired": false
}
```

**Transferring ownership:**
```
PUT /api/workspaces/:id/transfer-ownership
{ "new_owner_id": "uuid" }
```
Atomically: old owner → admin, new owner → owner. Clears Redis caches for both.

**Leaving a workspace:**
```
DELETE /api/workspaces/:id/leave
```
403 if caller is the owner (must transfer first).

**Workspace switch (canonical endpoint):**
```
POST /api/workspaces/switch
{ "workspace_id": "uuid" }
```
⚠️ After switching, the frontend MUST re-fetch all data — everything is scoped to the new workspace.

---

### 4.15 — File Upload

```
POST /api/upload
Content-Type: multipart/form-data
{ file: <binary> }
```
Optional query: `?chat_id=uuid` to link the upload to a chat.

Response:
```json
{
  "id": "uuid",
  "url": "https://[supabase].storage/clutch-uploads/...",
  "filename": "screenshot.png",
  "type": "image/png",
  "size_bytes": 45230,
  "chat_id": "uuid | null",
  "created_at": "ISO8601"
}
```

Then pass `url` as an attachment in `POST /api/chat/:chatId/message`.

---

### 4.16 — User Settings

**Update profile:**
```
PUT /api/auth/me
{
  "name": "Jane Doe",
  "business_name": "AcmeSaaS",
  "product_description": "...",
  "target_audience": "...",
  "website": "https://acme.com",
  "role": "founder",
  "industry": "saas",
  "experience_level": "3 years",
  "bio": "...",
  "preferred_platforms": ["linkedin", "reddit"]
}
```

**Update notification preferences:**
```
PUT /api/user/notification-preferences
{
  "new_opportunities": true,
  "feedback_reminders": true,
  "practice_replies": true,
  "calendar_prep_ready": true,
  "daily_tip": true,
  "check_in_prompt": true,
  "debrief_reminder": true,
  "commitment_reminder": true,
  "weekly_insights": true,
  "weekly_plan": true,
  "pattern_insights": true,
  "skill_progression": true,
  "morning_growth_push": true,
  "evening_growth_push": true,
  "memory_enabled": true,       // also controls AI memory injection
  "email_digest_enabled": false
}
```

**View/delete memory facts:**
```
GET /api/user/memory                // returns active UserMemoryFact[]
DELETE /api/user/memory/:id         // soft-deactivates (is_active: false)
```

**UserMemoryFact shape:**
```json
{
  "id": "uuid",
  "fact": "User sells to mid-market B2B SaaS companies",
  "fact_category": "target_audience",
  "reinforcement_count": 5,
  "last_reinforced_at": "ISO8601",
  "created_at": "ISO8601"
}
```

**Rebuild voice profile from existing answers:**
```
POST /api/onboarding/rebuild-voice-profile
```
Re-runs voice profile generation. Also triggers new `SEED_MEMORY` background job.

**Manual voice profile override:**
```
PUT /api/onboarding/profile
{ "voice_profile": { /* VoiceProfile object */ } }
```

---

## 5. Complete Endpoint Reference

### Auth (`/api/auth`)
| Method | Path | Auth | Min Role | Description |
|---|---|---|---|---|
| POST | `/register` | ❌ | — | Create account |
| POST | `/login` | ❌ | — | Login |
| POST | `/logout` | ✅ | — | Logout |
| POST | `/refresh` | ❌ | — | Refresh tokens |
| GET | `/me` | ✅ | — | Get current user |
| PUT | `/me` | ✅ | — | Update profile |
| DELETE | `/account` | ✅ | — | Delete account |
| POST | `/profile/ensure` | ✅ | — | OAuth post-redirect |
| GET | `/google/url` | ❌ | — | Get OAuth URL |
| POST | `/resend-verification` | ❌ | — | Resend email |

### User (`/api/user`)
| Method | Path | Auth | Min Role | Description |
|---|---|---|---|---|
| PUT | `/fcm-token` | ✅ | — | Register push token |
| PUT | `/notification-preferences` | ✅ | — | Update notifications |
| POST | `/switch-workspace` | ✅ | — | Switch workspace (alias) |
| GET | `/workspaces` | ✅ | — | List workspaces (alias) |
| POST | `/accept-invite/:token` | ✅ | — | Accept invite |
| GET | `/notifications` | ✅ | — | List notifications |
| POST | `/notifications/:id/read` | ✅ | — | Mark notification read |
| POST | `/notifications/read-all` | ✅ | — | Mark all read |
| POST | `/feature-event` | ✅ | — | Track analytics event |
| GET | `/memory` | ✅ | — | List memory facts |
| DELETE | `/memory/:id` | ✅ | — | Delete memory fact |

### Workspaces (`/api/workspaces`)
| Method | Path | Auth | Min Role | Description |
|---|---|---|---|---|
| GET | `/` | ✅ | — | List workspaces |
| POST | `/` | ✅ | — | Create workspace |
| POST | `/switch` | ✅ | — | Switch workspace |
| GET | `/:id` | ✅ | member | Get workspace |
| PUT | `/:id` | ✅ | owner | Update workspace |
| DELETE | `/:id` | ✅ | owner | Delete workspace |
| POST | `/:id/invite` | ✅ | admin | Invite member |
| GET | `/:id/invites` | ✅ | admin | List pending invites |
| DELETE | `/:id/invites/:inviteId` | ✅ | admin | Revoke invite |
| GET | `/:id/members` | ✅ | member | List members |
| PUT | `/:id/members/:uid/role` | ✅ | admin | Change role |
| DELETE | `/:id/members/:uid` | ✅ | admin | Remove member |
| DELETE | `/:id/leave` | ✅ | member | Leave workspace |
| PUT | `/:id/transfer-ownership` | ✅ | owner | Transfer ownership |
| POST | `/:id/nudge` | ✅ | manager | Nudge member |
| GET | `/:id/analytics` | ✅ | manager | Team analytics |

### Onboarding (`/api/onboarding`)
| Method | Path | Auth | Min Role | Description |
|---|---|---|---|---|
| GET | `/status` | ✅ | — | Check status |
| POST | `/basic` | ✅ | — | Submit basic info |
| GET | `/questions` | ✅ | — | Get AI questions |
| POST | `/answers` | ✅ | — | Submit answers |
| POST | `/abbreviated` | ✅ | — | Invited member path |
| POST | `/sample-message` | ✅ | — | Generate sample |
| PUT | `/profile` | ✅ | — | Update voice profile |
| POST | `/rebuild-voice-profile` | ✅ | — | Rebuild AI profile |

### Opportunities (`/api/opportunities`)
| Method | Path | Auth | Min Role | Description |
|---|---|---|---|---|
| GET | `/` | ✅ | member | List (paginated, filterable) |
| POST | `/refresh` | ✅ | member | Discover new (rate limited 5/hr) |
| GET | `/team` | ✅ | manager | All workspace opportunities |
| GET | `/:id` | ✅ | member | Detail (auto-marks viewed) |
| PUT | `/:id/status` | ✅ | member | Update status |
| GET | `/:id/intel` | ✅ | member | AI prospect intel |
| PUT | `/:id/assign` | ✅ | manager | Assign to member |

### Chat (`/api/chat`)
| Method | Path | Auth | Min Role | Description |
|---|---|---|---|---|
| GET | `/` | ✅ | member | List non-archived chats |
| POST | `/` | ✅ | member | Create chat |
| GET | `/:chatId` | ✅ | member | Get chat + messages |
| POST | `/:chatId/message` | ✅ | member | Send message (streaming) |
| DELETE | `/:chatId` | ✅ | member | Archive chat |

### Practice (`/api/practice`)
| Method | Path | Auth | Min Role | Description |
|---|---|---|---|---|
| POST | `/start` | ✅ | member | Start session |
| GET | `/sessions` | ✅ | member | List sessions + stats + badges |
| GET | `/skill-dashboard` | ✅ | member | 4-week skill history + recent sessions |
| GET | `/badges` | ✅ | member | List earned badges |
| GET | `/history` | ✅ | member | Paginated session history |
| GET | `/:sessionId` | ✅ | member | Session detail |
| DELETE | `/:sessionId` | ✅ | member | Delete incomplete session |
| GET | `/:sessionId/messages` | ✅ | member | Session messages |
| POST | `/:sessionId/message` | ✅ | member | Send practice message |
| POST | `/:sessionId/complete` | ✅ | member | Complete session |
| GET | `/:sessionId/outcome` | ✅ | member | Get scoring + debrief |
| GET | `/:sessionId/replay` | ✅ | member | Replay with monologues |
| POST | `/:sessionId/retry` | ✅ | member | Retry session |

### Pipeline (`/api/pipeline`)
| Method | Path | Auth | Min Role | Description |
|---|---|---|---|---|
| GET | `/` | ✅ | member | Board (supports ?view=team) |
| GET | `/metrics` | ✅ | member | Aggregated metrics |
| GET | `/team` | ✅ | manager | Team pipeline |
| GET | `/:id` | ✅ | member | Deal detail with feedback |
| DELETE | `/:id` | ✅ | member | Delete deal |
| PUT | `/:id/stage` | ✅ | member | Move stage |
| PATCH | `/:id/deal-value` | ✅ | member | Set deal value |
| PUT | `/:id/assign` | ✅ | manager | Assign deal |

### Feedback (`/api/feedback`)
| Method | Path | Auth | Min Role | Description |
|---|---|---|---|---|
| POST | `/` | ✅ | member | Submit outcome |
| GET | `/:opportunityId` | ✅ | member | Get feedback for opportunity |
| GET | `/pending` | ✅ | member | Opportunities awaiting feedback |
| GET | `/history` | ✅ | member | Paginated history |

### Follow-Up (`/api/followup`)
| Method | Path | Auth | Min Role | Description |
|---|---|---|---|---|
| GET | `/` | ✅ | member | List pending follow-ups |
| POST | `/:id/sent` | ✅ | member | Mark as sent |
| POST | `/:id/dismiss` | ✅ | member | Dismiss |

### Goals (`/api/goals`)
| Method | Path | Auth | Min Role | Description |
|---|---|---|---|---|
| GET | `/` | ✅ | member | List active goals |
| POST | `/` | ✅ | member | Create goal |
| GET | `/:id` | ✅ | member | Get goal detail |
| PUT | `/:id` | ✅ | member | Update goal |
| DELETE | `/:id` | ✅ | member | Delete goal |
| GET | `/:goalId/notes` | ✅ | member | List notes |
| POST | `/:goalId/notes` | ✅ | member | Add note + AI response |
| DELETE | `/:goalId/notes/:noteId` | ✅ | member | Delete note |
| GET | `/:goalId/pipeline-insight` | ✅ | member | AI insight (cached 24h) |

### Metrics (`/api/metrics`)
| Method | Path | Auth | Min Role | Description |
|---|---|---|---|---|
| GET | `/dashboard` | ✅ | member | Full dashboard data |
| GET | `/skill-breakdown` | ✅ | member | 7-day skill scores |
| GET | `/intelligence` | ✅ | member | AI insights (cached 4h) |
| GET | `/workspace/leaderboard` | ✅ | manager | Team ranking |
| GET | `/workspace/coaching-queue` | ✅ | manager | Members needing help |
| GET | `/workspace/team-velocity` | ✅ | manager | Week-over-week trend |
| GET | `/workspace/team-overview` | ✅ | manager | Per-member stats |

### Calendar (`/api/calendar`)
| Method | Path | Auth | Min Role | Description |
|---|---|---|---|---|
| GET | `/` | ✅ | member | List events (?from=date&to=date) |
| POST | `/` | ✅ | member | Create event |
| GET | `/alerts` | ✅ | member | Debrief + commitment counts |
| GET | `/:id` | ✅ | member | Event detail + prep |
| PUT | `/:id` | ✅ | member | Update event |
| DELETE | `/:id` | ✅ | member | Delete event |
| POST | `/:id/prep` | ✅ | member | Manual prep generation |
| POST | `/:id/debrief` | ✅ | member | Submit debrief |
| POST | `/:id/research` | ✅ | member | Trigger prospect research |
| POST | `/:id/start-meeting-notes` | ✅ | member | Create meeting notes chat |

### Upload (`/api/upload`)
| Method | Path | Auth | Min Role | Description |
|---|---|---|---|---|
| POST | `/` | ✅ | member | Upload file |

### Suggestions (`/api/suggestions`)
| Method | Path | Auth | Min Role | Description |
|---|---|---|---|---|
| GET | `/` | ✅ | member | Get 5 personalized chat starters |

### Prospects (`/api/prospects`)
| Method | Path | Auth | Min Role | Description |
|---|---|---|---|---|
| GET | `/` | ✅ | member | List (?sort=health&limit=50) |
| POST | `/` | ✅ | member | Create |
| GET | `/:id` | ✅ | member | Detail with timeline |
| PUT | `/:id` | ✅ | member | Update (strict validation) |
| DELETE | `/:id` | ✅ | member | Delete (hard) |
| POST | `/:id/refresh-summary` | ✅ | member | Regenerate AI summary |

### Commitments (`/api/commitments`)
| Method | Path | Auth | Min Role | Description |
|---|---|---|---|---|
| GET | `/` | ✅ | member | List (?status=active&owner=founder) |
| PUT | `/:id` | ✅ | member | Update status/due_date |
| POST | `/:id/generate-message` | ✅ | member | Generate follow-up message |

### Insights (`/api/insights`)
| Method | Path | Auth | Min Role | Description |
|---|---|---|---|---|
| GET | `/summary` | ✅ | member | Quick overview |
| GET | `/patterns` | ✅ | member | Pattern list (paginated) |
| DELETE | `/patterns/:id` | ✅ | member | Dismiss pattern |
| GET | `/weekly` | ✅ | member | Weekly prospect insights |
| GET | `/signals/summary` | ✅ | member | Signal breakdown |
| GET | `/commitments/summary` | ✅ | member | Commitment health |
| GET | `/why-losing` | ✅ | member | Loss report (cached 4h) |
| GET | `/skill-trend` | ✅ | member | Week-over-week skill trend |
| GET | `/workspace/why-losing` | ✅ | manager | Team loss report |
| GET | `/workspace/skill-matrix` | ✅ | manager | Per-member skills |

### Growth (`/api/growth`)
| Method | Path | Auth | Min Role | Description |
|---|---|---|---|---|
| GET | `/feed` | ✅ | member | Growth card feed |
| POST | `/cards/:id/read` | ✅ | member | Mark card read |
| POST | `/cards/:id/dismiss` | ✅ | member | Dismiss card |
| GET | `/checkin/today` | ✅ | member | Today's check-in |
| POST | `/checkin` | ✅ | member | Submit check-in |
| GET | `/history` | ✅ | member | Card history |
| GET | `/plan` | ✅ | member | Weekly plan |
| POST | `/archetype/detect` | ✅ | member | Detect archetype |

### Workspace Activity (`/api/workspace`)
| Method | Path | Auth | Min Role | Description |
|---|---|---|---|---|
| GET | `/activity` | ✅ | manager | Activity feed (paginated) |

---

## 6. All Data Schemas

### User
```typescript
interface User {
  id: string;                          // UUID
  name: string | null;
  email: string;
  tier: "free" | "pro" | "enterprise";
  active_workspace_id: string | null;  // UUID
  onboarding_completed: boolean;
  onboarding_step: number;
  debug_mode: boolean;
  fcm_token: string | null;
  notification_preferences: NotificationPreferences;
  memory_enabled: boolean;
  email_digest_enabled: boolean;
  check_in_streak: number;
  last_tip_generated_at: string | null; // ISO8601
}
```

### NotificationPreferences
```typescript
interface NotificationPreferences {
  new_opportunities: boolean;
  feedback_reminders: boolean;
  practice_replies: boolean;
  calendar_prep_ready: boolean;
  daily_tip: boolean;
  check_in_prompt: boolean;
  debrief_reminder: boolean;
  commitment_reminder: boolean;
  weekly_insights: boolean;
  weekly_plan: boolean;
  pattern_insights: boolean;
  skill_progression: boolean;
  morning_growth_push: boolean;
  evening_growth_push: boolean;
}
```

### Workspace
```typescript
interface Workspace {
  id: string;
  name: string;
  slug: string;
  plan: "free" | "pro" | "enterprise";
  owner_user_id: string;
  settings: Record<string, any> | null;
  created_at: string;
}

interface WorkspaceWithMeta extends Workspace {
  member_count: number;
  role: "owner" | "admin" | "manager" | "member" | null;
  joined_at: string | null;
  is_active: boolean;  // true if this is the user's active_workspace_id
}
```

### WorkspaceProfile
```typescript
interface WorkspaceProfile {
  business_name: string | null;
  product_description: string | null;  // max 2000 chars
  target_audience: string | null;      // max 1000 chars
  role: "founder" | "sales" | "freelancer" | "marketer" | "developer" | "other" | null;
  industry: "saas" | "ecommerce" | "services" | "fintech" | "health" | "education" | "other" | null;
  experience_level: string | null;
  business_stage: string | null;
  preferred_platforms: string[] | null;
  primary_goal: string | null;
  website: string | null;
  bio: string | null;
  voice_profile: VoiceProfile | null;
  onboarding_completed: boolean;
  onboarding_step: number;
  archetype: "seller" | "builder" | "freelancer" | "creator" | "professional" | "learner" | null;
}
```

### VoiceProfile
```typescript
interface VoiceProfile {
  unique_value_prop: string;          // "The only tool that..."
  icp_trigger: string;                // "When prospects post about..."
  target_customer_description: string;
  main_objection: string;             // "It's too expensive"
  objection_reframe: string;          // "Think of it as..."
  best_proof_point: string;           // "Our users see 3x..."
  voice_style: string;                // "Conversational, direct, no buzzwords"
  outreach_persona: string;           // "Friendly advisor, not a pushy seller"
  avoid_phrases: string[];            // ["synergy", "leverage", "circle back"]
}
```

### Opportunity
```typescript
interface Opportunity {
  id: string;
  workspace_id: string;
  user_id: string;
  target_name: string | null;
  target_context: string;             // prospect's post or situation
  platform: "reddit" | "linkedin" | "twitter" | "facebook" | "instagram" |
            "producthunt" | "indiehackers" | "hackernews" | "quora" | "youtube" | "other";
  source_url: string | null;
  composite_score: number;            // 0-100, float
  fit_score: number | null;           // 0-10
  timing_score: number | null;        // 0-10
  intent_score: number | null;        // 0-10
  status: "pending" | "viewed" | "acted" | "sent" | "done";
  stage: "new" | "contacted" | "replied" | "call_demo" | "closed_won" | "closed_lost";
  assigned_to: string | null;
  marked_sent_at: string | null;
  last_stage_changed_at: string | null;
  follow_up_message: string | null;
  follow_up_count: number;
  prepared_message: string | null;
  created_at: string;
}

interface OpportunityIntel {
  pain_points: string[];
  talking_points: string[];
  risks: string[];
  confidence: "low" | "medium" | "high";
}
```

### Chat & ChatMessage
```typescript
interface Chat {
  id: string;
  workspace_id: string;
  user_id: string;
  title: string;
  chat_type: "general" | "opportunity" | "practice";
  chat_mode: "general" | "meeting_notes" | "prep" | "followup_coach";
  opportunity_id: string | null;
  prospect_id: string | null;
  event_id: string | null;
  practice_session_id: string | null;
  is_archived: boolean;
  message_count: number;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ChatMessage {
  id: string;
  chat_id: string;
  workspace_id: string;
  user_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  delivery_status: "pending" | "delivered" | "seen" | "replied" | "ghosted" | null;
  delivered_at: string | null;
  seen_at: string | null;
  scenario_type: string | null;
  chunk_index: number | null;
  is_final_chunk: boolean | null;
  created_at: string;
}
```

### PracticeSession
```typescript
interface BuyerProfile {
  name: string;
  role: string;
  company: string;
  interest_score: number;    // 0-100
  trust_score: number;       // 0-100
  confusion_score: number;   // 0-100
  opening_mood: "neutral" | "skeptical" | "curious" | "defensive" | "rushed";
}

interface BuyerState {
  interest_score: number;    // 0-100 — updated each message
  trust_score: number;       // 0-100
  confusion_score: number;   // 0-100
  mood: string;              // free text description
  last_reasoning: string;    // AI's internal reasoning (hidden during active session)
}

interface PracticeSession {
  id: string;
  user_id: string;
  chat_id: string;
  scenario_type: "interested" | "polite_decline" | "ghost" | "skeptical" | "price_objection" | "not_right_time";
  practice_prompt: string;
  difficulty_level: "beginner" | "standard" | "advanced" | "expert";
  completed: boolean;
  reply_received: boolean;
  message_strength_score: number | null;    // 0-100
  session_goal: string | null;
  drill_type: string | null;
  pressure_modifier: "decision_maker_watching" | "aggressive_buyer" | "competitor_mentioned" | "compliance_concern" | null;
  buyer_profile: BuyerProfile;
  buyer_state: BuyerState;
  goal_achieved: boolean;
  ai_ended_session: boolean;
  conversation_outcome: string | null;
  session_debrief: {
    what_worked: string;
    what_didnt: string;
    improvement: string;
    coachable_moment: string;
  } | null;
  skill_scores: {
    hook: number; clarity: number; value_prop: number;
    personalization: number; cta: number; tone: number;
    discovery?: number; objection_handling?: number; brevity?: number;
  } | null;
  coaching_annotations: Record<string, any> | null;  // populated at t+5s
  playbook: Record<string, any> | null;              // populated at t+2h
  retry_of_session_id: string | null;
  rating: number | null;                             // 1-5 user rating
  completed_at: string | null;
  created_at: string;
}
```

### PipelineMetrics
```typescript
interface PipelineMetrics {
  total_revenue: number;
  pipeline_value: number;
  win_rate_pct: number;
  contacted_count: number;
  replied_count: number;
  call_demo_count: number;
  closed_won_count: number;
  closed_lost_count: number;
}
```

### Feedback
```typescript
interface Feedback {
  id: string;
  workspace_id: string;
  user_id: string;
  opportunity_id: string;
  outcome: "positive" | "negative" | "pending";
  outcome_note: string | null;       // max 500 chars
  is_final: boolean;
  deal_value_usd: number | null;
  scheduled_call: boolean;
  scheduled_call_date: string | null;
  scheduled_call_notes: string | null;
  created_at: string;
}
```

### UserGoal & GoalNote
```typescript
interface UserGoal {
  id: string;
  workspace_id: string;
  user_id: string;
  goal_text: string;
  goal_type: string;
  target_value: number | null;
  current_value: number | null;
  target_unit: string | null;
  target_date: string | null;        // YYYY-MM-DD
  status: "active" | "completed" | "paused";
  completed_at: string | null;
  created_at: string;
}

interface GoalNote {
  id: string;
  goal_id: string;
  user_id: string;
  note_text: string;
  ai_response: string | null;
  progress_delta: number | null;
  sentiment: "positive" | "neutral" | "negative";
  created_at: string;
}
```

### CalendarEvent
```typescript
interface CalendarEvent {
  id: string;
  workspace_id: string;
  user_id: string;
  title: string;
  event_date: string;               // YYYY-MM-DD
  start_time: string | null;        // ISO8601
  end_time: string | null;          // ISO8601
  event_type: "meeting" | "call" | "demo" | "followup" | "other";
  notes: string | null;
  attendee_name: string | null;
  attendee_context: string | null;  // max 2000 chars
  opportunity_id: string | null;
  prospect_id: string | null;
  outcome: "hot" | "positive" | "neutral" | "cold" | "dead" | null;
  energy_score: number | null;      // 1-5
  prep_content: object | null;
  prep_generated: boolean;
  prep_generated_at: string | null;
  debrief_content: object | null;
  debrief_completed_at: string | null;
  meeting_notes: string | null;
  perplexity_research: object | null;
  debrief_needed: boolean;          // computed: past event + no debrief
  created_at: string;
}
```

### ConversationCommitment & ConversationSignal
```typescript
interface ConversationCommitment {
  id: string;
  workspace_id: string;
  user_id: string;
  prospect_id: string | null;
  event_id: string | null;
  commitment_text: string;
  owner: "founder" | "prospect";
  status: "pending" | "done" | "overdue" | "ignored";
  due_date: string | null;           // YYYY-MM-DD
  implicit_timing: string | null;
  completed_at: string | null;
  follow_up_message: string | null;
  created_at: string;
}

interface ConversationSignal {
  id: string;
  workspace_id: string;
  user_id: string;
  prospect_id: string | null;
  event_id: string | null;
  signal_type: "buying" | "risk" | "timing" | "engagement";
  signal_text: string;
  confidence: number | null;
  is_active: boolean;
  detected_at: string;
}
```

### Prospect
```typescript
interface Prospect {
  id: string;
  workspace_id: string;
  user_id: string;
  name: string;                      // max 200 chars
  company: string | null;
  title: string | null;
  email: string | null;
  linkedin_url: string | null;
  platform: string | null;
  notes: string | null;              // max 2000 chars
  stage: "prospect" | "engaged" | "negotiating" | "closed_won" | "closed_lost" | "dormant";
  relationship_health_score: number | null;  // 0-100
  health_updated_at: string | null;
  first_contact_at: string | null;
  last_contact_at: string | null;
  ai_summary: string | null;
  ai_summary_updated_at: string | null;
  created_at: string;
}
```

### GrowthCard
```typescript
interface GrowthCard {
  id: string;
  workspace_id: string;
  user_id: string;
  card_type: "tip" | "strategy" | "resource" | "reflection" | "challenge" | "community" | "insight";
  title: string;
  body: string;
  action_label: string | null;
  action_type: string | null;        // "internal_chat" → open new chat
  priority: number;
  metadata: Record<string, any> | null;
  is_read: boolean;
  is_dismissed: boolean;
  expires_at: string | null;
  generated_by: string | null;       // "ai_daily" | "ai_checkin" | "ai_weekly" etc.
  created_at: string;
}
```

### DailyCheckIn
```typescript
interface DailyCheckIn {
  id: string;
  user_id: string;
  workspace_id: string;
  date: string;                      // YYYY-MM-DD
  questions: Array<{ id: string; question: string }>;
  answers: Record<string, string> | null;
  mood_score: number | null;         // 1-10
  ai_response: string | null;        // populated after submit
  processed_at: string | null;
  created_at: string;
}
```

### CommunicationPattern & SkillProgression
```typescript
interface CommunicationPattern {
  id: string;
  workspace_id: string;
  user_id: string;
  pattern_label: string;
  pattern_type: "ghost_trigger" | "success_signal" | "weakness" | "objection_type";
  pattern_detail: string | null;
  confidence_score: number;
  affected_outcome: string | null;
  sample_count: number;
  is_active: boolean;
  first_detected_at: string;
  last_detected_at: string;
}

interface SkillProgression {
  week_start: string;                // YYYY-MM-DD
  composite_score_avg: number | null;
  composite_delta: number | null;    // change vs. prior week
  top_weakness: string | null;
  top_strength: string | null;
  hook_avg: number | null;
  clarity_avg: number | null;
  value_prop_avg: number | null;
  personalization_avg: number | null;
  cta_avg: number | null;
  tone_avg: number | null;
  messages_analyzed: number;
  positive_outcome_rate: number | null;
}
```

### MetricsDashboard (full response shape)
```typescript
interface MetricsDashboard {
  dashboard: {
    outreach_streak: number;
    sent_count_30d: number;
    positive_rate: number;           // 0.0 to 1.0
    momentum_score: number;          // 0-100
    momentum_breakdown: {
      activity: number;              // max 30
      conversion: number;            // max 30
      pipeline: number;              // max 20
      goals: number;                 // max 15
      practice_bonus: number;        // max 5
    };
    momentum_insight: string;        // AI-generated text
    average_mood: number | null;     // 1-10
  };
  pipeline: PipelineMetrics;
  chart_data: Array<{
    date: string;                    // YYYY-MM-DD
    sent: number;
    discovered: number;
    positive: number;
    positive_rate: number;           // 0-100 percentage
  }>;
  goals: UserGoal[];
  practice: {
    sessions_30d: number;
    sessions_7d: number;
  };
  workspace_id: string;
}
```

### FileUpload
```typescript
interface FileUpload {
  id: string;
  url: string;                       // Supabase Storage public URL
  filename: string;
  type: string;                      // MIME type e.g. "image/png"
  size_bytes: number;
  chat_id: string | null;
  created_at: string;
}
```

### WorkspaceActivityEvent
```typescript
interface WorkspaceActivityEvent {
  id: string;
  event_type: "practice_completed" | "deal_closed" | "opportunity_created" |
              "goal_reached" | "member_joined" | "opportunity_assigned" | "nudge_sent";
  metadata: Record<string, any>;
  created_at: string;
  users: {
    id: string;
    name: string | null;
    email: string;
  } | null;
}
```

---

## 7. System Behavior — Background & Async

### BullMQ Queue Overview
Three queues run at all times:

**`scheduledQueue`** (1 concurrent worker) — cron jobs
**`practiceQueue`** (10 concurrent workers) — practice simulation events
**`backgroundQueue`** (5 concurrent workers) — triggered background tasks

### Scheduled Cron Jobs
| Job Name | Schedule | What It Does |
|---|---|---|
| `memory_extraction` | Every 30 min | Extracts memory facts from recent chats |
| `opportunity_fetch` | Every 6 hours | Auto-discovers opportunities for all active users |
| `feedback_prompts` | Every 1 hour | Prompts users with sent messages >48h ago to log feedback |
| `performance_summary` | Daily 2am | Aggregates performance stats |
| `metrics_aggregation` | Daily 3am | Updates `daily_metrics` and `pipeline_metrics` tables |
| `daily_tip_generation` | Daily 7am | Generates 3 growth tip cards per active user |
| `calendar_prep` | Daily 8am | Generates prep docs for tomorrow's meetings |
| `morning_growth_push` | Daily 9am | Push: morning growth tip or reminder |
| `goal_nudge` | Daily 9:05am | Push: nudge users with stalled goals |
| `follow_up_check` | Daily 10am | Generates follow-up messages for stalled pipeline deals |
| `check_in_scheduler` | Daily 2pm | Push: daily check-in reminder |
| `evening_growth_push` | Daily 6pm | Push: evening motivational action |
| `weekly_plan` | Sunday 6pm | Generates weekly strategy cards for all users |
| `email_digest` | Sunday 6pm | Sends weekly email digest (if `email_digest_enabled`) |
| `pattern_detection` | Sunday 8pm | Detects communication patterns from analyses |
| `skill_progression` | Sunday 9pm | Computes weekly skill snapshots |
| `skill_profile_agg` | Sunday 10pm | Aggregates skill profiles for reporting |
| `adaptive_curriculum` | Sunday 11pm | Updates practice curriculum from weakness data |

### Practice Queue Jobs
| Job Type | Delay | What It Does |
|---|---|---|
| `PRACTICE_DELIVERED` | 500ms | Updates message `delivery_status: "delivered"` |
| `PRACTICE_SEEN` | 1500ms | Updates message `delivery_status: "seen"` |
| `PRACTICE_SKILL_SCORES` | 2 seconds post-complete | Scores session messages on 6 dimensions |
| `PRACTICE_COACHING_ANNOTATIONS` | 5 seconds post-complete | Adds per-message coaching notes |
| `PRACTICE_PLAYBOOK` | 2 hours post-complete | Generates full session playbook |
| `CONVERSATION_ANALYSIS` | After feedback | Scores real outreach message quality |

### Background Queue Jobs
| Job Type | Trigger | What It Does |
|---|---|---|
| `SEED_MEMORY` | Post-onboarding, rebuild | Extracts initial memory from onboarding answers |
| `ARCHETYPE_DETECT` | Post-onboarding | Classifies user as seller/builder/freelancer/etc. |
| `OPPORTUNITIES_REFRESH` | Post-onboarding | Initial opportunity discovery |
| `CHECKIN_TIP_GENERATE` | After check-in | Generates personalized tip from check-in answers |
| `FIRST_TIME_CARDS_GENERATE` | First growth feed visit | Generates 3 starter growth cards |
| `TIP_CARD_GENERATE` | Goal note (if applicable) | Generates targeted tip card from goal progress |
| `CALENDAR_PREP_GENERATE` | After event creation | Groq enriched prep doc (3 retries, exponential backoff) |
| `CALENDAR_RESEARCH_PROSPECT` | After event creation | Perplexity prospect research (3 retries) |

### AI Memory Extraction (every 30 minutes)
1. Scans recent chat messages and conversation analyses
2. Uses Groq to extract persistent facts about the user
3. Facts have `fact_category` and `reinforcement_count`
4. Already-known facts get `reinforcement_count++` instead of being duplicated
5. Top 5 active facts injected into every subsequent chat system prompt
6. User can disable with `memory_enabled: false`

---

## 8. Error Handling & Failure Flows

### Standard Error Response Shape
```json
{
  "error": "MACHINE_READABLE_CODE",
  "message": "Human readable description"
}
```

### HTTP Status Code Reference
| Status | Meaning | When |
|---|---|---|
| `200` | Success | Standard success |
| `201` | Created | Resource created (register, create workspace, create practice session retry) |
| `400` | Validation Error | Invalid input, onboarding incomplete, session ended |
| `401` | Unauthorized | Missing/expired JWT |
| `403` | Forbidden | Insufficient role, workspace mismatch |
| `404` | Not Found | Resource doesn't exist or belongs to different workspace |
| `409` | Conflict | Duplicate (already member, already submitted check-in, session completed) |
| `410` | Gone | Expired invite token |
| `429` | Rate Limited | Too many requests |
| `500` | Server Error | Unexpected backend failure |

### Key Error Codes
| Code | HTTP | When to Show |
|---|---|---|
| `UNAUTHORIZED` | 401 | "Session expired. Please log in again." |
| `ACCOUNT_DELETED` | 403 | "This account has been deleted." |
| `ACCOUNT_NOT_FOUND` | 404 | Redirect to login |
| `PROFILE_NOT_FOUND` | 404 | Redirect to login |
| `PERMISSION_DENIED` | 403 | "You don't have permission to do this." |
| `EMAIL_TAKEN` | 409 | "An account with this email already exists." |
| `INVALID_CREDENTIALS` | 401 | "Incorrect email or password." |
| `REFRESH_FAILED` | 401 | Redirect to login |
| `VALIDATION_ERROR` | 400 | Show field-level errors |
| `ONBOARDING_REQUIRED` | 400 | Redirect to /onboarding |
| `VOICE_PROFILE_MISSING` | 400 | "Complete onboarding to use this feature." |
| `QUOTA_EXCEEDED` | 429 | "Daily discovery limit reached. Resets at midnight." |
| `RATE_LIMIT_EXCEEDED` | 429 | "Too many requests. Please slow down." |
| `NO_ACTIVE_WORKSPACE` | 400 | "Please select a workspace first." |
| `OWNER_CANNOT_LEAVE` | 403 | "Transfer ownership before leaving." |
| `INVALID_OR_EXPIRED_TOKEN` | 410 | "This invite has expired." |
| `ALREADY_A_MEMBER` | 409 | "You're already in this workspace." |
| `SESSION_ENDED` | 400 | "This practice session has already ended." |
| `SESSION_ALREADY_COMPLETED` | 409 | "Cannot delete a completed session." |
| `NOT_FOUND` | 404 | Generic not found |

### Validation Errors (400 VALIDATION_ERROR)
```json
{
  "error": "VALIDATION_ERROR",
  "message": "password must be at least 8 characters",
  "details": {
    "password": ["String must contain at least 8 character(s)"]
  }
}
```
Show errors inline next to the relevant form field.

### Streaming Error Handling (SSE)
```javascript
// When stream: true is used
const eventSource = new EventSource(url);
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === "chunk") {
    appendToMessage(data.content);
  } else if (data.type === "done") {
    finalizeMessage(data.message_id);
  } else if (data.type === "error") {
    showErrorToast(data.message);
  }
};
```

### Token Refresh Pattern
```javascript
async function apiCall(endpoint, options) {
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${getAccessToken()}` },
    ...options
  });
  if (response.status === 401) {
    const refreshed = await fetch("/api/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: getRefreshToken() })
    });
    if (refreshed.ok) {
      const { access_token, refresh_token } = await refreshed.json();
      saveTokens(access_token, refresh_token);
      return fetch(endpoint, {
        headers: { Authorization: `Bearer ${access_token}` },
        ...options
      });
    } else {
      redirectToLogin();
    }
  }
  return response;
}
```

---

## 9. Rate Limits Reference

| Endpoint Group | Window | Max Requests | Action on Exceed |
|---|---|---|---|
| Auth endpoints | 15 min | 10 | 429, locked |
| AI endpoints (chat, opportunities, goals, growth, calendar, practice) | 60 seconds | 30 | 429 |
| Calendar AI sub-endpoints (prep, debrief, research) | 5 min | 10 | 429 |
| Pipeline endpoints | 60 seconds | 120 | 429 |
| Opportunity refresh (manual) | 60 min | 5 | 429 |
| Archetype re-detection | 7 days | 1 | Returns cached result |
| Perplexity (opportunity discovery) | 24 hours | free: 5 / pro: 50 / enterprise: 200 | 429 QUOTA_EXCEEDED |

**Frontend guidance:**
- Show a cooldown timer after hitting opportunity refresh rate limit
- Disable "Discover" button until cooldown clears
- Cache `GET /api/opportunities` client-side for 60 seconds to avoid hammering list endpoint

---

## 10. Product Logic & Business Rules

### Momentum Score Formula (0–100)
```
activity_score    = min(15, outreach_streak × 3) + min(15, sent_count_30d ÷ 2)  → max 30
conversion_score  = min(30, positive_rate × 100)                                  → max 30
pipeline_score    = 20 (has demo) | 13 (has replied) | 6 (has contacted) | 0      → max 20
goals_score       = min(15, avg_goal_completion_pct ÷ 7)                          → max 15
practice_bonus    = min(5, sessions_this_week)                                    → max 5
```

### Relationship Health Score Formula (0–100)
```
Base = 50
Time since last contact:
  < 3 days:  +20
  3-7 days:  +10
  14-29 days: -15
  30+ days:  -30

Meeting outcome:
  hot:      +20
  positive: +10
  neutral:  +0
  cold:     -10
  dead:     -30

Signals (last 14 days):
  Each buying signal:  +8
  Each risk signal:    -10

Overdue founder commitments: -12 each

Result clamped to 0–100
```

### Practice Difficulty Auto-Selection
```
< 5 completed sessions → beginner
5–14 completed sessions → standard
15–29 sessions OR reply_rate < 30% → advanced
30+ sessions AND reply_rate ≥ 30% → expert
```

### Practice Scenario Weighted Random (when no scenario specified)
```
interested:     25%
polite_decline: 25%
ghost:          20%
skeptical:      15%
price_objection: 10%
not_right_time:  5%
```

### Pressure Modifier Effects on Buyer Initial State
```
decision_maker_watching: interest +15, trust +10
aggressive_buyer:        interest -10, trust -10
competitor_mentioned:    trust -5, confusion +10
compliance_concern:      interest -5, trust -5, confusion +15
```

### Follow-Up Thresholds (when auto follow-up is generated)
```
contacted stage: 4+ days since last_stage_changed_at → generate follow-up
replied stage:   6+ days since last_stage_changed_at
call_demo stage: 3+ days since last_stage_changed_at
```

### Key Business Invariants
1. **Workspace isolation is absolute.** Every query filters by `workspace_id`. Cross-workspace data access is a security failure.
2. **Onboarding gate.** `voice_profile` must exist before: opportunity refresh, sample message, and certain AI features.
3. **Completed practice sessions are immutable.** Cannot be deleted — they feed skill tracking.
4. **Check-in is once per day.** Duplicate submission returns 409.
5. **Opportunity dedup.** Based on `(workspace_id, user_id, source_url)`.
6. **Feedback drives analytics.** `is_final: true` + non-pending outcome = `CONVERSATION_ANALYSIS` queued.
7. **Pattern detection minimum.** Requires ≥5 conversation analyses before patterns appear.
8. **Memory injection.** Disabled per-user if `memory_enabled: false`.
9. **Tier Perplexity limits.** Free: 5/day, Pro: 50/day, Enterprise: 200/day.
10. **Workspace owner cannot leave** without transferring ownership first.

---

## 11. Real-Time & Streaming Behavior

### Supabase Realtime — Practice Sessions
After `POST /api/practice/start`, subscribe to:
```javascript
const channel = supabase
  .channel(`chat:${chat_id}`)
  .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_messages" },
    (payload) => {
      // payload.new.delivery_status: "delivered" at t+500ms
      // payload.new.delivery_status: "seen" at t+1500ms
    }
  )
  .subscribe();
```
Unsubscribe when session completes or component unmounts.

### Supabase Realtime — Calendar Prep
After `POST /api/calendar`, subscribe to `user_events` table for the event row:
```javascript
const channel = supabase
  .channel(`event:${event_id}`)
  .on("postgres_changes", { event: "UPDATE", schema: "public", table: "user_events",
    filter: `id=eq.${event_id}` },
    (payload) => {
      if (payload.new.prep_generated) {
        // Prep is ready — refresh event detail
        fetchEventDetail(event_id);
      }
    }
  )
  .subscribe();
```

### Chat Streaming (SSE)
Always set `stream: true` on chat messages. The server opens an SSE connection:
- Content-Type: `text/event-stream`
- Each event: `data: { "type": "chunk", "content": "..." }`
- Final event: `data: { "type": "done", "message_id": "uuid" }`
- Error: `data: { "type": "error", "message": "..." }`

---

## 12. Notification System

### Push Notifications (FCM)
Register token on every app launch:
```
PUT /api/user/fcm-token
{ "fcm_token": "device_fcm_token" }
```

**All notification types and their toggles:**
| Notification | Preference Key | When Sent |
|---|---|---|
| New opportunity assigned | `new_opportunities` | Manager assigns to you |
| Feedback reminder | `feedback_reminders` | 48h after marking sent, no feedback |
| Practice reply | `practice_replies` | Buyer responds in practice |
| Calendar prep ready | `calendar_prep_ready` | Prep doc generated |
| Daily tip | `daily_tip` | Daily 7am tip generation |
| Check-in reminder | `check_in_prompt` | Daily 2pm |
| Debrief reminder | `debrief_reminder` | Meeting passed with no debrief |
| Commitment reminder | `commitment_reminder` | Commitment due soon / overdue |
| Weekly insights | `weekly_insights` | Sunday pattern/skill insights |
| Weekly plan | `weekly_plan` | Sunday 6pm |
| Pattern insights | `pattern_insights` | Sunday 8pm pattern detection |
| Skill progression | `skill_progression` | Sunday 9pm skill update |
| Morning growth push | `morning_growth_push` | Daily 9am |
| Evening growth push | `evening_growth_push` | Daily 6pm |

### In-App Notifications
```
GET /api/user/notifications?limit=30&offset=0
```
Returns: `{ notifications: UserNotification[], unread_count: number }`

```typescript
interface UserNotification {
  id: string;
  title: string;
  body: string;
  data: Record<string, any> | null;  // deep link data
  is_read: boolean;
  created_at: string;
}
```

Show a badge on the notification bell using `unread_count`. Mark all read with:
```
POST /api/user/notifications/read-all
```

---

## 13. Frontend Routing Map

### Unauthenticated Routes
```
/                    → Redirect to /login or /home
/login               → Login form
/register            → Registration form
/auth/callback       → OAuth callback handler (call POST /api/auth/profile/ensure)
/invite/:token       → Accept invite page (must auth first)
```

### Onboarding Routes (onboarding_completed = false)
```
/onboarding/basic    → Step 0: basic info form
/onboarding/q/1      → Step 1: burst 1 questions
/onboarding/q/2      → Step 2: burst 2 questions
/onboarding/q/3      → Step 3: burst 3 questions (final)
/onboarding/preview  → Step 4: sample message preview
```

### Main App Routes (authenticated + onboarding_completed = true)
```
/home                → Dashboard (metrics/dashboard + growth feed)
/opportunities       → Opportunity list
/opportunities/:id   → Opportunity detail + chat + intel
/pipeline            → Kanban board
/pipeline/:id        → Deal detail
/practice            → Practice dashboard + history
/practice/new        → Start new session (config screen)
/practice/:sessionId → Active session
/practice/:sessionId/outcome   → Session results
/practice/:sessionId/replay    → Session replay
/chat                → Chat list
/chat/:chatId        → Chat conversation
/calendar            → Calendar view
/calendar/:id        → Event detail + prep
/prospects           → CRM list
/prospects/:id       → Prospect detail
/goals               → Goal list
/goals/:id           → Goal detail with notes
/followup            → Follow-up queue
/commitments         → Commitment tracker
/insights            → Insights dashboard
/growth              → Growth feed + check-in
/metrics             → Full metrics dashboard
/settings            → User/workspace settings
/settings/members    → Team management (admin+)
/settings/voice      → Voice profile editor
/settings/memory     → Memory facts
/settings/notifications → Notification preferences
/workspaces          → Workspace list + switcher
```

### Manager-Only Routes
```
/team/pipeline       → Team pipeline board
/team/opportunities  → All team opportunities
/team/insights       → Team skill matrix + why-losing
/team/analytics      → Team analytics overview
/team/leaderboard    → Performance leaderboard
/team/coaching       → Coaching queue
/team/activity       → Activity feed
```

---

## 14. Gaps, Inconsistencies & Known Issues

> Sourced from both code analysis and the YAML `x-analysis` extension.

### 🔴 Critical Gaps

**1. `/api/coach/*` routes entirely unknown**
The app mounts `coachRoutes` at `/api/coach` with full auth middleware, but the `coach.js` route file was not analyzed. Its full endpoint set is unknown.
**Action for frontend agent:** Treat `/api/coach/*` as an unknown route group. If you encounter references to coaching features not covered by `/api/chat`, check this route.

**2. No email verification status check endpoint**
After `POST /api/auth/register`, `needsVerification: true` is returned but there is no `GET /api/auth/verify-status` to poll. Frontend cannot programmatically detect when email is verified.
**Workaround:** Show a "I've verified my email" button that attempts login; if it succeeds, verification is confirmed.

### 🟡 Inconsistencies

**3. Duplicate workspace switch endpoints**
Both `POST /api/workspaces/switch` and `POST /api/user/switch-workspace` perform the same operation. Use `POST /api/workspaces/switch` as canonical.

**4. Duplicate workspace list endpoints**
Both `GET /api/workspaces` and `GET /api/user/workspaces` return the workspace list. Use `GET /api/workspaces` as canonical.

**5. `recordTokenUsage` inconsistency in goals.js**
Token usage is attributed to `userId` (not `workspaceId`) in the goals route, unlike other routes. This is a backend inconsistency with no frontend impact.

**6. No total count on `GET /api/feedback/history`**
The `PaginationMeta` schema defines `total` as nullable. For this endpoint, assume `total` may be null and implement "load more" style pagination instead of page-number pagination.

**7. Opportunity refresh returns IDs only, not full objects**
`POST /api/opportunities/refresh` returns `{ opportunities: [{ id }], count }` — just IDs. After refresh, call `GET /api/opportunities` to load the actual opportunity data.

### 🟢 YAML-Confirmed Details (Previously Unknown)

**8. Practice `complete` endpoint is explicit**
`POST /api/practice/:sessionId/complete` is a real, dedicated endpoint that accepts an optional `rating: 1-5`. Session completion does NOT happen automatically — the frontend must call this when the AI ends the session (`session_ended: true` in message response) OR when the user taps "End Session."

**9. Coaching queue is a real endpoint**
`GET /api/metrics/workspace/coaching-queue` returns members with performance flags. Flags: `no_outreach_7d | no_practice_7d | score_declining | low_skill_score`.

**10. Invite management endpoints fully exist**
`GET /api/workspaces/:id/invites` and `DELETE /api/workspaces/:id/invites/:inviteId` are confirmed real endpoints in the YAML spec. Previously listed as gaps.

**11. `GET /api/practice/skill-dashboard` is a distinct endpoint**
Returns 4 weeks of skill history + 10 recent sessions + badges. Different from `GET /api/practice/sessions`.

---

## 15. UX Improvement Opportunities

### Onboarding
1. **Progress indicator** — Show a persistent step counter (1 of 4) during onboarding. Use `onboarding_step` from `GET /api/onboarding/status` to resume mid-flow after app close.
2. **Final burst signal** — When `POST /api/onboarding/answers` returns a `voice_profile` object, show a celebration/completion animation before the sample message screen.
3. **Voice profile preview** — On the sample message screen, show key voice profile fields (voice_style, avoid_phrases) so the user understands what was built.

### Opportunities
4. **Staleness CTA** — When `should_refresh: true`, show a prominent banner: "Your opportunity list is getting stale. Discover new prospects →"
5. **Score visualizer** — Show three individual score bars (Fit, Timing, Intent) on opportunity cards instead of just composite score. This communicates *why* an opportunity is strong.
6. **Intel loading state** — Intel is expensive and slow. Show a skeleton + "Analyzing prospect..." while `GET /api/opportunities/:id/intel` is in-flight.

### Practice
7. **Buyer state meters** — Show live animated bars for interest_score, trust_score, confusion_score during active sessions. Update on each `buyer_state` response.
8. **Ghost coaching feedback** — When `ghosted: true` in the message response, immediately show an inline coaching tip about why the message didn't break the silence.
9. **Deferred debrief banner** — After session completion, show "Your coaching report will be ready in a moment" and auto-refresh `GET /api/practice/:sessionId/outcome` at t+5s and t+10s.
10. **Replay as a teaching tool** — On the replay screen, show the `internal_monologue` as a thought bubble beside each buyer message to give users deep insight into the AI's reasoning.

### Pipeline
11. **Calendar prompt UX** — When moving to `call_demo` returns `calendar_prompt`, show an inline "Schedule a meeting?" card with a pre-filled calendar form. Pre-fill the `attendee_name` from the opportunity.
12. **Deal value input** — Always show a deal value field on pipeline cards. Accumulated deal values power the revenue metrics.

### Growth
13. **Streak prominance** — Show `check_in_streak` as a flame counter on the Growth tab. Show "Streak at risk 🔥" if it's past 6pm and no check-in submitted.
14. **Card action routing** — When a card has `action_type: "internal_chat"`, tapping the CTA should open a new chat with the card's `body` as the pre-seeded first message.

### Calendar
15. **Async prep state** — After creating an event, show "🔍 Researching [attendee_name]..." and "📝 Generating prep..." skeleton states. Subscribe to Supabase Realtime on the event row and fill in prep when `prep_generated` becomes true.
16. **Post-debrief commitment confirmation** — After submitting a debrief, immediately show the extracted commitments in a "Review & Confirm" modal before they're saved.

### Notifications
17. **Badge on calendar icon** — Use `GET /api/calendar/alerts` response (`debriefs_needed` + `overdue_commitments`) to show red badge counts on the calendar nav icon.
18. **Feedback pending count** — Show a badge on the pipeline nav icon for `GET /api/feedback/pending` count.

---

## 16. Constants & Enums Reference

### User & Workspace
```
Tiers:             free | pro | enterprise
Workspace roles:   owner | admin | manager | member
Member statuses:   active | pending_invite | suspended | removed
User roles:        founder | sales | freelancer | marketer | developer | other
Industries:        saas | ecommerce | services | fintech | health | education | other
Archetypes:        seller | builder | freelancer | creator | professional | learner
```

### Opportunities & Pipeline
```
Opportunity status:   pending → viewed → sent → done
                      pending → viewed → acted (skipped)
Pipeline stages:      new → contacted → replied → call_demo → closed_won
                                                            → closed_lost
Platforms:            reddit | linkedin | twitter | facebook | instagram |
                      producthunt | indiehackers | hackernews | quora | youtube | other
```

### Practice
```
Scenario types:     interested | polite_decline | ghost | skeptical | price_objection | not_right_time
Difficulty levels:  beginner | standard | advanced | expert
Pressure modifiers: decision_maker_watching | aggressive_buyer | competitor_mentioned | compliance_concern
Opening moods:      neutral | skeptical | curious | defensive | rushed
Delivery statuses:  pending | delivered | seen | replied | ghosted
```

### Prospects & Relationships
```
Prospect stages:    prospect | engaged | negotiating | closed_won | closed_lost | dormant
Meeting outcomes:   hot | positive | neutral | cold | dead
Signal types:       buying | risk | timing | engagement
Commitment owner:   founder | prospect
Commitment status:  pending | done | overdue | ignored
Calendar event type: meeting | call | demo | followup | other
Energy score:       1-5 integer
```

### Goals & Feedback
```
Goal status:     active | completed | paused
Note sentiment:  positive | neutral | negative
Feedback outcome: positive | negative | pending
```

### Insights & Skills
```
Pattern types:      ghost_trigger | success_signal | weakness | objection_type
Skill dimensions:   hook | clarity | value_prop | personalization | cta | tone
Trend statuses:     improving | declining | mixed_positive | mixed_negative | stable
```

### Growth
```
Card types:     tip | strategy | resource | reflection | challenge | community | insight
Card sources:   ai_daily | ai_checkin | ai_weekly | goal_note_ai | ai_pattern_detection
Action types:   internal_chat (and potentially others)
Mood score:     1–10 integer
Check-in streak: 0+ integer (consecutive days)
```

### Workspace Activity
```
Event types: practice_completed | deal_closed | opportunity_created |
             goal_reached | member_joined | opportunity_assigned | nudge_sent
```

### Metrics Intelligence
```
Insight types: pattern | opportunity | warning
```

### Pagination
```typescript
interface PaginationMeta {
  limit: number;
  offset: number;
  total: number | null;   // null on non-first pages or unsupported endpoints
  has_more: boolean;
}
```

### Error Codes (full list)
```
UNAUTHORIZED | INVALID_TOKEN | ACCOUNT_DELETED | ACCOUNT_NOT_FOUND |
PROFILE_NOT_FOUND | PERMISSION_DENIED | EMAIL_TAKEN | INVALID_CREDENTIALS |
REFRESH_FAILED | VALIDATION_ERROR | ONBOARDING_REQUIRED | VOICE_PROFILE_MISSING |
QUOTA_EXCEEDED | RATE_LIMIT_EXCEEDED | NO_ACTIVE_WORKSPACE | OWNER_CANNOT_LEAVE |
INVALID_OR_EXPIRED_TOKEN | ALREADY_A_MEMBER | SESSION_ENDED |
SESSION_ALREADY_COMPLETED | NOT_FOUND | INTERNAL_ERROR
```

---

*Document version: Kith API v4.2.0 — Fully refined from backend codebase + OpenAPI specification analysis*
*Last updated: Cross-referenced against all 40 uploaded source files + kith-openapi.yaml*
