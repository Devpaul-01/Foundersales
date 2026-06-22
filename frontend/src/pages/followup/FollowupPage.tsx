// ============================================================
// FILE: src/pages/followup/FollowupPage_CORRECTED.tsx
//
// CORRECTIONS vs original:
//  - Uses Opportunity type (not fabricated Followup type)
//  - GET /api/followup returns { opportunities: Opportunity[] }
//  - Actions: POST /api/followup/:id/sent  (not /done)
//             POST /api/followup/:id/dismiss (not /snooze)
//  - No pagination — backend returns all at once
//  - Matches followup.txt exactly
// ============================================================
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { followupApi }  from '@/api/followup';
import { queryClient }  from '@/lib/queryClient';
import { queryKeys }    from '@/lib/queryKeys';
import { useToast }     from '@/hooks/useToast';
import { Button }       from '@/components/ui/Button';
import { Badge, PlatformBadge } from '@/components/ui/Badge';
import { Modal }        from '@/components/ui/Modal';
import { Skeleton }     from '@/components/ui/Skeleton';
import { EmptyState }   from '@/components/common/index';
import { formatRelativeDate, cn } from '@/lib/utils';
import { Bell, Send, X, ChevronRight, Clock, Copy, Check } from 'lucide-react';
import type { Opportunity } from '@/api/types';

// ── Follow-up card ────────────────────────────────────────────
function FollowupCard({
  opp,
  onSent,
  onDismiss,
}: {
  opp:       Opportunity;
  onSent:    (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const navigate  = useNavigate();
  const [copied,  setCopied]  = useState(false);
  const [preview, setPreview] = useState(false);

  const daysSince = opp.follow_up_sent_at
    ? Math.floor((Date.now() - new Date(opp.follow_up_sent_at).getTime()) / 86_400_000)
    : opp.marked_sent_at
      ? Math.floor((Date.now() - new Date(opp.marked_sent_at).getTime()) / 86_400_000)
      : null;

  const isOverdue = daysSince != null && daysSince > 7;

  const handleCopy = async () => {
    if (!opp.follow_up_message) return;
    try {
      await navigator.clipboard.writeText(opp.follow_up_message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback silent fail
    }
  };

  return (
    <>
      <div className={cn(
        'bg-white border rounded-xl p-4 space-y-3',
        isOverdue ? 'border-warning/40 bg-amber-50/20' : 'border-surface-border',
      )}>
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div
            className="flex-1 min-w-0 cursor-pointer"
            onClick={() => navigate(`/opportunities/${opp.id}`)}
          >
            <p className="text-sm font-semibold text-text-primary truncate">
              {opp.target_name || 'Prospect'}
            </p>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {opp.platform && <PlatformBadge platform={opp.platform} />}
              <Badge variant="gray" size="xs">{opp.stage}</Badge>
              {opp.follow_up_count != null && opp.follow_up_count > 0 && (
                <span className="text-xs text-text-muted">
                  {opp.follow_up_count} follow-up{opp.follow_up_count > 1 ? 's' : ''} sent
                </span>
              )}
            </div>
          </div>
          {daysSince != null && (
            <div className={cn('flex items-center gap-1 shrink-0 text-xs', isOverdue ? 'text-warning' : 'text-text-muted')}>
              <Clock size={11} />
              {daysSince}d ago
            </div>
          )}
        </div>

        {/* Message preview (truncated) */}
        {opp.follow_up_message && (
          <div className="bg-surface-base border border-surface-border rounded-lg p-3">
            <p className="text-sm text-text-secondary line-clamp-2">{opp.follow_up_message}</p>
            {opp.follow_up_message.length > 120 && (
              <button
                onClick={() => setPreview(true)}
                className="text-xs text-brand hover:underline mt-1"
              >
                View full message
              </button>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {opp.follow_up_message && (
            <Button
              size="xs"
              variant="ghost"
              leftIcon={copied ? <Check size={11} className="text-success" /> : <Copy size={11} />}
              onClick={handleCopy}
            >
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          )}
          <Button
            size="xs"
            leftIcon={<Send size={11} />}
            onClick={() => onSent(opp.id)}
          >
            Mark sent
          </Button>
          <Button
            size="xs"
            variant="ghost"
            leftIcon={<X size={11} />}
            onClick={() => onDismiss(opp.id)}
          >
            Dismiss
          </Button>
          <button
            onClick={() => navigate(`/opportunities/${opp.id}`)}
            className="ml-auto text-xs text-text-muted hover:text-brand flex items-center gap-0.5"
          >
            View <ChevronRight size={11} />
          </button>
        </div>
      </div>

      {/* Full message modal */}
      <Modal
        isOpen={preview}
        onClose={() => setPreview(false)}
        title="Follow-up message"
        size="md"
      >
        <div className="space-y-4">
          <div className="bg-surface-base border border-surface-border rounded-lg p-4">
            <p className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap">
              {opp.follow_up_message}
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPreview(false)}>Close</Button>
            <Button
              size="sm"
              leftIcon={copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
              onClick={handleCopy}
            >
              {copied ? 'Copied!' : 'Copy message'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────
export default function FollowupPage() {
  const { showToast } = useToast();

  // GET /api/followup → { opportunities: Opportunity[] }
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.followups(),
    queryFn:  () => followupApi.list().then((r) => r.data.opportunities),
    staleTime: 60_000,
  });

  const sentMutation = useMutation({
    mutationFn: (id: string) => followupApi.markSent(id),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.followups() });
      queryClient.invalidateQueries({ queryKey: queryKeys.pipeline() });
      queryClient.invalidateQueries({ queryKey: ['followup', 'unviewed-count'] });
      const count = (res.data as any)?.follow_up_count;
      showToast(
        count != null ? `Follow-up #${count} marked sent.` : 'Marked as sent.',
        'success',
      );
    },
    onError: () => showToast('Could not mark as sent.', 'error'),
  });

  const dismissMutation = useMutation({
    mutationFn: (id: string) => followupApi.dismiss(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.followups() });
      queryClient.invalidateQueries({ queryKey: ['followup', 'unviewed-count'] });
      showToast('Follow-up dismissed.', 'info');
    },
    onError: () => showToast('Could not dismiss.', 'error'),
  });

  const opps = data ?? [];
  const overdueCount = opps.filter((o) => {
    const sent = o.follow_up_sent_at ?? o.marked_sent_at;
    if (!sent) return false;
    return Math.floor((Date.now() - new Date(sent).getTime()) / 86_400_000) > 7;
  }).length;

  return (
    <div className="page-container space-y-5">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold text-text-primary">Follow-ups</h1>
        {overdueCount > 0 && (
          <span className="bg-warning text-white text-xs font-semibold px-2 py-0.5 rounded-full">
            {overdueCount} overdue
          </span>
        )}
      </div>

      {opps.length > 0 && (
        <p className="text-sm text-text-muted">
          {opps.length} deal{opps.length > 1 ? 's' : ''} with follow-up messages queued.
        </p>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32" rounded="xl" />
          ))}
        </div>
      ) : opps.length === 0 ? (
        <EmptyState
          icon={<Bell size={28} />}
          headline="All caught up!"
          subline="No follow-ups queued. When Clutch generates follow-up messages for your deals, they'll appear here."
        />
      ) : (
        <div className="space-y-3">
          {opps.map((opp) => (
            <FollowupCard
              key={opp.id}
              opp={opp}
              onSent={(id) => sentMutation.mutate(id)}
              onDismiss={(id) => dismissMutation.mutate(id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}