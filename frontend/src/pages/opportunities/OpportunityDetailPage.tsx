// ============================================================
// FILE: src/pages/opportunities/OpportunityDetailPage.tsx
// DEMO BUILD — all data is hardcoded locally for screenshots.
// No network requests, no react-query, no loading states.
// Intel is revealed instantly on click (still lazy from a UX
// standpoint, just no fetch behind it).
// ============================================================
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast }         from '@/hooks/useToast';
import { feedbackSchema, type FeedbackSchema } from '@/lib/schemas';
import { Button }      from '@/components/ui/Button';
import { Input }       from '@/components/ui/Input';
import { Textarea }    from '@/components/ui/Input';
import { Badge, PlatformBadge } from '@/components/ui/Badge';
import { Modal }       from '@/components/ui/Modal';
import { CopyButton, InlineAlert } from '@/components/common/index';
import { cn } from '@/lib/utils';
import {
  ArrowLeft, Zap, MessageCircle,
  Search, ExternalLink, Calendar,
} from 'lucide-react';

// ── Demo data ─────────────────────────────────────────────────────────────────

const CURRENT_USER_ID = 'usr_amara_okafor';

const OPPORTUNITY = {
  id: 'opp_1001',
  platform: 'linkedin',
  target_name: 'Priya Ramanathan',
  target_context:
    'VP of Growth at Meridian Pay, a Series B fintech (~140 employees). Posted publicly about struggling to scale outbound without adding headcount, and mentioned in the comments she\'s actively evaluating "AI SDR" tools this quarter. Her team currently runs outreach through a mix of Apollo and manual LinkedIn messages, which she described as "held together with duct tape."',
  source_url: 'https://linkedin.com/in/priya-ramanathan',
  composite_score: 8.6,
  fit_score: 9,
  timing_score: 9,
  intent_score: 8,
  status: 'viewed' as const,
  created_at: '2026-09-07T08:40:00Z',
  assigned_to: CURRENT_USER_ID,
  user_id: 'usr_dara_kim',
  prepared_message:
    "Hi Priya — saw your post about scaling outbound without adding headcount. We help growth teams like yours automate the research + first-touch so reps spend their time on qualified conversations, not prospecting busywork. Worth a quick look?",
};

const INTEL = {
  cached: true,
  intel: {
    pain_points: [
      'Outbound is bottlenecked on manual research — reps spend ~40% of their time finding and qualifying prospects instead of talking to them.',
      'Current stack (Apollo + manual LinkedIn) has no shared scoring model, so reps are chasing different definitions of "qualified."',
      'Team grew from 4 to 11 reps in the last two quarters without a proportional increase in pipeline, putting pressure on CAC.',
    ],
    talking_points: [
      'Meridian Pay\'s recent Series B (announced in Q2) makes this a natural moment to invest in scalable outbound infrastructure.',
      'Priya has publicly praised data-driven growth loops in past posts — lead with the scoring methodology, not just automation.',
      'Their ICP overlaps closely with three of our existing fintech customers — worth referencing as social proof.',
    ],
    risks: [
      'She explicitly called out "another tool that promises the world and does nothing" in a recent comment — skepticism toward AI SDR claims runs high.',
      'Procurement at Series B fintechs typically involves security review; be ready with SOC 2 documentation early.',
    ],
    confidence: 'high' as const,
  },
  outreach: {
    opening_line: "Saw your post about scaling outbound without adding headcount — that duct-tape feeling is exactly what we built Clutch to fix.",
    message_suggestion:
      "Hi Priya — saw your post about scaling outbound without adding headcount, and the comment about your stack feeling held together with duct tape hit close to home. We work with a few fintech growth teams around Meridian Pay's size who had the same scoring-consistency problem across reps. Would it be worth 15 minutes to see if it's relevant for where you're at post-Series B?",
    follow_up_hook: "If she doesn't respond in 4 days: reference the specific fintech customer overlap and offer a 2-minute Loom instead of a call.",
    tone: 'Consultative',
    personalization_angle: 'Recent Series B + explicit public frustration with current outbound stack',
  },
  research: {
    citations: [
      'https://linkedin.com/in/priya-ramanathan/posts/scaling-outbound-2026',
      'https://meridianpay.com/newsroom/series-b-announcement',
      'https://linkedin.com/company/meridian-pay/about',
    ],
  },
  reason: null as string | null,
};

