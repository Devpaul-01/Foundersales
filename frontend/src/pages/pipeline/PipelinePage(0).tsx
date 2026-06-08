// ============================================================
// FILE: src/pages/pipeline/PipelinePage.tsx
// From pipeline-4.txt:
// - 5 columns: contacted, replied, call_demo, closed_won, closed_lost
// - @dnd-kit drag-and-drop desktop
// - Mobile: stage-change modal (per brief)
// - calendar_prompt on call_demo move
// - confetti on closed_won
// - lost_reason modal on closed_lost
// - PUT /api/pipeline/:id/stage with optimistic update + revert
// - team view toggle for managers
// ============================================================
import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  DndContext, DragOverlay, closestCorners,
  type DragStartEvent, type DragEndEvent,
  PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { pipelineApi }  from '@/api/pipeline';
import { queryClient }  from '@/lib/queryClient';
import { queryKeys }    from '@/lib/queryKeys';
import { useRole }      from '@/hooks/useRole';
import { useToast }     from '@/hooks/useToast';
import { useNotificationContext } from '@/contexts/NotificationContext';
import { Button }       from '@/components/ui/Button';
import { Badge }        from '@/components/ui/Badge';
import { Modal }        from '@/components/ui/Modal';
import { Select }       from '@/components/ui/Input';
import { Textarea }     from '@/components/ui/Input';
import { Skeleton }     from '@/components/ui/Skeleton';
import { EmptyState, InlineAlert } from '@/components/common/index';
import { AppError, type Opportunity, type CalendarPrompt } from '@/api/types';
import { PIPELINE_STAGE_VALUES, STAGE_LABELS, STAGE_COLORS } from '@/lib/constants';
import { formatRelativeDate, cn, isMobileViewport } from '@/lib/utils';
import { GripVertical, Calendar, Trophy, MoreHorizontal } from 'lucide-react';

const BOARD_COLUMNS = ['contacted', 'replied', 'call_demo', 'closed_won', 'closed_lost'] as const;

// ── Confetti ──────────────────────────────────────────────────
function Confetti({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {Array.from({ length: 20 }).map((_, i) => (
        <div
          key={i}
          className="absolute w-2 h-2 rounded-sm animate-bounce"
          style={{
            left: `${Math.random() * 100}%`,
            top:  `${Math.random() * 60}%`,
            backgroundColor: ['#2563eb','#10b981','#f59e0b','#8b5cf6','#ef4444'][i % 5],
            animationDelay:  `${Math.random() * 0.5}s`,
            animationDuration: `${0.8 + Math.random() * 0.6}s`,
          }}
        />
      ))}
    </div>
  );
}

// ── Deal card ─────────────────────────────────────────────────
interface DealCardProps {
  deal:        Opportunity;
  onStageChange?: (dealId: string) => void;
  isDragging?: boolean;
}

function DealCard({ deal, onStageChange, isDragging }: DealCardProps) {
  const navigate = useNavigate();
  const mobile   = isMobileViewport();

  return (
    <div
      className={cn(
        'bg-white border border-surface-border rounded-lg p-3 space-y-2 cursor-pointer',
        'hover:shadow-card-md hover:border-slate-300 transition-all',
        isDragging && 'opacity-40 shadow-elevated',
      )}
      onClick={() => navigate(`/pipeline/${deal.id}`)}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-text-primary leading-snug truncate">
          {deal.target_name ?? 'Prospect'}
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
        <span>{formatRelativeDate(deal.last_stage_changed_at ?? deal.created_at)}</span>
        {deal.follow_up_count > 0 && (
          <span className="text-brand">↩ {deal.follow_up_count}</span>
        )}
      </div>
    </div>
  );
}

// ── Sortable deal card wrapper ────────────────────────────────
function SortableDealCard({ deal, onStageChange }: { deal: Opportunity; onStageChange?: (id: string) => void }) {
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
          <DealCard deal={deal} onStageChange={onStageChange} isDragging={isDragging} />
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
}

function Column({ stage, deals, isOver, onStageChange }: ColumnProps) {
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
            <SortableDealCard key={deal.id} deal={deal} onStageChange={onStageChange} />
          ))}
        </SortableContext>
        {deals.length === 0 && (
          <p className="text-center text-xs text-text-muted py-6 italic">No deals here</p>
        )}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────
