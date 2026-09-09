// ============================================================
// FILE: src/pages/practice/PracticeDashboardPage.tsx
// DEMO BUILD — all data is hardcoded locally for screenshots.
// No network calls, no loading states, no empty states.
// ============================================================
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { Button }      from '@/components/ui/Button';
import { Badge }       from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import { Dumbbell, Trophy, TrendingUp, Zap, ChevronRight, Target } from 'lucide-react';

// ------------------------------------------------------------
// Local constants (mirrors @/lib/constants shape used by this page)
// ------------------------------------------------------------
const SCENARIO_LABELS: Record<string, string> = {
  cold_outreach:      'Cold outreach',
  objection_handling: 'Objection handling',
  discovery_call:     'Discovery call',
  pricing_negotiation:'Pricing negotiation',
  follow_up:          'Follow-up',
  demo_pitch:         'Demo pitch',
};

const SCENARIO_COLORS: Record<string, string> = {
  cold_outreach:       '#2563eb',
  objection_handling:  '#dc2626',
  discovery_call:      '#7c3aed',
  pricing_negotiation: '#d97706',
  follow_up:           '#0891b2',
  demo_pitch:           '#16a34a',
};

const DIFFICULTY_LABELS: Record<string, string> = {
  easy:   'Easy',
  medium: 'Medium',
  hard:   'Hard',
};

const DIFFICULTY_COLORS: Record<string, string> = {
  easy:   '#16a34a',
  medium: '#d97706',
  hard:   '#dc2626',
};

const SKILL_DIMENSION_LABELS: Record<string, string> = {
  rapport:      'Rapport building',
  discovery:    'Discovery',
  objection:    'Objection handling',
  clarity:      'Clarity',
  closing:      'Closing',
  persuasion:   'Persuasion',
};

