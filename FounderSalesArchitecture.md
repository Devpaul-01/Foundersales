
FounderSales is evolving from a single-user tool into a collaborative sales operating system designed for teams.

The goal is not just to help individuals find and manage opportunities, but to enable:

- Multi-user collaboration across sales workflows
- Shared visibility into opportunities and conversations
- Team-based performance tracking and insights
- Real-time coordination and task ownership

This document outlines the architectural decisions required to support:
- Multi-tenant scaling
- Team-based data isolation
- High-performance querying at scale
- Future collaboration features (roles, shared pipelines, activity tracking)

The system is being designed intentionally to support:
→ Teams, not individuals  
→ Retention through collaboration  
→ Scalability to thousands of active user_events

# FounderSales: Multi-Tenant Architecture & Critical Fixes
## Complete Route-by-Route Redesign Blueprint + Investor Perspective
**Version 2.0 — Companion to Part 1: System Audit**

---

# PART 2 — COMPLETE MULTI-TENANT ARCHITECTURE: ALL ROUTES

This section redesigns every route in the system for workspaces, roles, and team collaboration. Each subsection covers the specific changes required to that route group.

## Section 2.1 — Foundation: Workspaces, Members, and Identity

*(This section is unchanged from V1 — schemas reproduced for completeness)*

```sql
workspaces
  id               UUID PK
  name             TEXT NOT NULL
  slug             TEXT UNIQUE NOT NULL
  plan             TEXT DEFAULT 'free'      -- free | growth | pro | enterprise
  owner_user_id    UUID FK → users(id)
  settings         JSONB DEFAULT '{}'
  created_at       TIMESTAMPTZ
  updated_at       TIMESTAMPTZ
  is_deleted       BOOLEAN DEFAULT false

workspace_members
  id               UUID PK
  workspace_id     UUID FK → workspaces(id)
  user_id          UUID FK → users(id)
  role             TEXT NOT NULL            -- owner | admin | manager | member | viewer
  custom_role_id   UUID FK → custom_roles(id) NULLABLE
  status           TEXT DEFAULT 'active'    -- active | suspended | pending_invite
  invited_by       UUID FK → users(id) NULLABLE
  joined_at        TIMESTAMPTZ
  permissions      JSONB DEFAULT '{}'
  UNIQUE(workspace_id, user_id)

workspace_profiles
  id                   UUID PK
  workspace_id         UUID FK → workspaces(id)
  user_id              UUID FK → users(id)
  product_description  TEXT
  target_audience      TEXT
  business_name        TEXT
  voice_profile        JSONB
  onboarding_answers   JSONB
  onboarding_completed BOOLEAN DEFAULT false
  archetype            TEXT
  industry             TEXT
  role                 TEXT
  PRIMARY KEY (workspace_id, user_id)
```

The `resolveWorkspace` middleware attaches `req.workspace` and `req.membership` to every authenticated request. The `requirePermission(feature, action)` middleware wraps protected routes.

---

## Section 2.2 — AUTH Routes (`auth.js`)

**Current routes:** `POST /register`, `POST /login`, `POST /logout`, `POST /refresh`, `GET /me`, `POST /profile/ensure`, `GET /google/url`, `POST /resend-verification`

### Multi-Tenant Changes

**Registration flow:** On successful registration, automatically provision a personal workspace for the new user. This is part of the `createUserProfileWithRetry` RPC — extend it to also call a `create_personal_workspace` RPC in the same transaction, ensuring workspace creation and profile creation are atomic. An orphaned auth user now means neither a profile NOR a workspace exists, so rollback is clean.

**Login response:** Include `active_workspace_id` and a summary of `workspace_memberships` in the login response alongside the existing session tokens. This gives the frontend everything it needs to render the workspace switcher immediately without a second round-trip.

**GET /me:** Return the full `workspace_profiles` record for the active workspace alongside the base user record. The profile now lives in `workspace_profiles(workspace_id, user_id)` rather than `users`, so the query becomes a join:

```sql
SELECT u.*, wp.*
FROM users u
LEFT JOIN workspace_profiles wp
  ON wp.user_id = u.id AND wp.workspace_id = u.active_workspace_id
WHERE u.id = auth.uid();
```

**POST /profile/ensure (OAuth):** After creating the base user profile, also create a personal workspace and workspace_profile in the same operation. Apply the same retry mechanism that the registration path uses — this is Issue 10's fix applied to the OAuth path.

**New endpoint — POST /api/user/switch-workspace:**
```
1. Verify membership in target workspace (status = 'active')
2. UPDATE users SET active_workspace_id = workspace_id
3. Issue new access token with updated claims
4. Return { workspace, membership, tokens }
```

**New endpoint — GET /api/user/workspaces:**
Returns all workspaces the user is a member of, with their role and plan in each. Powers the workspace switcher dropdown.

---

## Section 2.3 — OPPORTUNITIES Routes (`opportunities.js`)

