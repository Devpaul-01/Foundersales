// FILE: src/pages/settings/NotificationsSettingsPage.tsx
// Debounced save of PUT /api/user/notification-preferences
import React, { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { userApi }  from '@/api/user';
import { useAuth }  from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';
import { useDebounce } from '@/hooks/useDebounce';
import { Toggle }   from '@/components/ui/Input';
import { Spinner }  from '@/components/common/index';
import type { NotificationPreferences } from '@/api/types';

const PREF_GROUPS = [
  {
    title: 'Outreach',
    prefs: [
      { key: 'new_opportunities',  label: 'New opportunities discovered'  },
      { key: 'feedback_reminders', label: 'Feedback reminders for sent deals'},
      { key: 'follow_up_reminders',label: 'Follow-up reminders'            },
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

export default function NotificationsSettingsPage() {
  const { user, refreshUser } = useAuth();
  const { showToast } = useToast();

  const defaultPrefs = user?.notification_preferences ?? {};
  const [localPrefs, setLocalPrefs] = useState<Partial<NotificationPreferences>>(defaultPrefs);
  const [savedStatus, setSavedStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  const debouncedPrefs = useDebounce(localPrefs, 900);

  const saveMutation = useMutation({
    mutationFn: (prefs: Partial<NotificationPreferences>) =>
      userApi.updatePreferences(prefs),
    onSuccess: () => {
      refreshUser();
      setSavedStatus('saved');
      setTimeout(() => setSavedStatus('idle'), 2000);
    },
    onError: () => showToast('Could not save preferences.', 'error'),
  });

  // Auto-save on debounced change (skip initial mount)
  const isFirstRender = React.useRef(true);
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    setSavedStatus('saving');
    saveMutation.mutate(debouncedPrefs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedPrefs]);

  const toggle = (key: string, value: boolean) => {
    setLocalPrefs((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="page-container max-w-2xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-text-primary">Notifications</h1>
        <div className="flex items-center gap-1.5 text-xs text-text-muted">
          {savedStatus === 'saving' && <><Spinner size="xs" /> Saving…</>}
          {savedStatus === 'saved'  && <span className="text-success">✓ Saved</span>}
        </div>
      </div>

      {/* Email digest */}
      <div className="bg-white border border-surface-border rounded-lg p-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-text-primary">Email digest</p>
          <p className="text-xs text-text-muted mt-0.5">Weekly summary of your activity and insights.</p>
        </div>
        <Toggle
          checked={!!user?.email_digest_enabled}
          onChange={(v) => toggle('email_digest_enabled', v)}
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
                checked={!!(localPrefs as any)[p.key]}
                onChange={(v) => toggle(p.key, v)}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
