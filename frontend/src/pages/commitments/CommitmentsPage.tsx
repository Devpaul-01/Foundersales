// ============================================================
// FILE: src/pages/commitments/CommitmentsPage.tsx
//
// DEMO / SCREENSHOT BUILD
//  - All data is hardcoded locally — no API calls, no react-query,
//    no infinite scroll fetching, no loading states, no network requests.
//  - Status filter tabs and "mark done" flow work against local state.
//  - Preserves the original design and interaction behavior.
// ============================================================
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button }         from '@/components/ui/Button';
import { Badge }          from '@/components/ui/Badge';
import { Modal }          from '@/components/ui/Modal';
import { Textarea }       from '@/components/ui/Input';
import { EmptyState }     from '@/components/common/index';
import { COMMITMENT_STATUS_LABELS } from '@/lib/constants';
import { formatShortDate, cn } from '@/lib/utils';
import { CheckSquare, CheckCircle2, ChevronRight, AlertTriangle } from 'lucide-react';

// ── Local type (mirrors Commitment shape used by this page) ────
type CommitmentStatus = 'pending' | 'overdue' | 'done';

type Commitment = {
  id: string;
  commitment_text: string;
  owner: 'you' | 'them';
  status: CommitmentStatus;
  due_date: string | null;
  event_title: string | null;
  event_id: string | null;
  completion_note: string | null;
};

// ── Hardcoded demo data ──────────────────────────────────────
const today = new Date();
const shift = (days: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() + days);
  return d.toISOString();
};

const INITIAL_COMMITMENTS: Commitment[] = [
  {
    id: 'c_1',
    commitment_text: 'Send updated pricing sheet with the annual-plan discount included',
    owner: 'you',
    status: 'overdue',
    due_date: shift(-4),
    event_title: 'Call with Marisol Ferreira',
    event_id: 'evt_101',
    completion_note: null,
  },
  {
    id: 'c_2',
    commitment_text: 'Loop in the security team to answer the SOC 2 questionnaire',
    owner: 'them',
    status: 'overdue',
    due_date: shift(-2),
    event_title: 'Demo with Anna Kowalski',
    event_id: 'evt_102',
    completion_note: null,
  },
  {
    id: 'c_3',
    commitment_text: 'Share the Loom walkthrough of the onboarding flow',
    owner: 'you',
    status: 'pending',
    due_date: shift(1),
    event_title: 'Discovery call with Marisol Ferreira',
    event_id: 'evt_101',
    completion_note: null,
  },
  {
    id: 'c_4',
    commitment_text: 'Get sign-off from finance on the multi-year contract terms',
    owner: 'them',
    status: 'pending',
    due_date: shift(3),
    event_title: 'Contract review with Sophie Lindqvist',
    event_id: 'evt_103',
    completion_note: null,
  },
  {
    id: 'c_5',
    commitment_text: 'Introduce the account exec to the VP of Sales for a joint call',
    owner: 'you',
    status: 'pending',
    due_date: shift(5),
    event_title: 'Intro call with Grant Whitfield',
    event_id: 'evt_104',
    completion_note: null,
  },
  {
    id: 'c_6',
    commitment_text: 'Confirm seat count for the Q4 rollout before renewal',
    owner: 'them',
    status: 'pending',
    due_date: shift(7),
    event_title: 'Renewal check-in with Devon Park',
    event_id: 'evt_105',
    completion_note: null,
  },
  {
    id: 'c_7',
    commitment_text: 'Send the recap deck from yesterday\'s product walkthrough',
    owner: 'you',
    status: 'done',
    due_date: shift(-6),
    event_title: 'Demo with Anna Kowalski',
    event_id: 'evt_102',
    completion_note: 'Sent Tuesday morning along with the pricing tiers doc.',
  },
  {
    id: 'c_8',
    commitment_text: 'Set up a shared Slack channel for the pilot rollout',
    owner: 'you',
    status: 'done',
    due_date: shift(-9),
    event_title: 'Kickoff with Priya Nadarajah',
    event_id: 'evt_106',
    completion_note: null,
  },
  {
    id: 'c_9',
    commitment_text: 'Provide two customer references in a similar industry',
    owner: 'them',
    status: 'done',
    due_date: shift(-12),
    event_title: 'Proposal review with Devon Park',
    event_id: 'evt_105',
    completion_note: 'Received references from two mid-market fintech customers.',
  },
  {
    id: 'c_10',
    commitment_text: 'Draft the mutual close plan with target signature date',
    owner: 'you',
    status: 'pending',
    due_date: shift(2),
    event_title: 'Contract review with Sophie Lindqvist',
    event_id: 'evt_103',
    completion_note: null,
  },
  {
    id: 'c_11',
    commitment_text: 'Follow up on whether legal needs a redlined MSA or can work from the standard template',
    owner: 'them',
    status: 'overdue',
    due_date: shift(-1),
    event_title: 'Contract review with Sophie Lindqvist',
    event_id: 'evt_103',
    completion_note: null,
  },
  {
    id: 'c_12',
    commitment_text: 'Check in on budget approval status with the finance stakeholder',
    owner: 'them',
    status: 'pending',
    due_date: shift(6),
    event_title: 'Check-in with Malik Osei',
    event_id: 'evt_107',
    completion_note: null,
  },
];

