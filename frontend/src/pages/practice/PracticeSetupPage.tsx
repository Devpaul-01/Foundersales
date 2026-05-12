// ============================================================
// FILE: src/pages/practice/PracticeSetupPage.tsx
// From practice-25.txt + architecture §3.14:
// - 6 scenario cards with SCENARIO_LABELS/COLORS
// - Pressure modifier chips (PRESSURE_MODIFIERS)
// - Auto-detected difficulty (read-only)
// - Session goal (optional)
// - POST /api/practice/start → navigate with state
// ============================================================
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { practiceApi } from '@/api/practice';
import { useToast }    from '@/hooks/useToast';
import { practiceSetupSchema, type PracticeSetupSchema } from '@/lib/schemas';
import { Button }  from '@/components/ui/Button';
import { Input }   from '@/components/ui/Input';
import { Badge }   from '@/components/ui/Badge';
import { InlineAlert } from '@/components/common/index';
import { AppError, type PracticeScenario, type PressureModifier } from '@/api/types';
import {
  PRACTICE_SCENARIOS, SCENARIO_LABELS, SCENARIO_COLORS,
  SCENARIO_DESCRIPTIONS, PRESSURE_MODIFIERS, ROUTES,
} from '@/lib/constants';
import { cn } from '@/lib/utils';
import { Shuffle, ArrowLeft, Zap } from 'lucide-react';

const SCENARIO_ICONS: Record<string, string> = {
  interested:      '✅',
  polite_decline:  '🙏',
  ghost:           '👻',
  skeptical:       '🤔',
  price_objection: '💰',
  not_right_time:  '⏰',
};

export default function PracticeSetupPage() {
  const navigate    = useNavigate();
  const { showToast } = useToast();
  const [selectedScenario,  setSelectedScenario]  = useState<PracticeScenario | null>(null);
  const [selectedModifier,  setSelectedModifier]  = useState<PressureModifier | null>(null);
  const [serverError,       setServerError]       = useState('');

  const { register, handleSubmit, formState: { errors } } =
    useForm<PracticeSetupSchema>({ resolver: zodResolver(practiceSetupSchema) });

  const startMutation = useMutation({
    mutationFn: (data: PracticeSetupSchema) =>
      practiceApi.startSession({
        scenario_type:     selectedScenario ?? undefined,
        session_goal:      data.session_goal,
        pressure_modifier: selectedModifier ?? undefined,
      }).then((r) => r.data),
    onSuccess: (res) => {
      // Navigate with session data in router state to avoid extra fetch
      navigate(`/practice/${res.session_id}`, {
        state: {
          chatId:           res.chat_id,
          buyerProfile:     res.buyer_profile,
          buyerState:       res.buyer_state,
          realtimeChannel:  res.realtime_channel,
          practicePrompt:   res.practice_prompt,
          scenarioType:     res.scenario_type,
          difficulty:       res.difficulty,
          instruction:      res.instruction,
          sessionGoal:      res.session_goal,
          pressureModifier: res.pressure_modifier,
        },
      });
    },
    onError: (err) => {
      setServerError(err instanceof AppError ? err.message : 'Could not start session.');
    },
  });

  return (
    <div className="page-container max-w-2xl space-y-6">
      <button onClick={() => navigate('/practice')} className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary">
        <ArrowLeft size={14} /> Practice
      </button>

      <div>
        <h1 className="text-xl font-bold text-text-primary">New practice session</h1>
        <p className="text-sm text-text-muted mt-1">Choose your scenario and Clutch AI generates a realistic buyer.</p>
      </div>

      {serverError && (
        <InlineAlert type="error" message={serverError} onDismiss={() => setServerError('')} />
      )}

      <form onSubmit={handleSubmit((d) => startMutation.mutate(d))} className="space-y-6">
        {/* Scenario picker */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-text-primary">Choose scenario</h2>
            <button
              type="button"
              onClick={() => setSelectedScenario(null)}
              className="flex items-center gap-1 text-xs text-text-muted hover:text-brand transition-colors"
            >
              <Shuffle size={12} /> Random
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {PRACTICE_SCENARIOS.map((s) => {
              const color     = SCENARIO_COLORS[s.type];
              const isSelected = selectedScenario === s.type;
              return (
                <button
                  key={s.type}
                  type="button"
                  onClick={() => setSelectedScenario(s.type as PracticeScenario)}
                  className={cn(
                    'flex flex-col items-start gap-1.5 p-3 rounded-lg border transition-all text-left',
                    isSelected
                      ? 'border-brand bg-brand-50 shadow-brand-sm'
                      : 'bg-white border-surface-border hover:border-slate-300',
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-base">{SCENARIO_ICONS[s.type]}</span>
                    <span className={cn('text-xs font-semibold', isSelected ? 'text-brand' : 'text-text-primary')}>
                      {SCENARIO_LABELS[s.type]}
                    </span>
                  </div>
                  <p className="text-xs text-text-muted leading-snug">
                    {SCENARIO_DESCRIPTIONS[s.type]}
                  </p>
                </button>
              );
            })}
          </div>
          {!selectedScenario && (
            <p className="text-xs text-text-muted mt-2 flex items-center gap-1">
              <Shuffle size={11} /> No scenario selected — Clutch will pick one based on your level.
            </p>
          )}
        </div>

        {/* Session goal */}
        <Input
          label="Session goal (optional)"
          placeholder="e.g. Book a demo call, handle the price objection…"
          error={errors.session_goal?.message}
          {...register('session_goal')}
        />

        {/* Pressure modifiers */}
        <div>
          <h2 className="text-sm font-semibold text-text-primary mb-3">Pressure modifier</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {PRESSURE_MODIFIERS.map((m) => {
              const isSelected = selectedModifier === m.type;
              return (
                <button
                  key={m.type}
                  type="button"
                  onClick={() =>
                    setSelectedModifier(isSelected ? null : m.type as PressureModifier)
                  }
                  className={cn(
                    'flex items-start gap-2 p-3 rounded-lg border transition-all text-left',
                    isSelected
                      ? 'border-brand bg-brand-50'
                      : 'bg-white border-surface-border hover:border-slate-300',
                  )}
                >
                  <span className="text-sm leading-none mt-0.5">{m.label.split(' ')[0]}</span>
                  <div>
                    <p className={cn('text-xs font-medium', isSelected ? 'text-brand' : 'text-text-primary')}>
                      {m.label.split(' ').slice(1).join(' ')}
                    </p>
                    <p className="text-xs text-text-muted mt-0.5">{m.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <Button
          type="submit"
          fullWidth
          size="md"
          leftIcon={<Zap size={14} />}
          isLoading={startMutation.isPending}
        >
          Start session
        </Button>
      </form>
    </div>
  );
}
