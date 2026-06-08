// ============================================================
// FILE: src/pages/opportunities/OpportunityDetailPage.tsx
// Matches opportunities-13.txt:
// - Auto-marks viewed on load (server does this on GET)
// - Lazy intel fetch on explicit user click
// - Feedback modal with deal_value, scheduled_call
// - Manager can assign
// - "Assigned to me" badge when opportunity was assigned (not owned)
// ============================================================
import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { opportunitiesApi } from '@/api/opportunities';
import { feedbackApi }      from '@/api/feedback';
import { chatApi }          from '@/api/chat';
import { queryClient }      from '@/lib/queryClient';
import { queryKeys }        from '@/lib/queryKeys';
import { useRole }          from '@/hooks/useRole';
import { useAuth }          from '@/hooks/useAuth';
import { useToast }         from '@/hooks/useToast';
import { useNotificationContext } from '@/contexts/NotificationContext';
import { feedbackSchema, type FeedbackSchema } from '@/lib/schemas';
import { Button }      from '@/components/ui/Button';
import { Input }       from '@/components/ui/Input';
import { Textarea }    from '@/components/ui/Input';
import { Badge, PlatformBadge, ScoreBadge } from '@/components/ui/Badge';
import { Modal }       from '@/components/ui/Modal';
import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';
import { CopyButton, InlineAlert, PageLoader } from '@/components/common/index';
import { AppError }    from '@/api/types';
import { formatRelativeDate, cn } from '@/lib/utils';
import { ROUTES, STATUS_LABELS, MEETING_OUTCOME_LABELS } from '@/lib/constants';
import {
  ArrowLeft, Zap, MessageCircle,
  Search, AlertCircle, ExternalLink, Calendar,
} from 'lucide-react';

