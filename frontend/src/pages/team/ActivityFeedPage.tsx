// FILE: src/pages/team/ActivityFeedPage.tsx
// DEMO BUILD — static hardcoded data, no network calls.
import React from 'react';

interface DemoActivity {
  id: string;
  event_type: string;
  actor_name: string;
  description: string;
  detail?: string;
  created_at: string; // pre-formatted relative string for the demo
}

const ACTIVITY_ICONS: Record<string, string> = {
  opportunity_created: '💡',
  opportunity_won:     '🏆',
  opportunity_lost:    '😔',
  meeting_scheduled:   '📅',
  meeting_debriefed:   '📝',
  practice_completed:  '🎯',
  goal_achieved:       '✅',
  member_joined:       '👋',
  check_in_submitted:  '🌟',
};

const DEMO_EVENTS: DemoActivity[] = [
  {
    id: 'a1',
    event_type: 'opportunity_won',
    actor_name: 'Priya Nair',
    description: 'closed the Northwind Retail opportunity',
    detail: '$48,200 · Enterprise plan · 4-month cycle',
    created_at: '8m ago',
  },
  {
    id: 'a2',
    event_type: 'practice_completed',
    actor_name: 'Marcus Webb',
    description: 'completed a practice session: Objection Handling — Pricing Pushback',
    detail: 'Score 87/100 · up from 74 last attempt',
    created_at: '22m ago',
  },
  {
    id: 'a3',
    event_type: 'meeting_debriefed',
    actor_name: 'Sofia Alvarez',
    description: 'debriefed her call with Halcyon Logistics',
    detail: 'Talk ratio 42% · 3 next steps logged',
    created_at: '41m ago',
  },
  {
    id: 'a4',
    event_type: 'check_in_submitted',
    actor_name: 'Daniel Osei',
    description: 'submitted his weekly check-in',
    detail: '"Pipeline is thin this week, focusing on outbound"',
    created_at: '1h ago',
  },
  {
    id: 'a5',
    event_type: 'meeting_scheduled',
    actor_name: 'Priya Nair',
    description: 'scheduled a discovery call with Alden Manufacturing',
    detail: 'Thu, Sep 10 · 2:30 PM',
    created_at: '1h ago',
  },
  {
    id: 'a6',
    event_type: 'goal_achieved',
    actor_name: 'Marcus Webb',
    description: 'hit his Q3 outbound calls goal',
    detail: '120 / 120 calls',
    created_at: '2h ago',
  },
  {
    id: 'a7',
    event_type: 'opportunity_created',
    actor_name: 'Jordan Kim',
    description: 'created a new opportunity: Brightside Health',
    detail: '$16,500 · Growth plan',
    created_at: '3h ago',
  },
  {
    id: 'a8',
    event_type: 'member_joined',
    actor_name: 'Elena Torres',
    description: 'joined the Southeast team',
    created_at: '5h ago',
  },
  {
    id: 'a9',
    event_type: 'opportunity_lost',
    actor_name: 'Sofia Alvarez',
    description: 'marked Vantage Freight as closed-lost',
    detail: 'Reason: went with incumbent vendor',
    created_at: 'Yesterday',
  },
  {
    id: 'a10',
    event_type: 'practice_completed',
    actor_name: 'Daniel Osei',
    description: 'completed a practice session: Cold Call Opener',
    detail: 'Score 91/100',
    created_at: 'Yesterday',
  },
  {
    id: 'a11',
    event_type: 'meeting_debriefed',
    actor_name: 'Jordan Kim',
    description: 'debriefed his call with Alden Manufacturing',
    detail: 'Talk ratio 38% · 2 next steps logged',
    created_at: 'Yesterday',
  },
  {
    id: 'a12',
    event_type: 'goal_achieved',
    actor_name: 'Elena Torres',
    description: 'hit her first-week onboarding checklist',
    detail: '6 / 6 tasks complete',
    created_at: '2 days ago',
  },
];

export default function ActivityFeedPage() {
  return (
    <div className="page-container space-y-5">
      <h1 className="text-xl font-bold text-text-primary">Team activity</h1>

      <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
        {DEMO_EVENTS.map((ev) => (
          <div
            key={ev.id}
            className="flex items-start gap-3 px-4 py-3 border-b border-surface-border last:border-0"
          >
            <div className="w-8 h-8 rounded-full bg-surface-base border border-surface-border flex items-center justify-center text-sm shrink-0">
              {ACTIVITY_ICONS[ev.event_type] ?? '📌'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-text-primary">
                <span className="font-semibold">{ev.actor_name}</span>
                {' '}
                <span className="text-text-secondary">{ev.description}</span>
              </p>
              {ev.detail && (
                <p className="text-xs text-text-muted mt-0.5 truncate">{ev.detail}</p>
              )}
            </div>
            <span className="text-xs text-text-muted shrink-0">{ev.created_at}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