export default function PipelinePage() {
  const { isManager }  = useRole();
  const { showToast }  = useToast();
  const { refreshCounts } = useNotificationContext();
  const navigate       = useNavigate();

  const [viewTeam,       setViewTeam]       = useState(false);
  const [activeId,       setActiveId]       = useState<string | null>(null);
  const [calPrompt,      setCalPrompt]      = useState<CalendarPrompt | null>(null);
  const [lostDealId,     setLostDealId]     = useState<string | null>(null);
  const [lostReason,     setLostReason]     = useState('');
  const [showConfetti,   setShowConfetti]   = useState(false);
  // Mobile stage picker
  const [mobilePickId,   setMobilePickId]   = useState<string | null>(null);
  const [mobileStage,    setMobileStage]    = useState('');

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.pipeline(viewTeam ? 'team' : undefined),
    queryFn:  () => pipelineApi.getBoard(viewTeam ? 'team' : undefined).then((r) => r.data),
    staleTime: 30_000,
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const stageMutation = useMutation({
    mutationFn: ({ id, stage, lostReason: lr }: { id: string; stage: string; lostReason?: string }) =>
      pipelineApi.updateStage(id, stage, lr).then((r) => r.data),
    onSuccess: (res, { stage }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pipeline() });
      refreshCounts();
      if (res.calendar_prompt) setCalPrompt(res.calendar_prompt);
      if (stage === 'closed_won') {
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 2500);
        showToast('🏆 Deal won! Great work!', 'success');
      }
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pipeline() });
      showToast('Failed to move deal. Please try again.', 'error');
    },
  });

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const fromStage = (active.data.current as { stage: string })?.stage;
    const toStage   = over.id as string;

    if (!fromStage || fromStage === toStage) return;

    // Optimistic update
    queryClient.setQueryData(queryKeys.pipeline(), (old: unknown) => {
      const o = old as typeof data;
      if (!o) return o;
      const pipeline = { ...o.pipeline };
      const deal = Object.values(pipeline).flat().find((d) => d.id === active.id);
      if (!deal) return o;
      (pipeline[fromStage as keyof typeof pipeline] as Opportunity[]) =
        pipeline[fromStage as keyof typeof pipeline].filter((d) => d.id !== active.id);
      (pipeline[toStage as keyof typeof pipeline] as Opportunity[]) =
        [{ ...deal, stage: toStage as Opportunity['stage'] },
         ...pipeline[toStage as keyof typeof pipeline]];
      return { ...o, pipeline };
    });

    if (toStage === 'closed_lost') {
      setLostDealId(active.id as string);
    } else {
      stageMutation.mutate({ id: active.id as string, stage: toStage });
    }
  }, [data, stageMutation]);

  // Mobile stage change
  const handleMobileStageConfirm = () => {
    if (!mobilePickId || !mobileStage) return;
    if (mobileStage === 'closed_lost') {
      setLostDealId(mobilePickId);
    } else {
      stageMutation.mutate({ id: mobilePickId, stage: mobileStage });
    }
    setMobilePickId(null);
    setMobileStage('');
  };

  const metrics = data?.metrics;
  const pipeline = data?.pipeline;

  // Compact currency: $300 | $1.4k | $1.2M — avoids Math.round(/1000) zeroing small values
  const formatMetric = (n: number) => {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)     return `$${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
    return `$${n}`;
  };

  return (
    <div className="page-container space-y-5">
      <Confetti active={showConfetti} />

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-xl font-bold text-text-primary">Pipeline</h1>
        {isManager && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={viewTeam ? 'primary' : 'secondary'}
              onClick={() => setViewTeam((v) => !v)}
            >
              {viewTeam ? 'My deals' : 'Team view'}
            </Button>
          </div>
        )}
      </div>

      {/* Metrics bar */}
      {metrics && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Revenue',  value: formatMetric(metrics.total_revenue ?? 0) },
            { label: 'Pipeline', value: formatMetric(metrics.pipeline_value ?? 0) },
            { label: 'Win rate', value: `${metrics.win_rate_pct ?? 0}%` },
            { label: 'In demos', value: metrics.call_demo_count ?? 0 },
          ].map((m) => (
            <div key={m.label} className="bg-white border border-surface-border rounded-lg p-3 text-center">
              <p className="text-xs text-text-muted">{m.label}</p>
              <p className="text-lg font-bold text-text-primary font-mono mt-0.5">{m.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Calendar prompt banner */}
      {calPrompt && (
        <div className="flex items-center gap-3 bg-brand-50 border border-brand-200 rounded-lg px-4 py-3">
          <Calendar size={15} className="text-brand shrink-0" />
          <p className="text-sm text-brand flex-1">{calPrompt.message}</p>
          <Button
            size="xs"
            onClick={() => { navigate(ROUTES.CALENDAR); setCalPrompt(null); }}
          >
            Add to calendar
          </Button>
          <button onClick={() => setCalPrompt(null)} className="text-brand opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Board */}
      {isLoading ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {BOARD_COLUMNS.map((col) => (
            <div key={col} className="shrink-0 w-60 space-y-2">
              <Skeleton className="h-8 w-full" rounded="lg" />
              <Skeleton className="h-24 w-full" rounded="lg" />
              <Skeleton className="h-24 w-full" rounded="lg" />
            </div>
          ))}
        </div>
      ) : (
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
                deals={pipeline?.[col] ?? []}
                onStageChange={(id) => { setMobilePickId(id); setMobileStage(''); }}
              />
            ))}
          </div>

          <DragOverlay>
            {activeId && (() => {
              const deal = Object.values(pipeline ?? {}).flat().find((d) => d.id === activeId);
              return deal ? <DealCard deal={deal} isDragging /> : null;
            })()}
          </DragOverlay>
        </DndContext>
      )}

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
            isLoading={stageMutation.isPending}
            onClick={() => {
              if (lostDealId) stageMutation.mutate({ id: lostDealId, stage: 'closed_lost', lostReason });
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
