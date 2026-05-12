import React, { Component } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

// ── EmptyState ────────────────────────────────────────────────
interface EmptyStateProps {
  icon?:      React.ReactNode;
  headline:   string;
  subline?:   string;
  action?:    { label: string; onClick: () => void; variant?: 'primary' | 'secondary' };
  className?: string;
  compact?:   boolean;
}

export function EmptyState({ icon, headline, subline, action, className, compact }: EmptyStateProps) {
  return (
    <div className={cn(
      'flex flex-col items-center justify-center text-center',
      compact ? 'py-8 px-4' : 'min-h-[240px] py-12 px-6',
      className,
    )}>
      {icon && (
        <div className="mb-3 text-text-muted opacity-60 text-4xl">{icon}</div>
      )}
      <h3 className="text-sm font-semibold text-text-primary">{headline}</h3>
      {subline && <p className="mt-1.5 text-sm text-text-muted max-w-xs">{subline}</p>}
      {action && (
        <Button
          variant={action.variant ?? 'primary'}
          size="sm"
          className="mt-4"
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}

// ── ConfirmDialog ─────────────────────────────────────────────
interface ConfirmDialogProps {
  isOpen:        boolean;
  onClose:       () => void;
  onConfirm:     () => void;
  title:         string;
  message:       React.ReactNode;
  confirmLabel?: string;
  cancelLabel?:  string;
  variant?:      'danger' | 'warning' | 'primary';
  isLoading?:    boolean;
}

export function ConfirmDialog({
  isOpen, onClose, onConfirm, title, message,
  confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  variant = 'danger', isLoading,
}: ConfirmDialogProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm" persistent={isLoading}>
      <p className="text-sm text-text-secondary">{message}</p>
      <div className="flex justify-end gap-2 mt-6">
        <Button variant="secondary" size="sm" onClick={onClose} disabled={isLoading}>
          {cancelLabel}
        </Button>
        <Button
          variant={variant === 'danger' ? 'destructive' : 'primary'}
          size="sm"
          onClick={onConfirm}
          isLoading={isLoading}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

// ── ErrorBoundary ─────────────────────────────────────────────
interface ErrorBoundaryState { hasError: boolean; error: Error | null }

export class ErrorBoundary extends Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="flex flex-col items-center justify-center min-h-[300px] p-8 text-center">
          <div className="text-3xl mb-3">⚠️</div>
          <h3 className="font-semibold text-text-primary mb-1">Something went wrong</h3>
          <p className="text-sm text-text-muted mb-4">{this.state.error?.message}</p>
          <Button size="sm" onClick={() => this.setState({ hasError: false, error: null })}>
            Try again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── CopyButton ────────────────────────────────────────────────
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { copyToClipboard } from '@/lib/utils';
import { IconButton } from '@/components/ui/Button';

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    const ok = await copyToClipboard(text);
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };
  return (
    <IconButton label="Copy to clipboard" size="sm" onClick={handleCopy} className={className}>
      {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
    </IconButton>
  );
}

// ── Spinner ───────────────────────────────────────────────────
export function Spinner({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const s = size === 'sm' ? 14 : size === 'md' ? 18 : 24;
  return (
    <svg
      className={cn('animate-spin text-brand', className)}
      style={{ width: s, height: s }}
      fill="none" viewBox="0 0 24 24"
      aria-label="Loading"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

// ── PageLoader ────────────────────────────────────────────────
export function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Spinner size="lg" />
    </div>
  );
}

// ── InlineAlert ───────────────────────────────────────────────
interface InlineAlertProps {
  type:       'info' | 'warning' | 'error' | 'success';
  message:    React.ReactNode;
  className?: string;
  onDismiss?: () => void;
}

const ALERT_STYLES = {
  info:    'bg-brand-50 border-brand-200 text-brand-700',
  warning: 'bg-amber-50 border-amber-200 text-amber-700',
  error:   'bg-red-50 border-red-200 text-red-700',
  success: 'bg-emerald-50 border-emerald-200 text-emerald-700',
};

export function InlineAlert({ type, message, className, onDismiss }: InlineAlertProps) {
  return (
    <div className={cn(
      'flex items-start gap-2 px-3 py-2.5 rounded-md border text-sm',
      ALERT_STYLES[type], className,
    )}>
      <span className="flex-1">{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="shrink-0 opacity-60 hover:opacity-100">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

// ── needed import ─────────────────────────────────────────────
import { X } from 'lucide-react';
