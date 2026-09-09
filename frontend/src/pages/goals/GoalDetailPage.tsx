// ============================================================
// FILE: src/pages/goals/GoalDetailPage.tsx  (CORRECTED)
// Uses GET /api/goals (filtered by id from list) or notes list
// POST /api/goals/:goalId/notes for progress
// PUT /api/goals/:id with { status: "paused" } to pause
// ============================================================
import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useToast }    from '@/hooks/useToast';
import { Button }      from '@/components/ui/Button';
import { Badge }       from '@/components/ui/Badge';
import { InlineAlert, ConfirmDialog } from '@/components/common/index';
import { formatShortDate, formatRelativeDate, cn } from '@/lib/utils';
import { ArrowLeft, Pause, Trash2, Flame } from 'lucide-react';
import type { GoalNote } from '@/api/types';

// ============================================================
// HARDCODED DEMO DATA — no API calls, no network requests.
// Mirrors the goals set in GoalsPage.tsx so navigating from the
// list to any goal shows matching detail data.
// ============================================================
const DEMO_GOALS: Record<string, any> = {
  g1: {
    id: 'g1', goal_text: 'Send 50 cold outreach messages this month', goal_type: 'outreach',
    status: 'active', target_value: 50, current_value: 34, target_unit: 'messages', target_date: '2026-09-30',
  },
  g2: {
    id: 'g2', goal_text: 'Close $40,000 in new revenue this quarter', goal_type: 'revenue',
    status: 'active', target_value: 40000, current_value: 27500, target_unit: '$', target_date: '2026-10-15',
  },
  g3: {
    id: 'g3', goal_text: 'Book 20 discovery calls with warm leads', goal_type: 'meetings',
    status: 'active', target_value: 20, current_value: 12, target_unit: 'calls', target_date: '2026-09-25',
  },
  g4: {
    id: 'g4', goal_text: 'Read one sales book and apply 3 takeaways', goal_type: 'custom',
    status: 'active', target_value: 3, current_value: 1, target_unit: 'takeaways', target_date: '2026-09-20',
  },
  g5: {
    id: 'g5', goal_text: 'Follow up with every lead within 24 hours for a full month', goal_type: 'outreach',
    status: 'completed', target_value: 30, current_value: 30, target_unit: 'days', target_date: '2026-08-31',
  },
  g6: {
    id: 'g6', goal_text: 'Hit $15,000 in referral revenue', goal_type: 'revenue',
    status: 'completed', target_value: 15000, current_value: 15800, target_unit: '$', target_date: '2026-07-31',
  },
  g7: {
    id: 'g7', goal_text: 'Attend 5 networking events this quarter', goal_type: 'meetings',
    status: 'paused', target_value: 5, current_value: 2, target_unit: 'events', target_date: '2026-11-01',
  },
};

const DEMO_NOTES: Record<string, GoalNote[]> = {
  g1: [
    {
      id: 'n1',
      note_text: 'Sent 10 messages today, mostly to warm intros from the conference last week. Got 2 replies already.',
      ai_response: "Strong batch — replies that fast usually mean your subject lines are landing. Keep the conference framing going while it's fresh.",
      progress_delta: 10, sentiment: 'positive', created_at: '2026-09-08T14:20:00Z',
    },
    {
      id: 'n2',
      note_text: 'Slower day, only got through 6. Kept getting pulled into a client escalation.',
      ai_response: 'Totally fine — 6 is still forward motion. Protect an hour tomorrow morning before the inbox opens up.',
      progress_delta: 6, sentiment: 'neutral', created_at: '2026-09-06T18:05:00Z',
    },
    {
      id: 'n3',
      note_text: 'Had a call fall through last minute, felt discouraged so I skipped outreach entirely.',
      ai_response: "That happens. One skipped day won't break the month — pick back up tomorrow with a smaller, easier batch to rebuild momentum.",
      progress_delta: 0, sentiment: 'negative', created_at: '2026-09-04T20:40:00Z',
    },
    {
      id: 'n4',
      note_text: 'Batched 18 messages using the new template, felt way more efficient.',
      ai_response: 'Huge batch! Templates paying off — worth saving this one as your default.',
      progress_delta: 18, sentiment: 'positive', created_at: '2026-09-02T11:15:00Z',
    },
  ] as GoalNote[],
  g2: [
    {
      id: 'n5',
      note_text: 'Closed the Meridian Labs deal today — $12,500 annual contract.',
      ai_response: "That's a big one and puts you well past halfway. Nice work turning that around after the slow start.",
      progress_delta: 12500, sentiment: 'positive', created_at: '2026-09-07T16:00:00Z',
    },
    {
      id: 'n6',
      note_text: 'Upsold an existing client to the annual plan, +$3,000.',
      ai_response: 'Expansion revenue is the easiest revenue — great instinct to look at your existing base.',
      progress_delta: 3000, sentiment: 'positive', created_at: '2026-09-03T09:30:00Z',
    },
  ] as GoalNote[],
  g3: [
    {
      id: 'n7',
      note_text: 'Booked 3 calls off LinkedIn outreach this week.',
      ai_response: 'Consistent lead flow from LinkedIn — that channel is working, keep feeding it.',
      progress_delta: 3, sentiment: 'positive', created_at: '2026-09-05T13:10:00Z',
    },
  ] as GoalNote[],
};

