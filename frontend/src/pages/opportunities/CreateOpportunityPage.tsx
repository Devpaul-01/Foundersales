// src/pages/opportunities/CreateOpportunityPage.tsx
import React, { useState } from 'react';
import { useNavigate }     from 'react-router-dom';
import { useMutation }     from '@tanstack/react-query';
import { opportunitiesApi } from '@/api/opportunities';
import { queryClient }     from '@/lib/queryClient';
import { useToast }        from '@/hooks/useToast';
import { Button }          from '@/components/ui/Button';
import { Input, Textarea, Select } from '@/components/ui/Input';
import { PLATFORM_LABELS } from '@/lib/constants';
import type { Platform, PipelineStage } from '@/api/types';
import { ArrowLeft, Zap, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Constants ─────────────────────────────────────────────────────────────────

const PLATFORM_OPTIONS = Object.entries(PLATFORM_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const STAGE_OPTIONS = [
  { value: 'new',       label: "Haven't reached out yet" },
  { value: 'contacted', label: 'Already sent a message'  },
  { value: 'replied',   label: 'They replied'            },
  { value: 'call_demo', label: 'Call / demo scheduled'   },
];

// ── Sub-components ────────────────────────────────────────────────────────────

/** Numbered 1–10 pill selector used for fit/timing/intent scores */
function ScoreSelector({
  label, hint, value, onChange,
}: {
  label:    string;
  hint?:    string;
  value:    number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text-primary">{label}</span>
        {value !== null && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-xs text-text-muted hover:text-text-secondary transition-colors"
          >
            Clear
          </button>
        )}
      </div>
      <div className="flex gap-1">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
          const isSelected = value === n;
          const colorClass = isSelected
            ? n >= 7 ? 'bg-success text-white border-success'
              : n >= 4 ? 'bg-warning text-white border-warning'
              : 'bg-danger  text-white border-danger'
            : 'bg-white text-text-muted border-surface-border hover:border-slate-400 hover:text-text-primary';

          return (
            <button
              key={n}
              type="button"
              onClick={() => onChange(value === n ? null : n)}
              className={cn(
                'flex-1 h-9 rounded-md border text-xs font-semibold transition-all',
                colorClass,
              )}
            >
              {n}
            </button>
          );
        })}
      </div>
      {hint && <p className="text-xs text-text-muted">{hint}</p>}
    </div>
  );
}

/** Consistent section card */
function FormSection({
  title,
  description,
  children,
}: {
  title:        string;
  description?: string;
  children:     React.ReactNode;
}) {
  return (
    <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
      {/* Section header */}
      <div className="px-5 py-4 border-b border-surface-border bg-slate-50/60">
        <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
        {description && (
          <p className="text-xs text-text-muted mt-0.5">{description}</p>
        )}
      </div>
      {/* Section body */}
      <div className="px-5 py-5 space-y-4">{children}</div>
    </div>
  );
}

// ── Form state ────────────────────────────────────────────────────────────────

interface CreateForm {
  platform:          string;
  target_name:       string;
  source_url:        string;
  stage:             string;
  target_context:    string;
  prepared_message:  string;
  follow_up_message: string;
  fit_score:         number | null;
  timing_score:      number | null;
  intent_score:      number | null;
}

