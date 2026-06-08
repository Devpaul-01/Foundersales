// FILE: src/pages/team/TeamOpportunitiesPage.tsx
// GET /api/opportunities/team (manager+)
// Assign to member via PUT /api/opportunities/:id/assign
//
// Fix: The backend's team query only joins users!user_id (the creator),
// so opp.assigned_to_name never exists. Instead we resolve the assignee's
// name client-side from the already-fetched members list using opp.assigned_to.
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { opportunitiesApi } from '@/api/opportunities';
import { workspacesApi }    from '@/api/workspaces';
import { queryClient }      from '@/lib/queryClient';
import { queryKeys }        from '@/lib/queryKeys';
import { useWorkspace }     from '@/hooks/useWorkspace';
import { useToast }         from '@/hooks/useToast';
import { Button }           from '@/components/ui/Button';
import { Badge, PlatformBadge } from '@/components/ui/Badge';
import { Avatar }           from '@/components/ui/Avatar';
import { Modal }            from '@/components/ui/Modal';
import { Select }           from '@/components/ui/Input';
import { Skeleton }         from '@/components/ui/Skeleton';
import { EmptyState }       from '@/components/common/index';
import { formatRelativeDate, cn } from '@/lib/utils';
import { Zap, UserPlus } from 'lucide-react';
import type { Opportunity } from '@/api/types';

export default function TeamOpportunitiesPage() {
  const navigate          = useNavigate();
  const { activeWorkspace } = useWorkspace();
  const { showToast }     = useToast();
  const wsId = activeWorkspace?.id ?? '';
  const [assignTarget, setAssignTarget] = useState<Opportunity | null>(null);
  const [assignee,     setAssignee]     = useState('');

  const { data: opps, isLoading } = useQuery({
    queryKey: queryKeys.teamOpportunities,
    queryFn:  () => opportunitiesApi.listTeam().then((r) => r.data.opportunities),
    staleTime: 60_000,
  });

  const { data: members } = useQuery({
    queryKey: queryKeys.members(wsId),
    queryFn:  () => workspacesApi.listMembers(wsId).then((r) => r.data.members),
    enabled:  !!wsId,
    staleTime: 60_000,
  });

  // Build a quick lookup map: user_id → display name
  // Used to resolve opp.assigned_to (a UUID) to a readable name without
  // needing a DB join on the backend.
  const memberNameById = React.useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of members ?? []) {
      map[m.user_id] = m.name ?? m.email ?? m.user_id;
    }
    return map;
  }, [members]);

  const assignMutation = useMutation({
    mutationFn: ({ id, userId }: { id: string; userId: string }) =>
      opportunitiesApi.assign(id, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.teamOpportunities });
      showToast('Opportunity assigned.', 'success');
      setAssignTarget(null);
      setAssignee('');
    },
    onError: () => showToast('Could not assign.', 'error'),
  });

  const opportunities = opps ?? [];

  return (
    <div className="page-container space-y-5">
      <h1 className="text-xl font-bold text-text-primary">Team opportunities</h1>

      <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" rounded="lg" />)}
          </div>
        ) : opportunities.length === 0 ? (
          <EmptyState icon={<Zap size={28} />} headline="No team opportunities" subline="Team opportunities will appear here." />
        ) : (
          opportunities.map((opp) => {
            // Resolve the assignee name from the members map using the UUID
            const assigneeName = opp.assigned_to ? memberNameById[opp.assigned_to] : null;

            return (
              <div
                key={opp.id}
                className="flex items-center gap-3 px-4 py-3 border-b border-surface-border last:border-0"
              >
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate(`/opportunities/${opp.id}`)}>
                  <p className="text-sm font-medium text-text-primary truncate">
                    {opp.target_name || 'Prospect'}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {opp.platform && <PlatformBadge platform={opp.platform} />}
                    <span className="text-xs text-text-muted">{formatRelativeDate(opp.created_at)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {assigneeName ? (
                    <div className="flex items-center gap-1.5">
                      <Avatar name={assigneeName} size="xs" />
                      <span className="text-xs text-text-secondary font-medium">{assigneeName}</span>
                    </div>
                  ) : (
                    <span className="text-xs text-text-muted">Unassigned</span>
                  )}
                  <Button
                    size="xs"
                    variant="ghost"
                    leftIcon={<UserPlus size={11} />}
                    onClick={() => { setAssignTarget(opp); setAssignee(opp.assigned_to ?? ''); }}
                  >
                    {assigneeName ? 'Reassign' : 'Assign'}
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Assign modal */}
      <Modal
        isOpen={!!assignTarget}
        onClose={() => { setAssignTarget(null); setAssignee(''); }}
        title="Assign opportunity"
        size="xs"
      >
        <div className="space-y-4">
          <p className="text-sm text-text-secondary truncate">{assignTarget?.target_name ?? 'Prospect'}</p>
          <Select
            label="Assign to"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            options={[
              { value: '', label: 'Select member…' },
              ...(members ?? []).map((m) => ({ value: m.user_id, label: m.name ?? m.email })),
            ]}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setAssignTarget(null)}>Cancel</Button>
            <Button
              size="sm"
              disabled={!assignee}
              isLoading={assignMutation.isPending}
              onClick={() => assignTarget && assignMutation.mutate({ id: assignTarget.id, userId: assignee })}
            >
              Assign
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
