// ============================================================
// FILE: src/pages/practice/PracticeSetupPage.tsx
// DEMO / SCREENSHOT BUILD — fully static, zero network calls.
//
// Changes from production version:
// - No react-query, no practiceApi, no react-hook-form/zod.
// - All constants (scenarios, pressure modifiers, icons) inlined
//   so this file has no dependency on '@/lib/constants'.
// - "Start session" just simulates a brief local delay then logs
//   the payload — nothing is sent anywhere.
// - Local UI-only components (Button/Input/Badge/InlineAlert) are
//   included at the bottom so this renders standalone. Swap the
//   imports back to '@/components/ui/*' when wiring to the real app.
// ============================================================
import React, { useState } from 'react';
import { Shuffle, ArrowLeft, Zap, Check, AlertTriangle, X } from 'lucide-react';

// ── Static domain data (hardcoded, no API) ─────────────────────
type PracticeScenario =
  | 'interested'
  | 'polite_decline'
  | 'ghost'
  | 'skeptical'
  | 'price_objection'
  | 'not_right_time';

type PressureModifier = 'time_crunch' | 'budget_freeze' | 'competitor_pitch' | 'gatekeeper';

const PRACTICE_SCENARIOS: { type: PracticeScenario }[] = [
  { type: 'interested' },
  { type: 'polite_decline' },
  { type: 'ghost' },
  { type: 'skeptical' },
  { type: 'price_objection' },
  { type: 'not_right_time' },
];

const SCENARIO_LABELS: Record<PracticeScenario, string> = {
  interested:      'Interested Buyer',
  polite_decline:  'Polite Decline',
  ghost:           'The Ghoster',
  skeptical:       'Skeptical Prospect',
  price_objection: 'Price Objection',
  not_right_time:  'Not the Right Time',
};

const SCENARIO_COLORS: Record<PracticeScenario, string> = {
  interested:      '#16a34a',
  polite_decline:  '#64748b',
  ghost:           '#7c3aed',
  skeptical:       '#d97706',
  price_objection: '#dc2626',
  not_right_time:  '#2563eb',
};

const SCENARIO_DESCRIPTIONS: Record<PracticeScenario, string> = {
  interested:      'Warm lead who engages quickly and asks good follow-up questions.',
  polite_decline:  'Friendly but firm — says no without much friction.',
  ghost:           'Goes quiet mid-conversation. Tests your re-engagement skills.',
  skeptical:       'Pushes back hard, questions your claims, wants proof.',
  price_objection: 'Likes the product but stalls hard on cost.',
  not_right_time:  'Interested in principle, but timing keeps getting in the way.',
};

const SCENARIO_ICONS: Record<PracticeScenario, string> = {
  interested:      '✅',
  polite_decline:  '🙏',
  ghost:           '👻',
  skeptical:       '🤔',
  price_objection: '💰',
  not_right_time:  '⏰',
};

const PRESSURE_MODIFIERS: { type: PressureModifier; label: string; description: string }[] = [
  { type: 'time_crunch',      label: '⏱️ Time Crunch',      description: 'Buyer has 5 minutes and keeps checking the clock.' },
  { type: 'budget_freeze',    label: '🧊 Budget Freeze',    description: 'Company just froze new spending this quarter.' },
  { type: 'competitor_pitch', label: '⚔️ Competitor Pitch', description: 'They got a pitch from a rival vendor yesterday.' },
  { type: 'gatekeeper',       label: '🚪 Gatekeeper',       description: 'You’re talking to someone who isn’t the final decision-maker.' },
];

// Auto-detected difficulty — read-only, derived from the rep's recent session history.
// Hardcoded here to reflect a realistic mid-level rep.
const AUTO_DIFFICULTY = {
  label: 'Intermediate',
  reason: 'Based on your last 12 sessions (avg. close rate 41%, 3-session streak)',
};

