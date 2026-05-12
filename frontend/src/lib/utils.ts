import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNow, isToday, isYesterday, parseISO, differenceInCalendarDays } from 'date-fns';

// ── Tailwind ──────────────────────────────────────────────────
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// ── String ────────────────────────────────────────────────────
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

export function getInitials(name: string | null | undefined): string {
  if (!name?.trim()) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50);
}

export function capitalize(text: string): string {
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function camelToWords(str: string): string {
  return str.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
}

export function snakeToWords(str: string): string {
  return str.split('_').map(capitalize).join(' ');
}

// ── Number ────────────────────────────────────────────────────
export function formatCurrency(
  amount: number | null | undefined,
  compact = false,
): string {
  if (amount == null) return '—';
  if (compact && amount >= 1_000) {
    return new Intl.NumberFormat('en-US', {
      style:              'currency',
      currency:           'USD',
      notation:           'compact',
      maximumFractionDigits: 1,
    }).format(amount);
  }
  return new Intl.NumberFormat('en-US', {
    style:              'currency',
    currency:           'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatRate(rate: number | null | undefined): string {
  if (rate == null) return '—';
  return `${Math.round(rate * 100)}%`;
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US').format(n);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getScoreColor(score: number, max = 100): string {
  const pct = (score / max) * 100;
  if (pct >= 70) return 'text-success';
  if (pct >= 40) return 'text-warning';
  return 'text-danger';
}

export function getScoreBg(score: number, max = 100): string {
  const pct = (score / max) * 100;
  if (pct >= 70) return 'bg-success';
  if (pct >= 40) return 'bg-warning';
  return 'bg-danger';
}

// ── Date ──────────────────────────────────────────────────────
export function formatRelativeDate(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  try {
    const date = parseISO(isoString);
    if (isToday(date))     return 'Today';
    if (isYesterday(date)) return 'Yesterday';
    return formatDistanceToNow(date, { addSuffix: true });
  } catch {
    return '—';
  }
}

export function formatEventDate(isoDate: string): string {
  try {
    return format(parseISO(isoDate), 'EEEE, MMMM d, yyyy');
  } catch {
    return isoDate;
  }
}

export function formatShortDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '—';
  try {
    return format(parseISO(isoDate), 'MMM d, yyyy');
  } catch {
    return isoDate;
  }
}

export function formatTime(time: string | null | undefined): string {
  if (!time) return '';
  try {
    // Handle "HH:MM" format
    const [h, m] = time.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0);
    return format(d, 'h:mm a');
  } catch {
    return time;
  }
}

export function formatDateTime(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  try {
    return format(parseISO(isoString), 'MMM d, yyyy h:mm a');
  } catch {
    return '—';
  }
}

export function getGreeting(name: string | null | undefined): string {
  const hour = new Date().getHours();
  const timeGreeting =
    hour < 12 ? 'Good morning' :
    hour < 17 ? 'Good afternoon' :
    'Good evening';
  const firstName = name?.split(' ')[0];
  return firstName ? `${timeGreeting}, ${firstName}` : timeGreeting;
}

export function daysUntil(isoDate: string | null | undefined): number | null {
  if (!isoDate) return null;
  try {
    return differenceInCalendarDays(parseISO(isoDate), new Date());
  } catch {
    return null;
  }
}

export function isOverdue(isoDate: string | null | undefined): boolean {
  if (!isoDate) return false;
  const days = daysUntil(isoDate);
  return days !== null && days < 0;
}

export function isDueSoon(isoDate: string | null | undefined, withinDays = 2): boolean {
  if (!isoDate) return false;
  const days = daysUntil(isoDate);
  return days !== null && days >= 0 && days <= withinDays;
}

// ── Clipboard ─────────────────────────────────────────────────
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Legacy fallback
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const success = document.execCommand('copy');
    document.body.removeChild(el);
    return success;
  }
}

// ── Array ─────────────────────────────────────────────────────
export function groupBy<T>(arr: T[], keyFn: (item: T) => string): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const key = keyFn(item);
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {} as Record<string, T[]>);
}

export function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

export function sortBy<T>(arr: T[], keyFn: (item: T) => number | string, dir: 'asc' | 'desc' = 'asc'): T[] {
  return [...arr].sort((a, b) => {
    const ka = keyFn(a);
    const kb = keyFn(b);
    if (ka < kb) return dir === 'asc' ? -1 : 1;
    if (ka > kb) return dir === 'asc' ? 1  : -1;
    return 0;
  });
}

// ── URL / External ────────────────────────────────────────────
export function openExternalUrl(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

// ── Color ─────────────────────────────────────────────────────
const AVATAR_PALETTE = [
  '#2563eb', '#7c3aed', '#db2777', '#dc2626',
  '#d97706', '#059669', '#0891b2', '#4f46e5',
];

export function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

// ── Misc ──────────────────────────────────────────────────────
export function safeJsonParse<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export function isMobileViewport(): boolean {
  return window.innerWidth < 768;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Generate a quick UUID for client-only temp IDs */
export function generateId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

/** Haptic feedback (mobile) */
export const haptic = {
  light:   () => navigator.vibrate?.(10),
  medium:  () => navigator.vibrate?.(25),
  success: () => navigator.vibrate?.([10, 30, 10]),
  error:   () => navigator.vibrate?.([50, 20, 50]),
};
