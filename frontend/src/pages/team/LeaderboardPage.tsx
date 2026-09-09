// FILE: src/pages/team/LeaderboardPage.tsx
// STATIC DEMO BUILD — no network calls, hardcoded data for screenshots
import React from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { formatRate, cn } from '@/lib/utils';

const MEDAL = ['🥇', '🥈', '🥉'];

const LEADERBOARD = [
  { user_id: 'u1', name: 'Priya Nandakumar', role: 'Account Executive', sent_30d: 842, response_rate: 0.412, closed_won: 14 },
  { user_id: 'u2', name: 'Marcus Idowu',      role: 'Account Executive', sent_30d: 761, response_rate: 0.388, closed_won: 12 },
  { user_id: 'u3', name: 'Sofia Reyes',       role: 'Sales Manager',     sent_30d: 655, response_rate: 0.401, closed_won: 11 },
  { user_id: 'u4', name: 'Daniel Okafor',     role: 'Account Executive', sent_30d: 703, response_rate: 0.352, closed_won: 9  },
  { user_id: 'u5', name: 'Hannah Lindqvist',  role: 'SDR',               sent_30d: 918, response_rate: 0.297, closed_won: 7  },
  { user_id: 'u6', name: 'Tomás Bianchi',     role: 'SDR',               sent_30d: 874, response_rate: 0.311, closed_won: 6  },
  { user_id: 'u7', name: 'Grace Fielding',    role: 'Account Executive', sent_30d: 589, response_rate: 0.334, closed_won: 6  },
  { user_id: 'u8', name: 'Kenji Watanabe',    role: 'SDR',               sent_30d: 802, response_rate: 0.279, closed_won: 5  },
  { user_id: 'u9', name: 'Aisha Bello',       role: 'Account Executive', sent_30d: 534, response_rate: 0.298, closed_won: 4  },
  { user_id: 'u10', name: 'Liam O\u2019Connor', role: 'SDR',             sent_30d: 611, response_rate: 0.245, closed_won: 3  },
];

export default function LeaderboardPage() {
  const board = LEADERBOARD;

  return (
    <div className="page-container space-y-5">
      <h1 className="text-xl font-bold text-text-primary">Leaderboard</h1>
      <p className="text-sm text-text-muted">Last 30 days · based on messages sent, response rate, and closed deals</p>

      <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
        {board.map((m, i) => (
          <div
            key={m.user_id}
            className={cn(
              'flex items-center gap-4 px-4 py-3 border-b border-surface-border last:border-0',
              i === 0 && 'bg-amber-50/40',
            )}
          >
            <span className="text-lg w-6 text-center shrink-0">
              {MEDAL[i] ?? <span className="text-sm text-text-muted">{i + 1}</span>}
            </span>
            <Avatar name={m.name} size="sm" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-text-primary truncate">{m.name}</p>
              <p className="text-xs text-text-muted">{m.role}</p>
            </div>
            <div className="grid grid-cols-3 gap-4 shrink-0 text-right">
              <div>
                <p className="text-xs text-text-muted">Sent</p>
                <p className="text-sm font-bold text-text-primary">{m.sent_30d}</p>
              </div>
              <div>
                <p className="text-xs text-text-muted">Rate</p>
                <p className="text-sm font-bold text-text-primary">{formatRate(m.response_rate)}</p>
              </div>
              <div>
                <p className="text-xs text-text-muted">Won</p>
                <p className="text-sm font-bold text-success">{m.closed_won}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
