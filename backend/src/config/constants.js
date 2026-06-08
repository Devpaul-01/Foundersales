// src/config/constants.js — v5.2
// FIXES:
//  MED-01: FOLLOW_UP_THRESHOLDS was `const` (not exported). Any file
//          importing it received `undefined`, causing TypeError at runtime
//          when reading `.contacted`, `.replied`, `.call_demo`.
//          Changed to `export const`.
//  MED-02: OPP_STATUS was a separate identical object — risk of silent drift
//          if OPPORTUNITY_STATUS was updated but OPP_STATUS was not.
//          OPP_STATUS is now a live alias reference to OPPORTUNITY_STATUS.
//          All existing `OPP_STATUS` imports continue to work unchanged.
//  MED-03: PIPELINE_STAGE_VALUES already fixed to Object.values(PIPELINE_STAGES).

// ── Follow-up timing (days since last stage change) ─────────
// FIX MED-01: was `const` — now `export const` so followupSequenceJob
// receives the object instead of undefined.
export const FOLLOW_UP_THRESHOLDS = {
  contacted: 4,
  replied:   6,
  call_demo: 3,
};

export const TIERS = { FREE: 'free', PRO: 'pro', ENTERPRISE: 'enterprise' };
export const WORKSPACE_PLANS = { FREE: 'free', PRO: 'pro', ENTERPRISE: 'enterprise' };
// RECONSIDER-01: VIEWER removed
export const WORKSPACE_ROLES = { OWNER: 'owner', ADMIN: 'admin', MANAGER: 'manager', MEMBER: 'member' };
export const WORKSPACE_MANAGER_ROLES = ['owner', 'admin', 'manager']; // used by requirePermission
export const INVITE_EXPIRY_DAYS = 7;
export const DEFAULT_INVITE_ROLE = 'member';
export const WORKSPACE_PERPLEXITY_LIMITS = { free: 5, pro: 50, enterprise: 200 };
export const CHAT_MODES = { GENERAL: 'general', MEETING_NOTES: 'meeting_notes', PREP: 'prep', FOLLOWUP_COACH: 'followup_coach' };
export const MEETING_OUTCOMES = { HOT: 'hot', POSITIVE: 'positive', NEUTRAL: 'neutral', COLD: 'cold', DEAD: 'dead' };
export const MEETING_OUTCOME_LABELS = { hot: '🔥 Hot', positive: '✅ Positive', neutral: '😐 Neutral', cold: '❄️ Cold', dead: '💀 Dead end' };
export const SIGNAL_TYPES = { BUYING: 'buying', RISK: 'risk', TIMING: 'timing', ENGAGEMENT: 'engagement' };
export const COMMITMENT_STATUSES = { PENDING: 'pending', DONE: 'done', OVERDUE: 'overdue', IGNORED: 'ignored' };
export const PROSPECT_STAGES = { PROSPECT: 'prospect', ENGAGED: 'engaged', NEGOTIATING: 'negotiating', CLOSED_WON: 'closed_won', CLOSED_LOST: 'closed_lost', DORMANT: 'dormant' };
export const INSIGHT_TYPES = { PATTERN: 'pattern', STALL: 'stall', QUESTION_CLUSTER: 'question_cluster', TIMING_ALERT: 'timing_alert', WIN_PATTERN: 'win_pattern' };
export const ROUTES = { LOGIN: '/login', REGISTER: '/register', FORGOT_PASSWORD: '/forgot-password', RESET_PASSWORD: '/reset-password', ONBOARDING: '/onboarding', DASHBOARD: '/dashboard', GROWTH: '/growth', OPPORTUNITIES: '/opportunities', INSIGHTS: '/insights', PIPELINE: '/pipeline', CHAT: '/chat', PRACTICE: '/practice', CALENDAR: '/calendar', PROSPECTS: '/prospects', METRICS: '/metrics', SETTINGS: '/settings', GOALS: '/goals', WORKSPACES: '/workspaces' };
export const PERPLEXITY_LIMITS = { free: 2, pro: 20, enterprise: 30 };
export const PERPLEXITY_GLOBAL_DAILY_CAP = 500;
export const PERPLEXITY_COST_PER_CALL_CENTS = 5;
export const PERPLEXITY_GLOBAL_DAILY_CAP_TOKENS = 2_000_000;
export const PERPLEXITY_TOKEN_LIMITS = { free: 50_000, pro: 500_000, enterprise: 9_999_999 };
export const GROQ_LIMITS = { free: Infinity, pro: Infinity, enterprise: Infinity };
export const COST_PER_1K_TOKENS = { perplexity_sonar_pro: 0.1, groq: 0 };
export const MODELS = { GROQ: process.env.GROQ_MODEL || 'llama-3.1-8b-instant', PERPLEXITY: process.env.PERPLEXITY_MODEL || 'sonar-pro' };
export const PIPELINE_STAGES = { NEW: 'new', CONTACTED: 'contacted', REPLIED: 'replied', CALL_DEMO: 'call_demo', CLOSED_WON: 'closed_won', CLOSED_LOST: 'closed_lost' };
// FIX MED-03: Derived from PIPELINE_STAGES directly — adding a new stage
// here automatically updates the values array.
export const PIPELINE_STAGE_VALUES = Object.values(PIPELINE_STAGES);
export const STAGE_LABELS = { new: 'New', contacted: 'Contacted', replied: 'Replied', call_demo: 'Call / Demo', closed_won: 'Closed Won', closed_lost: 'Closed Lost' };
export const STAGE_COLORS = { new: '#64748B', contacted: '#3B82F6', replied: '#8B5CF6', call_demo: '#F59E0B', closed_won: '#10B981', closed_lost: '#F43F5E' };

