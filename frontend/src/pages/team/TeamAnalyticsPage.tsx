// FILE: src/pages/team/TeamAnalyticsPage.tsx
// DEMO BUILD — all data is hardcoded locally for screenshots. No network calls.
import React from 'react';
import { Badge }          from '@/components/ui/Badge';
import { Avatar }         from '@/components/ui/Avatar';
import { formatRate, cn } from '@/lib/utils';

// ─── Hardcoded demo data ────────────────────────────────────────
const ANALYTICS_DATA = {
  totals: {
    sent: 1247,
    positive_replies: 289,
    response_rate: 0.232,
    demos_booked: 34,
  },
  members: [
    { user_id: 'u7', name: 'Aisha Bello',        role: 'senior rep', sent: 231, responses: 62, response_rate: 0.268, demos: 8 },
    { user_id: 'u1', name: 'Priya Natarajan',    role: 'senior rep', sent: 248, responses: 60, response_rate: 0.242, demos: 7 },
    { user_id: 'u2', name: 'Marcus Webb',        role: 'rep',        sent: 219, responses: 48, response_rate: 0.219, demos: 6 },
    { user_id: 'u3', name: 'Elena Torres',       role: 'rep',        sent: 190, responses: 36, response_rate: 0.189, demos: 5 },
    { user_id: 'u4', name: 'Jordan Kim',         role: 'rep',        sent: 156, responses: 25, response_rate: 0.16,  demos: 4 },
    { user_id: 'u5', name: 'Sofia Alvarez',      role: 'associate',  sent: 98,  responses: 13, response_rate: 0.133, demos: 2 },
    { user_id: 'u8', name: 'Ryan O\u2019Connell', role: 'associate', sent: 84,  responses: 10, response_rate: 0.119, demos: 1 },
    { user_id: 'u6', name: 'Devon Marsh',        role: 'associate',  sent: 21,  responses: 2,  response_rate: 0.095, demos: 1 },
  ],
};

export default function TeamAnalyticsPage() {
  const { totals, members } = ANALYTICS_DATA;

  return (
    <div className="page-container space-y-5">
      <h1 className="text-xl font-bold text-text-primary">Team analytics</h1>
      <p className="text-sm text-text-muted">Last 30 days</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Messages sent',    value: totals.sent                    },
          { label: 'Positive replies', value: totals.positive_replies        },
          { label: 'Response rate',    value: formatRate(totals.response_rate) },
          { label: 'Demos booked',     value: totals.demos_booked            },
        ].map((s) => (
          <div key={s.label} className="bg-white border border-surface-border rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-text-primary">{s.value}</p>
            <p className="text-xs text-text-muted mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide px-4 py-2.5 border-b border-surface-border bg-surface-base">
          Member breakdown
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border bg-surface-base">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-muted">Member</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-text-muted">Sent</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-text-muted">Responses</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-text-muted">Rate</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-text-muted">Demos</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.user_id} className="border-b border-surface-border last:border-0">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <Avatar name={m.name} size="xs" />
                      <span className="text-text-primary">{m.name}</span>
                      <Badge variant="gray" size="xs">{m.role}</Badge>
                    </div>
                  </td>
                  <td className="text-right px-4 py-2.5 text-text-secondary">{m.sent}</td>
                  <td className="text-right px-4 py-2.5 text-text-secondary">{m.responses}</td>
                  <td className="text-right px-4 py-2.5">
                    <span className={cn(
                      'font-medium',
                      m.response_rate >= 0.3 ? 'text-success' :
                      m.response_rate >= 0.15 ? 'text-warning' : 'text-danger',
                    )}>
                      {formatRate(m.response_rate)}
                    </span>
                  </td>
                  <td className="text-right px-4 py-2.5 text-text-secondary">{m.demos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
