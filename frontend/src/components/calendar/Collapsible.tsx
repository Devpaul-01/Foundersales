// frontend/src/components/calendar/Collapsible.tsx
import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CollapsibleProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function Collapsible({ title, defaultOpen = false, children }: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border border-surface-border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-3 py-2 text-left text-xs font-semibold text-text-primary bg-slate-50 hover:bg-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {title}
        <ChevronDown size={14} className={cn('transition-transform text-text-muted', open && 'rotate-180')} />
      </button>
      {open && <div className="p-3 space-y-2">{children}</div>}
    </div>
  );
}
