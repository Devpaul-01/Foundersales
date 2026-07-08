# FounderSales: Multi-Tenant Architecture & Enterprise Upgrade Blueprint
## Complete Route-by-Route Redesign · Permissions Deep Dive · Investor Perspective
**Version 3.0 — Full Companion to Part 1: System Audit**

---

## Executive Summary

FounderSales is evolving from a single-user productivity tool into a collaborative sales operating system designed for teams. The goal is not just to help individual reps find and manage opportunities, but to enable:

- Multi-user collaboration across every sales workflow
- Shared visibility into opportunities, prospects, and pipeline
- Team-based performance tracking, coaching, and AI-generated insights
- Real-time coordination, task ownership, and accountability

This document covers the complete architectural decisions required to support:

- **Multi-tenant scaling** — workspace isolation at the data layer using Supabase RLS + explicit `workspace_id` scoping on every table
- **Team-based data access** — role-aware query filters, not just RLS policies alone
- **High-performance querying** — parallel fetches (`Promise.allSettled`), Redis TTL caches, and background job offloading for expensive operations
- **Future collaboration features** — roles, shared pipelines, activity feeds, workspace memory, and manager coaching tools

The system is being designed intentionally to support:

- → **Teams, not individuals**
- → **Retention through collaboration** (managers renew subscriptions; reps use it because managers can see them)
- → **Scalability to thousands of concurrent active users**

This document is organized as follows:

| Part | Topic |
|------|-------|
| Part 1 | System Audit (companion document — separate file) |
| Part 2 | Complete Multi-Tenant Architecture: All Routes |
| Part 3 | Critical Fixes Requiring Immediate Action |
| Part 4 | Permissions & Access Control Deep Dive |
| Part 5 | Middleware Architecture: Workspace Resolution |
| Part 6 | New Enterprise-Value Endpoints |
| Part 7 | Roadmap — Sequenced for Maximum Impact |
| Part 8 | Investor Perspective: What Makes This $50K ARR per Enterprise Customer |

---

# PART 2 — COMPLETE MULTI-TENANT ARCHITECTURE: ALL ROUTES

This section redesigns every route in the system for workspaces, roles, and team collaboration. Each subsection covers the specific schema additions, query changes, permission implications, and new endpoints for that route group.

---

## Section 2.1 — Foundation: Workspaces, Members, and Identity

The workspace is the top-level organizational unit. Every piece of data in the system — opportunities, prospects, pipeline cards, practice sessions, goals, growth cards, chats — belongs to exactly one workspace. Users belong to one or more workspaces through `workspace_members`, and their profile data is workspace-scoped via `workspace_profiles`.

### Core Schemas

```sql
workspaces
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid()
  name             TEXT NOT NULL
  slug             TEXT UNIQUE NOT NULL
  plan             TEXT DEFAULT 'free'        -- free | growth | pro | enterprise
  owner_user_id    UUID REFERENCES users(id) NOT NULL
  settings         JSONB DEFAULT '{}'         -- feature flags, plan limits, preferences
  created_at       TIMESTAMPTZ DEFAULT now()
  updated_at       TIMESTAMPTZ DEFAULT now()
  is_deleted       BOOLEAN DEFAULT false

workspace_members
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid()
  workspace_id     UUID REFERENCES workspaces(id) NOT NULL
  user_id          UUID REFERENCES users(id) NOT NULL
  role             TEXT NOT NULL              -- owner | admin | manager | member | viewer
  custom_role_id   UUID REFERENCES custom_roles(id) NULLABLE
  status           TEXT DEFAULT 'active'      -- active | suspended | pending_invite
  invited_by       UUID REFERENCES users(id) NULLABLE
  joined_at        TIMESTAMPTZ
  permissions      JSONB DEFAULT '{}'         -- per-user permission overrides
  UNIQUE(workspace_id, user_id)

workspace_profiles
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid()
  workspace_id          UUID REFERENCES workspaces(id) NOT NULL
  user_id               UUID REFERENCES users(id) NOT NULL
  product_description   TEXT
  target_audience       TEXT
  business_name         TEXT
  voice_profile         JSONB
  onboarding_answers    JSONB
  onboarding_completed  BOOLEAN DEFAULT false
  archetype             TEXT
  industry              TEXT
  role                  TEXT
  preferred_platforms   TEXT[]
  business_stage        TEXT
  experience_level      TEXT
  country               TEXT
  state                 TEXT
  PRIMARY KEY (workspace_id, user_id)
```

### Workspace Activity Log

Every significant action taken by any team member is written to `workspace_activity`. This table powers the manager's real-time activity feed — the feature that makes managers renew subscriptions.

```sql
workspace_activity
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid()
  workspace_id     UUID REFERENCES workspaces(id) NOT NULL
  actor_user_id    UUID REFERENCES users(id) NOT NULL
  action_type      TEXT NOT NULL
    -- Examples: 'opportunity.sent', 'prospect.transferred', 'pipeline.stage_moved',
    --           'deal.closed_won', 'commitment.completed', 'practice.session_completed',
    --           'feedback.submitted', 'message.scored'
  entity_type      TEXT                       -- 'opportunity' | 'prospect' | 'pipeline_card' | etc.
  entity_id        UUID
  entity_label     TEXT                       -- Human-readable summary for the feed
  metadata         JSONB DEFAULT '{}'         -- Additional context (stage names, scores, etc.)
  created_at       TIMESTAMPTZ DEFAULT now()

  INDEX (workspace_id, created_at DESC)      -- Feed pagination
  INDEX (workspace_id, actor_user_id)        -- Filter by member
```

**Activity feed write pattern** — every route that mutates data inserts a `workspace_activity` record as a non-blocking side-effect:

```javascript
// Non-blocking — don't await; activity feed is never on the critical path
supabaseAdmin.from('workspace_activity').insert({
  workspace_id:  req.workspace.id,
  actor_user_id: req.user.id,
  action_type:   'opportunity.sent',
  entity_type:   'opportunity',
  entity_id:     opp.id,
  entity_label:  `Sent outreach to ${opp.target_name}`,
  metadata:      { platform: opp.platform, composite_score: opp.composite_score },
}).then(() => {}).catch(err => logError('workspace_activity insert', err));
```

### Workspace Memory

Future table — adds institutional knowledge to the AI coach prompt:

```sql
workspace_memory
  id             UUID PRIMARY KEY
  workspace_id   UUID REFERENCES workspaces(id) NOT NULL
  fact_text      TEXT NOT NULL
  source         TEXT          -- 'manager_note' | 'ai_extracted' | 'pattern_detected'
  created_by     UUID REFERENCES users(id)
  created_at     TIMESTAMPTZ DEFAULT now()
  is_active      BOOLEAN DEFAULT true
```

When present, workspace memory facts are injected into every AI prompt: `"Your team has found that CFOs at mid-market companies respond well to compliance angles."` — a product experience no individual tool can replicate.

---

## Section 2.2 — AUTH Routes (`auth.js`)

**Current routes:** `POST /register`, `POST /login`, `POST /logout`, `POST /refresh`, `GET /me`, `POST /profile/ensure`, `GET /google/url`, `POST /resend-verification`

### What the Code Currently Does

The current `auth.js` uses a `createUserProfileWithRetry` helper with exponential backoff (500ms → 1000ms → 1500ms, 3 attempts) and a `deleteAuthUserWithRetry` rollback (1000ms → 2000ms → 3000ms) if profile creation fails. Both helpers use a shared `supabaseAdmin` singleton with SECURITY DEFINER RPC calls to bypass RLS cleanly. This pattern is solid and carries forward unchanged into the multi-tenant design.

`GET /me` currently returns `users.*` with a single `.eq('id', userId)` query. `POST /profile/ensure` handles OAuth users by checking for an existing profile first and early-returning — preventing duplicate insert conflicts.

### Multi-Tenant Changes

**Registration flow:** Extend `createUserProfileWithRetry` to also call a `create_personal_workspace` RPC in the same transaction. Workspace creation and profile creation must be atomic — if the workspace RPC fails, the auth user is rolled back. An orphaned auth user now means neither a profile NOR a workspace exists, keeping rollback clean.

```sql
-- RPC: create_user_profile_and_workspace (replaces create_user_profile)
-- Atomically creates: users record + personal workspace + workspace_member (owner) + workspace_profile
CREATE OR REPLACE FUNCTION create_user_profile_and_workspace(
  p_id    UUID,
  p_email TEXT,
  p_name  TEXT,
  p_tier  TEXT
) RETURNS JSONB AS $$
DECLARE
  v_workspace_id UUID;
BEGIN
  INSERT INTO users (id, email, name, tier) VALUES (p_id, p_email, p_name, p_tier)
    ON CONFLICT (id) DO NOTHING;

  INSERT INTO workspaces (name, slug, plan, owner_user_id)
    VALUES (
      COALESCE(p_name, split_part(p_email, '@', 1)) || '''s Workspace',
      p_id::TEXT,   -- slug = userId; unique by design
      p_tier,
      p_id
    )
  RETURNING id INTO v_workspace_id;

  INSERT INTO workspace_members (workspace_id, user_id, role, status, joined_at)
    VALUES (v_workspace_id, p_id, 'owner', 'active', now());

  INSERT INTO workspace_profiles (workspace_id, user_id)
    VALUES (v_workspace_id, p_id);

  UPDATE users SET active_workspace_id = v_workspace_id WHERE id = p_id;

  RETURN jsonb_build_object('workspace_id', v_workspace_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Login response:** Include `active_workspace_id` and a summary of `workspace_memberships` alongside existing session tokens. This gives the frontend everything it needs to render the workspace switcher immediately without a second round-trip.

```json
{
  "user": { "id": "...", "name": "Alex", "email": "...", "active_workspace_id": "ws_uuid" },
  "workspace_memberships": [
    { "workspace_id": "ws_uuid", "workspace_name": "Acme Sales", "role": "manager", "plan": "pro" }
  ],
  "session": { "access_token": "...", "refresh_token": "...", "expires_at": 1234567890 }
}
```

**GET /me:** Returns the full `workspace_profiles` record for the active workspace alongside the base user record via a join:

```sql
SELECT u.*, wp.*
FROM users u
LEFT JOIN workspace_profiles wp
  ON wp.user_id = u.id
  AND wp.workspace_id = u.active_workspace_id
WHERE u.id = auth.uid();
```

**POST /profile/ensure (OAuth path):** After creating the base user profile, also create a personal workspace and `workspace_profile` in the same operation. Apply the same retry mechanism used by the registration path.

**New endpoints:**

```
POST /api/user/switch-workspace
  1. Verify membership in target workspace (status = 'active')
  2. UPDATE users SET active_workspace_id = :workspace_id WHERE id = :userId
  3. Issue new access token with updated workspace claims
  4. Return { workspace, membership, tokens }

