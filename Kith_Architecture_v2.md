# Kith — Implementation-Grade Technical Architecture Specification
### Version 2.0 | Phase 1 Build Blueprint
**Classification: Internal Engineering Reference**

---

> **Read Before Implementing**
> This document is the authoritative source for Kith's Phase 1 system design.
> It supersedes all previous architecture documents.
> Every section is written to be directly actionable by an implementing engineer or AI code generator.
> Where a decision has been deferred, it is explicitly noted and the hook for future addition is defined.

---

## TABLE OF CONTENTS

- [Part 1: System Overview](#part-1-system-overview)
- [Part 2: Frontend System Blueprint](#part-2-frontend-system-blueprint)
- [Part 3: Domain Model + Database Design](#part-3-domain-model--database-design)
- [Part 4: Complete API Architecture](#part-4-complete-api-architecture)
- [Part 5: Container System — Events + Recurring](#part-5-container-system)
- [Part 6: Notification System](#part-6-notification-system)
- [Part 7: Async Jobs — BullMQ + Redis](#part-7-async-jobs)
- [Part 8: Authorization + Restrictions](#part-8-authorization--restrictions)
- [Part 9: Observability + Operations](#part-9-observability--operations)
- [Part 10: Future Extensibility](#part-10-future-extensibility)

---

## PART 1: SYSTEM OVERVIEW

### 1.1 — App Purpose

Kith is a web-based Progressive Web App (PWA) that helps extended diaspora families coordinate shared obligations across borders. The core use case is a family organizer — typically based in the UK, USA, or Canada — who manages a combination of:

- **Financial contributions** to events and ongoing pools
- **Task assignments** for event coordination
- **Document storage** for family records
- **Family directory** with rich member profiles

The primary wedge is financial coordination for events (weddings, funerals, naming ceremonies) and recurring pools (monthly parent support, school fees, village dues). The secondary wedge is the document vault. Together these create irreplaceable institutional memory.

**Kith is not:** a messaging app, a social network, a payment processor, or an anonymous feedback tool.

---

### 1.2 — Bounded Contexts

Kith is divided into six bounded contexts. Each context owns its data. Interactions between contexts happen through well-defined interfaces, not direct table joins across context boundaries.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         KITH BOUNDED CONTEXTS                       │
├──────────────────────┬──────────────────────┬───────────────────────┤
│   IDENTITY           │   WORKSPACE          │   CONTAINERS          │
│   ──────────         │   ─────────          │   ──────────          │
│   Users              │   Workspaces         │   Events (one-time)   │
│   Auth sessions      │   Members            │   Recurring pools     │
│   User contacts      │   Groups             │   Cycles              │
│   User preferences   │   Settings           │   Participants        │
│                      │   Invite links       │   Tasks               │
├──────────────────────┼──────────────────────┼───────────────────────┤
│   FINANCE            │   DOCUMENTS          │   NOTIFICATIONS       │
│   ──────────         │   ─────────          │   ─────────────       │
│   Ledger entries     │   Documents          │   In-app records      │
│   Contributor        │   Access control     │   Delivery log        │
│   targets            │   Access log         │   Preferences         │
│   Disputes           │   Milestones         │   Templates           │
│   Exchange rates     │                      │                       │
└──────────────────────┴──────────────────────┴───────────────────────┘
```

---

### 1.3 — High-Level Component Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                                    │
│   React PWA  ──  Service Worker  ──  Firebase SDK (push)               │
│   React Query (server state)  ──  Zustand (global app state)           │
└────────────────────────────┬───────────────────────────────────────────┘
                             │ HTTPS REST — Bearer JWT
┌────────────────────────────▼───────────────────────────────────────────┐
│                        API LAYER (Node.js / Express)                   │
│   Auth Middleware  ─  Workspace Middleware  ─  Role Middleware          │
│   Controllers  ─  Services  ─  Validators (Zod)                        │
│   Upload Handler  ─  Signed URL Generator                              │
└────────┬──────────────────────┬────────────────────┬───────────────────┘
         │                      │                    │
┌────────▼────────┐  ┌──────────▼──────────┐  ┌─────▼──────────────────┐
│  Supabase Auth  │  │  Supabase Postgres   │  │  Supabase Storage      │
│  (JWT issuer)   │  │  (RLS safety net)    │  │  (documents + proofs)  │
└─────────────────┘  └──────────┬──────────┘  └────────────────────────┘
                                │
┌───────────────────────────────▼────────────────────────────────────────┐
│                     ASYNC LAYER (BullMQ + Redis)                       │
│   notification-queue  ──  cycle-generation-queue                       │
│   reminder-queue  ──  expiry-check-queue  ──  cleanup-queue            │
└───────────────────────────────┬────────────────────────────────────────┘
                                │
┌───────────────────────────────▼────────────────────────────────────────┐
│                  EXTERNAL NOTIFICATION SERVICES                        │
│   Firebase Cloud Messaging (push)  ──  SendGrid/Resend (email)         │
└────────────────────────────────────────────────────────────────────────┘
```

---

### 1.4 — Deployment Architecture Assumptions

**Phase 1 deployment targets:**

| Component | Service | Notes |
|---|---|---|
| Frontend (React PWA) | Vercel or Netlify | Static deployment, CDN-served |
| API Layer (Node.js) | Railway or Render | Single container, horizontal scaling later |
| Database | Supabase hosted Postgres | Managed, includes Auth + Storage + RLS |
| Cache + Queues | Upstash Redis | Managed Redis, BullMQ-compatible |
| Push Notifications | Firebase Cloud Messaging | Free tier sufficient for Phase 1 |
| Email | Resend | Simple API, generous free tier |
| File Storage | Supabase Storage | Included in Supabase plan |

**Environment structure:**
- `development` — local Supabase instance, local Redis
- `staging` — mirrors production, used for QA
- `production` — live

**Environment variables required (minimum):**
```
SUPABASE_URL
SUPABASE_ANON_KEY          (frontend only — auth)
SUPABASE_SERVICE_ROLE_KEY  (backend only — bypasses RLS)
REDIS_URL
JWT_SECRET                 (Supabase JWT secret for backend verification)
FIREBASE_SERVICE_ACCOUNT   (JSON blob for FCM)
RESEND_API_KEY
STORAGE_BUCKET_NAME
API_BASE_URL
FRONTEND_URL
```

---

## PART 2: FRONTEND SYSTEM BLUEPRINT

### 2.1 — Application Shell & Navigation Structure

Kith has two distinct zones: the **public zone** (pre-authentication, including landing and invite preview) and the **app zone** (post-authentication, the React SPA).

**Zone 1 — Public (static pages, not inside React app shell):**
- `/` — Marketing landing page
- `/invite/:token` — Invite preview (React page, but accessible without auth)

**Zone 2 — App Shell (React SPA, all routes require auth except noted):**
```
/auth/signup              → Registration
/auth/signup?invite=TOKEN → Registration with invite context
/auth/login               → Login
/auth/forgot-password     → Password reset

/onboarding/workspace     → First-time workspace creation (post-registration)

/dashboard                → Home — workspace selector or redirect to workspace

/w/:workspaceId/                       → Workspace dashboard
/w/:workspaceId/containers             → All containers (events + recurring)
/w/:workspaceId/containers/new         → Create container (event or recurring)
/w/:workspaceId/containers/:id         → Container detail
/w/:workspaceId/containers/:id/edit    → Edit container
/w/:workspaceId/containers/:id/tasks   → Task board view
/w/:workspaceId/containers/:id/ledger  → Full ledger view
/w/:workspaceId/containers/:id/outcome → Post-completion outcome view

/w/:workspaceId/members                → Member directory
/w/:workspaceId/members/new            → Add member (admin only)
/w/:workspaceId/members/:memberId      → Member profile view
/w/:workspaceId/members/:memberId/edit → Edit member profile

/w/:workspaceId/groups                 → Groups list
/w/:workspaceId/groups/new             → Create group
/w/:workspaceId/groups/:groupId        → Group detail + edit

/w/:workspaceId/documents              → Document vault
/w/:workspaceId/documents/upload       → Upload document
/w/:workspaceId/documents/:docId       → Document detail

/w/:workspaceId/timeline               → Family timeline (events + milestones)

/w/:workspaceId/settings               → Workspace settings (admin only)
/w/:workspaceId/settings/exchange-rates → Exchange rate management

/profile                   → User profile (personal settings)
/notifications             → Notification inbox

/public/event/:publicToken → Public-facing event view (no auth required)
```

---

### 2.2 — Screen Inventory with Responsibilities

#### SCREEN: Landing Page (`/`)

**Purpose:** Convert a skeptical family organizer into a registered user.
**Accessible to:** Everyone (unauthenticated)
**Key elements:**
- Headline, subheading, single CTA
- Two quick-choice options: "Organize an Event" / "Set up a Recurring Pool"
- Short social proof (testimonials from diaspora families)
- No pricing table — just "free to start"

**CTA behavior:** Clicking either option takes user to `/auth/signup` with a query param indicating their intent (e.g., `?intent=event` or `?intent=recurring`). The intent pre-selects the first step in onboarding.

---

#### SCREEN: Registration (`/auth/signup`)

**Purpose:** Create a Kith account.
**Accessible to:** Unauthenticated users
**Fields:** Full name, Email, Password, Country of residence (dropdown)
**UI states:**
- `idle` — Empty form
- `submitting` — Button disabled, spinner
- `email_taken` — Inline error on email field: "An account with this email already exists. Sign in instead?"
- `success` — Redirect to `/onboarding/workspace` (or invite acceptance if `?invite=TOKEN` in URL)

**Role-based difference:** If accessed with `?invite=TOKEN`, show invite context banner above the form: *"Adaeze Okafor has invited you to join The Okafor Family."*

**Endpoint mapping:**
- `POST /auth/register` — creates user profile after Supabase Auth signup
- `POST /invites/:token/accept` — auto-called after registration if invite token present

---

#### SCREEN: Workspace Creation — Onboarding (`/onboarding/workspace`)

**Purpose:** First-time workspace setup. Shown once per user after registration if they have no workspace.
**Fields:**
1. Family name (required)
2. Base currency (dropdown: GBP, USD, CAD, EUR, NGN, KES, GHS, INR, ZAR — diaspora-sorted)

**After submit:** Redirect to `/w/:workspaceId/containers/new?first=true`

**UI states:**
- `idle` — Empty form
- `submitting` — Spinner
- `success` — Brief success toast, then redirect

**Endpoint mapping:** `POST /workspaces`

---

#### SCREEN: Invite Preview (`/invite/:token`)

**Purpose:** Show a non-member what they are being invited to before they commit.
**Accessible to:** Anyone — auth not required
**Content:**
- Inviter name + workspace name
- Active containers summary (name, progress if money enabled)
- "Accept Invite — Create Account" button → `/auth/signup?invite=:token`
- "I already have an account" link → `/auth/login?invite=:token`
- "View public summary" link if event has public link enabled

**UI states:**
- `loading` — Skeleton
- `valid` — Invite content
- `expired` — "This invite link has expired or is no longer valid. Contact [workspace name] for a new link."
- `already_member` — "You're already a member of this workspace."

**Endpoint mapping:** `GET /invites/:token/preview`

---

#### SCREEN: Workspace Dashboard (`/w/:workspaceId/`)

**Purpose:** The home screen. Shows health of the workspace at a glance.
**Layout:**

```
┌─────────────────────────────────────────────────────────────────────┐
│ [Workspace Avatar] The Okafor Family    [🔔 3] [Profile]            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ACTIVE CONTAINERS                          [+ Create New]          │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ Chidi Wedding   │ £4,200 / £8,000  │ 52%  │ [View]           │  │
│  │ Monthly Support │ 5/8 paid         │ Apr  │ [View]           │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  PENDING CONFIRMATIONS (admin only)          (2)                    │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ Uncle Emeka — ₦50,000 — proof uploaded 2h ago     [Confirm]  │  │
│  │ Mama — ₦100,000 — recorded by you                 [Confirm]  │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  RECENT ACTIVITY                                                    │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ • Uncle Emeka uploaded payment proof — 2h ago                │  │
│  │ • Cousin Tolu joined the workspace — yesterday               │  │
│  │ • Wedding container created — 3 days ago                     │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

**UI states per section:**
- Active containers: `loading` (skeleton), `empty` (prompt to create first container), `populated`
- Pending confirmations: `hidden` (non-admins don't see this section), `empty` (no pending items), `populated`
- Recent activity: `loading`, `empty`, `populated` (max 10 items, "View all" link)

**Role-based differences:**
- Admin: sees pending confirmations section, "Create New" button, member engagement hints
- Member: no pending confirmations, no "Create New", limited activity (only events they participate in)

**Endpoint mapping:**
- `GET /workspaces/:id/dashboard` — single composite response with all dashboard data

---

#### SCREEN: Create Container (`/w/:workspaceId/containers/new`)

**Purpose:** Guided flow to create a new event or recurring container.
**This is a multi-step flow within a single page (no separate routes per step).**

**Step 1 — Choose type:**
```
What are you organizing?

[  EVENT  ]                    [  RECURRING  ]
Wedding, funeral, reunion      Monthly support, school fees,
naming ceremony, party         village dues, ongoing pool

Or: [Create a basic container with no tracking]
```

**Step 2 — Name + date:**
- Container name (required)
- Subtitle (optional, free text)
- Date (optional for events, required start date for recurring)
- For recurring: cadence dropdown (Monthly, Quarterly, Yearly, Custom)
- For recurring with custom: "every X days" number input

**Step 3 — What to track:**
```
What do you need to track for this?

☑ Money contributions    (track who pays what)
☑ Tasks & responsibilities  (assign jobs to people)
☐ Just basic details  (no tracking, information only)
```

**Step 4 (if money enabled) — Quick target:**
- Optional budget target amount + currency
- "I'll set this later" link skips this

**After submit:** Redirect to container detail page with onboarding prompt to add participants.

**UI states:** Step progress indicator (not a wizard, just visual feedback). Back button on each step.

**Endpoint mapping:** `POST /workspaces/:id/containers`

---

#### SCREEN: Container Detail (`/w/:workspaceId/containers/:id`)

**Purpose:** The primary working view for a container. This is the most used screen in Kith.

**Layout — three tabs:**
1. **Summary** (default) — Who owes what, progress
2. **Tasks** (if `enable_tasks = true`) — Task board
3. **Ledger** (if `enable_money = true`) — Full transaction log
4. **Notes** — Event notes + outcome (if completed)

**Summary Tab — Admin view:**
```
┌─────────────────────────────────────────────────────────────────────┐
│ Chidi & Ngozi Wedding                            [Edit] [⋮ Menu]    │
│ March 15, 2025                                                      │
├─────────────────────────────────────────────────────────────────────┤
│ Progress: [████████████░░░░░░░] £4,200 / £8,000 (52%)              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ CONTRIBUTORS          Due          Paid        Left      Action    │
│ ──────────────────────────────────────────────────────────────────  │
│ Uncle Emeka (proxy)   ₦50,000      ₦50,000     ₦0        ✓ Paid    │
│ Mama (proxy)          ₦100,000     ₦0          ₦100,000  [Record]  │
│ Cousin Tolu           £200         £200        £0        ✓ Paid    │
│ Aunty Rose            £300         £0          £300      [Remind]  │
│                                                                     │
│  [+ Add Contributor]  [Share Summary]  [Copy Reminder]             │
├─────────────────────────────────────────────────────────────────────┤
│  Awaiting confirmation: 1 entry — [Review]                         │
└─────────────────────────────────────────────────────────────────────┘
```

**Summary Tab — Member view:**
```
Contributors       Status
──────────────────────────────────────────────────
Uncle Emeka        Paid ✓
Mama               Pending
Cousin Tolu        Your contribution: £200 ✓ Paid
Aunty Rose         Pending

Total collected so far: £4,200 of £8,000 target
```
Member sees their own row in full detail. All other rows show name + status only (no amounts).

**Tasks Tab:**
```
TASKS
─────────────────────────────────────────────────────────
□ Pick up the cake    Uncle Emeka    Due Mar 14   [Edit]
□ Catering setup      Mama           Due Mar 14   [Edit]
✓ Guest list          Cousin Tolu    Done Mar 10  [View]
□ Decoration          Aunty Rose     Due Mar 14   [Edit]

[+ Add Task]
```

**Ledger Tab (admin only for full detail):**
- Chronological list of all ledger entries
- Each row: date, contributor name, amount (original + converted), status badge, actions
- Filter bar: All | Confirmed | Pending | Disputed
- Sort: Newest first (default)

**Notes Tab:**
- Free-text event notes field (admin and coordinator can edit)
- Outcome details section (visible once container is completed or at any time)
- Outcome files (upload PDFs, photos — visible to all members)

**Menu actions (⋮):**
- Admin: Edit container, Manage participants, Set exchange rate, Mark complete, Archive, Delete (if empty)
- Member: View only

**UI states:**
- `loading` — Full skeleton
- `empty_participants` — Prompt to add contributors with animation
- `active` — Normal populated view
- `completed` — Banner: "This event was completed on [date]. £8,200 collected." Outcome section visible.
- `archived` — Read-only banner, all actions disabled

**Endpoint mapping:**
- `GET /containers/:id` — container metadata + participant summary
- `GET /containers/:id/summary` — computed who-owes-what (separate endpoint for performance)
- `GET /containers/:id/tasks` — task list
- `GET /containers/:id/ledger` — paginated ledger entries
- `GET /containers/:id/notes` — notes + outcome files

---

#### SCREEN: Record Payment Modal

**Accessible from:** Container summary, admin dashboard pending confirmations
**Purpose:** Record a money contribution entry.

```
Record contribution for Mama

Amount: [ 100,000   ] Currency: [ NGN ▼ ]
Exchange rate: 1,600 per £1 (→ £62.50)  [Override rate]
Date: [ March 15, 2025 ]
Method: [ Cash ▼ ]  (Cash, Bank Transfer, Mobile Money, Other)
Proof: [Upload screenshot — optional]
Note: [__________________] (optional)

[Record Contribution]  [Cancel]
```

**For a member recording their own:**
- Same form but no "on behalf of" header
- Proof upload is prominent (encouraged)
- Entry enters as `status: 'pending'` until admin confirms

**For admin recording on behalf of proxy:**
- Header: "Recording on behalf of Mama"
- Entry enters as `status: 'confirmed'` immediately (admin acts as trusted recorder)

**Endpoint mapping:** `POST /containers/:id/ledger`

---

#### SCREEN: Member Directory (`/w/:workspaceId/members`)

**Purpose:** View and manage all workspace members.
**Layout:**
```
FAMILY MEMBERS                              [Invite Member] [+ Add Proxy]
───────────────────────────────────────────────────────────────────────
[Search: __________]  [Filter: All ▼]

Adaeze Okafor   Admin     London, UK       Last active: Today      [Edit]
Uncle Emeka     Member    Lagos, NG  Proxy  Managed by: Adaeze     [Edit]
Cousin Tolu     Member    Houston, US       Last active: 3 days    [Edit]
Mama            Member    Lagos, NG  Proxy  Managed by: Adaeze     [Edit]
```

**Role-based differences:**
- Admin: sees "Edit", "Invite Member", "Add Proxy", role badges, managed-by indicators, "Last active"
- Member: sees names + locations only, no edit buttons, no "Last active"

**Endpoint mapping:**
- `GET /workspaces/:id/members` — member list

---

#### SCREEN: Member Profile View + Edit

**See Section 8 (Permissions) for detailed field-level edit rules.**

The edit form has two variants:
1. **Admin editing a member** — Can edit: display_name, relationship_to_head, relationship_category, date_of_birth, role, is_proxy, proxy_managed_by, is_active, notes (private). Cannot edit: phone, social, email, WhatsApp, preferred_contact, location, timezone.
2. **Member editing own profile** — Can edit: display_name, relationship_to_head, location, timezone, date_of_birth, contact_preference, contact_info (all contact fields), profile_photo. Cannot edit: role, is_proxy, proxy_managed_by, is_active, notes.

**Endpoint mapping:**
- `GET /workspaces/:id/members/:memberId`
- `PATCH /workspaces/:id/members/:memberId`

---

#### SCREEN: Document Vault (`/w/:workspaceId/documents`)

**Purpose:** Store and access family documents.
**Layout:**
- Category tabs: Legal | Identity | Health | Financial | History
- Document cards: name, category, uploaded by, expiry badge (if applicable), access tier badge
- Upload button (admin only, or admin-delegated)

**Document access rules enforce signed URL generation — see Part 8.**

**Endpoint mapping:**
- `GET /workspaces/:id/documents`
- `POST /workspaces/:id/documents/upload-url`
- `POST /workspaces/:id/documents`
- `GET /workspaces/:id/documents/:docId/download-url`

---

#### SCREEN: Notifications (`/notifications`)

**Purpose:** In-app notification inbox.
**Layout:** Chronological list of notifications, grouped by day, with unread badge count in nav.
**UI states:** `empty` (with illustration: "You're all caught up"), `populated`, `loading`

**Endpoint mapping:**
- `GET /notifications` — paginated, filtered by workspace
- `PATCH /notifications/:id/read`
- `PATCH /notifications/read-all`

---

#### SCREEN: Workspace Settings (`/w/:workspaceId/settings`)

**Accessible to:** Admin only. Members get a 403 redirect to dashboard.
**Sections:**
1. General (name, base currency, family type, description)
2. Exchange Rates (JSONB editor for currency pairs)
3. Bank Details (for reminder templates)
4. Reminder Templates (default message templates)
5. Notification Preferences (workspace-level defaults)
6. Danger Zone (delete workspace — only if no financial data)

**Endpoint mapping:**
- `GET /workspaces/:id/settings`
- `PATCH /workspaces/:id`
- `PATCH /workspaces/:id/settings` (for key-value settings)

---

#### SCREEN: User Profile (`/profile`)

**Purpose:** Personal settings — not workspace-specific.
**Sections:**
1. Personal Information (name, country, bio, avatar)
2. Contact Methods (email, WhatsApp, phone, social links, push enabled)
3. Notification Preferences (push, email, quiet hours)
4. Security (change password, active sessions)
5. Data (export data, delete account)

**Endpoint mapping:**
- `GET /auth/me`
- `PATCH /auth/profile`
- `PATCH /auth/contacts`

---

#### SCREEN: Timeline (`/w/:workspaceId/timeline`)

**Purpose:** Family history view — completed events + milestones.
**Layout:** Vertical timeline, newest to oldest.
**Items:**
- Completed containers (auto-added on completion)
- Manually added milestones (birth, graduation, wedding, death, migration, custom)
- "Add Milestone" button (admin only)

**Endpoint mapping:**
- `GET /workspaces/:id/timeline`
- `POST /workspaces/:id/milestones`
- `GET /workspaces/:id/milestones`

---

#### SCREEN: Public Event View (`/public/event/:publicToken`)

**Purpose:** Read-only shareable view of an event. No authentication required.
**Content:**
- Event name, date, description
- Progress bar (if budget target set) or "Total collected: £X"
- Contributor list: names + status (Paid / Pending) — NO AMOUNTS
- "Join Kith to participate" CTA (links to /auth/signup?source=public)

**Note:** Admin controls whether individual contributor names are shown or anonymized.

**Endpoint mapping:** `GET /public/containers/:publicToken`

---

### 2.3 — Global UI State Management Rules

**Loading states:** Every data-fetching screen must show a skeleton loader that matches the layout of the populated state. Never show a spinner over a blank page.

**Error states:**
- Network error → Toast: "Connection error. Please check your internet."
- 401 → Redirect to `/auth/login`
- 403 → Toast: "You don't have permission to do that." Stay on current page.
- 404 → Inline empty state with suggestion (not a full-page 404 unless it's a direct URL hit)
- 500 → Toast: "Something went wrong. We've been notified." Show retry option.

**Empty states:** Every list view must have a meaningful empty state with an action prompt. Never show a blank list.

**Optimistic updates:** For marking notifications read, completing tasks, and confirming payments — apply the UI change immediately, then sync with the API. Roll back on failure.

**Offline indicator:** A persistent banner appears when the user loses connection: "You're offline. Changes will sync when you reconnect." Interactions that require the network are disabled (not hidden).

---

### 2.4 — Mobile Considerations

Kith is a PWA, and the primary device for many target users is a mobile phone. The design must be mobile-first.

- **Navigation:** Bottom tab bar on mobile (Dashboard, Containers, Members, Notifications, Profile). Top navigation bar on desktop.
- **Tables:** The contributor summary table must adapt to mobile — on small screens, each row becomes a card (stacked layout).
- **Modals:** On mobile, modals slide up from the bottom (bottom sheet pattern) rather than appearing centered.
- **Touch targets:** All interactive elements (buttons, table rows) must have a minimum 44px touch target height.
- **File upload:** On mobile, the file input should trigger the native camera/gallery picker. Label: "Take a photo or upload a file."
- **Long forms:** Multi-step flows must save progress locally so a phone call interruption doesn't lose the user's input.

---

---

## PART 3: DOMAIN MODEL + DATABASE DESIGN

### 3.1 — Design Principles

1. **Multi-tenancy via shared schema + RLS.** Every table that contains family-specific data carries a `workspace_id NOT NULL` column. Row-Level Security in Supabase acts as the last-resort safety net. The API layer enforces access control first.
2. **Append-only financial ledger.** `ledger_entries` are never UPDATEd or DELETEd once confirmed. Corrections are new entries with a reference. This is the trust foundation.
3. **Soft deletes for user-facing entities.** Events, documents, and members use `deleted_at` (nullable timestamp) instead of hard deletes. Hard deletes only happen when there is zero associated financial data.
4. **Audit fields on every mutable table.** Every table that can be modified has `created_at`, `updated_at`, and where relevant, `created_by`, `updated_by`.
5. **JSONB for flexible/evolving data.** Settings, contact info, and rate data use JSONB where the schema is likely to evolve. Do not prematurely normalize these into separate tables.
6. **Status enums as TEXT with application-enforced transitions.** Postgres CHECK constraints enforce valid values; the application layer enforces valid transitions.

---

### 3.2 — Complete Schema

#### TABLE: `users`
The user's global identity record. Created by a trigger on Supabase's `auth.users` insert.

```sql
CREATE TABLE public.users (
  id                  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name           TEXT NOT NULL,
  country_of_residence TEXT,
  timezone            TEXT,                    -- e.g. 'Europe/London', auto-detected from country
  bio                 TEXT CHECK (LENGTH(bio) <= 200),
  preferred_language  TEXT DEFAULT 'en',
  avatar_url          TEXT,
  email_verified      BOOLEAN NOT NULL DEFAULT FALSE,
  push_token          TEXT,                    -- FCM device token
  push_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  quiet_hours_start   TIME,                    -- e.g. '22:00:00'
  quiet_hours_end     TIME,                    -- e.g. '08:00:00'
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at        TIMESTAMPTZ,
  deleted_at          TIMESTAMPTZ              -- soft delete for account deactivation
);

-- Trigger: update users.updated_at on any UPDATE
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Indexes
CREATE INDEX idx_users_email_verified ON users(email_verified);
```

**Note:** Email is managed entirely by Supabase Auth. Do not store it in `public.users`. Retrieve it via `auth.users` join when needed.

---

#### TABLE: `user_contacts`
A user's multiple contact methods. Managed entirely by the user, never by admin.

```sql
CREATE TABLE user_contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN (
                    'email_secondary', 'whatsapp', 'phone', 'telegram',
                    'signal', 'instagram', 'facebook', 'twitter',
                    'linkedin', 'custom'
                  )),
  label           TEXT,                        -- User-defined label: "Work phone", "Lagos number"
  value           TEXT NOT NULL,
  country_code    TEXT,                        -- For phone numbers: '+44', '+234'
  is_primary      BOOLEAN NOT NULL DEFAULT FALSE,
  is_verified     BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, type, value)
);

CREATE INDEX idx_user_contacts_user ON user_contacts(user_id);
```

---

#### TABLE: `workspaces`
The multi-tenancy root. Every family has one or more workspaces.

```sql
CREATE TABLE workspaces (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  base_currency   TEXT NOT NULL DEFAULT 'GBP',  -- ISO 4217
  family_type     TEXT NOT NULL DEFAULT 'extended'
                    CHECK (family_type IN ('extended', 'event', 'pool')),
  description     TEXT,
  avatar_url      TEXT,
  
  -- Exchange rates: { "NGN": 1600, "GHS": 12.5, "KES": 140, "USD": 1.25 }
  -- Values represent: X units of foreign currency = 1 base currency unit
  currency_rates  JSONB NOT NULL DEFAULT '{}',
  
  -- Workspace-level bank payment details (used in reminder templates)
  bank_details    JSONB DEFAULT '{}',
  -- e.g. { "account_name": "Adaeze Okafor", "bank": "Monzo", "sort_code": "04-00-04", "account_number": "12345678" }
  
  -- Billing / plan
  plan            TEXT NOT NULL DEFAULT 'free'
                    CHECK (plan IN ('free', 'core', 'pro')),
  plan_expires_at TIMESTAMPTZ,
  
  -- Public workspace options
  visibility      TEXT NOT NULL DEFAULT 'private'
                    CHECK (visibility IN ('private', 'public')),
  
  created_by      UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ              -- soft delete
);

CREATE INDEX idx_workspaces_created_by ON workspaces(created_by);
CREATE INDEX idx_workspaces_plan ON workspaces(plan);

CREATE TRIGGER workspaces_updated_at BEFORE UPDATE ON workspaces
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

---

#### TABLE: `workspace_settings`
Key-value store for workspace-level configuration. Avoids adding many nullable columns to `workspaces`.

```sql
CREATE TABLE workspace_settings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  setting_key     TEXT NOT NULL,
  setting_value   JSONB,
  updated_by      UUID REFERENCES workspace_members(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, setting_key)
);

-- Example keys and their JSONB structures:
-- 'reminder_templates': { 
--     "due_soon": "Hi {name}, your contribution of {amount} is due {date}.",
--     "overdue": "Hi {name}, your contribution for {event} is now overdue." 
-- }
-- 'notification_prefs': { 
--     "reminder_days_before": [3, 1], 
--     "overdue_notify_after_days": [3, 7],
--     "weekly_digest_enabled": true
-- }
-- 'invite_message': { "template": "Join our family on Kith: {invite_link}" }

CREATE INDEX idx_workspace_settings_lookup ON workspace_settings(workspace_id, setting_key);
```

---

#### TABLE: `workspace_members`
Every person in a workspace — whether they have a Kith account or not (proxy members).

```sql
CREATE TABLE workspace_members (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  
  -- Links to real user account. NULL for proxy members.
  user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
  
  -- Role in this workspace
  role                TEXT NOT NULL DEFAULT 'member'
                        CHECK (role IN ('admin', 'member')),
  
  -- How this person appears everywhere in the workspace
  display_name        TEXT NOT NULL,
  
  -- Relationship context (free text, admin-managed)
  relationship_to_head  TEXT,              -- "Brother to head", "Cousin from Mum's side"
  relationship_category TEXT DEFAULT 'other'
                          CHECK (relationship_category IN (
                            'blood', 'marriage', 'in_law', 'friend', 'other'
                          )),
  
  -- Date of birth (optional, for milestone reminders)
  date_of_birth       DATE,
  
  -- Proxy member configuration
  is_proxy            BOOLEAN NOT NULL DEFAULT FALSE,
  proxy_managed_by    UUID REFERENCES workspace_members(id),  -- another member's ID
  
  -- Private notes — only visible to admins
  admin_notes         TEXT,
  
  -- Invite state (for members with real accounts)
  invite_status       TEXT DEFAULT NULL
                        CHECK (invite_status IN (NULL, 'pending', 'accepted', 'declined')),
  invited_at          TIMESTAMPTZ,
  
  -- Activity tracking
  joined_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at      TIMESTAMPTZ,
  
  -- Contribution tracking (updated by background job)
  contribution_streak_months  INTEGER DEFAULT 0,
  last_contribution_date      DATE,
  
  -- Status
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ,         -- soft delete (member removed from workspace)
  
  -- Constraints
  UNIQUE(workspace_id, user_id),           -- one membership per real user per workspace
  CHECK (
    (is_proxy = TRUE AND user_id IS NULL) OR
    (is_proxy = FALSE)
  )
);

CREATE INDEX idx_workspace_members_workspace ON workspace_members(workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_workspace_members_user ON workspace_members(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_workspace_members_proxy ON workspace_members(workspace_id, is_proxy);
CREATE INDEX idx_workspace_members_role ON workspace_members(workspace_id, role);
```

**Lifecycle transitions:**
- `invite_status`: NULL (proxy/manually added) → 'pending' (invite sent) → 'accepted' (joined) | 'declined'
- `is_active`: TRUE → FALSE (admin deactivates, or member requests removal)
- Soft delete via `deleted_at` when a member is removed (never hard delete if they have ledger history)

---

#### TABLE: `member_profile_audit`
Immutable audit log of every profile field change.

```sql
CREATE TABLE member_profile_audit (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_member_id   UUID NOT NULL REFERENCES workspace_members(id) ON DELETE CASCADE,
  changed_by            UUID NOT NULL REFERENCES workspace_members(id),
  changed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  field_name            TEXT NOT NULL,
  old_value             TEXT,
  new_value             TEXT,
  change_source         TEXT NOT NULL CHECK (change_source IN ('admin', 'member'))
);

CREATE INDEX idx_profile_audit_member ON member_profile_audit(workspace_member_id);
CREATE INDEX idx_profile_audit_time ON member_profile_audit(changed_at DESC);
```

---

#### TABLE: `invite_links`
Simple invite tokens. No status field — expired tokens are cleaned by a background job.

```sql
CREATE TABLE invite_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token           TEXT NOT NULL UNIQUE,    -- crypto.randomBytes(32).toString('hex')
  created_by      UUID NOT NULL REFERENCES workspace_members(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  used_at         TIMESTAMPTZ,             -- set when accepted; allows one-time use detection
  used_by_user_id UUID REFERENCES users(id)  -- who accepted it
);

CREATE UNIQUE INDEX idx_invite_links_token ON invite_links(token);
CREATE INDEX idx_invite_links_workspace ON invite_links(workspace_id);
CREATE INDEX idx_invite_links_expiry ON invite_links(expires_at);
```

**Security note:** After a token is used (`used_at` is set), the same token cannot be re-used even if it hasn't expired. Check `used_at IS NULL` on every acceptance attempt.

---

#### TABLE: `groups`
Reusable named collections of workspace members. Used for bulk-adding participants to containers.

```sql
CREATE TABLE groups (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  created_by      UUID NOT NULL REFERENCES workspace_members(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE group_members (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id              UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  workspace_member_id   UUID NOT NULL REFERENCES workspace_members(id) ON DELETE CASCADE,
  added_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  added_by              UUID REFERENCES workspace_members(id),
  UNIQUE(group_id, workspace_member_id)
);

CREATE INDEX idx_groups_workspace ON groups(workspace_id);
CREATE INDEX idx_group_members_group ON group_members(group_id);
CREATE INDEX idx_group_members_member ON group_members(workspace_member_id);
```

---

#### TABLE: `containers`
The unified container replacing separate `events` and `recurring_pools` tables.

```sql
CREATE TABLE containers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  
  -- Basic info
  name                  TEXT NOT NULL,
  subtitle              TEXT,
  description           TEXT,
  cover_image_url       TEXT,
  
  -- Type determines behavior
  container_type        TEXT NOT NULL CHECK (container_type IN ('event', 'recurring')),
  
  -- What tracking is enabled (can both be false — "info only")
  enable_money          BOOLEAN NOT NULL DEFAULT FALSE,
  enable_tasks          BOOLEAN NOT NULL DEFAULT FALSE,
  
  -- Event-specific fields
  event_date            DATE,
  event_type            TEXT,              -- Free text: "Wedding", "Funeral", "Graduation"
  event_type_category   TEXT DEFAULT 'other'
                          CHECK (event_type_category IN (
                            'celebration', 'memorial', 'financial', 'logistical', 'other'
                          )),
  
  -- Recurring-specific fields
  recurrence_cadence    TEXT CHECK (recurrence_cadence IN (
                          'monthly', 'quarterly', 'yearly', 'custom', NULL
                        )),
  recurrence_days       INTEGER,           -- If cadence = 'custom': every X days
  recurrence_start      DATE,
  recurrence_end        DATE,              -- Optional end date for the recurring pool
  carry_forward_unpaid  BOOLEAN NOT NULL DEFAULT FALSE,
  auto_generate_cycles  BOOLEAN NOT NULL DEFAULT TRUE,
  
  -- Money tracking (if enable_money = true)
  budget_target         NUMERIC(15,2),
  budget_currency       TEXT,
  
  -- Public sharing
  public_token          TEXT UNIQUE,       -- If set, enables /public/event/:publicToken
  public_show_names     BOOLEAN DEFAULT TRUE,
  
  -- Status lifecycle
  status                TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'completed', 'archived', 'cancelled')),
  
  -- Outcome (set when completed)
  outcome_details       TEXT,              -- Free-text summary for members who missed the event
  outcome_files         JSONB DEFAULT '[]',
  -- Array of: [{ "url": "...", "name": "wedding_photos.pdf", "size": 12345, "uploaded_by": "member_id", "uploaded_at": "..." }]
  
  -- Audit
  created_by            UUID NOT NULL REFERENCES workspace_members(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ,
  deleted_at            TIMESTAMPTZ        -- soft delete
);

CREATE INDEX idx_containers_workspace ON containers(workspace_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_containers_type ON containers(workspace_id, container_type) WHERE deleted_at IS NULL;
CREATE INDEX idx_containers_public_token ON containers(public_token) WHERE public_token IS NOT NULL;

CREATE TRIGGER containers_updated_at BEFORE UPDATE ON containers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

**Status transition rules (enforced in API layer):**
- `active` → `completed` (admin action — marks event done, creates timeline entry)
- `active` → `archived` (admin action — hide from active view, preserve history)
- `active` → `cancelled` (admin action — no ledger entries or with admin override)
- `completed` → `archived` (allowed)
- `archived` ↛ anything (archived is terminal unless admin explicitly restores)

---

#### TABLE: `container_cycles`
Generated cycle periods for recurring containers. Each cycle is an independent period.

```sql
CREATE TABLE container_cycles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id      UUID NOT NULL REFERENCES containers(id) ON DELETE CASCADE,
  cycle_number      INTEGER NOT NULL,      -- 1, 2, 3... sequential
  cycle_start       DATE NOT NULL,
  cycle_end         DATE NOT NULL,
  status            TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('upcoming', 'open', 'closed', 'skipped')),
  total_expected    NUMERIC(15,2),         -- sum of all participant targets for this cycle
  total_collected   NUMERIC(15,2) DEFAULT 0, -- updated by trigger on ledger_entries
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at         TIMESTAMPTZ,
  
  UNIQUE(container_id, cycle_number),
  UNIQUE(container_id, cycle_start)
);

CREATE INDEX idx_cycles_container ON container_cycles(container_id, status);
CREATE INDEX idx_cycles_dates ON container_cycles(cycle_start, cycle_end);
```

---

#### TABLE: `pool_cycle_overrides`
Admin-controlled overrides for specific cycle periods (pause, skip member, adjust target).

```sql
CREATE TABLE pool_cycle_overrides (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id    UUID NOT NULL REFERENCES containers(id) ON DELETE CASCADE,
  cycle_start     DATE NOT NULL,
  override_type   TEXT NOT NULL CHECK (override_type IN (
                    'pause_pool', 'skip_member', 'adjust_target'
                  )),
  member_id       UUID REFERENCES workspace_members(id),  -- for skip_member
  new_target      NUMERIC(15,2),                           -- for adjust_target
  new_currency    TEXT,                                    -- for adjust_target
  reason          TEXT,
  created_by      UUID NOT NULL REFERENCES workspace_members(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_overrides_container ON pool_cycle_overrides(container_id);
```

---

#### TABLE: `container_participants`
Defines who is involved in a container and their role/contribution settings.

```sql
CREATE TABLE container_participants (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id          UUID NOT NULL REFERENCES containers(id) ON DELETE CASCADE,
  workspace_member_id   UUID NOT NULL REFERENCES workspace_members(id),
  
  -- Optional event role (free text)
  role                  TEXT,              -- "Transport lead", "Caterer", "Guest list", etc.
  
  -- Money participation (only relevant if container enable_money = true)
  money_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  
  -- Task participation (only relevant if container enable_tasks = true)
  tasks_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  
  -- Admin-only notes for this contributor in this container
  notes                 TEXT,
  
  -- Visibility
  exclude_from_public   BOOLEAN NOT NULL DEFAULT FALSE,  -- hide from public summary
  
  added_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  added_by              UUID REFERENCES workspace_members(id),
  
  UNIQUE(container_id, workspace_member_id)
);

CREATE INDEX idx_participants_container ON container_participants(container_id);
CREATE INDEX idx_participants_member ON container_participants(workspace_member_id);
```

---

#### TABLE: `contributor_targets`
Versioned contribution targets per participant per container. Maintains history when targets change.

```sql
CREATE TABLE contributor_targets (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  container_participant_id UUID NOT NULL REFERENCES container_participants(id) ON DELETE CASCADE,
  container_id            UUID NOT NULL REFERENCES containers(id),  -- denormalized for query efficiency
  workspace_member_id     UUID NOT NULL REFERENCES workspace_members(id),
  cycle_id                UUID REFERENCES container_cycles(id),  -- NULL for one-time events
  
  target_amount           NUMERIC(15,2) NOT NULL,
  target_currency         TEXT NOT NULL,
  due_date                DATE,
  
  -- Versioning
  is_current              BOOLEAN NOT NULL DEFAULT TRUE,
  superseded_by           UUID REFERENCES contributor_targets(id),
  superseded_at           TIMESTAMPTZ,
  
  set_by                  UUID NOT NULL REFERENCES workspace_members(id),
  set_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one current target per participant per container (or per cycle for recurring)
CREATE UNIQUE INDEX idx_targets_current_event ON contributor_targets(container_participant_id)
  WHERE is_current = TRUE AND cycle_id IS NULL;

CREATE UNIQUE INDEX idx_targets_current_cycle ON contributor_targets(container_participant_id, cycle_id)
  WHERE is_current = TRUE AND cycle_id IS NOT NULL;

CREATE INDEX idx_targets_container ON contributor_targets(container_id);
CREATE INDEX idx_targets_member ON contributor_targets(workspace_member_id);
```

**Target change flow:**
1. Admin changes a target for Emeka.
2. Find existing current target: `UPDATE contributor_targets SET is_current = FALSE, superseded_at = NOW(), superseded_by = NEW_ID WHERE is_current = TRUE AND ...`
3. Insert new target with `is_current = TRUE`.
4. Write to `member_profile_audit` with old and new values.

---

#### TABLE: `ledger_entries`
The immutable financial record. Append-only once status = 'confirmed'.

```sql
CREATE TABLE ledger_entries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES workspaces(id),
  container_id        UUID NOT NULL REFERENCES containers(id),
  cycle_id            UUID REFERENCES container_cycles(id),  -- for recurring containers
  
  entry_type          TEXT NOT NULL CHECK (entry_type IN (
                        'contribution', 'expense', 'correction', 'reversal', 'carry_forward'
                      )),
  
  -- The person this entry is attributed to
  contributor_id      UUID REFERENCES workspace_members(id),
  
  -- Original amount in contributor's currency
  original_amount     NUMERIC(15,2) NOT NULL,
  original_currency   TEXT NOT NULL,
  is_crypto           BOOLEAN NOT NULL DEFAULT FALSE,
  
  -- Converted amount in workspace base currency
  converted_amount    NUMERIC(15,2) NOT NULL,
  base_currency       TEXT NOT NULL,
  exchange_rate       NUMERIC(10,6) NOT NULL,  -- rate applied at time of recording
  
  -- Payment method
  payment_method      TEXT CHECK (payment_method IN (
                        'cash', 'bank_transfer', 'mobile_money', 'crypto', 'other', NULL
                      )),
  
  -- Proof of payment
  proof_url           TEXT,              -- Supabase Storage path
  proof_uploaded_at   TIMESTAMPTZ,
  
  -- Status lifecycle
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN (
                          'pending', 'proof_uploaded', 'confirmed', 'disputed', 'resolved', 'reversed'
                        )),
  
  -- Immutability chain (for corrections/reversals)
  corrects_entry_id   UUID REFERENCES ledger_entries(id),
  
  -- Notes
  note                TEXT,
  
  -- Audit
  recorded_by         UUID NOT NULL REFERENCES workspace_members(id),
  recorded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at        TIMESTAMPTZ,
  confirmed_by        UUID REFERENCES workspace_members(id)
  
  -- No updated_at — ledger entries are append-only once confirmed
  -- Pending entries CAN be modified by the contributor (own entries only) or admin
);

CREATE INDEX idx_ledger_workspace_container ON ledger_entries(workspace_id, container_id);
CREATE INDEX idx_ledger_contributor ON ledger_entries(contributor_id);
CREATE INDEX idx_ledger_status ON ledger_entries(status);
CREATE INDEX idx_ledger_cycle ON ledger_entries(cycle_id) WHERE cycle_id IS NOT NULL;
CREATE INDEX idx_ledger_recorded_at ON ledger_entries(recorded_at DESC);
```

**Immutability enforcement rules (API layer):**
- Once `status = 'confirmed'`, the following fields are permanently locked: `original_amount`, `original_currency`, `converted_amount`, `exchange_rate`, `contributor_id`, `entry_type`, `recorded_by`.
- `status` transitions allowed: `pending` → `proof_uploaded` → `confirmed` | `disputed`. `disputed` → `resolved`. `confirmed` → reversed via a new `reversal` entry only.
- `note` and `proof_url` can be updated on pending entries.

**Who can edit pending entries:**
- The contributor themselves can edit their own `pending` entries: amount, currency, proof, note, payment_method.
- Admin can edit any `pending` entry.
- No one can edit a `confirmed` entry in place.

---

#### TABLE: `disputes`
Dispute records for contested ledger entries.

```sql
CREATE TABLE disputes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES workspaces(id),
  ledger_entry_id     UUID NOT NULL REFERENCES ledger_entries(id),
  raised_by           UUID NOT NULL REFERENCES workspace_members(id),
  reason              TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'resolved')),
  resolution_note     TEXT,
  resolved_by         UUID REFERENCES workspace_members(id),
  raised_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at         TIMESTAMPTZ,
  
  -- Append-only notes from both parties
  notes               JSONB NOT NULL DEFAULT '[]'
  -- Array: [{ "author_id": "...", "note": "...", "added_at": "..." }]
);

CREATE INDEX idx_disputes_workspace ON disputes(workspace_id, status);
CREATE INDEX idx_disputes_entry ON disputes(ledger_entry_id);
```

---

#### TABLE: `container_tasks`
Task assignments within a container (only when `enable_tasks = true`).

```sql
CREATE TABLE container_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id    UUID NOT NULL REFERENCES containers(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT,
  
  -- Assignment (NULL = unassigned)
  assigned_to     UUID REFERENCES workspace_members(id),
  
  -- Timing
  due_date        DATE,
  
  -- Status lifecycle
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN (
                      'pending', 'in_progress', 'completed', 'overdue', 'cancelled'
                    )),
  
  -- Completion
  completed_at    TIMESTAMPTZ,
  completed_by    UUID REFERENCES workspace_members(id),
  completion_note TEXT,
  proof_url       TEXT,            -- optional photo of completed task
  
  -- Ordering
  sort_order      INTEGER DEFAULT 0,
  
  created_by      UUID NOT NULL REFERENCES workspace_members(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_tasks_container ON container_tasks(container_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_tasks_assigned ON container_tasks(assigned_to) WHERE deleted_at IS NULL;
CREATE INDEX idx_tasks_status ON container_tasks(container_id, status) WHERE deleted_at IS NULL;

CREATE TRIGGER tasks_updated_at BEFORE UPDATE ON container_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

---

#### TABLE: `documents`
The document vault.

```sql
CREATE TABLE documents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  category              TEXT NOT NULL CHECK (category IN (
                          'legal', 'identity', 'health', 'financial', 'history', 'other'
                        )),
  description           TEXT,
  file_url              TEXT NOT NULL,           -- Supabase Storage path
  file_size_bytes       BIGINT,
  mime_type             TEXT,
  
  -- Access control
  access_tier           TEXT NOT NULL DEFAULT 'all_members'
                          CHECK (access_tier IN (
                            'all_members', 'admins_only', 'named_members'
                          )),
  
  -- Expiry tracking
  expiry_date           DATE,
  expiry_alert_30d_sent BOOLEAN NOT NULL DEFAULT FALSE,
  expiry_alert_7d_sent  BOOLEAN NOT NULL DEFAULT FALSE,
  
  -- Versioning
  version               INTEGER NOT NULL DEFAULT 1,
  supersedes_id         UUID REFERENCES documents(id),
  
  uploaded_by           UUID NOT NULL REFERENCES workspace_members(id),
  uploaded_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ   -- soft delete (documents are never hard-deleted if accessed)
);

CREATE TABLE document_access (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id           UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  workspace_member_id   UUID NOT NULL REFERENCES workspace_members(id) ON DELETE CASCADE,
  granted_by            UUID REFERENCES workspace_members(id),
  granted_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(document_id, workspace_member_id)
);

CREATE TABLE document_access_log (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id           UUID NOT NULL REFERENCES documents(id),
  accessed_by           UUID NOT NULL REFERENCES workspace_members(id),
  accessed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  action                TEXT NOT NULL CHECK (action IN ('viewed', 'downloaded', 'shared'))
  -- Never deleted — permanent audit
);

CREATE INDEX idx_documents_workspace ON documents(workspace_id, category) WHERE deleted_at IS NULL;
CREATE INDEX idx_documents_expiry ON documents(expiry_date)
  WHERE expiry_date IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_doc_access_log_doc ON document_access_log(document_id);
```

---

#### TABLE: `milestones`
Manually recorded family milestones for the timeline.

```sql
CREATE TABLE milestones (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  milestone_date    DATE NOT NULL,
  description       TEXT,
  photo_url         TEXT,
  milestone_type    TEXT NOT NULL DEFAULT 'custom'
                      CHECK (milestone_type IN (
                        'birth', 'graduation', 'wedding', 'death',
                        'migration', 'achievement', 'custom'
                      )),
  created_by        UUID NOT NULL REFERENCES workspace_members(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);

CREATE INDEX idx_milestones_workspace ON milestones(workspace_id, milestone_date DESC)
  WHERE deleted_at IS NULL;
```

---

#### TABLE: `notifications`
In-app notification records.

```sql
CREATE TABLE notifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  recipient_id      UUID NOT NULL REFERENCES workspace_members(id) ON DELETE CASCADE,
  type              TEXT NOT NULL,
  -- Type values:
  -- 'contribution_submitted' | 'contribution_confirmed' | 'contribution_disputed'
  -- 'dispute_resolved' | 'task_assigned' | 'task_completed' | 'task_overdue'
  -- 'document_expiring' | 'invite_accepted' | 'payment_reminder' | 'cycle_started'
  -- 'container_completed' | 'milestone_added' | 'admin_announcement' | 'overdue_summary'
  
  title             TEXT NOT NULL,
  body              TEXT,
  
  -- Deep link context
  reference_type    TEXT CHECK (reference_type IN (
                      'container', 'ledger_entry', 'document', 'dispute',
                      'task', 'milestone', 'member', NULL
                    )),
  reference_id      UUID,
  
  -- State
  is_read           BOOLEAN NOT NULL DEFAULT FALSE,
  read_at           TIMESTAMPTZ,
  
  -- Delivery tracking (managed by notification_deliveries table)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Deduplication key (prevents sending same notification twice)
  dedup_key         TEXT UNIQUE  -- e.g. 'reminder:entry_id:2025-04-01'
);

CREATE TABLE notification_deliveries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id   UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel           TEXT NOT NULL CHECK (channel IN ('in_app', 'push', 'email')),
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'skipped')),
  retry_count       INTEGER NOT NULL DEFAULT 0,
  last_attempt_at   TIMESTAMPTZ,
  delivered_at      TIMESTAMPTZ,
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_recipient ON notifications(recipient_id, is_read);
CREATE INDEX idx_notifications_workspace ON notifications(workspace_id, created_at DESC);
CREATE INDEX idx_notification_deliveries_status ON notification_deliveries(status, retry_count)
  WHERE status IN ('pending', 'failed');
```

---

#### TABLE: `proxy_actions`
Audit trail for every action taken by an admin on behalf of a proxy member.

```sql
CREATE TABLE proxy_actions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES workspaces(id),
  proxy_member_id     UUID NOT NULL REFERENCES workspace_members(id),
  managed_by_id       UUID NOT NULL REFERENCES workspace_members(id),
  action_type         TEXT NOT NULL,
  -- 'contribution_recorded' | 'contribution_edited' | 'task_completed' | 'profile_updated'
  target_id           UUID,       -- ID of the affected ledger entry, task, etc.
  action_details      JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_proxy_actions_proxy ON proxy_actions(proxy_member_id);
CREATE INDEX idx_proxy_actions_manager ON proxy_actions(managed_by_id);
```

---

#### HELPER FUNCTION: `update_updated_at_column`

```sql
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

---

### 3.3 — RLS Policies (Safety Net Layer)

The API layer is the primary enforcement mechanism. RLS provides defense-in-depth. Example policies:

```sql
-- Enable RLS on all workspace-scoped tables
ALTER TABLE containers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- Policy: workspace members can select containers in their workspace
CREATE POLICY "members_select_containers"
  ON containers FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid() AND is_active = TRUE AND deleted_at IS NULL
    )
  );

-- Similar policies for INSERT, UPDATE, DELETE
-- The API layer always uses service role key, bypassing RLS
-- RLS only applies to direct Supabase client calls (which the frontend should not make for data ops)
```

---

---

## PART 4: COMPLETE API ARCHITECTURE

### 4.1 — Structure & Conventions

**Base URL:** `https://api.kith.app/v1`

**Request format:**
- Content-Type: `application/json`
- Authorization: `Bearer {supabase_jwt}` on all protected endpoints

**Response envelope:**
```json
// Success
{ "data": { ... }, "meta": { "pagination": { "page": 1, "per_page": 20, "total": 145 } } }

// Error
{ "error": { "code": "VALIDATION_FAILED", "message": "...", "field": "...", "details": {} } }
```

**Pagination:** All list endpoints accept `?page=1&per_page=20`. Default per_page: 20. Max per_page: 100.
**Filtering:** `?filter[status]=confirmed&filter[contributor_id]=uuid`
**Sorting:** `?sort=-recorded_at` (prefix `-` for DESC)

**Standard error codes:**
```
VALIDATION_FAILED       400 — Request body fails Zod validation
UNAUTHORIZED            401 — Missing or invalid JWT
FORBIDDEN               403 — Valid JWT but no permission
NOT_FOUND               404 — Resource not found OR user has no access (same response)
CONFLICT                409 — Duplicate operation (already member, already voted, etc.)
BUSINESS_RULE_VIOLATION 422 — Valid request but violates system rules (editing confirmed entry)
RATE_LIMITED            429 — Too many requests
INTERNAL_ERROR          500 — Server error (logged, generic message returned)
```

---

### 4.2 — Auth Endpoints

```
POST /auth/register
  Purpose: Create user profile after Supabase Auth registration
  Auth: Supabase JWT (newly created)
  Body: { full_name: string, country_of_residence: string }
  Response: { data: { user: UserObject, workspace: null } }
  Notes: Called automatically by frontend after Supabase signUp() succeeds.
         Idempotent — if called twice for same user_id, returns existing profile.

POST /auth/login
  Purpose: Not needed — handled by Supabase Auth client. Frontend calls supabase.auth.signInWithPassword().
  This endpoint does not exist in your API.

GET /auth/me
  Purpose: Get current user profile + list of workspaces they belong to
  Auth: Required
  Response: { data: { user: UserObject, memberships: [{ workspace, role, member_id }] } }
  Notes: Called on every app load to hydrate auth state.

PATCH /auth/profile
  Purpose: Update personal profile fields
  Auth: Required
  Body: { full_name?, bio?, country_of_residence?, timezone?, preferred_language?, avatar_url? }
  Validation: bio max 200 chars
  Response: { data: { user: UserObject } }
  Notes: avatar_url is set after the frontend uploads to Supabase Storage directly.

PATCH /auth/contacts
  Purpose: Update user contact methods (user-managed only, admin cannot call this)
  Auth: Required
  Body: { contacts: [{ type, value, label?, country_code?, is_primary? }] }
  Response: { data: { contacts: [ContactObject] } }
  Notes: Replaces all contacts of a given type. Atomic operation.

PATCH /auth/push-token
  Purpose: Register or update FCM device token for push notifications
  Auth: Required
  Body: { push_token: string, push_enabled: boolean }
  Response: { data: { push_enabled: boolean } }

PATCH /auth/notification-preferences
  Purpose: Update quiet hours, push_enabled, email digest preference
  Auth: Required
  Body: { push_enabled?, quiet_hours_start?, quiet_hours_end? }
  Response: { data: { preferences: {} } }

POST /auth/change-password
  Purpose: Not needed — handled by Supabase Auth. Frontend calls supabase.auth.updateUser().

POST /auth/request-data-export
  Purpose: GDPR data export request
  Auth: Required
  Body: {}
  Response: { data: { message: "Your data export will be emailed within 24 hours." } }
```

---

### 4.3 — Workspace Endpoints

```
GET /workspaces
  Purpose: List workspaces the current user belongs to
  Auth: Required
  Response: { data: { workspaces: [WorkspaceWithRoleObject] } }

POST /workspaces
  Purpose: Create a new workspace
  Auth: Required
  Body: { name: string, base_currency: string, family_type?: string, description?: string }
  Validation: name min 2 chars max 80, base_currency must be in supported list
  Response: { data: { workspace: WorkspaceObject, member: WorkspaceMemberObject } }
  Side effects: Creates workspace_members record for creator with role='admin'
  Idempotency: No — each call creates a new workspace

GET /workspaces/:workspaceId
  Auth: Member of workspace
  Response: { data: { workspace: WorkspaceObject, current_member: WorkspaceMemberObject } }

PATCH /workspaces/:workspaceId
  Auth: Admin only
  Body: { name?, base_currency?, family_type?, description?, avatar_url?, visibility? }
  Validation: base_currency change triggers informational note in response (does not backfill entries)
  Response: { data: { workspace: WorkspaceObject } }

GET /workspaces/:workspaceId/dashboard
  Auth: Member of workspace
  Purpose: Composite endpoint for dashboard screen — avoids N+1 API calls
  Response: {
    data: {
      active_containers: [ContainerSummaryObject],  // max 10, sorted by last_activity
      pending_confirmations: [LedgerEntryObject],   // admin only, max 10
      recent_activity: [ActivityItem],              // max 10
      unread_notification_count: number
    }
  }
  Role behavior: pending_confirmations returns [] for non-admins

GET /workspaces/:workspaceId/settings
  Auth: Admin only
  Response: { data: { settings: { [key: string]: any } } }
  Notes: Returns all workspace_settings rows as a flat key-value map

PATCH /workspaces/:workspaceId/settings
  Auth: Admin only
  Body: { [setting_key: string]: any }
  Validation: Unknown keys are rejected with VALIDATION_FAILED
  Allowed keys: 'reminder_templates', 'notification_prefs', 'invite_message', 'bank_details'
  Response: { data: { settings: {} } }

PATCH /workspaces/:workspaceId/exchange-rates
  Auth: Admin only
  Body: { rates: { [currency_code: string]: number } }
  Validation: currency codes must be ISO 4217 or supported crypto symbols; rates must be positive numbers
  Response: { data: { currency_rates: {} } }
  Notes: Overwrites workspace.currency_rates JSONB. New rates apply to future entries only.
         Logs the rate change to audit log.
```

---

### 4.4 — Member Endpoints

```
GET /workspaces/:workspaceId/members
  Auth: Member of workspace
  Query: ?filter[role]=admin&filter[is_proxy]=true&filter[is_active]=true&sort=display_name&search=emeka
  Response: {
    data: {
      members: [WorkspaceMemberObject],
      meta: { total, admins_count, proxy_count, active_count }
    }
  }
  Role behavior:
    Admin: full member objects including admin_notes, proxy details, last_active_at
    Member: limited objects — display_name, role, is_proxy, relationship_to_head, location (no notes, no last_active)

POST /workspaces/:workspaceId/members
  Auth: Admin only
  Purpose: Add a new member directly (proxy or pending invite)
  Body: {
    display_name: string,
    is_proxy: boolean,
    proxy_managed_by?: string,  // required if is_proxy=true
    role?: 'admin' | 'member',
    relationship_to_head?: string,
    relationship_category?: string,
    date_of_birth?: string,
    admin_notes?: string
  }
  Validation:
    - If is_proxy=true: proxy_managed_by must be a valid admin member_id in this workspace
    - display_name min 2 chars max 80
    - Cannot add a member if workspace is at free tier member limit
  Response: { data: { member: WorkspaceMemberObject } }
  Notes: This creates a manual/proxy member. For invited members, use /invites.

GET /workspaces/:workspaceId/members/:memberId
  Auth: Member of workspace
  Response: { data: { member: WorkspaceMemberObject, contribution_summary?: {} } }
  Role behavior: Admin sees full profile + admin_notes + contribution history summary.
                 Member sees limited profile (no notes, limited history).

PATCH /workspaces/:workspaceId/members/:memberId
  Auth: Admin OR the member themselves (field-level restrictions apply)
  Body (admin-editable fields only):
    { display_name?, relationship_to_head?, relationship_category?, date_of_birth?,
      role?, is_proxy?, proxy_managed_by?, is_active?, admin_notes? }
  Body (member-editable fields — only when patching own record):
    { display_name?, relationship_to_head?, date_of_birth? }
    NOTE: Members CANNOT edit their own role, is_proxy, proxy_managed_by, is_active, admin_notes
    NOTE: Admin CANNOT edit phone, social, email, WhatsApp, preferred_contact, location, timezone
          (those fields live in user_contacts / users table and are user-only)
  Validation:
    - role change: if demoting from admin, workspace must retain at least 1 admin
    - proxy_managed_by: must be an active admin in this workspace
  Side effects: Writes all changed fields to member_profile_audit
  Response: { data: { member: WorkspaceMemberObject } }
  Concurrency: Use optimistic locking — check updated_at matches request payload's version

DELETE /workspaces/:workspaceId/members/:memberId
  Auth: Admin only
  Purpose: Remove member from workspace (soft delete)
  Validation:
    - Cannot remove yourself if you're the last admin
    - Cannot hard-delete if member has confirmed ledger entries (soft delete only)
    - If member has no financial history: allow hard delete with ?force=true
  Side effects:
    - Sets workspace_members.deleted_at = NOW(), is_active = FALSE
    - Removes them from future cycle generation
    - Does NOT remove historical ledger entries
    - Creates in-app notification for the removed member (if they have an account)
  Response: { data: { message: "Member removed." } }

GET /workspaces/:workspaceId/members/:memberId/profile-history
  Auth: Admin only
  Response: { data: { history: [ProfileAuditEntry] } }

GET /workspaces/:workspaceId/members/:memberId/contribution-summary
  Auth: Admin only (for other members), or self
  Response: {
    data: {
      total_containers: number,
      total_contributions_confirmed: number,
      total_paid_base_currency: number,
      last_contribution_date: date | null,
      containers: [{ container_name, paid_amount, target_amount, status }]
    }
  }
```

---

### 4.5 — Invite Endpoints

```
POST /workspaces/:workspaceId/invites
  Auth: Admin only
  Purpose: Generate an invite link token
  Body: {}  // No configuration needed — any member who uses the link joins
  Response: {
    data: {
      token: string,
      invite_url: string,  // https://app.kith.app/invite/{token}
      expires_at: string
    }
  }
  Notes: Generates a fresh token each time. Keeps the last 3 tokens active.
         Old tokens are not explicitly revoked — they expire naturally.
         The response includes the full invite URL ready to copy.

GET /invites/:token/preview
  Auth: None required
  Purpose: Get invite details for the preview page
  Response: {
    data: {
      workspace_name: string,
      invited_by_name: string,
      active_containers_count: number,
      active_containers_preview: [{ name, type, progress_summary }],  // max 3
      is_valid: boolean,
      error?: 'expired' | 'already_used' | 'workspace_not_found'
    }
  }
  Validation: Check expires_at > NOW() AND used_at IS NULL
  Notes: Returns sanitized data — no financial amounts, no member details

POST /invites/:token/accept
  Auth: Required (must be logged in)
  Purpose: Accept an invite and join a workspace
  Body: {}
  Validation:
    - Token must exist, not expired (expires_at > NOW()), not already used (used_at IS NULL)
    - User must not already be a member of this workspace
  Side effects:
    - Creates workspace_members record for this user
    - Sets invite_links.used_at = NOW(), used_by_user_id = user.id
    - Creates notification for workspace admins: "Name has joined the workspace"
  Response: { data: { workspace: WorkspaceObject, member: WorkspaceMemberObject } }
  Idempotency: If user is already a member, return 409 CONFLICT with message

GET /workspaces/:workspaceId/invites
  Auth: Admin only
  Purpose: List active (unexpired, unused) invite links
  Response: { data: { invites: [InviteLinkObject] } }

DELETE /workspaces/:workspaceId/invites/:inviteId
  Auth: Admin only
  Purpose: Revoke an invite link by hard-deleting it
  Response: { data: { message: "Invite revoked." } }
```

---

### 4.6 — Groups Endpoints

```
GET /workspaces/:workspaceId/groups
  Auth: Admin only (members don't need to see groups)
  Response: { data: { groups: [GroupWithMemberCountObject] } }

POST /workspaces/:workspaceId/groups
  Auth: Admin only
  Body: { name: string, description?: string, member_ids?: string[] }
  Response: { data: { group: GroupObject } }

GET /workspaces/:workspaceId/groups/:groupId
  Auth: Admin only
  Response: { data: { group: GroupObject, members: [WorkspaceMemberObject] } }

PATCH /workspaces/:workspaceId/groups/:groupId
  Auth: Admin only
  Body: { name?, description? }
  Response: { data: { group: GroupObject } }

POST /workspaces/:workspaceId/groups/:groupId/members
  Auth: Admin only
  Body: { member_ids: string[] }
  Validation: All member_ids must belong to this workspace
  Response: { data: { added_count: number, already_in_group: number } }

DELETE /workspaces/:workspaceId/groups/:groupId/members/:memberId
  Auth: Admin only
  Response: 204 No Content

DELETE /workspaces/:workspaceId/groups/:groupId
  Auth: Admin only
  Notes: Deletes the group but not the members. Members remain in workspace.
  Response: { data: { message: "Group deleted." } }
```

---

### 4.7 — Container Endpoints

```
GET /workspaces/:workspaceId/containers
  Auth: Member of workspace
  Query: ?type=event|recurring&status=active|completed|archived&sort=-created_at
  Response: {
    data: {
      containers: [ContainerListItemObject],
      meta: { total, active_count, completed_count }
    }
  }

POST /workspaces/:workspaceId/containers
  Auth: Admin only
  Body: {
    name: string,
    subtitle?: string,
    container_type: 'event' | 'recurring',
    enable_money: boolean,
    enable_tasks: boolean,
    event_date?: string,        // ISO date, for events
    event_type?: string,        // free text
    event_type_category?: string,
    recurrence_cadence?: string,  // for recurring
    recurrence_days?: number,
    recurrence_start?: string,
    recurrence_end?: string,
    carry_forward_unpaid?: boolean,
    budget_target?: number,
    budget_currency?: string,
    description?: string
  }
  Validation:
    - name min 2 max 100 chars
    - If container_type = 'recurring': recurrence_cadence required, recurrence_start required
    - budget_currency must be a supported currency code
    - If enable_money = false: budget_target must be null
  Side effects:
    - For recurring containers: immediately schedules cycle generation job
  Response: { data: { container: ContainerObject } }
  Notes: Creator is NOT automatically added as a participant (admin manages this separately)

GET /workspaces/:workspaceId/containers/:containerId
  Auth: Member of workspace
  Response: {
    data: {
      container: ContainerObject,
      current_cycle?: ContainerCycleObject,  // for recurring containers
      participant_count: number,
      current_user_participation?: ParticipantObject
    }
  }

PATCH /workspaces/:workspaceId/containers/:containerId
  Auth: Admin only
  Body: { name?, subtitle?, description?, event_date?, event_type?, budget_target?,
          budget_currency?, cover_image_url?, visibility?, public_show_names?,
          carry_forward_unpaid?, recurrence_end? }
  Notes: container_type and enable_money/enable_tasks changes are RESTRICTED:
         - enable_money can be turned ON at any time
         - enable_money can be turned OFF only if no ledger entries exist
         - enable_tasks can be toggled freely
         - container_type is immutable after creation
  Response: { data: { container: ContainerObject } }

POST /workspaces/:workspaceId/containers/:containerId/complete
  Auth: Admin only
  Purpose: Mark container as completed
  Body: {
    outcome_details?: string,  // Summary for members who couldn't attend
    outcome_files?: [{ url: string, name: string, size: number }]
  }
  Validation:
    - Container must be in 'active' status
    - outcome_files: max 10 files, each max 50MB
  Side effects:
    - Sets container.status = 'completed', completed_at = NOW()
    - Sets outcome_details and outcome_files on container
    - Creates a timeline entry (auto-milestone) for completed events
    - Sends notification to all participants: "[Event] has been completed"
  Response: { data: { container: ContainerObject } }

POST /workspaces/:workspaceId/containers/:containerId/archive
  Auth: Admin only
  Body: {}
  Validation: Container must be 'active' or 'completed'
  Response: { data: { container: ContainerObject } }

POST /workspaces/:workspaceId/containers/:containerId/generate-public-link
  Auth: Admin only
  Purpose: Create (or regenerate) the public read-only link
  Body: {}
  Side effects: Sets containers.public_token = new random token
  Response: { data: { public_url: string, public_token: string } }

DELETE /workspaces/:workspaceId/containers/:containerId
  Auth: Admin only
  Validation:
    - If enable_money=true and any confirmed ledger entries exist: BLOCKED
    - If no financial history: allow soft delete (deleted_at = NOW())
    - Query param ?force=true allows soft delete even with pending (unconfirmed) entries
  Response: { data: { message: "Container archived." } }

GET /workspaces/:workspaceId/containers/:containerId/summary
  Auth: Member of workspace
  Purpose: The "who owes what" summary view
  Response: {
    data: {
      container: { id, name, status, budget_target, budget_currency },
      total_expected_base: number,
      total_confirmed_base: number,
      total_pending_base: number,
      progress_pct: number | null,  // null if no budget_target
      currency_breakdown: [{ currency, expected, confirmed }],
      participants: [
        {
          member_id: string,
          display_name: string,
          is_proxy: boolean,
          current_target?: { amount, currency, due_date },
          confirmed_paid: number,
          pending_paid: number,
          outstanding: number,
          status: 'paid' | 'partial' | 'pending' | 'overdue' | 'no_target',
          role?: string,
          // Admin only:
          ledger_entry_count?: number,
          last_activity?: timestamp
        }
      ]
    }
  }
  Role behavior:
    Admin: full detail for all participants (amounts, entry counts)
    Member: own row in full; other rows show display_name + status only (NO amounts)

POST /workspaces/:workspaceId/containers/:containerId/outcome-files/upload-url
  Auth: Admin only
  Body: { filename: string, content_type: string, file_size: number }
  Validation: file_size max 50MB, content_type must be image/* or application/pdf
  Response: { data: { upload_url: string, file_path: string, expires_in: 300 } }
  Notes: After upload completes, call PATCH /containers/:id to add file to outcome_files array

GET /public/containers/:publicToken
  Auth: None
  Purpose: Public read-only event view
  Response: {
    data: {
      name: string,
      subtitle?: string,
      event_date?: string,
      budget_target?: number,
      total_confirmed: number,
      progress_pct?: number,
      contributors?: [{ display_name, status }],  // amounts hidden; names hidden if public_show_names=false
      workspace_name: string
    }
  }
```

---

### 4.8 — Participant Endpoints

```
GET /workspaces/:workspaceId/containers/:containerId/participants
  Auth: Admin only
  Response: { data: { participants: [ParticipantWithTargetObject] } }

POST /workspaces/:workspaceId/containers/:containerId/participants
  Auth: Admin only
  Purpose: Add one or more participants to a container
  Body: {
    participants: [
      {
        workspace_member_id: string,
        money_enabled?: boolean,
        tasks_enabled?: boolean,
        role?: string,
        notes?: string,
        target?: {  // required if money_enabled=true
          amount: number,
          currency: string,
          due_date?: string
        }
      }
    ]
  }
  Validation:
    - All workspace_member_ids must belong to this workspace
    - Duplicate additions (already a participant) are silently skipped with a count in response
    - If container.enable_money=false, money_enabled must be false
    - If target provided: currency must be a supported currency code
  Response: {
    data: {
      added: [ParticipantObject],
      skipped_already_present: number
    }
  }

POST /workspaces/:workspaceId/containers/:containerId/participants/from-group
  Auth: Admin only
  Purpose: Add all members of a group to a container
  Body: { group_id: string, money_enabled?: boolean, tasks_enabled?: boolean }
  Response: { data: { added: number, skipped: number } }

PATCH /workspaces/:workspaceId/containers/:containerId/participants/:participantId
  Auth: Admin only
  Body: { money_enabled?, tasks_enabled?, role?, notes?, exclude_from_public? }
  Response: { data: { participant: ParticipantObject } }

DELETE /workspaces/:workspaceId/containers/:containerId/participants/:participantId
  Auth: Admin only
  Validation:
    - Cannot remove participant if they have confirmed ledger entries for this container
    - If only pending entries: allow removal, mark entries as reversed
  Response: { data: { message: "Participant removed." } }

POST /workspaces/:workspaceId/containers/:containerId/participants/:participantId/set-target
  Auth: Admin only
  Purpose: Set or change the contribution target (creates a new versioned target)
  Body: { amount: number, currency: string, due_date?: string }
  Validation:
    - amount must be positive
    - currency must be a supported code
    - container must have enable_money=true
  Side effects:
    - Marks previous target as superseded
    - Creates new contributor_targets record
    - Logs to member_profile_audit
  Response: { data: { target: ContributorTargetObject, previous_target?: ContributorTargetObject } }

GET /workspaces/:workspaceId/containers/:containerId/participants/:participantId/target-history
  Auth: Admin only
  Response: { data: { history: [ContributorTargetObject] } }
```

---

### 4.9 — Ledger Endpoints

```
GET /workspaces/:workspaceId/containers/:containerId/ledger
  Auth: Member of workspace
  Query: ?filter[status]=confirmed&filter[contributor_id]=uuid&sort=-recorded_at&page=1&per_page=20
  Response: { data: { entries: [LedgerEntryObject], meta: { total, pagination } } }
  Role behavior:
    Admin: all entries for all contributors
    Member: only their own entries
  Notes: This is the detailed ledger view. The /summary endpoint is for the "who owes what" view.

POST /workspaces/:workspaceId/containers/:containerId/ledger
  Auth: Admin OR member (members can only record for themselves)
  Purpose: Record a contribution or expense
  Body: {
    entry_type: 'contribution' | 'expense',
    contributor_id: string,      // required for contribution; must be self for non-admin
    original_amount: number,
    original_currency: string,
    payment_method?: string,
    note?: string,
    cycle_id?: string,           // for recurring containers
    is_crypto?: boolean
  }
  Validation:
    - original_amount > 0
    - contributor_id: admin can specify any participant; member can only specify themselves
    - If contributor_id is a proxy member: caller must be an admin
    - currency must be supported
    - If cycle_id specified: must belong to this container
  Processing:
    - Look up current exchange rate from workspace.currency_rates for the given currency
    - If no rate found: return 422 with message "No exchange rate set for {currency}. Please set one in workspace settings."
    - Calculate converted_amount = original_amount / rate
    - Set status:
        - If recorded by admin: status = 'confirmed', confirmed_at = NOW(), confirmed_by = admin
        - If recorded by member (themselves): status = 'pending'
    - If is_proxy member: create proxy_actions record
  Response: { data: { entry: LedgerEntryObject } }
  Idempotency: Check for near-duplicate entries (same contributor, same amount, same currency, within 10 minutes) — return warning but allow override with ?force=true

PATCH /workspaces/:workspaceId/containers/:containerId/ledger/:entryId
  Auth: Admin OR the contributor themselves (ONLY for pending entries)
  Purpose: Update a pending ledger entry
  Body (both admin and contributor can update): { original_amount?, original_currency?, payment_method?, note? }
  Body (admin only): { contributor_id? }  // re-attribute to different person
  Validation:
    - CRITICAL: If entry.status != 'pending', return 422 BUSINESS_RULE_VIOLATION: "Only pending entries can be edited."
    - Non-admin callers: contributor_id in entry must match their own workspace_member.id
    - Non-admin callers: cannot change contributor_id
  Side effects:
    - Recalculates converted_amount based on current exchange rate
    - If is_proxy member: creates proxy_actions record
  Response: { data: { entry: LedgerEntryObject } }

POST /workspaces/:workspaceId/containers/:containerId/ledger/:entryId/upload-proof
  Auth: Admin OR contributor themselves
  Purpose: Get a signed URL to upload payment proof
  Body: { filename: string, content_type: string, file_size: number }
  Validation:
    - file_size max 10MB
    - content_type must be image/* or application/pdf
    - Entry status must be 'pending' or 'proof_uploaded'
  Response: { data: { upload_url: string, file_path: string, expires_in: 300 } }

POST /workspaces/:workspaceId/containers/:containerId/ledger/:entryId/confirm-proof
  Auth: Admin OR contributor themselves
  Purpose: Confirm that proof has been uploaded (called after upload completes)
  Body: { file_path: string }
  Side effects:
    - Sets entry.proof_url = file_path, proof_uploaded_at = NOW()
    - If entry.status = 'pending': transitions to 'proof_uploaded'
    - Creates notification for admins: "Name uploaded payment proof for [event]"
  Response: { data: { entry: LedgerEntryObject } }

POST /workspaces/:workspaceId/containers/:containerId/ledger/:entryId/confirm
  Auth: Admin only
  Purpose: Confirm a pending entry as legitimate
  Body: { note?: string }
  Validation: Entry status must be 'pending' or 'proof_uploaded'
  Side effects:
    - Sets status = 'confirmed', confirmed_at = NOW(), confirmed_by = admin
    - Creates notification for contributor: "Your contribution has been confirmed"
    - If proxy member: creates proxy_actions record
  Response: { data: { entry: LedgerEntryObject } }

POST /workspaces/:workspaceId/containers/:containerId/ledger/:entryId/dispute
  Auth: Member of workspace (admin or contributor of the entry)
  Purpose: Flag a ledger entry as disputed
  Body: { reason: string }
  Validation:
    - Entry status must be 'confirmed' or 'pending'
    - Cannot dispute an entry you are not the contributor of (unless admin)
  Side effects:
    - Creates disputes record
    - Sets entry.status = 'disputed'
    - Entry is now frozen (no further status changes until resolved)
    - Creates notification for all admins: "Name has disputed a ledger entry"
  Response: { data: { dispute: DisputeObject, entry: LedgerEntryObject } }

POST /workspaces/:workspaceId/containers/:containerId/ledger/:entryId/add-correction
  Auth: Admin only
  Purpose: Create a correction entry (immutable principle — corrections are new entries)
  Body: {
    original_amount: number,
    original_currency: string,
    note: string  // required — must explain what is being corrected
  }
  Validation: Note is required and must be at least 10 characters
  Side effects:
    - Creates new ledger_entries record with entry_type = 'correction', corrects_entry_id = original entry id
    - Does NOT modify the original entry
  Response: { data: { correction_entry: LedgerEntryObject } }

GET /workspaces/:workspaceId/containers/:containerId/ledger/:entryId/proof-url
  Auth: Admin OR the contributor themselves
  Purpose: Get a time-limited signed URL for viewing proof
  Side effects: Writes to document_access_log equivalent (future: add access logging here)
  Response: { data: { download_url: string, expires_in: 900 } }

GET /workspaces/:workspaceId/ledger/export
  Auth: Admin only
  Query: ?container_id=uuid&from=date&to=date&format=csv
  Purpose: Export ledger as CSV
  Response: { data: { export_url: string, expires_in: 3600 } }
  Notes: Generates CSV file asynchronously and returns a signed download URL
```

---

### 4.10 — Dispute Endpoints

```
GET /workspaces/:workspaceId/disputes
  Auth: Admin only
  Query: ?status=open|resolved
  Response: { data: { disputes: [DisputeWithEntryObject] } }

GET /workspaces/:workspaceId/disputes/:disputeId
  Auth: Admin OR the contributor who raised the dispute
  Response: { data: { dispute: DisputeObject, entry: LedgerEntryObject, notes: [] } }

POST /workspaces/:workspaceId/disputes/:disputeId/note
  Auth: Admin OR the contributor who raised the dispute
  Purpose: Add a note to a dispute thread (append-only)
  Body: { note: string }
  Response: { data: { dispute: DisputeObject } }

POST /workspaces/:workspaceId/disputes/:disputeId/resolve
  Auth: Admin only
  Body: { resolution_note: string }
  Validation:
    - resolution_note required, min 10 characters
    - Dispute must be 'open'
  Side effects:
    - Sets dispute.status = 'resolved', resolution_note, resolved_by, resolved_at
    - Sets entry.status = 'resolved'
    - Creates notifications for both parties: "Dispute has been resolved"
  Response: { data: { dispute: DisputeObject } }
```

---

### 4.11 — Tasks Endpoints

```
GET /workspaces/:workspaceId/containers/:containerId/tasks
  Auth: Member of workspace
  Query: ?filter[assigned_to]=member_id&filter[status]=pending|completed&sort=due_date
  Response: { data: { tasks: [TaskObject] } }

POST /workspaces/:workspaceId/containers/:containerId/tasks
  Auth: Admin only (members cannot create tasks — admin assigns)
  Body: {
    title: string,
    description?: string,
    assigned_to?: string,  // workspace_member_id
    due_date?: string
  }
  Validation: title max 200 chars, assigned_to must be a participant of this container
  Response: { data: { task: TaskObject } }
  Side effects: If assigned_to set, creates notification: "You've been assigned: [task title]"

PATCH /workspaces/:workspaceId/containers/:containerId/tasks/:taskId
  Auth: Admin OR the assigned member (assigned member can update status, completion_note, proof)
  Body:
    Admin: { title?, description?, assigned_to?, due_date?, status?, sort_order? }
    Assigned member: { status?, completion_note? }
  Validation:
    - Assigned member can only set status to 'in_progress' or 'completed'
    - status 'cancelled' is admin-only
  Side effects:
    - If status changes to 'completed': sets completed_at, completed_by; notifies admin
    - If assigned_to changes: notifies new assignee
  Response: { data: { task: TaskObject } }

POST /workspaces/:workspaceId/containers/:containerId/tasks/:taskId/upload-proof
  Auth: Admin OR assigned member
  Body: { filename: string, content_type: string }
  Response: { data: { upload_url: string, file_path: string } }

DELETE /workspaces/:workspaceId/containers/:containerId/tasks/:taskId
  Auth: Admin only
  Notes: Soft delete — sets deleted_at
  Response: 204 No Content
```

---

### 4.12 — Document Endpoints

```
GET /workspaces/:workspaceId/documents
  Auth: Member of workspace
  Query: ?category=legal|identity&filter[expiring_soon]=true&sort=-uploaded_at
  Response: { data: { documents: [DocumentListItemObject] } }
  Role behavior:
    Admin: sees all documents including admins_only and named_members
    Member: sees 'all_members' documents + documents where they have explicit access
    Note: Filtering is applied in the API layer, not via RLS

POST /workspaces/:workspaceId/documents/upload-url
  Auth: Admin only (for now)
  Body: { filename: string, content_type: string, file_size: number }
  Validation: file_size max 50MB
  Response: { data: { upload_url: string, file_path: string, expires_in: 300 } }

POST /workspaces/:workspaceId/documents
  Auth: Admin only
  Purpose: Create document record after file has been uploaded to storage
  Body: {
    name: string,
    category: string,
    file_path: string,
    file_size_bytes: number,
    mime_type: string,
    access_tier: string,
    description?: string,
    expiry_date?: string,
    allowed_member_ids?: string[]  // for 'named_members' access tier
  }
  Response: { data: { document: DocumentObject } }

GET /workspaces/:workspaceId/documents/:documentId/download-url
  Auth: Member with access
  Purpose: Get time-limited signed URL for download
  Validation:
    - Check access_tier against requester's role
    - For 'named_members': check document_access table
    - Unauthorized: return 404 (not 403)
  Side effects: Writes to document_access_log
  Response: { data: { download_url: string, expires_in: 900 } }

PATCH /workspaces/:workspaceId/documents/:documentId
  Auth: Admin only
  Body: { name?, category?, description?, access_tier?, expiry_date?, allowed_member_ids? }
  Response: { data: { document: DocumentObject } }

DELETE /workspaces/:workspaceId/documents/:documentId
  Auth: Admin only
  Notes: Soft delete — sets deleted_at. Files are NOT deleted from storage immediately.
         Hard delete from storage is handled by a separate cleanup job (Phase 2).
  Response: 204 No Content
```

---

### 4.13 — Timeline + Milestones Endpoints

```
GET /workspaces/:workspaceId/timeline
  Auth: Member of workspace
  Purpose: Combined timeline of completed containers + milestones
  Query: ?limit=50&before=timestamp
  Response: {
    data: {
      items: [
        {
          type: 'container_completed' | 'milestone',
          date: string,
          title: string,
          description?: string,
          photo_url?: string,
          reference_id?: string,
          reference_type?: string
        }
      ]
    }
  }
  Notes: Items are sorted newest-first. Completed containers auto-appear here.

POST /workspaces/:workspaceId/milestones
  Auth: Admin only
  Body: { title: string, milestone_date: string, description?: string, photo_url?: string, milestone_type: string }
  Response: { data: { milestone: MilestoneObject } }

PATCH /workspaces/:workspaceId/milestones/:milestoneId
  Auth: Admin only
  Body: { title?, description?, milestone_date?, photo_url?, milestone_type? }
  Response: { data: { milestone: MilestoneObject } }

DELETE /workspaces/:workspaceId/milestones/:milestoneId
  Auth: Admin only
  Notes: Soft delete
  Response: 204 No Content
```

---

### 4.14 — Notification Endpoints

```
GET /notifications
  Auth: Required
  Query: ?workspace_id=uuid&is_read=false&page=1&per_page=20
  Response: {
    data: {
      notifications: [NotificationObject],
      unread_count: number,
      meta: { pagination: {} }
    }
  }

PATCH /notifications/:notificationId/read
  Auth: Recipient only
  Body: {}
  Response: { data: { notification: NotificationObject } }

PATCH /notifications/read-all
  Auth: Required
  Body: { workspace_id?: string }  // if provided, marks all in that workspace as read
  Response: { data: { updated_count: number } }
```

---

## PART 5: CONTAINER SYSTEM

### 5.1 — Unified Container Model Philosophy

The container replaces the separate "events" and "recurring pools" concepts from the previous architecture. A container is a coordination space that can hold:
- Money tracking (optional)
- Task assignments (optional)
- Neither (information-only)
- Both simultaneously

This flexibility allows the same data model to serve:
- A wedding with both financial contributions and task assignments
- A monthly parent support pool (money only)
- A family reunion planning board (tasks only, no money)
- A simple event record (no tracking at all)

---

### 5.2 — One-Time Event Lifecycle

```
DRAFT (frontend only, not saved) 
  → Created: status='active'
    → Participants added, targets set
      → Contributions recorded → confirmed
        → status='completed' (admin marks complete, writes outcome_details)
          → status='archived' (optional final state)

At any point: status='cancelled' (no ledger data) or status='archived' (preserve history)
```

**Auto-transition rules:**
- No auto-transitions. All status changes are explicit admin actions.
- Exception: Background job sets `container_tasks.status = 'overdue'` when `due_date < TODAY` and `status = 'pending'`.

---

### 5.3 — Recurring Container Cycle System

**Setup:** When a recurring container is created with `recurrence_cadence = 'monthly'` and `recurrence_start = '2025-04-01'`:

1. The BullMQ `cycle-generation-queue` receives a job immediately.
2. The job generates the next 3 months of cycles (to prevent the service from having to be running on the exact start date).
3. Cycles are created in `container_cycles` table.

**Cycle generation algorithm:**
```
For each upcoming cycle (up to 3 months ahead):
  cycle_number = last_cycle_number + 1
  cycle_start = previous_cycle_end + 1 day
  cycle_end = cycle_start + (days in cadence) - 1

  Check pool_cycle_overrides for this period:
    - If 'pause_pool' override exists: create cycle with status='skipped'
    - Otherwise: create cycle with status='upcoming' if start > today, 'open' if start <= today

  For each active participant in this container:
    - Check for 'skip_member' or 'adjust_target' override for this cycle
    - Create/update contributor_targets for this cycle
```

**Opening and closing cycles:**
- `upcoming` → `open`: Background job runs daily and opens cycles whose `cycle_start <= TODAY`.
- `open` → `closed`: Background job runs at `cycle_end + 1 day`. Before closing, check carry_forward_unpaid.

**Carry-forward logic:**
```
If container.carry_forward_unpaid = TRUE and cycle is being closed:
  For each participant in this cycle:
    outstanding = target_amount - confirmed_paid
    If outstanding > 0:
      Create new ledger_entries record in the NEXT cycle:
        entry_type = 'carry_forward'
        original_amount = outstanding
        contributor_id = participant
        note = "Carried forward from cycle #{n}"
```

**Long-term history:**
Closed cycles are preserved permanently. The full contribution history is always accessible via the ledger filtered by cycle_id.

---

### 5.4 — Task System within Containers

Tasks are independent of money tracking. A container with `enable_tasks = TRUE` and `enable_money = FALSE` is a pure task board.

**Task status transitions (enforced in API):**
```
pending → in_progress (assigned member or admin)
pending → completed (assigned member or admin — direct completion without in_progress)
pending → cancelled (admin only)
in_progress → completed (assigned member or admin)
in_progress → cancelled (admin only)
completed ↛ anything (completed is terminal)
overdue: Set by background job — no manual transition
```

**Task visibility:**
- All participants of the container can see all tasks.
- Members can only update tasks assigned to them.
- Admins can update any task.

---

### 5.5 — Share Summary Feature

The `GET /containers/:id/summary` endpoint returns all the data needed to generate a shareable text summary on the frontend.

**Frontend-generated share text:**
```
[Event Name]
[Subtitle if set]
Date: [event_date if set]

Target: [budget_currency] [budget_target] | Collected: [total_confirmed_base] ([progress_pct]%)

Outstanding:
• [name]: [outstanding] [currency] (due [due_date])
• [name]: [outstanding] [currency] (due [due_date])

Track live: [public_url if set]
```

Clicking "Share Summary" copies this to clipboard. No server call needed — computed from summary endpoint data.

**Copy Reminder feature (per contributor row):**
```
Hi [display_name], just a reminder about your contribution for [event_name]: 
[target_amount] [currency] due [due_date]. 
Please pay via: [workspace bank_details or event-specific note].
Thanks!
```

Bank details pulled from `workspace.bank_details` JSONB. Can be overridden per event via notes.

---

---

## PART 6: NOTIFICATION SYSTEM

### 6.1 — Notification Channels

Kith supports three delivery channels:

| Channel | Phase | Mechanism |
|---|---|---|
| In-app | Phase 1 | Database record + polling (60s interval) |
| Push (web) | Phase 1 | Firebase Cloud Messaging via service worker |
| Email | Phase 1 | Resend API |

Every notification creates an in-app record in `notifications` table. Push and email are attempted additionally based on user preferences and channel availability.

---

### 6.2 — Notification Preference Hierarchy

1. **User-level preferences** (`users.push_enabled`, `users.quiet_hours_*`) — governs whether push/email is sent at all.
2. **Workspace-level defaults** (`workspace_settings['notification_prefs']`) — governs timing of reminders.
3. **Notification type** — some types (e.g., dispute raised, admin announcement) bypass quiet hours due to importance.

**Quiet hours enforcement:**
If `users.quiet_hours_start` and `users.quiet_hours_end` are set, push and email notifications are queued and delivered at `quiet_hours_end` instead of immediately. In-app records are always created immediately.

---

### 6.3 — Notification Templates

All notification content is generated in the Node.js service layer, not hardcoded in the database. Templates use string interpolation with a defined variable set.

**Template variable set:**
```
{member_name}    - recipient's display_name
{actor_name}     - name of person who triggered the event
{container_name} - name of container
{amount}         - formatted amount with currency
{currency}       - currency code
{due_date}       - formatted date
{workspace_name} - workspace name
{event_date}     - container's event_date
```

**Notification type registry:**

| type | Title template | Body template | Channels | Bypasses quiet hours? |
|---|---|---|---|---|
| `contribution_submitted` | "New contribution pending" | "{actor_name} submitted {amount} for {container_name}" | in_app, push | No |
| `contribution_confirmed` | "Your contribution confirmed" | "Your {amount} contribution to {container_name} was confirmed" | in_app, push | No |
| `contribution_disputed` | "Contribution disputed" | "{actor_name} disputed a {amount} entry in {container_name}" | in_app, push, email | Yes |
| `dispute_resolved` | "Dispute resolved" | "The dispute in {container_name} has been resolved" | in_app, push | No |
| `task_assigned` | "New task assigned" | "{actor_name} assigned you: {task_title}" | in_app, push | No |
| `task_completed` | "Task completed" | "{actor_name} completed: {task_title}" | in_app | No |
| `task_overdue` | "Task overdue" | "{task_title} was due {due_date} and hasn't been completed" | in_app, push | No |
| `document_expiring_30d` | "Document expiring soon" | "{document_name} expires in 30 days" | in_app, email | No |
| `document_expiring_7d` | "Document expiring soon" | "{document_name} expires in 7 days. Please renew." | in_app, push, email | Yes |
| `invite_accepted` | "New family member joined" | "{actor_name} accepted your invite and joined {workspace_name}" | in_app | No |
| `payment_reminder` | "Contribution reminder" | "Friendly reminder: {amount} for {container_name} is due {due_date}" | in_app, push | No |
| `overdue_reminder` | "Overdue contribution" | "Your contribution for {container_name} is now overdue" | in_app, push | No |
| `cycle_started` | "New {cadence} cycle started" | "{container_name} — {cadence} cycle started. Your contribution: {amount}" | in_app | No |
| `cycle_closing_soon` | "Pool cycle ending soon" | "{container_name} cycle ends {due_date}. You have {outstanding} remaining." | in_app, push | No |
| `container_completed` | "Event completed" | "{container_name} has been marked complete. {outcome_summary}" | in_app, push | No |
| `admin_announcement` | Custom | Custom | in_app, push, email | Yes |
| `overdue_summary_admin` | "Overdue contributions summary" | "{count} contributors are overdue in {container_name}" | in_app | No |

---

### 6.4 — Notification Creation Service

A centralized `NotificationService` is the only way to create notifications. Direct inserts to the `notifications` table are forbidden from controllers.

```
NotificationService.send({
  type: string,
  workspace_id: string,
  recipient_ids: string[],  // workspace_member IDs
  reference_type?: string,
  reference_id?: string,
  variables: { [key: string]: string | number }
})
```

Internally, this:
1. Looks up each recipient's `user_id` (null for proxy members — skip external channels)
2. Renders title and body from template + variables
3. Generates a `dedup_key` to prevent duplicates (e.g., `reminder:entry_id:DATE`)
4. Inserts into `notifications` (skips if dedup_key already exists)
5. Creates `notification_deliveries` records for each applicable channel
6. Pushes a job to `notification-queue` for each delivery record

**Deduplication:** Before inserting, check `SELECT 1 FROM notifications WHERE dedup_key = ?`. If exists, skip.

---

### 6.5 — Push Notification Delivery

**Firebase setup:**
The Node.js backend uses the Firebase Admin SDK. It holds the service account credentials (environment variable). The frontend registers for push using Firebase JS SDK and sends the FCM token to `PATCH /auth/push-token`.

**Delivery flow:**
1. `notification-queue` worker picks up delivery job
2. Fetch recipient's `users.push_token` and `users.push_enabled`
3. Check quiet hours — if in quiet hours: schedule for delivery at `quiet_hours_end`
4. Call Firebase Admin SDK: `admin.messaging().send({ token, notification: { title, body }, data: { reference_type, reference_id, workspace_id } })`
5. On success: update `notification_deliveries.status = 'delivered'`
6. On failure: increment `retry_count`, schedule retry with exponential backoff (see Part 7)

**Service worker handling:**
When a push message arrives, the service worker:
1. Calls `self.registration.showNotification(title, { body, data })`
2. On notification click: `clients.openWindow('/w/{workspace_id}/...')` based on `reference_type`

---

### 6.6 — Email Notification Delivery

**Resend integration:**
- Template: plain HTML email using Resend's API
- From: `Kith <notifications@kith.app>`
- Reply-to: `support@kith.app`

**Email templates:** Stored as HTML strings in the codebase (not database). Variables interpolated server-side. Three template types:
1. **Action needed** — disputes, overdue, expiring documents (prominent CTA button)
2. **Information** — confirmations, completions (no urgent CTA)
3. **Summary** — weekly digest format (list of items, aggregated)

---

### 6.7 — Reminder Escalation Logic

**For contribution reminders:**
1. 3 days before `due_date`: send `payment_reminder` to contributor (if target not met)
2. 1 day before `due_date`: send `payment_reminder` again (if still not met)
3. On `due_date`: send `overdue_reminder` to contributor
4. 3 days after `due_date`: send `overdue_summary_admin` to all workspace admins

Days-before values are configurable via `workspace_settings['notification_prefs']['reminder_days_before']`.

**For recurring pool cycles:**
1. Cycle opens: send `cycle_started` to all participants with outstanding balances
2. 3 days before `cycle_end`: send `cycle_closing_soon` to participants with outstanding amounts
3. Day of `cycle_end`: final reminder

---

### 6.8 — Member Engagement View (Admin Only)

Available via `GET /workspaces/:id/members/engagement` — admin only.

```json
{
  "members": [
    {
      "member_id": "...",
      "display_name": "Uncle Emeka",
      "last_activity": "2025-03-28",
      "confirmed_contributions_count": 12,
      "pending_contributions_count": 1,
      "overdue_count": 0,
      "engagement_level": "active"  // 'active' | 'quiet' | 'inactive'
    }
  ]
}
```

**Engagement levels (computed, not stored):**
- `active`: had confirmed contribution or task completion in last 30 days
- `quiet`: last activity 31–90 days ago
- `inactive`: no activity in 90+ days

This is read-only data for admin awareness. Never surfaced to non-admin members.

---

## PART 7: ASYNC JOBS — BullMQ + REDIS

### 7.1 — Infrastructure Setup

**Queue management:** BullMQ on Upstash Redis.
**Worker process:** A separate Node.js process (or the same process with dedicated worker threads in Phase 1) runs the BullMQ workers. In production, this can be a separate Railway service.

**Global job options:**
```javascript
const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },  // 5s, 25s, 125s
  removeOnComplete: { age: 86400 },  // keep completed jobs for 24h
  removeOnFail: false   // keep failed jobs forever (for dead-letter inspection)
};
```

---

### 7.2 — Queue Registry

```
┌──────────────────────────────────┬─────────────────────────────────────────────┐
│ Queue Name                       │ Purpose                                     │
├──────────────────────────────────┼─────────────────────────────────────────────┤
│ notification-queue               │ Deliver individual notification to a channel │
│ reminder-queue                   │ Check and send due/overdue reminders         │
│ cycle-generation-queue           │ Generate upcoming cycles for recurring pools │
│ cycle-lifecycle-queue            │ Open upcoming cycles, close expired cycles   │
│ expiry-check-queue               │ Check documents for expiring soon            │
│ task-overdue-queue               │ Mark tasks as overdue                        │
│ invite-cleanup-queue             │ Delete expired invite_links                  │
│ engagement-check-queue           │ Update member engagement metrics             │
└──────────────────────────────────┴─────────────────────────────────────────────┘
```

---

### 7.3 — Queue Definitions

#### `notification-queue`

**Producer:** `NotificationService.send()` — called from API controllers and other workers.
**Consumer:** `NotificationWorker`

**Job payload:**
```typescript
interface NotificationJob {
  notification_id: string;
  delivery_id: string;
  channel: 'push' | 'email' | 'in_app';
  recipient_user_id: string | null;  // null for proxy members
  push_token?: string;
  email?: string;
  title: string;
  body: string;
  reference_type?: string;
  reference_id?: string;
  workspace_id?: string;
  scheduled_for?: Date;  // for quiet hours delay
}
```

**Worker logic:**
```
1. If scheduled_for > NOW(): delay (re-queue with delay until scheduled_for)
2. If channel = 'push':
   a. Verify push_token is still valid (check users.push_token hasn't changed)
   b. Call Firebase Admin SDK
   c. On success: UPDATE notification_deliveries SET status='delivered', delivered_at=NOW()
   d. On failure: throw error — BullMQ handles retry with backoff
3. If channel = 'email':
   a. Call Resend API
   b. Handle same way as push
4. If channel = 'in_app':
   a. Record already created — mark delivery as 'delivered' immediately
```

**Retry policy:** 3 attempts with exponential backoff (5s, 25s, 125s).
**Dead-letter handling:** After 3 failures, job remains in failed state. Ops dashboard shows failed jobs for manual replay.
**Idempotency:** Before delivering, check `notification_deliveries.status`. If already 'delivered', skip.

---

#### `reminder-queue`

**Producer:** Scheduled job — runs daily at 07:00 UTC via BullMQ's `repeat` feature.
**Consumer:** `ReminderWorker`

**Job payload:**
```typescript
interface ReminderScanJob {
  scan_date: string;  // ISO date string — the date to check against
  workspace_id?: string;  // if set, only scan this workspace (for targeted runs)
}
```

**Worker logic:**
```
1. Get all active containers with enable_money = TRUE
2. For each container, get all contributors with outstanding balances
3. For each contributor:
   a. Check current_target.due_date
   b. days_until_due = DATEDIFF(due_date, scan_date)
   c. Retrieve workspace reminder_days_before setting (default: [3, 1])
   d. If days_until_due IN reminder_days_before AND target not yet met:
      - Check dedup_key 'reminder:{participant_id}:{container_id}:{due_date}:{days_until_due}d'
      - If no dedup match: send 'payment_reminder' notification
   e. If days_until_due < 0 AND target not met (overdue):
      - days_overdue = abs(days_until_due)
      - If days_overdue IN overdue_escalation_days (default: [1, 3, 7]):
        - Send 'overdue_reminder' to contributor
      - If days_overdue = 3 (or configured threshold):
        - Send 'overdue_summary_admin' to all admins (aggregate — not one per contributor)
```

**Idempotency:** Uses `dedup_key` in notifications table. Safe to run multiple times per day.

---

#### `cycle-generation-queue`

**Producer:**
- On container creation (recurring type) — immediate job
- Daily scheduler job — checks if any recurring container needs new cycles

**Job payload:**
```typescript
interface CycleGenerationJob {
  container_id: string;
  generate_months_ahead: number;  // default: 3
}
```

**Worker logic:**
```
1. Load container and its recurrence settings
2. Find the last generated cycle (MAX cycle_number)
3. Calculate next cycle_start = last_cycle_end + 1 day
4. Generate cycles until we have generate_months_ahead months of future cycles
5. For each new cycle:
   a. Check pool_cycle_overrides for 'pause_pool' — if found, status='skipped'
   b. Create container_cycles record
   c. For each active participant:
      - Check for 'skip_member' override — if found, skip this participant for this cycle
      - Check for 'adjust_target' override — use adjusted amount if found
      - Otherwise: get current contributor_targets for participant (non-cycle-specific current target)
      - Create contributor_targets record for this cycle
6. Idempotency: use UNIQUE(container_id, cycle_start) constraint — ON CONFLICT DO NOTHING
```

---

#### `cycle-lifecycle-queue`

**Producer:** Daily scheduler — runs at 00:01 UTC.
**Consumer:** `CycleLifecycleWorker`

**Job payload:**
```typescript
interface CycleLifecycleJob {
  check_date: string;  // today's date
}
```

**Worker logic:**
```
OPEN UPCOMING CYCLES:
  SELECT * FROM container_cycles WHERE status = 'upcoming' AND cycle_start <= check_date
  For each:
    UPDATE status = 'open'
    Send 'cycle_started' notifications to all participants in this container

CLOSE EXPIRED CYCLES:
  SELECT * FROM container_cycles WHERE status = 'open' AND cycle_end < check_date
  For each:
    1. Load all participants + their ledger totals for this cycle
    2. If container.carry_forward_unpaid = TRUE:
       - For each participant with outstanding balance:
         - Find next open cycle (or create it)
         - Create ledger_entries record: entry_type='carry_forward' in next cycle
    3. UPDATE cycle status = 'closed', closed_at = NOW()
    4. Calculate total_collected for this cycle
    5. Queue cycle-generation-queue job to ensure next months are generated
```

---

#### `expiry-check-queue`

**Producer:** Daily scheduler — runs at 08:00 UTC.
**Consumer:** `ExpiryCheckWorker`

**Job payload:**
```typescript
interface ExpiryCheckJob {
  check_date: string;
}
```

**Worker logic:**
```
30-day alerts:
  SELECT * FROM documents
  WHERE expiry_date BETWEEN check_date AND check_date + 30
  AND expiry_alert_30d_sent = FALSE
  AND deleted_at IS NULL
  
  For each:
    Send 'document_expiring_30d' to all workspace admins
    UPDATE documents SET expiry_alert_30d_sent = TRUE

7-day alerts:
  SELECT * FROM documents
  WHERE expiry_date BETWEEN check_date AND check_date + 7
  AND expiry_alert_7d_sent = FALSE
  AND deleted_at IS NULL
  
  For each:
    Send 'document_expiring_7d' to all workspace admins
    UPDATE documents SET expiry_alert_7d_sent = TRUE
```

**Idempotency:** `expiry_alert_30d_sent` and `expiry_alert_7d_sent` flags prevent re-sending. Safe to run multiple times.

---

#### `task-overdue-queue`

**Producer:** Daily scheduler — runs at 06:00 UTC.
**Consumer:** `TaskOverdueWorker`

```
SELECT * FROM container_tasks
WHERE due_date < check_date AND status = 'pending' AND deleted_at IS NULL

For each:
  UPDATE status = 'overdue'
  Send 'task_overdue' notification to assigned member and workspace admins
```

---

#### `invite-cleanup-queue`

**Producer:** Daily scheduler — runs at 02:00 UTC.
**Consumer:** `InviteCleanupWorker`

```
DELETE FROM invite_links WHERE expires_at < NOW() AND used_at IS NULL
```

Simple hard delete of expired, unused tokens.

---

#### `engagement-check-queue`

**Producer:** Weekly scheduler — runs every Sunday at 06:00 UTC.
**Consumer:** `EngagementWorker`

```
For each workspace:
  For each active member (is_proxy = FALSE):
    - Count confirmed contributions in last 30 days
    - Count task completions in last 30 days
    - Find last activity date

This data is used by the member engagement view (GET /members/engagement).
No notifications generated — this is analytics only.
```

---

### 7.4 — Scheduler Setup (BullMQ Repeatable Jobs)

```javascript
// In worker initialization
const scheduler = new Queue('kith-scheduler', { connection: redis });

// Daily jobs
await scheduler.add('reminder-scan', { scan_date: 'auto' }, {
  repeat: { cron: '0 7 * * *' }  // 07:00 UTC daily
});

await scheduler.add('cycle-lifecycle', { check_date: 'auto' }, {
  repeat: { cron: '1 0 * * *' }  // 00:01 UTC daily
});

await scheduler.add('expiry-check', {}, {
  repeat: { cron: '0 8 * * *' }  // 08:00 UTC daily
});

await scheduler.add('task-overdue-check', {}, {
  repeat: { cron: '0 6 * * *' }  // 06:00 UTC daily
});

await scheduler.add('invite-cleanup', {}, {
  repeat: { cron: '0 2 * * *' }  // 02:00 UTC daily
});

// Weekly
await scheduler.add('engagement-check', {}, {
  repeat: { cron: '0 6 * * 0' }  // Sunday 06:00 UTC
});
```

---

### 7.5 — Dead-Letter Strategy

Failed jobs (3 retries exhausted) remain in the BullMQ failed state indefinitely.

**Alerting:** A separate monitoring job checks for failed jobs every 15 minutes. If any failed jobs are found in critical queues (`notification-queue`, `cycle-lifecycle-queue`), it sends an alert to the ops Slack channel.

**Manual replay:** Admin ops dashboard (internal) shows failed jobs and allows manual retry. Bull Board UI (npm: `@bull-board/express`) mounted at `/admin/queues` behind IP restriction.

---

## PART 8: AUTHORIZATION + RESTRICTIONS

### 8.1 — Permission Matrix

Every API operation is checked against this matrix.

| Operation | Admin | Member | Proxy | Notes |
|---|---|---|---|---|
| View workspace details | ✓ | ✓ | — | Proxies can't log in |
| Edit workspace settings | ✓ | ✗ | — | |
| Invite members | ✓ | ✗ | — | |
| Add proxy members | ✓ | ✗ | — | |
| Edit other members' family-facing fields | ✓ | ✗ | — | display_name, relationship, etc. |
| Edit own contact info | — | ✓ | — | phone, email, WhatsApp, social, location, timezone |
| View all members' contact info | ✓ | ✗ | — | Members can only see their own |
| Remove members | ✓ | ✗ | — | Cannot remove self if last admin |
| Create containers | ✓ | ✗ | — | Phase 1: admin-only |
| Edit containers | ✓ | ✗ | — | |
| Add participants to containers | ✓ | ✗ | — | |
| Set contribution targets | ✓ | ✗ | — | |
| Record contribution (for self) | ✓ | ✓ | — | Members record own contributions |
| Record contribution (for others) | ✓ | ✗ | — | Admin only |
| Record contribution (for proxy) | ✓ | ✗ | — | Only admin can act for proxy |
| Edit own PENDING ledger entry | ✓ | ✓ | — | Only pending, only own entry |
| Edit others' ledger entries | ✓ | ✗ | — | Admin only |
| Confirm ledger entries | ✓ | ✗ | — | |
| Dispute own ledger entry | ✓ | ✓ | — | Must be the contributor |
| Dispute others' ledger entries | ✓ | ✗ | — | |
| Resolve disputes | ✓ | ✗ | — | |
| Add corrections (new entries) | ✓ | ✗ | — | |
| View full ledger (all contributors) | ✓ | ✗ | — | Members see own entries only |
| Create/edit tasks | ✓ | ✗ | — | |
| Complete own tasks | ✓ | ✓ | — | Assigned member can complete |
| Mark others' tasks complete | ✓ | ✗ | — | |
| Upload documents | ✓ | ✗ | — | Phase 1: admin only |
| View all_members documents | ✓ | ✓ | — | |
| View admins_only documents | ✓ | ✗ | — | |
| View named_members documents | ✓ | ✓ | — | Only if in document_access |
| Manage document access | ✓ | ✗ | — | |
| Add milestones | ✓ | ✗ | — | |
| Create decisions | ✓ | ✗ | — | (Phase 2) |
| Mark containers complete | ✓ | ✗ | — | |
| Archive containers | ✓ | ✗ | — | |
| View member engagement data | ✓ | ✗ | — | Admin-only |
| View admin_notes on members | ✓ | ✗ | — | |
| Set exchange rates | ✓ | ✗ | — | |
| Generate invite links | ✓ | ✗ | — | |
| Set pool overrides | ✓ | ✗ | — | Pause pool, skip member |

---

### 8.2 — Enforcement Architecture (3-Layer Defense)

**Layer 1: JWT Middleware**
All `/w/:workspaceId` routes require a valid Supabase JWT. Invalid or missing JWT → 401.
```javascript
async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) return res.status(401).json({ error: { code: 'UNAUTHORIZED' } });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: { code: 'UNAUTHORIZED' } });
  req.auth_user = user;
  next();
}
```

**Layer 2: Workspace Membership Middleware**
Any route under `/workspaces/:workspaceId` must verify the user is an active member.
```javascript
async function requireWorkspaceMember(req, res, next) {
  const { workspaceId } = req.params;
  const member = await db.query(
    `SELECT id, role, is_proxy FROM workspace_members 
     WHERE workspace_id = $1 AND user_id = $2 AND is_active = TRUE AND deleted_at IS NULL`,
    [workspaceId, req.auth_user.id]
  );
  if (!member.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
  req.workspace_member = member.rows[0];
  next();
}
```
Note: Returns 404, not 403 — never confirm that a workspace exists to unauthorized users.

**Layer 3: Role Guard Middleware**
```javascript
function requireAdmin(req, res, next) {
  if (req.workspace_member.role !== 'admin') {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admin access required.' } });
  }
  next();
}
```

**Layer 4: Resource-level checks (in controllers)**
Ownership checks (e.g., "can this member edit this ledger entry?") are enforced in the controller body, not middleware:
```javascript
// In PATCH /ledger/:entryId controller
if (req.workspace_member.role !== 'admin') {
  if (entry.contributor_id !== req.workspace_member.id) {
    return res.status(404).json({ error: { code: 'NOT_FOUND' } });
  }
  if (entry.status !== 'pending') {
    return res.status(422).json({ error: { code: 'BUSINESS_RULE_VIOLATION', message: 'Only pending entries can be edited.' } });
  }
}
```

---

### 8.3 — Immutability Protections

**Ledger entries — immutability rules enforced in API layer:**
```
Once status = 'confirmed':
  BLOCKED: UPDATE original_amount
  BLOCKED: UPDATE original_currency
  BLOCKED: UPDATE converted_amount
  BLOCKED: UPDATE exchange_rate
  BLOCKED: UPDATE contributor_id
  BLOCKED: UPDATE entry_type
  BLOCKED: UPDATE recorded_by
  BLOCKED: DELETE

Allowed on confirmed entries:
  ALLOWED: Create a new 'correction' or 'reversal' entry referencing this one
  ALLOWED: Admin adds note (append to existing note, never overwrite)

For pending entries only:
  ALLOWED: UPDATE original_amount, original_currency, payment_method, note, proof_url
  ALLOWED: DELETE (only admin can delete pending entries; contributor can only edit, not delete)
```

**Dispute notes — append-only:**
```
disputes.notes JSONB array is append-only.
INSERT new note object into array using:
  UPDATE disputes SET notes = notes || $new_note_jsonb WHERE id = $dispute_id
Never overwrite or remove from this array.
```

**Profile audit — insert only:**
```
member_profile_audit table: no UPDATE, no DELETE ever.
INSERT only. Forever.
```

**Document access log — insert only:**
```
document_access_log table: no UPDATE, no DELETE ever.
```

---

### 8.4 — Race Condition Prevention

**Duplicate contribution prevention:**
Before inserting a ledger entry, check for near-duplicate:
```sql
SELECT id FROM ledger_entries
WHERE contributor_id = $1
AND container_id = $2
AND original_amount = $3
AND original_currency = $4
AND recorded_at > NOW() - INTERVAL '10 minutes'
AND status NOT IN ('reversed', 'resolved')
```
If match found: return 409 with `X-Duplicate-Warning: true` header and suggested resolution. Client can re-submit with `?force=true` to override.

**Concurrent target updates:**
Use optimistic locking on `contributor_targets`:
- Request payload must include `current_target_id`
- Controller verifies `is_current = TRUE` for that target before marking superseded
- If `is_current` is already FALSE (another request beat this one): return 409

**Concurrent invite acceptance:**
Use a database transaction with SELECT FOR UPDATE:
```sql
BEGIN;
SELECT id, used_at FROM invite_links WHERE token = $1 FOR UPDATE;
-- Check used_at IS NULL
UPDATE invite_links SET used_at = NOW(), used_by_user_id = $2 WHERE id = $3;
INSERT INTO workspace_members (...) ON CONFLICT (workspace_id, user_id) DO NOTHING;
COMMIT;
```

**Last admin protection:**
Before any role change or member removal:
```sql
SELECT COUNT(*) FROM workspace_members 
WHERE workspace_id = $1 AND role = 'admin' AND is_active = TRUE AND deleted_at IS NULL
```
If count = 1 and the operation would remove/demote the last admin: return 422.

---

### 8.5 — Financial Visibility Enforcement

These rules are enforced in the API response shaping layer, not in the database query layer.

**Container summary endpoint — role-based response shaping:**
```javascript
function shapeSummaryForRole(participants, callerMemberId, callerRole) {
  if (callerRole === 'admin') {
    return participants;  // full data
  }
  return participants.map(p => {
    if (p.member_id === callerMemberId) {
      return p;  // own row — full detail
    }
    // Other members: name + status only
    return {
      member_id: p.member_id,
      display_name: p.display_name,
      is_proxy: p.is_proxy,
      role: p.role,
      status: p.status,
      exclude_from_public: p.exclude_from_public
      // current_target: OMITTED
      // confirmed_paid: OMITTED
      // outstanding: OMITTED
    };
  });
}
```

**Ledger endpoint — member can only see own entries:**
```sql
-- For non-admin callers, the WHERE clause always includes:
AND contributor_id = $caller_member_id
```

---

### 8.6 — Edit Windows and Abuse Prevention

**Soft delete grace period for events:**
When a container is soft-deleted, it is recoverable by admin for 30 days via a `/restore` endpoint (not in Phase 1 — log the deletion and provide support recovery).

**Proof URL expiry:**
- Upload URLs: expire 5 minutes after generation
- Download URLs: expire 15 minutes after generation
- Never return a static file URL — always a fresh signed URL

**Invite link reuse prevention:**
- `used_at` check before acceptance — one-time use
- `expires_at` check — 7-day expiry
- Admin can delete links to prevent further use

**Rate limiting:**
Applied via `express-rate-limit` middleware:
```
Auth endpoints: 5 requests per minute per IP
Invite acceptance: 10 per hour per IP
File upload URLs: 20 per hour per user
General API: 200 per minute per user
```

---

### 8.7 — Proxy Member Guardrails

1. **Only admins can create proxy members** — `POST /members` with `is_proxy=true` requires admin role.
2. **Only the designated managing admin can record for a proxy** — verify `proxy_managed_by = req.workspace_member.id` OR caller is admin.
3. **Proxy members cannot have accounts** — enforced by the CHECK constraint: `(is_proxy = TRUE AND user_id IS NULL) OR (is_proxy = FALSE)`.
4. **No auto-merge when a proxy member registers** — if someone registers with the same name as a proxy, they are a NEW, SEPARATE user. The admin must manually decide to update the proxy record's `user_id` via the edit member endpoint. This is a deliberate manual step to avoid incorrect auto-linking.
5. **Proxy action audit** — every action taken on behalf of a proxy member is logged to `proxy_actions`.

---

## PART 9: OBSERVABILITY + OPERATIONS

### 9.1 — Logging Strategy

**Log levels:**
- `ERROR` — Unhandled exceptions, database connection failures, failed job after retries
- `WARN` — Business rule violations (caught and handled), deprecated API usage, rate limit hits
- `INFO` — Successful API requests (structured log with method, path, status, duration, user_id, workspace_id)
- `DEBUG` — Detailed query logs (development only)

**Structured log format (JSON):**
```json
{
  "level": "INFO",
  "timestamp": "2025-04-01T12:00:00.000Z",
  "request_id": "req_abc123",
  "method": "POST",
  "path": "/workspaces/uuid/containers/uuid/ledger",
  "status": 201,
  "duration_ms": 45,
  "user_id": "auth_uuid",
  "workspace_id": "ws_uuid",
  "workspace_member_id": "wm_uuid"
}
```

**Log aggregation:** Send to Logtail (Better Stack) or Axiom in production. Free tier sufficient for Phase 1.

---

### 9.2 — Audit Events

Beyond application logs, a separate audit trail tracks security-sensitive actions:

```sql
CREATE TABLE audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID REFERENCES workspaces(id),
  actor_user_id   UUID REFERENCES users(id),
  actor_member_id UUID REFERENCES workspace_members(id),
  action          TEXT NOT NULL,   -- e.g. 'member.removed', 'ledger.confirmed', 'document.accessed'
  target_type     TEXT,            -- e.g. 'workspace_member', 'ledger_entry', 'document'
  target_id       UUID,
  metadata        JSONB,           -- action-specific context
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_workspace ON audit_log(workspace_id, created_at DESC);
CREATE INDEX idx_audit_actor ON audit_log(actor_user_id, created_at DESC);
```

**Actions that always write to audit_log:**
- `member.invited`, `member.accepted`, `member.role_changed`, `member.removed`
- `ledger.confirmed`, `ledger.disputed`, `ledger.resolved`, `ledger.corrected`
- `document.accessed`, `document.downloaded`, `document.deleted`
- `workspace.settings_changed`, `workspace.exchange_rate_changed`
- `container.completed`, `container.archived`, `container.deleted`
- `dispute.raised`, `dispute.resolved`
- `admin.access` (when admin accesses ledger data)

---

### 9.3 — Error Tracking

Use **Sentry** (free tier) for error tracking. Initialize in Express:
```javascript
Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV });
```

Every unhandled exception is captured with:
- User ID and workspace ID (no PII beyond these identifiers)
- Request context (method, path, body shape — no sensitive values)
- Stack trace

**Frontend error tracking:** Sentry JS SDK captures React errors. No sensitive form data is captured.

---

### 9.4 — Queue Monitoring

**Bull Board:** Mount at `/admin/queues` with IP allowlist restriction (only accessible from office/VPN IP).

**Key metrics to monitor:**
- Queue depth per queue (if > 100 jobs in notification-queue: alert)
- Failed job count (if > 0 in critical queues: alert)
- Job completion latency (notification delivery should complete within 30 seconds)

**Health check endpoint:**
```
GET /health
Response: {
  "status": "ok",
  "db": "connected",
  "redis": "connected",
  "queues": { "notification-queue": { "waiting": 5, "failed": 0 } }
}
```

---

### 9.5 — Integrity Checks (Background)

A weekly integrity check job verifies:
1. **Ledger balance consistency:** For each container, sum of confirmed contributions matches `container_cycles.total_collected`. Discrepancies are logged as WARN.
2. **Orphaned participants:** `container_participants` records where `workspace_member_id` belongs to a deleted member. Flagged for admin review.
3. **Proxy without manager:** Proxy members where `proxy_managed_by` references an inactive/deleted member. Flagged for admin review.

These checks only log and alert — they never auto-correct data.

---

### 9.6 — Suspicious Activity Detection

**Patterns to detect and flag (logged as WARN with audit entry):**
- Same user submitting more than 5 ledger entries in 60 seconds (possible scripted submission)
- More than 3 failed login attempts from same IP in 5 minutes (handled by Supabase Auth)
- Admin viewing ledger for a workspace they only joined 5 minutes ago (newly elevated — log)
- Multiple proof uploads for the same ledger entry (flag as 'possible duplicate proof')

These flags are informational only. No automatic blocking beyond rate limiting.

---

## PART 10: FUTURE EXTENSIBILITY

### 10.1 — Plan Limitations (Billing — Phase 2)

The architecture is ready for plan enforcement. The `workspaces.plan` and `workspaces.plan_expires_at` fields already exist. Enforcement hooks should be added at:

**Enforcement points (add when billing is enabled):**
- `POST /containers` — check plan container limit
- `POST /members` or `POST /invites` — check plan member limit  
- `POST /documents/upload-url` — check plan storage limit (track total via `SUM(file_size_bytes)`)
- Container creation with `enable_money=true` — check if plan supports financial features

**Plan configuration (do not hardcode — store in a `plans` config table or environment config):**
```javascript
const PLAN_LIMITS = {
  free:  { max_members: 6, max_containers: 1, max_documents: 5, max_storage_bytes: 100_000_000 },
  core:  { max_members: 20, max_containers: null, max_documents: null, max_storage_bytes: 2_000_000_000 },
  pro:   { max_members: null, max_containers: null, max_documents: null, max_storage_bytes: null }
};
```

---

### 10.2 — Decision Workflows (Phase 2)

The database is ready. Add these tables in Phase 2:
```sql
decisions (id, workspace_id, title, context, options JSONB, voting_mode, deadline, status, outcome, created_by, ...)
decision_votes (id, decision_id, voter_id, option_chosen, comment, voted_at, UNIQUE(decision_id, voter_id))
```

Notes:
- No anonymous voting (per product requirements)
- All votes are attributed
- Decisions are immutable once closed

---

### 10.3 — Advanced Permissions (Roles beyond Admin/Member)

The role field is `TEXT` with a CHECK constraint. To add new roles:
1. Remove the CHECK constraint or add new values
2. Update `requireAdmin` middleware to support role hierarchies
3. Add the new role to the permission matrix

The architecture supports this without schema restructuring.

---

### 10.4 — AI Assistance Layer (Phase 2+)

The notification and reminder infrastructure is already in place. Groq/OpenAI can be added as an optional enhancement to:
1. **AI-drafted contribution reminders** — Admin triggers, AI generates contextually appropriate message, admin reviews and sends. The `workspace_settings['reminder_templates']` is already the storage point for this.
2. **Contribution pattern analysis** — Weekly digest could include AI-generated summary of family contribution health. Uses the engagement data already collected.

The pipeline: `engagement-check-queue worker` → `AI generation` → `notification-queue` for delivery.

---

### 10.5 — WhatsApp Integration (Phase 2)

When WhatsApp Business API is approved:
1. Add `whatsapp` to `notification_deliveries.channel` enum
2. Add WhatsApp delivery logic to `NotificationWorker`
3. Store WhatsApp phone from `user_contacts` where `type = 'whatsapp'`
4. Use the existing `workspace_settings['reminder_templates']` for message content

No schema changes needed. The notification delivery system is channel-agnostic by design.

---

### 10.6 — Document Vault Expansion (Phase 2)

Phase 2 additions:
- Document request system: members can request access to documents they can't see
- OCR-based search within documents (Supabase Storage + Tesseract)
- Document sharing via temporary signed URLs with expiry tracking
- Version comparison for updated documents

---

### 10.7 — Relationship Graph (Phase 3)

When the simple `relationship_to_head` text field is no longer sufficient:
1. Add `member_relationships` table: `(id, workspace_id, from_member_id, to_member_id, relationship_type TEXT, created_at)`
2. The existing `relationship_category` field on `workspace_members` already pre-categorizes members for future graph use
3. The family tree visualization can be built as a read-only view querying this table

---

## APPENDIX A: COMPLETE DATA OBJECT SHAPES

### WorkspaceMemberObject (Admin view)
```json
{
  "id": "uuid",
  "workspace_id": "uuid",
  "user_id": "uuid | null",
  "role": "admin | member",
  "display_name": "Uncle Emeka",
  "relationship_to_head": "Brother to head",
  "relationship_category": "blood",
  "date_of_birth": "1965-03-15",
  "is_proxy": false,
  "proxy_managed_by": null,
  "admin_notes": "Handles land matters in Lagos",
  "invite_status": "accepted",
  "joined_at": "2025-01-15T10:00:00Z",
  "last_active_at": "2025-04-01T08:30:00Z",
  "is_active": true,
  "contribution_streak_months": 3,
  "last_contribution_date": "2025-03-28"
}
```

### ContainerObject
```json
{
  "id": "uuid",
  "workspace_id": "uuid",
  "name": "Chidi & Ngozi Wedding",
  "subtitle": null,
  "description": "Help us celebrate!",
  "container_type": "event",
  "enable_money": true,
  "enable_tasks": true,
  "event_date": "2025-03-15",
  "event_type": "Wedding",
  "event_type_category": "celebration",
  "budget_target": 8000.00,
  "budget_currency": "GBP",
  "status": "active",
  "public_token": null,
  "created_by": "member_uuid",
  "created_at": "2025-01-01T00:00:00Z",
  "participant_count": 15
}
```

### LedgerEntryObject
```json
{
  "id": "uuid",
  "container_id": "uuid",
  "entry_type": "contribution",
  "contributor_id": "member_uuid",
  "contributor_name": "Uncle Emeka",
  "original_amount": 50000.00,
  "original_currency": "NGN",
  "converted_amount": 31.25,
  "base_currency": "GBP",
  "exchange_rate": 1600,
  "payment_method": "bank_transfer",
  "proof_url": "workspaces/uuid/proofs/...",
  "status": "confirmed",
  "note": null,
  "recorded_by_name": "Adaeze Okafor",
  "recorded_at": "2025-03-10T14:00:00Z",
  "confirmed_at": "2025-03-10T15:00:00Z",
  "is_proxy_entry": true,
  "corrects_entry_id": null
}
```

---

## APPENDIX B: BUILD ORDER

```
Sprint 1 (Weeks 1-2):
  ✓ Auth + user registration + profile
  ✓ Workspace creation + workspace_settings
  ✓ Workspace member creation (real + proxy)
  ✓ Invite link generation + acceptance
  ✓ Exchange rate management (JSONB)

Sprint 2 (Weeks 3-4):
  ✓ Container creation (event + recurring types)
  ✓ Participant management
  ✓ Contributor target versioning
  ✓ Container detail page (Summary tab)

Sprint 3 (Weeks 5-6):
  ✓ Ledger — record contributions
  ✓ Ledger — pending/proof/confirm flow
  ✓ Ledger — contributor edits own pending entry
  ✓ "Who Owes What" summary view (computed query)
  ✓ Exchange rate applied on entry recording

Sprint 4 (Week 7):
  ✓ Dispute system (raise, notes, resolve)
  ✓ Correction entries (immutable chain)
  ✓ Share summary (frontend clipboard)
  ✓ Copy reminder (frontend string generation)

Sprint 5 (Week 8):
  ✓ Task system (CRUD, status, completion)
  ✓ Container outcome details + files (on completion)
  ✓ Public event link (read-only view)

Sprint 6 (Week 9):
  ✓ Document vault (upload, access tiers, download)
  ✓ Document expiry metadata

Sprint 7 (Week 10):
  ✓ Groups (create, manage members, bulk-add to container)
  ✓ Timeline + milestones

Sprint 8 (Week 11):
  ✓ In-app notifications (create, read, poll)
  ✓ Firebase push notification setup
  ✓ BullMQ workers (notification, reminder, expiry)

Sprint 9 (Week 12):
  ✓ Recurring container cycle generation
  ✓ Cycle lifecycle (open/close)
  ✓ Carry-forward logic
  ✓ Pool cycle overrides (pause, skip)

Sprint 10 (Week 13):
  ✓ PWA service worker + manifest
  ✓ Offline banner + cached state
  ✓ Mobile layout polish

Sprint 11 (Week 14):
  ✓ Audit logging
  ✓ BullMQ monitoring (Bull Board)
  ✓ Error tracking (Sentry)
  ✓ Rate limiting
  ✓ Health check endpoint

Sprint 12 (Week 15-16):
  ✓ Beta with 3-5 real families
  ✓ Fix issues discovered in beta
  ✓ Public launch
```

---

*Kith — Technical Architecture Specification v2.0*
*Phase 1 Build Blueprint*
*For engineering team and AI code generation use*