**Current routes:** `GET /`, `POST /refresh`, `GET /pending-sent-confirmation`, `GET /:id/message-score`, `PUT /:id/view`, `PUT /:id/copy`, `PUT /:id/sent`, `POST /:id/regenerate`, `POST /:id/chat`, `POST /:id/intel`

### Multi-Tenant Changes

**Schema additions to `opportunities`:**
```sql
workspace_id    UUID FK → workspaces(id) NOT NULL
created_by      UUID FK → users(id)          -- was user_id
assigned_to     UUID FK → users(id) NULLABLE
visibility      TEXT DEFAULT 'private'       -- private | workspace | assigned_only
```

**Every query changes from `.eq('user_id', userId)` to `.eq('workspace_id', req.workspace.id)`** with an additional filter for visibility:
- Members with `view_own` only see `visibility = 'private'` where `created_by = userId` or `assigned_to = userId`
- Members with `view_team` see all workspace opportunities
- Managers see everything

**GET / (opportunity feed):** In team mode, shows a shared feed of workspace opportunities. The `background_refresh_triggered` flag applies workspace-wide — the job checks whether any member's feed is stale, not just the requesting user's.

**POST /refresh:** Requires `opportunities.refresh_feed` permission. In a team workspace, the Perplexity quota is shared at the workspace level (not per-user), preventing 10 reps from each burning their individual quota simultaneously.

**PUT /:id/view, /copy, /sent:** These actions are logged to `workspace_activity` so managers can see team outreach in their activity feed.

**Lead assignment — new endpoints:**
```
POST /api/opportunities/:id/assign     — assign to a workspace member
GET  /api/opportunities/workspace/feed — team view, all workspace opportunities
GET  /api/opportunities/workspace/queue — unassigned opportunities (lead pool)
```

**Permission matrix for opportunities:**

| Action | Member (view_own) | Member (view_team) | Manager | Admin/Owner |
|--------|------------------|-------------------|---------|-------------|
| View own | ✅ | ✅ | ✅ | ✅ |
| View team | ❌ | ✅ | ✅ | ✅ |
| Create | ✅ | ✅ | ✅ | ✅ |
| Assign | ❌ | ❌ | ✅ | ✅ |
| Delete | ❌ | ❌ | ✅ | ✅ |
| Trigger refresh | ✅ | ✅ | ✅ | ✅ |
| Message score | ✅ | ✅ | ✅ | ✅ |

---

## Section 2.4 — PIPELINE Routes (`pipeline.js`)

**Current routes:** `GET /`, `PUT /:id/stage`, `GET /metrics`

### Multi-Tenant Changes

**Schema additions to `opportunities` (pipeline fields):**
```sql
workspace_id    UUID FK → workspaces(id) NOT NULL
assigned_to     UUID FK → users(id) NULLABLE
```

**GET / (Kanban board):** This is the highest-visibility multi-tenant change. The Kanban now supports two modes, controlled by a query parameter:

