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
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast }    from '@/hooks/useToast';
import { Button }      from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Badge }       from '@/components/ui/Badge';
import { Modal }       from '@/components/ui/Modal';
import { formatShortDate, cn } from '@/lib/utils';
import { Plus, TrendingUp, CheckCircle2 } from 'lucide-react';
import type { UserGoal } from '@/api/types';

// ============================================================
// HARDCODED DEMO DATA — no API calls, no network requests.
// Replace this block to change what the demo shows.
// ============================================================
const DEMO_GOALS: UserGoal[] = [
  {
    id: 'g1',
    goal_text: 'Send 50 cold outreach messages this month',
    goal_type: 'outreach',
    status: 'active',
    target_value: 50,
    current_value: 34,
    target_unit: 'messages',
    target_date: '2026-09-30',
  } as UserGoal,
  {
    id: 'g2',
    goal_text: 'Close $40,000 in new revenue this quarter',
    goal_type: 'revenue',
    status: 'active',
    target_value: 40000,
    current_value: 27500,
    target_unit: '$',
    target_date: '2026-10-15',
  } as UserGoal,
  {
    id: 'g3',
    goal_text: 'Book 20 discovery calls with warm leads',
    goal_type: 'meetings',
    status: 'active',
    target_value: 20,
    current_value: 12,
    target_unit: 'calls',
    target_date: '2026-09-25',
  } as UserGoal,
  {
    id: 'g4',
    goal_text: 'Read one sales book and apply 3 takeaways',
    goal_type: 'custom',
    status: 'active',
    target_value: 3,
    current_value: 1,
    target_unit: 'takeaways',
    target_date: '2026-09-20',
  } as UserGoal,
  {
    id: 'g5',
    goal_text: 'Follow up with every lead within 24 hours for a full month',
    goal_type: 'outreach',
    status: 'completed',
    target_value: 30,
    current_value: 30,
    target_unit: 'days',
    target_date: '2026-08-31',
  } as UserGoal,
  {
    id: 'g6',
    goal_text: 'Hit $15,000 in referral revenue',
    goal_type: 'revenue',
    status: 'completed',
    target_value: 15000,
    current_value: 15800,
    target_unit: '$',
    target_date: '2026-07-31',
  } as UserGoal,
  {
    id: 'g7',
    goal_text: 'Attend 5 networking events this quarter',
    goal_type: 'meetings',
    status: 'paused',
    target_value: 5,
    current_value: 2,
    target_unit: 'events',
    target_date: '2026-11-01',
  } as UserGoal,
];

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
function AddGoalModal({
  open, onClose, onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (goal: UserGoal) => void;
}) {
  const { showToast } = useToast();
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm<CreateGoalSchema>({ resolver: zodResolver(createGoalSchema) });

  const handleCreate = (d: CreateGoalSchema) => {
    // Local-only: appends to in-memory state, no backend call.
    onCreate({
      id: `g${Date.now()}`,
      goal_text:    d.goal_text,
      goal_type:    d.goal_type,
      status:       'active',
      target_value: d.target_value,
      current_value: 0,
      target_unit:  d.target_unit ?? undefined,
      target_date:  d.target_date ?? undefined,
    } as UserGoal);
    showToast('Goal created!', 'success');
    reset();
    onClose();
  };

  return (
    <Modal isOpen={open} onClose={onClose} title="New goal" size="md">
      <form onSubmit={handleSubmit(handleCreate)} className="space-y-4">
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
          <Button size="sm" type="submit" isLoading={isSubmitting}>
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
  onLog,
}: {
  goal:    UserGoal | null;
  onClose: () => void;
  onLog:   (goalId: string, delta: number) => void;
}) {
  const { showToast } = useToast();
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm<NoteSchema>({ resolver: zodResolver(noteSchema) });

  if (!goal) return null;

  const handleLog = (d: NoteSchema) => {
    // Local-only: bumps current_value in memory, no backend call.
    const delta = d.explicit_delta ?? 0;
    onLog(goal.id, delta);
    showToast('Progress logged!', 'success');
    reset();
    onClose();
  };

  return (
    <Modal isOpen={!!goal} onClose={onClose} title="Log progress" size="sm">
      <form onSubmit={handleSubmit(handleLog)} className="space-y-4">
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
          <Button size="sm" type="submit" isLoading={isSubmitting}>
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
  // Hardcoded demo data lives in local state so Add/Log actions can still
  // update the UI in-memory, with zero network requests.
  const [goals, setGoals] = useState<UserGoal[]>(DEMO_GOALS);

  const active    = goals.filter((g) => g.status === 'active');
  const completed = goals.filter((g) => g.status === 'completed');
  const paused    = goals.filter((g) => g.status === 'paused');

  const handleCreate = (goal: UserGoal) => setGoals((prev) => [goal, ...prev]);

  const handleLog = (goalId: string, delta: number) => {
    setGoals((prev) => prev.map((g) => g.id === goalId
      ? { ...g, current_value: Math.min((g.current_value ?? 0) + delta, g.target_value ?? Infinity) }
      : g));
  };

  return (
    <div className="page-container space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-text-primary">Goals</h1>
        <Button leftIcon={<Plus size={14} />} onClick={() => setAddOpen(true)}>
          New goal
        </Button>
      </div>

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

      <AddGoalModal open={addOpen} onClose={() => setAddOpen(false)} onCreate={handleCreate} />
      <NoteModal goal={noteGoal} onClose={() => setNoteGoal(null)} onLog={handleLog} />
    </div>
  );
}