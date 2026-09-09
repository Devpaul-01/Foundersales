// FILE: src/pages/settings/NotificationsSettingsPage.tsx
// Demo build — static local state, no API calls
import React, { useState } from 'react';
import { Toggle } from '@/components/ui/Input';

const PREF_GROUPS = [
  {
    title: 'Outreach',
    prefs: [
      { key: 'new_opportunities',  label: 'New opportunities discovered'   },
      { key: 'feedback_reminders', label: 'Feedback reminders for sent deals' },
      { key: 'follow_up_reminders',label: 'Follow-up reminders'             },
    ],
  },
  {
    title: 'Practice',
    prefs: [
      { key: 'practice_reminders', label: 'Practice session reminders'     },
      { key: 'skill_badge_earned', label: 'Skill badge earned'              },
    ],
  },
  {
    title: 'Calendar & meetings',
    prefs: [
      { key: 'meeting_prep_ready', label: 'Meeting prep ready'              },
      { key: 'debrief_reminders',  label: 'Post-meeting debrief reminders'  },
      { key: 'commitment_due',     label: 'Commitment due reminders'        },
    ],
  },
  {
    title: 'Growth & coaching',
    prefs: [
      { key: 'weekly_check_in',    label: 'Weekly check-in reminder'        },
      { key: 'growth_tips',        label: 'Growth tip notifications'        },
      { key: 'ai_insight',         label: 'AI coaching insights'            },
    ],
  },
] as const;

const DEFAULT_PREFS: Record<string, boolean> = {
  new_opportunities: true,
  feedback_reminders: true,
  follow_up_reminders: true,
  practice_reminders: false,
  skill_badge_earned: true,
  meeting_prep_ready: true,
  debrief_reminders: true,
  commitment_due: true,
  weekly_check_in: true,
  growth_tips: false,
  ai_insight: true,
};

export default function NotificationsSettingsPage() {
  const [emailDigestEnabled, setEmailDigestEnabled] = useState(true);
  const [localPrefs, setLocalPrefs] = useState<Record<string, boolean>>(DEFAULT_PREFS);
  const [savedStatus] = useState<'idle' | 'saving' | 'saved'>('saved');

  const toggle = (key: string, value: boolean) => {
    setLocalPrefs((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="page-container max-w-2xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-text-primary">Notifications</h1>
        <div className="flex items-center gap-1.5 text-xs text-text-muted">
          {savedStatus === 'saved' && <span className="text-success">✓ Saved</span>}
        </div>
      </div>

      {/* Email digest */}
      <div className="bg-white border border-surface-border rounded-lg p-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-text-primary">Email digest</p>
          <p className="text-xs text-text-muted mt-0.5">Weekly summary of your activity and insights.</p>
        </div>
        <Toggle
          checked={emailDigestEnabled}
          onChange={setEmailDigestEnabled}
        />
      </div>

      {/* Grouped prefs */}
      {PREF_GROUPS.map((group) => (
        <div key={group.title} className="bg-white border border-surface-border rounded-lg overflow-hidden">
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide px-4 py-2.5 border-b border-surface-border bg-surface-base">
            {group.title}
          </p>
          {group.prefs.map((p) => (
            <div key={p.key} className="flex items-center justify-between px-4 py-3 border-b border-surface-border last:border-0">
              <p className="text-sm text-text-primary">{p.label}</p>
              <Toggle
                checked={!!localPrefs[p.key]}
                onChange={(v) => toggle(p.key, v)}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
