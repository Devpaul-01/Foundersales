// FILE: src/pages/team/CoachingQueuePage.tsx
// GET /api/metrics/workspace/coaching-queue (manager+)
// POST /api/workspaces/:id/nudge
import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { metricsApi }    from '@/api/metrics';
import { workspacesApi } from '@/api/workspaces';
import { queryKeys }     from '@/lib/queryKeys';
import { useWorkspace }  from '@/hooks/useWorkspace';
import { useToast }      from '@/hooks/useToast';
import { Button }        from '@/components/ui/Button';
import { Badge }         from '@/components/ui/Badge';
import { Avatar }        from '@/components/ui/Avatar';
import { Modal }         from '@/components/ui/Modal';
import { Textarea }      from '@/components/ui/Input';
import { Skeleton }      from '@/components/ui/Skeleton';
import { EmptyState }    from '@/components/common/index';
import { Bell, Users2 } from 'lucide-react';

const FLAG_LABELS: Record<string, { label: string; color: 'red' | 'yellow' | 'gray' }> = {
  no_outreach_7d:  { label: 'No outreach 7d',  color: 'yellow' },
  no_practice_7d:  { label: 'No practice 7d',  color: 'yellow' },
  score_declining: { label: 'Score declining', color: 'red'    },
  low_skill_score: { label: 'Low skill score', color: 'red'    },
};

export default function CoachingQueuePage() {
  const { activeWorkspace } = useWorkspace();
  const { showToast }       = useToast();
  const wsId = activeWorkspace?.id ?? '';
  const [nudgeTarget, setNudgeTarget] = useState<any | null>(null);
  const [nudgeMsg,    setNudgeMsg]    = useState('');

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.coachingQueue,
    queryFn:  () => metricsApi.getCoachingQueue().then((r) => r.data.queue),
    staleTime: 5 * 60_000,
  });

  const nudgeMutation = useMutation({
    mutationFn: ({ userId, message }: { userId: string; message: string }) =>
      workspacesApi.nudge(wsId, userId, message),
    onSuccess: () => {
      showToast('Nudge sent!', 'success');
      setNudgeTarget(null);
      setNudgeMsg('');
    },
    onError: () => showToast('Could not send nudge.', 'error'),
  });

  const queue = data ?? [];

  return (
    <div className="page-container space-y-5">
      <h1 className="text-xl font-bold text-text-primary">Coaching queue</h1>
      <p className="text-sm text-text-muted">Team members who may need attention.</p>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" rounded="lg" />)}
        </div>
      ) : queue.length === 0 ? (
        <EmptyState
          icon={<Users2 size={28} />}
          headline="No coaching flags"
          subline="Your team is on track. Check back later."
        />
      ) : (
        <div className="space-y-3">
          {queue.map((m: any) => (
            <div key={m.user_id} className="bg-white border border-surface-border rounded-lg p-4 flex items-start gap-3">
              <Avatar name={m.name} size="md" />
              <div className="flex-1 min-w-0 space-y-2">
                <p className="text-sm font-semibold text-text-primary">{m.name}</p>
                <div className="flex flex-wrap gap-1.5">
                  {(m.flags ?? []).map((flag: string) => {
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
      )}

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
              isLoading={nudgeMutation.isPending}
              onClick={() => nudgeTarget && nudgeMutation.mutate({ userId: nudgeTarget.user_id, message: nudgeMsg })}
            >
              Send nudge
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
