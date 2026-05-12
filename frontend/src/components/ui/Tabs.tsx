import React from 'react';
import { cn } from '@/lib/utils';

interface Tab {
  value:    string;
  label:    string;
  icon?:    React.ReactNode;
  badge?:   number;
  disabled?: boolean;
}

interface TabsProps {
  tabs:       Tab[];
  value:      string;
  onChange:   (value: string) => void;
  variant?:   'underline' | 'pill' | 'segment';
  className?: string;
  size?:      'sm' | 'md';
}

export function Tabs({
  tabs,
  value,
  onChange,
  variant   = 'underline',
  className,
  size      = 'md',
}: TabsProps) {
  if (variant === 'segment') {
    return (
      <div className={cn(
        'inline-flex items-center bg-surface-base border border-surface-border rounded-lg p-1 gap-0.5',
        className,
      )}>
        {tabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => !tab.disabled && onChange(tab.value)}
            disabled={tab.disabled}
            className={cn(
              'flex items-center gap-1.5 rounded-md font-medium transition-all duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
              'disabled:opacity-40 disabled:pointer-events-none',
              size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
              value === tab.value
                ? 'bg-white text-text-primary shadow-card'
                : 'text-text-muted hover:text-text-primary',
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className={cn(
                'inline-flex items-center justify-center rounded-full font-bold',
                size === 'sm' ? 'min-w-[14px] h-[14px] text-[9px] px-0.5' : 'min-w-[18px] h-[18px] text-[10px] px-1',
                value === tab.value ? 'bg-brand text-white' : 'bg-slate-200 text-text-secondary',
              )}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    );
  }

  if (variant === 'pill') {
    return (
      <div className={cn('flex items-center gap-1.5 flex-wrap', className)}>
        {tabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => !tab.disabled && onChange(tab.value)}
            disabled={tab.disabled}
            className={cn(
              'flex items-center gap-1.5 rounded-full font-medium transition-all duration-150 border',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
              'disabled:opacity-40 disabled:pointer-events-none',
              size === 'sm' ? 'px-2.5 py-0.5 text-xs' : 'px-3 py-1 text-sm',
              value === tab.value
                ? 'bg-brand-50 text-brand border-brand-200'
                : 'bg-white text-text-secondary border-surface-border hover:border-slate-300 hover:text-text-primary',
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className={cn(
                'inline-flex items-center justify-center rounded-full font-bold min-w-[16px] h-[16px] text-[10px] px-0.5',
                value === tab.value ? 'bg-brand text-white' : 'bg-slate-200 text-text-secondary',
              )}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    );
  }

  // Underline (default)
  return (
    <div className={cn('flex items-end border-b border-surface-border overflow-x-auto scrollbar-hide', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => !tab.disabled && onChange(tab.value)}
          disabled={tab.disabled}
          className={cn(
            'flex items-center gap-1.5 font-medium whitespace-nowrap border-b-2 transition-all duration-150',
            'focus-visible:outline-none',
            'disabled:opacity-40 disabled:pointer-events-none',
            size === 'sm' ? 'px-3 pb-2 text-xs' : 'px-4 pb-3 text-sm',
            value === tab.value
              ? 'border-brand text-brand'
              : 'border-transparent text-text-muted hover:text-text-primary hover:border-slate-300',
          )}
        >
          {tab.icon}
          {tab.label}
          {tab.badge !== undefined && tab.badge > 0 && (
            <span className={cn(
              'inline-flex items-center justify-center rounded-full font-bold min-w-[16px] h-[16px] text-[10px] px-0.5',
              value === tab.value ? 'bg-brand text-white' : 'bg-slate-200 text-text-secondary',
            )}>
              {tab.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
