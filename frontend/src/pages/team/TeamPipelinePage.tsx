// FILE: src/pages/team/TeamPipelinePage.tsx
// DEMO BUILD — all data is hardcoded locally for screenshots. No network calls.
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Skeleton }    from '@/components/ui/Skeleton';
import { Avatar }      from '@/components/ui/Avatar';
import { PIPELINE_STAGE_LABELS, PIPELINE_STAGE_COLORS } from '@/lib/constants';
import { formatCurrency, formatRelativeDate, cn } from '@/lib/utils';
import type { Opportunity } from '@/api/types';

const STAGE_ORDER = ['contacted', 'replied', 'call_demo', 'closed_won', 'closed_lost'] as const;

// ---------------------------------------------------------------------------
// Hardcoded demo data — realistic team pipeline for screenshots.
// ---------------------------------------------------------------------------

const now = new Date('2026-09-08T15:00:00Z');
const daysAgo = (n: number, h = 9) => {
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  d.setHours(h, 0, 0, 0);
  return d.toISOString();
};

type DemoOpp = Opportunity & { id: string };

const CONTACTED: DemoOpp[] = [
  {
    id: 'opp-1001',
    target_name: 'Marcus Webb',
    company_name: 'Northwind Logistics',
    owner_name: 'Priya Shah',
    deal_value_usd: 8400,
    last_stage_changed_at: daysAgo(0, 10),
    created_at: daysAgo(0, 10),
  } as DemoOpp,
  {
    id: 'opp-1002',
    target_name: 'Elena Ruiz',
    company_name: 'Fenwick & Cole',
    owner_name: 'Diego Alvarez',
    deal_value_usd: 4200,
    last_stage_changed_at: daysAgo(1, 14),
    created_at: daysAgo(1, 14),
  } as DemoOpp,
  {
    id: 'opp-1003',
    target_name: 'Jonah Whitfield',
    company_name: 'Cascade Robotics',
    owner_name: 'Priya Shah',
    deal_value_usd: 15750,
    last_stage_changed_at: daysAgo(2, 8),
    created_at: daysAgo(2, 8),
  } as DemoOpp,
  {
    id: 'opp-1004',
    target_name: 'Sara Lindqvist',
    company_name: 'Boreal Health Group',
    owner_name: 'Tomasz Nowak',
    deal_value_usd: 6100,
    last_stage_changed_at: daysAgo(3, 11),
    created_at: daysAgo(3, 11),
  } as DemoOpp,
];

const REPLIED: DemoOpp[] = [
  {
    id: 'opp-2001',
    target_name: 'Aisha Bello',
    company_name: 'Harborline Freight',
    owner_name: 'Diego Alvarez',
    deal_value_usd: 9800,
    last_stage_changed_at: daysAgo(1, 16),
    created_at: daysAgo(4, 9),
  } as DemoOpp,
  {
    id: 'opp-2002',
    target_name: 'Owen Sinclair',
    company_name: 'Redshift Analytics',
    owner_name: 'Priya Shah',
    deal_value_usd: 22000,
    last_stage_changed_at: daysAgo(2, 13),
    created_at: daysAgo(5, 9),
  } as DemoOpp,
  {
    id: 'opp-2003',
    target_name: 'Naomi Fischer',
    company_name: 'Gilded Leaf Cosmetics',
    owner_name: 'Tomasz Nowak',
    deal_value_usd: 3600,
    last_stage_changed_at: daysAgo(0, 17),
    created_at: daysAgo(3, 9),
  } as DemoOpp,
];

const CALL_DEMO: DemoOpp[] = [
  {
    id: 'opp-3001',
    target_name: 'Victor Chan',
    company_name: 'Ampere Energy Systems',
    owner_name: 'Priya Shah',
    deal_value_usd: 48000,
    last_stage_changed_at: daysAgo(1, 10),
    created_at: daysAgo(9, 9),
  } as DemoOpp,
  {
    id: 'opp-3002',
    target_name: 'Ingrid Larsen',
    company_name: 'Solstice Wealth Partners',
    owner_name: 'Diego Alvarez',
    deal_value_usd: 31500,
    last_stage_changed_at: daysAgo(3, 15),
    created_at: daysAgo(12, 9),
  } as DemoOpp,
];

const CLOSED_WON: DemoOpp[] = [
  {
    id: 'opp-4001',
    target_name: 'Ben Okafor',
    company_name: 'Ironclad Construction Co.',
    owner_name: 'Tomasz Nowak',
    deal_value_usd: 56000,
    last_stage_changed_at: daysAgo(4, 12),
    created_at: daysAgo(20, 9),
  } as DemoOpp,
  {
    id: 'opp-4002',
    target_name: 'Claire Dubois',
    company_name: 'Meridian Legal Group',
    owner_name: 'Priya Shah',
    deal_value_usd: 19200,
    last_stage_changed_at: daysAgo(6, 9),
    created_at: daysAgo(24, 9),
  } as DemoOpp,
  {
    id: 'opp-4003',
    target_name: 'Tobias Reinhardt',
    company_name: 'Kessler Manufacturing',
    owner_name: 'Diego Alvarez',
    deal_value_usd: 74500,
    last_stage_changed_at: daysAgo(8, 14),
    created_at: daysAgo(30, 9),
  } as DemoOpp,
];

