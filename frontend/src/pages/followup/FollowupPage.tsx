// ============================================================
// FILE: src/pages/followup/FollowupPage.tsx
//
// DEMO / SCREENSHOT BUILD
//  - All data is hardcoded locally — no API calls, no react-query,
//    no network requests, no loading states.
//  - Mark sent / Dismiss update local component state only.
//  - Preserves the original design and interaction behavior.
// ============================================================
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button }       from '@/components/ui/Button';
import { Badge, PlatformBadge } from '@/components/ui/Badge';
import { Modal }        from '@/components/ui/Modal';
import { EmptyState }   from '@/components/common/index';
import { cn } from '@/lib/utils';
import { Bell, Send, X, ChevronRight, Clock, Copy, Check } from 'lucide-react';

// ── Local types (mirrors Opportunity shape used by this page) ──
type Opportunity = {
  id: string;
  target_name: string;
  platform: 'linkedin' | 'twitter' | 'email' | 'instagram';
  stage: string;
  follow_up_count: number | null;
  follow_up_sent_at: string | null;
  marked_sent_at: string | null;
  follow_up_message: string | null;
};

// ── Hardcoded demo data ──────────────────────────────────────
const now = Date.now();
const daysAgo = (n: number) => new Date(now - n * 86_400_000).toISOString();

const INITIAL_OPPORTUNITIES: Opportunity[] = [
  {
    id: 'opp_1',
    target_name: 'Marisol Ferreira',
    platform: 'linkedin',
    stage: 'Discovery call booked',
    follow_up_count: 2,
    follow_up_sent_at: daysAgo(11),
    marked_sent_at: null,
    follow_up_message:
      "Hi Marisol — following up on our chat last week about your team's onboarding flow. I put together a quick loom walking through how Clutch could slot into your current stack, happy to send it over if useful. Also wanted to flag we just shipped the Salesforce sync you asked about, so the integration piece is no longer a blocker on our end. Let me know if it's still worth grabbing 15 minutes this week or if timing's shifted.",
  },
  {
    id: 'opp_2',
    target_name: 'Devon Park',
    platform: 'email',
    stage: 'Proposal sent',
    follow_up_count: 1,
    follow_up_sent_at: daysAgo(9),
    marked_sent_at: null,
    follow_up_message:
      "Hey Devon, wanted to check in on the proposal I sent over on the 28th. No pressure at all — just making sure it didn't get buried. Happy to hop on a quick call if it'd help to walk through pricing or answer any questions from your team.",
  },
  {
    id: 'opp_3',
    target_name: 'Priya Nadarajah',
    platform: 'twitter',
    stage: 'Warm lead',
    follow_up_count: 0,
    follow_up_sent_at: daysAgo(2),
    marked_sent_at: null,
    follow_up_message:
      'Loved your thread on scaling outbound without losing the personal touch — curious how you\'re handling follow-up cadence on your end right now. We built something at Clutch that might be a fit, mind if I send a couple details?',
  },
  {
    id: 'opp_4',
    target_name: 'Grant Whitfield',
    platform: 'linkedin',
    stage: 'Intro made',
    follow_up_count: 3,
    follow_up_sent_at: daysAgo(15),
    marked_sent_at: null,
    follow_up_message:
      "Grant, it's been a couple weeks since we last connected — totally understand if priorities have shifted. If a Q4 evaluation is still on the table I'd love to get 20 minutes on the calendar, otherwise I'll check back in the new year.",
  },
  {
    id: 'opp_5',
    target_name: 'Anna Kowalski',
    platform: 'email',
    stage: 'Demo completed',
    follow_up_count: 1,
    follow_up_sent_at: null,
    marked_sent_at: daysAgo(4),
    follow_up_message:
      'Thanks again for the time yesterday, Anna! Sharing the recap doc we discussed along with the pricing tiers for your team size. Let me know if the security questionnaire is something your IT team needs before moving forward.',
  },
  {
    id: 'opp_6',
    target_name: 'Malik Osei',
    platform: 'instagram',
    stage: 'Cold outreach',
    follow_up_count: 0,
    follow_up_sent_at: daysAgo(1),
    marked_sent_at: null,
    follow_up_message:
      "Hey Malik — really enjoyed your post on creator monetization pitfalls. Think there could be an interesting overlap with what we're building at Clutch. Open to a quick chat sometime this month?",
  },
  {
    id: 'opp_7',
    target_name: 'Sophie Lindqvist',
    platform: 'linkedin',
    stage: 'Contract review',
    follow_up_count: 4,
    follow_up_sent_at: daysAgo(8),
    marked_sent_at: null,
    follow_up_message:
      "Hi Sophie, checking in on the redlines legal sent back last Thursday. Happy to jump on a call with both teams if it'll speed things up — otherwise just let me know a rough timeline and I'll plan around it.",
  },
];

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
  // Local state seeded with hardcoded demo data — no fetching, no query cache.
  const [opps, setOpps] = useState<Opportunity[]>(INITIAL_OPPORTUNITIES);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'info' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2200);
  };

  const handleSent = (id: string) => {
    setOpps((prev) => {
      const target = prev.find((o) => o.id === id);
      const nextCount = (target?.follow_up_count ?? 0) + 1;
      showToast(`Follow-up #${nextCount} marked sent.`, 'success');
      return prev.map((o) =>
        o.id === id
          ? { ...o, follow_up_count: nextCount, marked_sent_at: new Date().toISOString(), follow_up_sent_at: null }
          : o,
      );
    });
  };

  const handleDismiss = (id: string) => {
    setOpps((prev) => prev.filter((o) => o.id !== id));
    showToast('Follow-up dismissed.', 'info');
  };

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

      {opps.length === 0 ? (
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
              onSent={handleSent}
              onDismiss={handleDismiss}
            />
          ))}
        </div>
      )}

      {/* Lightweight local toast, replaces useToast hook for this offline demo */}
      {toast && (
        <div
          className={cn(
            'fixed bottom-5 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm font-medium shadow-lg z-50',
            toast.type === 'success' && 'bg-success text-white',
            toast.type === 'info'    && 'bg-text-primary text-white',
            toast.type === 'error'   && 'bg-danger text-white',
          )}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
