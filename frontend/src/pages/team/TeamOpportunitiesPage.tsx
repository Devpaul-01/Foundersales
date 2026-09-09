// FILE: src/pages/team/TeamOpportunitiesPage.tsx
// DEMO BUILD — all data is hardcoded locally for screenshots. No network calls.
// The assign flow still works client-side (in-memory state only) so the
// interaction reads as real in a demo, but nothing is persisted or fetched.
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button }           from '@/components/ui/Button';
import { PlatformBadge } from '@/components/ui/Badge';
import { Avatar }           from '@/components/ui/Avatar';
import { Modal }            from '@/components/ui/Modal';
import { Select }           from '@/components/ui/Input';
import { formatRelativeDate, cn } from '@/lib/utils';
import { UserPlus } from 'lucide-react';
import type { Opportunity } from '@/api/types';

// ---------------------------------------------------------------------------
// Hardcoded demo data — realistic team roster + opportunities for screenshots.
// ---------------------------------------------------------------------------

type DemoMember = { user_id: string; name: string; email: string };

const MEMBERS: DemoMember[] = [
  { user_id: 'u-priya',  name: 'Priya Shah',    email: 'priya@brightlanehq.com' },
  { user_id: 'u-diego',  name: 'Diego Alvarez', email: 'diego@brightlanehq.com' },
  { user_id: 'u-tomasz', name: 'Tomasz Nowak',  email: 'tomasz@brightlanehq.com' },
  { user_id: 'u-han',    name: 'Han Kim',       email: 'han@brightlanehq.com' },
];

const now = new Date('2026-09-08T15:00:00Z');
const daysAgo = (n: number, h = 9) => {
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  d.setHours(h, 0, 0, 0);
  return d.toISOString();
};

type DemoOpp = Opportunity & { id: string; assigned_to: string | null; platform: string };

const INITIAL_OPPORTUNITIES: DemoOpp[] = [
  {
    id: 'opp-1001',
    target_name: 'Marcus Webb',
    platform: 'linkedin',
    assigned_to: 'u-priya',
    created_at: daysAgo(0, 10),
  } as DemoOpp,
  {
    id: 'opp-2001',
    target_name: 'Aisha Bello',
    platform: 'email',
    assigned_to: 'u-diego',
    created_at: daysAgo(1, 16),
  } as DemoOpp,
  {
    id: 'opp-3001',
    target_name: 'Victor Chan',
    platform: 'linkedin',
    assigned_to: 'u-priya',
    created_at: daysAgo(2, 9),
  } as DemoOpp,
  {
    id: 'opp-2002',
    target_name: 'Owen Sinclair',
    platform: 'linkedin',
    assigned_to: null,
    created_at: daysAgo(3, 11),
  } as DemoOpp,
  {
    id: 'opp-4001',
    target_name: 'Ben Okafor',
    platform: 'phone',
    assigned_to: 'u-tomasz',
    created_at: daysAgo(4, 13),
  } as DemoOpp,
  {
    id: 'opp-1003',
    target_name: 'Jonah Whitfield',
    platform: 'email',
    assigned_to: null,
    created_at: daysAgo(5, 9),
  } as DemoOpp,
  {
    id: 'opp-3002',
    target_name: 'Ingrid Larsen',
    platform: 'linkedin',
    assigned_to: 'u-diego',
    created_at: daysAgo(6, 14),
  } as DemoOpp,
  {
    id: 'opp-4002',
    target_name: 'Claire Dubois',
    platform: 'email',
    assigned_to: 'u-han',
    created_at: daysAgo(7, 9),
  } as DemoOpp,
  {
    id: 'opp-1004',
    target_name: 'Sara Lindqvist',
    platform: 'phone',
    assigned_to: null,
    created_at: daysAgo(8, 15),
  } as DemoOpp,
  {
    id: 'opp-5001',
    target_name: 'Renee Castillo',
    platform: 'linkedin',
    assigned_to: 'u-tomasz',
    created_at: daysAgo(9, 9),
  } as DemoOpp,
];

// ---------------------------------------------------------------------------

export default function TeamOpportunitiesPage() {
  const navigate = useNavigate();
  const [opportunities, setOpportunities] = useState<DemoOpp[]>(INITIAL_OPPORTUNITIES);
  const [assignTarget, setAssignTarget] = useState<DemoOpp | null>(null);
  const [assignee,     setAssignee]     = useState('');
  const [isAssigning,  setIsAssigning]  = useState(false);

  const memberNameById = React.useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of MEMBERS) map[m.user_id] = m.name;
    return map;
  }, []);

  const handleAssign = () => {
    if (!assignTarget || !assignee) return;
    setIsAssigning(true);
    // Simulate the local update an API call would otherwise trigger.
    setTimeout(() => {
      setOpportunities((prev) =>
        prev.map((o) => (o.id === assignTarget.id ? { ...o, assigned_to: assignee } : o)),
      );
      setIsAssigning(false);
      setAssignTarget(null);
      setAssignee('');
    }, 300);
  };

  return (
    <div className="page-container space-y-5">
      <h1 className="text-xl font-bold text-text-primary">Team opportunities</h1>

      <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
        {opportunities.map((opp) => {
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
        })}
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
              ...MEMBERS.map((m) => ({ value: m.user_id, label: m.name })),
            ]}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setAssignTarget(null)}>Cancel</Button>
            <Button
              size="sm"
              disabled={!assignee}
              isLoading={isAssigning}
              onClick={handleAssign}
            >
              Assign
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