GET /api/user/workspaces
  — All workspaces the user belongs to, with role and plan in each
  — Powers the workspace switcher dropdown
```

---

## Section 2.3 — OPPORTUNITIES Routes (`opportunities.js`)

**Current routes:** `GET /`, `POST /refresh`, `GET /pending-sent-confirmation`, `GET /:id/message-score`, `PUT /:id/view`, `PUT /:id/copy`, `PUT /:id/sent`, `POST /:id/regenerate`, `POST /:id/chat`, `POST /:id/intel`

### What the Code Currently Does

`GET /` uses a 12-hour staleness check against `opportunities.created_at` filtered by `user_id`. If stale, `runOpportunitiesRefreshForUser` fires as a proper fire-and-forget with `.catch()` — it does not block the response. The response includes `background_refresh_triggered: true` so the frontend can show a "Finding new opportunities…" banner and poll.

The Perplexity quota is tracked at the user level in `perplexity_usage`. The `computeIntelNeeded` helper uses a zero-cost regex heuristic (no API call) to decide whether the QuickIntelPanel should display for a given opportunity, saving Perplexity budget for prospects worth searching.

The `refreshRateLimiter` is correctly defined at the route file level (not just `app.js`) — 5 refreshes per hour per user — and applied directly to `POST /refresh`.

### Multi-Tenant Changes

**Schema additions to `opportunities`:**

```sql
workspace_id    UUID REFERENCES workspaces(id) NOT NULL
created_by      UUID REFERENCES users(id)          -- replaces user_id for ownership tracking
assigned_to     UUID REFERENCES users(id) NULLABLE -- lead assignment
visibility      TEXT DEFAULT 'private'             -- private | workspace | assigned_only
```

**All queries change** from `.eq('user_id', userId)` to `.eq('workspace_id', req.workspace.id)` with visibility filtering:

```javascript
// Members with view_own: see only their created or assigned opportunities
let query = supabase.from('opportunities')
  .select('*')
  .eq('workspace_id', req.workspace.id);

if (!canViewTeam) {
  query = query.or(
    `created_by.eq.${userId},assigned_to.eq.${userId},visibility.eq.workspace`
  );
}
```

**POST /refresh:** Requires `opportunities.refresh_feed` permission. In a team workspace, the Perplexity quota (`perplexity_usage`) becomes workspace-scoped — tracked at `(workspace_id, date)` rather than `(user_id, date)`. This prevents 10 reps from each burning quota simultaneously.

**PUT /:id/view, /copy, /sent:** All three write to `workspace_activity` so managers see team outreach in their real-time feed.

**Lead assignment — new endpoints:**

```
POST /api/opportunities/:id/assign
  Body: { assignee_id: UUID, note?: string }
  — Requires pipeline.assign_leads permission (manager+)
  — Updates assigned_to, writes workspace_activity: "Jordan assigned lead to Alex"
  — Sends push notification to assignee

GET /api/opportunities/workspace/feed
  — All workspace opportunities in team mode
  — Requires opportunities.view_team permission

GET /api/opportunities/workspace/queue
  — Unassigned opportunities only (assigned_to IS NULL)
  — The shared lead pool; managers assign from here
```

**Permission matrix for opportunities:**

| Action | Member (view_own) | Member (view_team) | Manager | Admin/Owner |
|---|---|---|---|---|
| View own opportunities | ✅ | ✅ | ✅ | ✅ |
| View all team opportunities | ❌ | ✅ | ✅ | ✅ |
| Create | ✅ | ✅ | ✅ | ✅ |
| Trigger refresh (own quota) | ✅ | ✅ | ✅ | ✅ |
| Assign to team member | ❌ | ❌ | ✅ | ✅ |
| Delete | ❌ | ❌ | ✅ | ✅ |
| View message score | ✅ | ✅ | ✅ | ✅ |

---

## Section 2.4 — PIPELINE Routes (`pipeline.js`)

**Current routes:** `GET /`, `PUT /:id/stage`, `GET /metrics`

### What the Code Currently Does

`GET /` fetches all opportunities for the user (filtered by `user_id`), groups them by `stage` into a Kanban object, and computes per-column `deal_value_sum`. It selects `last_stage_changed_at`, `follow_up_message`, and `follow_up_count` so the frontend can show days-in-stage staleness badges and follow-up interactivity. `PUT /:id/stage` writes `last_stage_changed_at` on every manual stage move — critical for the follow-up job's staleness detection.

### Multi-Tenant Changes

**GET / (Kanban board):** Controlled by a `?view` query parameter:

- `?view=personal` — filters by `assigned_to = userId` (member sees their own cards)
- `?view=team` — returns all workspace pipeline cards (requires `pipeline.view_team` permission)

Each card includes `assigned_to` user info (name, avatar_url) for the frontend to render ownership badges. In team view, the response adds a `workspace_totals` object:

```json
{
  "pipeline": { "contacted": [...], "replied": [...], ... },
  "workspace_totals": {
    "contacted": { "count": 12, "deal_value_sum": 84000 },
    "replied":   { "count": 7,  "deal_value_sum": 54000 }
  },
  "metrics": { ... }
}
```

**PUT /:id/stage:** Stage moves write to `workspace_activity`. Cross-member moves fire a push notification to the `created_by` user: "Jordan moved your lead [Target] from Replied → Call/Demo."

**New endpoints:**

```
GET /api/pipeline/workspace/overview
  — Workspace pipeline health snapshot for managers
  — Totals per stage, avg days-in-stage, stale cards (>7 days no movement)

GET /api/pipeline/workspace/by-member
  — All pipeline cards grouped by assigned_to member
  — Powers the manager's rep-by-rep pipeline view
```

---

## Section 2.5 — CALENDAR Routes (`calendar.js`)

**Current routes:** `GET /`, `GET /alerts`, `POST /`, `GET /:id`, `PUT /:id`, `DELETE /:id`, `POST /:id/regenerate-prep`, `POST /:id/research`, `POST /:id/debrief`, `POST /:id/start-meeting-notes`

### What the Code Currently Does

`calendar.js` is the richest route in the product. Key behaviors: AI-powered enriched prep generation, Perplexity prospect research, meeting debrief extraction (including auto-commitment extraction via `extractCommitmentsFromText`), signal analysis, and post-meeting follow-up generation. `updateProspectHealth` aggregates signals and commitments to update the prospect's health score. The `buildPrepContext` helper explicitly filters by `user_id` on signals and commitments queries to prevent cross-user data leakage.

An AI rate limiter (10 requests per 5 minutes per user) is applied to the heavy endpoints: regenerate-prep, research, debrief, start-meeting-notes.

### Multi-Tenant Changes

**Schema additions to `user_events`:**

```sql
workspace_id          UUID REFERENCES workspaces(id) NOT NULL
meeting_owner         UUID REFERENCES users(id)           -- who scheduled it (defaults to req.user.id)
internal_attendees    UUID[]                               -- workspace member IDs attending
is_team_visible       BOOLEAN DEFAULT false               -- manager can see this event
debrief_shared_with   UUID[]                               -- member IDs who can see debrief content
shared_prep           BOOLEAN DEFAULT false               -- multiple members can contribute prep notes
```

**GET / (event list):** Members see their own events plus any events where `userId = ANY(internal_attendees)`. Managers see all workspace events where `is_team_visible = true`. The `debrief_needed` flag is preserved per-user.

**GET /alerts:** In team context, managers see two additional alert categories:

- "Team members with overdue debriefs" — events past `event_date` with no `debrief_completed_at`
- "Team commitments overdue across the workspace" — aggregate from `conversation_commitments` where `status = 'overdue'` for all workspace members

**POST / (create event):** When `internal_attendees` is provided, the event appears in each attendee's calendar view. Only the `meeting_owner` and managers can edit or delete. Attendees can view and contribute to prep notes if `shared_prep = true`.

**POST /:id/debrief:** Only `meeting_owner` can submit. The debrief is written to `workspace_activity` immediately: "Alex debriefed 'Meeting with Acme Corp' — outcome: Hot." If `is_team_visible = true`, the debrief *summary* (not raw notes) is visible to managers.

**updateProspectHealth — workspace-aware:** In team mode, health score aggregates signals and commitments from ALL workspace members who have interacted with this prospect — not just the event owner. Full relationship context regardless of who currently owns it.

**New team-specific calendar endpoints:**

```
GET /api/calendar/workspace/upcoming
  — All team meetings in the next 7 days, grouped by member
  — Manager sees who has what meetings coming up

GET /api/calendar/workspace/debrief-digest
  — All meetings debriefed this week, outcomes, follow-up commitments created
  — Manager weekly review trigger
```

---

## Section 2.6 — PROSPECTS Routes (`prospects.js`)

**Current routes:** `GET /`, `GET /:id`, `POST /`, `PUT /:id`, `POST /:id/refresh-summary`, `POST /:id/recalculate-health`, `DELETE /:id`

### What the Code Currently Does

`GET /:id` loads the full timeline in parallel using `Promise.all` across four tables — `user_events`, `chats`, `conversation_signals`, and `conversation_commitments` — then sorts them by date into a unified timeline. The list endpoint enriches each prospect with a `pending_commitments` count via a second query.

`POST /:id/refresh-summary` calls `generateProspectSummary` from `groqCalendarIntelligence.js`, which currently receives only the requesting user's data.

### Multi-Tenant Changes

**Schema additions to `prospects`:**

```sql
workspace_id          UUID REFERENCES workspaces(id) NOT NULL
created_by            UUID REFERENCES users(id)           -- who first added this contact
relationship_owner    UUID REFERENCES users(id) NULLABLE  -- who "owns" this relationship now
account_id            UUID REFERENCES accounts(id) NULLABLE  -- company-level grouping
visibility            TEXT DEFAULT 'workspace'            -- private | workspace | assigned_only
```

**New `accounts` table** (company-level CRM layer):

```sql
accounts
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid()
  workspace_id     UUID REFERENCES workspaces(id) NOT NULL
  name             TEXT NOT NULL
  domain           TEXT UNIQUE                            -- used for duplicate detection
  industry         TEXT
  employee_count   INTEGER
  annual_revenue   BIGINT
  notes            TEXT
  created_by       UUID REFERENCES users(id)
  created_at       TIMESTAMPTZ DEFAULT now()
