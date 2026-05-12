// ============================================================
// FILE: src/pages/practice/PracticeOutcomePage.tsx
// - Polls for skill_scores until populated (t+2s per practice-25.txt)
// - coaching_annotations shown when ready (t+5s)
// - playbook: "coming in a couple of hours" (t+2h, no poll)
// ============================================================
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer } from 'recharts';
import { practiceApi } from '@/api/practice';
import { queryClient }  from '@/lib/queryClient';
import { queryKeys }    from '@/lib/queryKeys';
import { Button }       from '@/components/ui/Button';
import { Badge }        from '@/components/ui/Badge';
import { Skeleton }     from '@/components/ui/Skeleton';
import { ScoreGauge }   from '@/components/ui/ScoreGauge';
import { InlineAlert, PageLoader } from '@/components/common/index';
import { SKILL_DIMENSION_LABELS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { ArrowLeft, RefreshCw, Play, RotateCcw, Clock } from 'lucide-react';

export default function PracticeOutcomePage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate      = useNavigate();
  const [pollCount, setPollCount] = useState(0);

  // Poll until skill_scores is populated
  const { data: outcomeData, isLoading } = useQuery({
    queryKey: queryKeys.practiceOutcome(sessionId!),
    queryFn:  () => practiceApi.getOutcome(sessionId!).then((r) => r.data.session),
    enabled:  !!sessionId,
    refetchInterval: (query) => {
      const s = query.state.data;
      if (!s) return 3000;
      if (!s.skill_scores) return 3000;
      return false;
    },
    refetchIntervalInBackground: false,
  });

  const retryMutation = useMutation({
    mutationFn: () => practiceApi.retrySession(sessionId!).then((r) => r.data),
    onSuccess: (res) => {
      navigate(`/practice/${res.session_id}`, {
        state: {
          chatId:          res.chat_id,
          buyerProfile:    res.buyer_profile,
          buyerState:      res.buyer_state,
          realtimeChannel: res.realtime_channel,
          practicePrompt:  res.practice_prompt,
          scenarioType:    res.scenario_type,
          difficulty:      res.difficulty,
          instruction:     res.instruction,
        },
      });
    },
  });

  if (isLoading) return <PageLoader />;
  if (!outcomeData) return (
    <div className="page-container"><InlineAlert type="error" message="Session not found." /></div>
  );

  const s = outcomeData;
  const radarData = s.skill_scores
    ? Object.entries(SKILL_DIMENSION_LABELS).map(([key, label]) => ({
        subject:  label,
        value:    s.skill_scores![key as keyof typeof s.skill_scores] as number ?? 0,
        fullMark: 10,
      }))
    : [];

  return (
    <div className="page-container max-w-2xl space-y-5">
      <button onClick={() => navigate('/practice')} className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary">
        <ArrowLeft size={14} /> Practice
      </button>

      {/* Outcome summary */}
      <div className="bg-white border border-surface-border rounded-lg p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-text-primary">
              {s.conversation_outcome ?? 'Session complete'}
            </h1>
            {s.goal_achieved != null && (
              <Badge variant={s.goal_achieved ? 'green' : 'gray'} size="sm" className="mt-1.5">
                {s.goal_achieved ? '🎯 Goal achieved' : 'Goal not achieved'}
              </Badge>
            )}
          </div>
          {s.message_strength_score != null && (
            <ScoreGauge score={s.message_strength_score} size="md" label="Strength" />
          )}
        </div>

        {/* Final buyer state */}
        {s.buyer_state && (
          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              { label: 'Interest',  value: s.buyer_state.interest_score },
              { label: 'Trust',     value: s.buyer_state.trust_score },
              { label: 'Confusion', value: s.buyer_state.confusion_score },
            ].map((m) => (
              <div key={m.label} className="bg-surface-base rounded-lg py-2">
                <p className="text-lg font-bold text-text-primary font-mono">{m.value}</p>
                <p className="text-xs text-text-muted">{m.label}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Debrief */}
      {s.session_debrief && (
        <div className="bg-white border border-surface-border rounded-lg p-5 space-y-4">
          <h2 className="text-sm font-semibold text-text-primary">Clutch AI coaching</h2>
          {[
            { emoji: '✅', label: 'What worked',       value: s.session_debrief.what_worked },
            { emoji: '⚠️', label: "What didn't",       value: s.session_debrief.what_didnt },
            { emoji: '🎯', label: 'Improvement',       value: s.session_debrief.improvement },
            { emoji: '💡', label: 'Coachable moment',  value: s.session_debrief.coachable_moment },
          ].map((row) => (
            <div key={row.label}>
              <p className="text-xs font-semibold text-text-primary mb-1">
                {row.emoji} {row.label}
              </p>
              <p className="text-sm text-text-secondary leading-relaxed">{row.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Skill scores radar */}
      <div className="bg-white border border-surface-border rounded-lg p-5">
        <h2 className="text-sm font-semibold text-text-primary mb-3">Skill scores</h2>
        {!s.skill_scores ? (
          <div className="flex items-center gap-2 text-sm text-text-muted py-4">
            <RefreshCw size={14} className="animate-spin text-brand" />
            Calculating your skill scores…
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="#e2e8f0" />
              <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <Radar dataKey="value" stroke="#2563eb" fill="#2563eb" fillOpacity={0.15} strokeWidth={2} />
            </RadarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Coaching annotations */}
      {s.coaching_annotations?.length ? (
        <div className="bg-white border border-surface-border rounded-lg p-5">
          <h2 className="text-sm font-semibold text-text-primary mb-3">Message-by-message coaching</h2>
          <div className="space-y-3">
            {s.coaching_annotations.map((a, i) => (
              <div key={a.message_id} className="flex gap-2">
                <span className="text-xs font-mono text-text-muted shrink-0 mt-0.5">#{i + 1}</span>
                <p className="text-sm text-text-secondary">{a.annotation}</p>
              </div>
            ))}
          </div>
        </div>
      ) : s.skill_scores ? (
        <InlineAlert type="info" message="Detailed coaching notes are being prepared… check back in a moment." />
      ) : null}

      {/* Playbook */}
      <div className="bg-surface-base border border-surface-border rounded-lg p-4 flex items-center gap-3">
        <Clock size={16} className="text-text-muted shrink-0" />
        <div>
          <p className="text-sm font-medium text-text-primary">Personalised playbook</p>
          <p className="text-xs text-text-muted">
            {s.playbook ? s.playbook : 'Coming in a couple of hours — your full outreach playbook is being generated.'}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 flex-wrap">
        <Button
          variant="secondary"
          leftIcon={<RotateCcw size={13} />}
          isLoading={retryMutation.isPending}
          onClick={() => retryMutation.mutate()}
        >
          Try again
        </Button>
        <Button
          variant="ghost"
          leftIcon={<Play size={13} />}
          onClick={() => navigate(`/practice/${sessionId}/replay`)}
        >
          View replay
        </Button>
        <Button onClick={() => navigate('/practice')}>
          Back to practice
        </Button>
      </div>
    </div>
  );
}
