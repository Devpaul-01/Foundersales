// ── Pipeline ──────────────────────────────────────────────────
export const PIPELINE_STAGES = {
  NEW:         'new',
  CONTACTED:   'contacted',
  REPLIED:     'replied',
  CALL_DEMO:   'call_demo',
  CLOSED_WON:  'closed_won',
  CLOSED_LOST: 'closed_lost',
} as const;

export const STAGE_LABELS: Record<string, string> = {
  new:         'New',
  contacted:   'Contacted',
  replied:     'Replied',
  call_demo:   'Call / Demo',
  closed_won:  'Closed Won',
  closed_lost: 'Closed Lost',
};

export const STAGE_COLORS: Record<string, string> = {
  new:         '#64748b',
  contacted:   '#3b82f6',
  replied:     '#8b5cf6',
  call_demo:   '#f59e0b',
  closed_won:  '#10b981',
  closed_lost: '#ef4444',
};

export const PIPELINE_STAGE_VALUES = [
  'contacted', 'replied', 'call_demo', 'closed_won', 'closed_lost',
] as const;

// ── Opportunities ─────────────────────────────────────────────
export const OPPORTUNITY_STATUS = {
  PENDING: 'pending',
  VIEWED:  'viewed',
  SENT:    'sent',
} as const;

export const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  viewed:  'Viewed',
  sent:    'Sent',
};

// ── Practice ──────────────────────────────────────────────────
export const SCENARIO_TYPES = [
  'cold_outreach', 'follow_up', 'objection', 'discovery', 'closing', 'custom',
] as const;

export const PRACTICE_SCENARIOS = [
  { type: 'interested',      label: 'Interested Lead',  weight: 3 },
  { type: 'polite_decline',  label: 'Polite No',        weight: 2 },
  { type: 'ghost',           label: 'No Response',      weight: 2 },
  { type: 'skeptical',       label: 'Skeptical',        weight: 2 },
  { type: 'price_objection', label: 'Price Concern',    weight: 1 },
  { type: 'not_right_time',  label: 'Bad Timing',       weight: 1 },
] as const;

export const SCENARIO_LABELS: Record<string, string> = {
  interested:      'Interested Lead',
  polite_decline:  'Polite No',
  ghost:           'No Response',
  skeptical:       'Skeptical',
  price_objection: 'Price Concern',
  not_right_time:  'Bad Timing',
};

export const SCENARIO_COLORS: Record<string, string> = {
  interested:      '#10b981',
  polite_decline:  '#f59e0b',
  ghost:           '#64748b',
  skeptical:       '#ef4444',
  price_objection: '#8b5cf6',
  not_right_time:  '#0ea5e9',
};

export const SCENARIO_DESCRIPTIONS: Record<string, string> = {
  interested:      'Practice closing an engaged prospect who wants to hear more.',
  polite_decline:  'Turn a soft no into a future opportunity.',
  ghost:           'Write a message strong enough to break the silence.',
  skeptical:       'Handle pushback with confidence — no over-explaining.',
  price_objection: 'Lead with value before they mention the price.',
  not_right_time:  'Show you understand their situation and timing.',
};

export const DIFFICULTY_LABELS: Record<string, string> = {
  beginner:  'Beginner',
  standard:  'Standard',
  advanced:  'Advanced',
  expert:    'Expert',
};

export const DIFFICULTY_COLORS: Record<string, string> = {
  beginner:  '#10b981',
  standard:  '#3b82f6',
  advanced:  '#f59e0b',
  expert:    '#ef4444',
};

export const PRESSURE_MODIFIERS = [
  {
    type:        'decision_maker_watching',
    label:       '👀 Decision Maker Present',
    description: 'Someone important is observing the conversation.',
  },
  {
    type:        'aggressive_buyer',
    label:       '😤 Aggressive Buyer',
    description: 'Short on time, very direct, low tolerance.',
  },
  {
    type:        'competitor_mentioned',
    label:       '🏁 Competitor Mentioned',
    description: "They're actively comparing you to an alternative.",
  },
  {
    type:        'compliance_concern',
    label:       '🔒 Compliance Concern',
    description: 'Rules, approvals, or policies are a blocker.',
  },
] as const;

// ── Skills ────────────────────────────────────────────────────
export const SKILL_DIMENSION_LABELS: Record<string, string> = {
  hook:            'Hook Strength',
  clarity:         'Message Clarity',
  value_prop:      'Value Proposition',
  personalization: 'Personalization',
  cta:             'Call to Action',
  tone:            'Tone Fit',
  objection:       'Objection Handling',
};

// ── Calendar ──────────────────────────────────────────────────
export const MEETING_OUTCOME_LABELS: Record<string, string> = {
  hot:      '🔥 Hot',
  positive: '✅ Positive',
  neutral:  '😐 Neutral',
  cold:     '❄️ Cold',
  dead:     '💀 Dead end',
};