```

**GET /:id (prospect timeline):** In team mode, the timeline aggregates events, chats, signals, and commitments from ALL workspace members who have interacted with this prospect. The query changes from `.eq('user_id', userId)` to `.eq('prospect_id', prospect.id)` (no user filter) combined with workspace membership validation:

```javascript
// All interactions from any workspace member — not just the requesting user
const [eventsRes, chatsRes, signalsRes, commitmentsRes] = await Promise.all([
  supabase.from('user_events')
    .select('id, title, event_type, event_date, outcome, ..., meeting_owner')
    .eq('prospect_id', prospect.id)
    // No user_id filter — show full cross-member relationship history
    .order('event_date', { ascending: false }),
  // ... same pattern for chats, signals, commitments
]);
```

The `refresh-summary` AI prompt also receives this full cross-member timeline, generating a richer narrative than any individual rep's siloed view could provide.

**Ownership transfer:**

```
POST /api/prospects/:id/transfer
  Body: { new_owner_id: UUID, handoff_note: string (min 20 chars) }

  1. Verify requesting user is current relationship_owner OR has manager role
  2. Validate new_owner_id is an active workspace member
  3. UPDATE prospects SET relationship_owner = new_owner_id
  4. INSERT workspace_activity: "Alex transferred [Prospect Name] to Jordan"
  5. Send push notification to new_owner_id
  6. Return updated prospect record
  — handoff_note is required (min 20 chars) to capture institutional context
```

**DELETE:** Soft-delete only in workspace context (`is_deleted = true`). Hard delete requires Admin role. Prospect data is workspace institutional knowledge — accidental deletion is a significant risk.

---

### 2.6.A — DUPLICATE RESOLUTION (Deep Dive)

In a multi-user team environment, two reps will independently discover and add the same contact. Without systematic duplicate detection, the workspace CRM becomes polluted with redundant records, split relationship history, and ownership conflicts. This section defines the detection, merge, and prevention strategy.

#### Detection Rules

Duplicates are detected at two levels: **exact match** (block and surface) and **fuzzy match** (warn and suggest).

**Level 1 — Exact match (block on creation):**

```javascript
// Runs synchronously on POST /api/prospects before insert
const detectExactDuplicate = async (workspaceId, { name, email, linkedin_url }) => {
  const conditions = [];

  if (email?.trim()) {
    conditions.push(`email.ilike.${email.trim().toLowerCase()}`);
  }
  if (linkedin_url?.trim()) {
    conditions.push(`linkedin_url.eq.${linkedin_url.trim()}`);
  }

  if (conditions.length === 0) return null;  // Can't detect without identifier

  const { data } = await supabase
    .from('prospects')
    .select('id, name, email, relationship_owner, created_by')
    .eq('workspace_id', workspaceId)
    .eq('is_deleted', false)
    .or(conditions.join(','))
    .limit(1)
    .single();

  return data || null;  // null = no duplicate found
};
```

**Level 2 — Fuzzy match (warn, don't block):**

Run a trigram similarity check on `name` using PostgreSQL's `pg_trgm` extension for prospects without email or LinkedIn. Similarity threshold: `> 0.7`.

```sql
-- Fuzzy name match for duplicate warning
SELECT id, name, email, relationship_owner
FROM prospects
WHERE workspace_id = :workspace_id
  AND is_deleted = false
  AND similarity(lower(name), lower(:name)) > 0.7
ORDER BY similarity(lower(name), lower(:name)) DESC
LIMIT 3;
```

**Level 3 — Domain-level deduplication (account layer):**

When a prospect's email domain or company website matches an existing `account` record, the system automatically links `prospect.account_id` to that account. This prevents fragmented account-level records even if individual contact records differ.

```javascript
const resolveAccount = async (workspaceId, { company, website }) => {
  if (!company && !website) return null;

  const domain = website
    ? new URL(website).hostname.replace('www.', '')
    : null;

  // Try domain match first (most reliable)
  if (domain) {
    const { data: existing } = await supabase
      .from('accounts')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('domain', domain)
      .single();

    if (existing) return existing.id;
  }

  // Try company name fuzzy match
  if (company) {
    const { data: similar } = await supabase
      .rpc('find_similar_account', { p_workspace_id: workspaceId, p_name: company, p_threshold: 0.8 });
    if (similar?.id) return similar.id;
  }

  // No match — create new account
  const { data: newAccount } = await supabase
    .from('accounts')
    .insert({ workspace_id: workspaceId, name: company, domain })
    .select('id')
    .single();

  return newAccount?.id || null;
};
```

#### API Response on Conflict

When a Level 1 exact duplicate is detected, the API returns `409 CONFLICT` with enough detail for the frontend to render a resolution UI without a second round-trip:

```json
{
  "error": "DUPLICATE_PROSPECT",
  "message": "A prospect with this email already exists in your workspace.",
  "existing": {
    "id": "prospect_uuid",
    "name": "Jordan Smith",
    "email": "jordan@acme.com",
    "relationship_owner": { "id": "user_uuid", "name": "Alex" },
    "relationship_health_score": 72,
    "last_contact_at": "2025-03-10T14:00:00Z",
    "pending_commitments": 2
  }
}
```

For Level 2 fuzzy warnings, the API proceeds with the insert but includes a `warnings` array:

```json
{
  "prospect": { "id": "new_uuid", ... },
  "warnings": [
    {
      "type": "POSSIBLE_DUPLICATE",
      "message": "A contact named 'Jordan Smith' already exists.",
      "similar_prospect_id": "existing_uuid",
      "similarity_score": 0.84,
      "action": "review_or_merge"
    }
  ]
}
```

#### Merge Workflow

Merging two prospect records is a destructive operation. It must be reversible for 30 days. The merge endpoint is manager-only.

```
POST /api/prospects/merge
  Body: {
    primary_id:   UUID,   -- The record to KEEP (retains ID, URL, data)
    secondary_id: UUID,   -- The record to ABSORB (will be soft-deleted after merge)
    field_choices: {      -- For each conflicting field, which version to keep
      name:    'primary' | 'secondary',
      company: 'primary' | 'secondary',
      email:   'primary' | 'secondary',
      notes:   'primary' | 'secondary' | 'both'
    }
  }
```

**Merge algorithm — non-destructive:**

```javascript
const mergeProspects = async (primaryId, secondaryId, fieldChoices, actorUserId, workspaceId) => {
  // 1. Load both records
  const [primary, secondary] = await Promise.all([
    supabase.from('prospects').select('*').eq('id', primaryId).single(),
    supabase.from('prospects').select('*').eq('id', secondaryId).single(),
  ]);

  // 2. Compute merged field values based on field_choices
  const mergedFields = resolveMergedFields(primary.data, secondary.data, fieldChoices);

  // 3. Re-parent all related records from secondary → primary
  //    Do this BEFORE soft-deleting secondary
  await Promise.all([
    supabase.from('user_events')
      .update({ prospect_id: primaryId })
      .eq('prospect_id', secondaryId),

    supabase.from('chats')
      .update({ prospect_id: primaryId })
      .eq('prospect_id', secondaryId),

    supabase.from('conversation_signals')
      .update({ prospect_id: primaryId })
      .eq('prospect_id', secondaryId),

    supabase.from('conversation_commitments')
      .update({ prospect_id: primaryId })
      .eq('prospect_id', secondaryId),

    supabase.from('opportunities')
      .update({ prospect_id: primaryId })
      .eq('prospect_id', secondaryId),
  ]);

  // 4. Update primary record with merged fields
  await supabase.from('prospects').update({
    ...mergedFields,
    merged_from_ids:  [secondaryId, ...(primary.data.merged_from_ids || [])],
    updated_at:       new Date().toISOString(),
  }).eq('id', primaryId);

  // 5. Soft-delete secondary (NOT hard delete — allows 30-day undo)
  await supabase.from('prospects').update({
    is_deleted:    true,
    deleted_at:    new Date().toISOString(),
    merge_target:  primaryId,   -- Records which record absorbed it (for undo)
  }).eq('id', secondaryId);

  // 6. Write audit trail
  await supabase.from('workspace_activity').insert({
    workspace_id:  workspaceId,
    actor_user_id: actorUserId,
    action_type:   'prospect.merged',
    entity_type:   'prospect',
    entity_id:     primaryId,
    entity_label:  `Merged "${secondary.data.name}" into "${primary.data.name}"`,
    metadata:      { secondary_id: secondaryId, field_choices: fieldChoices },
  });

  return { merged_into: primaryId, absorbed: secondaryId };
};
```

**Undo window (30 days):** Within 30 days, an Admin can call `POST /api/prospects/:secondaryId/unmerge` which:
1. Restores `secondary` by setting `is_deleted = false`
2. Re-parents any NEW related records created after the merge back to secondary (based on `created_at > merge_timestamp`)
3. Writes a `prospect.unmerged` activity record

#### Prevention Strategies

Prevention reduces the frequency of merges needed.

**1. Real-time duplicate check in the creation UI:** Before the user submits a new prospect, the frontend calls `GET /api/prospects/check-duplicate?email=...&name=...` — a lightweight, read-only endpoint that returns potential matches. The UI shows a non-blocking warning: "A contact named Jordan Smith already exists — view or add anyway?"

**2. Import deduplication:** When prospects are imported in bulk (CSV/CRM sync), run all three detection levels (exact, fuzzy, domain) before inserting. Return a pre-import report: "12 records will be merged with existing contacts. Review before confirming."

**3. Prospect claim flow:** Instead of creating a duplicate, team members can "claim" an existing prospect by requesting relationship_owner status, which triggers a notification to the current owner and requires manager approval.

**4. Account-level grouping:** Grouping prospects by `account_id` makes it visually obvious before creation if multiple reps are already tracking contacts at the same company — reducing well-intentioned duplicates.

**Permission matrix for prospects:**

| Action | Member (own) | Member (all) | Manager | Admin |
|---|---|---|---|---|
| View own prospects | ✅ | ✅ | ✅ | ✅ |
| View all workspace prospects | ❌ | ✅ | ✅ | ✅ |
| Create | ✅ | ✅ | ✅ | ✅ |
| Edit own | ✅ | ✅ | ✅ | ✅ |
| Edit any team prospect | ❌ | ❌ | ✅ | ✅ |
| Transfer ownership | ❌ | ❌ | ✅ | ✅ |
| Merge prospects | ❌ | ❌ | ✅ | ✅ |
| Unmerge (undo merge) | ❌ | ❌ | ❌ | ✅ |
| Soft delete | ❌ | ❌ | ✅ | ✅ |
| Hard delete | ❌ | ❌ | ❌ | ✅ |
| Refresh AI summary | ✅ | ✅ | ✅ | ✅ |

---

## Section 2.7 — METRICS Routes (`metrics.js`)

**Current routes:** `GET /dashboard`, `GET /communication-snapshot`, `GET /momentum`, `GET /intelligence`, `GET /milestones`, `GET /learning`, `GET /usage`

### What the Code Currently Does

The `intelligenceCache` is an in-memory `Map` keyed by `userId` with a 4-hour TTL (`INTELLIGENCE_TTL_MS = 4 * 60 * 60 * 1000`). This prevents repeated AI calls on every page load, but it does not survive server restarts. `GET /dashboard` reads directly from `opportunities` (authoritative source) rather than from `daily_metrics` (stale aggregation table). The `computeMomentumScore` function returns both `score` and `breakdown` so the UI breakdown bars always match the displayed score.

### Multi-Tenant Changes

**GET /dashboard:** Personal metrics remain personal — `today.sent`, `streak.outreach`, `practice.sessions_30d` are always scoped to the requesting user. For managers, a `workspace` block is added:

```json
{
  "today": { "discovered": 3, "sent": 2, "replies": 1 },
  "workspace": {
    "team_sent_today": 14,
    "team_sent_this_week": 67,
    "active_members": 8,
    "top_performer": { "user_id": "...", "name": "Jordan", "sent_today": 5 },
    "reply_rate_7d": 0.23
  }
}
```

The `workspace` block requires `analytics.view_team` permission and returns `null` for members without it — no error, just null that the frontend ignores.

**GET /intelligence:** The in-memory cache (`intelligenceCache` Map) is upgraded to Redis keyed by `workspace_id:user_id`. The AI prompt is enriched with `workspace_memory` facts in addition to personal `user_memory`. Intelligence insights therefore reflect both personal patterns and institutional knowledge.

**GET /communication-snapshot:** Remains personal. Managers can access any member's snapshot via `?member_id=uuid` (requires `analytics.view_team`).

**New team analytics endpoints:**

```
GET /api/metrics/workspace/leaderboard
  — Members ranked by sent count, reply rate, composite message score (last 30d)
  — Parameters: ?period=7d|30d|all_time, ?sort=sent|reply_rate|score
  — Requires analytics.view_team permission

