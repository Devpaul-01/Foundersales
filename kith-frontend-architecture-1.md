# 🧾 Kith — Frontend Architecture Document
### Version: API v4.2.0 | React + TypeScript + TailwindCSS + Supabase

> **For AI Agent Use:** This document is the complete, authoritative source of truth for building the Kith frontend codebase. Every screen, every API call, every state machine, every component boundary, every edge case, and every real-time subscription is defined here. Read the entire document before writing a single line of code.

---

## Table of Contents

1. [Frontend System Overview](#1-frontend-system-overview)
2. [Application Structure](#2-application-structure)
3. [Screen-by-Screen Blueprint](#3-screen-by-screen-blueprint)
4. [API Integration Layer](#4-api-integration-layer)
5. [State Management Strategy](#5-state-management-strategy)
6. [Component Architecture](#6-component-architecture)
7. [Design System](#7-design-system)
8. [Data Flow Mapping](#8-data-flow-mapping)
9. [Performance Strategy](#9-performance-strategy)
10. [Authentication & Session Handling](#10-authentication--session-handling)
11. [Real-Time & Live Updates](#11-real-time--live-updates)
12. [Splash Screen Design](#12-splash-screen-design)
13. [Error Handling & Edge Cases](#13-error-handling--edge-cases)
14. [Frontend Testing Strategy](#14-frontend-testing-strategy)
15. [Gap Analysis](#15-gap-analysis)
16. [Future Extensibility](#16-future-extensibility)

---

## 1. Frontend System Overview

### 1.1 Application Purpose (Frontend Perspective)

Kith is a **daily-use, AI-native sales coaching platform** whose frontend must feel like a personal sales advisor — not a dashboard or a tool. The frontend serves five primary personas (Founder, Sales Rep, Freelancer, Marketer, Developer/Builder) with a unified interface, but surfaces role-specific views (member vs. manager) based on the authenticated user's workspace role.

The UI must support:
- **High-frequency flows** (opening the app daily to review opportunities, do a check-in, send follow-ups)
- **Deep engagement flows** (multi-turn AI chat, live practice sessions with real-time buyer state updates)
- **Manager oversight flows** (team leaderboard, coaching queue, activity feed)

### 1.2 Core UI Domains / Modules

| Domain | Description | Primary Route |
|---|---|---|
| **Auth** | Login, register, OAuth, email verify, invite accept | `/login`, `/register`, `/auth/callback` |
| **Onboarding** | 5-step wizard building the Voice Profile | `/onboarding/*` |
| **Home / Dashboard** | Momentum score, chart, growth feed, active goals | `/home` |
| **Opportunities** | AI-discovered prospects, status tracking, intel | `/opportunities` |
| **Pipeline** | Kanban CRM board, deal management | `/pipeline` |
| **Practice** | AI buyer simulation, sessions, skill scores | `/practice` |
| **Chat** | AI coaching conversations with streaming | `/chat` |
| **Calendar** | Meeting intelligence, prep, debrief, commitments | `/calendar` |
| **Prospects** | Relationship CRM, health scores, signals | `/prospects` |
| **Goals** | Goal tracking with AI coaching notes | `/goals` |
| **Growth** | Daily feed, check-in, weekly plan, archetype | `/growth` |
| **Insights** | Skill analytics, pattern detection, why-losing | `/insights` |
| **Metrics** | Full performance dashboard | `/metrics` |
| **Follow-up** | AI-generated follow-up message queue | `/followup` |
| **Commitments** | Action items from meetings | `/commitments` |
| **Team** | Manager-only: overview, leaderboard, coaching | `/team/*` |
| **Settings** | Profile, voice, memory, notifications, workspace | `/settings/*` |
| **Workspaces** | Workspace switcher, creation, management | `/workspaces` |

### 1.3 State Boundaries

Three concentric layers of state exist:

**Global (App-wide):**
- Auth session (access_token, refresh_token, expires_at)
- Authenticated user object (`User` schema)
- Active workspace + membership (`Workspace`, `WorkspaceMember`)
- User role (derived from active membership)
- Onboarding status
- Notification badge counts (unread, debriefs_needed, pending_feedback)

**Domain (Feature-scoped):**
- Each feature module owns its server state via TanStack Query (`useQuery`, `useMutation`)
- Examples: opportunity list, pipeline board, practice session, chat messages

**Local (Component-scoped):**
- Form state (React Hook Form)
- UI toggle state (modals, drawers, tabs)
- Streaming content buffers (chat SSE, practice SSE)
- Realtime subscription state (delivery status, prep_generated)

### 1.4 Component Hierarchy Philosophy

```
AppShell (auth + workspace context providers)
  └── SplashScreen (initial load gate)
  └── AuthLayout (unauthenticated pages)
      └── Public pages (Login, Register, OAuthCallback, AcceptInvite)
  └── OnboardingLayout (post-auth, pre-completion)
      └── Onboarding steps
  └── AppLayout (authenticated + onboarding complete)
      ├── Sidebar (desktop)
      ├── BottomNav (mobile)
      ├── TopBar (global header with search, notifications, workspace switcher)
      └── <Outlet> (page content)
          └── FeatureLayout (optional per-section layout wrapper)
              └── Page components
                  └── Feature components
                      └── UI components
```

### 1.5 Data Flow Philosophy

```
API Response
    → TanStack Query cache (server state)
    → React component via useQuery hook
    → Rendered UI
    → User action
    → useMutation call
    → Optimistic update (where applicable)
    → API call
    → Cache invalidation / update
    → UI re-render

Realtime events (Supabase):
    → Channel subscription handler
    → Direct cache update (queryClient.setQueryData)
    → UI re-render (no full refetch needed for simple updates)

Streaming (SSE):
    → EventSource / fetch with ReadableStream
    → Local component state (streamBuffer)
    → Append-to-message UI
    → On "done" event: invalidate chat messages query
```

---

## 2. Application Structure

### 2.1 Tech Stack (Exact)

```
Framework:        React 18 + TypeScript (strict mode)
Routing:          React Router v6 (createBrowserRouter)
Styling:          TailwindCSS v3 (JIT, with custom design tokens)
Server State:     TanStack Query v5 (React Query)
Form State:       React Hook Form v7 + Zod (validation)
HTTP Client:      Custom axios instance with interceptors (see §4)
Realtime:         @supabase/supabase-js (postgres_changes subscriptions)
Auth:             Supabase Auth client (session management)
SSE/Streaming:    Native fetch API with ReadableStream
Notifications:    Firebase Cloud Messaging (firebase/app + firebase/messaging)
File Upload:      Native FormData + axios multipart
Icons:            Lucide React
Date Handling:    date-fns
Animation:        Framer Motion (targeted: splash, transitions, buyer state meters)
Toast/Alerts:     Custom Toast system (no external library needed)
Build:            Vite 5
Linting:          ESLint + Prettier
```

### 2.2 Project Folder Structure

```
src/
├── api/                      # API client + per-domain service functions
│   ├── client.ts             # Axios instance, interceptors, token refresh
│   ├── auth.ts               # Auth endpoints
│   ├── user.ts               # User endpoints
│   ├── workspaces.ts         # Workspace endpoints
│   ├── onboarding.ts         # Onboarding endpoints
│   ├── opportunities.ts      # Opportunity endpoints
│   ├── chat.ts               # Chat endpoints + SSE
│   ├── practice.ts           # Practice endpoints
│   ├── pipeline.ts           # Pipeline endpoints
│   ├── feedback.ts           # Feedback endpoints
│   ├── goals.ts              # Goals endpoints
│   ├── calendar.ts           # Calendar endpoints
│   ├── prospects.ts          # Prospect endpoints
│   ├── commitments.ts        # Commitment endpoints
│   ├── followup.ts           # Follow-up endpoints
│   ├── insights.ts           # Insights endpoints
│   ├── growth.ts             # Growth endpoints
│   ├── metrics.ts            # Metrics endpoints
│   ├── suggestions.ts        # Suggestions endpoints
│   ├── upload.ts             # File upload
│   └── types.ts              # All TypeScript interfaces mirroring API schemas
│
├── components/               # Reusable UI components
│   ├── ui/                   # Pure UI primitives (Button, Card, Badge, Input…)
│   ├── layout/               # AppShell, Sidebar, TopBar, BottomNav, PageHeader
│   ├── common/               # Shared feature-agnostic components
│   │   ├── ErrorBoundary.tsx
│   │   ├── EmptyState.tsx
│   │   ├── LoadingSkeleton.tsx
│   │   ├── ConfirmDialog.tsx
│   │   ├── Toast.tsx
│   │   ├── InfiniteScrollList.tsx
│   │   ├── AvatarWithRole.tsx
│   │   └── RoleBadge.tsx
│   └── forms/                # Reusable form components
│
├── features/                 # Feature-specific components organized by domain
│   ├── auth/
│   ├── onboarding/
│   ├── opportunities/
│   ├── chat/
│   ├── practice/
│   ├── pipeline/
│   ├── calendar/
│   ├── prospects/
│   ├── goals/
│   ├── growth/
│   ├── insights/
│   ├── metrics/
│   ├── followup/
│   ├── commitments/
│   ├── team/
│   └── settings/
│
├── hooks/                    # Custom React hooks
│   ├── useAuth.ts            # Auth context consumer
│   ├── useWorkspace.ts       # Active workspace + role
│   ├── useRole.ts            # Role-gating helper (isManager, isAdmin, isOwner)
│   ├── useRealtime.ts        # Supabase channel subscription manager
│   ├── useSSE.ts             # Server-Sent Events consumer
│   ├── useToast.ts           # Toast notification dispatch
│   ├── useNotifications.ts   # FCM + in-app notification handler
│   ├── usePagination.ts      # offset/limit pagination state
│   └── useDebounce.ts        # Input debounce
│
├── contexts/                 # React Context providers
│   ├── AuthContext.tsx        # session, user, tokens, login/logout
│   ├── WorkspaceContext.tsx   # activeWorkspace, activeMembership, role
│   └── NotificationContext.tsx # badge counts, unread notifications
│
├── pages/                    # Page-level components (thin wrappers)
│   ├── auth/
│   ├── onboarding/
│   ├── dashboard/
│   ├── opportunities/
│   ├── pipeline/
│   ├── practice/
│   ├── chat/
│   ├── calendar/
│   ├── prospects/
│   ├── goals/
│   ├── growth/
│   ├── insights/
│   ├── metrics/
│   ├── followup/
│   ├── commitments/
│   ├── team/
│   ├── settings/
│   └── workspaces/
│
├── router/
│   ├── index.tsx             # createBrowserRouter definition
│   ├── ProtectedRoute.tsx    # Auth guard HOC
│   ├── OnboardingRoute.tsx   # Onboarding gate
│   └── RoleRoute.tsx         # Role-based access guard
│
├── lib/
│   ├── supabase.ts           # Supabase client init
│   ├── queryClient.ts        # TanStack Query client config
│   ├── constants.ts          # Frontend-mirrored constants (enums, labels, colors)
│   ├── utils.ts              # Generic utilities (cn, formatDate, truncate)
│   └── fcm.ts                # Firebase Cloud Messaging init
│
├── styles/
│   └── globals.css           # Tailwind directives + CSS custom properties
│
└── main.tsx                  # App entry point
```

### 2.3 Routing Architecture

**Route Definition Strategy: createBrowserRouter with nested layouts**

```tsx
// router/index.tsx
const router = createBrowserRouter([
  // ── PUBLIC (no auth) ──────────────────────────────────────
  {
    path: "/login",
    element: <AuthLayout />,
    children: [{ index: true, element: <LoginPage /> }],
  },
  {
    path: "/register",
    element: <AuthLayout />,
    children: [{ index: true, element: <RegisterPage /> }],
  },
  {
    path: "/auth/callback",
    element: <OAuthCallbackPage />,  // no layout, handles redirect
  },
  {
    path: "/invite/:token",
    element: <AcceptInvitePage />,
  },

  // ── ONBOARDING (auth required, onboarding incomplete) ─────
  {
    path: "/onboarding",
    element: <OnboardingRoute />,    // guards: auth ✓, onboarding_completed = false
    children: [
      { path: "basic", element: <OnboardingBasicPage /> },
      { path: "q/:burst", element: <OnboardingQuestionsPage /> },
      { path: "preview", element: <OnboardingPreviewPage /> },
      { index: true, element: <Navigate to="basic" replace /> },
    ],
  },

  // ── WORKSPACE SELECTION ────────────────────────────────────
  {
    path: "/workspaces",
    element: <ProtectedRoute />,    // auth ✓
    children: [{ index: true, element: <WorkspacesPage /> }],
  },

  // ── MAIN APP (auth + onboarding complete + workspace active) ─
  {
    path: "/",
    element: <AppLayout />,         // Full sidebar layout
    children: [
      { index: true, element: <Navigate to="/home" replace /> },
      { path: "home", element: <DashboardPage /> },
      { path: "opportunities", element: <OpportunitiesPage /> },
      { path: "opportunities/:id", element: <OpportunityDetailPage /> },
      { path: "pipeline", element: <PipelinePage /> },
      { path: "pipeline/:id", element: <DealDetailPage /> },
      { path: "practice", element: <PracticeDashboardPage /> },
      { path: "practice/new", element: <PracticeSetupPage /> },
      { path: "practice/:sessionId", element: <PracticeSessionPage /> },
      { path: "practice/:sessionId/outcome", element: <PracticeOutcomePage /> },
      { path: "practice/:sessionId/replay", element: <PracticeReplayPage /> },
      { path: "chat", element: <ChatListPage /> },
      { path: "chat/:chatId", element: <ChatPage /> },
      { path: "calendar", element: <CalendarPage /> },
      { path: "calendar/:id", element: <CalendarEventDetailPage /> },
      { path: "prospects", element: <ProspectsPage /> },
      { path: "prospects/:id", element: <ProspectDetailPage /> },
      { path: "goals", element: <GoalsPage /> },
      { path: "goals/:id", element: <GoalDetailPage /> },
      { path: "followup", element: <FollowupPage /> },
      { path: "commitments", element: <CommitmentsPage /> },
      { path: "growth", element: <GrowthPage /> },
      { path: "insights", element: <InsightsPage /> },
      { path: "metrics", element: <MetricsPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "settings/members", element: <RoleRoute minRole="admin"><TeamMembersPage /></RoleRoute> },
      { path: "settings/voice", element: <VoiceProfilePage /> },
      { path: "settings/memory", element: <MemoryPage /> },
      { path: "settings/notifications", element: <NotificationsSettingsPage /> },
      // Manager-only team routes
      { path: "team/pipeline", element: <RoleRoute minRole="manager"><TeamPipelinePage /></RoleRoute> },
      { path: "team/opportunities", element: <RoleRoute minRole="manager"><TeamOpportunitiesPage /></RoleRoute> },
      { path: "team/insights", element: <RoleRoute minRole="manager"><TeamInsightsPage /></RoleRoute> },
      { path: "team/analytics", element: <RoleRoute minRole="manager"><TeamAnalyticsPage /></RoleRoute> },
      { path: "team/leaderboard", element: <RoleRoute minRole="manager"><LeaderboardPage /></RoleRoute> },
      { path: "team/coaching", element: <RoleRoute minRole="manager"><CoachingQueuePage /></RoleRoute> },
      { path: "team/activity", element: <RoleRoute minRole="manager"><ActivityFeedPage /></RoleRoute> },
    ],
  },

  // ── CATCH-ALL ─────────────────────────────────────────────
  { path: "*", element: <NotFoundPage /> },
]);
```

### 2.4 Guard Components

**`ProtectedRoute`:**
- Reads `AuthContext`
- If no session → `<Navigate to="/login" replace />`
- If session exists → renders `<Outlet />`

**`OnboardingRoute`:**
- Requires auth
- If `onboarding_completed = true` → `<Navigate to="/home" replace />`
- If `active_workspace_id = null` after onboarding → `<Navigate to="/workspaces" replace />`
- Otherwise → renders onboarding children

**`AppLayout` (in-place guard):**
- Requires auth + `onboarding_completed = true`
- If `active_workspace_id = null` → `<Navigate to="/workspaces" replace />`
- Renders: `<Sidebar />` + `<TopBar />` + `<main><Outlet /></main>` + `<BottomNav />` (mobile)

**`RoleRoute`:**
```tsx
// Props: minRole: 'manager' | 'admin' | 'owner'
// Role hierarchy: owner > admin > manager > member
// If user's role is below minRole → renders <ForbiddenPage /> inline
```

### 2.5 Sidebar Navigation

**Desktop Sidebar (always visible, 240px wide):**

```
Logo + workspace name + switcher dropdown
─────────────────────────────
[Home]            → /home
[Opportunities]   → /opportunities   (badge: pending count)
[Pipeline]        → /pipeline        (badge: pending_feedback count)
[Practice]        → /practice
[Chat]            → /chat
─────────────────────────────
[Calendar]        → /calendar        (badge: debriefs_needed + overdue_commitments)
[Prospects]       → /prospects
[Goals]           → /goals
[Follow-up]       → /followup
[Commitments]     → /commitments
─────────────────────────────
[Growth]          → /growth
[Insights]        → /insights
[Metrics]         → /metrics
─────────────────────────────
[Team]  (manager+, collapsible sub-menu)
  ├── Pipeline
  ├── Opportunities
  ├── Insights
  ├── Analytics
  ├── Leaderboard
  ├── Coaching
  └── Activity
─────────────────────────────
[Workspaces]      → /workspaces
[Settings]        → /settings
─────────────────────────────
[User avatar + name + tier badge]  → /settings
```

**Mobile Bottom Navigation (5 tabs max):**
```
[Home] [Opportunities] [Practice] [Pipeline] [More...]
```
The "More..." tab opens a drawer with all other navigation items.

**Badge data sources:**
- Opportunities badge: `opportunities` query count where `status = "pending"`
- Pipeline badge: `feedback/pending` count
- Calendar badge: `calendar/alerts` → `debriefs_needed.length + overdue_commitments.length`
- In-app notification bell (TopBar): `user/notifications` → `unread_count`

---

## 3. Screen-by-Screen Blueprint

---

### 3.1 SPLASH SCREEN

**Purpose:** Gate the app while the session is being hydrated. Prevents flash of unauthenticated content and resolves routing before any page renders.

**When it appears:** On every cold app load (page refresh or first open). Disappears after auth state is resolved.

**What it loads (in sequence):**
1. Checks `localStorage` for `access_token` + `refresh_token`
2. If token exists → calls `GET /api/auth/me`
   - Success → user is authenticated, check onboarding_completed
   - 401 → attempt token refresh via `POST /api/auth/refresh`
   - Refresh success → retry `GET /api/auth/me`
   - Refresh failure → clear tokens, show login
3. Routes user based on auth state (see §2.4)
4. After route resolved → fades out with 300ms ease

**UI:** Full-screen dark background. Kith wordmark centered. Animated pulse/shimmer beneath it (CSS keyframe, no heavy library). No spinner — the wordmark IS the loading indicator. Maximum duration shown: 3 seconds. If still loading at 3s, show subtle "Loading..." text below.

**State:** `splashDone: boolean` in `AppShell` — once `true`, splash unmounts via `AnimatePresence` (Framer Motion).

---

### 3.2 LOGIN PAGE (`/login`)

**Purpose:** Email/password login + Google OAuth entry point.

**UI Sections:**
- Kith logo + tagline ("Your AI sales advisor")
- Email + Password fields
- "Forgot password?" link (⚠️ GAP: no forgot-password endpoint exists — see §15)
- "Sign In" button
- Google OAuth button → calls `GET /api/auth/google/url` → redirects
- Link to `/register`

**Data Requirements:**
- `POST /api/auth/login` → `{ access_token, refresh_token, expires_in, user }`

**User Actions:**
1. Submit form → `POST /api/auth/login`
2. On success → store tokens → `GET /api/auth/me` → route based on state
3. On `401 INVALID_CREDENTIALS` → inline error "Incorrect email or password"
4. On `429` → inline error "Too many attempts. Wait 15 minutes."
5. Google button → `GET /api/auth/google/url` → redirect

**State Transitions:**
- idle → submitting → success (route) | error (show message)

**Loading State:** Button becomes disabled + shows spinner inside.

**Empty States:** N/A.

**Form Validation (client-side, Zod):**
- email: required, valid email format
- password: required, min 1 char (server handles auth)

---

### 3.3 REGISTER PAGE (`/register`)

**Purpose:** Email/password account creation.

**UI Sections:**
- Name field (optional, max 100)
- Email field (required)
- Password field (required, min 8, max 128)
- Password strength indicator (visual bar: weak/medium/strong)
- "Create Account" button
- Google OAuth button
- Link to `/login`

**Data Requirements:**
- `POST /api/auth/register` → `{ success: true, needsVerification: true, email }`

**User Actions:**
1. Submit → `POST /api/auth/register`
2. On `{ needsVerification: true }` → navigate to "Check your email" screen (inline state change, not a new route)
3. "Check your email" screen shows:
   - Email address confirmation
   - "Resend verification" button → `POST /api/auth/resend-verification`
   - "I've verified my email — Sign In" button → navigate to `/login`
4. On `409 EMAIL_TAKEN` → "Account already exists. Sign in instead."
5. On `429` → "Too many attempts. Wait 15 minutes."

**Error States:**
- Field-level Zod validation before submit
- Server-level errors shown as banner above form

---

### 3.4 OAUTH CALLBACK PAGE (`/auth/callback`)

**Purpose:** Post-Google-auth handler. Supabase processes the OAuth redirect and sets session cookies. This page picks up the session and completes profile setup.

**Renders:** Full-screen loading state (spinner + "Setting up your account..."). No user interaction needed.

**Logic (sequential):**
1. Call `supabase.auth.getSession()` to get the JWT from Supabase client
2. Extract `access_token` + `refresh_token` from session
3. Store tokens in `AuthContext`
4. `POST /api/auth/profile/ensure` with `{ name: session.user.user_metadata.full_name, provider: "google" }`
5. If `isNewUser = true` → navigate to `/onboarding/basic`
6. If `isNewUser = false`:
   - If `onboarding_completed = false` → navigate to `/onboarding/basic` at correct step
   - If `onboarding_completed = true` → navigate to `/home`
7. On any error → display "Something went wrong. Please try again." with retry button.

---

### 3.5 ONBOARDING — STEP 0: BASIC INFO (`/onboarding/basic`)

**Purpose:** Collect foundational profile data for Voice Profile generation.

**UI Sections:**
- **Progress bar**: Step 1 of 5 (visual stepper with labels: Info → Questions → Questions → Questions → Preview)
- **Form fields (all optional except name):**
  - Name (text, required, max 100)
  - Business name (text)
  - Product description (textarea, max 2000, char counter shown — CRITICAL for AI quality, show prominent hint: "The more detail, the better your AI coach")
  - Target audience (textarea, max 1000)
  - Role (select: founder | sales | freelancer | marketer | developer | other)
  - Industry (select: saas | ecommerce | services | fintech | health | education | other)
  - Experience level (select: beginner | intermediate | advanced)
  - Business stage (text)
  - Preferred platforms (multi-select chips: reddit, linkedin, twitter, facebook, instagram, producthunt, indiehackers, hackernews, quora, youtube)
  - Primary goal (text, max 200)
  - Country + State (text)
  - Website (URL input)
  - Bio (textarea, max 2000)
- "Continue →" button

**Data Requirements:**
- `POST /api/onboarding/basic` → `{ success: true }`

**State:** After success → navigate to `/onboarding/q/1`

**Validation:** Name is required. Product description strongly encouraged (show a yellow warning if left empty: "Without a product description, your AI coach will be generic."). All other fields optional.

---

### 3.6 ONBOARDING — STEPS 1–3: QUESTIONS (`/onboarding/q/:burst`)

**Purpose:** AI-generated dynamic questions to build the Voice Profile.

**Data Requirements (on mount):**
- `GET /api/onboarding/questions` → `{ questions: [{id, question}], burst: number, step: number }`

**UI Sections:**
- Progress bar showing current step (2, 3, or 4 of 5)
- List of questions, each rendered as a labeled textarea
- Character count is not needed here (free-form answers)
- "Continue →" button

**Submit:**
- `POST /api/onboarding/answers` with `{ answers: { q1: "...", q2: "..." }, burst: 1|2|3 }`
- On partial response (no `voice_profile` key in response): navigate to next burst `/onboarding/q/2` or `/3`
- On final response (`voice_profile` object present):
  - Store `voice_profile` in `AuthContext` + local state
  - Show **celebration animation**: full-screen modal with Kith logo pulsing + "Your AI sales voice is ready ✨" + 2-second auto-dismiss
  - Navigate to `/onboarding/preview`

**Loading State:** Skeleton placeholders for question texts while fetching. Button disabled until all questions answered.

**Empty State:** If `GET /api/onboarding/questions` returns empty array → show generic fallback text "Share more about your business below:" with a single open textarea.

**Resume Logic:** On mount, call `GET /api/onboarding/status` to determine which burst to resume from (`step` field).

---

### 3.7 ONBOARDING — STEP 4: PREVIEW (`/onboarding/preview`)

**Purpose:** The "wow moment" — shows a personalized sample outreach message generated from the user's Voice Profile.

**Data Requirements (on mount):**
- `POST /api/onboarding/sample-message` → `{ sample_message, based_on_opportunity, opportunity_context }`

**UI Sections:**
- "Here's what Kith will write for you" headline
- **Voice Profile Summary card** (read-only):
  - voice_style, outreach_persona, avoid_phrases (3 chips max), unique_value_prop
  - Source from `voice_profile` stored in AuthContext after step 3
- **Generated message card:**
  - If `based_on_opportunity = true`: context label "Based on a real opportunity: [opportunity_context]"
  - The full `sample_message` text, styled like a message preview
  - "This is what Kith sounds like" tagline
- "Let's go →" button → marks onboarding complete → navigate to `/home`

**Loading State:** Skeleton card while `POST /api/onboarding/sample-message` is in-flight. Show "Generating your first message..." with animated typing dots.

**On `400 VOICE_PROFILE_MISSING`:** Show error + "Go back" button to repeat step 3.

**Completion:** After user clicks "Let's go →", no additional API call needed. Onboarding completion is handled server-side after the final `POST /api/onboarding/answers`. Navigate to `/home`.

---

### 3.8 WORKSPACES PAGE (`/workspaces`)

**Purpose:** Shown when `active_workspace_id = null` after onboarding. Lets user create a workspace or view pending invites.

**Data Requirements:**
- `GET /api/workspaces` → `WorkspaceWithMeta[]`

**UI Sections:**
- List of existing workspaces (if any) with "Switch to" button
- "Create new workspace" form: name (required), slug (auto-derived from name)
  - `POST /api/workspaces` → `{ workspace }`
  - On success → `POST /api/workspaces/switch` → navigate to `/home`
- If user has pending invites → show invite acceptance flow (covered in §3.4 Google OAuth section's abbreviated path)

**State:** After workspace switch → full page data refetch (all queries invalidated).

---

### 3.9 HOME / DASHBOARD PAGE (`/home`)

**Purpose:** Primary landing page. Shows momentum score, daily growth cards, key metrics, and active goals. This is the most frequently visited page.

**Data Requirements (parallel fetches after mount):**
1. `GET /api/metrics/dashboard` → `MetricsDashboard`
2. `GET /api/growth/feed?limit=10` → `{ cards, opportunities, goals, archetype, pagination }`
3. `GET /api/growth/checkin/today` → `{ check_in, is_new }`
4. `GET /api/suggestions` → `string[]` (5 chat starter suggestions)

**UI Sections:**

**A. Header Row:**
- Greeting: "Good morning, [name]" (time-aware)
- Archetype badge: e.g., "🔨 Builder" (from growth feed response)
- Check-in streak: "🔥 7-day streak" (from user object `check_in_streak`)

**B. Momentum Score Widget:**
- Large circular score gauge (0–100) with `momentum_score`
- 4 segmented bars showing breakdown: Activity, Conversion, Pipeline, Goals (from `momentum_breakdown`)
- Practice bonus indicator (small "+N" if >0)
- `momentum_insight` AI text below gauge

**C. Daily Check-In Card (if `is_new = true`):**
- Prominent card: "📋 Daily Check-In Ready"
- Shows first question as preview
- "Start Check-In" button → expands inline OR navigates to `/growth` scroll-to-checkin
- If `is_new = false` (already submitted) → show `ai_response` as a coaching message card

**D. Growth Cards Feed:**
- Horizontal scrollable card strip (mobile) OR grid (desktop)
- Each `GrowthCard` rendered by type:
  - `tip` → icon + title + body + optional CTA button
  - `strategy` → blue accent, "Weekly Plan" label
  - `challenge` → bold, "Try This" CTA
  - `reflection` → soft, italic body text
  - `resource` → link-style with external icon
  - `community` → purple, community icon
  - `insight` → orange, chart icon
- Card interactions:
  - Tap card → mark read: `POST /api/growth/cards/:id/read` (fire-and-forget)
  - Dismiss button (×) → `POST /api/growth/cards/:id/dismiss` → optimistic removal
  - CTA button: if `action_type = "internal_chat"` → create new chat pre-seeded with card body

**E. Metrics Summary Strip:**
- Sent (30d): `sent_count_30d`
- Positive rate: `positive_rate` as percentage
- Pipeline value: `pipeline.pipeline_value` formatted as currency
- Win rate: `pipeline.win_rate_pct`%

**F. Performance Chart:**
- Line chart (30-day `chart_data`): X = date, Y = sent count
- Second line: positive count
- Toggle button to switch between "Sent", "Positive", "Positive Rate"

**G. Active Goals Sidebar:**
- Each `UserGoal` from `MetricsDashboard.goals`:
  - Progress bar: `current_value / target_value`
  - Goal text, target date
  - "Log Progress" inline button → opens quick note modal

**H. AI Chat Starters:**
- 5 suggestion chips from `GET /api/suggestions`
- Tapping one → navigates to `/chat` with a new chat seeded with that suggestion as the first message

**Loading States:**
- Momentum widget: circular skeleton
- Chart: rectangle skeleton
- Growth cards: 3 card skeletons in a row
- Goals: list item skeletons

**Empty States:**
- No growth cards: "Your first growth tips are being generated..." (fires `FIRST_TIME_CARDS_GENERATE` background job automatically — no user action needed, just poll or wait)
- No chart data: "Keep sending messages to build your trend data"

---

### 3.10 OPPORTUNITIES PAGE (`/opportunities`)

**Purpose:** List and manage AI-discovered outreach prospects. The daily outreach workflow center.

**Data Requirements:**
- `GET /api/opportunities?status=pending&limit=20&offset=0` → `{ opportunities, should_refresh, workspace_id }`

**UI Sections:**

**A. Header Row:**
- Title "Opportunities"
- Filter tabs: Pending | Viewed | Sent | Done | All (each tab triggers a refetch with the `status` param)
- "Discover New" button → `POST /api/opportunities/refresh`
  - Rate limit: 5/hour. Show cooldown timer if 429 received.
  - Show `notice` field from response if `is_fallback = true`

**B. Staleness Banner:**
- If `should_refresh = true` → prominent amber banner: "⚡ Your opportunity list is getting stale. Discover new prospects →" with inline Discover button.

**C. Opportunity Cards (list):**
Each card shows:
- Platform badge (Reddit, LinkedIn, etc. with platform color)
- Target name (if available) or "Anonymous prospect"
- `target_context` (truncated to 120 chars with "...see more")
- `composite_score` as a filled circle (0–100, color: 0–40 red, 41–70 yellow, 71–100 green)
- Three individual score bars: Fit, Timing, Intent (each 0–10)
- Status badge
- Action buttons: "View Details" → `/opportunities/:id`, "Mark Sent" (if status = viewed/acted)

**D. Pagination:**
- Load more button (offset-based). Show "Load more" when `opportunities.length === limit`.
- No page numbers — append-to-list UX.

**Loading States:** Card skeletons (4 cards)

**Empty State:**
- Pending empty + `should_refresh = false`: "No opportunities yet. Check back soon or discover new ones."
- Pending empty + `should_refresh = true`: Show discover banner prominently.

---

### 3.11 OPPORTUNITY DETAIL PAGE (`/opportunities/:id`)

**Purpose:** Full prospect context, prepared message, AI coaching, intel.

**Data Requirements (on mount):**
1. `GET /api/opportunities/:id` → `{ opportunity }` (also auto-marks `status: viewed`)
2. Lazy: `GET /api/opportunities/:id/intel` → only on explicit user request (expensive)

**UI Sections:**

**A. Prospect Context Card:**
- Platform + target name + source URL (if available, opens in new tab)
- `target_context` — full text, no truncation
- Score breakdown: composite + three sub-scores as visual bars

**B. Prepared Message Card:**
- `prepared_message` text (voice-matched by AI)
- Copy button → copies to clipboard + shows "Copied!" toast
- "Open in Chat" button → `POST /api/chat` with `{ opportunity_id, chat_type: "opportunity" }` → navigate to `/chat/:chatId`

**C. Status Actions:**
- "Mark as Sent" → `PUT /api/opportunities/:id/status` with `{ status: "sent" }` → invalidate opportunities query
- "Skip (Acted)" → `PUT /api/opportunities/:id/status` with `{ status: "acted" }` → navigate back to list
- "Log Feedback" (shown if status = sent) → opens Feedback Modal (see below)

**D. AI Intel Section (lazy-loaded):**
- Button: "🔍 Analyze this prospect" (only shown if `target_name` is not null)
- On click → `GET /api/opportunities/:id/intel` → show loading skeleton with "Analyzing prospect..."
- On success → show:
  - Pain Points list (`pain_points[]`)
  - Talking Points (`talking_points[]`)
  - Risks (`risks[]`)
  - Confidence badge: low/medium/high
- On `reason = "no_named_entity"` → "No named prospect detected. Intel requires a specific person or company name."

**E. Feedback Modal (inline or drawer):**
```
Outcome: [Positive] [Negative] [Pending]  (segmented control)
Note: textarea (optional, max 500)
Deal Value: number input (USD)
Scheduled Call: toggle → date picker + notes
Submit → POST /api/feedback
```
On submit success:
- If outcome = positive → show "🎉 Great work! Prospect moved to Pipeline" toast
- Invalidate opportunities + pipeline queries

**Manager Extra:** If role = manager, show "Assign to member" dropdown → `PUT /api/opportunities/:id/assign` with `{ user_id }`.

**Loading States:**
- Full page skeleton on initial load
- Intel section: skeleton with animated "Analyzing..." text

---

### 3.12 PIPELINE PAGE (`/pipeline`)

**Purpose:** Kanban CRM board. Five columns for active deals.

**Data Requirements:**
- `GET /api/pipeline` → `{ pipeline: { contacted, replied, call_demo, closed_won, closed_lost }, view, metrics }`
- Manager additional: `GET /api/pipeline?view=team` (toggle)

**UI Sections:**

**A. Metrics Bar (top):**
- Total Revenue: `metrics.total_revenue` (USD formatted)
- Pipeline Value: `metrics.pipeline_value`
- Win Rate: `metrics.win_rate_pct`%
- Stage counts inline

**B. View Toggle (manager only):**
- "My Deals" | "Team Deals" tabs → refetches with `?view=team`

**C. Kanban Board (5 columns):**

Column headers (with STAGE_LABELS and STAGE_COLORS from constants):
- **Contacted** (blue #3B82F6)
- **Replied** (purple #8B5CF6)
- **Call / Demo** (amber #F59E0B)
- **Closed Won** (green #10B981)
- **Closed Lost** (red #F43F5E)

Each deal card shows:
- Target name + platform badge
- `composite_score` (small)
- `last_stage_changed_at` (relative time: "3 days ago")
- `follow_up_count` (if > 0: "↩ 2 follow-ups sent")
- Deal value badge (if set)
- Drag handle (for drag-to-move)

**Drag and Drop:**
- Use `@dnd-kit/core` for drag-and-drop between columns
- On drop → `PUT /api/pipeline/:id/stage` with `{ stage: "call_demo" }`
- If response includes `calendar_prompt` → show inline "Schedule a meeting?" banner below the moved card:
  - Shows pre-filled calendar form (title, attendee_name from opportunity)
  - "Add to Calendar" button → `POST /api/calendar` then dismiss
- If moved to `closed_won` → show 🎉 confetti animation (CSS-only, brief)
- If moved to `closed_lost` → open modal to capture `lost_reason`
- Optimistic: move card immediately, revert on error

**Deal card "..." menu:**
- Set Deal Value → opens inline input → `PATCH /api/pipeline/:id/deal-value`
- View Detail → `/pipeline/:id`
- Delete → confirm dialog → `DELETE /api/pipeline/:id`
- Assign (manager) → member picker → `PUT /api/pipeline/:id/assign`

**Loading State:** Skeleton columns with 2–3 skeleton cards each.

**Empty State per column:** "No deals here yet" in muted text.

---

### 3.13 PRACTICE DASHBOARD PAGE (`/practice`)

**Purpose:** Practice session overview, skill dashboard, session history, badges.

**Data Requirements:**
- `GET /api/practice/skill-dashboard` → `{ skill_history, recent_sessions, badges }`
- `GET /api/practice/sessions?limit=10&offset=0` → paginated sessions

**UI Sections:**

**A. Start Session CTA:**
- "Start Practice Session" → navigates to `/practice/new`

**B. Skill Score Radar / Bar Chart:**
- 6 dimensions: hook, clarity, value_prop, personalization, cta, tone
- Source: latest week from `skill_history` (most recent `SkillProgression`)
- 4-week sparkline per dimension below the main chart
- Show `top_weakness` and `top_strength` badges

**C. Badges Row:**
- Earned `PracticeBadge[]` rendered as achievement chips
- Each: `badge_label` + `badge_description` on hover tooltip
- Greyed-out locked badges not shown (only earned)

**D. Recent Sessions List:**
- Last 10 sessions from `recent_sessions`
- Each row: scenario label (with SCENARIO_COLORS dot), difficulty badge, `message_strength_score` (or "Pending scoring"), date, outcome chip, "View →" link
- "Load more" pagination

**Empty State:** No sessions → "You haven't practiced yet. Start your first session →" with large CTA.

---

### 3.14 PRACTICE SETUP PAGE (`/practice/new`)

**Purpose:** Configure and start a new practice session.

**UI Sections:**

**A. Scenario Picker:**
- 6 scenario type cards with SCENARIO_LABELS and SCENARIO_COLORS:
  - Interested Lead, Polite No, No Response (Ghost), Skeptical, Price Concern, Not Right Time
- Or: "Random" button (no scenario_type sent → server picks weighted random)
- Selected card gets highlighted border

**B. Advanced Options (collapsible):**
- Session Goal (free text input, optional)
- Pressure Modifier (4 chips using PRESSURE_MODIFIERS labels/descriptions)
- Opportunity Context: dropdown of recent opportunities → pre-fills buyer context

**C. Difficulty display (read-only):**
- Auto-detected from session count. Display: "Your level: Standard"
- Show formula: "Based on your X completed sessions"

**D. "Start Session" button:**
- `POST /api/practice/start` with configured options
- On success → navigate to `/practice/:sessionId` passing session data in router state
- On error (e.g., voice profile missing) → show `VOICE_PROFILE_MISSING` message

---

### 3.15 ACTIVE PRACTICE SESSION PAGE (`/practice/:sessionId`)

**Purpose:** The live simulated buyer conversation. Most interactive screen in the app.

**Data Requirements (on mount):**
- `GET /api/practice/:sessionId` → `PracticeSession` (get buyer_profile, scenario, etc.)
- `GET /api/practice/:sessionId/messages` → `ChatMessage[]`
- Subscribe to Supabase Realtime: `chat:{chat_id}` channel for delivery status updates

**UI Sections:**

**A. Session Header:**
- Buyer avatar/name: `buyer_profile.name`, `buyer_profile.role` at `buyer_profile.company`
- Scenario badge: `scenario_type` label with color dot
- Difficulty badge
- Pressure modifier chip (if set)
- Practice prompt summary (1–2 lines): `practice_prompt`
- "End Session" button (top right)

**B. Buyer State Meters (live-updating):**
- Three animated progress bars:
  - 🟢 Interest: `buyer_state.interest_score`/100
  - 💙 Trust: `buyer_state.trust_score`/100
  - 🟡 Confusion: `buyer_state.confusion_score`/100
- Update on every message response with animation (Framer Motion layout animation)
- `buyer_state.mood` shown as text below bars: "cautiously interested"
- ⚠️ Do NOT show `buyer_state.last_reasoning` during active session (hidden)

**C. Message Thread:**
- User messages: right-aligned, teal/brand background
- Buyer (AI) messages: left-aligned, buyer avatar, neutral background
- Each user message shows delivery status:
  - ⏳ pending (t+0)
  - ✓ delivered (t+500ms, via Supabase Realtime)
  - ✓✓ seen (t+1500ms, via Supabase Realtime)
  - "No reply received" (ghosted scenario, if `ghosted: true` in response)
  - Message returned (if `ghost_broke: true` → buyer finally replied)
- System messages: centered, muted italic (e.g., "Scenario started")

**D. Message Input:**
- Textarea (single-line expand on typing)
- Max 5000 characters (show counter near limit)
- Send button (enter key submits)
- On submit → `POST /api/practice/:sessionId/message` with `{ content }`
- Disable input + show spinner while awaiting response
- On `400 SESSION_ENDED` → session is over, show completion flow

**E. Coaching Hints (real-time):**
- If `hint` in message response → show as a small floating coach bubble near input area
- If `ghosted: true` → show inline coaching: "💡 This message didn't get a reply. Try being more specific about their pain point."

**F. Session Completion:**

Triggered by:
- `session_ended: true` in message response (AI decided to end)
- User clicks "End Session" → confirm dialog

On completion:
1. `POST /api/practice/:sessionId/complete` with `{ rating: N }` (show 1–5 star rating dialog first)
2. Show "✅ Session complete! Your coaching report is being prepared..." banner
3. Auto-poll `GET /api/practice/:sessionId/outcome` at t+5s and t+10s
4. When `session_debrief` is populated → navigate to `/practice/:sessionId/outcome`

**Realtime Subscription:**
```typescript
supabase.channel(`chat:${chat_id}`)
  .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_messages" },
    (payload) => {
      // Update message delivery_status in local query cache
      queryClient.setQueryData(
        ['practice', 'messages', sessionId],
        (old) => old.map(m => m.id === payload.new.id ? { ...m, ...payload.new } : m)
      );
    }
  )
  .subscribe();
```
Unsubscribe on unmount.

**Loading State:** Skeleton messages thread.

**Error State:** If message send fails → show retry button inline.

---

### 3.16 PRACTICE OUTCOME PAGE (`/practice/:sessionId/outcome`)

**Purpose:** Post-session coaching report.

**Data Requirements:**
- `GET /api/practice/:sessionId/outcome` → `{ session: PracticeSession }`

**UI Sections:**

**A. Outcome Summary:**
- `conversation_outcome` headline
- `goal_achieved` badge: "🎯 Goal Achieved!" or "Goal Not Achieved"
- `message_strength_score` large circular score
- Final `buyer_state` (interest, trust, confusion bars)

**B. Session Debrief:**
- 4 sections from `session_debrief`:
  - ✅ What Worked: `what_worked`
  - ⚠️ What Didn't: `what_didnt`
  - 🎯 Improvement: `improvement`
  - 💡 Coachable Moment: `coachable_moment`

**C. Skill Scores:**
- 6-dimension radar chart from `skill_scores`
- Each dimension: score + label from SKILL_DIMENSION_LABELS
- If `skill_scores = null` → "Skill scores are being calculated..." skeleton + auto-refetch at t+3s

**D. Coaching Annotations (if available):**
- Per-message coaching notes from `coaching_annotations`
- Show as expandable accordion "View per-message coaching →"
- If null → "Detailed coaching notes are being prepared..." (populated at t+5s post-completion)

**E. Action Buttons:**
- "Try Again" → `POST /api/practice/:sessionId/retry` → navigate to new session
- "View Replay →" → navigate to `/practice/:sessionId/replay`
- "Back to Practice" → `/practice`

**Loading State (pending scoring):**
- Show "⏳ Your coaching report is being generated..." with animated progress
- Poll `GET /api/practice/:sessionId/outcome` every 5 seconds until `session_debrief` is non-null

---

### 3.17 PRACTICE REPLAY PAGE (`/practice/:sessionId/replay`)

**Purpose:** Full session review with AI buyer's hidden internal monologues revealed.

**Data Requirements:**
- `GET /api/practice/:sessionId/replay` → `{ session, messages, internal_monologues }`

**UI Sections:**
- Full message thread (same layout as active session but static)
- Each **buyer message** has an adjacent "thought bubble" showing the corresponding `internal_monologue.thought`
  - Styled as a translucent card to the left of the buyer message
  - Label: "💭 What the buyer was thinking:"
- User messages shown normally (no annotations)
- Timeline scrubber (optional enhancement for longer sessions)

**⚠️ Critical:** Internal monologue is ONLY shown on this replay endpoint. Never render `last_reasoning` during active sessions.

---

### 3.18 CHAT LIST PAGE (`/chat`)

**Purpose:** All AI coaching conversations.

**Data Requirements:**
- `GET /api/chat` → `Chat[]`

**UI Sections:**
- "New Chat" button → `POST /api/chat` with `{ chat_type: "general", chat_mode: "general" }` → navigate to `/chat/:chatId`
- List of non-archived chats:
  - Chat title
  - `chat_type` badge: general / opportunity / practice
  - `chat_mode` badge (if not general)
  - Last message preview (if available via chat detail)
  - `last_message_at` relative timestamp
  - Archive button (×) → `DELETE /api/chat/:chatId` → remove from list

**Empty State:** "No chats yet. Start a conversation with your AI coach." + New Chat CTA.

---

### 3.19 CHAT PAGE (`/chat/:chatId`)

**Purpose:** AI coaching conversation with streaming responses.

**Data Requirements:**
- `GET /api/chat/:chatId` → `{ chat: Chat, messages: ChatMessage[] }`
- `GET /api/suggestions` (for starter chips if no messages yet)

**UI Sections:**

**A. Chat Header:**
- Chat title (editable? — ⚠️ GAP: no PATCH /api/chat/:id/title endpoint exists)
- Chat type badge
- Back to chat list

**B. Message Thread:**
- User messages: right-aligned
- Assistant messages: left-aligned with Kith avatar
- Streaming messages: show content progressively as SSE chunks arrive, with blinking cursor at end
- File attachments: rendered inline (images shown as thumbnails, PDFs as download link)
- If no messages + suggestions available → show suggestion chips

**C. Message Input:**
- Textarea (grows with content, max 5 rows visible)
- Max 5000 characters
- File attachment button → file picker → `POST /api/upload?chat_id=:chatId` → add URL to attachments array
- Send button / Enter key
- "Force Web Search" toggle (shows a globe icon chip when active)

**Streaming Implementation:**
```typescript
// Use fetch with ReadableStream
const response = await fetch(`/api/chat/${chatId}/message`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ message, stream: true, force_search: forceSearch, attachments }),
});

const reader = response.body!.getReader();
const decoder = new TextDecoder();
let buffer = "";

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const data = JSON.parse(line.slice(6));
    if (data.type === "chunk") appendToStreamingMessage(data.content);
    if (data.type === "done") finalizeMessage(data.message_id);
    if (data.type === "error") showError(data.message);
  }
}
```

**After streaming done:**
- Invalidate `['chat', chatId, 'messages']` query to sync with server
- Clear input

**Loading State:** Streaming responses show naturally. Initial load shows skeleton messages.

---

### 3.20 CALENDAR PAGE (`/calendar`)

**Purpose:** Meeting management with prep, debrief, and commitment tracking.

**Data Requirements:**
- `GET /api/calendar?from=DATE&to=DATE` → `{ events: CalendarEvent[] }`
- `GET /api/calendar/alerts` → `{ debriefs_needed, overdue_commitments, pending_commitments }`

**UI Sections:**

**A. Calendar Views:**
- Toggle: Month | Week | List view
- Month/Week: standard calendar grid layout
- List: sorted by date, grouped by day

**B. Alert Banner:**
- If `debriefs_needed.length > 0` → amber banner: "📋 X meetings need debriefs"
- If `overdue_commitments.length > 0` → red banner: "⚠️ X commitments are overdue"

**C. Event Card (in list or on calendar):**
- Title, event_type badge (meeting/call/demo/followup/other)
- Start time + end time
- Attendee name (if set)
- `debrief_needed` indicator → red dot
- Prep status: "Prep Ready ✓" or "Preparing..." (if `prep_generated = false`)
- Prospect health score (if linked prospect)

**D. "Add Event" Button:**
Opens event creation form (drawer or modal):
- Title (required)
- Event date (date picker, required)
- Start/end time (time pickers)
- Event type (dropdown)
- Attendee name (text)
- Attendee context (textarea, max 2000 — triggers auto research)
- Link opportunity (dropdown of recent opps)
- Link prospect (dropdown or search)
- On submit: `POST /api/calendar` → subscribe to Realtime for prep_generated update

**Realtime prep subscription (after creation):**
```typescript
supabase.channel(`event:${event.id}`)
  .on("postgres_changes", { event: "UPDATE", schema: "public", table: "user_events",
    filter: `id=eq.${event.id}` },
    (payload) => {
      if (payload.new.prep_generated) {
        queryClient.invalidateQueries(['calendar', event.id]);
        showToast("📝 Meeting prep is ready!");
      }
    })
  .subscribe();
```

**Date range navigation:**
- Default range: 14 days ago → 30 days forward
- Previous/Next navigation updates `from` + `to` params + refetches

---

### 3.21 CALENDAR EVENT DETAIL PAGE (`/calendar/:id`)

**Purpose:** Full event detail with AI prep, debrief, commitments, signals.

**Data Requirements:**
- `GET /api/calendar/:id` → `{ event: CalendarEvent + prospects, commitments, signals }`

**UI Sections:**

**A. Event Header:**
- Title, event_type, date/time
- Attendee name + link to prospect profile (if `prospect_id` set)
- Energy score display (1–5 stars, editable via PUT)

**B. Meeting Prep Section:**
- If `prep_generated = false`:
  - "🔍 Researching [attendee_name]..." skeleton
  - "📝 Preparing your meeting brief..." skeleton
  - Subscribe to Realtime (see above) or poll every 5s
  - Manual fallback: "Generate Prep Now" → `POST /api/calendar/:id/prep`
- If `prep_generated = true` → show `prep_content`:
  - Prospect Background
  - Key Topics (list)
  - Talking Points (list)
  - Open Commitments
  - Perplexity Research (collapsible)

**C. Meeting Notes Button:**
- "📝 Open Meeting Notes" → `POST /api/calendar/:id/start-meeting-notes` → navigate to `/chat/:chatId`
- Idempotent: always navigates to same chat

**D. Post-Meeting Debrief (shown if `event_date` is in the past):**
- If `debrief_completed_at = null`:
  - "Submit Debrief" button → opens drawer/modal:
    - Outcome (hot/positive/neutral/cold/dead) — segmented control with MEETING_OUTCOME_LABELS
    - Raw notes (textarea — AI will structure these)
    - On submit: `POST /api/calendar/:id/debrief` with `{ outcome, raw_notes }`
    - Show "AI is processing your notes..." loading
    - On success: show extracted `debrief_content`, `commitments`, `signals` in a "Review & Confirm" modal
- If debrief done: show `debrief_content` (structured), `follow_up_message`, outcome badge

**E. Commitments Tab:**
- List of `ConversationCommitment[]` from event
- Each: owner badge (founder/prospect), commitment text, status badge, due_date
- "Mark Done" → `PUT /api/commitments/:id` with `{ status: "done" }`
- "Generate Follow-up" → `POST /api/commitments/:id/generate-message` → show generated message

**F. Signals Tab:**
- List of `ConversationSignal[]`
- Each signal_type with color: buying (green), risk (red), timing (amber), engagement (blue)
- Confidence score
- `signal_text` description

**G. Prospect Research:**
- "Re-run Research" button → `POST /api/calendar/:id/research` → fires async job → toast "Research started. Check back in a moment."

---

### 3.22 PROSPECTS PAGE (`/prospects`)

**Purpose:** Relationship CRM — all tracked prospects with health scores.

**Data Requirements:**
- `GET /api/prospects?sort=health&limit=50` → `Prospect[]` (with `pending_commitments` count)

**UI Sections:**

**A. Sort Controls:**
- "Healthiest First" (default) | "At Risk" | "Most Recent"

**B. Prospect Cards:**
- Name + company + title
- Platform badge
- Stage badge (prospect/engaged/negotiating/closed_won/closed_lost/dormant)
- **Relationship Health Score gauge:**
  - 70–100: green ring
  - 40–69: yellow ring
  - 0–39: red ring
  - Score shown numerically inside
- Last contact date (relative)
- Pending commitments count badge (if > 0)
- "View →" link

**C. "Add Prospect" button:**
- Simple form: name (required), company, title, email, LinkedIn URL, platform, notes, stage
- `POST /api/prospects` → add to list

**Empty State:** "No prospects yet. They're created automatically from calendar events. Or add one manually."

---

### 3.23 PROSPECT DETAIL PAGE (`/prospects/:id`)

**Purpose:** Full relationship timeline, signals, commitments, AI summary.

**Data Requirements:**
- `GET /api/prospects/:id` → `{ prospect, timeline, signals, commitments, meetings, chats }`

**UI Sections:**

**A. Prospect Header:**
- Name, company, title, platform
- Health score gauge (large)
- Stage dropdown (editable) → `PUT /api/prospects/:id` with `{ stage }`
- AI Summary card: `ai_summary` text + last updated timestamp
- "Refresh Summary" → `POST /api/prospects/:id/refresh-summary` → show loading spinner

**B. Timeline:**
- Chronological list of `timeline` items: events (meetings), chats, signals
- Each entry: type icon, title, date

**C. Active Signals:**
- From `signals[]`: buying (🟢), risk (🔴), timing (🟡), engagement (🔵)
- `is_active = true` only

**D. Open Commitments:**
- From `commitments[]`: separated into founder (my actions) vs. prospect (their actions)
- Overdue highlighted in red

**E. Linked Meetings:**
- From `meetings[]`: list of CalendarEvents linked to this prospect

**F. Edit Prospect:**
- `PUT /api/prospects/:id` form fields (name, company, title, email, linkedin_url, platform, notes)

---

### 3.24 GOALS PAGE (`/goals`)

**Purpose:** Goal creation and tracking with AI coaching.

**Data Requirements:**
- `GET /api/goals` → `UserGoal[]`

**UI Sections:**

**A. "Add Goal" form (inline or modal):**
- Goal text (required)
- Target value + unit (optional): "5 clients", "10000 dollars"
- Target date (date picker, optional)
- `POST /api/goals` → add to list

**B. Goal Cards:**
- Goal text headline
- Progress bar: `current_value / target_value`
- Status badge: active / completed / paused
- Target date + days remaining
- "Log Progress" button → opens note modal

**Note Modal:**
```
Note text (required, textarea) — "Closed AcmeCorp today!"
Explicit delta (optional number) — override AI-inferred progress
Submit → POST /api/goals/:goalId/notes
```
Response shows `coaching_response` → display as AI message below the goal card.
If `goal_completed = true` → 🎉 celebration animation + move goal to "Completed" section.

**C. Pipeline Insight widget (per goal):**
- "💡 Pipeline Insight" button → `GET /api/goals/:goalId/pipeline-insight` (cached 24h)
- Shows AI-generated text connecting goal to pipeline progress

**D. Goal Detail → `/goals/:id`:**
- Full notes list (`GET /api/goals/:goalId/notes`)
- Each note: text, AI response, sentiment badge (color-coded: positive=green, neutral=grey, negative=red), progress delta
- Delete note: `DELETE /api/goals/:goalId/notes/:noteId`

---

### 3.25 GROWTH PAGE (`/growth`)

**Purpose:** Daily growth cards feed, check-in, weekly plan, archetype.

**Data Requirements:**
- `GET /api/growth/feed?limit=20` → `{ cards, opportunities, goals, archetype, pagination }`
- `GET /api/growth/checkin/today` → `{ check_in, is_new }`
- `GET /api/growth/plan` → `{ plan: GrowthCard, cached }`

**UI Sections:**

**A. Check-In Section (top of page):**
- Streak display: "🔥 [N]-day streak" (from `user.check_in_streak`)
- Streak risk warning: if it's past 6pm and `is_new = true` → amber banner "⚠️ Streak at risk! Complete today's check-in."
- If `is_new = true`:
  - Show questions from `check_in.questions` as labeled textareas
  - Mood score slider (1–10) with emoji indicators (1=😞, 5=😐, 10=🤩)
  - "Submit Check-In" → `POST /api/growth/checkin` with `{ answers, mood_score, date }`
  - On success: show `ai_response` as a coach message + new streak count
  - On `409` → "Already submitted today" state
- If `is_new = false`: show `check_in.ai_response` as "Your coaching response:"

**B. Weekly Plan Card:**
- From `plan` GrowthCard (type = "strategy")
- `metadata.focus_area` as badge
- `metadata.daily_actions` as checklist
- "cached" indicator (small, subtle)

**C. Growth Cards Feed:**
- Infinite scroll list
- Same card rendering as home page (§3.9.D)
- Card type filter tabs: All | Tips | Challenges | Reflections | Resources
- Load more pagination

**D. Archetype Display:**
- From `archetype` field
- ARCHETYPE_ICONS + ARCHETYPE_LABELS
- "Detect Archetype" button → `POST /api/growth/archetype/detect` (rate-limited to 7 days)
  - If `cached: true` → show "Detected within last 7 days" note
  - Show `confidence` score if available

**E. Card History (tab or section):**
- `GET /api/growth/history?type=tips` / `?type=plans`
- Paginated list of past cards

---

### 3.26 INSIGHTS PAGE (`/insights`)

**Purpose:** Communication pattern analysis, skill trends, loss diagnosis.

**Data Requirements:**
- `GET /api/insights/summary` → quick overview
- `GET /api/insights/patterns?limit=20` → `CommunicationPattern[]`
- `GET /api/insights/why-losing` → loss report (cached 4h)
- `GET /api/insights/skill-trend` → week-over-week trend
- `GET /api/insights/weekly` → weekly prospect insights
- Manager: `GET /api/insights/workspace/why-losing` + `GET /api/insights/workspace/skill-matrix`

**UI Sections:**

**A. Summary Widget:**
- Composite score: `composite_score` with trend delta
- `top_weakness` badge (red) + `top_strength` badge (green)
- `positive_rate_30d` + `messages_analyzed`
- If `has_enough_data = false` → "Keep sending messages to unlock insights (need 5+ analyzed)" placeholder

**B. Skill Trend:**
- `trend_status` badge: improving (green) | declining (red) | stable (grey) | mixed
- `summary` text
- `biggest_gain` + `biggest_drop` highlighted dimensions
- Week-over-week dimension breakdown table

**C. Why Losing Report:**
- If `has_data = false` → "Not enough data yet"
- Otherwise:
  - `primary_diagnosis` — bold headline
  - `evidence_summary` — supporting data
  - `immediate_fix` — actionable CTA (highlighted card)
  - `skill_to_focus` — badge
  - `encouraging_note` — soft italics
- "Generated at [time]" footer (cached 4h)

**D. Communication Patterns:**
- 4 type tabs: Ghost Triggers | Success Signals | Weaknesses | Objection Types
- Each `CommunicationPattern`:
  - `pattern_label` headline
  - `confidence_score` percentage
  - `pattern_detail` description
  - `sample_count` "seen X times"
  - Dismiss (×) → `DELETE /api/insights/patterns/:id` → optimistic removal

**E. Weekly Prospect Insights:**
- From `GET /api/insights/weekly` — AI-generated prose insights about specific prospects

**F. Manager: Skill Matrix Tab:**
- Table: Member name | Top strength | Top weakness | Latest composite score | Has data
- From `GET /api/insights/workspace/skill-matrix`

---

### 3.27 METRICS PAGE (`/metrics`)

**Purpose:** Full performance dashboard.

**Data Requirements:**
- `GET /api/metrics/dashboard` → `MetricsDashboard`
- `GET /api/metrics/skill-breakdown` → 7-day skill scores
- `GET /api/metrics/intelligence` → AI insights (cached 4h)
- Manager: `GET /api/metrics/workspace/team-overview`, `/leaderboard`, `/coaching-queue`, `/team-velocity`

**UI Sections:**

**A. Personal Dashboard (same as Home but expanded):**
- Full momentum score breakdown
- 30-day activity chart (sent / positive / positive_rate)
- Pipeline metrics summary
- Practice stats: sessions_30d, sessions_7d

**B. Skill Breakdown (7-day):**
- Radar chart + 6 dimension bars with scores
- From `GET /api/metrics/skill-breakdown`

**C. AI Intelligence Cards:**
- From `GET /api/metrics/intelligence` — actionable insight cards
- Each: `type` (pattern/opportunity/warning), title, description

**D. Manager: Team Tabs:**
- **Overview Tab:** Per-member table: sessions_this_week, avg_skill_score, weakest_axis, last_active, outreach_sent, goal_completion_pct
- **Leaderboard Tab:** Ranked list with score, sent_30d, positive_rate, closed_won, total_revenue
- **Coaching Queue Tab:** Members needing attention with flags: no_outreach_7d | no_practice_7d | score_declining | low_skill_score. "Nudge" button per member → `POST /api/workspaces/:id/nudge`
- **Team Velocity Tab:** Week-over-week composite trend chart

---

### 3.28 FOLLOW-UP PAGE (`/followup`)

**Purpose:** Queue of AI-generated follow-up messages for stalled deals.

**Data Requirements:**
- `GET /api/followup` → opportunities where `follow_up_message IS NOT NULL`

**UI Sections:**

**A. Follow-up Cards:**
- Target name + platform
- Current stage badge
- Days since last activity (from `last_stage_changed_at`)
- `follow_up_message` text (full, copy-ready)
- Copy button
- "Mark Sent" → `POST /api/followup/:id/sent` → remove from list
- "Dismiss" → `POST /api/followup/:id/dismiss` → remove from list

**Empty State:** "🎉 No follow-ups needed! Your pipeline is active."

---

### 3.29 COMMITMENTS PAGE (`/commitments`)

**Purpose:** All action items across all meetings, organized by urgency.

**Data Requirements:**
- `GET /api/commitments?status=active&owner=founder` → `{ commitments, overdue, due_soon, pending }`

**UI Sections:**

**A. Filter Row:**
- Owner: "My Actions" (founder) | "Their Actions" (prospect)
- Status: Active | Done | Ignored

**B. Urgency Sections:**
- **Overdue** (red section): overdue commitments with `due_date` passed
- **Due Soon** (amber section): upcoming commitments
- **Pending** (normal): all others

**C. Commitment Item:**
- Owner badge: "My Commitment" (founder) or "Their Commitment" (prospect)
- `commitment_text`
- `due_date` or `implicit_timing`
- Linked prospect name (if `prospect_id`)
- Status dropdown: pending → done | ignored → `PUT /api/commitments/:id`
- "Generate Follow-up" → `POST /api/commitments/:id/generate-message` → shows `follow_up_message` in a card

---

### 3.30 SETTINGS PAGES (`/settings/*`)

**3.30.1 Main Settings (`/settings`):**
- **Profile Form:**
  - name, business_name, product_description, target_audience, website, role, industry, experience_level, bio, preferred_platforms
  - `PUT /api/auth/me` → success toast
- **Account Danger Zone:**
  - Delete Account → confirm dialog (type "DELETE" to confirm) → `DELETE /api/auth/account` → redirect to `/login`

**3.30.2 Voice Profile (`/settings/voice`):**
- Read-only display of all `VoiceProfile` fields
- "Edit" button per field → opens inline editor
- Bulk rebuild: "Rebuild from my answers" → `POST /api/onboarding/rebuild-voice-profile`
- Manual override: `PUT /api/onboarding/profile` with edited VoiceProfile object

**3.30.3 Memory Facts (`/settings/memory`):**
- Toggle: "Enable AI Memory" → `PUT /api/user/notification-preferences` with `{ memory_enabled: true/false }`
- List of `UserMemoryFact[]` from `GET /api/user/memory`
- Each: `fact`, `fact_category` badge, `reinforcement_count`, `last_reinforced_at`
- Delete (×) → `DELETE /api/user/memory/:id` → optimistic remove

**3.30.4 Notifications (`/settings/notifications`):**
- Toggle switches for all 14 `NotificationPreferences` fields
- Toggle for `email_digest_enabled`
- Group by category: Outreach, Practice, Calendar, Growth, Team (weekly)
- `PUT /api/user/notification-preferences` (debounced — merge all changes, submit on blur or after 1s)

**3.30.5 Team Members (`/settings/members`) — admin+ only:**
- Current members table: name, email, role dropdown (editable → `PUT /api/workspaces/:id/members/:uid/role`), status, joined_at
- Remove member: `DELETE /api/workspaces/:id/members/:uid` → confirm dialog
- Pending Invites section:
  - List from `GET /api/workspaces/:id/invites`
  - Each: invite_email, role, `invite_expires_at`, `is_expired` badge
  - Revoke → `DELETE /api/workspaces/:id/invites/:inviteId`
- Invite New Member form:
  - Email (required), Role (admin/manager/member)
  - `POST /api/workspaces/:id/invite` → success: "Invite sent to [email]"
- Transfer Ownership: `PUT /api/workspaces/:id/transfer-ownership` (owner only) → confirm dialog

---

### 3.31 TEAM PAGES (`/team/*`) — manager+ only

**Team Pipeline (`/team/pipeline`):**
- `GET /api/pipeline?view=team` board (same Kanban UI, multi-user cards with assignee avatar)

**Team Opportunities (`/team/opportunities`):**
- `GET /api/opportunities/team` → opportunity list with `assigned_to` column
- Assign button per opportunity → member picker → `PUT /api/opportunities/:id/assign`

**Team Analytics (`/team/analytics`):**
- `GET /api/workspaces/:id/analytics` → 30-day workspace overview
- Charts: activity over time, member contributions

**Team Leaderboard (`/team/leaderboard`):**
- `GET /api/metrics/workspace/leaderboard`
- Ranked table with medals: score, sent_30d, positive_rate, closed_won, total_revenue

**Coaching Queue (`/team/coaching`):**
- `GET /api/metrics/workspace/coaching-queue`
- Members with flags. "Nudge" button → `POST /api/workspaces/:id/nudge`

**Activity Feed (`/team/activity`):**
- `GET /api/workspace/activity?limit=20` → paginated
- Each event: user avatar + name, event_type (human label), timestamp
- Event icons by type: 🎯 practice_completed, 🏆 deal_closed, 💡 opportunity_created, ✅ goal_reached, 👋 member_joined, 📋 opportunity_assigned, 📣 nudge_sent
- Infinite scroll pagination

---

## 4. API Integration Layer

### 4.1 Axios Client Configuration

```typescript
// api/client.ts
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { getTokens, setTokens, clearTokens, scheduleRefresh } from '../lib/auth';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

// ── REQUEST INTERCEPTOR ───────────────────────────────────────
apiClient.interceptors.request.use((config) => {
  const { accessToken } = getTokens();
  if (accessToken) {
    config.headers['Authorization'] = `Bearer ${accessToken}`;
  }
  return config;
});

// ── RESPONSE INTERCEPTOR (token refresh) ──────────────────────
let isRefreshing = false;
let refreshQueue: Array<(token: string) => void> = [];

apiClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        // Queue the request until refresh completes
        return new Promise((resolve) => {
          refreshQueue.push((token: string) => {
            originalRequest.headers['Authorization'] = `Bearer ${token}`;
            resolve(apiClient(originalRequest));
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const { refreshToken } = getTokens();
        const res = await axios.post(`${BASE_URL}/api/auth/refresh`, { refresh_token: refreshToken });
        const { access_token, refresh_token, expires_in } = res.data;
        setTokens(access_token, refresh_token, expires_in);
        scheduleRefresh(expires_in);
        
        // Flush the queue
        refreshQueue.forEach((cb) => cb(access_token));
        refreshQueue = [];
        
        originalRequest.headers['Authorization'] = `Bearer ${access_token}`;
        return apiClient(originalRequest);
      } catch (refreshError) {
        clearTokens();
        refreshQueue = [];
        window.location.href = '/login';
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);
```

### 4.2 Token Storage

**Storage strategy:** `localStorage` (not `sessionStorage`) to persist across tabs and page refreshes.

Keys:
- `kith_access_token`
- `kith_refresh_token`
- `kith_token_expires_at` (unix timestamp)

**Token refresh scheduling:**
```typescript
// lib/auth.ts
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleRefresh(expiresIn: number) {
  if (refreshTimer) clearTimeout(refreshTimer);
  // Refresh 60 seconds before expiry
  const delay = (expiresIn - 60) * 1000;
  refreshTimer = setTimeout(() => {
    // Trigger proactive refresh
    refreshTokens();
  }, Math.max(delay, 0));
}
```

### 4.3 API Service Modules

Each service module follows this pattern:

```typescript
// api/opportunities.ts
import { apiClient } from './client';
import type { Opportunity, OpportunityIntel, PaginationMeta } from './types';

export const opportunitiesApi = {
  list: (params: { status?: string; limit?: number; offset?: number }) =>
    apiClient.get<{ opportunities: Opportunity[]; should_refresh: boolean; workspace_id: string }>
      ('/api/opportunities', { params }),

  refresh: () =>
    apiClient.post<{ opportunities: { id: string }[]; count: number; notice: string | null; is_fallback: boolean }>
      ('/api/opportunities/refresh'),

  listTeam: () =>
    apiClient.get<{ opportunities: Opportunity[]; workspace_id: string }>
      ('/api/opportunities/team'),

  getById: (id: string) =>
    apiClient.get<{ opportunity: Opportunity }>(`/api/opportunities/${id}`),

  getIntel: (id: string) =>
    apiClient.get<{ intel: OpportunityIntel | null; reason: string | null }>
      (`/api/opportunities/${id}/intel`),

  updateStatus: (id: string, status: string) =>
    apiClient.put<{ success: boolean; status: string }>
      (`/api/opportunities/${id}/status`, { status }),

  assign: (id: string, userId: string) =>
    apiClient.put<{ success: boolean; assigned_to: string }>
      (`/api/opportunities/${id}/assign`, { user_id: userId }),
};
```

All modules follow this exact structure. The full list of modules:
`authApi`, `userApi`, `workspacesApi`, `onboardingApi`, `opportunitiesApi`, `chatApi`, `practiceApi`, `pipelineApi`, `feedbackApi`, `goalsApi`, `calendarApi`, `prospectsApi`, `commitmentsApi`, `followupApi`, `insightsApi`, `growthApi`, `metricsApi`, `suggestionsApi`, `uploadApi`

### 4.4 TypeScript Types

All types in `api/types.ts` must exactly mirror the OpenAPI schema schemas:

```typescript
// api/types.ts — excerpt

export type UserTier = 'free' | 'pro' | 'enterprise';
export type WorkspaceRole = 'owner' | 'admin' | 'manager' | 'member';
export type MemberStatus = 'active' | 'pending_invite' | 'suspended' | 'removed';
export type UserRole = 'founder' | 'sales' | 'freelancer' | 'marketer' | 'developer' | 'other';
export type Industry = 'saas' | 'ecommerce' | 'services' | 'fintech' | 'health' | 'education' | 'other';
export type Archetype = 'seller' | 'builder' | 'freelancer' | 'creator' | 'professional' | 'learner';
export type OpportunityStatus = 'pending' | 'viewed' | 'acted' | 'sent' | 'done';
export type PipelineStage = 'new' | 'contacted' | 'replied' | 'call_demo' | 'closed_won' | 'closed_lost';
export type PracticeScenario = 'interested' | 'polite_decline' | 'ghost' | 'skeptical' | 'price_objection' | 'not_right_time';
export type DifficultyLevel = 'beginner' | 'standard' | 'advanced' | 'expert';
export type PressureModifier = 'decision_maker_watching' | 'aggressive_buyer' | 'competitor_mentioned' | 'compliance_concern';
export type OpeningMood = 'neutral' | 'skeptical' | 'curious' | 'defensive' | 'rushed';
export type DeliveryStatus = 'pending' | 'delivered' | 'seen' | 'replied' | 'ghosted';
export type ChatType = 'general' | 'opportunity' | 'practice';
export type ChatMode = 'general' | 'meeting_notes' | 'prep' | 'followup_coach';
export type FeedbackOutcome = 'positive' | 'negative' | 'pending';
export type GoalStatus = 'active' | 'completed' | 'paused';
export type ProspectStage = 'prospect' | 'engaged' | 'negotiating' | 'closed_won' | 'closed_lost' | 'dormant';
export type MeetingOutcome = 'hot' | 'positive' | 'neutral' | 'cold' | 'dead';
export type SignalType = 'buying' | 'risk' | 'timing' | 'engagement';
export type CommitmentStatus = 'pending' | 'done' | 'overdue' | 'ignored';
export type CommitmentOwner = 'founder' | 'prospect';
export type GrowthCardType = 'tip' | 'strategy' | 'resource' | 'reflection' | 'challenge' | 'community' | 'insight';
export type PatternType = 'ghost_trigger' | 'success_signal' | 'weakness' | 'objection_type';
export type EventType = 'meeting' | 'call' | 'demo' | 'followup' | 'other';
export type TrendStatus = 'improving' | 'declining' | 'mixed_positive' | 'mixed_negative' | 'stable';
export type Platform = 'reddit' | 'linkedin' | 'twitter' | 'facebook' | 'instagram' | 'producthunt' | 'indiehackers' | 'hackernews' | 'quora' | 'youtube' | 'other';

// Full User interface (ALL fields from API spec)
export interface User {
  id: string;
  name: string | null;
  email: string;
  tier: UserTier;
  active_workspace_id: string | null;
  onboarding_completed: boolean;
  onboarding_step: number;
  debug_mode: boolean;
  fcm_token: string | null;
  notification_preferences: NotificationPreferences;
  memory_enabled: boolean;
  email_digest_enabled: boolean;
  check_in_streak: number;
  last_tip_generated_at: string | null;
}

// ... (all other interfaces from Section 6 of the product behavior doc, faithfully typed)
```

### 4.5 Error Handling Pattern

```typescript
// All mutations wrap errors like this:
const handleApiError = (error: unknown): never => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;
    const code = data?.error as string;
    const message = data?.message as string;
    const status = error.response?.status;

    // Map error codes to user-facing messages
    const errorMessages: Record<string, string> = {
      INVALID_CREDENTIALS: "Incorrect email or password.",
      EMAIL_TAKEN: "An account with this email already exists.",
      ONBOARDING_REQUIRED: "Please complete onboarding first.",
      VOICE_PROFILE_MISSING: "Complete onboarding to use this feature.",
      QUOTA_EXCEEDED: "Daily discovery limit reached. Resets at midnight.",
      RATE_LIMIT_EXCEEDED: "Too many requests. Please slow down.",
      NO_ACTIVE_WORKSPACE: "Please select a workspace first.",
      OWNER_CANNOT_LEAVE: "Transfer ownership before leaving.",
      ALREADY_A_MEMBER: "You're already in this workspace.",
      INVALID_OR_EXPIRED_TOKEN: "This invite link has expired.",
      SESSION_ENDED: "This practice session has already ended.",
      PERMISSION_DENIED: "You don't have permission to do this.",
    };

    throw new AppError(
      errorMessages[code] ?? message ?? "Something went wrong.",
      code,
      status,
      data?.details
    );
  }
  throw error;
};

export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
    public details?: Record<string, string[]>
  ) {
    super(message);
  }
}
```

### 4.6 Retry Strategy

- Network errors (no response): retry 1× with 1s delay (via axios-retry or manual)
- 401: handled by refresh interceptor (see §4.1) — up to 1 retry
- 429: NO retry. Show user-facing rate limit message + optional cooldown timer.
- 5xx: NO automatic retry. Show error state with "Try again" manual button.
- SSE streams: if connection drops mid-stream, abort and show "Connection lost. Retry?" button.

---

## 5. State Management Strategy

### 5.1 Global State (React Context)

**`AuthContext`** — provided at app root:
```typescript
interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;           // true during splash hydration
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>; // refetches GET /api/auth/me
}
```

**`WorkspaceContext`** — provided after auth:
```typescript
interface WorkspaceContextValue {
  activeWorkspace: Workspace | null;
  activeMembership: ActiveMembership | null;
  role: WorkspaceRole | null;
  isManager: boolean;   // role is owner | admin | manager
  isAdmin: boolean;     // role is owner | admin
  isOwner: boolean;
  switchWorkspace: (workspaceId: string) => Promise<void>;
}
```

**`NotificationContext`**:
```typescript
interface NotificationContextValue {
  unreadCount: number;
  calendarAlertCount: number;  // debriefs_needed + overdue_commitments
  pendingFeedbackCount: number;
  refreshCounts: () => void;
}
```

### 5.2 Server State (TanStack Query)

**Query Client Configuration:**
```typescript
// lib/queryClient.ts
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,       // 1 minute — most data can be slightly stale
      gcTime: 5 * 60_000,      // 5 minutes garbage collection
      retry: (failureCount, error) => {
        // Don't retry 4xx errors
        if (error instanceof AppError && error.status < 500) return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: true,   // refresh data when user returns to tab
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
    },
  },
});
```

**Query Key Conventions (hierarchical, for targeted invalidation):**
```typescript
export const queryKeys = {
  // Auth
  me: ['auth', 'me'] as const,
  onboardingStatus: ['onboarding', 'status'] as const,

  // Opportunities
  opportunities: (params?: object) => ['opportunities', params] as const,
  opportunity: (id: string) => ['opportunities', id] as const,
  opportunityIntel: (id: string) => ['opportunities', id, 'intel'] as const,
  teamOpportunities: ['opportunities', 'team'] as const,

  // Chat
  chats: ['chats'] as const,
  chat: (chatId: string) => ['chats', chatId] as const,
  chatMessages: (chatId: string) => ['chats', chatId, 'messages'] as const,

  // Practice
  practiceSkillDashboard: ['practice', 'skill-dashboard'] as const,
  practiceSessions: (params?: object) => ['practice', 'sessions', params] as const,
  practiceSession: (id: string) => ['practice', id] as const,
  practiceMessages: (sessionId: string) => ['practice', sessionId, 'messages'] as const,
  practiceOutcome: (sessionId: string) => ['practice', sessionId, 'outcome'] as const,
  practiceReplay: (sessionId: string) => ['practice', sessionId, 'replay'] as const,

  // Pipeline
  pipeline: (view?: string) => ['pipeline', view ?? 'individual'] as const,
  deal: (id: string) => ['pipeline', 'deals', id] as const,
  pipelineMetrics: ['pipeline', 'metrics'] as const,

  // Calendar
  calendar: (params?: object) => ['calendar', params] as const,
  calendarEvent: (id: string) => ['calendar', id] as const,
  calendarAlerts: ['calendar', 'alerts'] as const,

  // Goals
  goals: ['goals'] as const,
  goal: (id: string) => ['goals', id] as const,
  goalNotes: (goalId: string) => ['goals', goalId, 'notes'] as const,
  goalPipelineInsight: (goalId: string) => ['goals', goalId, 'pipeline-insight'] as const,

  // Prospects
  prospects: (params?: object) => ['prospects', params] as const,
  prospect: (id: string) => ['prospects', id] as const,

  // Growth
  growthFeed: (params?: object) => ['growth', 'feed', params] as const,
  checkInToday: ['growth', 'checkin', 'today'] as const,
  weeklyPlan: ['growth', 'plan'] as const,
  growthHistory: (params?: object) => ['growth', 'history', params] as const,

  // Metrics
  dashboard: ['metrics', 'dashboard'] as const,
  skillBreakdown: ['metrics', 'skill-breakdown'] as const,
  intelligence: ['metrics', 'intelligence'] as const,
  teamOverview: ['metrics', 'team', 'overview'] as const,
  leaderboard: ['metrics', 'team', 'leaderboard'] as const,
  coachingQueue: ['metrics', 'team', 'coaching-queue'] as const,

  // Insights
  insightsSummary: ['insights', 'summary'] as const,
  patterns: (params?: object) => ['insights', 'patterns', params] as const,
  whyLosing: ['insights', 'why-losing'] as const,
  skillTrend: ['insights', 'skill-trend'] as const,

  // Other
  commitments: (params?: object) => ['commitments', params] as const,
  followup: ['followup'] as const,
  feedback: (oppId: string) => ['feedback', oppId] as const,
  feedbackPending: ['feedback', 'pending'] as const,
  suggestions: ['suggestions'] as const,
  notifications: ['notifications'] as const,
  memoryFacts: ['user', 'memory'] as const,
  workspaces: ['workspaces'] as const,
};
```

### 5.3 Stale Times Per Query Type

| Query | staleTime | Rationale |
|---|---|---|
| `GET /api/auth/me` | Infinity (in context) | Only re-fetched explicitly |
| `GET /api/metrics/dashboard` | 2 min | Aggregated, not real-time |
| `GET /api/opportunities` | 60s | Changes infrequently |
| `GET /api/pipeline` | 30s | User drags cards frequently |
| `GET /api/growth/feed` | 5 min | Cards don't change often |
| `GET /api/growth/checkin/today` | Infinity | Once per day |
| `GET /api/insights/why-losing` | 4h (matches backend cache) | Expensive to generate |
| `GET /api/metrics/intelligence` | 4h | Same reason |
| `GET /api/goals/:id/pipeline-insight` | 24h | Matches backend cache |
| `GET /api/chat/:id` | 30s | Messages arrive frequently |
| `GET /api/calendar/alerts` | 2 min | Badge counts |
| `GET /api/feedback/pending` | 2 min | Badge counts |

### 5.4 Cache Invalidation Rules

After each mutation, invalidate the following queries:

| Mutation | Invalidate |
|---|---|
| `POST /api/auth/register` or login | All queries (full reset) |
| `PUT /api/auth/me` | `queryKeys.me` |
| `POST /api/opportunities/refresh` | `queryKeys.opportunities()` |
| `PUT /api/opportunities/:id/status` | `queryKeys.opportunities()`, `queryKeys.opportunity(id)` |
| `POST /api/feedback` | `queryKeys.feedbackPending`, `queryKeys.pipeline()`, `queryKeys.opportunities()`, `queryKeys.dashboard` |
| `PUT /api/pipeline/:id/stage` | `queryKeys.pipeline()`, `queryKeys.pipelineMetrics` |
| `POST /api/calendar` | `queryKeys.calendar()`, `queryKeys.calendarAlerts` |
| `POST /api/calendar/:id/debrief` | `queryKeys.calendarEvent(id)`, `queryKeys.calendarAlerts`, `queryKeys.commitments()` |
| `POST /api/growth/checkin` | `queryKeys.checkInToday`, `queryKeys.growthFeed()`, `queryKeys.me` |
| `POST /api/goals/:goalId/notes` | `queryKeys.goalNotes(goalId)`, `queryKeys.goals`, `queryKeys.dashboard` |
| `PUT /api/commitments/:id` | `queryKeys.commitments()`, `queryKeys.calendarAlerts` |
| `POST /api/workspaces/switch` | ALL queries (workspace change = full data reset) |
| `POST /api/practice/:id/complete` | `queryKeys.practiceSkillDashboard`, `queryKeys.practiceSessions()`, `queryKeys.practiceOutcome(id)` |
| `DELETE /api/growth/cards/:id/dismiss` | `queryKeys.growthFeed()` |

### 5.5 Optimistic Updates

Apply optimistic updates for high-frequency, low-risk mutations:

1. **Dismiss growth card:** Remove card from feed immediately
2. **Mark notification read:** Set `is_read = true` immediately
3. **Pipeline stage move (drag-and-drop):** Move card between columns immediately, revert on error
4. **Mark commitment done:** Update status immediately
5. **Mark follow-up sent/dismissed:** Remove from list immediately
6. **Delete pattern:** Remove from list immediately

**Pattern:**
```typescript
const dismissCard = useMutation({
  mutationFn: (id: string) => growthApi.dismissCard(id),
  onMutate: async (id) => {
    await queryClient.cancelQueries({ queryKey: queryKeys.growthFeed() });
    const previous = queryClient.getQueryData(queryKeys.growthFeed());
    queryClient.setQueryData(queryKeys.growthFeed(), (old: any) => ({
      ...old,
      cards: old.cards.filter((c: GrowthCard) => c.id !== id),
    }));
    return { previous };
  },
  onError: (err, id, context) => {
    queryClient.setQueryData(queryKeys.growthFeed(), context?.previous);
  },
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.growthFeed() });
  },
});
```

---

## 6. Component Architecture

### 6.1 Component Layers

**Layer 1 — UI Primitives (`components/ui/`):**
Pure presentational, no business logic, no API calls, no hooks except `useState`.

```
Button.tsx           — variants: primary, secondary, ghost, destructive, icon
Input.tsx            — with label, error, helper text
Textarea.tsx
Select.tsx           — native select wrapper with styling
Badge.tsx            — variants: info, success, warning, danger, neutral
Card.tsx             — base card container (shadow, radius, padding)
Avatar.tsx           — circular image/initials
ProgressBar.tsx      — animated, labeled, color variants
Spinner.tsx
Modal.tsx            — portal-based, focus trap, escape-to-close
Drawer.tsx           — slide-in from right (mobile: bottom sheet)
Tooltip.tsx
Tabs.tsx
Toggle.tsx           — boolean switch
Checkbox.tsx
DatePicker.tsx       — native date input with custom styling
Skeleton.tsx         — generic skeleton block with shimmer animation
Chip.tsx             — small selectable tags
ScoreGauge.tsx       — circular radial progress for scores 0-100
RatingStars.tsx      — 1-5 star rating input
CopyButton.tsx       — copies text, shows "Copied!" feedback
```

**Layer 2 — Feature Components (`features/*/`):**
Domain-specific, use hooks and query data, no direct API calls (all via hooks).

```
// features/opportunities/
OpportunityCard.tsx
OpportunityScoreBar.tsx
OpportunityStatusBadge.tsx
OpportunityIntelPanel.tsx
FeedbackModal.tsx

// features/practice/
BuyerStateMeters.tsx          — animated interest/trust/confusion bars
PracticeMessageBubble.tsx     — with delivery status indicators
ScenarioSelector.tsx          — 6 scenario type cards
PracticeSessionHeader.tsx
PracticeSessionCompleteFlow.tsx — rating + completion
SkillScoreRadar.tsx
BadgeChip.tsx                 — earned badge display

// features/chat/
ChatMessageBubble.tsx         — user / assistant variants
StreamingMessageBubble.tsx    — live typing animation
FileAttachmentPreview.tsx
SuggestionChips.tsx
ChatSSEHandler.tsx            — manages streaming state

// features/pipeline/
KanbanBoard.tsx
KanbanColumn.tsx
DealCard.tsx
DealValueInput.tsx
CalendarPromptBanner.tsx      — "Schedule a meeting?" prompt

// features/calendar/
CalendarGrid.tsx              — month/week/list views
EventCard.tsx
PrepContentPanel.tsx
DebriefModal.tsx
CommitmentItem.tsx
SignalItem.tsx

// features/growth/
GrowthCard.tsx
CheckInForm.tsx
StreakDisplay.tsx
WeeklyPlanCard.tsx
ArchetypeDisplay.tsx

// etc.
```

**Layer 3 — Layout Components (`components/layout/`):**
App shell structure.

```
AppShell.tsx          — providers + splash screen gate
AppLayout.tsx         — sidebar + topbar + outlet + bottomnav
AuthLayout.tsx        — centered card layout for public pages
OnboardingLayout.tsx  — step progress + content
Sidebar.tsx           — desktop nav with badge counts
BottomNav.tsx         — mobile 5-tab navigation
TopBar.tsx            — workspace switcher, notifications bell, user avatar
PageHeader.tsx        — page title + actions row
SectionCard.tsx       — section wrapper with title + content area
```

### 6.2 Custom Hooks (Key Examples)

```typescript
// hooks/useRole.ts
export function useRole() {
  const { role } = useWorkspace();
  const hierarchy: WorkspaceRole[] = ['member', 'manager', 'admin', 'owner'];
  const hasRole = (minRole: WorkspaceRole) =>
    hierarchy.indexOf(role ?? 'member') >= hierarchy.indexOf(minRole);
  return {
    role,
    isManager: hasRole('manager'),
    isAdmin: hasRole('admin'),
    isOwner: role === 'owner',
    canDo: hasRole,
  };
}

// hooks/useRealtime.ts
export function useRealtimeChannel(
  channelName: string,
  table: string,
  filter: string,
  onUpdate: (payload: any) => void,
  enabled: boolean = true
) {
  const supabase = useSupabase();
  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table, filter }, onUpdate)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [channelName, table, filter, enabled]);
}

// hooks/useSSE.ts
export function useSSE() {
  const { accessToken } = useAuth();
  const sendMessage = useCallback(async (
    url: string,
    body: object,
    onChunk: (content: string) => void,
    onDone: (messageId: string) => void,
    onError: (message: string) => void
  ) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...body, stream: true }),
    });
    // ReadableStream parsing as described in §3.19
    // ...
  }, [accessToken]);
  return { sendMessage };
}
```

### 6.3 Props vs. Hooks vs. Context

| Use Case | Approach |
|---|---|
| Data from server | `useQuery` hook inside feature component |
| Data passed from parent to child | Props |
| App-wide auth/role data | Context (`useAuth()`, `useWorkspace()`, `useRole()`) |
| Shared mutation logic reused across multiple pages | Custom hook wrapping `useMutation` |
| Local UI state (open/closed, active tab) | `useState` in the owning component |
| Form state | `useForm` from React Hook Form |
| Streaming buffer state | `useState` + `useRef` in `ChatSSEHandler` |

---

## 7. Design System

### 7.1 Styling Philosophy

Kith's design language is **Refined Dark Intelligence** — a premium, focused aesthetic that feels like a high-end productivity tool rather than a generic SaaS dashboard. Think: a Bloomberg terminal meets Notion's calm confidence.

- **Dark-first:** Dark mode is the primary theme. Light mode is optional (add `dark:` prefix prefix to all color classes, toggle via `data-theme` attribute on `<html>`).
- **High information density, low visual noise:** Cards are clean, borders are subtle, typography does the heavy lifting.
- **Purposeful color:** Color is reserved for status signals (green = success, amber = warning, red = danger, blue = info). Brand accent is a specific teal-emerald.
- **Depth through shadows, not gradients:** Use subtle box-shadows for elevation hierarchy.

### 7.2 Design Tokens (CSS Custom Properties + Tailwind Config)

```css
/* styles/globals.css */
:root {
  /* Brand */
  --color-brand:         #14B8A6;   /* teal-500 — primary interactive */
  --color-brand-dark:    #0D9488;   /* teal-600 — hover */
  --color-brand-light:   #99F6E4;   /* teal-200 — light accents */

  /* Surfaces (dark mode primary) */
  --color-bg-base:       #0A0A0F;   /* near-black page background */
  --color-bg-surface:    #111118;   /* card backgrounds */
  --color-bg-elevated:   #1A1A24;   /* modals, dropdowns */
  --color-bg-hover:      #1E1E2A;   /* hover state */
  --color-bg-selected:   #1C2A32;   /* selected/active teal-tinted */

  /* Borders */
  --color-border:        #2A2A38;   /* default border */
  --color-border-strong: #3A3A50;   /* focused / highlighted border */

  /* Text */
  --color-text-primary:  #F1F5F9;   /* slate-100 — headings */
  --color-text-secondary:#94A3B8;   /* slate-400 — body */
  --color-text-muted:    #64748B;   /* slate-500 — labels, timestamps */
  --color-text-disabled: #475569;   /* slate-600 — disabled */

  /* Status */
  --color-success:       #10B981;   /* emerald-500 */
  --color-warning:       #F59E0B;   /* amber-500 */
  --color-danger:        #F43F5E;   /* rose-500 */
  --color-info:          #3B82F6;   /* blue-500 */

  /* Pipeline Stage Colors (mirrors STAGE_COLORS constant) */
  --color-stage-new:        #64748B;
  --color-stage-contacted:  #3B82F6;
  --color-stage-replied:    #8B5CF6;
  --color-stage-call-demo:  #F59E0B;
  --color-stage-won:        #10B981;
  --color-stage-lost:       #F43F5E;
}
```

**tailwind.config.ts:**
```typescript
export default {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#14B8A6', dark: '#0D9488', light: '#99F6E4' },
        surface: { base: '#0A0A0F', card: '#111118', elevated: '#1A1A24' },
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],      // body
        display: ['"Cabinet Grotesk"', 'DM Sans', 'sans-serif'], // headings
        mono: ['"JetBrains Mono"', 'monospace'],            // code, scores
      },
      borderRadius: {
        DEFAULT: '8px',
        sm: '4px',
        lg: '12px',
        xl: '16px',
        '2xl': '20px',
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.3)',
        elevated: '0 4px 16px rgba(0,0,0,0.5)',
        brand: '0 0 0 3px rgba(20,184,166,0.25)',
      },
    },
  },
};
```

### 7.3 Typography Scale

```
Display (h1): font-display, text-3xl (30px), font-semibold — page titles only
Heading (h2): font-display, text-xl (20px), font-semibold — section headers
Subheading (h3): font-sans, text-base (16px), font-medium — card titles
Body: font-sans, text-sm (14px), font-normal — default text
Small: font-sans, text-xs (12px) — labels, timestamps, badges
Mono: font-mono, text-sm — scores, numbers, code
```

### 7.4 Spacing System

Use Tailwind's default spacing (4px base unit). Key multiples:
- Component padding: `p-4` (16px)
- Card gap: `gap-3` (12px) or `gap-4` (16px)
- Section padding: `px-6 py-5`
- Page padding: `px-4 md:px-6 lg:px-8`
- Stack spacing: `space-y-3` for lists, `space-y-6` for sections

### 7.5 Component Consistency Rules

1. **Every interactive element** must have a focus ring: `focus-visible:ring-2 focus-visible:ring-brand`
2. **All cards** use `bg-surface-card border border-surface-border rounded-lg`
3. **All destructive actions** use `text-danger` or `bg-danger` with a confirmation step
4. **Disabled states** always use `opacity-50 cursor-not-allowed`
5. **Loading states** always replace content, never overlay (no "loading" text on top of stale content)
6. **Empty states** always include: an icon, a headline, a subline, and a CTA (action button)

### 7.6 Platform Colors (for Opportunity/Pipeline badges)

```typescript
export const PLATFORM_COLORS: Record<Platform, string> = {
  reddit:       'bg-orange-500/20 text-orange-400',
  linkedin:     'bg-blue-600/20 text-blue-400',
  twitter:      'bg-sky-500/20 text-sky-400',
  facebook:     'bg-blue-700/20 text-blue-400',
  instagram:    'bg-pink-500/20 text-pink-400',
  producthunt:  'bg-orange-600/20 text-orange-400',
  indiehackers: 'bg-indigo-500/20 text-indigo-400',
  hackernews:   'bg-orange-700/20 text-orange-400',
  quora:        'bg-red-600/20 text-red-400',
  youtube:      'bg-red-500/20 text-red-400',
  other:        'bg-slate-500/20 text-slate-400',
};
```

### 7.7 Accessibility Requirements

- All images: `alt` attributes
- All icon-only buttons: `aria-label`
- All form inputs: associated `<label>` (either visible or `sr-only`)
- All modals: `role="dialog"`, `aria-labelledby`, focus trap on open, return focus on close
- All error messages: `role="alert"` or `aria-live="polite"`
- Color alone never conveys meaning (always pair color with text/icon)
- Score gauges and charts: provide text alternative for screen readers
- Minimum touch target: 44×44px (all mobile interactive elements)
- WCAG AA contrast minimum for all text against its background

---

## 8. Data Flow Mapping

### 8.1 Home Page Data Flow

```
Mount → parallel API calls:
  ├── GET /api/metrics/dashboard  → { dashboard, pipeline, chart_data, goals, practice }
  │     └── renders: MomentumGauge, MetricsStrip, Chart, GoalsList
  ├── GET /api/growth/feed        → { cards, opportunities, goals, archetype }
  │     └── renders: GrowthCardFeed, TopOpportunities
  ├── GET /api/growth/checkin/today → { check_in, is_new }
  │     └── renders: CheckInCard (or ai_response if done)
  └── GET /api/suggestions        → string[]
        └── renders: SuggestionChips

User dismisses growth card:
  → POST /api/growth/cards/:id/dismiss
  → optimistic: remove from local cache immediately
  → on error: restore card

User submits check-in:
  → POST /api/growth/checkin
  → on success: response.ai_response shown inline
  → invalidate: checkInToday, growthFeed (may add new cards), user (streak updated)
```

### 8.2 Practice Session Data Flow

```
Mount PracticeSetupPage
  → user configures scenario + options
  → "Start Session" → POST /api/practice/start
  → response: { session_id, chat_id, buyer_profile, buyer_state, realtime_channel }
  → navigate to /practice/:sessionId

Mount PracticeSessionPage
  → GET /api/practice/:sessionId (session details)
  → GET /api/practice/:sessionId/messages (message history)
  → subscribe: supabase.channel(`chat:${chat_id}`) → delivery status updates

User sends message:
  → POST /api/practice/:sessionId/message { content }
  → response: { message_ids, buyer_state, session_ended, ghosted, hint, ... }
  → update buyer_state meters with animation
  → if hint: show coaching bubble
  → if ghosted: show "No reply received" UX
  → if session_ended: trigger completion flow
  → Supabase Realtime: delivery_status "delivered" at +500ms, "seen" at +1500ms

Session Complete:
  → POST /api/practice/:sessionId/complete { rating }
  → poll GET /api/practice/:sessionId/outcome every 5s
  → when session_debrief non-null: navigate to outcome page

Outcome page mount:
  → GET /api/practice/:sessionId/outcome
  → render: debrief, skill_scores, coaching_annotations
  → skill_scores null: auto-refetch at +3s, +8s (PRACTICE_SKILL_SCORES job delay: 2s)
  → coaching_annotations null: show "Being prepared..." (job delay: 5s)
  → playbook null: show "Coming in a couple hours" (job delay: 2h)
```

### 8.3 Calendar Event Lifecycle Data Flow

```
User creates calendar event:
  → POST /api/calendar { title, event_date, attendee_name, attendee_context, ... }
  → response: { event: CalendarEvent }
  → subscribe: supabase.channel(`event:${event.id}`) → wait for prep_generated = true
  → UI shows: "🔍 Researching [attendee_name]..." + "📝 Generating prep..."

Background jobs fire (async):
  → CALENDAR_RESEARCH_PROSPECT (Perplexity) at ~30–60s
  → CALENDAR_PREP_GENERATE (Groq) at ~60–120s
  → When prep_generated = true: Realtime fires payload.new.prep_generated = true
  → queryClient.invalidateQueries(calendarEvent(id))
  → re-fetch shows full prep_content
  → toast: "📝 Meeting prep is ready!"

Post-meeting debrief:
  → POST /api/calendar/:id/debrief { outcome, raw_notes }
  → AI processes: structures notes, extracts commitments + signals
  → response: { success, debrief, message }
  → show "Review & Confirm" modal with extracted commitments
  → invalidate: calendarEvent(id), calendarAlerts, commitments(), prospects(id if linked)
```

### 8.4 Feedback → Analytics Pipeline (Critical)

```
User submits feedback:
  → POST /api/feedback { opportunity_id, outcome, is_final: true, ... }
  → Backend atomically:
    - records Feedback row
    - if outcome=positive: advances opportunity stage (new→contacted or contacted→replied)
    - queues CONVERSATION_ANALYSIS job (scores message on 6 dimensions)
  → Frontend:
    - invalidate: feedbackPending, opportunities(), pipeline(), dashboard
    - show success toast

[Background, async: t+minutes]
CONVERSATION_ANALYSIS job completes:
  → skill_scores written to database
  → weekly SkillProgression updated (aggregated Sunday)
  → insights/patterns updated (weekly job)

Frontend visibility:
  → GET /api/metrics/skill-breakdown (refreshed next time user opens Metrics)
  → GET /api/insights/summary reflects new scores (cached 4h, may lag)
```

---

## 9. Performance Strategy

### 9.1 Code Splitting

```typescript
// All page components are lazily imported
const DashboardPage = lazy(() => import('./pages/dashboard/DashboardPage'));
const PracticeSessionPage = lazy(() => import('./pages/practice/PracticeSessionPage'));
// ... all pages

// Route-level Suspense with skeleton fallback
<Suspense fallback={<PageSkeleton />}>
  <Outlet />
</Suspense>
```

**Bundle split strategy:**
- Vendor chunk: React, React Router, TanStack Query
- Feature chunks: each `features/*` directory is a separate dynamic import boundary
- Supabase client: split into its own chunk (large library)
- Framer Motion: split into its own chunk (only used in ~5 components)
- Charts (Recharts): split into its own chunk (only on Metrics, Practice, Insights pages)

### 9.2 Lazy Loading Rules

- All pages: lazy-loaded via `React.lazy`
- All charts: lazy-loaded (heavy library)
- All modals: lazy-loaded until opened
- Images: native `loading="lazy"` attribute
- Intel section (opportunity detail): only fetched on explicit user click
- Goal pipeline insight: only fetched on explicit user click
- Practice replay: only fetched when user navigates to replay page

### 9.3 Memoization Strategy

```typescript
// Memoize expensive computations
const sortedOpportunities = useMemo(
  () => [...opportunities].sort((a, b) => b.composite_score - a.composite_score),
  [opportunities]
);

// Memoize callbacks passed as props to prevent child re-renders
const handleDismiss = useCallback((id: string) => {
  dismissCard.mutate(id);
}, [dismissCard]);

// Use React.memo for:
// - KanbanColumn (re-renders on every board update otherwise)
// - OpportunityCard (re-renders on list page)
// - GrowthCard (re-renders on feed scroll)
// - ChatMessageBubble (list has many items)
// DO NOT use React.memo on:
// - Simple UI primitives (overhead > benefit)
// - Components with unique identity that change frequently
```

### 9.4 Avoiding Unnecessary Re-renders

- `WorkspaceContext` and `AuthContext` values must be stable references (use `useMemo` on context value objects)
- Separate `NotificationContext` into its own provider so badge count updates don't re-render the entire app
- Calendar badge count and pipeline badge count are fetched in `NotificationContext` with a 2-minute interval, not on every render
- Avoid placing frequently-changing state (streaming buffer) high in the component tree — keep it local to `ChatSSEHandler`

### 9.5 API Performance Considerations

- Opportunity refresh (5/hour limit): Show cooldown timer using `localStorage` to track last refresh timestamp (avoid relying solely on 429)
- `GET /api/opportunities`: cache 60 seconds. Show stale data while revalidating.
- Chat suggestions (`GET /api/suggestions`): prefetch on app init, cache 5 minutes
- Growth feed: use infinite query (`useInfiniteQuery`) for "Load more" pattern
- Calendar events: pass `from` and `to` as params to limit data range — default to 45-day window
- Metrics dashboard: cache 2 minutes. Refetch on window focus only if stale.
- Debounce Nudge inputs, note submissions, and search inputs by 300ms

### 9.6 Real-Time Connection Management

- Supabase subscriptions: max 1 active channel per feature page
- Always unsubscribe in `useEffect` cleanup
- Do NOT create subscriptions in list pages (only in detail pages where specific event tracking is needed)
- Practice session subscription: create on session start, destroy on session complete + unmount

---

## 10. Authentication & Session Handling

### 10.1 Supabase Auth Integration Model

Kith uses **Supabase for auth token issuance** but validates tokens against its own backend API (not Supabase directly). The flow:

1. Supabase Auth issues JWT (via email/password login or Google OAuth)
2. Frontend stores JWT in `localStorage`
3. Every API request sends `Authorization: Bearer <jwt>` to the Kith Express backend
4. Backend validates the JWT against Supabase's JWT secret
5. Supabase client (`@supabase/supabase-js`) is used for:
   - Google OAuth URL generation (session extraction in `/auth/callback`)
   - Realtime subscriptions (postgres_changes)
   - File storage (uploads)
   - NOT for direct database queries (all data goes through Express API)

### 10.2 Token Lifecycle

```
Login/OAuth → access_token (1h TTL) + refresh_token (stored in localStorage)
                         ↓
                 Schedule refresh at (TTL - 60s)
                         ↓
              POST /api/auth/refresh with refresh_token
                         ↓
              New access_token + refresh_token returned
                         ↓
              Update localStorage + reschedule refresh
                         ↓
              On 401 from any endpoint: attempt refresh → retry once → logout
```

### 10.3 App Initialization Sequence (Every Session)

```typescript
// contexts/AuthContext.tsx — initialization on mount
async function initializeAuth() {
  setIsLoading(true);
  const { accessToken, refreshToken } = getTokensFromStorage();
  
  if (!accessToken) {
    setIsLoading(false);
    return; // → SplashScreen fades → Router shows login
  }

  try {
    const { data } = await apiClient.get('/api/auth/me');
    setUser(data.user);
    setActiveWorkspace(data.active_workspace);
    setActiveMembership(data.active_membership);
    scheduleRefresh(getRemainingTTL());
    
    // Parallel initialization (after auth confirmed)
    await Promise.allSettled([
      prefetchQuery(queryKeys.suggestions, suggestionsApi.get),
      prefetchQuery(queryKeys.calendarAlerts, calendarApi.getAlerts),
      prefetchQuery(queryKeys.feedbackPending, feedbackApi.getPending),
      registerFCMToken(),
    ]);
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 401) {
      // Try refresh first
      try {
        await refreshTokens();
        // Retry getMe
        const { data } = await apiClient.get('/api/auth/me');
        setUser(data.user);
      } catch {
        clearTokens();
      }
    }
  } finally {
    setIsLoading(false);
  }
}
```

### 10.4 Protected Route Logic

```typescript
// router/ProtectedRoute.tsx
export function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  const { user } = useAuth();

  if (isLoading) return null; // Splash handles this

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!user?.onboarding_completed) {
    return <Navigate to="/onboarding/basic" replace />;
  }

  if (!user?.active_workspace_id) {
    return <Navigate to="/workspaces" replace />;
  }

  return <Outlet />;
}
```

### 10.5 Session Persistence

- `access_token`, `refresh_token`, `kith_token_expires_at` → `localStorage`
- On tab/window focus: check token expiry and proactively refresh if < 5 minutes remaining
- On browser close/reopen: token is still in localStorage → re-hydrate on next load
- Logout: clear all localStorage keys + call `POST /api/auth/logout` + navigate to `/login`

### 10.6 Workspace Context Refresh After Switch

After `POST /api/workspaces/switch`:
```typescript
// In WorkspaceContext.switchWorkspace():
await workspacesApi.switch(workspaceId);
// Clear ALL query cache (data is now workspace-scoped to new workspace)
queryClient.clear();
// Refetch user (active_workspace_id has changed)
await refreshUser();
// Navigate to home
navigate('/home');
```

---

## 11. Real-Time & Live Updates

### 11.1 Supabase Client Init

```typescript
// lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
```

### 11.2 Practice Session Delivery Status

**Channel:** `chat:{chat_id}` (from session start response `realtime_channel`)
**Table:** `chat_messages`
**Event:** `UPDATE`

```typescript
// Mounted in PracticeSessionPage useEffect
const channel = supabase
  .channel(`chat:${chatId}`)
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'chat_messages',
  }, (payload) => {
    const updated = payload.new;
    // Update message delivery_status in local cache
    queryClient.setQueryData(
      queryKeys.practiceMessages(sessionId),
      (old: ChatMessage[] | undefined) =>
        old?.map(m => m.id === updated.id ? { ...m, delivery_status: updated.delivery_status } : m)
    );
  })
  .subscribe();

return () => { supabase.removeChannel(channel); };
```

**UI effect:**
- `delivery_status: "delivered"` → single checkmark (at t+500ms)
- `delivery_status: "seen"` → double checkmark, colored (at t+1500ms)

### 11.3 Calendar Prep Ready Subscription

**Channel:** `event:{event_id}`
**Table:** `user_events` (the calendar events table)
**Event:** `UPDATE`
**Filter:** `id=eq.{event_id}`

```typescript
const channel = supabase
  .channel(`event:${eventId}`)
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'user_events',
    filter: `id=eq.${eventId}`,
  }, (payload) => {
    if (payload.new.prep_generated && !payload.old.prep_generated) {
      queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvent(eventId) });
      showToast({ message: "📝 Meeting prep is ready!", type: "success" });
    }
  })
  .subscribe();

return () => { supabase.removeChannel(channel); };
```

### 11.4 Chat Streaming (SSE)

```typescript
// features/chat/ChatSSEHandler.tsx
// State:
const [streamingContent, setStreamingContent] = useState('');
const [isStreaming, setIsStreaming] = useState(false);
const abortControllerRef = useRef<AbortController | null>(null);

const sendStreamingMessage = async (chatId: string, message: string, options: object) => {
  abortControllerRef.current = new AbortController();
  setIsStreaming(true);
  setStreamingContent('');

  try {
    const response = await fetch(`${API_URL}/api/chat/${chatId}/message`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message, stream: true, ...options }),
      signal: abortControllerRef.current.signal,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new AppError(error.message, error.error, response.status);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === 'chunk') {
            setStreamingContent(prev => prev + data.content);
          } else if (data.type === 'done') {
            setIsStreaming(false);
            setStreamingContent('');
            queryClient.invalidateQueries({ queryKey: queryKeys.chatMessages(chatId) });
          } else if (data.type === 'error') {
            throw new Error(data.message);
          }
        } catch { /* ignore JSON parse errors for empty lines */ }
      }
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      setIsStreaming(false);
      showError('Failed to send message. Please try again.');
    }
  }
};

// Abort on unmount
useEffect(() => () => { abortControllerRef.current?.abort(); }, []);
```

### 11.5 No Real-Time on Non-Practice/Calendar Screens

Only TWO Supabase Realtime subscriptions are used:
1. `chat:{chat_id}` — during active practice sessions (delivery status)
2. `event:{event_id}` — on calendar event detail while prep is pending

All other data updates are handled via TanStack Query refetch/invalidation (polling or user-triggered). This keeps the Supabase connection count minimal.

---

## 12. Splash Screen Design

### 12.1 Component Structure

```tsx
// components/layout/SplashScreen.tsx
import { motion, AnimatePresence } from 'framer-motion';

interface SplashScreenProps {
  isVisible: boolean;
}

export function SplashScreen({ isVisible }: SplashScreenProps) {
  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className="fixed inset-0 z-[9999] bg-surface-base flex flex-col items-center justify-center"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.4, ease: 'easeInOut' } }}
        >
          {/* Kith wordmark */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="flex flex-col items-center gap-4"
          >
            <KithLogo className="w-12 h-12 text-brand" />
            <span className="font-display text-3xl font-semibold text-text-primary tracking-tight">
              kith
            </span>
          </motion.div>

          {/* Subtle animated dot beneath */}
          <motion.div
            className="mt-8 w-1 h-1 rounded-full bg-brand"
            animate={{ scale: [1, 2, 1], opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
          />

          {/* Safety timeout message */}
          <SplashTimeoutMessage />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Shows "Still loading..." only if splash has been visible > 3 seconds
function SplashTimeoutMessage() {
  const [showMessage, setShowMessage] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShowMessage(true), 3000);
    return () => clearTimeout(t);
  }, []);
  
  return showMessage ? (
    <motion.p
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="absolute bottom-12 text-xs text-text-muted"
    >
      Still loading...
    </motion.p>
  ) : null;
}
```

### 12.2 Splash in AppShell

```tsx
// components/layout/AppShell.tsx
export function AppShell() {
  const { isLoading } = useAuth();
  const [splashVisible, setSplashVisible] = useState(true);

  useEffect(() => {
    if (!isLoading) {
      // Small delay after loading complete for smooth transition
      const t = setTimeout(() => setSplashVisible(false), 200);
      return () => clearTimeout(t);
    }
  }, [isLoading]);

  return (
    <>
      <SplashScreen isVisible={splashVisible} />
      {!isLoading && <RouterProvider router={router} />}
    </>
  );
}
```

### 12.3 UX Purpose

The splash screen serves three functional roles:
1. **Prevents layout shift:** User never sees an unauthenticated flash of the protected app
2. **Hides token hydration latency:** The 150–300ms GET /api/auth/me call is invisible
3. **Establishes brand identity:** Every session opens with the Kith identity, reinforcing it as a daily ritual tool

---

## 13. Error Handling & Edge Cases

### 13.1 Global Error Boundaries

```tsx
// components/common/ErrorBoundary.tsx
// Placed at two levels:
// 1. App root — catches catastrophic errors, shows full-page error with reload button
// 2. Each feature section — catches feature errors without crashing the whole app
```

### 13.2 API Error Handling Matrix

| Error Code | HTTP | User Action | Frontend Response |
|---|---|---|---|
| `INVALID_CREDENTIALS` | 401 | Login | Inline form error: "Incorrect email or password" |
| `EMAIL_TAKEN` | 409 | Register | Inline form error + "Sign in instead" link |
| `UNAUTHORIZED` | 401 | Any | Auto-refresh → if fails: redirect to `/login` |
| `ACCOUNT_DELETED` | 403 | Any | Clear tokens, show "Account deleted" page |
| `PERMISSION_DENIED` | 403 | Any | Toast: "You don't have permission to do this" |
| `ONBOARDING_REQUIRED` | 400 | Any | Redirect to `/onboarding/basic` |
| `VOICE_PROFILE_MISSING` | 400 | Feature use | Banner: "Complete onboarding to use this feature" |
| `QUOTA_EXCEEDED` | 429 | Refresh opps | Banner: "Daily discovery limit reached. Resets at midnight" |
| `RATE_LIMIT_EXCEEDED` | 429 | AI feature | Toast: "Too many requests. Please wait a moment." |
| `NO_ACTIVE_WORKSPACE` | 400 | Any | Redirect to `/workspaces` |
| `OWNER_CANNOT_LEAVE` | 403 | Leave workspace | Modal: "Transfer ownership before leaving" |
| `INVALID_OR_EXPIRED_TOKEN` | 410 | Accept invite | Page: "This invite link has expired. Ask admin to re-send." |
| `ALREADY_A_MEMBER` | 409 | Accept invite | Redirect to workspace switch with success message |
| `SESSION_ENDED` | 400 | Practice msg | Trigger session completion flow |
| `SESSION_ALREADY_COMPLETED` | 409 | Delete practice | Toast: "Completed sessions cannot be deleted" |
| `VALIDATION_ERROR` | 400 | Any form | Inline field errors from `details` object |
| `NOT_FOUND` | 404 | Detail page | Inline "Not found" state with back button |
| `INTERNAL_ERROR` | 500 | Any | Toast: "Something went wrong. Please try again." |

### 13.3 Empty States (Complete List)

| Screen | Empty Condition | Message | CTA |
|---|---|---|---|
| Opportunities | No pending opportunities | "No opportunities yet. Your AI is finding prospects." | "Discover Now" |
| Opportunities | `should_refresh = true` | "Your list is getting stale." | "Discover New Prospects" |
| Pipeline | No deals in a column | "No deals here" | — |
| Practice | No sessions | "Start your first practice session" | "Start Session →" |
| Chat | No chats | "Start a conversation with your coach" | "New Chat" |
| Calendar | No events | "No meetings scheduled" | "Add Meeting" |
| Prospects | No prospects | "Prospects are auto-created from calendar events" | "Add Manually" |
| Goals | No active goals | "Set your first goal" | "Add Goal" |
| Follow-up | No follow-ups | "🎉 No follow-ups needed! Pipeline is active." | — |
| Commitments | No active commitments | "No open commitments. Great job staying on top of things!" | — |
| Growth feed | No cards (first time) | "Generating your first growth tips..." (skeleton) | — |
| Insights | Not enough data | "Keep sending messages to unlock insights (need 5+)" | — |
| Notifications | None | "No notifications yet" | — |
| Memory facts | None | "AI memory facts will appear here as you use the chat" | — |

### 13.4 Network Error States

- **Offline detection:** Listen to `navigator.onLine` + `window.addEventListener('offline')`. Show persistent top banner: "No internet connection" when offline.
- **API timeout (>30s):** Show "Taking longer than expected..." inline after 8s, then full error after 30s.
- **SSE stream disconnects mid-message:** Show partial content + "Connection lost. Retry?" button. Do NOT lose partial content.
- **Supabase Realtime disconnects:** Log silently, attempt reconnection automatically (Supabase client handles this). No user-visible error unless reconnect fails after 30s.

### 13.5 Partial Data Scenarios

- **Practice outcome with null skill_scores:** Show debrief if available, skeleton for skill scores, auto-poll at t+3s, t+8s, t+15s
- **Calendar event with `prep_generated = false`:** Show skeleton prep section, subscribe to Realtime, also offer "Generate Now" manual fallback
- **Growth feed with `cards: []` on first load:** Show "Generating..." state. Background job fires automatically. Suggest manually refreshing after 30s.
- **Feedback history `total: null`:** Use "Load more" pattern only; do not render page-number pagination.

### 13.6 Form Validation Strategy

**Always validate client-side first (Zod schema), then handle server-side errors:**

```typescript
// Zod schema example for feedback form
const feedbackSchema = z.object({
  outcome: z.enum(['positive', 'negative', 'pending']),
  outcome_note: z.string().max(500).optional(),
  is_final: z.boolean(),
  deal_value_usd: z.number().min(0).optional().nullable(),
  scheduled_call: z.boolean(),
  scheduled_call_date: z.string().datetime().optional().nullable(),
  scheduled_call_notes: z.string().max(500).optional().nullable(),
});

// On 400 VALIDATION_ERROR with details:
// Map details[field] to React Hook Form setError(field, { message: details[field][0] })
```

---

## 14. Frontend Testing Strategy

### 14.1 Priority Test Areas

**Priority 1 — Core User Flows:**
1. Auth: login, register, Google OAuth callback, token refresh
2. Onboarding: complete 5-step flow, voice profile generation
3. Opportunity → Chat → Feedback loop
4. Practice session: start → send message → complete → view outcome
5. Calendar: create event → wait for prep → submit debrief

**Priority 2 — State Management:**
1. Workspace switch clears all query cache
2. Optimistic updates revert correctly on error
3. Auth token refresh on 401 (with concurrent request queuing)
4. Streaming SSE: chunk accumulation, done event, error event

**Priority 3 — Role-Based Access:**
1. Manager routes: accessible by manager/admin/owner, blocked for member
2. Team view toggle on pipeline: manager sees, member does not
3. Coaching queue: renders for manager, route-guards reject member

**Priority 4 — Real-Time:**
1. Practice delivery status updates via Supabase mock
2. Calendar prep_generated update triggers prep display

### 14.2 Test Types

**Unit Tests (Vitest):**
- `api/client.ts`: interceptor logic (401 handling, refresh queue)
- `lib/auth.ts`: token storage/retrieval, schedule refresh
- `hooks/useRole.ts`: role hierarchy comparisons
- All Zod validation schemas
- Pure utility functions in `lib/utils.ts`

**Component Tests (Testing Library + Vitest):**
- `OpportunityCard.tsx`: renders all status variants, calls correct callbacks
- `BuyerStateMeters.tsx`: animates on prop changes, correct score display
- `GrowthCard.tsx`: renders all 7 card_type variants
- `FeedbackModal.tsx`: form validation, submission, optimistic behavior
- `KanbanBoard.tsx`: column rendering, drag behavior (mock @dnd-kit)

**Integration Tests (Playwright or Cypress — E2E):**
- Full login flow (mock API)
- Onboarding wizard completion
- Opportunity detail → mark sent → log feedback
- Practice: start session → send message → see delivery status → complete
- Pipeline drag-to-stage with calendar_prompt response

### 14.3 Test Infrastructure

- **Mock Strategy:** MSW (Mock Service Worker) for all API mocks — intercepts at network layer
- **Supabase Mock:** Mock `@supabase/supabase-js` channel subscription callbacks
- **SSE Mock:** Mock `fetch` to return a ReadableStream with pre-programmed chunks
- **TanStack Query:** Use `QueryClientProvider` with a fresh `QueryClient` in each test

---

## 15. Gap Analysis

### 15.1 🔴 Critical Gaps (Missing Backend Endpoints)

**GAP-01: No forgot-password / reset-password flow**
- The product references `/forgot-password` and `/reset-password` in the constants.js `ROUTES` object
- There are NO corresponding API endpoints in the OpenAPI spec
- **Frontend impact:** Cannot implement password recovery. Login page should not show "Forgot password?" link until this is built.
- **Recommendation:** Show "Forgot password? Contact support." as a temporary workaround, OR implement via Supabase's built-in `resetPasswordForEmail` client method (bypasses the Express API entirely)

**GAP-02: `/api/coach/*` routes entirely unknown**
- The backend mounts `coachRoutes` at `/api/coach` with full auth middleware
- No endpoint definitions exist in the spec
- **Frontend impact:** Unknown. If there are coach-specific features not covered by `/api/chat`, they are invisible to the frontend agent.
- **Action:** Treat `/api/coach/*` as an unmapped route group. Do not reference it until backend provides spec.

**GAP-03: No email verification status polling endpoint**
- After `POST /api/auth/register`, `needsVerification: true` is returned
- There is no `GET /api/auth/verify-status` to poll
- **Frontend workaround:** Show a "I've verified my email" button that attempts login. If login succeeds, verification is complete.

**GAP-04: No GET /api/auth/workspace-profile endpoint**
- Voice profile and workspace profile data is scattered across `GET /api/auth/me` and onboarding endpoints
- The settings/voice page must assemble profile from both sources
- **Workaround:** On settings/voice mount, call `GET /api/auth/me` (which returns `user`) + `GET /api/onboarding/status` (which returns voice profile status). The full `voice_profile` object is inside `WorkspaceProfile`, accessible via the user's workspace profile.
- **⚠️ The exact endpoint to get the full WorkspaceProfile object (including voice_profile) is ambiguous.** The spec shows it's returned from onboarding endpoints but not a clean standalone GET. Assume `GET /api/onboarding/status` returns enough to reconstruct voice profile display, or store it in AuthContext from the onboarding completion response.

**GAP-05: No PATCH /api/chat/:chatId endpoint**
- Chat titles cannot be updated (no rename functionality)
- **Frontend action:** Do not show a "Rename chat" affordance

### 15.2 🟡 Inconsistencies

**INC-01: Duplicate workspace switch endpoints**
- `POST /api/workspaces/switch` AND `POST /api/user/switch-workspace` do the same thing
- **Frontend rule:** Always use `POST /api/workspaces/switch` as canonical

**INC-02: Duplicate workspace list endpoints**
- `GET /api/workspaces` AND `GET /api/user/workspaces` both return the workspace list
- **Frontend rule:** Always use `GET /api/workspaces` as canonical

**INC-03: Opportunity refresh returns IDs only**
- `POST /api/opportunities/refresh` returns `{ opportunities: [{id}], count }` — NOT full objects
- After refresh, ALWAYS call `GET /api/opportunities` to load actual data
- **Frontend action:** On refresh success, invalidate `opportunities` query immediately

**INC-04: Feedback history has no total count**
- `GET /api/feedback/history` may return `total: null`
- **Frontend action:** Use "Load more" pattern only. Do NOT implement page-number pagination here.

**INC-05: Check-in 404 if GET today not called first**
- `POST /api/growth/checkin` returns 404 if `GET /api/growth/checkin/today` was not called first
- **Frontend action:** Always fetch `GET /api/growth/checkin/today` before showing the check-in form. Never show the submit form without first having a valid `check_in.id`.

**INC-06: Practice completion is not automatic**
- When `session_ended: true` in message response, the session is NOT automatically marked complete server-side
- Frontend MUST explicitly call `POST /api/practice/:sessionId/complete`
- **Frontend action:** Trigger completion flow (rating dialog → POST /complete) whenever `session_ended: true` is received OR user clicks "End Session"

**INC-07: `GET /api/pipeline/metrics` overlaps with `GET /api/pipeline`**
- Both return `PipelineMetrics`. Use pipeline endpoint response's `metrics` field on the Pipeline page, and `/pipeline/metrics` only if a standalone metrics widget is needed elsewhere (e.g., on dashboard).

### 15.3 🟢 UX Gaps (No Backend Impact)

**UXG-01: No deep link from push notifications**
- FCM push notifications include a `data` payload in `UserNotification.data`
- The schema is `Record<string, any>` — no defined deep link spec
- **Frontend recommendation:** Implement notification click handler that reads `data.route` (assumed field) and navigates. Document expected `data` fields as they become known.

**UXG-02: Opportunity detail has no "back to list" state preservation**
- Navigating back from `/opportunities/:id` loses the active status filter tab
- **Solution:** Persist active filter tab in `sessionStorage` or URL search params

**UXG-03: No loading indicator for workspace switch**
- Switching workspaces clears the entire query cache — there will be a visible re-loading period
- **Solution:** Show a full-page "Switching workspace..." overlay during switch + data reload

**UXG-04: Practice ghosting timeout not surfaced**
- `GHOST_TIMEOUT_SECONDS = 600` (10 minutes) — there's a 10-minute timeout for ghost scenarios
- The frontend has no way to detect timeout end without polling
- **Solution:** Show a visible countdown timer in ghost scenarios: "Waiting for response... [timer]". After timeout, auto-trigger session completion.

---

## 16. Future Extensibility

### 16.1 Architecture Supports New Features Via

**New pages:** Add route in `router/index.tsx` + page component in `pages/` + feature components in `features/`. No other changes needed.

**New API endpoints:** Add service function in appropriate `api/*.ts` file + TypeScript types in `api/types.ts` + query key in `queryKeys`. The axios interceptor, error handling, and auth handling are already in place.

**New real-time subscriptions:** Use the `useRealtimeChannel` hook. Channel management is centralized.

**New role:** Add to `WorkspaceRole` type + update hierarchy array in `useRole.ts`. All `RoleRoute` guards update automatically.

### 16.2 Scaling UI Complexity

**Multi-workspace concurrent view (future):**
- The `WorkspaceContext` currently holds one active workspace. To support multi-workspace views, abstract to a `workspaces[]` array with per-workspace query isolation using `workspaceId` as a query key prefix.

**Mobile app (React Native future path):**
- Keep all business logic in `hooks/` and `api/` — these are platform-agnostic. Only `components/` would need React Native equivalents. The hook/API layer is already designed for reuse.

**Offline support (PWA):**
- TanStack Query + Service Worker can cache responses for offline reading
- `persistQueryClient` plugin would persist cache to IndexedDB
- Practice sessions could be partially offline-capable (deferred sync)

**White-labeling / custom themes:**
- CSS custom properties architecture already supports theme overriding via `:root` variable replacement
- Add a `ThemeProvider` that reads `workspace.settings.theme` and applies custom properties

### 16.3 Multi-Team Expansion

**Current architecture assumes one active workspace per session.** To scale to enterprise multi-team:
- Add workspace selector persistent in the TopBar (already planned)
- Add `workspace_id` as a URL parameter prefix for team-scoped routes (`/ws/:workspaceId/pipeline`)
- Update all query keys to include `workspaceId` as the first element
- Update all API calls to pass workspace context via the URL (currently server infers from `active_workspace_id`)

### 16.4 Feature Flag Architecture

For gradual feature rollout (recommended pattern):
```typescript
// lib/features.ts — simple flag system
const featureFlags = {
  ENABLE_REPLAY_SCRUBBER: false,      // practice replay timeline
  ENABLE_BULK_OPPORTUNITY_SELECT: false, // multi-select + bulk actions
  ENABLE_CHAT_TITLE_EDIT: false,      // pending API endpoint (GAP-05)
  ENABLE_FORGOT_PASSWORD: false,      // pending API endpoint (GAP-01)
};

export function isFeatureEnabled(flag: keyof typeof featureFlags): boolean {
  return featureFlags[flag];
}
```

Gate in components: `{isFeatureEnabled('ENABLE_REPLAY_SCRUBBER') && <ReplayScrubber />}`

---

## Appendix A: Constants Mirror (Frontend)

All constants from the backend `constants.js` must be mirrored in `lib/constants.ts`:

```typescript
// lib/constants.ts — full mirror of backend constants.js

export const STAGE_LABELS = {
  new: 'New', contacted: 'Contacted', replied: 'Replied',
  call_demo: 'Call / Demo', closed_won: 'Closed Won', closed_lost: 'Closed Lost'
} as const;

export const STAGE_COLORS = {
  new: '#64748B', contacted: '#3B82F6', replied: '#8B5CF6',
  call_demo: '#F59E0B', closed_won: '#10B981', closed_lost: '#F43F5E'
} as const;

export const SCENARIO_LABELS = {
  interested: 'Interested Lead', polite_decline: 'Polite No',
  ghost: 'No Response', skeptical: 'Skeptical', 
  price_objection: 'Price Concern', not_right_time: 'Bad Timing'
} as const;

export const SCENARIO_COLORS = {
  interested: '#10B981', polite_decline: '#F59E0B', ghost: '#64748B',
  skeptical: '#F43F5E', price_objection: '#8B5CF6', not_right_time: '#0EA5E9'
} as const;

export const SKILL_DIMENSION_LABELS = {
  hook: 'Hook Strength', clarity: 'Message Clarity', value_prop: 'Value Proposition',
  personalization: 'Personalization', cta: 'Call to Action', tone: 'Tone Fit'
} as const;

export const ARCHETYPE_ICONS = {
  seller: '💼', builder: '🔨', freelancer: '🎯',
  creator: '✨', professional: '🏆', learner: '📚'
} as const;

export const ARCHETYPE_LABELS = {
  seller: 'Seller', builder: 'Builder', freelancer: 'Freelancer',
  creator: 'Creator', professional: 'Professional', learner: 'Learner'
} as const;

export const MEETING_OUTCOME_LABELS = {
  hot: '🔥 Hot', positive: '✅ Positive', neutral: '😐 Neutral',
  cold: '❄️ Cold', dead: '💀 Dead end'
} as const;

export const PRESSURE_MODIFIERS = [
  { type: 'decision_maker_watching', label: '👀 Decision Maker Watching', description: 'Someone important is observing' },
  { type: 'aggressive_buyer', label: '😤 Aggressive Buyer', description: 'Short on time and very direct' },
  { type: 'competitor_mentioned', label: '🏁 Competitor Mentioned', description: 'They recently looked at an alternative' },
  { type: 'compliance_concern', label: '🔒 Compliance Concern', description: 'Rules, approvals, or policies are a factor' },
] as const;

export const FOLLOW_UP_THRESHOLDS = {
  contacted: 4,
  replied: 6,
  call_demo: 3,
} as const;

export const GROWTH_CARD_TYPE_ICONS: Record<string, string> = {
  tip: '💡', strategy: '🗺️', resource: '📚',
  reflection: '🪞', challenge: '⚡', community: '🤝', insight: '🎯',
};

export const PLATFORM_LABELS = {
  reddit: 'Reddit', linkedin: 'LinkedIn', twitter: 'X / Twitter',
  facebook: 'Facebook', instagram: 'Instagram', producthunt: 'Product Hunt',
  indiehackers: 'Indie Hackers', hackernews: 'Hacker News', quora: 'Quora', youtube: 'YouTube',
  other: 'Other'
} as const;

export const ALLOWED_FILE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv'];
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export const CHAT_MESSAGE_MAX_LENGTH = 5000;
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
```

---

## Appendix B: App Init Sequence (Complete)

```
Cold load
    ↓
SplashScreen visible (opacity 1)
    ↓
AuthContext.initializeAuth()
    ├── No token → setIsLoading(false) → splash fades → router shows /login
    └── Has token →
        ├── GET /api/auth/me
        │   ├── 200 → setUser, setWorkspace, setMembership
        │   │        → scheduleTokenRefresh
        │   │        → parallel:
        │   │            PUT /api/user/fcm-token (fire-and-forget)
        │   │            prefetch /api/suggestions
        │   │            prefetch /api/calendar/alerts
        │   │            prefetch /api/feedback/pending
        │   │        → setIsLoading(false) → splash fades
        │   │        → Router evaluates:
        │   │            onboarding_completed=false → /onboarding/basic
        │   │            active_workspace_id=null → /workspaces
        │   │            else → /home (or last visited route if stored)
        │   └── 401 → attempt refresh → retry GET /api/auth/me
        │               → success: resume above
        │               → fail: clear tokens, splash fades → /login
```

---

*Kith Frontend Architecture Document — Generated from OpenAPI v4.2.0 + Product Behavior Doc v2 + routes analysis*
*Coverage: 20+ screens | 120+ API endpoints | 16 sections | Complete gap analysis*