export const MEETING_OUTCOME_COLORS: Record<string, string> = {
  hot:      '#ef4444',
  positive: '#10b981',
  neutral:  '#64748b',
  cold:     '#3b82f6',
  dead:     '#94a3b8',
};

// ============================================================
// ADDITIONS / FIXES TO frontend/src/lib/constants.ts
//
// NOT standalone — merge into your existing constants.ts.
// ============================================================

// 1. FIX — remove the dead 'follow_up' underscore-variant key. Only
//    'followup' is a valid enum value per schemas.ts's Zod enum; the
//    duplicate key was leftover cruft from a past naming migration.
//    REPLACE the existing EVENT_TYPE_LABELS with:
export const EVENT_TYPE_LABELS: Record<string, string> = {
  meeting:  'Meeting',
  call:     'Call',
  demo:     'Demo',
  followup: 'Follow-up',
  other:    'Other',
};

// 2. MEETING_OUTCOME_COLORS is UNCHANGED here — the fix is DELETING the
//    shadowing local redefinition at the bottom of
//    CalendarEventDetailPage.tsx (done in that file's rewrite) so the
//    import from this file is what's actually used everywhere.

// 3. ADD — standardized icon sizing (replaces the 13/14/15/16 mix
//    previously scattered as inline magic numbers in
//    CalendarEventDetailPage.tsx)
export const ICON_SIZE_INLINE = 14;
export const ICON_SIZE_SECTION = 20;

// 4. ADD — voice memo transcription status labels
export const VOICE_MEMO_STATUS_LABELS: Record<string, string> = {
  pending:    'Queued',
  processing: 'Transcribing…',
  completed:  'Ready',
  failed:     'Failed',
};


// ── Pipeline (alias exports expected by newer pages) ──────────
export const PIPELINE_STAGE_COLORS: Record<string, string> = {
  new:         '#94a3b8',
  contacted:   '#3b82f6',
  replied:     '#8b5cf6',
  call_demo:   '#f59e0b',
  closed_won:  '#10b981',
  closed_lost: '#ef4444',
};

export const PIPELINE_STAGE_LABELS: Record<string, string> = {
  new:         'New',
  contacted:   'Contacted',
  replied:     'Replied',
  call_demo:   'Call / Demo',
  closed_won:  'Closed Won',
  closed_lost: 'Closed Lost',
};

// ── Prospects ─────────────────────────────────────────────────
export const PROSPECT_STAGE_LABELS: Record<string, string> = {
  prospect:     'Prospect',
  engaged:      'Engaged',
  negotiating:  'Negotiating',
  closed_won:   'Won',
  closed_lost:  'Lost',
  dormant:      'Dormant',
};

export const COMMITMENT_STATUS_LABELS: Record<string, string> = {
  pending:  'Pending',
  done:     'Done',
  overdue:  'Overdue',
  ignored:  'Ignored',
};

export const PROSPECT_STATUS_LABELS: Record<string, string> = {
  active:    'Active',
  stale:     'Stale',
  converted: 'Converted',
  lost:      'Lost',
};

export const GOAL_PERIOD_LABELS: Record<string, string> = {
  weekly:    'Weekly',
  monthly:   'Monthly',
  quarterly: 'Quarterly',
  annual:    'Annual',
};

export const GOAL_METRIC_LABELS: Record<string, string> = {
  count:   'Count',
  revenue: 'Revenue ($)',
  rate:    'Rate (%)',
  score:   'Score',
  other:   'Other',
};

export const SIGNAL_TYPE_LABELS: Record<string, string> = {
  buying:     'Buying Signal',
  risk:       'Risk Signal',
  timing:     'Timing Signal',
  engagement: 'Engagement',
};

export const SIGNAL_COLORS: Record<string, string> = {
  buying:     '#10b981',
  risk:       '#ef4444',
  timing:     '#f59e0b',
  engagement: '#3b82f6',
};

// ── Growth ────────────────────────────────────────────────────
export const ARCHETYPE_ICONS: Record<string, string> = {
  seller:       '💼',
  builder:      '🔨',
  freelancer:   '🎯',
  creator:      '✨',
  professional: '🏆',
  learner:      '📚',
};

export const ARCHETYPE_LABELS: Record<string, string> = {
  seller:       'Seller',
  builder:      'Builder',
  freelancer:   'Freelancer',
  creator:      'Creator',
  professional: 'Professional',
  learner:      'Learner',
};

export const GROWTH_CARD_TYPE_ICONS: Record<string, string> = {
  tip:        '💡',
  strategy:   '🗺️',
  resource:   '📚',
  reflection: '🪞',
  challenge:  '⚡',
  community:  '🤝',
  insight:    '🎯',
};

export const GROWTH_CARD_TYPE_LABELS: Record<string, string> = {
  tip:        'Tip',
  strategy:   'Weekly Plan',
  resource:   'Resource',
  reflection: 'Reflection',
  challenge:  'Challenge',
  community:  'Community',
  insight:    'Insight',
};

