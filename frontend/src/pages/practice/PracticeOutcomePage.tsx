// ============================================================
// FILE: src/pages/practice/PracticeOutcomePage.tsx
// DEMO BUILD — all data is hardcoded locally for screenshots.
// No network calls, no polling, no loading states.
// ============================================================
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer } from 'recharts';
import { Button }       from '@/components/ui/Button';
import { Badge }        from '@/components/ui/Badge';
import { ScoreGauge }   from '@/components/ui/ScoreGauge';
import { ArrowLeft, Play, RotateCcw, Clock } from 'lucide-react';

// ------------------------------------------------------------
// Local constants
// ------------------------------------------------------------
const SKILL_DIMENSION_LABELS: Record<string, string> = {
  rapport:      'Rapport building',
  discovery:    'Discovery',
  objection:    'Objection handling',
  clarity:      'Clarity',
  closing:      'Closing',
  persuasion:   'Persuasion',
};

// ------------------------------------------------------------
// Hardcoded outcome data — a fully completed session
// ------------------------------------------------------------
const MOCK_OUTCOME = {
  conversation_outcome: 'Buyer agreed to a follow-up demo',
  goal_achieved: true,
  message_strength_score: 84,
  buyer_state: {
    interest_score: 8,
    trust_score: 7,
    confusion_score: 2,
  },
  session_debrief: {
    what_worked:
      'You opened with a specific, relevant observation about their recent product launch, which immediately signaled you\'d done your homework. Your questions were open-ended and let the buyer talk through their own pain points rather than you pitching too early.',
    what_didnt:
      'When the buyer raised a concern about implementation time, you moved past it quickly instead of digging into what "too slow" meant for their team specifically. That left some doubt unaddressed going into the close.',
    improvement:
      'Next time a timeline objection comes up, ask a clarifying follow-up before responding — "What would a reasonable timeline look like for you?" gives you a concrete number to work with instead of guessing.',
    coachable_moment:
      'Around message 6, you asked two questions back to back. Buyers tend to answer only the second one — space multi-part questions out or pick the single most important one.',
  },
  skill_scores: {
    rapport:    8.4,
    discovery:  7.1,
    objection:  6.8,
    clarity:    8.9,
    closing:    7.6,
    persuasion: 7.9,
  },
  coaching_annotations: [
    { message_id: 'm1', annotation: 'Strong opener — referencing their Q2 product launch built instant credibility.' },
    { message_id: 'm2', annotation: 'Good use of an open question to surface their current workflow instead of assuming it.' },
    { message_id: 'm3', annotation: 'You mirrored their language ("bandwidth") back to them, which builds rapport subtly.' },
    { message_id: 'm4', annotation: 'This is where the timeline objection surfaced — consider slowing down here next time.' },
    { message_id: 'm5', annotation: 'Nice pivot back to value instead of getting defensive about the objection.' },
    { message_id: 'm6', annotation: 'Two questions stacked here diluted the response — buyer only answered the second.' },
    { message_id: 'm7', annotation: 'Clear, confident ask for the next meeting. This is what moved the deal forward.' },
  ],
  playbook: null as string | null,
};

export default function PracticeOutcomePage() {
  const navigate = useNavigate();
  const s = MOCK_OUTCOME;

  const radarData = Object.entries(SKILL_DIMENSION_LABELS).map(([key, label]) => ({
    subject:  label,
    value:    s.skill_scores[key as keyof typeof s.skill_scores] as number,
    fullMark: 10,
  }));

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
              {s.conversation_outcome}
            </h1>
            <Badge variant={s.goal_achieved ? 'green' : 'gray'} size="sm" className="mt-1.5">
              {s.goal_achieved ? '🎯 Goal achieved' : 'Goal not achieved'}
            </Badge>
          </div>
          <ScoreGauge score={s.message_strength_score} size="md" label="Strength" />
        </div>

        {/* Final buyer state */}
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
      </div>

      {/* Debrief */}
      <div className="bg-white border border-surface-border rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold text-text-primary">Clutch AI coaching</h2>
        {[
          { emoji: '✅', label: 'What worked',      value: s.session_debrief.what_worked },
          { emoji: '⚠️', label: "What didn't",      value: s.session_debrief.what_didnt },
          { emoji: '🎯', label: 'Improvement',      value: s.session_debrief.improvement },
          { emoji: '💡', label: 'Coachable moment', value: s.session_debrief.coachable_moment },
        ].map((row) => (
          <div key={row.label}>
            <p className="text-xs font-semibold text-text-primary mb-1">
              {row.emoji} {row.label}
            </p>
            <p className="text-sm text-text-secondary leading-relaxed">{row.value}</p>
          </div>
        ))}
      </div>

      {/* Skill scores radar */}
      <div className="bg-white border border-surface-border rounded-lg p-5">
        <h2 className="text-sm font-semibold text-text-primary mb-3">Skill scores</h2>
        <ResponsiveContainer width="100%" height={200}>
          <RadarChart data={radarData}>
            <PolarGrid stroke="#e2e8f0" />
            <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: '#94a3b8' }} />
            <Radar dataKey="value" stroke="#2563eb" fill="#2563eb" fillOpacity={0.15} strokeWidth={2} />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {/* Coaching annotations */}
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
          onClick={() => {}}
        >
          Try again
        </Button>
        <Button
          variant="ghost"
          leftIcon={<Play size={13} />}
          onClick={() => navigate(`/practice/demo-session/replay`)}
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