const DEMO_INSIGHTS: Record<string, { title: string; body: string; action?: string }> = {
  g1: {
    title: 'Pipeline signal',
    body: "Contacts you've messaged in the last 7 days are replying 40% faster than your monthly average.",
    action: 'Send your next batch before Thursday to keep the streak going',
  },
  g2: {
    title: 'Pipeline signal',
    body: 'Two deals worth a combined $9,200 have been sitting in "proposal sent" for over 10 days.',
    action: 'Follow up with Meridian Labs and Arcadia Retail this week',
  },
  g3: {
    title: 'Pipeline signal',
    body: 'Discovery calls booked on Tuesdays convert to a second meeting 2x more often than other days.',
    action: 'Try shifting your outreach asks toward Tuesday slots',
  },
};

export default function GoalDetailPage() {
  const { id }        = useParams<{ id: string }>();
  const navigate      = useNavigate();
  const { showToast } = useToast();
  const [deleteOpen,  setDeleteOpen] = useState(false);

  // Local-only demo state so Pause/Delete can still visibly act, with zero
  // network requests. Seeded once from the hardcoded data above.
  const [goal, setGoal] = useState(() => (id ? DEMO_GOALS[id] : undefined));
  const notes: GoalNote[] = (id && DEMO_NOTES[id]) ?? [];
  const insight = id ? DEMO_INSIGHTS[id] : undefined;

  const handlePause = () => {
    setGoal((prev: any) => prev && { ...prev, status: 'paused' });
    showToast('Goal paused.', 'info');
    navigate('/goals');
  };

  const handleDelete = () => {
    showToast('Goal deleted.', 'info');
    navigate('/goals');
  };

  if (!goal) return (
    <div className="page-container">
      <InlineAlert type="error" message="Goal not found." />
    </div>
  );

  const pct = goal.target_value
    ? Math.min(100, Math.round(((goal.current_value ?? 0) / goal.target_value) * 100))
    : 0;

  return (
    <div className="page-container max-w-2xl space-y-5">
      <button onClick={() => navigate('/goals')} className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary">
        <ArrowLeft size={14} /> Goals
      </button>

      {/* Goal header */}
      <div className="bg-white border border-surface-border rounded-lg p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-lg font-bold text-text-primary">{goal.goal_text}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <Badge variant="gray" size="sm">{goal.goal_type ?? 'custom'}</Badge>
              <Badge
                variant={goal.status === 'active' ? 'blue' : goal.status === 'completed' ? 'green' : 'gray'}
                size="sm"
              >
                {goal.status}
              </Badge>
              {goal.target_date && (
                <span className="text-xs text-text-muted">Due {formatShortDate(goal.target_date)}</span>
              )}
            </div>
          </div>
          {goal.status === 'active' && (
            <Button size="xs" variant="ghost" leftIcon={<Pause size={11} />} onClick={handlePause}>
              Pause
            </Button>
          )}
        </div>

        {/* Progress */}
        {goal.target_value != null && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">
                {goal.current_value ?? 0}
                {goal.target_unit ? ` ${goal.target_unit}` : ''} / {goal.target_value}
                {goal.target_unit ? ` ${goal.target_unit}` : ''}
              </span>
              <span className={cn('font-bold text-lg', pct >= 100 ? 'text-success' : 'text-brand')}>
                {pct}%
              </span>
            </div>
            <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all', pct >= 100 ? 'bg-success' : 'bg-brand')}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Pipeline insight */}
      {insight && (
        <div className="bg-brand-50 border border-brand-200 rounded-lg p-4 space-y-1">
          <p className="text-xs font-semibold text-brand flex items-center gap-1">
            <Flame size={12} /> {insight.title}
          </p>
          <p className="text-sm text-text-secondary">{insight.body}</p>
          {insight.action && (
            <p className="text-xs text-brand font-medium mt-1">→ {insight.action}</p>
          )}
        </div>
      )}

      {/* Notes / progress log */}
      <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
        <p className="text-xs font-semibold text-text-primary px-4 py-3 border-b border-surface-border">
          Progress log ({notes.length})
        </p>
        {notes.length === 0 ? (
          <div className="p-6 text-center text-sm text-text-muted">
            No progress logged yet. Log your first update from the Goals page.
          </div>
        ) : (
          notes.map((n) => (
            <div key={n.id} className="px-4 py-3 border-b border-surface-border last:border-0 space-y-1">
              <p className="text-sm text-text-primary">{n.note_text}</p>
              {n.ai_response && (
                <div className="text-xs text-brand italic bg-brand-50 rounded px-2 py-1 mt-1">
                  💬 {n.ai_response}
                </div>
              )}
              <div className="flex items-center gap-3 text-xs text-text-muted">
                {n.progress_delta != null && n.progress_delta !== 0 && (
                  <span className={cn('font-semibold', n.progress_delta > 0 ? 'text-success' : 'text-danger')}>
                    {n.progress_delta > 0 ? '+' : ''}{n.progress_delta}
                    {goal.target_unit ? ` ${goal.target_unit}` : ''}
                  </span>
                )}
                <span>{formatRelativeDate(n.created_at)}</span>
                <Badge
                  variant={n.sentiment === 'positive' ? 'green' : n.sentiment === 'negative' ? 'red' : 'gray'}
                  size="xs"
                >
                  {n.sentiment}
                </Badge>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Danger zone */}
      <div className="flex justify-end">
        <Button
          size="xs"
          variant="danger-ghost"
          leftIcon={<Trash2 size={11} />}
          onClick={() => setDeleteOpen(true)}
        >
          Delete goal
        </Button>
      </div>

      <ConfirmDialog
        isOpen={deleteOpen}
        title="Delete goal?"
        message={`"${goal.goal_text}" and all progress notes will be permanently deleted.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}
