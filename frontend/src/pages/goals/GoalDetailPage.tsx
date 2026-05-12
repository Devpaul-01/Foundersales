// ============================================================
// FILE: src/pages/goals/GoalDetailPage.tsx  (CORRECTED)
// Uses GET /api/goals (filtered by id from list) or notes list
// POST /api/goals/:goalId/notes for progress
// PUT /api/goals/:id with { status: "paused" } to pause
// ============================================================
import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { goalsApi }    from '@/api/goals';
import { queryClient } from '@/lib/queryClient';
import { queryKeys }   from '@/lib/queryKeys';
import { useToast }    from '@/hooks/useToast';
import { Button }      from '@/components/ui/Button';
import { Badge }       from '@/components/ui/Badge';
import { Skeleton }    from '@/components/ui/Skeleton';
import { InlineAlert, PageLoader, ConfirmDialog } from '@/components/common/index';
import { formatShortDate, formatRelativeDate, cn } from '@/lib/utils';
import { ArrowLeft, TrendingUp, Pause, Trash2, MessageCircle } from 'lucide-react';
import type { GoalNote } from '@/api/types';

export default function GoalDetailPage() {
  const { id }        = useParams<{ id: string }>();
  const navigate      = useNavigate();
  const { showToast } = useToast();
  const [deleteOpen,  setDeleteOpen] = useState(false);

  // Goals list (no single-goal endpoint)
  const { data: goalsData, isLoading } = useQuery({
    queryKey: queryKeys.goals(),
    queryFn:  () => goalsApi.list().then((r) => r.data.goals),
    staleTime: 60_000,
  });

  const { data: notesData, isLoading: notesLoading } = useQuery({
    queryKey: queryKeys.goalNotes(id!),
    queryFn:  () => goalsApi.listNotes(id!).then((r) => r.data.notes),
    enabled:  !!id,
    staleTime: 60_000,
  });

  const { data: insightData } = useQuery({
    queryKey: queryKeys.goalPipelineInsight(id!),
    queryFn:  () => goalsApi.getPipelineInsight(id!).then((r) => r.data),
    enabled:  !!id,
    staleTime: 24 * 60 * 60_000,
  });

  const pauseMutation = useMutation({
    mutationFn: () => goalsApi.update(id!, { status: 'paused' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.goals() });
      showToast('Goal paused.', 'info');
      navigate('/goals');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => goalsApi.delete(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.goals() });
      showToast('Goal deleted.', 'info');
      navigate('/goals');
    },
  });

  const goal = goalsData?.find((g) => g.id === id);
  const notes: GoalNote[] = notesData ?? [];

  if (isLoading) return <PageLoader />;
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
            <Button size="xs" variant="ghost" leftIcon={<Pause size={11} />} onClick={() => pauseMutation.mutate()}>
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
      {insightData?.insight && (
        <div className="bg-brand-50 border border-brand-200 rounded-lg p-4 space-y-1">
          <p className="text-xs font-semibold text-brand">{insightData.insight.title}</p>
          <p className="text-sm text-text-secondary">{insightData.insight.body}</p>
          {insightData.insight.action && (
            <p className="text-xs text-brand font-medium mt-1">→ {insightData.insight.action}</p>
          )}
        </div>
      )}

      {/* Notes / progress log */}
      <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
        <p className="text-xs font-semibold text-text-primary px-4 py-3 border-b border-surface-border">
          Progress log ({notes.length})
        </p>
        {notesLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : notes.length === 0 ? (
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
        isLoading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}