// FIX MED-02: OPP_STATUS is now a live alias of OPPORTUNITY_STATUS.
// Both names export the same object reference — updating OPPORTUNITY_STATUS
// automatically updates OPP_STATUS. Prefer OPPORTUNITY_STATUS in new code.
// Status lifecycle: pending (untouched) → viewed (auto on open) → sent (feedback logged)
// ACTED and DONE removed — simplified to 3 states.
export const OPPORTUNITY_STATUS = { PENDING: 'pending', VIEWED: 'viewed', SENT: 'sent' };
export const OPP_STATUS = OPPORTUNITY_STATUS; // @deprecated — use OPPORTUNITY_STATUS

export const FEEDBACK_OUTCOMES = { POSITIVE: 'positive', NEGATIVE: 'negative' };
export const CHAT_TYPES = { GENERAL: 'general', OPPORTUNITY: 'opportunity', PRACTICE: 'practice' };
export const DELIVERY_STATUS = { PENDING: 'pending', DELIVERED: 'delivered', SEEN: 'seen', REPLIED: 'replied', GHOSTED: 'ghosted' };
export const PRACTICE_SCENARIOS = [
  { type: 'interested',     weight: 25, label: 'Interested Lead',  reply_delay_range: [30, 120] },
  { type: 'polite_decline', weight: 25, label: 'Polite No',        reply_delay_range: [60, 300] },
  { type: 'ghost',          weight: 20, label: 'No Response',      reply_delay_range: null },
  { type: 'skeptical',      weight: 15, label: 'Skeptical Response', reply_delay_range: [45, 180] },
  { type: 'price_objection', weight: 10, label: 'Price Concern',   reply_delay_range: [120, 400] },
  { type: 'not_right_time', weight: 5,  label: 'Bad Timing',       reply_delay_range: [90, 240] },
];
export const GHOST_TIMEOUT_SECONDS = 600;
export const PRESSURE_MODIFIERS = [
  { type: 'decision_maker_watching', label: '👀 Decision Maker Watching', description: 'Someone important is observing' },
  { type: 'aggressive_buyer',        label: '😤 Aggressive Buyer',        description: 'Short on time and very direct' },
  { type: 'competitor_mentioned',    label: '🏁 Competitor Mentioned',    description: 'They recently looked at an alternative' },
  { type: 'compliance_concern',      label: '🔒 Compliance Concern',      description: 'Rules, approvals, or policies are a factor' },
];
export const SCENARIO_LABELS = { interested: 'Interested', polite_decline: 'Polite Decline', ghost: 'Ghost', skeptical: 'Skeptical', price_objection: 'Price Objection', not_right_time: 'Not Right Time' };
export const SCENARIO_COLORS = { interested: '#10B981', polite_decline: '#F59E0B', ghost: '#64748B', skeptical: '#F43F5E', price_objection: '#8B5CF6', not_right_time: '#0EA5E9' };
export const OPPORTUNITIES_PER_RUN = 8;
export const MIN_COMPOSITE_SCORE = 5;
export const BATCH_SIZE = 5;
export const BATCH_DELAY_MS = 2000;
export const MIN_MESSAGES_FOR_SUMMARY = 10;
export const SUMMARIZE_EVERY_N_MESSAGES = 5;
export const JOB_INTERVALS = { OPPORTUNITY_FETCH: 6*60*60*1000, PERFORMANCE_SUMMARY: 24*60*60*1000, METRICS_AGGREGATION: 24*60*60*1000, PATTERN_DETECTION: 7*24*60*60*1000, SKILL_PROGRESSION: 7*24*60*60*1000, GROWTH_PUSH_MORNING: 24*60*60*1000, GROWTH_PUSH_EVENING: 24*60*60*1000 };
export const SENT_PROMPT_DELAY_MS = 48*60*60*1000;
export const GROWTH_PUSH_MAX_PER_DAY = 2;
export const GROWTH_PUSH_MIN_GAP_HOURS = 6;
export const MIN_ANALYSES_FOR_PATTERNS = 5;
export const INSIGHTS_CACHE_HOURS = 4;
export const CALENDAR_PREP_HOURS_BEFORE = 24;
export const USER_ROLES = ['founder','sales','freelancer','marketer','developer','other'];
export const INDUSTRIES = ['saas','ecommerce','services','fintech','health','education','other'];
export const EXPERIENCE_LEVELS = ['beginner','intermediate','advanced'];
export const OUTREACH_GOALS = ['get_customers','find_investors','partnerships','feedback','hiring'];
export const PLATFORMS = ['reddit','linkedin','twitter','facebook','instagram','email','other'];
export const ARCHETYPES = { SELLER: 'seller', BUILDER: 'builder', FREELANCER: 'freelancer', CREATOR: 'creator', PROFESSIONAL: 'professional', LEARNER: 'learner' };
export const ARCHETYPE_LABELS = { seller: 'Seller', builder: 'Builder', freelancer: 'Freelancer', creator: 'Creator', professional: 'Professional', learner: 'Learner' };
export const ARCHETYPE_DESCRIPTIONS = { seller: 'You sell a product or service', builder: "You're building something new", freelancer: 'You offer skills on a project basis', creator: 'You create content or media', professional: "You're growing your career", learner: "You're developing new skills" };
export const ARCHETYPE_ICONS = { seller: '💼', builder: '🔨', freelancer: '🎯', creator: '✨', professional: '🏆', learner: '📚' };
export const SUPPORTED_PLATFORMS = { REDDIT: 'reddit', LINKEDIN: 'linkedin', TWITTER: 'twitter', FACEBOOK: 'facebook', INSTAGRAM: 'instagram', PRODUCTHUNT: 'producthunt', INDIEHACKERS: 'indiehackers', HACKERNEWS: 'hackernews', QUORA: 'quora', YOUTUBE: 'youtube' };
export const PLATFORM_LABELS = { reddit: 'Reddit', linkedin: 'LinkedIn', twitter: 'X / Twitter', facebook: 'Facebook', instagram: 'Instagram', producthunt: 'Product Hunt', indiehackers: 'Indie Hackers', hackernews: 'Hacker News', quora: 'Quora', youtube: 'YouTube' };
export const ARCHETYPE_PLATFORM_DEFAULTS = { seller: ['reddit','linkedin','twitter'], builder: ['reddit','indiehackers','hackernews'], freelancer: ['linkedin','reddit','twitter'], creator: ['instagram','twitter','youtube'], professional: ['linkedin','twitter','reddit'], learner: ['reddit','twitter','linkedin'] };
export const GROWTH_CARD_TYPES = { TIP: 'tip', STRATEGY: 'strategy', RESOURCE: 'resource', REFLECTION: 'reflection', CHALLENGE: 'challenge', COMMUNITY: 'community', INSIGHT: 'insight' };
export const SKILL_DIMENSION_LABELS = { hook: 'Hook Strength', clarity: 'Message Clarity', value_prop: 'Value Proposition', personalization: 'Personalization', cta: 'Call to Action', tone: 'Tone Fit' };
export const DEFAULT_NOTIFICATION_PREFS = { new_opportunities: true, feedback_reminders: true, practice_replies: true, calendar_prep_ready: true, daily_tip: true, check_in_prompt: true, debrief_reminder: true, commitment_reminder: true, weekly_insights: true, weekly_plan: true, pattern_insights: true, skill_progression: true, morning_growth_push: true, evening_growth_push: true };
export const OBJECTION_TYPES = { GHOST: 'ghost', PRICE: 'price', TIMING: 'timing', TRUST: 'trust', COMPETITION: 'competition', FIT: 'fit', OTHER: 'other' };
export const PATTERN_TYPES = { GHOST_TRIGGER: 'ghost_trigger', SUCCESS_SIGNAL: 'success_signal', WEAKNESS: 'weakness', OBJECTION_TYPE: 'objection_type' };

