import React, { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell }          from '@/components/layout/AppShell';
import { AppLayout }         from '@/components/layout/AppLayout';
import { AuthLayout }        from '@/components/layout/AuthLayout';
import { OnboardingLayout }  from '@/components/layout/OnboardingLayout';
import { ProtectedRoute }    from './ProtectedRoute';
import { OnboardingRoute }   from './OnboardingRoute';
import { RoleRoute }         from './RoleRoute';
import { SkeletonPage }      from '@/components/ui/Skeleton';

// ── Lazy page imports ────────────────────────────────────────
// Auth
const LoginPage           = lazy(() => import('@/pages/auth/LoginPage'));
const RegisterPage        = lazy(() => import('@/pages/auth/RegisterPage'));
const OAuthCallbackPage   = lazy(() => import('@/pages/auth/OAuthCallbackPage'));
const AcceptInvitePage    = lazy(() => import('@/pages/auth/AcceptInvitePage'));
import ForgotPasswordPage from '@/pages/auth/ForgotPasswordPage';
import ResetPasswordPage from '@/pages/auth/ResetPasswordPage';

// Onboarding
const OnboardingBasicPage     = lazy(() => import('@/pages/onboarding/OnboardingBasicPage'));
const OnboardingQuestionsPage = lazy(() => import('@/pages/onboarding/OnboardingQuestionsPage'));
const OnboardingPreviewPage   = lazy(() => import('@/pages/onboarding/OnboardingPreviewPage'));

// App core
const DashboardPage         = lazy(() => import('@/pages/dashboard/DashboardPage'));
const OpportunitiesPage     = lazy(() => import('@/pages/opportunities/OpportunitiesPage'));
const OpportunityDetailPage = lazy(() => import('@/pages/opportunities/OpportunityDetailPage'));
const CreateOpportunityPage     = lazy(() => import('@/pages/opportunities/CreateOpportunityPage'));
const PipelinePage          = lazy(() => import('@/pages/pipeline/PipelinePage'));
const DealDetailPage        = lazy(() => import('@/pages/pipeline/DealDetailPage'));

// Practice
const PracticeDashboardPage = lazy(() => import('@/pages/practice/PracticeDashboardPage'));
const PracticeSetupPage     = lazy(() => import('@/pages/practice/PracticeSetupPage'));
const PracticeSessionPage   = lazy(() => import('@/pages/practice/PracticeSessionPage'));
const PracticeOutcomePage   = lazy(() => import('@/pages/practice/PracticeOutcomePage'));
const PracticeReplayPage    = lazy(() => import('@/pages/practice/PracticeReplayPage'));

// Chat
const ChatListPage = lazy(() => import('@/pages/chat/ChatListPage'));
const ChatPage     = lazy(() => import('@/pages/chat/ChatPage'));

// Calendar
const CalendarPage            = lazy(() => import('@/pages/calendar/CalendarPage'));
const CalendarEventDetailPage = lazy(() => import('@/pages/calendar/CalendarEventDetailPage'));

// CRM
const ProspectsPage     = lazy(() => import('@/pages/prospects/ProspectsPage'));
const ProspectDetailPage= lazy(() => import('@/pages/prospects/ProspectDetailPage'));
const GoalsPage         = lazy(() => import('@/pages/goals/GoalsPage'));
const GoalDetailPage    = lazy(() => import('@/pages/goals/GoalDetailPage'));

// Other features
const FollowupPage     = lazy(() => import('@/pages/followup/FollowupPage'));
const CommitmentsPage  = lazy(() => import('@/pages/commitments/CommitmentsPage'));
const GrowthPage       = lazy(() => import('@/pages/growth/GrowthPage'));
const InsightsPage     = lazy(() => import('@/pages/insights/InsightsPage'));
const MetricsPage      = lazy(() => import('@/pages/metrics/MetricsPage'));
const WorkspacesPage   = lazy(() => import('@/pages/workspaces/WorkspacesPage'));

// Settings
const SettingsPage             = lazy(() => import('@/pages/settings/SettingsPage'));
const VoiceProfilePage         = lazy(() => import('@/pages/settings/VoiceProfilePage'));
const MemoryPage               = lazy(() => import('@/pages/settings/MemoryPage'));
const NotificationsSettingsPage= lazy(() => import('@/pages/settings/NotificationsSettingsPage'));
const TeamMembersPage          = lazy(() => import('@/pages/settings/TeamMembersPage'));

// Team (manager+)
const TeamPipelinePage    = lazy(() => import('@/pages/team/TeamPipelinePage'));
const TeamOpportunitiesPage=lazy(() => import('@/pages/team/TeamOpportunitiesPage'));
const TeamInsightsPage    = lazy(() => import('@/pages/team/TeamInsightsPage'));
const TeamAnalyticsPage   = lazy(() => import('@/pages/team/TeamAnalyticsPage'));
const LeaderboardPage     = lazy(() => import('@/pages/team/LeaderboardPage'));
const CoachingQueuePage   = lazy(() => import('@/pages/team/CoachingQueuePage'));
const ActivityFeedPage    = lazy(() => import('@/pages/team/ActivityFeedPage'));

const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));
// In your router/index.tsx
import SetPasswordPage from '@/pages/auth/SetPasswordPage';

// Add to public routes


// ── Suspense wrapper ─────────────────────────────────────────
function Page({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<SkeletonPage />}>{children}</Suspense>;
}