GET /api/metrics/workspace/rep-comparison?member_a=uuid&member_b=uuid
  — Side-by-side skill radar charts for any two members
  — Returns dimension scores for both users
  — Requires analytics.view_team permission

GET /api/metrics/workspace/team-velocity
  — Week-over-week delta for the full team: sent, replies, pipeline moves
  — Shows which direction team momentum is trending
  — Requires analytics.view_team permission

GET /api/metrics/workspace/coaching-queue
  — Members automatically flagged for manager attention:
      · No practice in 7+ days
      · Reply rate below workspace average by >15%
      · No outreach in 5+ days
      · Skill score declining for 2 consecutive weeks
  — Requires analytics.view_team permission
```

---

## Section 2.8 — INSIGHTS Routes (`insights.js`)

**Current routes:** `GET /summary`, `GET /weekly`, `POST /weekly/dismiss/:id`, `GET /signals/summary`, `GET /commitments/summary`, `GET /why-losing`, `GET /patterns`, `GET /skill-progression`, `GET /autopsies`, `GET /autopsies/:id`, `GET /objections`, `POST /analyze-message`, `GET /velocity`

### What the Code Currently Does

`GET /summary` runs three parallel queries using `Promise.allSettled` — communication patterns, skill progression, and conversation analyses — and gracefully handles individual failures. `GET /why-losing` uses the PRO_MODEL (currently `llama-3.3-70b-versatile`) to analyze loss patterns from `conversation_analyses`.

`POST /analyze-message` (Pitch Diagnostic) runs `runConversationAnalysis` from the conversation analysis job. It checks `checkPerplexityUsage` before deciding whether to enrich with real-time data.

### Multi-Tenant Changes

**GET /why-losing — highest-value team insight:** In single-user mode, it analyzes one rep's lost deals. In team mode for managers:

```
Workspace-level failure frequency (last 30 days, 8 members, 142 analyzed messages):
- Hook/opening weakness:    67 occurrences (47%)
- Personalization gap:      54 occurrences (38%)
- CTA strength:             41 occurrences (29%)
- Social proof missing:     28 occurrences (20%)
```

The workspace why-losing prompt aggregates `failure_categories` from all `conversation_analyses` across workspace members, producing strategic insight that a VP of Sales would pay for standalone.

**New workspace insights endpoints:**

```
GET /api/insights/workspace/why-losing
  — Cross-team loss pattern analysis
  — Requires analytics.view_team permission

GET /api/insights/workspace/patterns
  — Communication patterns detected across workspace (shared strengths + shared weaknesses)
  — Requires analytics.view_team permission

GET /api/insights/workspace/skill-matrix
  — Heat map: skill dimensions (hook, clarity, CTA, personalization, etc.) per team member
  — Manager sees exactly which rep needs help with which skill
  — Requires analytics.view_team permission

GET /api/insights/workspace/objection-map
  — Which objections arise most across the team, and who handles each best
  — Powers targeted coaching assignments

GET /api/insights/workspace/practice-coverage
  — Which practice scenarios have been completed by whom, with best scores
  — Identifies scenario gaps: "3 members have never practiced Cold Outreach"
```

---

## Section 2.9 — GOALS Routes (`goals.js`)

**Current routes (mounted at `/api/growth/goals`):** `GET /`, `POST /`, `PUT /:goalId`, `DELETE /:goalId`, `POST /:goalId/notes`, `GET /pipeline-insight`

### What the Code Currently Does

`POST /:goalId/notes` receives rich context: previous goal notes, recent daily check-ins, user memory facts, pipeline activity summary, and practice session progress. `FEAT-02` includes a velocity projection block — avg pace per log, projected completion date, and on-track vs. behind-pace status — so the AI coach speaks precisely to trajectory. `GET /pipeline-insight` is cached 24h per user (Issue 29 fix — moved to Redis).

### Multi-Tenant Changes

**Schema additions:**

```sql
goals (formerly user_goals)
  workspace_id    UUID REFERENCES workspaces(id) NOT NULL
  scope           TEXT DEFAULT 'personal'       -- personal | assigned | team
  assigned_to     UUID REFERENCES users(id) NULLABLE
  assigned_by     UUID REFERENCES users(id) NULLABLE
  parent_goal_id  UUID REFERENCES goals(id) NULLABLE  -- OKR-style hierarchies
  is_public       BOOLEAN DEFAULT false                -- visible to workspace members
```

**New endpoint:**

```
GET /api/growth/goals/workspace/alignment
  — All active team goals in one view with progress percentages
  — Groups by: personal goals, manager-assigned goals by member, team goals
  — Shows who is on track, behind, or stuck
  — Requires goals.view_team_goals permission
```

---

## Section 2.10 — GROWTH / CARDS Routes (`growth.js`)

**Current routes:** Feed, card read/dismiss, daily check-in, strategy cards, weekly plan

### Multi-Tenant Changes

**Schema additions to `growth_cards`:**

```sql
workspace_id    UUID REFERENCES workspaces(id) NOT NULL
audience        TEXT DEFAULT 'individual'    -- individual | team | workspace_announcement
created_for     UUID REFERENCES users(id)   -- target member (for manager-to-member cards)
created_by      UUID REFERENCES users(id)   -- who generated this card
```

**Feed (GET /feed):** Personal feed stays personal. Workspace-level cards with `audience = 'workspace_announcement'` are injected at the top of every member's feed — e.g., "Team challenge this week: practice the Skeptical Buyer scenario."

**Pattern detection workspace cards:** A new card type `workspace_pattern` is generated by the workspace-level pattern detection job. These appear in all members' feeds: "Your team's most common issue is a weak hook in opening messages. Here's how the top performers fix it."

**Daily check-in:** Mood data is anonymously aggregated for the manager's team health view: "Team average mood this week: 3.8/5."

---

## Section 2.11 — PRACTICE Routes (`practice.js`)

**Current routes:** `GET /scenarios`, `POST /start`, `POST /:id/message`, `GET /:id`, `GET /history`, `GET /user-skill-profile`, `GET /:id/replay`, `GET /:id/messages`, `GET /:id/outcome`, `GET /progress-summary`

### What the Code Currently Does

The message handler uses a Redis-backed queue worker pattern for streaming reliability. Sessions track `internal_monologue` for the replay view but scrub it from active session responses (safety). `GET /progress-summary` returns a lightweight UI-focused summary without requiring full session data.

### Multi-Tenant Changes

**Schema additions:**

```sql
practice_sessions (additions):
  workspace_id        UUID REFERENCES workspaces(id)
  is_visible_to_team  BOOLEAN DEFAULT false
  assigned_by         UUID REFERENCES users(id) NULLABLE
  challenge_id        UUID REFERENCES team_challenges(id) NULLABLE

team_challenges
  id               UUID PRIMARY KEY
  workspace_id     UUID REFERENCES workspaces(id)
  created_by       UUID REFERENCES users(id)
  scenario_type    TEXT
  buyer_profile    JSONB
  title            TEXT
  description      TEXT
  due_date         TIMESTAMPTZ
  status           TEXT                -- active | completed | archived
  participants     UUID[]
  leaderboard      JSONB              -- [{ user_id, score, completed_at }]

workspace_practice_scenarios
  id               UUID PRIMARY KEY
  workspace_id     UUID REFERENCES workspaces(id)
  created_by       UUID REFERENCES users(id)
  title            TEXT
  scenario_type    TEXT
  custom_prompt    TEXT
  buyer_profile    JSONB
  difficulty       TEXT
  is_featured      BOOLEAN DEFAULT false
  usage_count      INTEGER DEFAULT 0
```

**New team practice endpoints:**

```
GET  /api/practice/workspace/leaderboard
  — Weekly and all-time scores; ?period=7d|30d|all_time, ?scenario_type=all|specific

POST /api/practice/workspace/challenge
  — Manager creates a team challenge
  — Body: { scenario_type, buyer_profile, title, due_date, assigned_to[] }
  — Fires push notifications to assigned members

GET  /api/practice/workspace/challenge/:id
  — Challenge details, participants, leaderboard, coaching summary

GET  /api/practice/workspace/coverage
  — Scenario coverage per member: who has practiced what, with best scores
  — Gaps highlighted: "3 members have never practiced Cold Outreach"

POST /api/practice/workspace/scenarios
  — Manager creates a custom workspace scenario
  — Requires practice.manage_scenarios permission
