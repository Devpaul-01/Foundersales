/**
 * Centralised query key factory.
 * All keys are hierarchical so invalidations can target precisely.
 * e.g. invalidating ['opportunities'] also invalidates ['opportunities', { status:'pending' }]
 */
export const queryKeys = {
  // ── Auth ────────────────────────────────────────────────────
  me:               ['auth', 'me']              as const,
  onboardingStatus: ['onboarding', 'status']    as const,
  onboardingQuestions: ['onboarding', 'questions'] as const,

  // ── User ────────────────────────────────────────────────────
  memoryFacts:      ['user', 'memory']          as const,
  notifications:    (params?: object) => ['user', 'notifications', params] as const,
  workspacesList:   ['workspaces']              as const,

  // ── Suggestions ─────────────────────────────────────────────
  suggestions:      ['suggestions']             as const,

  // ── Opportunities ───────────────────────────────────────────
  opportunities:    (params?: object) => ['opportunities', params]            as const,
  opportunity:      (id: string)      => ['opportunities', id]                as const,
  opportunityIntel: (id: string)      => ['opportunities', id, 'intel']       as const,
  teamOpportunities: ['opportunities', 'team']  as const,

  // ── Pipeline ────────────────────────────────────────────────
  pipeline:         (view?: string)   => ['pipeline', view ?? 'individual']   as const,
  deal:             (id: string)      => ['pipeline', 'deals', id]            as const,
  pipelineMetrics:  ['pipeline', 'metrics']     as const,

  // ── Feedback ────────────────────────────────────────────────
  feedbackPending:  ['feedback', 'pending']     as const,
  feedbackHistory:  (params?: object) => ['feedback', 'history', params]      as const,

  // ── Chat ────────────────────────────────────────────────────
  chats:            (params?: object) => ['chats', params]                    as const,
  chat:             (chatId: string)  => ['chats', chatId]                    as const,
  chatMessages:     (chatId: string)  => ['chats', chatId, 'messages']        as const,

  // ── Practice ────────────────────────────────────────────────
  practiceSkillDashboard: ['practice', 'skill-dashboard']                     as const,
  practiceSessions:  (params?: object) => ['practice', 'sessions', params]    as const,
  practiceSession:   (id: string)      => ['practice', id]                    as const,
  practiceMessages:  (id: string)      => ['practice', id, 'messages']        as const,
  practiceOutcome:   (id: string)      => ['practice', id, 'outcome']         as const,
  practiceReplay:    (id: string)      => ['practice', id, 'replay']          as const,
  practiceBadges:    ['practice', 'badges']                                   as const,
  practiceHistory:   (params?: object) => ['practice', 'history', params]     as const,
  practiceProgress:  ['practice', 'progress-summary']                         as const,

  // ── Calendar ────────────────────────────────────────────────
  calendar:         (params?: object) => ['calendar', params]                 as const,
  calendarEvent:    (id: string)      => ['calendar', id]                     as const,
  calendarAlerts:   ['calendar', 'alerts']                                    as const,
  calendarSearch: (params?: object) => ['calendar', 'search', params] as const,
  voiceMemos:     (eventId: string) => ['calendar', eventId, 'voice-memos'] as const,
  mergeCandidates: ['prospects', 'merge-candidates'] as const,

  // ── Prospects ───────────────────────────────────────────────
  prospects:        (params?: object) => ['prospects', params]                as const,
  prospect:         (id: string)      => ['prospects', id]                    as const,

  // ── Goals ───────────────────────────────────────────────────
  goals:            ['goals']                                                 as const,
  goal:             (id: string)      => ['goals', id]                        as const,
  goalNotes:        (goalId: string)  => ['goals', goalId, 'notes']           as const,
  goalPipelineInsight: (goalId: string) => ['goals', goalId, 'pipeline-insight'] as const,

  // ── Commitments ─────────────────────────────────────────────
  commitments:      (params?: object) => ['commitments', params]              as const,

  // ── Follow-up ───────────────────────────────────────────────
  
  followup:           ['followup'] as const,
  followups:          () => ['followup', 'list'] as const,  // 👈 add this
  followupUnviewed:   () => ['followup', 'unviewed-count'] as const,  // 👈 add this

  // ── Insights ────────────────────────────────────────────────
  insightsSummary:  ['insights', 'summary']                                   as const,
  patterns:         (params?: object) => ['insights', 'patterns', params]     as const,
  weeklyInsights:   ['insights', 'weekly']                                    as const,
  signalsSummary:   ['insights', 'signals', 'summary']                        as const,
  commitmentsSummary: ['insights', 'commitments', 'summary']                  as const,
  whyLosing:        ['insights', 'why-losing']                                as const,
  skillTrend:       ['insights', 'skill-trend']                               as const,
  workspaceWhyLosing:  ['insights', 'workspace', 'why-losing']                as const,
  workspaceSkillMatrix: ['insights', 'workspace', 'skill-matrix']             as const,

  // ── Growth ──────────────────────────────────────────────────
  growthFeed:       (params?: object) => ['growth', 'feed', params]           as const,
  growthPlan:       ['growth', 'plan']                                        as const,
  growthHistory:    (params?: object) => ['growth', 'history', params]        as const,
  checkInToday:     ['growth', 'checkin', 'today']                            as const,
  weeklyPlan:       ['growth', 'plan']                                        as const,

  // ── Metrics ─────────────────────────────────────────────────
  metrics:          (sub?: string) => sub ? ['metrics', sub] : ['metrics', 'dashboard'] as const,
  dashboard:        ['metrics', 'dashboard']                                  as const,
  skillBreakdown:   ['metrics', 'skill-breakdown']                            as const,
  intelligence:     ['metrics', 'intelligence']                               as const,
  alerts:           ['metrics', 'alerts']                                     as const,
  prospectsHealth:  ['metrics', 'prospects-health']                           as const,
  calendarPrep:     ['metrics', 'calendar-prep']                              as const,
  practiceSkillProfile:    ['metrics', 'practice-skill-profile']              as const,
  achievements:     ['metrics', 'achievements']                               as const,
  practiceSummary:  (period?: string) => ['metrics', 'practice-summary', period ?? '30d'] as const,
  practiceRecommendations: ['metrics', 'practice-recommendations']            as const,
  objections:       ['metrics', 'objections']                                 as const,
  meetingsSummary:  (period?: string) => ['metrics', 'meetings-summary', period ?? '30d'] as const,
  teamOverview:     ['metrics', 'team', 'overview']                           as const,
  leaderboard:      ['metrics', 'team', 'leaderboard']                        as const,
  coachingQueue:    ['metrics', 'team', 'coaching-queue']                     as const,
  teamVelocity:     ['metrics', 'team', 'velocity']                           as const,

  // ── Workspace ───────────────────────────────────────────────
  workspace:        (id: string)      => ['workspace', id]                    as const,
  workspaceMembers: (id: string)      => ['workspace', id, 'members']         as const,
  workspaceInvites: (id: string)      => ['workspace', id, 'invites']         as const,
  workspaceAnalytics: (id: string)    => ['workspace', id, 'analytics']       as const,
  workspaceActivity: (params?: object) => ['workspace', 'activity', params]   as const,
} as const;
