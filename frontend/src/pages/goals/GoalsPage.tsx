// ============================================================
// FILE: src/pages/goals/_bundle_goals_CORRECTED.tsx
//
// CORRECTIONS vs original:
//  - Goal type uses goal_text (not title), target_unit (not metric_type)
//  - No period field — backend has no period concept
//  - GET /api/goals (list only, no /:id endpoint)
//  - Progress notes via POST /api/goals/:goalId/notes (not check-in)
//  - Archive via PUT /api/goals/:id with { status: "paused" }
//  - Delete via DELETE /api/goals/:id
//  - Matches goals-5.txt exactly
// ============================================================
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { goalsApi }    from '@/api/goals';
import { queryClient } from '@/lib/queryClient';
import { queryKeys }   from '@/lib/queryKeys';
import { useToast }    from '@/hooks/useToast';
import { Button }      from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Badge }       from '@/components/ui/Badge';
import { Modal }       from '@/components/ui/Modal';
import { Skeleton }    from '@/components/ui/Skeleton';
import { EmptyState, ConfirmDialog } from '@/components/common/index';
import { formatShortDate, formatCurrency, cn } from '@/lib/utils';
import { Target, Plus, TrendingUp, CheckCircle2, ChevronRight, Flame } from 'lucide-react';
import type { UserGoal } from '@/api/types';

// ── Schema aligned to goals-5.txt ────────────────────────────
const createGoalSchema = z.object({
  goal_text:   z.string().min(1, 'Goal is required').max(500),
  goal_type:   z.enum(['outreach', 'revenue', 'meetings', 'custom']).default('custom'),
  target_value:z.number({ invalid_type_error: 'Enter a number' }).positive('Must be positive'),
  target_unit: z.string().max(50).optional(),
  target_date: z.string().optional().nullable(),
});
type CreateGoalSchema = z.infer<typeof createGoalSchema>;

const noteSchema = z.object({
  note_text:       z.string().min(1, 'Note is required').max(2000),
  explicit_delta:  z.number().optional().nullable(),
});
type NoteSchema = z.infer<typeof noteSchema>;