- `?view=personal` — filters by `assigned_to = userId` (member's own cards)
- `?view=team` — returns all workspace pipeline cards (requires `pipeline.view_team` permission)

Response includes `assigned_to` user info (name, avatar) on each card so the frontend can show ownership badges.

**Column value totals** (currently implemented as per-user) become workspace-scoped in team view. The response adds a `workspace_totals` object alongside the existing `metrics` field.

**PUT /:id/stage:** Stage moves are written to `workspace_activity` so the manager feed shows "Alex moved [Prospect] from Replied → Call/Demo." A notification fires to the opportunity's `created_by` user if the mover is a different team member: "Jordan moved your lead to Closed Won."

**GET /metrics:** In team mode, returns workspace-level pipeline metrics. Individual member breakdown available to managers via the team analytics endpoint.

**New endpoints:**
```
GET  /api/pipeline/workspace/overview  — workspace pipeline health (manager only)
GET  /api/pipeline/workspace/by-member — pipeline cards grouped by assigned_to member
```

---

## Section 2.5 — CALENDAR Routes (`calendar.js`)

**Current routes:** `GET /`, `GET /alerts`, `POST /`, `GET /:id`, `PUT /:id`, `DELETE /:id`, `POST /:id/regenerate-prep`, `POST /:id/research`, `POST /:id/debrief`, `POST /:id/start-meeting-notes`

The calendar system is one of the richest routes in the product. It connects prospects, commitments, signals, and AI prep — all of which become workspace-aware in a team context.

### Multi-Tenant Changes

**Schema additions to `user_events`:**
```sql
workspace_id          UUID FK → workspaces(id) NOT NULL
meeting_owner         UUID FK → users(id)           -- who scheduled it
internal_attendees    UUID[]                         -- workspace member IDs attending
is_team_visible       BOOLEAN DEFAULT false          -- manager can see this event
debrief_shared_with   UUID[]                         -- specific members who can see debrief
shared_prep           BOOLEAN DEFAULT false          -- multiple members can contribute prep notes
```

**GET / (event list):** Members see their own events plus any events where `userId = ANY(internal_attendees)`. Managers see all workspace events where `is_team_visible = true`. The `debrief_needed` flag is preserved per-user.

**GET /alerts:** In team context, managers see two additional alert categories: "Team members with overdue debriefs" and "Team commitments overdue across the workspace." Members see only their own alerts.

**POST / (create event):** When `internal_attendees` is provided, the event appears in each attendee's calendar view. The `meeting_owner` defaults to `req.user.id`. Only the `meeting_owner` and managers can edit or delete. Attendees can view and contribute to shared prep notes if `shared_prep = true`.

**GET /:id:** Returns full event with intelligence data. Attendees who are workspace members see the event. Debrief content is visible based on `debrief_shared_with` — if empty, only `meeting_owner` and managers see it.

**POST /:id/debrief:** Only the `meeting_owner` can submit the debrief. The debrief is immediately written to `workspace_activity`, allowing the manager to see the outcome: "Alex debriefed 'Meeting with Acme Corp' — outcome: Hot." If `is_team_visible = true`, the debrief summary (not raw notes) is visible to managers.

**POST /:id/start-meeting-notes:** Creates a meeting notes chat. If `internal_attendees` contains workspace members, they can optionally be given access to the same chat session (collaborative meeting notes). This is controlled per-event by `shared_prep`.

**Team-specific calendar features:**
- **Manager overview:** `GET /api/calendar/workspace/upcoming` — all team meetings in the next 7 days, grouped by member
- **Debrief digest:** Managers can trigger a workspace debrief digest showing all meetings debriefed this week, outcomes, and follow-up commitments created
- **Shared prep contribution:** When `shared_prep = true`, any internal attendee can call `POST /:id/regenerate-prep` and the result is visible to all attendees

**Prospect health in team context:** `updateProspectHealth` becomes workspace-scoped — it aggregates signals and commitments across ALL workspace members who have interacted with that prospect, not just the event owner. This means the health score reflects the full relationship, not just one rep's view.

---

## Section 2.6 — PROSPECTS Routes (`prospects.js`)

**Current routes:** `GET /`, `GET /:id`, `POST /`, `PUT /:id`, `POST /:id/refresh-summary`, `POST /:id/recalculate-health`, `DELETE /:id`

The prospects system becomes the workspace CRM layer in a team context — the most important data sharing surface for any sales team.

### Multi-Tenant Changes

**Schema additions to `prospects`:**
```sql
workspace_id          UUID FK → workspaces(id) NOT NULL
created_by            UUID FK → users(id)           -- who first added this contact
relationship_owner    UUID FK → users(id) NULLABLE  -- who "owns" this relationship
account_id            UUID FK → accounts(id) NULLABLE -- company-level grouping
visibility            TEXT DEFAULT 'workspace'       -- private | workspace | assigned_only
```

**New `accounts` table** (company-level CRM):
```sql
accounts
  id               UUID PK
  workspace_id     UUID FK → workspaces(id)
  name             TEXT NOT NULL
  domain           TEXT
  industry         TEXT
  employee_count   INTEGER
  notes            TEXT
  created_by       UUID FK → users(id)
  created_at       TIMESTAMPTZ
```

**GET / (prospect list):** Members with `prospects.view_all` see all workspace prospects. Members without it see only those where `relationship_owner = userId` or `created_by = userId`. Sort options expand to include `by_owner` (group by relationship_owner for manager view).

**GET /:id (prospect detail):** The timeline in the single-prospect view now includes events, chats, signals, and commitments from ALL workspace members who interacted with this prospect — not just the requesting user. This is the core value proposition of the team CRM: full relationship context regardless of who owns it now.

The `refresh-summary` AI prompt receives the full cross-member timeline, generating a richer narrative than any individual rep's siloed view.

**POST / (create):** On creation, the system checks for workspace-level duplicate detection: if a prospect with the same `name` (case-insensitive) or `email` already exists in the workspace, return a `409 CONFLICT` with the existing prospect's ID. This prevents two reps from creating duplicate prospect cards for the same contact.

**Ownership transfer — new endpoint:**
```
POST /api/prospects/:id/transfer
Body: { new_owner_id, handoff_note }

1. Verify requesting user is current relationship_owner or manager
2. Update relationship_owner
3. Insert workspace_activity record: "Alex transferred [Prospect] to Jordan"
4. Send notification to new_owner_id
5. Require handoff_note (min 20 chars) to capture context
```

**DELETE:** Soft delete only in workspace context — sets `is_deleted = true` rather than removing the row. Hard delete requires Admin role. Prospect data is workspace institutional knowledge; accidental deletion is a significant risk.

**Permission matrix for prospects:**

| Action | Member (own) | Member (all) | Manager | Admin |
|--------|-------------|-------------|---------|-------|
| View own prospects | ✅ | ✅ | ✅ | ✅ |
| View all prospects | ❌ | ✅ | ✅ | ✅ |
| Create | ✅ | ✅ | ✅ | ✅ |
| Edit own | ✅ | ✅ | ✅ | ✅ |
| Edit team | ❌ | ❌ | ✅ | ✅ |
| Transfer ownership | ❌ | ❌ | ✅ | ✅ |
| Delete | ❌ | ❌ | ✅ | ✅ |
| Refresh AI summary | ✅ | ✅ | ✅ | ✅ |

---

## Section 2.7 — METRICS Routes (`metrics.js`)

**Current routes:** `GET /dashboard`, `GET /communication-snapshot`, `GET /momentum`, `GET /intelligence`, `GET /milestones`, `GET /learning`, `GET /usage`

Metrics is the most complex multi-tenant redesign because it spans two distinct use cases: individual performance (stays personal) and team performance (new, manager-only layer).

### Multi-Tenant Changes

**GET /dashboard:** Personal metrics remain personal — `today.sent`, `streak.outreach`, `practice.sessions_30d` are always scoped to the requesting user. Workspace-level figures are added as a new `workspace` block in the response (only populated for managers):

```json
{
  "today": { "discovered": 3, "sent": 2 },
  "workspace": {
    "team_sent_today": 14,
    "team_sent_this_week": 67,
    "active_members": 8,
    "top_performer": { "user_id": "...", "name": "Jordan", "sent_today": 5 }
  }
}
```

The `workspace` block requires `analytics.view_team` permission and is `null` for members who don't have it — no permission error, just a null that the frontend ignores.

**GET /momentum:** Remains personal (momentum is about individual habit and consistency). No team layer needed here.

**GET /intelligence:** The in-memory cache (Issue 8) is replaced with Redis TTL cache keyed by `workspace_id:user_id`. The AI prompt is enriched with workspace memory facts (from the future `workspace_memory` table) in addition to personal `user_memory` facts. The intelligence insights therefore reflect both personal patterns and institutional workspace knowledge.

**GET /communication-snapshot:** Remains personal — communication quality is individual. However, managers can access any member's snapshot via a new endpoint parameter: `GET /communication-snapshot?member_id=uuid` (requires `analytics.view_team`).

**GET /milestones:** Personal milestones remain personal. A new `workspace_milestones` section is added for team achievements: "First team deal closed," "Team sent 500 messages," "Team hit 25% reply rate." These are calculated from workspace-level aggregations.

**GET /learning (practice):** Personal learning data stays personal. Managers can access member learning data via `GET /learning?member_id=uuid`.

**GET /usage:** Usage is now tracked at the workspace level for plan enforcement. Personal token usage remains visible to the individual. Admins see workspace-total usage.

**New team analytics endpoints (Manager/Admin only):**
```
GET /api/metrics/workspace/leaderboard
  — Members ranked by sent count, reply rate, composite message score (last 30d)
  — Parameters: ?period=7d|30d|all_time, ?sort=sent|reply_rate|score

GET /api/metrics/workspace/rep-comparison?member_a=uuid&member_b=uuid
  — Side-by-side skill radar charts for any two members
  — Returns dimension scores for both users

GET /api/metrics/workspace/team-velocity
  — Week-over-week delta for the full team: sent, replies, pipeline moves
  — Shows which direction team momentum is trending

GET /api/metrics/workspace/coaching-queue
  — Members flagged for manager attention:
      - No practice in 7+ days
      - Reply rate below workspace average by >15%
      - No outreach in 5+ days
      - Skill score declining for 2+ weeks in a row
```

---

## Section 2.8 — INSIGHTS Routes (`insights.js`)

**Current routes:** `GET /summary`, `GET /weekly`, `POST /weekly/dismiss/:id`, `GET /signals/summary`, `GET /commitments/summary`, `GET /why-losing`, `GET /patterns`, `GET /skill-progression`, `GET /autopsies`, `GET /autopsies/:id`, `GET /objections`, `POST /analyze-message`, `GET /velocity`

Insights is where the team's collective intelligence surfaces. It has the richest multi-tenant potential of any route group.

### Multi-Tenant Changes

**GET /summary:** Personal summary (patterns, skill score, reply rate) remains scoped to the individual. A `workspace_snapshot` field is added for managers showing workspace-aggregate communication health.

**GET /weekly (prospect insights):** Weekly insights are generated per-user. In team mode, a new category of insight type is introduced: `workspace_pattern` — insights that are generated from cross-user data. For example: "3 of your team members are struggling with price objections. Consider a team practice session." These workspace-pattern insights are visible to all members (not just managers) because they're coaching-oriented.

**GET /signals/summary:** Signal counts are workspace-scoped for managers. Members see their own signals. The heat map becomes a team heat map for managers showing which prospects have the most recent buying signals across all reps.

**GET /commitments/summary:** In team mode, managers see workspace-level overdue commitment counts. Members see only their own. New field `workspace_overdue_count` is added to the response for managers.

**GET /why-losing:** This is the highest-value team insight. In the current single-user system it analyzes one person's lost deals. In team mode:

- **Personal:** Analyzes the requesting user's conversation analyses (current behavior)
- **Workspace (manager):** Aggregates failure categories across ALL team members' conversation analyses. Returns a ranked list of the top reasons the *workspace* is losing deals. This is the kind of strategic insight a VP of Sales would pay $50K/year for.

The workspace why-losing prompt receives aggregated failure categories across all members' `conversation_analyses`:
```
Team-level failure frequency (last 30 days, 8 members, 142 analyzed messages):
- Hook/opening: 67 occurrences (47%)
- Personalization: 54 occurrences (38%)
- CTA strength: 41 occurrences (29%)
...
```

**GET /patterns:** In team mode, patterns are split into:
- `personal_patterns`: the user's individual communication patterns (current behavior)
- `workspace_patterns`: patterns detected across the full team — common strengths and shared weaknesses

**GET /skill-progression:** Personal only. Managers access member skill data via `/workspace/skill-matrix`.

**GET /autopsies:** Personal only (conversation autopsies are sensitive). Managers can access team autopsies if the member opts in via `is_team_visible` on the conversation analysis record.

**POST /analyze-message (Pitch Diagnostic):** No team-specific changes. This is an individual coaching tool. However, the analysis is now also written to `workspace_activity` for the manager feed if the user is in a workspace: "Alex ran a pitch diagnostic — composite score: 7.2/10."

**GET /objections:** Personal tracker. In team mode, a workspace-level objection frequency report is available to managers: which objections the whole team encounters most often, and who handles them best.

**GET /velocity:** Personal velocity (dimension week-over-week delta). No team layer needed — velocity is an individual progress metric.

**New workspace insights endpoints:**
```
GET /api/insights/workspace/why-losing
  — Aggregated loss pattern analysis across all team members
  — Requires analytics.view_team permission

GET /api/insights/workspace/patterns
  — Communication patterns detected across workspace
  — Requires analytics.view_team permission

GET /api/insights/workspace/skill-matrix
  — Heat map: skill dimensions (hook, clarity, CTA, etc.) per team member
  — Manager sees which rep needs help with which skill
  — Requires analytics.view_team permission

GET /api/insights/workspace/objection-map
  — Which objections arise most, and which team member handles each best
  — Powers coaching assignments

GET /api/insights/workspace/practice-coverage
  — Which practice scenarios have been run, by whom, with what scores
  — Identifies scenario gaps in team training coverage
```

---

## Section 2.9 — GOALS Routes (`goals.js`)

**Current routes (mounted at /api/growth/goals):** `GET /`, `POST /`, `PUT /:goalId`, `DELETE /:goalId`, `POST /:goalId/notes`, `GET /pipeline-insight`

### Multi-Tenant Changes

**Schema additions to `user_goals` (renamed to `goals`):**
```sql
workspace_id    UUID FK → workspaces(id) NOT NULL
scope           TEXT DEFAULT 'personal'     -- personal | assigned | team
assigned_to     UUID FK → users(id) NULLABLE
assigned_by     UUID FK → users(id) NULLABLE
parent_goal_id  UUID FK → goals(id) NULLABLE -- for OKR-style hierarchies
is_public       BOOLEAN DEFAULT false        -- visible to workspace members
```

**GET /:** Returns goals filtered by scope:
- `scope=personal` (default): only the user's own goals
- `scope=assigned`: goals assigned to the user by a manager
- `scope=team`: workspace-level goals visible to all members (requires `goals.view_team_goals`)

**POST /:** Members can create personal goals. Managers can create goals with `scope=team` or `scope=assigned`. Assigned goals include `assigned_to` and `assigned_by` fields. A notification fires to the assignee: "Your manager set a goal for you: [goal text]."

**POST /:goalId/notes (coaching):** The AI coaching context is enriched with workspace-level data for manager-assigned goals: "This goal was set by [manager name] on [date]. Team context: [workspace pipeline state]." The velocity projection block (FEAT-02) becomes more meaningful for assigned goals because the manager can see it in the goal detail view.

**GET /pipeline-insight:** The 24h cache is moved to Redis (fixing Issue 29). For manager-scope requests, the pipeline insight reflects workspace pipeline metrics rather than personal metrics: "Your team advanced 4 deals this week but has 12 contacted leads with no follow-up in 7+ days."

**Goal alignment view (new, manager only):**
```
GET /api/growth/goals/workspace/alignment
  — All active team goals in one view with progress bars
  — Groups by: personal goals, assigned goals by member, team goals
  — Shows who is on track, behind, or stuck
```

---

## Section 2.10 — GROWTH / CARDS Routes (`growth.js`)

**Current routes:** Feed, card read/dismiss, daily check-in, strategy cards, weekly plan

### Multi-Tenant Changes

**Schema additions to `growth_cards`:**
```sql
workspace_id    UUID FK → workspaces(id) NOT NULL
audience        TEXT DEFAULT 'individual'   -- individual | team | workspace_announcement
created_for     UUID FK → users(id)         -- target member (for manager-to-member cards)
created_by      UUID FK → users(id)         -- who generated this card
```

**Feed (GET /):** Personal feed remains personal. However, workspace-level cards with `audience = 'workspace_announcement'` are injected at the top of every member's feed. These are generated by managers: "Team challenge this week: practice the Skeptical Buyer scenario."

**Pattern detection cards** (generated by `patternDetectionJob`): In team mode, a new card type `workspace_pattern` is generated by the workspace-level pattern job. These appear in all members' feeds: "Your team's most common issue is a weak hook in opening messages. Here's how to fix it."

**Daily check-in:** Remains personal. Check-in mood data is aggregated for the manager's team health view (anonymized: "Team average mood this week: 3.8/5").

**Strategy cards and weekly plan:** Personal only. However, managers can push a workspace-wide weekly focus card: "This week the team is focusing on [X]. Here's your contribution target."

---

## Section 2.11 — PRACTICE Routes (`practice.js`)

**Current routes:** `GET /scenarios`, `POST /start`, `POST /:id/message`, `GET /:id`, `GET /history`, `GET /user-skill-profile`, plus the message queue worker

### Multi-Tenant Changes

**Schema additions:**
```sql
practice_sessions (additions):
  workspace_id        UUID FK → workspaces(id)
  is_visible_to_team  BOOLEAN DEFAULT false
  assigned_by         UUID FK → users(id) NULLABLE
  challenge_id        UUID FK → team_challenges(id) NULLABLE

team_challenges
  id               UUID PK
  workspace_id     UUID FK → workspaces(id)
  created_by       UUID FK → users(id)
  scenario_type    TEXT
  buyer_profile    JSONB
  title            TEXT
  description      TEXT
  due_date         TIMESTAMPTZ
  status           TEXT       -- active | completed | archived
  participants     UUID[]
  leaderboard      JSONB      -- { user_id, score, completed_at }[]

workspace_practice_scenarios
  id               UUID PK
  workspace_id     UUID FK → workspaces(id)
  created_by       UUID FK → users(id)
  title            TEXT
  scenario_type    TEXT
  custom_prompt    TEXT
  buyer_profile    JSONB
  difficulty       TEXT
  is_featured      BOOLEAN DEFAULT false
  usage_count      INTEGER DEFAULT 0
```

**GET /scenarios:** Returns the standard built-in scenarios plus any `workspace_practice_scenarios` created by the workspace's managers. Custom scenarios appear with a "Team" badge.

**POST /start:** If a `challenge_id` is provided in the body, the session is linked to that team challenge. On completion, the score auto-submits to the challenge leaderboard.

**GET /user-skill-profile:** Personal only. Managers access member skill data through the workspace analytics endpoints.

**New practice team endpoints:**
```
GET  /api/practice/workspace/leaderboard
  — Weekly and all-time scores across the workspace
  — Parameters: ?period=7d|30d|all_time, ?scenario_type=all|specific

POST /api/practice/workspace/challenge
  — Manager creates a team challenge
  — Body: { scenario_type, buyer_profile, title, due_date, assigned_to[] }
  — Fires notifications to assigned members

GET  /api/practice/workspace/challenge/:id
  — Returns challenge details, participants, leaderboard, and coaching summary

GET  /api/practice/workspace/coverage
  — Which scenarios each member has practiced and their best scores
  — Identifies gaps: "3 members have never practiced Cold Outreach"

POST /api/practice/workspace/scenarios
  — Manager creates a custom workspace scenario
  — Requires practice.manage_scenarios permission
```

---

## Section 2.12 — FEEDBACK Routes (`feedback.js`)

**Current routes:** `POST /`, `GET /pending`, `GET /`, `GET /stats`

### Multi-Tenant Changes

**Schema additions to `feedback`:**
```sql
workspace_id    UUID FK → workspaces(id) NOT NULL
```

**POST /:** Feedback submission remains the individual rep's action. However, when a deal closes (`CLOSED_WON` or `CLOSED_LOST`), a `workspace_activity` record is created so the manager sees it immediately in their feed.

**Deal win announcements:** On `CLOSED_WON` outcome, the system generates a workspace-level growth card with `audience = 'workspace_announcement'`: "🎉 [Rep name] just closed a deal with [prospect]! Here's what worked." This is generated from the `conversation_analysis` of their winning message. The card surfaces in all team members' feeds.

**GET /stats:** Personal stats remain personal. Workspace-level win/loss stats available to managers:
```
GET /api/feedback/workspace/stats
  — Team win rate, average deal value, most common lost reasons
  — Requires analytics.view_team permission
```

**PENDING outcome fix (Issue 19):** In the workspace migration, the feedback job is redesigned to check `feedback.outcome != 'PENDING'` before adding an opportunity to the notification queue. This resolves the re-notification issue regardless of team context.

---

## Section 2.13 — FOLLOWUP Routes (`followup.js`)

**Current routes:** `GET /`, `POST /:id/dismiss`, `POST /:id/sent`

### Multi-Tenant Changes

**Schema:** `opportunities` table already receives `workspace_id`. Follow-up queries inherit the workspace scope.

**GET / (follow-up list):** By default, returns follow-ups for the requesting user's opportunities. In team mode, managers can see all workspace follow-ups via:
```
GET /api/followup?scope=workspace   — all workspace follow-ups (manager only)
GET /api/followup?assigned_to=uuid  — follow-ups for a specific member (manager only)
```

**POST /:id/dismiss and /:id/sent:** These remain the individual rep's actions. Both writes to `workspace_activity` so managers can track whether reps are acting on follow-up suggestions.

**Workspace follow-up health (new):**
```
GET /api/followup/workspace/health
  — How many follow-ups are pending across the team
  — How many have been sitting unacted for 48+ hours
  — Which members are ignoring the most follow-ups (coaching signal)
  — Requires analytics.view_team permission
```

---

## Section 2.14 — COMMITMENTS Routes (`commitments.js`)

**Current routes:** `GET /`, `PUT /:id`, `POST /:id/generate-message`

### Multi-Tenant Changes

**Schema additions to `conversation_commitments`:**
```sql
workspace_id    UUID FK → workspaces(id) NOT NULL
```

**GET /:** Members see their own commitments. Managers see all workspace commitments with an additional `?member_id=uuid` filter. The auto-overdue-marking mutation (Issue 25's fix) is moved to a background job. The GET handler becomes read-only.

**PUT /:id (status update):** Remains the individual rep's action. When a commitment is marked `done`, the `workspace_activity` record notes it: "Alex completed commitment: 'Send case study to [Prospect]'."

**Workspace commitment overview (new, manager only):**
```
GET /api/commitments/workspace/overview
  — All pending/overdue commitments grouped by workspace member
  — Shows total open, overdue, and due-this-week counts per rep
  — Allows manager to see which reps are dropping follow-through balls
  — Requires analytics.view_team permission
```

---

## Section 2.15 — CHAT Routes (`chat.js`)

**Current routes:** `GET /`, `POST /`, `GET /:id`, `POST /:id/messages` (streaming), `PUT /:id/archive`, `GET /:id/context`, plus the streaming helpers

### Multi-Tenant Changes

**Schema additions to `chats`:**
```sql
workspace_id    UUID FK → workspaces(id) NOT NULL
shared_with     UUID[]        -- specific member IDs who can read this chat
is_team_visible BOOLEAN DEFAULT false
```

**GET / (chat list):** By default, members see only their own chats. Chats can be optionally shared:
- When a chat is linked to an opportunity (`opportunity_id`) or event (`event_id`), it can inherit the visibility of that parent entity
- Managers can see chats where `is_team_visible = true`

**POST / (create chat):** Creating a chat linked to a shared opportunity automatically sets `workspace_id`. The chat remains private by default.

**Streaming endpoint `POST /:id/messages`:** No team-specific changes to the streaming logic. However, the system prompt builder is enriched with workspace memory facts (from the future `workspace_memory` table) in addition to personal `user_memory`. This means the AI coach can reference institutional knowledge: "Your team has found that CFOs at mid-market companies respond well to compliance angles."

**Meeting notes chats:** These are linked to events. When `event.is_team_visible = true` and `event.shared_prep = true`, meeting notes chats are visible to all `event.internal_attendees`.

**Disconnect fix (Issue 12):** In the multi-tenant redesign, `updateChatStats` is wrapped in a `clientConnected` check before being called. This applies to both the Groq and Perplexity streaming paths.

---

## Section 2.16 — USER Routes (`user.js`)

**Current routes:** `PUT /fcm-token`, `PUT /debug`, `PUT /api/auth/me` (profile update), `PUT /notification-preferences`, `DELETE /api/auth/account`

### Multi-Tenant Changes

**PUT /api/auth/me (profile update):** Profile fields (`product_description`, `target_audience`, `voice_profile`, `business_name`, etc.) move from `users` to `workspace_profiles`. The update endpoint becomes:

```
PUT /api/user/workspace-profile
  — Updates workspace_profiles for (req.user.id, req.workspace.id)
  — Fields: product_description, target_audience, business_name, voice_profile,
            role, industry, preferred_platforms, etc.
  — Workspace-specific: a user can have different profiles across workspaces
```

The base `users` table retains only truly global fields: `name`, `email`, `global_settings`, `active_workspace_id`, `fcm_token`, `debug_mode`.

**PUT /notification-preferences:** Notification preferences become workspace-scoped (a user may want daily emails in their startup workspace but weekly in their side-project workspace):

```sql
notification_preferences
  user_id         UUID
  workspace_id    UUID
  channel_email   BOOLEAN DEFAULT true
  channel_push    BOOLEAN DEFAULT true
  channel_in_app  BOOLEAN DEFAULT true
  frequency_email TEXT      -- instant | daily_digest | weekly_digest | never
  muted_types     TEXT[]
  quiet_hours_start INTEGER
  quiet_hours_end   INTEGER
  quiet_hours_timezone TEXT
  PRIMARY KEY (user_id, workspace_id)
```

**DELETE /api/auth/account:** Deleting an account soft-deletes the user, transfers workspace ownership to the next admin (if any), and triggers orphan cleanup for any workspaces where this was the only owner. If no other admin exists, the workspace is placed in a 30-day grace period before hard deletion.

**New user endpoints:**
```
GET  /api/user/workspaces          — list all workspaces user belongs to
POST /api/user/switch-workspace    — switch active workspace (see Section 2.2)
POST /api/user/create-workspace    — create a new workspace (any user can do this)
GET  /api/user/pending-invites     — list pending workspace invitations
POST /api/user/accept-invite/:id   — accept a workspace invitation
POST /api/user/decline-invite/:id  — decline a workspace invitation
```

---

## Section 2.17 — ONBOARDING Routes (`onboarding.js`)

**Current routes:** `POST /basic`, `POST /questions/next`, `POST /answers`, `POST /sample-message`, `POST /rebuild-voice-profile`, plus the concurrency guard

### Multi-Tenant Changes

**POST /basic and POST /answers:** All profile data is written to `workspace_profiles(workspace_id, user_id)` instead of `users`. A user invited to a second workspace goes through a lightweight onboarding to set their product context for that workspace — they don't need to repeat the personal questions (name, experience) but do need to answer the product/ICP questions in the context of the new workspace.

**POST /answers — prompt injection fix (Issue 14):** Before the workspace migration, the `answers` object keys must be validated against a server-side allowlist of known question texts from the burst generation step. The fix:
1. Store burst questions in a short-lived server session (Redis TTL: 30 minutes) keyed by `userId:burst_number`
2. On `POST /answers`, validate that every key in `answers` exists in the stored question set for that user
3. Truncate all values to 500 characters
4. HTML-entity-encode special characters before prompt injection

**POST /rebuild-voice-profile:** Rebuilds `workspace_profiles.voice_profile` for the active workspace, not the global user profile.

**Team onboarding context:** When a user joins an existing workspace (not creating a new one), the onboarding is abbreviated:
- Skip burst questions that are workspace-level (product, ICP) — use the workspace's existing `workspace_profiles` shared context as defaults, let the user customize for their role
- Keep personal questions (experience level, voice style preferences)
- New members onboard faster: "Your workspace has pre-configured the product and ICP context. Just tell us about your role and communication style."

---

## Section 2.18 — Migration Strategy (All Routes)

The migration is unchanged from V1 in terms of phasing. The key addition is that every route migration explicitly follows this pattern:

**Phase 0 (Week 1-2):** Add nullable `workspace_id` to all entity tables. No code changes.

**Phase 1 (Week 3-4):** Auto-provision workspaces. Backfill `workspace_id` on all existing records.

**Phase 2 (Week 5-6):** Dual-write mode. All inserts write both `user_id` and `workspace_id`.

**Phase 3 (Week 7-8):** Migrate background jobs (opportunities refresh, pattern detection, email digest, memory extraction, skill progression, follow-up sequence, growth push notifications).

**Phase 4 (Week 9-10):** Migrate all SELECT queries. This is the largest phase — every `.eq('user_id', userId)` in every route file becomes `.eq('workspace_id', req.workspace.id)` with appropriate visibility filtering.

**Route migration priority order** (highest risk/value first):
1. `auth.js` — foundation for all other routes
2. `opportunities.js` — highest-traffic, most revenue-critical
3. `pipeline.js` — tight coupling with opportunities
4. `prospects.js` — institutional CRM data
5. `calendar.js` — rich intelligence, prospect health
6. `metrics.js` — dashboard correctness is visible
7. `insights.js` — analytics layer
8. `practice.js` — team feature unlock
9. `goals.js`, `growth.js` — habit and coaching layer
10. `feedback.js`, `followup.js`, `commitments.js` — supporting data
11. `chat.js` — memory and streaming
12. `user.js`, `onboarding.js` — profile migration last (lowest risk)

**Phase 5 (Week 11-12):** RLS enforcement.

**Phase 6 (Week 13-14):** Cleanup legacy `user_id` references, enable team UI features.

---

# PART 3 — CRITICAL FIXES REQUIRING IMMEDIATE ACTION

Before any multi-tenant work begins, three bugs in the current codebase need immediate hotfixes:

**1. Issue 22 (CRITICAL — cost):** Remove `return { needed: true, reason: 'seyi' }` from `needsRealTimeSearch` in `perplexity.js`. Every user is being routed through Perplexity unconditionally. This is burning real API budget right now.

**2. Issue 23 (CRITICAL — silent data loss):** Fix `queries.length` to `queryConfigs.length` on line 476 of `perplexity.js`. Every successful Perplexity search run crashes before returning results, silently discarding real leads and falling back to practice examples.

**3. Issue 6 (HIGH — UX regression):** Remove the `await` from `runOpportunitiesRefreshForUser` in the GET `/api/opportunities` handler. Change it to a fire-and-forget call. Every first page load after 12 hours currently blocks until the entire discovery pipeline completes.

These three fixes require changing approximately 4 lines of code and deliver immediate, measurable improvements to cost, data quality, and user experience.

---

# INVESTOR PERSPECTIVE

*(10 reasons unchanged from V1 — the architecture described in Part 2 delivers on all of them. The immediate hotfixes in Part 3 remove active cost leakage before the multi-tenant work begins.)*

---

*END OF FILE — Version 2.0*