```

---

## Section 2.12 — FEEDBACK Routes (`feedback.js`)

**Current routes:** `POST /`, `GET /pending`, `GET /`, `GET /stats`

### What the Code Currently Does

`POST /feedback` triggers `runConversationAnalysis` fire-and-forget after every FINAL outcome — the analysis runs within 30 seconds and stores structured scores in `conversation_analyses`. The `PENDING` outcome issue (Issue 19) was causing re-notification of outcomes that hadn't resolved yet. Fix: the feedback job checks `feedback.outcome != 'PENDING'` before adding to the notification queue.

`updatePerformanceStats` is now atomic via the `increment_performance_stats` RPC, preventing race conditions when multiple feedback records are submitted simultaneously.

### Multi-Tenant Changes

**Deal win announcements:** On `CLOSED_WON`, the system generates a `workspace_announcement` growth card for ALL team members: "🎉 Alex just closed a deal with Acme Corp! Here's what worked." Generated from the `conversation_analysis` of the winning message — the whole team learns from each other's wins.

**New endpoint:**

```
GET /api/feedback/workspace/stats
  — Team win rate, average deal value, most common lost reasons
  — Requires analytics.view_team permission
```

---

## Section 2.13 — FOLLOWUP Routes (`followup.js`)

**Current routes:** `GET /`, `POST /:id/dismiss`, `POST /:id/sent`

### What the Code Currently Does

`POST /:id/sent` updates `follow_up_sent_at` (so the 5-day cooldown is measured from actual send time, not generation time). `POST /:id/dismiss` increments `follow_up_count` and sets `follow_up_dismissed_at` to record dismissal history. All UPDATE queries include `.eq('user_id')` to prevent cross-user data mutation.

### Multi-Tenant Changes

`GET /` supports new query parameters for managers:

```
GET /api/followup?scope=workspace      — all workspace follow-ups (manager only)
GET /api/followup?assigned_to=uuid    — follow-ups for a specific member (manager only)
```

Both `dismiss` and `sent` write to `workspace_activity` so managers can track whether reps are acting on follow-up suggestions.

**New endpoint:**

```
GET /api/followup/workspace/health
  — Team follow-up health metrics:
      · Total pending across workspace
      · Sitting unacted for 48+ hours (neglect signal)
      · Per-member breakdown sorted by neglect count (coaching signal)
  — Requires analytics.view_team permission
```

---

## Section 2.14 — COMMITMENTS Routes (`commitments.js`)

**Current routes:** `GET /`, `PUT /:id`, `POST /:id/generate-message`

### What the Code Currently Does

`GET /` currently auto-marks overdue commitments inline (mutating inside a GET handler). This is a known issue (Issue 25). The multi-tenant redesign moves the overdue-marking mutation to a background job that runs hourly — the GET handler becomes purely read-only. Commitments are grouped by urgency: `overdue`, `due_soon` (within 48h), and `pending`.

### Multi-Tenant Changes

`GET /` supports manager filters:

```
GET /api/commitments?member_id=uuid   — specific member's commitments (manager only)
```

`PUT /:id` writes to `workspace_activity` when marked `done`: "Alex completed commitment: 'Send case study to Acme Corp'."

**New endpoint:**

```
GET /api/commitments/workspace/overview
  — All pending/overdue commitments grouped by workspace member
  — Shows total open, overdue, and due-this-week per rep
  — Lets manager see who is dropping follow-through balls
  — Requires analytics.view_team permission
```

---

## Section 2.15 — CHAT Routes (`chat.js`)

**Current routes:** `GET /`, `POST /`, `GET /:id`, `POST /:id/messages` (streaming), `PUT /:id/archive`, `GET /:id/context`

### Multi-Tenant Changes

**Schema additions to `chats`:**

```sql
workspace_id    UUID REFERENCES workspaces(id) NOT NULL
shared_with     UUID[]                       -- specific member IDs who can read this chat
is_team_visible BOOLEAN DEFAULT false
```

**Streaming endpoint `POST /:id/messages`:** No changes to the streaming logic itself. However, the system prompt builder is enriched with `workspace_memory` facts alongside personal `user_memory` — enabling the AI coach to reference institutional knowledge.

**Disconnect fix (Issue 12):** In the multi-tenant redesign, `updateChatStats` is wrapped in a `clientConnected` check before being called. This applies to both the Groq and Perplexity streaming paths to prevent stat updates on aborted connections.

**Meeting notes:** When `event.is_team_visible = true` and `event.shared_prep = true`, meeting notes chats are visible to all `event.internal_attendees`.

---

## Section 2.16 — USER Routes (`user.js`)

**Current routes:** `PUT /fcm-token`, `PUT /debug`, `PUT /api/auth/me`, `PUT /notification-preferences`, `DELETE /api/auth/account`

### Multi-Tenant Changes

**Profile update:** Profile fields move from `users` to `workspace_profiles`. The endpoint becomes:

```
PUT /api/user/workspace-profile
  — Updates workspace_profiles for (req.user.id, req.workspace.id)
  — Fields: product_description, target_audience, business_name, voice_profile,
            role, industry, preferred_platforms, business_stage, experience_level
  — Workspace-specific: a user can have different profiles across workspaces
```

**Notification preferences** become workspace-scoped:

```sql
notification_preferences
  user_id              UUID
  workspace_id         UUID
  channel_email        BOOLEAN DEFAULT true
  channel_push         BOOLEAN DEFAULT true
  channel_in_app       BOOLEAN DEFAULT true
  frequency_email      TEXT    -- instant | daily_digest | weekly_digest | never
  muted_types          TEXT[]
  quiet_hours_start    INTEGER
  quiet_hours_end      INTEGER
  quiet_hours_timezone TEXT
  PRIMARY KEY (user_id, workspace_id)
```

**Account deletion:** Soft-deletes the user, transfers workspace ownership to the next admin (if any), and places workspaces with no other admin in a 30-day grace period before hard deletion.

**New endpoints:**

```
GET  /api/user/workspaces           — list all workspaces user belongs to
POST /api/user/switch-workspace     — switch active workspace
POST /api/user/create-workspace     — create a new workspace (any authenticated user)
GET  /api/user/pending-invites      — list pending workspace invitations
POST /api/user/accept-invite/:id    — accept a workspace invitation
POST /api/user/decline-invite/:id   — decline a workspace invitation
```

---

## Section 2.17 — ONBOARDING Routes (`onboarding.js`)

**Current routes:** `POST /basic`, `POST /questions/next`, `POST /answers`, `POST /sample-message`, `POST /rebuild-voice-profile`

### What the Code Currently Does

`POST /answers` validates answer keys server-side against a stored question set (Issue 14 fix), truncates values to 500 characters, and HTML-entity-encodes before prompt injection. The opportunities refresh is triggered as a background task after `/answers` — it fires even if the frontend tab is closed. All Groq calls inside onboarding are wrapped in a concurrency guard to prevent 429 bursts during simultaneous onboarding sessions.

### Multi-Tenant Changes

All profile data writes go to `workspace_profiles(workspace_id, user_id)` instead of `users`. A user invited to a second workspace goes through abbreviated onboarding — they skip workspace-level product/ICP questions (using the workspace's existing defaults) but still answer personal questions about their role and communication style.

---

## Section 2.18 — Migration Strategy (All Routes)

The migration is phased to minimize risk. Each phase has a clear rollback path.

**Phase 0 (Week 1–2):** Add nullable `workspace_id` to all entity tables. No code changes. Zero production risk.

**Phase 1 (Week 3–4):** Auto-provision workspaces. Backfill `workspace_id` on all existing records using the existing `user_id` → personal workspace mapping.

**Phase 2 (Week 5–6):** Dual-write mode. All inserts write both `user_id` and `workspace_id`. Reads still use `user_id`. Feature flags control the cutover per route group.

**Phase 3 (Week 7–8):** Migrate background jobs to workspace scope — opportunities refresh, pattern detection, email digest, memory extraction, skill progression, follow-up sequences, growth push notifications.

**Phase 4 (Week 9–10):** Migrate all SELECT queries. Every `.eq('user_id', userId)` becomes `.eq('workspace_id', req.workspace.id)` with appropriate visibility filtering. This is the largest phase.

**Phase 5 (Week 11–12):** Enable RLS enforcement at the Supabase level. Remove legacy `user_id` filters where `workspace_id` is now primary.

**Phase 6 (Week 13–14):** Cleanup legacy `user_id` references. Enable team UI features. Remove dual-write code paths.

**Route migration priority order (highest risk/value first):**

1. `auth.js` — foundation for all other routes
2. `opportunities.js` — highest-traffic, most revenue-critical
3. `pipeline.js` — tight coupling with opportunities
4. `prospects.js` — institutional CRM data, highest data integrity risk
5. `calendar.js` — rich cross-entity intelligence
6. `metrics.js` — dashboard correctness is visible to users
7. `insights.js` — analytics layer
8. `practice.js` — team feature unlock
9. `goals.js`, `growth.js` — habit and coaching layer
10. `feedback.js`, `followup.js`, `commitments.js` — supporting data
11. `chat.js` — memory and streaming
12. `user.js`, `onboarding.js` — profile migration last (lowest risk)

---

# PART 3 — CRITICAL FIXES REQUIRING IMMEDIATE ACTION

Before any multi-tenant work begins, three bugs in the current codebase need immediate hotfixes. These require changing approximately 4 lines of code and deliver measurable, immediate improvements.

---

**Fix 1 — Issue 22 (CRITICAL — active cost leak):**

Remove the hardcoded return in `needsRealTimeSearch` inside `perplexity.js`:

```javascript
// REMOVE THIS — it routes every single user through Perplexity unconditionally:
return { needed: true, reason: 'seyi' };
```

Every user is hitting the Perplexity API on every opportunity refresh regardless of whether real-time search is warranted. This is burning real API budget right now. The `computeIntelNeeded` heuristic in `opportunities.js` already handles smart routing — `needsRealTimeSearch` just needs to stop overriding it.

---

**Fix 2 — Issue 23 (CRITICAL — silent data loss):**

In `perplexity.js` line 476, change:

```javascript
// WRONG — queries is undefined in this scope; always evaluates to 0
if (i >= queries.length - 1) { ... }

// CORRECT
if (i >= queryConfigs.length - 1) { ... }
```

Every successful Perplexity search run is currently crashing before returning results. The system silently discards real discovered leads and falls back to practice examples. Users see fabricated data instead of real opportunities. This has been shipping silently since `queryConfigs` was introduced.

---

**Fix 3 — Issue 6 (HIGH — UX regression):**

In `GET /api/opportunities`, the `runOpportunitiesRefreshForUser` call must be fire-and-forget. The current code `await`s it, which blocks the entire first page load for the duration of the discovery pipeline (up to 30–60 seconds on cold start):

```javascript
// WRONG — blocks the response
await runOpportunitiesRefreshForUser(userId, req.user);

// CORRECT — fire-and-forget; response returns immediately
runOpportunitiesRefreshForUser(userId, req.user)
  .catch(err => logError('LIST auto-refresh', err, { userId }));