export default function OpportunityDetailPage() {
  const { id }        = useParams<{ id: string }>();
  const navigate      = useNavigate();
  const { isManager } = useRole();
  const { user }      = useAuth();
  const { showToast } = useToast();
  const { refreshCounts } = useNotificationContext();
  const [intelRequested, setIntelRequested] = useState(false);
  const [feedbackOpen,   setFeedbackOpen]   = useState(false);


  // ── Data ─────────────────────────────────────────────────
  const { data: oppData, isLoading } = useQuery({
    queryKey: queryKeys.opportunity(id!),
    queryFn:  () => opportunitiesApi.getById(id!).then((r) => r.data.opportunity),
    enabled:  !!id,
  });

  // Intel — only fetched when user clicks "Analyze"
  const { data: intelData, isLoading: intelLoading } = useQuery({
    queryKey: queryKeys.opportunityIntel(id!),
    queryFn:  () => opportunitiesApi.getIntel(id!).then((r) => r.data),
    enabled:  !!id && intelRequested,
    staleTime: Infinity,
  });

  // ── Mutations ─────────────────────────────────────────────
  const chatMutation = useMutation({
    mutationFn: () =>
      chatApi.create({ chat_type: 'opportunity', opportunity_id: id }).then((r) => r.data.chat),
    onSuccess: (chat) => navigate(`/chat/${chat.id}`),
    onError: () => showToast('Could not open chat.', 'error'),
  });

  // Feedback form
  // outcome lives in the form (not separate state) so the schema can validate it
  // and the mutation receives it as part of `data` without manual injection.
  const { register, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting } } =
    useForm<FeedbackSchema>({
      resolver:      zodResolver(feedbackSchema),
      defaultValues: { outcome: 'positive', is_final: true, scheduled_call: false },
    });

  const outcomeSelected = watch('outcome');   // drives selector UI + conditional fields
  const scheduledCall   = watch('scheduled_call');

  const feedbackMutation = useMutation({
    mutationFn: (data: FeedbackSchema) =>
      feedbackApi.submit({ ...data, opportunity_id: id! }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['opportunities'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.pipeline() });
      queryClient.invalidateQueries({ queryKey: queryKeys.feedbackPending });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
      refreshCounts();
      showToast(
        variables.outcome === 'positive' ? '🎉 Prospect moved to Pipeline!' : 'Feedback recorded.',
        'success',
      );
      setFeedbackOpen(false);
      reset();
    },
    onError: () => showToast('Could not save feedback.', 'error'),
  });

  if (isLoading) return <PageLoader />;
  if (!oppData) return (
    <div className="page-container">
      <InlineAlert type="error" message="Opportunity not found." />
    </div>
  );

  const opp = oppData;
  const canAnalyze = !!opp.target_name;

  // True when this opp was assigned to me by someone else (I'm not the creator)
  const isAssignedToMe =
    !!opp.assigned_to &&
    opp.assigned_to === user?.id &&
    opp.user_id !== user?.id;

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
              isLoading={chatMutation.isPending}
              onClick={() => chatMutation.mutate()}
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

      {/* Intel panel — lazy */}
      {intelRequested && (
        <div className="bg-white border border-surface-border rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <Search size={14} className="text-brand" /> Clutch AI intel
            </h2>
            {intelData?.cached && (
              <Badge variant="gray" size="xs">Cached</Badge>
            )}
          </div>

          {intelLoading ? (
            <div className="space-y-2">
              <p className="text-xs text-text-muted animate-pulse">Analysing prospect…</p>
              <SkeletonText lines={3} />
            </div>
          ) : intelData?.intel ? (
            <div className="space-y-5">

              {/* ── Research block ───────────────────────────────────── */}
              <div className="space-y-4">
                {[
                  { label: '🎯 Pain points',    items: intelData.intel.pain_points },
                  { label: '💬 Talking points', items: intelData.intel.talking_points },
                  { label: '⚠️ Risks',          items: intelData.intel.risks },
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
                      intelData.intel.confidence === 'high'   ? 'green' :
                      intelData.intel.confidence === 'medium' ? 'amber' : 'gray'
                    }
                    size="xs"
                  >
                    {intelData.intel.confidence}
                  </Badge>
                </div>
              </div>

              {/* ── Outreach block ───────────────────────────────────── */}
              {intelData.outreach && (
                <div className="border-t border-surface-border pt-4 space-y-3">
                  <p className="text-xs font-semibold text-text-primary flex items-center gap-1.5">
                    <Zap size={12} className="text-brand" /> Outreach details
                  </p>

                  {intelData.outreach.opening_line && (
                    <div className="space-y-1">
                      <p className="text-xs text-text-muted font-medium">Opening line</p>
                      <div className="flex items-start justify-between gap-2 bg-surface-base rounded-md p-2.5 border border-surface-border">
                        <p className="text-sm text-text-primary leading-relaxed">
                          {intelData.outreach.opening_line}
                        </p>
                        <CopyButton text={intelData.outreach.opening_line} />
                      </div>
                    </div>
                  )}

                  {intelData.outreach.message_suggestion && (
                    <div className="space-y-1">
                      <p className="text-xs text-text-muted font-medium">Suggested message</p>
                      <div className="flex items-start justify-between gap-2 bg-surface-base rounded-md p-2.5 border border-surface-border">
                        <p className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap">
                          {intelData.outreach.message_suggestion}
                        </p>
                        <CopyButton text={intelData.outreach.message_suggestion} />
                      </div>
                    </div>
                  )}

                  {intelData.outreach.follow_up_hook && (
                    <div className="space-y-1">
                      <p className="text-xs text-text-muted font-medium">Follow-up hook</p>
                      <p className="text-sm text-text-secondary bg-surface-base rounded-md p-2.5 border border-surface-border">
                        {intelData.outreach.follow_up_hook}
                      </p>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-3">
                    {intelData.outreach.tone && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-text-muted">Tone:</span>
                        <Badge variant="gray" size="xs">{intelData.outreach.tone}</Badge>
                      </div>
                    )}
                    {intelData.outreach.personalization_angle && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-text-muted">Angle:</span>
                        <span className="text-xs text-text-secondary">{intelData.outreach.personalization_angle}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Citations ────────────────────────────────────────── */}
              {(intelData.research?.citations?.length ?? 0) > 0 && (
                <div className="border-t border-surface-border pt-3 space-y-1">
                  <p className="text-xs text-text-muted font-medium">Sources</p>
                  <ul className="space-y-0.5">
                    {intelData.research!.citations.map((url, i) => (
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
              message={
                intelData?.reason === 'no_named_entity'
                  ? 'Intel requires a specific person or company name in the prospect context.'
                  : 'No intel available for this prospect.'
              }
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
        <form onSubmit={handleSubmit((d) => feedbackMutation.mutate(d))} className="space-y-4">

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
          {/* When off: saves feedback without updating performance stats
              or triggering conversation analysis — useful while the outcome
              is still in flux (e.g. pending → waiting for reply). */}
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
            <Button size="sm" type="submit" isLoading={feedbackMutation.isPending || isSubmitting}>
              Save feedback
            </Button>
          </div>

        </form>
      </Modal>
    </div>
  );
}
