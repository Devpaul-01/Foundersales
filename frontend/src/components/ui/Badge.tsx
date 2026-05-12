import React from 'react';
import { cn } from '@/lib/utils';

type BadgeVariant = 'blue' | 'green' | 'amber' | 'red' | 'gray' | 'purple' | 'indigo' | 'sky';
type BadgeSize    = 'xs' | 'sm' | 'md';

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  blue:   'bg-brand-50 text-brand-700 border-brand-200',
  green:  'bg-emerald-50 text-emerald-700 border-emerald-200',
  amber:  'bg-amber-50 text-amber-700 border-amber-200',
  red:    'bg-red-50 text-red-700 border-red-200',
  gray:   'bg-slate-100 text-slate-600 border-slate-200',
  purple: 'bg-purple-50 text-purple-700 border-purple-200',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  sky:    'bg-sky-50 text-sky-700 border-sky-200',
};

const SIZE_CLASSES: Record<BadgeSize, string> = {
  xs: 'px-1.5 py-0.5 text-[10px] leading-none',
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-xs',
};

interface BadgeProps {
  variant?:  BadgeVariant;
  size?:     BadgeSize;
  dot?:      boolean;
  icon?:     React.ReactNode;
  children:  React.ReactNode;
  className?: string;
  onClick?:  () => void;
}

export function Badge({
  variant   = 'gray',
  size      = 'sm',
  dot,
  icon,
  children,
  className,
  onClick,
}: BadgeProps) {
  return (
    <span
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-medium border',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        onClick && 'cursor-pointer',
        className,
      )}
    >
      {dot && (
        <span className={cn(
          'w-1.5 h-1.5 rounded-full shrink-0',
          variant === 'blue'   && 'bg-brand',
          variant === 'green'  && 'bg-emerald-500',
          variant === 'amber'  && 'bg-amber-500',
          variant === 'red'    && 'bg-red-500',
          variant === 'gray'   && 'bg-slate-400',
          variant === 'purple' && 'bg-purple-500',
          variant === 'indigo' && 'bg-indigo-500',
          variant === 'sky'    && 'bg-sky-500',
        )} />
      )}
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </span>
  );
}

/** Score badge — numeric score with color based on value */
interface ScoreBadgeProps {
  score:     number;
  max?:      number;
  suffix?:   string;
  size?:     BadgeSize;
  className?: string;
}

export function ScoreBadge({ score, max = 100, suffix, size = 'sm', className }: ScoreBadgeProps) {
  const pct = (score / max) * 100;
  const variant: BadgeVariant =
    pct >= 70 ? 'green' : pct >= 40 ? 'amber' : 'red';

  return (
    <Badge variant={variant} size={size} className={cn('font-mono', className)}>
      {Math.round(score)}{suffix}
    </Badge>
  );
}

/** Platform badge */
export function PlatformBadge({ platform, size = 'sm' }: { platform: string; size?: BadgeSize }) {
  const PLATFORM_VARIANTS: Record<string, BadgeVariant> = {
    reddit:       'amber',
    linkedin:     'blue',
    twitter:      'sky',
    facebook:     'blue',
    instagram:    'purple',
    producthunt:  'amber',
    indiehackers: 'indigo',
    hackernews:   'amber',
    quora:        'red',
    youtube:      'red',
    other:        'gray',
  };

  const PLATFORM_LABELS: Record<string, string> = {
    reddit: 'Reddit', linkedin: 'LinkedIn', twitter: 'X',
    facebook: 'Facebook', instagram: 'Instagram', producthunt: 'PH',
    indiehackers: 'IH', hackernews: 'HN', quora: 'Quora',
    youtube: 'YouTube', other: 'Other',
  };

  return (
    <Badge variant={PLATFORM_VARIANTS[platform] ?? 'gray'} size={size}>
      {PLATFORM_LABELS[platform] ?? platform}
    </Badge>
  );
}

/** Role badge */
export function RoleBadge({ role, size = 'sm' }: { role: string; size?: BadgeSize }) {
  const ROLE_VARIANTS: Record<string, BadgeVariant> = {
    owner:   'purple',
    admin:   'indigo',
    manager: 'blue',
    member:  'gray',
  };
  const ROLE_LABELS: Record<string, string> = {
    owner: 'Owner', admin: 'Admin', manager: 'Manager', member: 'Member',
  };

  return (
    <Badge variant={ROLE_VARIANTS[role] ?? 'gray'} size={size}>
      {ROLE_LABELS[role] ?? role}
    </Badge>
  );
}

/** Notification count bubble */
interface CountBubbleProps {
  count:     number;
  max?:      number;
  className?: string;
}

export function CountBubble({ count, max = 9, className }: CountBubbleProps) {
  if (count === 0) return null;
  return (
    <span className={cn(
      'inline-flex items-center justify-center min-w-[18px] h-[18px] px-1',
      'rounded-full bg-danger text-white text-[10px] font-bold leading-none',
      className,
    )}>
      {count > max ? `${max}+` : count}
    </span>
  );
}