// ── Page ─────────────────────────────────────────────────────────────────────

export default function OpportunityDetailPage() {
  const navigate      = useNavigate();
  const { showToast } = useToast();
  const isManager = true; // demo: show manager-only controls where relevant
  const [intelRequested, setIntelRequested] = useState(false);
  const [feedbackOpen,   setFeedbackOpen]   = useState(false);

  const opp = OPPORTUNITY;

  const { register, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting } } =
    useForm<FeedbackSchema>({
      resolver:      zodResolver(feedbackSchema),
      defaultValues: { outcome: 'positive', is_final: true, scheduled_call: false },
    });

  const outcomeSelected = watch('outcome');   // drives selector UI + conditional fields
  const scheduledCall   = watch('scheduled_call');

  const onSubmitFeedback = (data: FeedbackSchema) => {
    showToast(
      data.outcome === 'positive' ? '🎉 Prospect moved to Pipeline!' : 'Feedback recorded.',
      'success',
    );
    setFeedbackOpen(false);
    reset();
  };

  const handleOpenChat = () => {
    showToast('Opening chat…', 'info');
    navigate('/chat/demo-chat-1001');
  };

  const canAnalyze = !!opp.target_name;

  // True when this opp was assigned to me by someone else (I'm not the creator)
  const isAssignedToMe =
    !!opp.assigned_to &&
    opp.assigned_to === CURRENT_USER_ID &&
    opp.user_id !== CURRENT_USER_ID;

  return (
    <div className="page-container max-w-3xl space-y-5">
      {/* Back */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary transition-colors"
      >
        <ArrowLeft size={14} /> Back
      </button>

      {/* Context card */}
      <div className="bg-white border border-surface-border rounded-lg p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <PlatformBadge platform={opp.platform} />
              <h1 className="text-base font-semibold text-text-primary">
                {opp.target_name ?? 'Anonymous prospect'}
              </h1>
              {isAssignedToMe && (
                <Badge variant="purple" size="xs">
                  Assigned to me
                </Badge>
              )}
            </div>
            {opp.source_url && (
              <a
                href={opp.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-brand flex items-center gap-1 hover:underline"
              >
                View source <ExternalLink size={10} />
              </a>
            )}
          </div>
          <div className={cn(
            'w-12 h-12 rounded-full border-2 flex items-center justify-center shrink-0 font-bold text-base',
            opp.composite_score >= 7 ? 'border-success text-success' :
            opp.composite_score >= 4 ? 'border-warning text-warning' :
            'border-danger text-danger',
          )}>
            {Math.round(opp.composite_score)}
          </div>
        </div>

        <p className="text-sm text-text-secondary leading-relaxed">{opp.target_context}</p>

        {/* Sub-scores */}
        <div className="flex gap-4">
          {[
            { label: 'Fit',    value: opp.fit_score },
            { label: 'Timing', value: opp.timing_score },
            { label: 'Intent', value: opp.intent_score },
          ].filter((s) => s.value != null).map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-lg font-bold text-text-primary font-mono">{s.value}/10</div>
              <div className="text-xs text-text-muted">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Prepared message */}
      {opp.prepared_message && (
        <div className="bg-white border border-surface-border rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-primary">Clutch-prepared message</h2>
            <CopyButton text={opp.prepared_message} />
          </div>
          <p className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap bg-surface-base rounded-md p-3 border border-surface-border">
            {opp.prepared_message}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              leftIcon={<MessageCircle size={13} />}
              onClick={handleOpenChat}
            >
              Open in Chat
            </Button>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {opp.status === 'viewed' && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setFeedbackOpen(true)}
          >
            Log Feedback
          </Button>
        )}
        {canAnalyze && !intelRequested && (
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<Search size={13} />}
            onClick={() => setIntelRequested(true)}
          >
            Analyse prospect
          </Button>
        )}
      </div>

      {/* Intel panel */}
      {intelRequested && (
        <div className="bg-white border border-surface-border rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <Search size={14} className="text-brand" /> Clutch AI intel
            </h2>
            {INTEL.cached && (
              <Badge variant="gray" size="xs">Cached</Badge>
            )}
          </div>

          {INTEL.intel ? (
            <div className="space-y-5">

              {/* ── Research block ───────────────────────────────────── */}
              <div className="space-y-4">
                {[
                  { label: '🎯 Pain points',    items: INTEL.intel.pain_points },
                  { label: '💬 Talking points', items: INTEL.intel.talking_points },
                  { label: '⚠️ Risks',          items: INTEL.intel.risks },
                ].map((section) => (
                  <div key={section.label}>
                    <p className="text-xs font-semibold text-text-primary mb-1.5">{section.label}</p>
                    <ul className="space-y-1">
                      {section.items.map((item, i) => (
                        <li key={i} className="text-sm text-text-secondary flex items-start gap-2">
                          <span className="text-brand shrink-0 mt-0.5">•</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-muted">Confidence:</span>
                  <Badge
                    variant={
                      INTEL.intel.confidence === 'high'   ? 'green' :
                      INTEL.intel.confidence === 'medium' ? 'amber' : 'gray'
                    }
                    size="xs"
                  >
                    {INTEL.intel.confidence}
                  </Badge>
                </div>
              </div>

              {/* ── Outreach block ───────────────────────────────────── */}
              {INTEL.outreach && (
                <div className="border-t border-surface-border pt-4 space-y-3">
                  <p className="text-xs font-semibold text-text-primary flex items-center gap-1.5">
                    <Zap size={12} className="text-brand" /> Outreach details
                  </p>

                  {INTEL.outreach.opening_line && (
                    <div className="space-y-1">
                      <p className="text-xs text-text-muted font-medium">Opening line</p>
                      <div className="flex items-start justify-between gap-2 bg-surface-base rounded-md p-2.5 border border-surface-border">
                        <p className="text-sm text-text-primary leading-relaxed">
                          {INTEL.outreach.opening_line}
                        </p>
                        <CopyButton text={INTEL.outreach.opening_line} />
                      </div>
                    </div>
                  )}

                  {INTEL.outreach.message_suggestion && (
                    <div className="space-y-1">
                      <p className="text-xs text-text-muted font-medium">Suggested message</p>
                      <div className="flex items-start justify-between gap-2 bg-surface-base rounded-md p-2.5 border border-surface-border">
                        <p className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap">
                          {INTEL.outreach.message_suggestion}
                        </p>
                        <CopyButton text={INTEL.outreach.message_suggestion} />
                      </div>
                    </div>
                  )}

                  {INTEL.outreach.follow_up_hook && (
                    <div className="space-y-1">
                      <p className="text-xs text-text-muted font-medium">Follow-up hook</p>
                      <p className="text-sm text-text-secondary bg-surface-base rounded-md p-2.5 border border-surface-border">
                        {INTEL.outreach.follow_up_hook}
                      </p>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-3">
                    {INTEL.outreach.tone && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-text-muted">Tone:</span>
                        <Badge variant="gray" size="xs">{INTEL.outreach.tone}</Badge>
                      </div>
                    )}
                    {INTEL.outreach.personalization_angle && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-text-muted">Angle:</span>
                        <span className="text-xs text-text-secondary">{INTEL.outreach.personalization_angle}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Citations ────────────────────────────────────────── */}
              {(INTEL.research?.citations?.length ?? 0) > 0 && (
                <div className="border-t border-surface-border pt-3 space-y-1">
                  <p className="text-xs text-text-muted font-medium">Sources</p>
                  <ul className="space-y-0.5">
                    {INTEL.research!.citations.map((url, i) => (
                      <li key={i}>
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-brand hover:underline flex items-center gap-1 truncate"
                        >
                          <ExternalLink size={9} />
                          {url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

            </div>
          ) : (
            <InlineAlert
              type="info"
              message="No intel available for this prospect."
            />
          )}
        </div>
      )}

      {/* Feedback modal */}
      <Modal
        isOpen={feedbackOpen}
        onClose={() => { setFeedbackOpen(false); reset(); }}
        title="Log outcome feedback"
        size="sm"
      >
        <form onSubmit={handleSubmit(onSubmitFeedback)} className="space-y-4">

          {/* ── Outcome selector — setValue keeps form + UI in sync ── */}
          <div>
            <p className="text-sm font-medium text-text-primary mb-2">Outcome</p>
            {errors.outcome && (
              <p className="text-xs text-danger mb-1.5">{errors.outcome.message}</p>
            )}
            <div className="flex gap-2">
              {(['positive', 'negative', 'pending'] as const).map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setValue('outcome', o, { shouldValidate: true })}
                  className={cn(
                    'flex-1 py-2 rounded-md text-sm font-medium border transition-all',
                    outcomeSelected === o
                      ? o === 'positive' ? 'bg-success-light text-success-dark border-green-300'
                      : o === 'negative' ? 'bg-danger-light text-danger-dark border-red-300'
                      : 'bg-brand-50 text-brand border-brand-300'
                      : 'bg-white text-text-secondary border-surface-border hover:border-slate-300',
                  )}
                >
                  {o === 'positive' ? '✅ Positive' : o === 'negative' ? '❌ Negative' : '⏳ Pending'}
                </button>
              ))}
            </div>
          </div>

          {/* ── Outcome note ──────────────────────────────────── */}
          <Textarea
            label="Note (optional)"
            placeholder="What happened?"
            rows={2}
            maxLength={500}
            error={errors.outcome_note?.message}
            {...register('outcome_note')}
          />

          {/* ── Deal value — only meaningful for positive ─────── */}
          {outcomeSelected === 'positive' && (
            <Input
              label="Deal value (USD)"
              type="number"
              placeholder="0"
              error={errors.deal_value_usd?.message}
              {...register('deal_value_usd', { valueAsNumber: true })}
            />
          )}

          {/* ── Scheduled call toggle ─────────────────────────── */}
          <div className="flex items-center justify-between rounded-md border border-surface-border px-3 py-2.5">
            <div>
              <p className="text-sm font-medium text-text-primary flex items-center gap-1.5">
                <Calendar size={13} className="text-text-muted" /> Scheduled a call
              </p>
              <p className="text-xs text-text-muted mt-0.5">Track a booked call with this prospect</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" {...register('scheduled_call')} />
              <div className="w-9 h-5 bg-surface-border rounded-full peer peer-checked:bg-brand
                after:content-[''] after:absolute after:top-[2px] after:left-[2px]
                after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all
                peer-checked:after:translate-x-4" />
            </label>
          </div>

          {/* ── Call date + notes — only when scheduled_call is on ── */}
          {scheduledCall && (
            <div className="space-y-3 pl-3 border-l-2 border-brand-200">
              <Input
                label="Call date & time"
                type="datetime-local"
                error={errors.scheduled_call_date?.message}
                {...register('scheduled_call_date')}
              />
              <Textarea
                label="Call notes (optional)"
                placeholder="Agenda, prep points, context…"
                rows={2}
                maxLength={500}
                error={errors.scheduled_call_notes?.message}
                {...register('scheduled_call_notes')}
              />
            </div>
          )}

          {/* ── Is final toggle ───────────────────────────────── */}
          <div className="flex items-center justify-between rounded-md border border-surface-border px-3 py-2.5">
            <div>
              <p className="text-sm font-medium text-text-primary">Mark as final</p>
              <p className="text-xs text-text-muted mt-0.5">
                {outcomeSelected === 'pending'
                  ? 'Turn on once the outcome is decided'
                  : 'Finalises stats and triggers performance analysis'}
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" {...register('is_final')} />
              <div className="w-9 h-5 bg-surface-border rounded-full peer peer-checked:bg-brand
                after:content-[''] after:absolute after:top-[2px] after:left-[2px]
                after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all
                peer-checked:after:translate-x-4" />
            </label>
          </div>

          {/* ── Actions ───────────────────────────────────────── */}
          <div className="flex justify-end gap-2 pt-2 border-t border-surface-border">
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => { setFeedbackOpen(false); reset(); }}
            >
              Cancel
            </Button>
            <Button size="sm" type="submit" isLoading={isSubmitting}>
              Save feedback
            </Button>
          </div>

        </form>
      </Modal>
    </div>
  );
}