const EMPTY_FORM: CreateForm = {
  platform:          'linkedin',
  target_name:       '',
  source_url:        '',
  stage:             'new',
  target_context:    '',
  prepared_message:  '',
  follow_up_message: '',
  fit_score:         null,
  timing_score:      null,
  intent_score:      null,
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CreateOpportunityPage() {
  const navigate      = useNavigate();
  const { showToast } = useToast();

  const [form, setForm]     = useState<CreateForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof CreateForm, string>>>({});

  // Generic change handler for Input / Textarea / Select
  const set = (field: keyof CreateForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setForm(prev => ({ ...prev, [field]: e.target.value }));
      if (errors[field]) setErrors(prev => ({ ...prev, [field]: undefined }));
    };

  // Score setter (direct value, not event)
  const setScore = (field: 'fit_score' | 'timing_score' | 'intent_score') =>
    (v: number | null) => setForm(prev => ({ ...prev, [field]: v }));

  const validate = (): boolean => {
    const next: typeof errors = {};
    if (!form.platform)              next.platform          = 'Platform is required.';
    if (!form.prepared_message.trim()) next.prepared_message = 'Message is required.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const createMutation = useMutation({
    mutationFn: () =>
      opportunitiesApi.create({
        platform:          form.platform as Platform,
        stage:             form.stage    as PipelineStage,
        prepared_message:  form.prepared_message.trim(),
        target_name:       form.target_name.trim()       || undefined,
        source_url:        form.source_url.trim()        || undefined,
        target_context:    form.target_context.trim()    || undefined,
        follow_up_message: form.follow_up_message.trim() || undefined,
        fit_score:         form.fit_score    ?? undefined,
        timing_score:      form.timing_score ?? undefined,
        intent_score:      form.intent_score ?? undefined,
      }).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opportunities'] });
      showToast('Opportunity added!', 'success');
      navigate('/opportunities');
    },
    onError: () => {
      showToast('Could not save opportunity. Please try again.', 'error');
    },
  });

  const handleSubmit = () => {
    if (validate()) createMutation.mutate();
  };

  // Live composite score preview
  const scoredValues = [form.fit_score, form.timing_score, form.intent_score].filter(
    (v): v is number => v !== null,
  );
  const compositePreview =
    scoredValues.length > 0
      ? Math.round(scoredValues.reduce((a, b) => a + b, 0) / scoredValues.length)
      : null;

  return (
    <div className="page-container max-w-2xl mx-auto space-y-4 pb-12">

      {/* ── Page header ── */}
      <div className="flex items-center justify-between gap-4 pt-1">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-slate-100 transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-lg font-bold text-text-primary">Add opportunity</h1>
            <p className="text-xs text-text-muted mt-0.5">
              Manually track a lead from any channel
            </p>
          </div>
        </div>
        <Button
          size="sm"
          isLoading={createMutation.isPending}
          onClick={handleSubmit}
        >
          Save opportunity
        </Button>
      </div>

      {/* ── Section 1: Prospect ── */}
      <FormSection
        title="Prospect"
        description="Who are you reaching out to?"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select
            label="Platform"
            required
            value={form.platform}
            onChange={set('platform')}
            options={PLATFORM_OPTIONS}
            error={errors.platform}
          />
          <Input
            label="Name or handle"
            placeholder="e.g. Jane Smith or @handle"
            value={form.target_name}
            onChange={set('target_name')}
          />
        </div>
        <Input
          label="Profile or post URL"
          type="url"
          placeholder="https://..."
          value={form.source_url}
          onChange={set('source_url')}
          hint="Link to their profile, post, or whatever caught your attention"
        />
      </FormSection>

      {/* ── Section 2: Context ── */}
      <FormSection
        title="Context"
        description="Why is this a good opportunity?"
      >
        <Select
          label="Current stage"
          value={form.stage}
          onChange={set('stage')}
          options={STAGE_OPTIONS}
          hint="Pick the stage that reflects where things stand right now"
        />
        <Textarea
          label="Notes"
          placeholder="What signals caught your eye? Why are they a good fit?"
          value={form.target_context}
          onChange={set('target_context')}
          rows={3}
          showCount
          maxLength={1000}
        />
      </FormSection>

      {/* ── Section 3: Outreach ── */}
      <FormSection
        title="Outreach"
        description="Your message and optional follow-up plan"
      >
        <Textarea
          label="Message"
          required
          placeholder="The outreach message you sent or plan to send..."
          value={form.prepared_message}
          onChange={set('prepared_message')}
          rows={5}
          showCount
          maxLength={2000}
          error={errors.prepared_message}
        />
        <Textarea
          label="Follow-up message"
          placeholder="Pre-write a follow-up while you're thinking about it..."
          value={form.follow_up_message}
          onChange={set('follow_up_message')}
          rows={3}
          showCount
          maxLength={1000}
          hint="Optional — you can always add this later from the opportunity detail page"
        />
      </FormSection>

      {/* ── Section 4: Self assessment ── */}
      <FormSection
        title="Self assessment"
        description="Rate this opportunity yourself — all optional"
      >
        <div className="space-y-5">
          <ScoreSelector
            label="Fit score"
            value={form.fit_score}
            onChange={setScore('fit_score')}
            hint="How well does this prospect match your ICP? (1 = poor fit, 10 = perfect)"
          />
          <ScoreSelector
            label="Timing score"
            value={form.timing_score}
            onChange={setScore('timing_score')}
            hint="How good is the timing for reaching out right now?"
          />
          <ScoreSelector
            label="Intent score"
            value={form.intent_score}
            onChange={setScore('intent_score')}
            hint="How much buying intent or interest have you observed?"
          />

          {/* Composite preview / empty hint */}
          {compositePreview !== null ? (
            <div className="flex items-center gap-2.5 bg-slate-50 border border-surface-border rounded-lg px-3.5 py-2.5">
              <Zap size={13} className="text-brand shrink-0" />
              <p className="text-xs text-text-secondary">
                Composite score will be{' '}
                <span
                  className={cn(
                    'font-semibold',
                    compositePreview >= 7 ? 'text-success'
                      : compositePreview >= 4 ? 'text-warning'
                      : 'text-danger',
                  )}
                >
                  {compositePreview}/10
                </span>{' '}
                based on your {scoredValues.length === 3 ? 'three' : 'rated'} score
                {scoredValues.length !== 1 ? 's' : ''}.
              </p>
            </div>
          ) : (
            <div className="flex items-start gap-2.5 bg-slate-50 border border-surface-border rounded-lg px-3.5 py-2.5">
              <Info size={13} className="text-text-muted shrink-0 mt-0.5" />
              <p className="text-xs text-text-muted">
                Skip scoring if you're not sure yet — this opportunity will show as unrated and
                you can score it later.
              </p>
            </div>
          )}
        </div>
      </FormSection>

      {/* ── Footer actions ── */}
      <div className="flex items-center justify-end gap-3 pt-1">
        <Button variant="secondary" size="sm" onClick={() => navigate(-1)}>
          Cancel
        </Button>
        <Button
          size="sm"
          isLoading={createMutation.isPending}
          onClick={handleSubmit}
        >
          Save opportunity
        </Button>
      </div>

    </div>
  );
}