// ── Progress bar ──────────────────────────────────────────────
function GoalProgressBar({ goal }: { goal: UserGoal }) {
  const pct = goal.target_value
    ? Math.min(100, Math.round(((goal.current_value ?? 0) / goal.target_value) * 100))
    : 0;
  const isComplete = pct >= 100;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-muted">
          {goal.current_value ?? 0}
          {goal.target_unit ? ` ${goal.target_unit}` : ''} of {goal.target_value}
          {goal.target_unit ? ` ${goal.target_unit}` : ''}
        </span>
        <span className={cn(
          'font-semibold',
          isComplete ? 'text-success' : pct >= 70 ? 'text-brand' : 'text-text-muted',
        )}>
          {pct}%
        </span>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            isComplete ? 'bg-success' : pct >= 70 ? 'bg-brand' : 'bg-slate-300',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Goal card ─────────────────────────────────────────────────
function GoalCard({ goal, onNote }: { goal: UserGoal; onNote: (g: UserGoal) => void }) {
  const isComplete = (goal.current_value ?? 0) >= (goal.target_value ?? Infinity);
  const isDone = goal.status === 'completed';
  return (
    <div className="bg-white border border-surface-border rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text-primary">{goal.goal_text}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge variant="gray" size="xs">{goal.goal_type ?? 'custom'}</Badge>
            {goal.target_date && (
              <span className="text-xs text-text-muted">by {formatShortDate(goal.target_date)}</span>
            )}
          </div>
        </div>
        <div className="shrink-0">
          {isDone || isComplete
            ? <CheckCircle2 size={16} className="text-success" />
            : <Badge variant={goal.status === 'paused' ? 'gray' : 'blue'} size="xs">{goal.status}</Badge>
          }
        </div>
      </div>
      {goal.target_value != null && <GoalProgressBar goal={goal} />}
      {goal.status === 'active' && (
        <Button
          size="xs"
          variant="ghost"
          leftIcon={<TrendingUp size={11} />}
          onClick={() => onNote(goal)}
        >
          Log progress
        </Button>
      )}
    </div>
  );
}

// ── Add goal modal ────────────────────────────────────────────
function AddGoalModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { showToast } = useToast();
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm<CreateGoalSchema>({ resolver: zodResolver(createGoalSchema) });

  const createMutation = useMutation({
    mutationFn: (d: CreateGoalSchema) =>
      goalsApi.create({
        goal_text:   d.goal_text,
        goal_type:   d.goal_type,
        target_value:d.target_value,
        target_unit: d.target_unit ?? null,
        target_date: d.target_date ?? null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.goals() });
      showToast('Goal created!', 'success');
      reset();
      onClose();
    },
    onError: () => showToast('Could not create goal.', 'error'),
  });

  return (
    <Modal isOpen={open} onClose={onClose} title="New goal" size="md">
      <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-4">
        <Textarea
          label="Goal"
          required
          placeholder="e.g. Send 50 cold outreach messages this month"
          rows={2}
          maxLength={500}
          showCount
          error={errors.goal_text?.message}
          {...register('goal_text')}
        />
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Type"
            options={[
              { value: 'outreach', label: 'Outreach'  },
              { value: 'revenue',  label: 'Revenue'   },
              { value: 'meetings', label: 'Meetings'  },
              { value: 'custom',   label: 'Custom'    },
            ]}
            {...register('goal_type')}
          />
          <Input
            label="Target value"
            type="number"
            min="1"
            required
            placeholder="50"
            error={errors.target_value?.message}
            {...register('target_value', { valueAsNumber: true })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Unit (optional)"
            placeholder="messages, $, calls…"
            {...register('target_unit')}
          />
          <Input
            label="Target date (optional)"
            type="date"
            {...register('target_date')}
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>Cancel</Button>
          <Button size="sm" type="submit" isLoading={createMutation.isPending || isSubmitting}>
            Create goal
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Log progress note modal ───────────────────────────────────
function NoteModal({
  goal,
  onClose,
}: {
  goal:    UserGoal | null;
  onClose: () => void;
}) {
  const { showToast } = useToast();
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm<NoteSchema>({ resolver: zodResolver(noteSchema) });

  const noteMutation = useMutation({
    mutationFn: (d: NoteSchema) =>
      goalsApi.addNote(goal!.id, {
        note_text:      d.note_text,
        explicit_delta: d.explicit_delta ?? null,
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.goals() });
      const data = res.data;
      if (data.goal_completed) {
        showToast('🎉 Goal completed! Great work!', 'success');
      } else {
        showToast(data.coaching_response ?? 'Progress logged!', 'success');
      }
      reset();
      onClose();
    },
    onError: () => showToast('Could not log progress.', 'error'),
  });

  if (!goal) return null;

  return (
    <Modal isOpen={!!goal} onClose={onClose} title="Log progress" size="sm">
      <form onSubmit={handleSubmit((d) => noteMutation.mutate(d))} className="space-y-4">
        <p className="text-sm text-text-secondary">{goal.goal_text}</p>
        {goal.target_value != null && <GoalProgressBar goal={goal} />}
        <Textarea
          label="What happened?"
          required
          rows={3}
          maxLength={2000}
          showCount
          placeholder="Sent 10 messages today, had 2 great conversations…"
          error={errors.note_text?.message}
          {...register('note_text')}
        />
        {goal.target_value != null && (
          <Input
            label={`Update progress${goal.target_unit ? ` (${goal.target_unit})` : ''}`}
            type="number"
            placeholder={`Current: ${goal.current_value ?? 0}`}
            helperText="Leave blank for AI to infer from your note."
            {...register('explicit_delta', { valueAsNumber: true })}
          />
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>Cancel</Button>
          <Button size="sm" type="submit" isLoading={noteMutation.isPending || isSubmitting}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Main GoalsPage ────────────────────────────────────────────
export default function GoalsPage() {
  const [addOpen,  setAddOpen]  = useState(false);
  const [noteGoal, setNoteGoal] = useState<UserGoal | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.goals(),
    queryFn:  () => goalsApi.list().then((r) => r.data.goals),
    staleTime: 60_000,
  });

  const goals = data ?? [];
  const active    = goals.filter((g) => g.status === 'active');
  const completed = goals.filter((g) => g.status === 'completed');
  const paused    = goals.filter((g) => g.status === 'paused');

  return (
    <div className="page-container space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-text-primary">Goals</h1>
        <Button leftIcon={<Plus size={14} />} onClick={() => setAddOpen(true)}>
          New goal
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28" rounded="lg" />)}
        </div>
      ) : goals.length === 0 ? (
        <EmptyState
          icon={<Target size={28} />}
          headline="No goals yet"
          subline="Set measurable goals and Clutch tracks your progress with AI coaching."
          action={{ label: 'Add goal', onClick: () => setAddOpen(true) }}
        />
      ) : (
        <div className="space-y-5">
          {active.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Active</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {active.map((g) => (
                  <GoalCard key={g.id} goal={g} onNote={setNoteGoal} />
                ))}
              </div>
            </div>
          )}
          {completed.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Completed</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {completed.map((g) => (
                  <GoalCard key={g.id} goal={g} onNote={setNoteGoal} />
                ))}
              </div>
            </div>
          )}
          {paused.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Paused</p>
              <div className="grid gap-3 sm:grid-cols-2 opacity-60">
                {paused.map((g) => (
                  <GoalCard key={g.id} goal={g} onNote={setNoteGoal} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <AddGoalModal open={addOpen} onClose={() => setAddOpen(false)} />
      <NoteModal goal={noteGoal} onClose={() => setNoteGoal(null)} />
    </div>
  );
}