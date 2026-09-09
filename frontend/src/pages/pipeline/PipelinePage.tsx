// ============================================================
// FILE: src/pages/pipeline/PipelinePage.tsx
// DEMO BUILD — fully static, hardcoded data, zero network calls.
// Preserves original design + drag/drop interactivity for screenshots.
// ============================================================
import React, { useState, useCallback } from 'react';
import {
  DndContext, DragOverlay, closestCorners,
  type DragStartEvent, type DragEndEvent,
  PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Calendar, MoreHorizontal, ArrowLeft } from 'lucide-react';

// ------------------------------------------------------------
// Types (trimmed local copies so this file is self-contained)
// ------------------------------------------------------------
type Stage = 'contacted' | 'replied' | 'call_demo' | 'closed_won' | 'closed_lost';

interface Opportunity {
  id: string;
  target_name: string;
  platform: string;
  stage: Stage;
  composite_score: number;
  last_stage_changed_at: string;
  created_at: string;
  follow_up_count: number;
}

interface CalendarPrompt {
  message: string;
  opportunity_id?: string;
}

// ------------------------------------------------------------
// Constants
// ------------------------------------------------------------
const BOARD_COLUMNS = ['contacted', 'replied', 'call_demo', 'closed_won', 'closed_lost'] as const;

const STAGE_LABELS: Record<string, string> = {
  contacted:    'Contacted',
  replied:      'Replied',
  call_demo:    'Call / Demo',
  closed_won:   'Closed Won',
  closed_lost:  'Closed Lost',
};

const STAGE_COLORS: Record<string, string> = {
  contacted:   '#64748b',
  replied:     '#2563eb',
  call_demo:   '#8b5cf6',
  closed_won:  '#10b981',
  closed_lost: '#ef4444',
};

const PIPELINE_STAGE_VALUES = BOARD_COLUMNS;

function cn(...args: Array<string | false | null | undefined>) {
  return args.filter(Boolean).join(' ');
}

