// ============================================================
// FILE: src/pages/opportunities/OpportunitiesPage.tsx
// DEMO BUILD — all data is hardcoded locally for screenshots.
// No network requests, no react-query, no loading states.
// ============================================================
import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useToast }         from '@/hooks/useToast';
import { Button }           from '@/components/ui/Button';
import { Badge, PlatformBadge } from '@/components/ui/Badge';
import { Tabs }             from '@/components/ui/Tabs';
import { STATUS_LABELS }    from '@/lib/constants';
import { formatRelativeDate, cn } from '@/lib/utils';
import { Zap, RefreshCw, ChevronRight, AlertTriangle, Plus, ExternalLink, Copy, Check } from 'lucide-react';

// Platform labels mapping
export const PLATFORM_LABELS: Record<string, string> = {
  reddit:       'Reddit',
  linkedin:     'LinkedIn',
  twitter:      'X / Twitter',
  facebook:     'Facebook',
  instagram:    'Instagram',
  producthunt:  'Product Hunt',
  indiehackers: 'Indie Hackers',
  hackernews:   'Hacker News',
  quora:        'Quora',
  youtube:      'YouTube',
  other:        'Other',
};

const STATUS_TABS = [
  { value: 'all',     label: 'All'     },
  { value: 'pending', label: 'Pending' },
  { value: 'viewed',  label: 'Viewed'  },
];

// ── Demo data ─────────────────────────────────────────────────────────────────

interface DemoOpportunity {
  id: string;
  platform: string;
  target_name: string | null;
  target_context: string | null;
  source_url: string | null;
  link_clicked_at: string | null;
  message_copied_at: string | null;
  composite_score: number;
  fit_score: number | null;
  timing_score: number | null;
  intent_score: number | null;
  status: 'pending' | 'viewed' | 'sent';
  created_at: string;
  generated_by: 'ai' | 'manual';
  assigned_to: string | null;
  user_id: string;
  prepared_message: string;
}

const CURRENT_USER_ID = 'usr_amara_okafor';

