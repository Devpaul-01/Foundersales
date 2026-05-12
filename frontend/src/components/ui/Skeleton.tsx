import React from 'react';
import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
  rounded?:   'none' | 'sm' | 'md' | 'lg' | 'full';
}

export function Skeleton({ className, rounded = 'md' }: SkeletonProps) {
  const roundedClass = {
    none: '',
    sm:   'rounded-sm',
    md:   'rounded',
    lg:   'rounded-lg',
    full: 'rounded-full',
  }[rounded];

  return (
    <div
      className={cn('skeleton', roundedClass, className)}
      aria-hidden="true"
    />
  );
}

// ── Preset skeletons ──────────────────────────────────────────
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn(
            'h-3.5',
            i === lines - 1 && lines > 1 ? 'w-3/4' : 'w-full',
          )}
        />
      ))}
    </div>
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('bg-white border border-surface-border rounded-lg p-4 space-y-3', className)}>
      <div className="flex items-center gap-3">
        <Skeleton className="w-8 h-8" rounded="full" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="h-5 w-14" rounded="full" />
      </div>
      <SkeletonText lines={2} />
      <div className="flex gap-2">
        <Skeleton className="h-7 w-20" rounded="md" />
        <Skeleton className="h-7 w-20" rounded="md" />
      </div>
    </div>
  );
}

export function SkeletonOpportunityCard() {
  return (
    <div className="bg-white border border-surface-border rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-16" rounded="full" />
          <Skeleton className="h-4 w-28" />
        </div>
        <Skeleton className="w-9 h-9" rounded="full" />
      </div>
      <SkeletonText lines={3} />
      <div className="flex items-center gap-2">
        <Skeleton className="h-1.5 flex-1" rounded="full" />
        <Skeleton className="h-1.5 flex-1" rounded="full" />
        <Skeleton className="h-1.5 flex-1" rounded="full" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-8 w-24" rounded="md" />
        <Skeleton className="h-8 w-24" rounded="md" />
      </div>
    </div>
  );
}

export function SkeletonPipelineCard() {
  return (
    <div className="bg-white border border-surface-border rounded-lg p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-4 w-8" rounded="full" />
      </div>
      <Skeleton className="h-3 w-20" />
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-12" />
      </div>
    </div>
  );
}

export function SkeletonStatCard() {
  return (
    <div className="bg-white border border-surface-border rounded-lg p-5 space-y-3">
      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="h-8 w-20" />
      <Skeleton className="h-3 w-16" />
    </div>
  );
}

export function SkeletonTableRow({ cols = 4 }: { cols?: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton className="h-4" style={{ width: `${60 + Math.random() * 40}%` }} />
        </td>
      ))}
    </tr>
  );
}

export function SkeletonPage() {
  return (
    <div className="px-4 py-6 md:px-6 lg:px-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-9 w-28" rounded="md" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => <SkeletonStatCard key={i} />)}
      </div>
      <div className="space-y-3">
        {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
      </div>
    </div>
  );
}
