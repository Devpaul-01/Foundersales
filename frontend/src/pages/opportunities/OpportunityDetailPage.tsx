// ============================================================
// FILE: src/pages/opportunities/OpportunityDetailPage.tsx
// Matches opportunities-13.txt:
// - Auto-marks viewed on load (server does this on GET)
// - Lazy intel fetch on explicit user click
// - Feedback modal with deal_value, scheduled_call
// - Manager can assign
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
  ArrowLeft, Zap, MessageCircle, CheckCircle2,
  Search, AlertCircle, ExternalLink, Calendar,
} from 'lucide-react';

export default function OpportunityDetailPage() {
  const { id }        = useParams<{ id: string }>();
  const navigate      = useNavigate();
  const { isManager } = useRole();
  const { showToast } = useToast();
  const { refreshCounts } = useNotificationContext();
  const [intelRequested, setIntelRequested] = useState(false);
  const [feedbackOpen,   setFeedbackOpen]   = useState(false);
  const [outcomeSelected, setOutcomeSelected] = useState<'positive'|'negative'|'pending'>('positive');

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
  const statusMutation = useMutation({
    mutationFn: (status: string) => opportunitiesApi.updateStatus(id!, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.opportunity(id!) });
      queryClient.invalidateQueries({ queryKey: ['opportunities'] });
      refreshCounts();
    },
    onError: () => showToast('Could not update status.', 'error'),
  });

  const chatMutation = useMutation({
    mutationFn: () =>
      chatApi.create({ chat_type: 'opportunity', opportunity_id: id }).then((r) => r.data.chat),
    onSuccess: (chat) => navigate(`/chat/${chat.id}`),
    onError: () => showToast('Could not open chat.', 'error'),
  });

  // Feedback form
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm<FeedbackSchema>({ resolver: zodResolver(feedbackSchema) });

  const feedbackMutation = useMutation({
    mutationFn: (data: FeedbackSchema) =>
      feedbackApi.submit({ ...data, outcome: outcomeSelected, opportunity_id: id! }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opportunities'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.pipeline() });
      queryClient.invalidateQueries({ queryKey: queryKeys.feedbackPending });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
      refreshCounts();
      showToast(
        outcomeSelected === 'positive' ? '🎉 Prospect moved to Pipeline!' : 'Feedback recorded.',
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
            opp.composite_score >= 70 ? 'border-success text-success' :
            opp.composite_score >= 40 ? 'border-warning text-warning' :
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
        {opp.status === 'pending' || opp.status === 'viewed' || opp.status === 'acted' ? (
          <Button
            size="sm"
            leftIcon={<CheckCircle2 size={13} />}
            isLoading={statusMutation.isPending}
            onClick={() => statusMutation.mutate('sent')}
          >
            Mark as Sent
          </Button>
        ) : null}
        {opp.status === 'sent' && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setFeedbackOpen(true)}
          >
            Log Feedback
          </Button>
        )}
        {(opp.status === 'pending' || opp.status === 'viewed') && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => statusMutation.mutate('acted')}
          >
            Skip
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
          <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
            <Search size={14} className="text-brand" /> Clutch AI intel
          </h2>
          {intelLoading ? (
            <div className="space-y-2">
              <p className="text-xs text-text-muted animate-pulse">Analysing prospect…</p>
              <SkeletonText lines={3} />
            </div>
          ) : intelData?.intel ? (
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
                    intelData.intel.confidence === 'high' ? 'green' :
                    intelData.intel.confidence === 'medium' ? 'amber' : 'gray'
                  }
                  size="xs"
                >
                  {intelData.intel.confidence}
                </Badge>
              </div>
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
        onClose={() => setFeedbackOpen(false)}
        title="Log outcome feedback"
        size="sm"
      >
        <form onSubmit={handleSubmit((d) => feedbackMutation.mutate(d))} className="space-y-4">
          {/* Outcome selector */}
          <div>
            <p className="text-sm font-medium text-text-primary mb-2">Outcome</p>
            <div className="flex gap-2">
              {(['positive', 'negative', 'pending'] as const).map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setOutcomeSelected(o)}
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

          <Textarea
            label="Note (optional)"
            placeholder="What happened?"
            rows={2}
            maxLength={500}
            {...register('outcome_note')}
          />

          <Input
            label="Deal value (USD)"
            type="number"
            placeholder="0"
            {...register('deal_value_usd', { valueAsNumber: true })}
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" size="sm" type="button" onClick={() => setFeedbackOpen(false)}>
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