export default function PracticeSetupPage() {
  const [selectedScenario, setSelectedScenario] = useState<PracticeScenario | null>('skeptical');
  const [selectedModifier, setSelectedModifier] = useState<PressureModifier | null>('competitor_pitch');
  const [sessionGoal, setSessionGoal]           = useState('Handle the price objection without discounting more than 10%');
  const [serverError, setServerError]           = useState('');
  const [isStarting, setIsStarting]             = useState(false);

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    setServerError('');
    setIsStarting(true);
    // Demo only — no network call. Simulates the button's loading state briefly.
    window.setTimeout(() => {
      setIsStarting(false);
      // In the real app this navigates to /practice/:session_id with router state.
      console.log('Demo: would start session with', {
        scenario_type:     selectedScenario,
        session_goal:      sessionGoal,
        pressure_modifier: selectedModifier,
      });
    }, 900);
  };

  return (
    <div className="page-container max-w-2xl mx-auto space-y-6 py-8 px-4">
      <button
        onClick={() => {}}
        className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary transition-colors"
      >
        <ArrowLeft size={14} /> Practice
      </button>

      <div>
        <h1 className="text-xl font-bold text-text-primary">New practice session</h1>
        <p className="text-sm text-text-muted mt-1">Choose your scenario and Clutch AI generates a realistic buyer.</p>
      </div>

      {serverError && (
        <InlineAlert type="error" message={serverError} onDismiss={() => setServerError('')} />
      )}

      <form onSubmit={handleStart} className="space-y-6">
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
              const isSelected = selectedScenario === s.type;
              return (
                <button
                  key={s.type}
                  type="button"
                  onClick={() => setSelectedScenario(s.type)}
                  className={cn(
                    'flex flex-col items-start gap-1.5 p-3 rounded-lg border transition-all text-left',
                    isSelected
                      ? 'border-brand bg-brand-50 shadow-brand-sm'
                      : 'bg-white border-surface-border hover:border-slate-300',
                  )}
                  style={isSelected ? { borderColor: SCENARIO_COLORS[s.type] } : undefined}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-base">{SCENARIO_ICONS[s.type]}</span>
                    <span
                      className={cn('text-xs font-semibold', !isSelected && 'text-text-primary')}
                      style={isSelected ? { color: SCENARIO_COLORS[s.type] } : undefined}
                    >
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

        {/* Auto-detected difficulty (read-only) */}
        <div className="flex items-center justify-between bg-surface-base border border-surface-border rounded-lg px-3 py-2.5">
          <div>
            <p className="text-xs font-medium text-text-primary">Difficulty</p>
            <p className="text-xs text-text-muted mt-0.5">{AUTO_DIFFICULTY.reason}</p>
          </div>
          <Badge variant="gray" size="sm">{AUTO_DIFFICULTY.label}</Badge>
        </div>

        {/* Session goal */}
        <Input
          label="Session goal (optional)"
          placeholder="e.g. Book a demo call, handle the price objection…"
          value={sessionGoal}
          onChange={(e) => setSessionGoal(e.target.value)}
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
                  onClick={() => setSelectedModifier(isSelected ? null : m.type)}
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
          isLoading={isStarting}
        >
          Start session
        </Button>
      </form>
    </div>
  );
}

// ============================================================
// Minimal local UI primitives — standalone stand-ins for
// '@/components/ui/*' so this file has zero external deps.
// Visual language matches the original (rounded-lg, brand color,
// surface-border, text-muted) via Tailwind utility classes.
// ============================================================

function cn(...args: Array<string | false | null | undefined>) {
  return args.filter(Boolean).join(' ');
}

function Button({
  children,
  type = 'button',
  fullWidth,
  size = 'md',
  leftIcon,
  isLoading,
  onClick,
  variant = 'primary',
}: {
  children: React.ReactNode;
  type?: 'button' | 'submit';
  fullWidth?: boolean;
  size?: 'xs' | 'sm' | 'md';
  leftIcon?: React.ReactNode;
  isLoading?: boolean;
  onClick?: () => void;
  variant?: 'primary' | 'destructive';
}) {
  const sizeClasses = size === 'xs' ? 'text-xs px-2.5 py-1.5' : size === 'sm' ? 'text-xs px-3 py-2' : 'text-sm px-4 py-2.5';
  const variantClasses =
    variant === 'destructive'
      ? 'bg-red-600 hover:bg-red-700 text-white'
      : 'bg-brand hover:bg-brand-600 text-white';
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isLoading}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-70',
        sizeClasses,
        variantClasses,
        fullWidth && 'w-full',
      )}
    >
      {isLoading ? (
        <span className="inline-block h-3.5 w-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
      ) : (
        leftIcon
      )}
      {isLoading ? 'Starting…' : children}
    </button>
  );
}

function Input({
  label,
  placeholder,
  value,
  onChange,
  error,
}: {
  label?: string;
  placeholder?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  error?: string;
}) {
  return (
    <div>
      {label && <label className="block text-sm font-semibold text-text-primary mb-1.5">{label}</label>}
      <input
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        className={cn(
          'w-full rounded-lg border px-3 py-2 text-sm text-text-primary placeholder:text-text-muted',
          'focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors',
          error ? 'border-red-400' : 'border-surface-border',
        )}
      />
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}

function Badge({
  children,
  variant = 'gray',
  size = 'xs',
}: {
  children: React.ReactNode;
  variant?: 'gray' | 'blue' | 'green' | 'amber';
  size?: 'xs' | 'sm';
}) {
  const variantClasses: Record<string, string> = {
    gray:  'bg-slate-100 text-slate-700',
    blue:  'bg-blue-100 text-blue-700',
    green: 'bg-green-100 text-green-700',
    amber: 'bg-amber-100 text-amber-700',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium',
        size === 'xs' ? 'text-[11px] px-2 py-0.5' : 'text-xs px-2.5 py-1',
        variantClasses[variant],
      )}
    >
      {children}
    </span>
  );
}

function InlineAlert({
  type,
  message,
  onDismiss,
}: {
  type: 'error' | 'warning' | 'success';
  message: string;
  onDismiss?: () => void;
}) {
  const styles =
    type === 'error'
      ? 'bg-red-50 border-red-200 text-red-700'
      : type === 'warning'
      ? 'bg-amber-50 border-amber-200 text-amber-700'
      : 'bg-green-50 border-green-200 text-green-700';
  const Icon = type === 'error' ? AlertTriangle : type === 'success' ? Check : AlertTriangle;
  return (
    <div className={cn('flex items-start gap-2 border rounded-lg px-3 py-2.5 text-sm', styles)}>
      <Icon size={15} className="shrink-0 mt-0.5" />
      <p className="flex-1">{message}</p>
      {onDismiss && (
        <button onClick={onDismiss} className="shrink-0">
          <X size={14} />
        </button>
      )}
    </div>
  );
}