// FIX Bug A: CONVERSATION_ANALYSIS added so feedback.js can enqueue by constant
// instead of a raw string, eliminating the risk of silent mismatch on typos.
export const QUEUE_JOB_TYPES = {
  PRACTICE_DELIVERED:             'PRACTICE_DELIVERED',
  PRACTICE_SEEN:                  'PRACTICE_SEEN',
  PRACTICE_REPLY:                 'PRACTICE_REPLY',
  PRACTICE_GHOST:                 'PRACTICE_GHOST',
  PRACTICE_SKILL_SCORES:          'PRACTICE_SKILL_SCORES',
  PRACTICE_COACHING_ANNOTATIONS:  'PRACTICE_COACHING_ANNOTATIONS',
  PRACTICE_PLAYBOOK:              'PRACTICE_PLAYBOOK',
  CONVERSATION_ANALYSIS:          'conversation_analysis',   // Issue 6 / Bug A
};

// IMP-02: background job types
// FIX Issue 14: CALENDAR_PREP_GENERATE and CALENDAR_RESEARCH_PROSPECT added
// so calendar.js can enqueue via constant and backgroundWorker.js can dispatch
// by the same constant — eliminates fire-and-forget for prep/research.
export const BACKGROUND_JOB_TYPES = {
  TIP_CARD_GENERATE:          'tip_card_generate',
  OPPORTUNITIES_REFRESH:      'opportunities_refresh',
  ARCHETYPE_DETECT:           'archetype_detect',
  FIRST_TIME_CARDS_GENERATE:  'first_time_cards_generate',
  SEED_MEMORY:                'seed_memory',
  CHECKIN_TIP_GENERATE:       'checkin_tip_generate',
  CALENDAR_PREP_GENERATE:     'calendar_prep_generate',      // Issue 14
  CALENDAR_RESEARCH_PROSPECT: 'calendar_research_prospect',  // Issue 14
};

// Gap 3: activity event types
export const ACTIVITY_EVENTS = { PRACTICE_COMPLETED: 'practice_completed', DEAL_CLOSED: 'deal_closed', OPPORTUNITY_CREATED: 'opportunity_created', GOAL_REACHED: 'goal_reached', MEMBER_JOINED: 'member_joined', OPPORTUNITY_ASSIGNED: 'opportunity_assigned', NUDGE_SENT: 'nudge_sent' };
export const MAX_FILE_SIZE = 10*1024*1024;
export const ALLOWED_FILE_TYPES = ['image/jpeg','image/png','image/gif','image/webp','application/pdf','text/plain','text/csv'];
export const UPLOAD_LIMITS = { MAX_SIZE_BYTES: 10*1024*1024, ALLOWED_TYPES: ['image/jpeg','image/png','image/gif','image/webp','application/pdf','text/plain','text/csv'], SUPABASE_BUCKET: 'clutch-uploads' };