function formatRelativeDate(iso: string) {
  const date = new Date(iso);
  const now  = new Date('2026-09-08T09:00:00Z');
  const diffMs = now.getTime() - date.getTime();
  const diffH  = Math.round(diffMs / 3_600_000);
  if (diffH < 1) return 'Just now';
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.round(diffH / 24);
  if (diffD === 1) return 'Yesterday';
  if (diffD < 7) return `${diffD}d ago`;
  const diffW = Math.round(diffD / 7);
  if (diffW < 5) return `${diffW}w ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ------------------------------------------------------------
// Local UI primitives (self-contained so this renders standalone)
// ------------------------------------------------------------
function EmptyState({
  icon, headline, subline, compact, action,
}: {
  icon: React.ReactNode; headline: string; subline?: string; compact?: boolean;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'py-8' : 'py-14')}>
      <div className="text-3xl mb-2">{icon}</div>
      <p className="text-sm font-semibold text-text-primary">{headline}</p>
      {subline && <p className="text-xs text-text-muted mt-1 max-w-[240px]">{subline}</p>}
      {action && (
        <Button size="sm" className="mt-4" onClick={action.onClick}>{action.label}</Button>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Hardcoded data
// ------------------------------------------------------------
type PracticeSession = {
  id: string;
  scenario_type: string;
  difficulty_level: string;
  created_at: string;
  session_goal?: string | null;
  message_strength_score: number | null;
};

const MOCK_SESSIONS: PracticeSession[] = [
  { id: 's_1041', scenario_type: 'objection_handling',  difficulty_level: 'hard',   created_at: '2026-09-08T07:40:00Z', session_goal: 'Handle price pushback',        message_strength_score: 84 },
  { id: 's_1040', scenario_type: 'discovery_call',      difficulty_level: 'medium', created_at: '2026-09-07T15:10:00Z', session_goal: 'Uncover budget timeline',      message_strength_score: 72 },
  { id: 's_1039', scenario_type: 'cold_outreach',       difficulty_level: 'easy',   created_at: '2026-09-07T09:05:00Z', session_goal: null,                            message_strength_score: 91 },
  { id: 's_1038', scenario_type: 'pricing_negotiation',  difficulty_level: 'hard',   created_at: '2026-09-06T18:22:00Z', session_goal: 'Hold firm on enterprise tier', message_strength_score: 58 },
  { id: 's_1037', scenario_type: 'follow_up',           difficulty_level: 'easy',   created_at: '2026-09-06T11:47:00Z', session_goal: 'Re-engage cold lead',          message_strength_score: 76 },
  { id: 's_1036', scenario_type: 'demo_pitch',          difficulty_level: 'medium', created_at: '2026-09-05T16:03:00Z', session_goal: 'Pitch to technical buyer',     message_strength_score: 68 },
  { id: 's_1035', scenario_type: 'objection_handling',  difficulty_level: 'medium', created_at: '2026-09-04T13:31:00Z', session_goal: 'Overcome "not now" objection', message_strength_score: 63 },
  { id: 's_1034', scenario_type: 'discovery_call',      difficulty_level: 'easy',   created_at: '2026-09-03T10:12:00Z', session_goal: null,                            message_strength_score: 88 },
  { id: 's_1033', scenario_type: 'cold_outreach',       difficulty_level: 'medium', created_at: '2026-09-02T09:50:00Z', session_goal: 'First touch, SaaS founder',    message_strength_score: 55 },
  { id: 's_1032', scenario_type: 'pricing_negotiation',  difficulty_level: 'easy',   created_at: '2026-09-01T14:18:00Z', session_goal: null,                            message_strength_score: 79 },
  { id: 's_1031', scenario_type: 'demo_pitch',          difficulty_level: 'hard',   created_at: '2026-08-31T17:05:00Z', session_goal: 'Handle live objection mid-demo', message_strength_score: null },
];

const MOCK_STATS = {
  total: 47,
  reply_rate: 68,
  streak: 6,
  avg_score: 74,
};

const MOCK_BADGES = [
  { id: 'b1', badge_label: '🔥 6-day streak',        badge_description: 'Practiced 6 days in a row' },
  { id: 'b2', badge_label: '🎯 Objection master',    badge_description: 'Scored 80+ on 5 objection-handling sessions' },
  { id: 'b3', badge_label: '⚡ Fast closer',          badge_description: 'Closed a session in under 8 messages' },
  { id: 'b4', badge_label: '💬 50 sessions',          badge_description: 'Completed 50 practice sessions' },
  { id: 'b5', badge_label: '🥇 Top 10% this week',    badge_description: 'Ranked in the top 10% of practicing reps' },
];

const MOCK_SKILL_HISTORY = [
  {
    rapport_avg:    8.2,
    discovery_avg:  6.4,
    objection_avg:  7.8,
    clarity_avg:    8.6,
    closing_avg:    5.9,
    persuasion_avg: 7.1,
    top_weakness:   'closing',
    top_strength:   'clarity',
  },
];

// ------------------------------------------------------------
// Session row
// ------------------------------------------------------------
function SessionRow({ session }: { session: PracticeSession }) {
  const navigate  = useNavigate();
  const color     = SCENARIO_COLORS[session.scenario_type] ?? '#64748b';
  const diffColor = DIFFICULTY_COLORS[session.difficulty_level] ?? '#64748b';

  return (
    <div
      onClick={() => navigate(`/practice/${session.id}/outcome`)}
      className="flex items-center gap-3 px-4 py-3 hover:bg-surface-hover transition-colors cursor-pointer border-b border-surface-border last:border-0"
    >
      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary">
            {SCENARIO_LABELS[session.scenario_type]}
          </span>
          <span
            className="text-xs px-1.5 py-0.5 rounded font-medium"
            style={{ backgroundColor: `${diffColor}18`, color: diffColor }}
          >
            {DIFFICULTY_LABELS[session.difficulty_level]}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="text-xs text-text-muted">{formatRelativeDate(session.created_at)}</span>
          {session.session_goal && (
            <span className="text-xs text-text-muted truncate max-w-[160px]">
              Goal: {session.session_goal}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {session.message_strength_score != null ? (
          <span className={cn(
            'text-sm font-mono font-bold',
            session.message_strength_score >= 70 ? 'text-success' :
            session.message_strength_score >= 40 ? 'text-warning' : 'text-danger',
          )}>
            {Math.round(session.message_strength_score)}
          </span>
        ) : (
          <span className="text-xs text-text-muted italic">Scoring…</span>
        )}
        <ChevronRight size={14} className="text-text-muted" />
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Page
// ------------------------------------------------------------
export default function PracticeDashboardPage() {
  const navigate = useNavigate();

  const allSessions = MOCK_SESSIONS;
  const stats        = MOCK_STATS;
  const badges       = MOCK_BADGES;
  const latestSkill  = MOCK_SKILL_HISTORY[0];

  const radarData = Object.entries(SKILL_DIMENSION_LABELS).map(([key, label]) => ({
    subject:  label,
    value:    latestSkill[`${key}_avg` as keyof typeof latestSkill] as number,
    fullMark: 10,
  }));

  return (
    <div className="page-container space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-text-primary">Practice</h1>
        <Button
          leftIcon={<Dumbbell size={14} />}
          onClick={() => navigate('/practice/new')}
        >
          Start session
        </Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total sessions', value: stats.total,             icon: <Dumbbell size={15} /> },
          { label: 'Reply rate',     value: `${stats.reply_rate}%`,  icon: <Zap size={15} /> },
          { label: 'Streak',         value: `${stats.streak}d`,      icon: <TrendingUp size={15} /> },
          { label: 'Avg score',      value: stats.avg_score,         icon: <Target size={15} /> },
        ].map((s) => (
          <div key={s.label} className="bg-white border border-surface-border rounded-lg p-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center text-brand shrink-0">
              {s.icon}
            </div>
            <div>
              <p className="text-xs text-text-muted">{s.label}</p>
              <p className="text-base font-bold text-text-primary font-mono">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Skill radar + badges */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Skill radar */}
        <div className="bg-white border border-surface-border rounded-lg p-5">
          <h2 className="text-sm font-semibold text-text-primary mb-4">Skill breakdown</h2>
          <ResponsiveContainer width="100%" height={220}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="#e2e8f0" />
              <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <Radar
                dataKey="value"
                stroke="#2563eb"
                fill="#2563eb"
                fillOpacity={0.15}
                strokeWidth={2}
              />
              <Tooltip
                contentStyle={{ fontSize: 11, border: '1px solid #e2e8f0', borderRadius: 8 }}
                formatter={(v: number) => [`${v}/10`, 'Score']}
              />
            </RadarChart>
          </ResponsiveContainer>
          <div className="mt-2 flex items-center gap-2">
            <Badge variant="amber" size="xs" dot>Focus: {SKILL_DIMENSION_LABELS[latestSkill.top_weakness] ?? latestSkill.top_weakness}</Badge>
            <Badge variant="green" size="xs" dot>Strong: {SKILL_DIMENSION_LABELS[latestSkill.top_strength] ?? latestSkill.top_strength}</Badge>
          </div>
        </div>

        {/* Badges */}
        <div className="bg-white border border-surface-border rounded-lg p-5">
          <h2 className="text-sm font-semibold text-text-primary mb-4 flex items-center gap-2">
            <Trophy size={14} className="text-warning" /> Achievements
          </h2>
          <div className="flex flex-wrap gap-2">
            {badges.map((b) => (
              <div
                key={b.id}
                title={b.badge_description}
                className="flex items-center gap-1.5 bg-surface-base border border-surface-border rounded-full px-3 py-1.5 text-xs font-medium text-text-primary"
              >
                {b.badge_label}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Session history */}
      <div className="bg-white border border-surface-border rounded-lg">
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border">
          <h2 className="text-sm font-semibold text-text-primary">Session history</h2>
          <Button variant="ghost" size="xs" onClick={() => navigate('/practice/new')}>
            New session
          </Button>
        </div>

        {allSessions.map((s) => <SessionRow key={s.id} session={s} />)}

        <div className="flex justify-center py-3">
          <Button variant="ghost" size="xs" className="text-text-muted">
            Load more
          </Button>
        </div>
      </div>
    </div>
  );
}