```

Note: the current codebase already has this fix applied correctly (using `.catch()` without `await`). Confirm this is not regressed during any refactor.

---

# PART 4 — PERMISSIONS & ACCESS CONTROL (Deep Dive)

This section defines the complete access control model for FounderSales as a multi-user team platform. It covers role definitions, per-resource permission matrices, visibility override mechanics, concurrent edit conflict resolution, and the audit trail for permission bypasses.

---

## 4.1 — Role Hierarchy

Roles are hierarchical: each role inherits all permissions of roles below it.

```
Owner
  └─ Admin
       └─ Manager
            └─ Member
                 └─ Viewer
```

| Role | Description |
|---|---|
| **Owner** | Workspace creator. Has all permissions. Cannot be removed from the workspace. Can transfer ownership. |
| **Admin** | Full administrative access. Can manage billing, roles, and all workspace settings. Cannot remove the Owner. |
| **Manager** | Team lead. Can view all team data, assign leads, create challenges, view coaching analytics. Cannot change billing. |
| **Member** | Standard sales rep. Full access to own data. Limited team visibility based on workspace settings. |
| **Viewer** | Read-only access to permitted data. Cannot create, edit, or delete any records. Useful for executives and auditors. |

---

## 4.2 — Permission Namespace

Permissions follow a `resource.action` namespace. A member's effective permissions are the union of their role's default permissions and any overrides stored in `workspace_members.permissions` (JSONB).

```javascript
// Core permission checks used by requirePermission middleware
const ROLE_PERMISSIONS = {
  owner:   ['*'],  // Wildcard — all permissions
  admin:   ['*'],
  manager: [
    'opportunities.view_team', 'opportunities.assign', 'opportunities.delete',
    'pipeline.view_team', 'pipeline.assign_leads',
    'prospects.view_all', 'prospects.edit_team', 'prospects.transfer', 'prospects.merge', 'prospects.delete',
    'metrics.view_team', 'analytics.view_team',
    'insights.view_team',
    'practice.manage_scenarios', 'practice.create_challenge',
    'goals.view_team_goals', 'goals.assign',
    'commitments.view_team',
    'followup.view_team',
    'workspace.invite', 'workspace.view_activity',
    'calendar.view_team',
  ],
  member: [
    'opportunities.view_own', 'opportunities.create', 'opportunities.refresh_feed',
    'pipeline.view_own',
    'prospects.view_own', 'prospects.create', 'prospects.edit_own',
    'practice.start', 'practice.complete',
    'goals.create_personal', 'goals.edit_own',
    'chat.create', 'chat.view_own',
    'calendar.create', 'calendar.edit_own',
    'feedback.submit',
    'commitments.view_own', 'commitments.update_own',
  ],
  viewer: [
    'opportunities.view_own',
    'pipeline.view_own',
    'prospects.view_own',
    'metrics.view_own',
  ],
};
```

**Per-user overrides:** The `workspace_members.permissions` JSONB field stores additive grants or explicit denials for individual users:

```json
{
  "grants": ["opportunities.view_team"],
  "denials": ["pipeline.assign_leads"]
}
```

**Effective permission check:**

```javascript
const hasPermission = (membership, permission) => {
  const rolePerms = ROLE_PERMISSIONS[membership.role] || [];

  // Owner and Admin have wildcard
  if (rolePerms.includes('*')) return true;

  // Check explicit denials first (denials override role defaults)
  const denials = membership.permissions?.denials || [];
  if (denials.includes(permission)) return false;

  // Check explicit grants (extends role defaults)
  const grants = membership.permissions?.grants || [];
  if (grants.includes(permission)) return true;

  // Fall through to role defaults
  return rolePerms.includes(permission);
};
```

---

## 4.3 — Visibility Model

Every major entity has a `visibility` field that controls which workspace members can see it, independent of role.

```
private       → Only the creator/owner (and managers/admins)
assigned_only → The assigned_to member and managers/admins
workspace     → All active workspace members
```

**Visibility resolution logic (applied in every GET query):**

```javascript
const buildVisibilityFilter = (userId, membership) => {
  if (['owner', 'admin', 'manager'].includes(membership.role)) {
    // Managers+ see everything in the workspace — no visibility filter
    return null;
  }

  // Members/Viewers: see workspace-wide records OR records they own/are assigned
  return `visibility.eq.workspace,and(visibility.eq.private,created_by.eq.${userId}),and(visibility.eq.assigned_only,assigned_to.eq.${userId})`;
};
```

**Practical query example (opportunities):**

```javascript
let query = supabase
  .from('opportunities')
  .select('*')
  .eq('workspace_id', req.workspace.id);

const visFilter = buildVisibilityFilter(req.user.id, req.membership);
if (visFilter) {
  query = query.or(visFilter);
}
```

---

## 4.4 — Role-by-Resource Permission Matrices

### Workspace Management

| Action | Viewer | Member | Manager | Admin | Owner |
|---|---|---|---|---|---|
| View workspace settings | ❌ | ❌ | ✅ (read-only) | ✅ | ✅ |
| Edit workspace settings | ❌ | ❌ | ❌ | ✅ | ✅ |
| Invite members | ❌ | ❌ | ✅ | ✅ | ✅ |
| Remove members | ❌ | ❌ | Member only | Admin/Member | ✅ |
| Change member roles | ❌ | ❌ | ❌ | ✅ (below admin) | ✅ |
| View activity feed | ❌ | ❌ | ✅ | ✅ | ✅ |
| Manage billing | ❌ | ❌ | ❌ | ✅ | ✅ |
| Delete workspace | ❌ | ❌ | ❌ | ❌ | ✅ |
| Transfer ownership | ❌ | ❌ | ❌ | ❌ | ✅ |

### Opportunities

| Action | Viewer | Member | Manager | Admin/Owner |
|---|---|---|---|---|
| View own | ✅ | ✅ | ✅ | ✅ |
| View team | ❌ | ⚙️ (override) | ✅ | ✅ |
| Create | ❌ | ✅ | ✅ | ✅ |
| Refresh feed | ❌ | ✅ | ✅ | ✅ |
| Assign | ❌ | ❌ | ✅ | ✅ |
| Delete | ❌ | ❌ | ✅ | ✅ |

### Prospects

| Action | Viewer | Member | Manager | Admin/Owner |
|---|---|---|---|---|
| View own | ✅ | ✅ | ✅ | ✅ |
| View all | ❌ | ⚙️ (override) | ✅ | ✅ |
| Create | ❌ | ✅ | ✅ | ✅ |
| Edit own | ❌ | ✅ | ✅ | ✅ |
| Edit any | ❌ | ❌ | ✅ | ✅ |
| Transfer | ❌ | ❌ | ✅ | ✅ |
| Merge | ❌ | ❌ | ✅ | ✅ |
| Hard delete | ❌ | ❌ | ❌ | ✅ |

*⚙️ = configurable via workspace settings or per-user permission override*

---

## 4.5 — Concurrent Edit Conflict Resolution

When two users simultaneously edit or assign the same resource, the system uses **optimistic locking via `updated_at` timestamp comparison** rather than pessimistic database-level locking.

**Pattern — optimistic locking on PUT /:id:**

```javascript
router.put('/:id', asyncHandler(async (req, res) => {
  const { last_known_updated_at, ...fields } = req.body;

  if (!last_known_updated_at) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'last_known_updated_at is required for edit operations',
    });
  }

  // Attempt update only if record hasn't changed since the client loaded it
  const { data, error } = await supabase
    .from('prospects')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('workspace_id', req.workspace.id)
    .eq('updated_at', last_known_updated_at)  // Optimistic lock condition
    .select()
    .single();

  if (!data) {
    // Record was modified by someone else since client loaded it
    const { data: current } = await supabase
      .from('prospects')
      .select('*, updated_by_user:users(name)')
      .eq('id', req.params.id)
      .single();

    return res.status(409).json({
      error: 'EDIT_CONFLICT',
      message: 'This record was modified by another team member while you were editing.',
      current_record: current,
      your_changes:   fields,
    });
  }

  res.json({ prospect: data });
}));
```

**Frontend handling of 409 EDIT_CONFLICT:** The UI presents a side-by-side diff showing "Your version" vs "Current version" and lets the user choose to: (a) overwrite with their changes, (b) discard their changes and use the current version, or (c) manually merge field by field.

**Assignment conflicts — lead claiming:**

When two managers simultaneously assign the same lead, the last-write-wins by default. To prevent this, the assignment endpoint uses a check-and-set pattern:

```javascript
// Only assign if currently unassigned OR assigned_to hasn't changed since client loaded
const { data: current } = await supabase
  .from('opportunities')
  .select('assigned_to')
  .eq('id', req.params.id)
  .single();

if (current.assigned_to && current.assigned_to !== expected_assigned_to) {
  return res.status(409).json({
    error: 'ASSIGNMENT_CONFLICT',
    message: 'This lead was already assigned to another rep.',
    assigned_to: current.assigned_to,
  });
}
```

---

## 4.6 — Manager Viewing Private Data: Audit Trail

Managers have visibility into data that members have marked private (e.g., `visibility = 'private'` prospects, individual chat transcripts with `is_team_visible = false`, debrief content). Every time a manager accesses a record outside the owner's intended visibility, an audit entry is written.

```sql
permission_audit_log
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid()
  workspace_id     UUID REFERENCES workspaces(id) NOT NULL
  actor_user_id    UUID REFERENCES users(id) NOT NULL    -- who accessed it
  actor_role       TEXT NOT NULL                         -- their role at time of access
  target_user_id   UUID REFERENCES users(id)             -- whose data was accessed
  resource_type    TEXT NOT NULL                         -- 'prospect' | 'chat' | 'calendar_event' etc.
  resource_id      UUID NOT NULL
  access_type      TEXT NOT NULL                         -- 'view_private' | 'view_team' | 'edit_override'
  reason           TEXT                                  -- optional manager-provided reason
  created_at       TIMESTAMPTZ DEFAULT now()

  INDEX (workspace_id, target_user_id, created_at DESC)
  INDEX (workspace_id, actor_user_id, created_at DESC)