// ── Router ───────────────────────────────────────────────────
export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [

      // ── PUBLIC AUTH ────────────────────────────────────────

{
  element: <AuthLayout />,
  children: [
    { path: '/login',          element: <Page><LoginPage /></Page> },
    { path: '/register',       element: <Page><RegisterPage /></Page> },
    { path: '/forgot-password',element: <Page><ForgotPasswordPage /></Page> },  // ✅ ADD
    { path: '/reset-password', element: <Page><ResetPasswordPage /></Page> },
    { path: '/set-password', element: <Page><SetPasswordPage /></Page> }// ✅ ADD
  ],
},
      { path: '/auth/callback',  element: <Page><OAuthCallbackPage /></Page> },
      { path: '/accept-invite', element: <Page><AcceptInvitePage /></Page> },

      // ── ONBOARDING (auth required, onboarding_completed=false) ──
      {
        element: <OnboardingRoute />,
        children: [
          {
            element: <OnboardingLayout />,
            children: [
              { path: '/onboarding/basic',     element: <Page><OnboardingBasicPage /></Page> },
              { path: '/onboarding/q/:burst',  element: <Page><OnboardingQuestionsPage /></Page> },
              { path: '/onboarding/preview',   element: <Page><OnboardingPreviewPage /></Page> },
              { path: '/onboarding',           element: <Navigate to="/onboarding/basic" replace /> },
            ],
          },
        ],
      },

      // ── WORKSPACE SELECTION (auth required, no active workspace) ──
      {
        element: <ProtectedRoute requiresWorkspace={false} />,
        children: [
          { path: '/workspaces', element: <Page><WorkspacesPage /></Page> },
        ],
      },

      // ── MAIN APP (auth + onboarding complete + workspace) ──
      {
        element: <ProtectedRoute requiresWorkspace />,
        children: [
          {
            element: <AppLayout />,
            children: [
              { index: true,         element: <Navigate to="/home" replace /> },
              { path: '/',           element: <Navigate to="/home" replace /> },

              // Core
              { path: '/home',       element: <Page><DashboardPage /></Page> },
              { path: '/opportunities',    element: <Page><OpportunitiesPage /></Page> },
              { path: '/opportunities/:id',element: <Page><OpportunityDetailPage /></Page> },
              { path: '/opportunities/create',element: <Page><CreateOpportunityPage /></Page> },
              { path: '/pipeline',         element: <Page><PipelinePage /></Page> },
              { path: '/pipeline/:id',     element: <Page><DealDetailPage /></Page> },

              // Practice
              { path: '/practice',                   element: <Page><PracticeDashboardPage /></Page> },
              { path: '/practice/new',               element: <Page><PracticeSetupPage /></Page> },
              { path: '/practice/:sessionId',        element: <Page><PracticeSessionPage /></Page> },
              { path: '/practice/:sessionId/outcome',element: <Page><PracticeOutcomePage /></Page> },
              { path: '/practice/:sessionId/replay', element: <Page><PracticeReplayPage /></Page> },

              // Chat
              { path: '/chat',        element: <Page><ChatListPage /></Page> },
              { path: '/chat/:chatId',element: <Page><ChatPage /></Page> },

              // Calendar
              { path: '/calendar',    element: <Page><CalendarPage /></Page> },
              { path: '/calendar/:id',element: <Page><CalendarEventDetailPage /></Page> },

              // CRM
              { path: '/prospects',    element: <Page><ProspectsPage /></Page> },
              { path: '/prospects/:id',element: <Page><ProspectDetailPage /></Page> },
              { path: '/goals',        element: <Page><GoalsPage /></Page> },
              { path: '/goals/:id',    element: <Page><GoalDetailPage /></Page> },

              // Features
              { path: '/followup',    element: <Page><FollowupPage /></Page> },
              { path: '/commitments', element: <Page><CommitmentsPage /></Page> },
              { path: '/growth',      element: <Page><GrowthPage /></Page> },
              { path: '/insights',    element: <Page><InsightsPage /></Page> },
              { path: '/metrics',     element: <Page><MetricsPage /></Page> },

              // Settings
              { path: '/settings',                element: <Page><SettingsPage /></Page> },
              { path: '/settings/voice',          element: <Page><VoiceProfilePage /></Page> },
              { path: '/settings/memory',         element: <Page><MemoryPage /></Page> },
              { path: '/settings/notifications',  element: <Page><NotificationsSettingsPage /></Page> },
              {
                path: '/settings/members',
                element: (
                  <RoleRoute minRole="admin">
                    <Page><TeamMembersPage /></Page>
                  </RoleRoute>
                ),
              },

              // Team (manager+)
              { path: '/team/pipeline',    element: <RoleRoute minRole="manager"><Page><TeamPipelinePage /></Page></RoleRoute> },
              { path: '/team/opportunities',element:<RoleRoute minRole="manager"><Page><TeamOpportunitiesPage /></Page></RoleRoute> },
              { path: '/team/insights',    element: <RoleRoute minRole="manager"><Page><TeamInsightsPage /></Page></RoleRoute> },
              { path: '/team/analytics',   element: <RoleRoute minRole="manager"><Page><TeamAnalyticsPage /></Page></RoleRoute> },
              { path: '/team/leaderboard', element: <RoleRoute minRole="manager"><Page><LeaderboardPage /></Page></RoleRoute> },
              { path: '/team/coaching',    element: <RoleRoute minRole="manager"><Page><CoachingQueuePage /></Page></RoleRoute> },
              { path: '/team/activity',    element: <RoleRoute minRole="manager"><Page><ActivityFeedPage /></Page></RoleRoute> },
            ],
          },
        ],
      },

      // ── CATCH-ALL ──────────────────────────────────────────
      { path: '*', element: <Page><NotFoundPage /></Page> },
    ],
  },
]);
