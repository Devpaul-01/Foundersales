// FILE: src/pages/team/TeamInsightsPage.tsx
// DEMO BUILD — all data is hardcoded locally for screenshots. No network calls.
import React, { useState } from 'react';
import { Avatar }        from '@/components/ui/Avatar';
import { Tabs }          from '@/components/ui/Tabs';
import { SKILL_DIMENSION_LABELS } from '@/lib/constants';
import { cn } from '@/lib/utils';

const TEAM_INSIGHT_TABS = [
  { value: 'why_losing', label: 'Why losing'   },
  { value: 'matrix',     label: 'Skill matrix' },
];

// ─── Hardcoded demo data ────────────────────────────────────────
const WHY_LOSING_DATA = {
  summary: 'Most losses this quarter trace back to pricing objections surfaced too late in the cycle and stalled multi-threading on the buyer side. Reps who loop in a second stakeholder before the second call close at a noticeably higher rate.',
  total: 58,
  reasons: [
    { reason: 'Price exceeded budget expectations', count: 19 },
    { reason: 'Lost to incumbent vendor',           count: 14 },
    { reason: 'Champion left the company',          count: 9  },
    { reason: 'Deal went silent after proposal',    count: 8  },
    { reason: 'Feature gap vs. competitor',         count: 5  },
    { reason: 'Budget frozen this fiscal year',     count: 3  },
  ],
};

const SKILL_MATRIX_DATA = {
  members: [
    { user_id: 'u1', name: 'Priya Natarajan',    skills: { discovery: 88, objection_handling: 74, negotiation: 62, closing: 81 }, overall_score: 84 },
    { user_id: 'u7', name: 'Aisha Bello',        skills: { discovery: 91, objection_handling: 79, negotiation: 68, closing: 85 }, overall_score: 81 },
    { user_id: 'u2', name: 'Marcus Webb',        skills: { discovery: 76, objection_handling: 58, negotiation: 71, closing: 77 }, overall_score: 79 },
    { user_id: 'u3', name: 'Elena Torres',       skills: { discovery: 63, objection_handling: 69, negotiation: 66, closing: 72 }, overall_score: 75 },
    { user_id: 'u4', name: 'Jordan Kim',         skills: { discovery: 70, objection_handling: 61, negotiation: 54, closing: 48 }, overall_score: 68 },
    { user_id: 'u5', name: 'Sofia Alvarez',      skills: { discovery: 52, objection_handling: 47, negotiation: 55, closing: 58 }, overall_score: 62 },
    { user_id: 'u8', name: 'Ryan O\u2019Connell', skills: { discovery: 59, objection_handling: 44, negotiation: 49, closing: 39 }, overall_score: 60 },
    { user_id: 'u6', name: 'Devon Marsh',        skills: { discovery: 41, objection_handling: 33, negotiation: 38, closing: 29 }, overall_score: 54 },
  ],
};

export default function TeamInsightsPage() {
  const [tab, setTab] = useState('why_losing');

  return (
    <div className="page-container space-y-5">
      <h1 className="text-xl font-bold text-text-primary">Team insights</h1>

      <Tabs tabs={TEAM_INSIGHT_TABS} value={tab} onChange={setTab} variant="underline" />

      {/* Why losing */}
      {tab === 'why_losing' && (
        <div className="space-y-4">
          <div className="bg-white border border-surface-border rounded-lg p-5">
            <p className="text-xs font-semibold text-text-primary mb-2">Team summary</p>
            <p className="text-sm text-text-secondary leading-relaxed">{WHY_LOSING_DATA.summary}</p>
          </div>
          <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide px-4 py-2.5 border-b border-surface-border bg-surface-base">
              Top reasons
            </p>
            {WHY_LOSING_DATA.reasons.map((r, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-surface-border last:border-0">
                <div className="flex-1">
                  <p className="text-sm text-text-primary">{r.reason}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-danger rounded-full"
                      style={{ width: `${Math.min(100, (r.count / WHY_LOSING_DATA.total) * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-text-muted w-8 text-right">{r.count}×</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Skill matrix */}
      {tab === 'matrix' && (
        <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border bg-surface-base">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-muted">Member</th>
                  {Object.keys(SKILL_DIMENSION_LABELS).slice(0, 3).map((k) => (
                    <th key={k} className="text-right px-3 py-2.5 text-xs font-semibold text-text-muted">
                      {SKILL_DIMENSION_LABELS[k].split(' ')[0]}
                    </th>
                  ))}
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-text-muted">Overall</th>
                </tr>
              </thead>
              <tbody>
                {SKILL_MATRIX_DATA.members.map((m) => (
                  <tr key={m.user_id} className="border-b border-surface-border last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Avatar name={m.name} size="xs" />
                        <span className="text-text-primary">{m.name}</span>
                      </div>
                    </td>
                    {Object.keys(SKILL_DIMENSION_LABELS).slice(0, 3).map((k) => (
                      <td key={k} className="text-right px-3 py-2.5">
                        <span className={cn(
                          'text-xs font-mono',
                          (m.skills?.[k] ?? 0) >= 70 ? 'text-success' :
                          (m.skills?.[k] ?? 0) >= 40 ? 'text-warning' : 'text-danger',
                        )}>
                          {m.skills?.[k] ?? '—'}
                        </span>
                      </td>
                    ))}
                    <td className="text-right px-4 py-2.5">
                      <span className={cn(
                        'text-sm font-bold',
                        (m.overall_score ?? 0) >= 70 ? 'text-success' :
                        (m.overall_score ?? 0) >= 40 ? 'text-warning' : 'text-danger',
                      )}>
                        {m.overall_score ?? '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