```

**Write pattern — non-blocking:**

```javascript
// Called inside manager-only paths that access private member data
const auditManagerAccess = (req, resourceType, resourceId, targetUserId) => {
  supabaseAdmin.from('permission_audit_log').insert({
    workspace_id:   req.workspace.id,
    actor_user_id:  req.user.id,
    actor_role:     req.membership.role,
    target_user_id: targetUserId,
    resource_type:  resourceType,
    resource_id:    resourceId,
    access_type:    'view_private',
  }).then(() => {}).catch(err => logError('permission_audit insert', err));
};
```

**Accessible to:** Owners and Admins only via `GET /api/workspaces/:id/audit-log`. Managers cannot see their own audit entries — this prevents managers from knowing whether their activity is being tracked and maintains oversight integrity.

---

## 4.7 — Edge Cases and Special Scenarios

**Scenario 1 — Member leaves workspace mid-session:**

If a member's `workspace_members.status` changes to `suspended` or the record is deleted while they have an active session, all subsequent API calls return `403 WORKSPACE_ACCESS_REVOKED`. Their existing data (prospects, opportunities) is NOT deleted — it remains in the workspace with `created_by` preserved for the manager.

```javascript
// In resolveWorkspace middleware — checked on every request
if (!membership || membership.status !== 'active') {
  return res.status(403).json({
    error:   'WORKSPACE_ACCESS_REVOKED',
    message: 'Your access to this workspace has been revoked.',
  });
}
```

**Scenario 2 — Ownership transfer of a workspace:**

Only the current Owner can transfer ownership. The transfer:
1. Changes the target user's role to `owner`
2. Demotes the current owner to `admin`
3. Updates `workspaces.owner_user_id`
4. Writes a `workspace_activity` record: "Alex transferred ownership to Jordan"
5. Sends an email notification to both parties

**Scenario 3 — Role downgrade (admin → member):**

If an Admin is downgraded to Member while they have active sessions, the next API request picks up the new role via `resolveWorkspace`. Any data they created while Admin remains accessible to the team. Their personal data visibility reverts to member-level immediately.

**Scenario 4 — Prospect visibility conflict:**

A member creates a prospect with `visibility = 'private'`. A manager views it (access is permitted by role). Later, the member transfers relationship ownership to a different member. The new owner has edit access. The original creator retains view access. The `permission_audit_log` captures the manager's view event.

**Scenario 5 — Invitation to a second workspace:**

A user with an existing personal workspace is invited to join a team workspace. On accepting the invite:
1. A new `workspace_members` record is created with the invited role
2. A new `workspace_profiles` record is created for that workspace (blank until onboarding)
3. Their `active_workspace_id` is updated to the team workspace
4. Abbreviated onboarding runs: skip personal questions, answer product/ICP questions in the context of the new workspace

---

# PART 5 — MIDDLEWARE ARCHITECTURE: WORKSPACE RESOLUTION

The `resolveWorkspace` middleware is the keystone of the multi-tenant architecture. It runs after `authenticate` on every protected route and attaches `req.workspace` and `req.membership` to the request object. All downstream route handlers read from these two objects rather than querying workspace membership themselves.

## 5.1 — Middleware Registration Pattern

```javascript
// src/app.js — Updated protected route registration
// Every route after this comment is workspace-aware:
// req.workspace  = { id, name, slug, plan, settings }
// req.membership = { role, permissions, status, user_id }

app.use('/api/opportunities', authenticate, resolveWorkspace, opportunitiesRoutes);
app.use('/api/pipeline',      authenticate, resolveWorkspace, pipelineRoutes);
app.use('/api/prospects',     authenticate, resolveWorkspace, prospectsRoutes);
app.use('/api/commitments',   authenticate, resolveWorkspace, commitmentsRoutes);
app.use('/api/insights',      authenticate, resolveWorkspace, insightsRoutes);
app.use('/api/metrics',       authenticate, resolveWorkspace, metricsRoutes);
app.use('/api/calendar',      authenticate, resolveWorkspace, calendarRoutes);
app.use('/api/practice',      authenticate, resolveWorkspace, practiceRoutes);
app.use('/api/growth',        authenticate, resolveWorkspace, growthRoutes);
app.use('/api/growth/goals',  authenticate, resolveWorkspace, goalsRoutes);
app.use('/api/feedback',      authenticate, resolveWorkspace, feedbackRoutes);
app.use('/api/followup',      authenticate, resolveWorkspace, followupRoutes);
app.use('/api/chat',          authenticate, resolveWorkspace, aiRateLimiter, chatRoutes);
app.use('/api/user',          authenticate, userRoutes);       // No resolveWorkspace — user routes are global
app.use('/api/onboarding',    authenticate, resolveWorkspace, onboardingRoutes);

// Workspace management routes (no resolveWorkspace — they manage workspace state)
app.use('/api/workspaces',    authenticate, workspacesRoutes);
```

## 5.2 — resolveWorkspace Implementation

```javascript
// src/middleware/resolveWorkspace.js
import supabaseAdmin from '../config/supabase.js';

const workspaceCache = new Map(); // { workspaceId+userId → { workspace, membership, cachedAt } }
const WORKSPACE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const resolveWorkspace = async (req, res, next) => {
  const userId = req.user.id;

  // Workspace can be specified by header or falls back to active_workspace_id
  const workspaceId =
    req.headers['x-workspace-id'] ||
    req.user.active_workspace_id;

  if (!workspaceId) {
    return res.status(400).json({
      error:   'NO_WORKSPACE',
      message: 'No active workspace. Please complete onboarding or switch workspace.',
    });
  }

  // Cache check
  const cacheKey = `${workspaceId}:${userId}`;
  const cached = workspaceCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < WORKSPACE_CACHE_TTL) {
    req.workspace  = cached.workspace;
    req.membership = cached.membership;
    return next();
  }

  const { data, error } = await supabaseAdmin
    .from('workspace_members')
    .select(`
      role, status, permissions,
      workspace:workspaces(id, name, slug, plan, settings, is_deleted)
    `)
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    return res.status(403).json({
      error:   'WORKSPACE_ACCESS_DENIED',
      message: 'You do not have access to this workspace.',
    });
  }

  if (data.workspace.is_deleted) {
    return res.status(410).json({
      error:   'WORKSPACE_DELETED',
      message: 'This workspace has been deleted.',
    });
  }

  if (data.status !== 'active') {
    return res.status(403).json({
      error:   'WORKSPACE_ACCESS_REVOKED',
      message: 'Your access to this workspace has been revoked.',
    });
  }

  req.workspace  = data.workspace;
  req.membership = { role: data.role, status: data.status, permissions: data.permissions, user_id: userId };

  workspaceCache.set(cacheKey, {
    workspace:  req.workspace,
    membership: req.membership,
    cachedAt:   Date.now(),
  });

  next();
};
```

## 5.3 — requirePermission Middleware

```javascript
// src/middleware/requirePermission.js
import { hasPermission } from '../utils/permissions.js';

export const requirePermission = (permission) => (req, res, next) => {
  if (!req.membership) {
    return res.status(500).json({ error: 'MIDDLEWARE_ORDER_ERROR', message: 'resolveWorkspace must run before requirePermission' });
  }

  if (!hasPermission(req.membership, permission)) {
    return res.status(403).json({
      error:      'PERMISSION_DENIED',
      message:    `You do not have permission to perform this action.`,
      required:   permission,
      your_role:  req.membership.role,
    });
  }

  next();
};

// Usage in route files:
// router.get('/workspace/leaderboard',
//   requirePermission('analytics.view_team'),
//   asyncHandler(async (req, res) => { ... })
// );
```

---

# PART 6 — NEW ENTERPRISE-VALUE ENDPOINTS

These are the endpoints that elevate FounderSales from "individual productivity tool" to "sales team operating system." Each cluster is a named feature that commands premium pricing and drives manager-led renewals.

---

## 6.1 — Workspace Management

```
POST   /api/workspaces
  — Create new workspace
  — Body: { name, slug? }
  — Automatically creates the creator as owner + provisions workspace_profile

GET    /api/workspaces/:id/members
  — List all members with their roles, status, and join dates
  — Requires workspace.view_members (manager+)

POST   /api/workspaces/:id/invite
  — Invite a user by email with a specified role
  — Body: { email, role: 'member' | 'viewer' | 'manager' }
  — Creates a pending_invite workspace_member record + sends invitation email
  — Requires workspace.invite permission

PUT    /api/workspaces/:id/members/:userId
  — Update a member's role or permissions
  — Body: { role?, permissions?: { grants: [], denials: [] } }
  — Cannot escalate to a role higher than your own
  — Requires admin+

DELETE /api/workspaces/:id/members/:userId
  — Remove a member from the workspace (does NOT delete their data)
  — Soft-deletes their workspace_member record (status = 'removed')
  — Their created records remain, with created_by preserved
  — Requires admin+ (managers can only remove members, not other managers)

GET    /api/workspaces/:id/activity
  — Manager's real-time activity feed
  — Paginated: ?limit=50&before=timestamp
  — Filterable: ?actor_id=uuid, ?entity_type=opportunity|prospect|pipeline_card
  — Requires workspace.view_activity permission
```

---

## 6.2 — Team Analytics (Manager-Only — Enterprise Upsell)

These endpoints are the primary driver of enterprise subscription value. A VP of Sales demos these to justify the budget.

```
GET /api/metrics/workspace/leaderboard
  — Members ranked by sent count, reply rate, and composite message score
  — Response includes rank delta (up/down since last period)
  — Parameters: ?period=7d|30d|all_time, ?sort=sent|reply_rate|score|composite
  — Requires analytics.view_team

GET /api/metrics/workspace/coaching-queue
  — Members automatically flagged for attention based on:
      · No practice in 7+ days
      · Reply rate below workspace average by >15%
      · No outreach sent in 5+ days
      · Skill score declining for 2+ consecutive weeks
  — Each flagged member includes the specific reason and recommended action
  — Requires analytics.view_team

GET /api/metrics/workspace/team-velocity
  — Week-over-week momentum delta for the full team
  — Metrics: sent count, reply count, pipeline stage moves, practice sessions
  — Trend direction: ↑ improving | ↓ declining | → stable
  — Requires analytics.view_team

GET /api/insights/workspace/why-losing
  — Aggregated loss pattern analysis across all team members' conversation analyses
  — Input: failure categories from all conversation_analyses (last 30d)
  — Output: ranked list of top team failure modes with frequency percentages
  — This is the feature a VP of Sales will show in a board deck
  — Requires analytics.view_team

GET /api/insights/workspace/skill-matrix
  — Heat map: skill dimensions (hook, personalization, clarity, CTA, social proof, urgency)
    vs. team members
  — Shows exactly which rep needs coaching on which specific skill
  — Color-coded: green (strong) → red (needs work)
  — Requires analytics.view_team
```

---

## 6.3 — Team Pipeline

```
GET /api/pipeline/workspace/overview
  — Full workspace pipeline health for managers
  — Per-stage totals: card count, deal value sum, avg days-in-stage
  — Stale card alerts: cards with no stage movement in 7+ days
  — Requires pipeline.view_team

GET /api/pipeline/workspace/by-member
  — All pipeline cards grouped by assigned_to member
  — Each member bucket shows: card count, total deal value, oldest card age
  — Powers the manager's rep-by-rep pipeline accountability view
  — Requires pipeline.view_team

