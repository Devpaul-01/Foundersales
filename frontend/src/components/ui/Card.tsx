import React from 'react';
import { cn } from '@/lib/utils';

type CardVariant = 'default' | 'elevated' | 'flat' | 'interactive' | 'bordered';

const VARIANT_CLASSES: Record<CardVariant, string> = {
  default:     'bg-white border border-surface-border shadow-card',
  elevated:    'bg-white border border-surface-border shadow-elevated',
  flat:        'bg-surface-base border border-surface-border',
  interactive: 'bg-white border border-surface-border shadow-card hover:shadow-card-md hover:border-slate-300 cursor-pointer transition-all duration-200',
  bordered:    'bg-white border-2 border-brand-200',
};

interface CardProps {
  variant?:   CardVariant;
  className?: string;
  children:   React.ReactNode;
  onClick?:   () => void;
  padding?:   'none' | 'sm' | 'md' | 'lg';
}

const PADDING_CLASSES = {
  none: '',
  sm:   'p-3',
  md:   'p-4',
  lg:   'p-6',
};

export function Card({
  variant  = 'default',
  className,
  children,
  onClick,
  padding  = 'none',
}: CardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-lg overflow-hidden',
        VARIANT_CLASSES[variant],
        PADDING_CLASSES[padding],
        className,
      )}
    >
      {children}
    </div>
  );
}

// ── Card sub-components ───────────────────────────────────────
interface CardHeaderProps {
  title?:     React.ReactNode;
  subtitle?:  string;
  action?:    React.ReactNode;
  className?: string;
  children?:  React.ReactNode;
}

export function CardHeader({ title, subtitle, action, className, children }: CardHeaderProps) {
  return (
    <div className={cn(
      'flex items-start justify-between gap-3 px-5 py-4 border-b border-surface-border',
      className,
    )}>
      {children ?? (
        <div className="min-w-0 flex-1">
          {typeof title === 'string'
            ? <h3 className="text-sm font-semibold text-text-primary truncate">{title}</h3>
            : title}
          {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
        </div>
      )}
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

interface CardBodyProps {
  className?: string;
  children:   React.ReactNode;
  noPadding?: boolean;
}

export function CardBody({ className, children, noPadding }: CardBodyProps) {
  return (
    <div className={cn(!noPadding && 'px-5 py-4', className)}>
      {children}
    </div>
  );
}

interface CardFooterProps {
  className?: string;
  children:   React.ReactNode;
  align?:     'left' | 'right' | 'between';
}

export function CardFooter({ className, children, align = 'right' }: CardFooterProps) {
  return (
    <div className={cn(
      'px-5 py-4 border-t border-surface-border bg-surface-base/50',
      align === 'right'   && 'flex justify-end gap-2',
      align === 'left'    && 'flex justify-start gap-2',
      align === 'between' && 'flex items-center justify-between gap-2',
      className,
    )}>
      {children}
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────
interface StatCardProps {
  label:      string;
  value:      React.ReactNode;
  sub?:       string;
  icon?:      React.ReactNode;
  trend?:     { value: number; label?: string };
  className?: string;
}

export function StatCard({ label, value, sub, icon, trend, className }: StatCardProps) {
  return (
    <Card variant="default" className={cn('p-5', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-text-muted uppercase tracking-wide">{label}</p>
          <div className="mt-1.5 text-2xl font-bold text-text-primary font-mono leading-none">
            {value}
          </div>
          {sub && <p className="mt-1 text-xs text-text-muted">{sub}</p>}
          {trend !== undefined && (
            <div className={cn(
              'flex items-center gap-1 mt-2 text-xs font-medium',
              trend.value >= 0 ? 'text-success' : 'text-danger',
            )}>
              <span>{trend.value >= 0 ? '↑' : '↓'}</span>
              <span>{Math.abs(trend.value)}{trend.label ?? '%'}</span>
            </div>
          )}
        </div>
        {icon && (
          <div className="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center text-brand shrink-0">
            {icon}
          </div>
        )}
      </div>
    </Card>
  );
}