const OPPORTUNITIES: DemoOpportunity[] = [
  {
    id: 'opp_1001',
    platform: 'linkedin',
    target_name: 'Priya Ramanathan',
    target_context: 'VP of Growth at a Series B fintech. Posted about struggling to scale outbound without adding headcount — mentioned evaluating "AI SDR" tools this quarter.',
    source_url: 'https://linkedin.com/in/priya-ramanathan',
    link_clicked_at: '2026-09-07T09:12:00Z',
    message_copied_at: '2026-09-07T09:14:00Z',
    composite_score: 8.6,
    fit_score: 9,
    timing_score: 9,
    intent_score: 8,
    status: 'pending',
    created_at: '2026-09-07T08:40:00Z',
    generated_by: 'ai',
    assigned_to: null,
    user_id: CURRENT_USER_ID,
    prepared_message: "Hi Priya — saw your post about scaling outbound without adding headcount. We help growth teams like yours automate the research + first-touch so reps spend their time on qualified conversations. Worth a quick look?",
  },
  {
    id: 'opp_1002',
    platform: 'reddit',
    target_name: 'u/deveraux_ops',
    target_context: 'Founder of a 12-person DevOps consultancy, asked in r/SaaS for recommendations on lead scoring tools that don\'t require a data team to maintain.',
    source_url: 'https://reddit.com/r/SaaS/comments/1kx92a/lead_scoring_without_a_data_team',
    link_clicked_at: null,
    message_copied_at: null,
    composite_score: 7.3,
    fit_score: 8,
    timing_score: 7,
    intent_score: 7,
    status: 'pending',
    created_at: '2026-09-06T22:05:00Z',
    generated_by: 'ai',
    assigned_to: 'usr_dara_kim',
    user_id: 'usr_dara_kim',
    prepared_message: "Hey! Saw your thread on lead scoring — most tools in that space assume you've got someone to babysit the model. We built ours so it just works out of the box, no data team required. Happy to share how a few consultancies your size are using it.",
  },
  {
    id: 'opp_1003',
    platform: 'producthunt',
    target_name: 'Marco Filipovic',
    target_context: 'Launched a project management tool for creative agencies last week. Comment thread shows he\'s actively looking for distribution channels and partnership ideas.',
    source_url: 'https://producthunt.com/posts/studioflow',
    link_clicked_at: '2026-09-05T16:20:00Z',
    message_copied_at: '2026-09-05T16:22:00Z',
    composite_score: 6.8,
    fit_score: 7,
    timing_score: 8,
    intent_score: 5,
    status: 'viewed',
    created_at: '2026-09-05T14:50:00Z',
    generated_by: 'ai',
    assigned_to: null,
    user_id: CURRENT_USER_ID,
    prepared_message: "Congrats on the launch, Marco! StudioFlow looks sharp — especially the client approval flow. We work with a few agency-tool founders on co-marketing; would love to trade notes on distribution if you're open to it.",
  },
  {
    id: 'opp_1004',
    platform: 'indiehackers',
    target_name: 'Renée Castellanos',
    target_context: 'Bootstrapped a $14k MRR newsletter analytics tool solo. Mentioned in a comment she\'s spending 10+ hrs/week on manual outreach and it\'s "the bottleneck."',
    source_url: 'https://indiehackers.com/post/hit-14k-mrr-solo-what-now',
    link_clicked_at: '2026-09-04T11:03:00Z',
    message_copied_at: null,
    composite_score: 8.1,
    fit_score: 8,
    timing_score: 9,
    intent_score: 7,
    status: 'viewed',
    created_at: '2026-09-04T10:15:00Z',
    generated_by: 'ai',
    assigned_to: null,
    user_id: CURRENT_USER_ID,
    prepared_message: "Renée — huge congrats on $14k MRR solo, that's no small feat. Saw outreach is eating 10+ hrs of your week; that's exactly the bottleneck we built Clutch to remove. Open to a 15-min walkthrough?",
  },
  {
    id: 'opp_1005',
    platform: 'twitter',
    target_name: 'Jonah Whitfield',
    target_context: 'Head of Sales at a mid-market HR platform. Tweeted frustration about their current outbound tool\'s scoring being "basically a coin flip."',
    source_url: 'https://x.com/jonahwhitfield/status/1893820019283746',
    link_clicked_at: null,
    message_copied_at: null,
    composite_score: 5.4,
    fit_score: 6,
    timing_score: 6,
    intent_score: 4,
    status: 'pending',
    created_at: '2026-09-06T19:30:00Z',
    generated_by: 'ai',
    assigned_to: null,
    user_id: CURRENT_USER_ID,
    prepared_message: "Jonah — 'coin flip scoring' made me laugh, painfully relatable. We rebuilt scoring around actual buying signals instead of firmographic guesswork. Curious if it's worth 15 minutes to compare notes?",
  },
  {
    id: 'opp_1006',
    platform: 'hackernews',
    target_name: 'throwaway_cto22',
    target_context: 'CTO comment on a "Show HN" thread about their internal sales tooling stack — explicitly said they\'re "not happy" with their current prospecting workflow.',
    source_url: 'https://news.ycombinator.com/item?id=41827392',
    link_clicked_at: '2026-09-03T08:47:00Z',
    message_copied_at: '2026-09-03T08:50:00Z',
    composite_score: 6.2,
    fit_score: 6,
    timing_score: 7,
    intent_score: 6,
    status: 'sent',
    created_at: '2026-09-02T20:12:00Z',
    generated_by: 'ai',
    assigned_to: null,
    user_id: CURRENT_USER_ID,
    prepared_message: "Saw your comment on the Show HN thread — sounds like your prospecting workflow is more duct tape than system right now. We've helped a few similar-stage teams replace that stack with one tool. Open to comparing notes?",
  },
  {
    id: 'opp_1007',
    platform: 'quora',
    target_name: 'Isabelle Ng',
    target_context: 'Asked a detailed question about "best practices for warm intro outreach at scale" — clearly evaluating tools, cited two competitors by name.',
    source_url: 'https://quora.com/Best-practices-for-warm-intro-outreach-at-scale',
    link_clicked_at: null,
    message_copied_at: null,
    composite_score: 7.9,
    fit_score: 8,
    timing_score: 8,
    intent_score: 8,
    status: 'pending',
    created_at: '2026-09-07T13:02:00Z',
    generated_by: 'ai',
    assigned_to: 'usr_amara_okafor',
    user_id: 'usr_dara_kim',
    prepared_message: "Isabelle — great question, and honestly the warm-intro-at-scale problem is what got us building Clutch in the first place. Happy to share what's worked for teams doing this well, no pitch required if you'd rather just compare notes.",
  },
  {
    id: 'opp_1008',
    platform: 'other',
    target_name: 'Tom Bellinger — Ridgeline Supply Co.',
    target_context: 'Met briefly at SaaStr Annual. Runs ops for a regional distributor, mentioned they\'re outgrowing their spreadsheet-based lead tracking.',
    source_url: null,
    link_clicked_at: null,
    message_copied_at: '2026-09-01T15:40:00Z',
    composite_score: 0,
    fit_score: null,
    timing_score: null,
    intent_score: null,
    status: 'viewed',
    created_at: '2026-09-01T15:30:00Z',
    generated_by: 'manual',
    assigned_to: null,
    user_id: CURRENT_USER_ID,
    prepared_message: "Great meeting you at SaaStr, Tom! Following up like I promised — happy to show you how a few distributors your size moved off spreadsheets without a painful migration. Free Thursday for 20 minutes?",
  },
  {
    id: 'opp_1009',
    platform: 'facebook',
    target_name: 'Denise Okonkwo-Marsh',
    target_context: 'Runs a boutique PR agency, posted in a founders group asking for referrals to "anything that helps us stop losing track of leads in a shared inbox."',
    source_url: 'https://facebook.com/groups/foundersnetwork/posts/8827193',
    link_clicked_at: '2026-09-06T07:55:00Z',
    message_copied_at: null,
    composite_score: 6.5,
    fit_score: 7,
    timing_score: 6,
    intent_score: 6,
    status: 'pending',
    created_at: '2026-09-06T07:10:00Z',
    generated_by: 'ai',
    assigned_to: null,
    user_id: CURRENT_USER_ID,
    prepared_message: "Denise — saw your post in Founders Network. Shared-inbox lead tracking breaks down fast once you're past a handful of clients. We built Clutch to fix exactly that; want a quick look at how it'd slot into your workflow?",
  },
];