POST /api/opportunities/:id/assign
  — Assign or reassign a lead to a workspace member
  — Body: { assignee_id: UUID, note?: string }
  — Writes workspace_activity + fires push notification to assignee
  — Requires pipeline.assign_leads (manager+)
```

---

## 6.4 — Team Practice

```
GET /api/practice/workspace/leaderboard
  — Weekly and all-time practice scores across the workspace
  — Ranked by composite score with scenario breakdowns
  — Parameters: ?period=7d|30d|all_time, ?scenario_type=all|cold_outreach|...
  — Requires analytics.view_team

POST /api/practice/workspace/challenge
  — Manager creates a team practice challenge with a deadline
  — Body: { scenario_type, buyer_profile, title, description, due_date, assigned_to[] }
  — Creates a team_challenges record + fires push notifications to assigned members
  — On completion, scores auto-submit to the challenge leaderboard
  — Requires practice.create_challenge (manager+)

GET /api/practice/workspace/challenge/:id
  — Challenge details, current leaderboard, participant completion status
  — Includes AI-generated coaching summary based on all submissions
  — Requires analytics.view_team

GET /api/practice/workspace/coverage
  — Scenario coverage matrix: which scenarios each member has practiced, best scores
  — Gap identification: "3 members have never practiced Cold Outreach"
  — Requires analytics.view_team

POST /api/practice/workspace/scenarios
  — Manager creates a custom practice scenario for the workspace
  — Body: { title, scenario_type, custom_prompt, buyer_profile, difficulty }
  — Appears in all members' scenario list with a "Team" badge
  — Requires practice.manage_scenarios (manager+)
```

---

## 6.5 — Prospect CRM (Team Layer)

```
POST /api/prospects/:id/transfer
  — Transfer relationship ownership to another workspace member
  — Body: { new_owner_id: UUID, handoff_note: string (min 20 chars) }
  — Requires handoff_note — forces context capture, preserves institutional knowledge
  — Writes workspace_activity + fires push notification to new owner
  — Requires manager+ OR being the current relationship_owner

GET /api/prospects/workspace/accounts
  — Account-level grouping of all prospects in the workspace
  — Each account shows: all associated contacts, recent activity, health score avg
  — Powers the company-level CRM view (Salesforce-style accounts)
  — Requires prospects.view_all

POST /api/prospects/merge
  — Merge two duplicate prospect records (irreversible within 30d)
  — Body: { primary_id, secondary_id, field_choices }
  — All related records (events, chats, signals, commitments) re-parented to primary
  — Writes audit trail + workspace_activity
  — Requires manager+
```

---

## 6.6 — Commitment Oversight

```
GET /api/commitments/workspace/overview
  — All pending and overdue commitments grouped by workspace member
  — Per-member counts: open, overdue, due-this-week
  — Reveals which reps are dropping follow-through balls
  — Sortable by: most overdue | most open | member name
  — Requires analytics.view_team

GET /api/followup/workspace/health
  — Team follow-up health dashboard:
      · Total follow-ups pending across workspace
      · Follow-ups sitting unacted for 48+ hours
      · Per-member neglect count and last action date
  — Primary coaching signal for follow-up discipline
  — Requires analytics.view_team
```

---

# PART 7 — ROADMAP: SEQUENCED FOR MAXIMUM IMPACT

The sequencing below prioritizes features that unblock manager adoption first, because managers drive enterprise renewals. Features are grouped by value tier.

---

## Tier 1 — Unlock Manager Adoption (Build First)

These four capabilities turn a manager from a passive observer into an active platform user. Without them, there is no enterprise customer — there are only individual subscribers.

**1. Workspace Activity Feed (`GET /api/workspaces/:id/activity`)**

The activity feed is the single most important feature for manager retention. Managers need to see in real time: what messages their reps sent, which leads were assigned, what outcomes were logged, which commitments were completed. Without it, the manager has no visibility and no reason to pay for a team plan. Build this before anything else.

**2. Manager Dashboard Endpoints (Leaderboard + Coaching Queue + Team Velocity)**

Build `GET /api/metrics/workspace/leaderboard`, `GET /api/metrics/workspace/coaching-queue`, and `GET /api/metrics/workspace/team-velocity` together — they form the core of the manager dashboard and are likely to share underlying query logic. These are the features a VP of Sales demos when justifying the subscription to their CFO.

**3. Why-Losing Workspace Aggregate (`GET /api/insights/workspace/why-losing`)**

Running cross-rep pattern detection to surface the team's top failure modes is a unique capability that no CRM currently provides. A VP of Sales can act on this immediately — schedule a team training session, create a practice challenge targeting the top failure mode. This is the insight that justifies the enterprise price point in a single meeting.

**4. Workspace Invite + Role Management (`POST /api/workspaces/:id/invite`, `PUT /api/workspaces/:id/members/:userId`)**

Without member management, there is no team. These endpoints are the prerequisite for all other team features. Without invite flows, the manager cannot onboard their reps.

---

## Tier 2 — Drive Engagement and Daily Return

These features drive daily active usage across all team members, not just managers.

**5. Team Practice Challenges + Leaderboards**

Practice leaderboards are the fastest mechanism for driving product-led engagement in a team. A manager who creates a challenge guarantees that every assigned member opens the app before the deadline. Leaderboards create voluntary daily return even without manager involvement. Build `POST /api/practice/workspace/challenge` and `GET /api/practice/workspace/leaderboard` as a pair.

**6. Skill Matrix Heat Map (`GET /api/insights/workspace/skill-matrix`)**

The skill matrix gives managers surgical precision for coaching — instead of "Jordan needs to get better," it becomes "Jordan specifically struggles with CTAs and social proof in cold outreach." This transforms the coaching queue from a list of names into an actionable to-do list.

**7. Prospect Transfer + Ownership Handoff (`POST /api/prospects/:id/transfer`)**

In any real sales team, leads change hands. Without a formal transfer mechanism, handoffs happen in Slack, context is lost, and the new rep starts from zero. The required `handoff_note` makes the system force context capture — a behavior change that the platform enforces at the infrastructure level.

**8. Deal Win Announcements (Feedback → Workspace Feed)**

When a rep marks a deal `CLOSED_WON`, automatically generating a workspace announcement card that surfaces in every team member's feed creates positive social reinforcement. The whole team learns from what worked. This is a two-hour implementation with outsized engagement impact.

---

## Tier 3 — Enterprise Defensibility

These features create switching costs and deepen the platform's institutional value.

**9. Workspace Memory**

The `workspace_memory` table allows managers to inject institutional knowledge into every AI interaction. "Your team has found that CFOs at mid-market companies respond well to compliance angles" is the kind of context that makes the AI genuinely useful for the specific team rather than generically helpful. This is not replaceable by an individual tool — it requires the team to have been using the platform long enough to accumulate institutional knowledge. That accumulated knowledge becomes a moat.

**10. Duplicate Resolution + Prospect Merge**

A team CRM that silently accumulates duplicate records loses trust and gets abandoned. The detection, warning, and merge workflow described in Section 2.6.A is the difference between a CRM that teams trust and one that creates more problems than it solves. This is table stakes for enterprise adoption.

**11. Account-Level Grouping (`GET /api/prospects/workspace/accounts`)**

Company-level account records that aggregate all contacts and interactions from all reps is the feature that makes FounderSales competitive with Salesforce for SMB teams. A manager who can see every interaction their team has had with Acme Corp in one view — across all reps, all touchpoints — has a tool they cannot get from a collection of individual productivity apps.

**12. Commitment Oversight + Follow-Up Health**

The coaching queue identifies who needs help. The commitment overview and follow-up health endpoints reveal exactly what they're dropping — which specific commitments are overdue, which follow-ups are being ignored. This combination transforms coaching from a subjective conversation ("you seem disengaged lately") into an evidence-based one ("you have 7 overdue commitments and haven't acted on a follow-up in 9 days").

---

# PART 8 — INVESTOR PERSPECTIVE: WHAT MAKES THIS $50K ARR PER ENTERPRISE CUSTOMER

The architecture described in this document is technically clean and the existing codebase is structurally sound. The gap between the current state and the price point where enterprise buyers write checks is narrow but specific. Here are the five features that close it:

---

**1. The Workspace Activity Feed**

Managers want to see in real time: what messages their reps sent, which leads were assigned, what outcomes were logged, what commitments were created or completed. This is the feature that makes a manager renew — not cancel. Without it, the manager has no stake in the platform. With it, the manager becomes the platform's internal advocate who fights to justify the budget at renewal time. Every B2B SaaS company with a manager-level buyer has this feature. It is not optional at the enterprise tier.

**2. The Why-Losing Workspace Aggregate**

Running pattern detection across every rep's conversation analyses to surface the team's top failure modes is a unique insight that no CRM currently provides. Salesforce tells a manager how many deals were lost. FounderSales tells them *why* — across the entire team, with frequency data, ranked by impact. A VP of Sales who sees this for the first time in a demo immediately understands the ROI: if the team's top failure mode is a weak CTA (47% of lost conversations), and fixing it improves reply rate by 5 points, the math writes itself. This is the feature that closes enterprise deals in demos.

**3. The Coaching Queue**

Automatically surfacing which reps haven't practiced in 7 days, whose reply rates are declining, and whose skill scores are trending down — all in one manager view — transforms FounderSales from a productivity tool into a coaching platform. The distinction matters because coaching platforms command 3–5x the price of productivity tools. Managers don't need another dashboard; they need a system that tells them what to do next. The coaching queue does that.

**4. Team Challenges and Practice Leaderboards**

Practice leaderboards are the fastest mechanism for driving product-led engagement across an entire team. A manager who creates a challenge guarantees that every assigned team member opens the app before the deadline — daily active usage that costs nothing in sales or marketing spend. Leaderboards create voluntary daily return even without manager involvement. For a platform monetized on per-seat pricing, daily active usage is the metric that justifies seat count at renewal.

**5. Workspace-Level Memory**

The AI coach referencing institutional workspace knowledge — "Your team has found that CFOs at mid-market companies respond well to compliance angles" — creates a product experience that no individual tool can replicate. Individual tools start from zero for every user. A team platform accumulates context over time, and that accumulated context becomes a switching cost. After 90 days of use, the workspace memory is unique to that team. It cannot be exported to a competitor. That is defensibility — and defensibility is what turns $20/month individual subscriptions into $50K/year enterprise contracts.

---

**The architecture described in Parts 2–7 delivers on all five.** The immediate hotfixes in Part 3 remove active cost leakage before multi-tenant work begins. The migration strategy in Section 2.18 provides a safe, reversible path to team-ready infrastructure. The permissions model in Part 4 is enterprise-grade from day one.

---

*END OF DOCUMENT — Version 3.0*
*Companion: Part 1 — System Audit (separate file)*
