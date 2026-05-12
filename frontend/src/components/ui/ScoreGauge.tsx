import React from 'react';
import { cn } from '@/lib/utils';

type GaugeSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZE_MAP: Record<GaugeSize, { px: number; stroke: number; textSize: string; labelSize: string }> = {
  sm: { px: 56,  stroke: 5,  textSize: 'text-sm font-bold',   labelSize: 'text-[9px]' },
  md: { px: 80,  stroke: 6,  textSize: 'text-lg font-bold',   labelSize: 'text-[10px]' },
  lg: { px: 112, stroke: 8,  textSize: 'text-2xl font-bold',  labelSize: 'text-xs' },
  xl: { px: 144, stroke: 10, textSize: 'text-3xl font-bold',  labelSize: 'text-sm' },
};

interface ScoreGaugeProps {
  score:       number;          // 0–100
  max?:        number;
  size?:       GaugeSize;
  label?:      string;
  delta?:      number;          // +N or -N delta badge
  colorMode?:  'auto' | 'brand';
  className?:  string;
  children?:   React.ReactNode; // custom center content
}

export function ScoreGauge({
  score,
  max        = 100,
  size       = 'md',
  label,
  delta,
  colorMode  = 'auto',
  className,
  children,
}: ScoreGaugeProps) {
  const { px, stroke, textSize, labelSize } = SIZE_MAP[size];
  const pct         = Math.min(1, Math.max(0, score / max));
  const radius      = (px - stroke * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset      = circumference * (1 - pct);
  const cx          = px / 2;
  const cy          = px / 2;

  // Color determination
  const percentage = pct * 100;
  let strokeColor: string;
  if (colorMode === 'brand') {
    strokeColor = '#2563eb';
  } else {
    strokeColor =
      percentage >= 70 ? '#10b981' :
      percentage >= 40 ? '#f59e0b' :
      '#ef4444';
  }

  const textColor =
    colorMode === 'brand' ? 'text-brand' :
    percentage >= 70 ? 'text-success' :
    percentage >= 40 ? 'text-warning' :
    'text-danger';

  return (
    <div className={cn('flex flex-col items-center gap-1', className)}>
      <div className="relative inline-flex items-center justify-center" style={{ width: px, height: px }}>
        <svg
          width={px}
          height={px}
          viewBox={`0 0 ${px} ${px}`}
          className="-rotate-90"
          aria-hidden="true"
        >
          {/* Track */}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke="#e2e8f0"
            strokeWidth={stroke}
          />
          {/* Progress */}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={strokeColor}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)' }}
          />
        </svg>

        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {children ?? (
            <>
              <span className={cn(textSize, textColor, 'leading-none tabular-nums')}>
                {Math.round(score)}
              </span>
              {max !== 100 && (
                <span className={cn(labelSize, 'text-text-muted leading-none')}>/{max}</span>
              )}
            </>
          )}
        </div>

        {/* Delta badge */}
        {delta !== undefined && (
          <div className={cn(
            'absolute -top-1 -right-1 text-[9px] font-bold px-1 py-0.5 rounded-full',
            delta >= 0
              ? 'bg-success-light text-success-dark'
              : 'bg-danger-light text-danger-dark',
          )}>
            {delta >= 0 ? '+' : ''}{delta}
          </div>
        )}
      </div>

      {label && (
        <span className={cn(labelSize, 'text-text-muted font-medium')}>{label}</span>
      )}
    </div>
  );
}

// ── Mini bar gauge (horizontal) ───────────────────────────────
interface BarGaugeProps {
  value:      number;
  max?:       number;
  label?:     string;
  color?:     string;
  className?: string;
  showValue?: boolean;
}

export function BarGauge({
  value,
  max       = 100,
  label,
  color,
  className,
  showValue = false,
}: BarGaugeProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const barColor = color ?? (pct >= 70 ? '#10b981' : pct >= 40 ? '#f59e0b' : '#ef4444');

  return (
    <div className={cn('w-full', className)}>
      {(label || showValue) && (
        <div className="flex items-center justify-between mb-1">
          {label && <span className="text-xs text-text-secondary">{label}</span>}
          {showValue && (
            <span className="text-xs font-mono text-text-muted tabular-nums">
              {Math.round(value)}{max !== 100 ? `/${max}` : ''}
            </span>
          )}
        </div>
      )}
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{ width: `${pct}%`, backgroundColor: barColor }}
          role="progressbar"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={max}
        />
      </div>
    </div>
  );
}