const STATUS_TABS = [
  { value: '',        label: 'All'     },
  { value: 'overdue', label: 'Overdue' },
  { value: 'pending', label: 'Pending' },
  { value: 'done',    label: 'Done'    },
];

function CommitmentRow({
  item,
  onDone,
}: {
  item:   Commitment;
  onDone: (id: string, note?: string) => void;
}) {
  const navigate  = useNavigate();
  const [noteOpen, setNoteOpen] = useState(false);
  const [note,     setNote]     = useState('');
  const isOverdue = item.status === 'overdue';
  const isDone    = item.status === 'done';

  return (
    <>
      <div className={cn(
        'flex items-start gap-3 px-4 py-3 border-b border-surface-border last:border-0',
        isOverdue && 'bg-red-50/30',
      )}>
        {/* Status icon */}
        <button
          onClick={() => !isDone && setNoteOpen(true)}
          className={cn(
            'mt-0.5 shrink-0 transition-colors',
            isDone    ? 'text-success cursor-default' :
            isOverdue ? 'text-danger hover:text-danger/80' :
            'text-text-muted hover:text-brand',
          )}
        >
          <CheckCircle2 size={16} />
        </button>

        <div className="flex-1 min-w-0">
          <p className={cn(
            'text-sm text-text-primary',
            isDone && 'line-through text-text-muted',
          )}>
            {item.commitment_text}
          </p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-xs text-text-muted capitalize">{item.owner}'s action</span>
            {item.due_date && (
              <span className={cn(
                'text-xs flex items-center gap-0.5',
                isOverdue ? 'text-danger' : 'text-text-muted',
              )}>
                {isOverdue && <AlertTriangle size={10} />}
                {isOverdue ? 'Overdue' : `Due ${formatShortDate(item.due_date)}`}
              </span>
            )}
            {item.event_title && (
              <button
                onClick={() => item.event_id && navigate(`/calendar/${item.event_id}`)}
                className="text-xs text-brand hover:underline truncate"
              >
                {item.event_title}
              </button>
            )}
          </div>
          {item.completion_note && (
            <p className="text-xs text-text-muted italic mt-1">"{item.completion_note}"</p>
          )}
        </div>

        <div className="shrink-0">
          <Badge
            variant={
              isDone    ? 'green' :
              isOverdue ? 'red'   : 'gray'
            }
            size="xs"
          >
            {COMMITMENT_STATUS_LABELS[item.status]}
          </Badge>
        </div>
      </div>

      <Modal isOpen={noteOpen} onClose={() => setNoteOpen(false)} title="Mark as done" size="sm">
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">{item.commitment_text}</p>
          <Textarea
            label="Completion note (optional)"
            placeholder="What happened? Any follow-up needed?"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={500}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setNoteOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              leftIcon={<CheckCircle2 size={12} />}
              onClick={() => { onDone(item.id, note || undefined); setNoteOpen(false); }}
            >
              Mark done
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export default function CommitmentsPage() {
  const [commitments, setCommitments] = useState<Commitment[]>(INITIAL_COMMITMENTS);
  const [statusFilter, setStatusFilter] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2200);
  };

  const handleDone = (id: string, note?: string) => {
    setCommitments((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: 'done', completion_note: note ?? c.completion_note } : c)),
    );
    showToast('Commitment marked done!', 'success');
  };

  const counts = useMemo(() => ({
    overdue: commitments.filter((c) => c.status === 'overdue').length,
    pending: commitments.filter((c) => c.status === 'pending').length,
    done:    commitments.filter((c) => c.status === 'done').length,
  }), [commitments]);

  const filteredItems = useMemo(
    () => (statusFilter ? commitments.filter((c) => c.status === statusFilter) : commitments),
    [commitments, statusFilter],
  );

  return (
    <div className="page-container space-y-5">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold text-text-primary">Commitments</h1>
        {counts.overdue > 0 && (
          <Badge variant="red" size="sm">{counts.overdue} overdue</Badge>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Overdue', count: counts.overdue, color: 'text-danger'  },
          { label: 'Pending', count: counts.pending, color: 'text-warning' },
          { label: 'Done',    count: counts.done,    color: 'text-success' },
        ].map((s) => (
          <div key={s.label} className="bg-white border border-surface-border rounded-lg p-3 text-center">
            <p className={cn('text-2xl font-bold', s.color)}>{s.count}</p>
            <p className="text-xs text-text-muted mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setStatusFilter(t.value)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors',
              statusFilter === t.value
                ? 'bg-brand text-white'
                : 'text-text-muted hover:bg-surface-hover',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
        {filteredItems.length === 0 ? (
          <EmptyState
            icon={<CheckSquare size={28} />}
            headline="No commitments"
            subline="Commitments are extracted automatically from meeting debriefs."
          />
        ) : (
          <>
            {filteredItems.map((item) => (
              <CommitmentRow
                key={item.id}
                item={item}
                onDone={handleDone}
              />
            ))}
          </>
        )}
      </div>

      {/* Lightweight local toast, replaces useToast hook for this offline demo */}
      {toast && (
        <div
          className={cn(
            'fixed bottom-5 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm font-medium shadow-lg z-50',
            toast.type === 'success' && 'bg-success text-white',
            toast.type === 'error'   && 'bg-danger text-white',
          )}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
