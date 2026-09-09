// ============================================================
// FILE: src/pages/pipeline/DealDetailPage.tsx
// DEMO BUILD — fully static, hardcoded data, zero network calls.
// Preserves original design + interactivity (modals) for screenshots.
// ============================================================
import React, { useState } from 'react';
import { ArrowLeft, DollarSign, Trash2 } from 'lucide-react';

// ------------------------------------------------------------
// Local constants / helpers (self-contained copies)
// ------------------------------------------------------------
const STAGE_LABELS: Record<string, string> = {
  contacted:    'Contacted',
  replied:      'Replied',
  call_demo:    'Call / Demo',
  closed_won:   'Closed Won',
  closed_lost:  'Closed Lost',
};

const STAGE_COLORS: Record<string, string> = {
  contacted:   '#64748b',
  replied:     '#2563eb',
  call_demo:   '#8b5cf6',
  closed_won:  '#10b981',
  closed_lost: '#ef4444',
};

function cn(...args: Array<string | false | null | undefined>) {
  return args.filter(Boolean).join(' ');
}

function formatCurrency(n: number) {
  return `$${n.toLocaleString()}`;
}

function formatRelativeDate(iso: string) {
  const then = new Date(iso).getTime();
  const now  = Date.now();
  const diffDays = Math.floor((now - then) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  const weeks = Math.floor(diffDays / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

// ------------------------------------------------------------
// Minimal local UI primitives
// ------------------------------------------------------------
function Button({
  children, onClick, size = 'md', variant = 'primary', isLoading, leftIcon, className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  size?: 'xs' | 'sm' | 'md';
  variant?: 'primary' | 'secondary' | 'destructive';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  className?: string;
}) {
  const sizeCls = size === 'xs' ? 'text-xs px-2 py-1' : size === 'sm' ? 'text-xs px-3 py-1.5' : 'text-sm px-4 py-2';
  const variantCls =
    variant === 'primary'   ? 'bg-brand text-white hover:bg-brand-600' :
    variant === 'secondary' ? 'bg-white border border-surface-border text-text-primary hover:bg-slate-50' :
                               'bg-danger text-white hover:bg-red-600';
  return (
    <button
      onClick={onClick}
      disabled={isLoading}
      className={cn('rounded-md font-medium transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-60', sizeCls, variantCls, className)}
    >
      {leftIcon}
      {isLoading ? 'Saving…' : children}
    </button>
  );
}

function Input({
  label, type = 'text', placeholder, value, onChange,
}: {
  label: string;
  type?: string;
  placeholder?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="block text-xs font-medium text-text-muted mb-1">{label}</span>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        className="w-full border border-surface-border rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/40"
      />
    </label>
  );
}

function Modal({
  isOpen, onClose, title, children, size = 'sm',
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md';
}) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className={cn('bg-white rounded-lg shadow-elevated w-full p-5', size === 'sm' ? 'max-w-sm' : 'max-w-lg')}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ConfirmDialog({
  isOpen, onClose, onConfirm, title, message, confirmLabel, isLoading,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel: string;
  isLoading?: boolean;
}) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-lg shadow-elevated w-full max-w-sm p-5">
        <h2 className="text-sm font-semibold text-text-primary mb-2">{title}</h2>
        <p className="text-sm text-text-secondary leading-relaxed mb-4">{message}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" size="sm" isLoading={isLoading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Hardcoded demo deal
// ------------------------------------------------------------
const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

const DEMO_DEAL = {
  id: 'd-301',
  target_name: 'Cascade Pet Supply',
  platform: 'Shopify',
  stage: 'call_demo',
  composite_score: 84,
  last_stage_changed_at: daysAgo(0),
  created_at: daysAgo(18),
  target_context:
    'Fast-growing pet supply brand doing roughly $150k/mo in GMV. Strong repeat-purchase rate but no formalized win-back or churn-reduction flow. Currently running Klaviyo for basic campaigns only — no lifecycle automation. Demo scheduled to walk through a churn-reduction sequence and abandoned-cart recovery.',
  feedback: [
    {
      scheduled_call_date: daysAgo(-2),
      deal_value_usd: 42_000,
    },
  ],
};

export default function DealDetailPage() {
  const [dealValueOpen,  setDealValueOpen]  = useState(false);
  const [dealValueInput, setDealValueInput] = useState(String(DEMO_DEAL.feedback[0].deal_value_usd));
  const [deleteOpen,     setDeleteOpen]     = useState(false);
  const [dealValue,      setDealValue]      = useState(DEMO_DEAL.feedback[0].deal_value_usd);

  const data = DEMO_DEAL;
  const stageColor = STAGE_COLORS[data.stage] ?? '#64748b';

  return (
    <div className="page-container max-w-2xl space-y-5">
      <button className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary">
        <ArrowLeft size={14} /> Pipeline
      </button>

      <div className="bg-white border border-surface-border rounded-lg p-5 space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">
            {data.target_name}
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <span
              className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full"
              style={{ backgroundColor: `${stageColor}18`, color: stageColor, border: `1px solid ${stageColor}40` }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: stageColor }} />
              {STAGE_LABELS[data.stage]}
            </span>
            <span className="text-xs text-text-muted">{data.platform}</span>
          </div>
        </div>

        <p className="text-sm text-text-secondary leading-relaxed">{data.target_context}</p>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-text-muted">Score</p>
            <p className="font-mono font-bold text-text-primary">{Math.round(data.composite_score)}/10</p>
          </div>
          <div>
            <p className="text-xs text-text-muted">Last activity</p>
            <p className="text-text-primary">{formatRelativeDate(data.last_stage_changed_at)}</p>
          </div>
          {data.feedback[0]?.scheduled_call_date && (
            <div className="col-span-2">
              <p className="text-xs text-text-muted">Scheduled call</p>
              <p className="text-text-primary">{formatRelativeDate(data.feedback[0].scheduled_call_date)}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-surface-border">
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<DollarSign size={14} />}
            onClick={() => { setDealValueInput(String(dealValue)); setDealValueOpen(true); }}
          >
            {dealValue ? formatCurrency(dealValue) : 'Set value'}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            leftIcon={<Trash2 size={14} />}
            onClick={() => setDeleteOpen(true)}
          >
            Remove deal
          </Button>
        </div>
      </div>

      {/* Deal value modal */}
      <Modal isOpen={dealValueOpen} onClose={() => setDealValueOpen(false)} title="Set deal value" size="sm">
        <Input
          label="Deal value (USD)"
          type="number"
          placeholder="0"
          value={dealValueInput}
          onChange={(e) => setDealValueInput(e.target.value)}
        />
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" size="sm" onClick={() => setDealValueOpen(false)}>Cancel</Button>
          <Button
            size="sm"
            onClick={() => {
              setDealValue(parseFloat(dealValueInput) || 0);
              setDealValueOpen(false);
            }}
          >
            Save
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => setDeleteOpen(false)}
        title="Remove deal"
        message="This will permanently remove the deal from your pipeline. This cannot be undone."
        confirmLabel="Remove deal"
      />
    </div>
  );
}