const CLOSED_LOST: DemoOpp[] = [
  {
    id: 'opp-5001',
    target_name: 'Renee Castillo',
    company_name: 'Bluepeak Insurance',
    owner_name: 'Tomasz Nowak',
    deal_value_usd: 12800,
    last_stage_changed_at: daysAgo(5, 10),
    created_at: daysAgo(18, 9),
  } as DemoOpp,
  {
    id: 'opp-5002',
    target_name: 'Mikael Andersson',
    company_name: 'Norrvik Timber',
    owner_name: 'Priya Shah',
    deal_value_usd: 9400,
    last_stage_changed_at: daysAgo(7, 16),
    created_at: daysAgo(15, 9),
  } as DemoOpp,
];

const DEMO_PIPELINE: Record<(typeof STAGE_ORDER)[number], DemoOpp[]> = {
  contacted: CONTACTED,
  replied: REPLIED,
  call_demo: CALL_DEMO,
  closed_won: CLOSED_WON,
  closed_lost: CLOSED_LOST,
};

const allOpps = [...CONTACTED, ...REPLIED, ...CALL_DEMO, ...CLOSED_WON, ...CLOSED_LOST];
const pipelineValue = [...CONTACTED, ...REPLIED, ...CALL_DEMO].reduce(
  (sum, o) => sum + (o.deal_value_usd ?? 0),
  0,
);
const totalRevenue = CLOSED_WON.reduce((sum, o) => sum + (o.deal_value_usd ?? 0), 0);
const winRatePct = Math.round((CLOSED_WON.length / (CLOSED_WON.length + CLOSED_LOST.length)) * 100);

const DEMO_METRICS = {
  pipeline_value: pipelineValue,
  total_revenue: totalRevenue,
  win_rate_pct: winRatePct,
  closed_won_count: CLOSED_WON.length,
};

// ---------------------------------------------------------------------------

function DealCard({ opp }: { opp: Opportunity }) {
  const navigate = useNavigate();
  return (
    <div
      onClick={() => navigate(`/pipeline/${opp.id}`)}
      className="bg-white border border-surface-border rounded-lg p-3 space-y-2 hover:shadow-card-sm cursor-pointer transition-all"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-text-primary truncate flex-1">
          {opp.target_name || opp.company_name || 'Prospect'}
        </p>
        {opp.deal_value_usd && (
          <span className="text-xs font-mono text-success shrink-0">
            {formatCurrency(opp.deal_value_usd, true)}
          </span>
        )}
      </div>
      {opp.company_name && (
        <p className="text-[11px] text-text-muted truncate -mt-1">{opp.company_name}</p>
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Avatar name={opp.owner_name ?? 'U'} size="xs" />
          <span className="text-xs text-text-muted truncate max-w-[80px]">{opp.owner_name}</span>
        </div>
        <span className="text-xs text-text-muted">{formatRelativeDate(opp.last_stage_changed_at ?? opp.created_at)}</span>
      </div>
    </div>
  );
}

export default function TeamPipelinePage() {
  const pipeline = DEMO_PIPELINE;
  const metrics  = DEMO_METRICS;

  return (
    <div className="page-container space-y-5">
      <h1 className="text-xl font-bold text-text-primary">Team pipeline</h1>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Pipeline value',  value: formatCurrency(metrics.pipeline_value, true)  },
          { label: 'Total revenue',   value: formatCurrency(metrics.total_revenue, true)    },
          { label: 'Win rate',        value: `${metrics.win_rate_pct}%`                     },
          { label: 'Closed won',      value: metrics.closed_won_count                       },
        ].map((s) => (
          <div key={s.label} className="bg-white border border-surface-border rounded-lg p-3">
            <p className="text-xs text-text-muted">{s.label}</p>
            <p className="text-lg font-bold text-text-primary">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {STAGE_ORDER.map((stage) => {
          const opps: Opportunity[] = pipeline[stage] ?? [];
          return (
            <div key={stage} className="shrink-0 w-64 space-y-2">
              <div className="flex items-center gap-2">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: PIPELINE_STAGE_COLORS[stage] }}
                />
                <p className="text-xs font-semibold text-text-primary">
                  {PIPELINE_STAGE_LABELS[stage]}
                </p>
                <span className="ml-auto text-xs text-text-muted">{opps.length}</span>
              </div>
              {opps.length === 0 ? (
                <div className="bg-slate-50 border border-dashed border-surface-border rounded-lg p-4 text-center text-xs text-text-muted">
                  Empty
                </div>
              ) : (
                <div className="space-y-2">
                  {opps.map((o) => <DealCard key={o.id} opp={o} />)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