// ── Opportunity Card ─────────────────────────────────────────────────────────

function OpportunityCard({ opp, currentUserId }: { opp: DemoOpportunity; currentUserId: string }) {
  const navigate    = useNavigate();
  const pct = opp.composite_score;
  const scoreColor =
    pct >= 7 ? 'text-success' : pct >= 4 ? 'text-warning' : 'text-danger';

  const isAssignedToMe =
    !!opp.assigned_to &&
    opp.assigned_to === currentUserId &&
    opp.user_id !== currentUserId;

  const isManual = opp.generated_by === 'manual';

  const handleSourceClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.stopPropagation(); // don't navigate to detail page
    // Demo build — link click tracking is a no-op, browser handles the navigation.
  };

  const [copied, setCopied] = useState(false);

  const handleCopyMessage = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation(); // don't navigate to detail page
    try {
      await navigator.clipboard.writeText(opp.prepared_message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API unavailable — fail silently
    }
  };

  return (
    <div
      onClick={() => navigate(`/opportunities/${opp.id}`)}
      className="bg-white border border-surface-border rounded-lg p-4 hover:shadow-card-md hover:border-slate-300 transition-all cursor-pointer space-y-3"
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <PlatformBadge platform={opp.platform} />
          <span className="text-sm font-medium text-text-primary truncate max-w-[200px]">
            {opp.target_name ?? 'Anonymous prospect'}
          </span>
          {isAssignedToMe && (
            <Badge variant="purple" size="xs">Assigned to me</Badge>
          )}
          {isManual && (
            <Badge variant="gray" size="xs">Manual</Badge>
          )}
        </div>
        {/* Composite score circle — show dash for manual entries with no score */}
        <div className={cn(
          'w-10 h-10 rounded-full border-2 flex items-center justify-center shrink-0 font-bold text-sm',
          pct >= 7 ? 'border-success text-success' :
          pct >= 4 ? 'border-warning text-warning' :
          isManual  ? 'border-slate-300 text-text-muted' :
          'border-danger text-danger',
        )}>
          {isManual && !pct ? '—' : Math.round(pct)}
        </div>
      </div>

      {/* Context */}
      <p className="text-sm text-text-secondary leading-relaxed line-clamp-3">
        {opp.target_context ?? <span className="italic text-text-muted">No context added</span>}
      </p>

      {/* Source URL */}
      {opp.source_url && (
        <div className="flex items-center gap-1.5">
          <a
            href={opp.source_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleSourceClick}
            className={cn(
              'inline-flex items-center gap-1 text-xs font-medium truncate max-w-[260px] hover:underline',
              opp.link_clicked_at ? 'text-text-muted' : 'text-brand',
            )}
          >
            <ExternalLink size={11} className="shrink-0" />
            {opp.source_url.replace(/^https?:\/\//, '')}
          </a>
          {opp.link_clicked_at && (
            <span className="text-xs text-text-muted shrink-0">· visited</span>
          )}
        </div>
      )}

      {/* Sub-scores — hidden for manual entries with no scores */}
      {!isManual && (
        <div className="flex items-center gap-3">
          {[
            { label: 'Fit',    value: opp.fit_score },
            { label: 'Timing', value: opp.timing_score },
            { label: 'Intent', value: opp.intent_score },
          ].filter((s) => s.value != null).map((s) => (
            <div key={s.label} className="flex items-center gap-1">
              <span className="text-xs text-text-muted">{s.label}</span>
              <span className={cn('text-xs font-mono font-semibold', scoreColor)}>{s.value}/10</span>
            </div>
          ))}
          <span className="ml-auto text-xs text-text-muted">{formatRelativeDate(opp.created_at)}</span>
        </div>
      )}
      {isManual && (
        <div className="flex items-center justify-end">
          <span className="text-xs text-text-muted">{formatRelativeDate(opp.created_at)}</span>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-surface-border">
        <div className="flex items-center gap-2">
          <Badge
            variant={
              opp.status === 'sent'   ? 'green' :
              opp.status === 'viewed' ? 'blue'  : 'gray'
            }
            size="xs"
          >
            {STATUS_LABELS[opp.status] ?? opp.status}
          </Badge>
          {opp.message_copied_at && (
            <span className="text-xs text-text-muted">· message copied</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyMessage}
            title="Copy prepared message"
            className={cn(
              'inline-flex items-center gap-1 text-xs font-medium transition-colors',
              copied ? 'text-success' : 'text-text-muted hover:text-text-primary',
            )}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copied!' : 'Copy message'}
          </button>
          <span className="text-xs text-brand flex items-center gap-0.5 font-medium">
            View details <ChevronRight size={12} />
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function OpportunitiesPage() {
  const navigate      = useNavigate();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeStatus = searchParams.get('status') ?? 'pending';
  const isManager = true; // demo: show manager-only controls

  const [isDiscovering, setIsDiscovering] = useState(false);

  const allOpps = activeStatus === 'all'
    ? OPPORTUNITIES
    : OPPORTUNITIES.filter((o) => o.status === activeStatus);

  const shouldRefresh = true; // demo: always show the staleness banner for the screenshot

  const handleDiscover = () => {
    setIsDiscovering(true);
    setTimeout(() => {
      setIsDiscovering(false);
      showToast('Found 4 new opportunities!', 'success');
    }, 600);
  };

  return (
    <div className="page-container space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-xl font-bold text-text-primary">Opportunities</h1>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {isManager && (
            <Button variant="secondary" size="sm" onClick={() => navigate('/team/opportunities')}>
              Team view
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Plus size={13} />}
            onClick={() => navigate('/opportunities/create')}
          >
            Add manually
          </Button>
          <Button
            size="sm"
            leftIcon={<RefreshCw size={13} className={isDiscovering ? 'animate-spin' : ''} />}
            isLoading={isDiscovering}
            onClick={handleDiscover}
          >
            Discover new
          </Button>
        </div>
      </div>

      {/* Staleness banner */}
      {shouldRefresh && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <AlertTriangle size={15} className="text-amber-600 shrink-0" />
          <p className="text-sm text-amber-700 flex-1">
            Your opportunity list is getting stale. Discover fresh prospects.
          </p>
          <Button
            variant="outline"
            size="xs"
            onClick={handleDiscover}
            isLoading={isDiscovering}
          >
            Discover now
          </Button>
        </div>
      )}

      {/* Status tabs */}
      <Tabs
        variant="pill"
        size="sm"
        tabs={STATUS_TABS}
        value={activeStatus}
        onChange={(v) => setSearchParams({ status: v }, { replace: true })}
      />

      {/* List */}
      <div className="space-y-3">
        {allOpps.map((opp) => (
          <OpportunityCard key={opp.id} opp={opp} currentUserId={CURRENT_USER_ID} />
        ))}
      </div>
    </div>
  );
}
