// ============================================================
// FILE: src/pages/practice/PracticeDashboardPage.tsx
// From practice-25.txt Section 5:
// - GET /practice/skill-dashboard for skill history + badges
// - GET /practice/sessions with DB-level aggregate stats (not row fetch)
// - Infinite scroll on session history
// ============================================================
import React, { useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { practiceApi } from '@/api/practice';
import { queryKeys }   from '@/lib/queryKeys';
import { Button }      from '@/components/ui/Button';
import { Badge }       from '@/components/ui/Badge';
import { Skeleton }    from '@/components/ui/Skeleton';
import { EmptyState, Spinner } from '@/components/common/index';
import { ScoreGauge }  from '@/components/ui/ScoreGauge';
import { SCENARIO_LABELS, SCENARIO_COLORS, SKILL_DIMENSION_LABELS, DIFFICULTY_LABELS, DIFFICULTY_COLORS } from '@/lib/constants';
import { formatRelativeDate, cn } from '@/lib/utils';
import { Dumbbell, Trophy, TrendingUp, Zap, ChevronRight, Target } from 'lucide-react';
import type { PracticeSession } from '@/api/types';

function SessionRow({ session }: { session: PracticeSession }) {
  const navigate = useNavigate();
  const color    = SCENARIO_COLORS[session.scenario_type] ?? '#64748b';
  const diffColor= DIFFICULTY_COLORS[session.difficulty_level] ?? '#64748b';

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

export default function PracticeDashboardPage() {
  const navigate    = useNavigate();
  const sentinelRef = useRef<HTMLDivElement>(null);

  const { data: skillData, isLoading: skillLoading } = useQuery({
    queryKey: queryKeys.practiceSkillDashboard,
    queryFn:  () => practiceApi.getSkillDashboard().then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  // Session list with aggregate stats — DB-level per Section 5 of practice-25.txt
  const {
    data: sessionsData, isLoading: sessionsLoading,
    fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: queryKeys.practiceSessions(),
    queryFn: ({ pageParam = 0 }) =>
      practiceApi.listSessions({ limit: 20, offset: pageParam as number }).then((r) => r.data),
    getNextPageParam: (last, pages) =>
      (last.sessions?.length ?? 0) === 20 ? pages.length * 20 : undefined,
    initialPageParam: 0,
    staleTime: 60_000,
  });

  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage();
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage],
  );

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(handleObserver, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [handleObserver]);

  const allSessions = sessionsData?.pages.flatMap((p) => p.sessions) ?? [];
  const stats       = sessionsData?.pages[0]?.stats;
  const badges      = skillData?.badges ?? [];

  // Radar chart data from latest skill history
  const latestSkill = skillData?.skill_history?.[0];
  const radarData   = latestSkill
    ? Object.entries(SKILL_DIMENSION_LABELS).map(([key, label]) => ({
        subject: label,
        value:   latestSkill[`${key}_avg` as keyof typeof latestSkill] as number ?? 0,
        fullMark: 10,
      }))
    : [];

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
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total sessions', value: stats.total,      icon: <Dumbbell size={15} /> },
            { label: 'Reply rate',     value: `${stats.reply_rate}%`, icon: <Zap size={15} /> },
            { label: 'Streak',         value: `${stats.streak}d`,    icon: <TrendingUp size={15} /> },
            { label: 'Avg score',      value: stats.avg_score,  icon: <Target size={15} /> },
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
      )}

      {/* Skill radar + badges */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Skill radar */}
        <div className="bg-white border border-surface-border rounded-lg p-5">
          <h2 className="text-sm font-semibold text-text-primary mb-4">Skill breakdown</h2>
          {skillLoading ? (
            <Skeleton className="h-56 w-full" rounded="lg" />
          ) : radarData.length > 0 ? (
            <>
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
              {latestSkill?.top_weakness && (
                <div className="mt-2 flex items-center gap-2">
                  <Badge variant="amber" size="xs" dot>Focus: {SKILL_DIMENSION_LABELS[latestSkill.top_weakness] ?? latestSkill.top_weakness}</Badge>
                  {latestSkill.top_strength && (
                    <Badge variant="green" size="xs" dot>Strong: {SKILL_DIMENSION_LABELS[latestSkill.top_strength] ?? latestSkill.top_strength}</Badge>
                  )}
                </div>
              )}
            </>
          ) : (
            <EmptyState
              icon="📊"
              headline="No skill data yet"
              subline="Complete sessions to build your skill profile."
              compact
            />
          )}
        </div>

        {/* Badges */}
        <div className="bg-white border border-surface-border rounded-lg p-5">
          <h2 className="text-sm font-semibold text-text-primary mb-4 flex items-center gap-2">
            <Trophy size={14} className="text-warning" /> Achievements
          </h2>
          {badges.length === 0 ? (
            <EmptyState
              icon="🏅"
              headline="No badges yet"
              subline="Complete your first session to earn achievements."
              compact
            />
          ) : (
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
          )}
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

        {sessionsLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" rounded="md" />
            ))}
          </div>
        ) : allSessions.length === 0 ? (
          <EmptyState
            icon={<Dumbbell size={28} />}
            headline="No sessions yet"
            subline="Start your first practice session to build your skills."
            action={{ label: 'Start now', onClick: () => navigate('/practice/new') }}
          />
        ) : (
          <>
            {allSessions.map((s) => <SessionRow key={s.id} session={s} />)}
            <div ref={sentinelRef} className="flex justify-center py-3">
              {isFetchingNextPage && <Spinner size="sm" />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
