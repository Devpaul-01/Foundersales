// FILE: src/pages/team/CoachingQueuePage.tsx
// DEMO BUILD — static hardcoded data, no network calls.
import React, { useState } from 'react';
import { Button }        from '@/components/ui/Button';
import { Badge }         from '@/components/ui/Badge';
import { Avatar }        from '@/components/ui/Avatar';
import { Modal }         from '@/components/ui/Modal';
import { Textarea }      from '@/components/ui/Input';
import { Bell } from 'lucide-react';

interface QueueMember {
  user_id: string;
  name: string;
  flags: string[];
}

const FLAG_LABELS: Record<string, { label: string; color: 'red' | 'yellow' | 'gray' }> = {
  no_outreach_7d:  { label: 'No outreach 7d',  color: 'yellow' },
  no_practice_7d:  { label: 'No practice 7d',  color: 'yellow' },
  score_declining: { label: 'Score declining', color: 'red'    },
  low_skill_score: { label: 'Low skill score', color: 'red'    },
};

const DEMO_QUEUE: QueueMember[] = [
  {
    user_id: 'u1',
    name: 'Grace Liu',
    flags: ['score_declining', 'no_practice_7d'],
  },
  {
    user_id: 'u2',
    name: 'Tomas Reyes',
    flags: ['no_outreach_7d'],
  },
  {
    user_id: 'u3',
    name: 'Amara Chukwu',
    flags: ['low_skill_score', 'no_practice_7d'],
  },
  {
    user_id: 'u4',
    name: 'Ben Fischer',
    flags: ['no_outreach_7d', 'score_declining'],
  },
  {
    user_id: 'u5',
    name: 'Naomi Park',
    flags: ['no_practice_7d'],
  },
];

export default function CoachingQueuePage() {
  const [nudgeTarget, setNudgeTarget] = useState<QueueMember | null>(null);
  const [nudgeMsg,    setNudgeMsg]    = useState('');
  const [isSending,   setIsSending]   = useState(false);

  const handleSendNudge = () => {
    if (!nudgeTarget) return;
    setIsSending(true);
    // Demo-only: simulate a brief send delay, no network call.
    setTimeout(() => {
      setIsSending(false);
      setNudgeTarget(null);
      setNudgeMsg('');
    }, 600);
  };

  return (
    <div className="page-container space-y-5">
      <h1 className="text-xl font-bold text-text-primary">Coaching queue</h1>
      <p className="text-sm text-text-muted">Team members who may need attention.</p>

      <div className="space-y-3">
        {DEMO_QUEUE.map((m) => (
          <div key={m.user_id} className="bg-white border border-surface-border rounded-lg p-4 flex items-start gap-3">
            <Avatar name={m.name} size="md" />
            <div className="flex-1 min-w-0 space-y-2">
              <p className="text-sm font-semibold text-text-primary">{m.name}</p>
              <div className="flex flex-wrap gap-1.5">
                {m.flags.map((flag) => {
                  const f = FLAG_LABELS[flag];
                  return f ? (
                    <Badge key={flag} variant={f.color} size="xs">{f.label}</Badge>
                  ) : null;
                })}
              </div>
            </div>
            <Button
              size="xs"
              variant="secondary"
              leftIcon={<Bell size={11} />}
              onClick={() => setNudgeTarget(m)}
            >
              Nudge
            </Button>
          </div>
        ))}
      </div>

      {/* Nudge modal */}
      <Modal
        isOpen={!!nudgeTarget}
        onClose={() => { setNudgeTarget(null); setNudgeMsg(''); }}
        title={`Nudge ${nudgeTarget?.name}`}
        size="sm"
      >
        <div className="space-y-3">
          <Textarea
            label="Message"
            rows={3}
            maxLength={500}
            placeholder="Hey, just checking in — how's your outreach going this week?"
            value={nudgeMsg}
            onChange={(e) => setNudgeMsg(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setNudgeTarget(null)}>Cancel</Button>
            <Button
              size="sm"
              disabled={!nudgeMsg.trim()}
              isLoading={isSending}
              onClick={handleSendNudge}
            >
              Send nudge
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
