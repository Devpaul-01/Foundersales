import React, { useState } from 'react';
import { cn, getInitials, stringToColor } from '@/lib/utils';

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZE_CLASSES: Record<AvatarSize, string> = {
  xs: 'w-5 h-5 text-[9px]',
  sm: 'w-7 h-7 text-[11px]',
  md: 'w-9 h-9 text-xs',
  lg: 'w-11 h-11 text-sm',
  xl: 'w-14 h-14 text-base',
};

interface AvatarProps {
  name?:      string | null;
  src?:       string | null;
  size?:      AvatarSize;
  className?: string;
  online?:    boolean;
}

export function Avatar({ name, src, size = 'md', className, online }: AvatarProps) {
  const [imgError, setImgError] = useState(false);
  const initials  = getInitials(name);
  const bgColor   = stringToColor(name ?? 'user');
  const showImage = !!src && !imgError;

  return (
    <div className={cn('relative inline-flex shrink-0', className)}>
      <div
        className={cn(
          'rounded-full flex items-center justify-center font-semibold text-white',
          SIZE_CLASSES[size],
          !showImage && 'text-white',
        )}
        style={!showImage ? { backgroundColor: bgColor } : undefined}
      >
        {showImage ? (
          <img
            src={src}
            alt={name ?? 'User avatar'}
            onError={() => setImgError(true)}
            className="w-full h-full rounded-full object-cover"
          />
        ) : (
          <span className="select-none">{initials}</span>
        )}
      </div>
      {online !== undefined && (
        <span
          className={cn(
            'absolute bottom-0 right-0 block rounded-full ring-2 ring-white',
            size === 'xs' || size === 'sm' ? 'w-1.5 h-1.5' : 'w-2.5 h-2.5',
            online ? 'bg-success' : 'bg-slate-300',
          )}
        />
      )}
    </div>
  );
}

// ── Avatar Group (stacked) ────────────────────────────────────
interface AvatarGroupProps {
  users:      Array<{ name?: string | null; src?: string | null }>;
  max?:       number;
  size?:      AvatarSize;
  className?: string;
}

export function AvatarGroup({ users, max = 3, size = 'sm', className }: AvatarGroupProps) {
  const visible  = users.slice(0, max);
  const overflow = users.length - max;

  return (
    <div className={cn('flex -space-x-2', className)}>
      {visible.map((u, i) => (
        <Avatar
          key={i}
          name={u.name}
          src={u.src}
          size={size}
          className="ring-2 ring-white"
        />
      ))}
      {overflow > 0 && (
        <div
          className={cn(
            'rounded-full flex items-center justify-center',
            'bg-slate-200 text-text-secondary font-medium ring-2 ring-white',
            SIZE_CLASSES[size],
            'text-[10px]',
          )}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}