function formatRelativeDate(iso: string) {
  const then = new Date(iso).getTime();
  const now  = Date.now();
  const diffMs = now - then;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  const weeks = Math.floor(diffDays / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(diffDays / 30);
  return `${months}mo ago`;
}

function isMobileViewport() {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < 768;
}

// ------------------------------------------------------------
// Minimal local UI primitives (Button / Modal / Select / Textarea / Skeleton)
// so this file renders standalone without pulling in app-wide components.
// ------------------------------------------------------------
function Button({
  children, onClick, size = 'md', variant = 'primary', disabled, isLoading, className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  size?: 'xs' | 'sm' | 'md';
  variant?: 'primary' | 'secondary' | 'destructive';
  disabled?: boolean;
  isLoading?: boolean;
  className?: string;
}) {
  const sizeCls = size === 'xs' ? 'text-xs px-2 py-1' : size === 'sm' ? 'text-xs px-3 py-1.5' : 'text-sm px-4 py-2';
  const variantCls =
    variant === 'primary'     ? 'bg-brand text-white hover:bg-brand-600 disabled:opacity-50' :
    variant === 'secondary'   ? 'bg-white border border-surface-border text-text-primary hover:bg-slate-50' :
                                 'bg-danger text-white hover:bg-red-600';
  return (
    <button
      onClick={onClick}
      disabled={disabled || isLoading}
      className={cn('rounded-md font-medium transition-colors inline-flex items-center justify-center gap-1.5 disabled:cursor-not-allowed', sizeCls, variantCls, className)}
    >
      {isLoading ? 'Saving…' : children}
    </button>
  );
}

function Modal({
  isOpen, onClose, title, children, size = 'sm',
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md';
}) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className={cn('bg-white rounded-lg shadow-elevated w-full p-5', size === 'sm' ? 'max-w-sm' : 'max-w-lg')}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Select({
  label, options, placeholder, value, onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  placeholder?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="block text-xs font-medium text-text-muted mb-1">{label}</span>
      <select
        value={value}
        onChange={onChange}
        className="w-full border border-surface-border rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/40"
      >
        <option value="" disabled>{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function Textarea({
  label, placeholder, rows = 3, value, onChange,
}: {
  label: string;
  placeholder?: string;
  rows?: number;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="block text-xs font-medium text-text-muted mb-1">{label}</span>
      <textarea
        rows={rows}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        className="w-full border border-surface-border rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/40 resize-none"
      />
    </label>
  );
}

// ------------------------------------------------------------
// Hardcoded demo dataset
// ------------------------------------------------------------
const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

const INITIAL_PIPELINE: Record<Stage, Opportunity[]> = {
  contacted: [
    { id: 'd-101', target_name: 'Marrow Coffee Co.',        platform: 'Shopify',      stage: 'contacted', composite_score: 62, last_stage_changed_at: daysAgo(1),  created_at: daysAgo(4),  follow_up_count: 0 },
    { id: 'd-102', target_name: 'Nordby Studio',             platform: 'Squarespace',  stage: 'contacted', composite_score: 48, last_stage_changed_at: daysAgo(2),  created_at: daysAgo(2),  follow_up_count: 1 },
    { id: 'd-103', target_name: 'Field & Fern Nursery',       platform: 'WooCommerce',  stage: 'contacted', composite_score: 71, last_stage_changed_at: daysAgo(0),  created_at: daysAgo(1),  follow_up_count: 0 },
    { id: 'd-104', target_name: 'Halcyon Bike Works',         platform: 'Shopify',      stage: 'contacted', composite_score: 55, last_stage_changed_at: daysAgo(3),  created_at: daysAgo(6),  follow_up_count: 2 },
  ],
  replied: [
    { id: 'd-201', target_name: 'Lumen Skincare',             platform: 'Shopify',      stage: 'replied', composite_score: 79, last_stage_changed_at: daysAgo(1),  created_at: daysAgo(9),  follow_up_count: 1 },
    { id: 'd-202', target_name: 'Basalt Outdoor Supply',      platform: 'BigCommerce',  stage: 'replied', composite_score: 66, last_stage_changed_at: daysAgo(2),  created_at: daysAgo(11), follow_up_count: 0 },
    { id: 'd-203', target_name: 'Wren & Co. Stationery',      platform: 'Shopify',      stage: 'replied', composite_score: 58, last_stage_changed_at: daysAgo(4),  created_at: daysAgo(14), follow_up_count: 3 },
  ],
  call_demo: [
    { id: 'd-301', target_name: 'Cascade Pet Supply',          platform: 'Shopify',      stage: 'call_demo', composite_score: 84, last_stage_changed_at: daysAgo(0),  created_at: daysAgo(18), follow_up_count: 1 },
    { id: 'd-302', target_name: 'Alder & Ash Furniture',       platform: 'WooCommerce',  stage: 'call_demo', composite_score: 73, last_stage_changed_at: daysAgo(1),  created_at: daysAgo(20), follow_up_count: 0 },
  ],
  closed_won: [
    { id: 'd-401', target_name: 'Solstice Athletic Co.',       platform: 'Shopify',      stage: 'closed_won', composite_score: 91, last_stage_changed_at: daysAgo(5),  created_at: daysAgo(32), follow_up_count: 2 },
    { id: 'd-402', target_name: 'Foxglove Botanicals',         platform: 'Shopify',      stage: 'closed_won', composite_score: 88, last_stage_changed_at: daysAgo(12), created_at: daysAgo(41), follow_up_count: 1 },
    { id: 'd-403', target_name: 'Kettlebell Kitchen',          platform: 'BigCommerce',  stage: 'closed_won', composite_score: 76, last_stage_changed_at: daysAgo(20), created_at: daysAgo(55), follow_up_count: 0 },
  ],
  closed_lost: [
    { id: 'd-501', target_name: 'Periwinkle Home Goods',       platform: 'Squarespace',  stage: 'closed_lost', composite_score: 41, last_stage_changed_at: daysAgo(7),  created_at: daysAgo(29), follow_up_count: 2 },
    { id: 'd-502', target_name: 'Timberline Outfitters',       platform: 'Shopify',      stage: 'closed_lost', composite_score: 53, last_stage_changed_at: daysAgo(15), created_at: daysAgo(38), follow_up_count: 4 },
  ],
};

const METRICS = {
  total_revenue:    184_500,
  pipeline_value:   96_200,
  win_rate_pct:     58,
  call_demo_count:  2,
};

// ── Deal card ─────────────────────────────────────────────────
interface DealCardProps {
  deal:        Opportunity;
  onStageChange?: (dealId: string) => void;
  isDragging?: boolean;
  onOpen?: (dealId: string) => void;
}

function DealCard({ deal, onStageChange, isDragging, onOpen }: DealCardProps) {
  const mobile = isMobileViewport();

  return (
    <div
      className={cn(
        'bg-white border border-surface-border rounded-lg p-3 space-y-2 cursor-pointer',
        'hover:shadow-card-md hover:border-slate-300 transition-all',
        isDragging && 'opacity-40 shadow-elevated',
      )}
      onClick={() => onOpen?.(deal.id)}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-text-primary leading-snug truncate">
          {deal.target_name}
        </p>
        <div className="flex items-center gap-1 shrink-0">
          <span className={cn(
            'text-xs font-mono font-bold',
            deal.composite_score >= 70 ? 'text-success' :
            deal.composite_score >= 40 ? 'text-warning' : 'text-danger',
          )}>
            {Math.round(deal.composite_score)}
          </span>
          {mobile && onStageChange && (
            <button
              onClick={(e) => { e.stopPropagation(); onStageChange(deal.id); }}
              className="text-text-muted hover:text-brand transition-colors p-0.5"
            >
              <MoreHorizontal size={14} />
            </button>
          )}
        </div>
      </div>
      <p className="text-xs text-text-muted">{deal.platform}</p>
      <div className="flex items-center justify-between text-xs text-text-muted">
        <span>{formatRelativeDate(deal.last_stage_changed_at)}</span>
        {deal.follow_up_count > 0 && (
          <span className="text-brand">↩ {deal.follow_up_count}</span>
        )}
      </div>
    </div>
  );
}

// ── Sortable deal card wrapper ────────────────────────────────
function SortableDealCard({
  deal, onStageChange, onOpen,
}: { deal: Opportunity; onStageChange?: (id: string) => void; onOpen?: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: deal.id,
    data: { stage: deal.stage },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <div className="flex items-start gap-1">
        <button
          {...listeners}
          className="mt-2 text-text-muted hover:text-text-primary cursor-grab active:cursor-grabbing hidden md:block"
        >
          <GripVertical size={14} />
        </button>
        <div className="flex-1">
          <DealCard deal={deal} onStageChange={onStageChange} isDragging={isDragging} onOpen={onOpen} />
        </div>
      </div>
    </div>
  );
}

// ── Column ────────────────────────────────────────────────────
interface ColumnProps {
  stage:         string;
  deals:         Opportunity[];
  isOver?:       boolean;
  onStageChange: (dealId: string) => void;
  onOpen:        (dealId: string) => void;
}

function Column({ stage, deals, isOver, onStageChange, onOpen }: ColumnProps) {
  const color = STAGE_COLORS[stage] ?? '#64748b';
  return (
    <div className={cn(
      'flex flex-col bg-surface-base rounded-lg border border-surface-border min-w-[240px] w-60 shrink-0',
      isOver && 'ring-2 ring-brand ring-offset-1',
    )}>
      {/* Column header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-surface-border">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
          <span className="text-xs font-semibold text-text-primary">{STAGE_LABELS[stage]}</span>
        </div>
        <span className="text-xs text-text-muted bg-white border border-surface-border rounded-full px-1.5 py-0.5">
          {deals.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[120px]">
        <SortableContext items={deals.map((d) => d.id)} strategy={verticalListSortingStrategy}>
          {deals.map((deal) => (
            <SortableDealCard key={deal.id} deal={deal} onStageChange={onStageChange} onOpen={onOpen} />
          ))}
        </SortableContext>
        {deals.length === 0 && (
          <p className="text-center text-xs text-text-muted py-6 italic">No deals here</p>
        )}
      </div>
    </div>
  );
}

// ── Deal detail view (inline, static) ───────────────────────────
function DealDetailInline({ deal, onBack }: { deal: Opportunity; onBack: () => void }) {
  const stageColor = STAGE_COLORS[deal.stage] ?? '#64748b';
  const dealValueByStage: Record<string, number | undefined> = {
    'd-401': 42_000,
    'd-402': 31_500,
    'd-403': 18_200,
  };
  const dealValue = dealValueByStage[deal.id];
  const scheduledCallByStage: Record<string, string | undefined> = {
    'd-301': daysAgo(-2),
    'd-302': daysAgo(-4),
  };
  const scheduledCall = scheduledCallByStage[deal.id];
  const contextByDeal: Record<string, string> = {
    'd-101': 'Small-batch coffee roaster, ~$40k/mo GMV on Shopify. Strong Instagram following, minimal paid acquisition so far — likely underinvesting in retention flows.',
    'd-102': 'Boutique design studio selling print goods. Recently migrated to Squarespace Commerce; email list under 2k subscribers.',
    'd-103': 'Regional plant and garden supply retailer with 3 physical locations plus online storefront on WooCommerce. Seasonal revenue swings.',
    'd-104': 'Custom bike shop with loyal local customer base. Currently has no abandoned-cart flow in place.',
    'd-201': 'DTC skincare brand doing ~$90k/mo. Has a modest Klaviyo setup already but open to a full audit.',
    'd-202': 'Outdoor gear retailer on BigCommerce, multi-channel (Amazon + own site). Interested in unifying customer data.',
    'd-203': 'Stationery and paper goods brand, gifting-heavy revenue mix. Wants better post-purchase flows ahead of the holiday season.',
    'd-301': 'Fast-growing pet supply brand, ~$150k/mo GMV. Demo scheduled to walk through churn-reduction flows.',
    'd-302': 'Mid-size furniture retailer, high AOV (~$800). Long consideration cycle — exploring lifecycle marketing to shorten it.',
    'd-401': 'Closed after a 3-week cycle. Athletic apparel brand, onboarded onto full lifecycle suite including SMS.',
    'd-402': 'Closed via referral from an existing customer. Botanical skincare brand, strong repeat-purchase potential.',
    'd-403': 'Closed after extended negotiation on pricing tier. Meal-kit/kitchen brand with subscription component.',
    'd-501': 'Went with an in-house solution after evaluating for 6 weeks. Budget constraints cited as primary reason.',
    'd-502': 'Lost to a competitor offering a lower-cost bundled package. Relationship remains warm for future re-engagement.',
  };

  return (
    <div className="max-w-2xl space-y-5">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary">
        <ArrowLeft size={14} /> Pipeline
      </button>

      <div className="bg-white border border-surface-border rounded-lg p-5 space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">{deal.target_name}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span
              className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full"
              style={{ backgroundColor: `${stageColor}18`, color: stageColor, border: `1px solid ${stageColor}40` }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: stageColor }} />
              {STAGE_LABELS[deal.stage]}
            </span>
            <span className="text-xs text-text-muted">{deal.platform}</span>
          </div>
        </div>

        <p className="text-sm text-text-secondary leading-relaxed">
          {contextByDeal[deal.id] ?? 'No additional context recorded for this prospect yet.'}
        </p>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-text-muted">Score</p>
            <p className="font-mono font-bold text-text-primary">{Math.round(deal.composite_score)}/10</p>
          </div>
          <div>
            <p className="text-xs text-text-muted">Last activity</p>
            <p className="text-text-primary">{formatRelativeDate(deal.last_stage_changed_at)}</p>
          </div>
          {scheduledCall && (
            <div className="col-span-2">
              <p className="text-xs text-text-muted">Scheduled call</p>
              <p className="text-text-primary">{formatRelativeDate(scheduledCall)}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-surface-border">
          <Button size="sm" variant="secondary">
            {dealValue ? `$${dealValue.toLocaleString()}` : 'Set value'}
          </Button>
          <Button size="sm" variant="destructive">
            Remove deal
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────
export default function PipelinePage() {
  const [viewTeam,  setViewTeam]  = useState(false);
  const [activeId,  setActiveId]  = useState<string | null>(null);
  const [calPrompt, setCalPrompt] = useState<CalendarPrompt | null>({
    message: 'Cascade Pet Supply moved to Call / Demo — add the discovery call to your calendar?',
    opportunity_id: 'd-301',
  });
  const [lostDealId, setLostDealId] = useState<string | null>(null);
  const [lostReason, setLostReason] = useState('');
  const [showConfetti] = useState(false);

  // Mobile stage picker
  const [mobilePickId, setMobilePickId] = useState<string | null>(null);
  const [mobileStage,  setMobileStage]  = useState('');

  // Local, in-memory board state (no network)
  const [pipeline, setPipeline] = useState<Record<Stage, Opportunity[]>>(INITIAL_PIPELINE);
  const [openDealId, setOpenDealId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const moveDeal = useCallback((dealId: string, toStage: Stage, reason?: string) => {
    setPipeline((prev) => {
      const next = { ...prev };
      let moved: Opportunity | undefined;
      for (const key of Object.keys(next) as Stage[]) {
        const idx = next[key].findIndex((d) => d.id === dealId);
        if (idx !== -1) {
          moved = next[key][idx];
          next[key] = next[key].filter((d) => d.id !== dealId);
          break;
        }
      }
      if (!moved) return prev;
      next[toStage] = [{ ...moved, stage: toStage, last_stage_changed_at: new Date().toISOString() }, ...next[toStage]];
      return next;
    });

    if (toStage === 'call_demo') {
      const deal = Object.values(pipeline).flat().find((d) => d.id === dealId);
      setCalPrompt({
        message: `${deal?.target_name ?? 'This deal'} moved to Call / Demo — add the discovery call to your calendar?`,
        opportunity_id: dealId,
      });
    }
    void reason; // demo only — no persistence
  }, [pipeline]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const fromStage = (active.data.current as { stage: Stage })?.stage;
    const toStage   = over.id as Stage;

    if (!fromStage || fromStage === toStage) return;

    if (toStage === 'closed_lost') {
      setLostDealId(active.id as string);
    } else {
      moveDeal(active.id as string, toStage);
    }
  }, [moveDeal]);

  // Mobile stage change
  const handleMobileStageConfirm = () => {
    if (!mobilePickId || !mobileStage) return;
    if (mobileStage === 'closed_lost') {
      setLostDealId(mobilePickId);
    } else {
      moveDeal(mobilePickId, mobileStage as Stage);
    }
    setMobilePickId(null);
    setMobileStage('');
  };

  const metrics = METRICS;

  // Compact currency: $300 | $1.4k | $1.2M — avoids Math.round(/1000) zeroing small values
  const formatMetric = (n: number) => {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)     return `$${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
    return `$${n}`;
  };

  const openDeal = openDealId
    ? Object.values(pipeline).flat().find((d) => d.id === openDealId)
    : null;

  if (openDeal) {
    return (
      <div className="page-container">
        <DealDetailInline deal={openDeal} onBack={() => setOpenDealId(null)} />
      </div>
    );
  }

  return (
    <div className="page-container space-y-5">
      {showConfetti && (
        <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
          {Array.from({ length: 20 }).map((_, i) => (
            <div
              key={i}
              className="absolute w-2 h-2 rounded-sm animate-bounce"
              style={{
                left: `${(i * 37) % 100}%`,
                top:  `${(i * 19) % 60}%`,
                backgroundColor: ['#2563eb','#10b981','#f59e0b','#8b5cf6','#ef4444'][i % 5],
                animationDelay:  `${(i % 5) * 0.1}s`,
                animationDuration: '1s',
              }}
            />
          ))}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-xl font-bold text-text-primary">Pipeline</h1>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={viewTeam ? 'primary' : 'secondary'}
            onClick={() => setViewTeam((v) => !v)}
          >
            {viewTeam ? 'My deals' : 'Team view'}
          </Button>
        </div>
      </div>

      {/* Metrics bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Revenue',  value: formatMetric(metrics.total_revenue) },
          { label: 'Pipeline', value: formatMetric(metrics.pipeline_value) },
          { label: 'Win rate', value: `${metrics.win_rate_pct}%` },
          { label: 'In demos', value: metrics.call_demo_count },
        ].map((m) => (
          <div key={m.label} className="bg-white border border-surface-border rounded-lg p-3 text-center">
            <p className="text-xs text-text-muted">{m.label}</p>
            <p className="text-lg font-bold text-text-primary font-mono mt-0.5">{m.value}</p>
          </div>
        ))}
      </div>

      {/* Calendar prompt banner */}
      {calPrompt && (
        <div className="flex items-center gap-3 bg-brand-50 border border-brand-200 rounded-lg px-4 py-3">
          <Calendar size={15} className="text-brand shrink-0" />
          <p className="text-sm text-brand flex-1">{calPrompt.message}</p>
          <Button size="xs" onClick={() => setCalPrompt(null)}>
            Add to calendar
          </Button>
          <button onClick={() => setCalPrompt(null)} className="text-brand opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Board */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4 md:pb-2">
          {BOARD_COLUMNS.map((col) => (
            <Column
              key={col}
              stage={col}
              deals={pipeline[col]}
              onStageChange={(id) => { setMobilePickId(id); setMobileStage(''); }}
              onOpen={(id) => setOpenDealId(id)}
            />
          ))}
        </div>

        <DragOverlay>
          {activeId && (() => {
            const deal = Object.values(pipeline).flat().find((d) => d.id === activeId);
            return deal ? <DealCard deal={deal} isDragging /> : null;
          })()}
        </DragOverlay>
      </DndContext>

      {/* Lost reason modal */}
      <Modal
        isOpen={!!lostDealId}
        onClose={() => setLostDealId(null)}
        title="Why was this deal lost?"
        size="sm"
      >
        <Textarea
          label="Lost reason (optional)"
          placeholder="Price too high, went with competitor, timing…"
          rows={3}
          value={lostReason}
          onChange={(e) => setLostReason(e.target.value)}
        />
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" size="sm" onClick={() => setLostDealId(null)}>Cancel</Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              if (lostDealId) moveDeal(lostDealId, 'closed_lost', lostReason);
              setLostDealId(null);
              setLostReason('');
            }}
          >
            Mark as lost
          </Button>
        </div>
      </Modal>

      {/* Mobile stage picker modal */}
      <Modal
        isOpen={!!mobilePickId}
        onClose={() => setMobilePickId(null)}
        title="Move to stage"
        size="sm"
      >
        <Select
          label="New stage"
          options={PIPELINE_STAGE_VALUES.map((s) => ({ value: s, label: STAGE_LABELS[s] }))}
          placeholder="Select stage"
          value={mobileStage}
          onChange={(e) => setMobileStage(e.target.value)}
        />
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" size="sm" onClick={() => setMobilePickId(null)}>Cancel</Button>
          <Button size="sm" disabled={!mobileStage} onClick={handleMobileStageConfirm}>
            Move deal
          </Button>
        </div>
      </Modal>
    </div>
  );
}