// ── Platforms ─────────────────────────────────────────────────
export const PLATFORM_LABELS: Record<string, string> = {
  reddit:       'Reddit',
  linkedin:     'LinkedIn',
  twitter:      'X / Twitter',
  facebook:     'Facebook',
  instagram:    'Instagram',
  producthunt:  'Product Hunt',
  indiehackers: 'Indie Hackers',
  hackernews:   'Hacker News',
  quora:        'Quora',
  youtube:      'YouTube',
  other:        'Other',
};

export const PLATFORM_COLORS: Record<string, string> = {
  reddit:       'bg-orange-50 text-orange-700 border-orange-200',
  linkedin:     'bg-blue-50 text-blue-700 border-blue-200',
  twitter:      'bg-sky-50 text-sky-700 border-sky-200',
  facebook:     'bg-blue-50 text-blue-800 border-blue-200',
  instagram:    'bg-pink-50 text-pink-700 border-pink-200',
  producthunt:  'bg-orange-50 text-orange-700 border-orange-200',
  indiehackers: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  hackernews:   'bg-orange-50 text-orange-700 border-orange-200',
  quora:        'bg-red-50 text-red-700 border-red-200',
  youtube:      'bg-red-50 text-red-700 border-red-200',
  other:        'bg-slate-50 text-slate-700 border-slate-200',
};

// ── Roles ─────────────────────────────────────────────────────
export const ROLE_LABELS: Record<string, string> = {
  owner:   'Owner',
  admin:   'Admin',
  manager: 'Manager',
  member:  'Member',
};

export const ROLE_HIERARCHY = ['member', 'manager', 'admin', 'owner'] as const;

// ── Upload ────────────────────────────────────────────────────
export const ALLOWED_FILE_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf', 'text/plain', 'text/csv',
];
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

// ── Chat ──────────────────────────────────────────────────────
export const CHAT_MESSAGE_MAX_LENGTH = 5000;
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
// Chat audit (task #6): page size for the chat list's infinite-scroll
// pagination. Mirrors the backend default in config/constants.js —
// keep these two in sync if either changes.
export const CHAT_LIST_PAGE_SIZE = 30;
// Chat audit (§4.1): page size for message pagination. Mirrors the
// backend's CHAT_MESSAGES_PAGE_SIZE default.
export const CHAT_MESSAGES_PAGE_SIZE = 30;

// ── Feedback ─────────────────────────────────────────────────
export const FEEDBACK_OUTCOMES = {
  POSITIVE: 'positive',
  NEGATIVE: 'negative',
  PENDING:  'pending',
} as const;

// ── User roles ────────────────────────────────────────────────
export const USER_ROLES = [
  { value: 'founder',   label: 'Founder' },
  { value: 'sales',     label: 'Sales' },
  { value: 'freelancer',label: 'Freelancer' },
  { value: 'marketer',  label: 'Marketer' },
  { value: 'developer', label: 'Developer' },
  { value: 'other',     label: 'Other' },
] as const;

export const INDUSTRIES = [
  { value: 'saas',       label: 'SaaS' },
  { value: 'ecommerce',  label: 'E-Commerce' },
  { value: 'services',   label: 'Services' },
  { value: 'fintech',    label: 'Fintech' },
  { value: 'health',     label: 'Health' },
  { value: 'education',  label: 'Education' },
  { value: 'other',      label: 'Other' },
] as const;

// ── Routes ────────────────────────────────────────────────────
export const ROUTES = {
  LOGIN:            '/login',
  REGISTER:         '/register',
  AUTH_CALLBACK:    '/auth/callback',
  HOME:             '/home',
  OPPORTUNITIES:    '/opportunities',
  PIPELINE:         '/pipeline',
  PRACTICE:         '/practice',
  PRACTICE_NEW:     '/practice/new',
  CHAT:             '/chat',
  CALENDAR:         '/calendar',
  PROSPECTS:        '/prospects',
  GOALS:            '/goals',
  FOLLOWUP:         '/followup',
  COMMITMENTS:      '/commitments',
  GROWTH:           '/growth',
  INSIGHTS:         '/insights',
  METRICS:          '/metrics',
  WORKSPACES:       '/workspaces',
  SETTINGS:         '/settings',
  SETTINGS_VOICE:   '/settings/voice',
  SETTINGS_MEMORY:  '/settings/memory',
  SETTINGS_NOTIFS:  '/settings/notifications',
  SETTINGS_MEMBERS: '/settings/members',
  TEAM_PIPELINE:    '/team/pipeline',
  TEAM_OPPS:        '/team/opportunities',
  TEAM_INSIGHTS:    '/team/insights',
  TEAM_ANALYTICS:   '/team/analytics',
  TEAM_LEADERBOARD: '/team/leaderboard',
  TEAM_COACHING:    '/team/coaching',
  TEAM_METRICS: '/team/metrics',

  TEAM_ACTIVITY:    '/team/activity',
  ONBOARDING:       '/onboarding',
  ONBOARDING_BASIC: '/onboarding/basic',
} as const;
