// ============================================================
// FILE: src/pages/calendar/CalendarPage.tsx — DEMO/STATIC BUILD
//
// NOTE: This is a frontend-only demo build for screenshots.
// All data is hardcoded locally. There are NO network calls,
// no react-query, no mutations, and no loading/skeleton states.
// Design and interactive behavior (search/filter, date paging,
// modal, keyboard shortcuts) are preserved and operate entirely
// on the local, in-memory dataset below.
// ============================================================
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { format, addDays, subDays, parseISO } from 'date-fns';
import {
  Calendar, Plus, ChevronLeft, ChevronRight,
  AlertTriangle, CheckSquare, Search as SearchIcon,
} from 'lucide-react';

// ── Local UI primitives (kept structurally identical to design-system usage) ──
function cn(...args: Array<string | false | null | undefined>) {
  return args.filter(Boolean).join(' ');
}

function Badge({ children, variant = 'gray', size = 'sm' }: { children: React.ReactNode; variant?: 'gray' | 'green' | 'red'; size?: 'xs' | 'sm' }) {
  const variants: Record<string, string> = {
    gray: 'bg-slate-100 text-slate-600',
    green: 'bg-emerald-50 text-emerald-700',
    red: 'bg-red-50 text-red-700',
  };
  const sizes: Record<string, string> = { xs: 'text-[11px] px-1.5 py-0.5', sm: 'text-xs px-2 py-0.5' };
  return (
    <span className={cn('inline-flex items-center rounded-full font-medium', variants[variant], sizes[size])}>
      {children}
    </span>
  );
}

function Button({
  children, variant = 'primary', size = 'sm', leftIcon, className, onClick, type = 'button',
}: {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'xs' | 'sm';
  leftIcon?: React.ReactNode;
  className?: string;
  onClick?: () => void;
  type?: 'button' | 'submit';
}) {
  const variants: Record<string, string> = {
    primary: 'bg-slate-900 text-white hover:bg-slate-800',
    secondary: 'bg-slate-100 text-slate-700 hover:bg-slate-200',
    outline: 'border border-slate-300 text-slate-700 hover:bg-slate-50',
    ghost: 'text-slate-600 hover:bg-slate-100',
  };
  const sizes: Record<string, string> = { xs: 'text-xs px-2 py-1', sm: 'text-sm px-3 py-1.5' };
  return (
    <button
      type={type}
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2',
        variants[variant], sizes[size], className,
      )}
    >
      {leftIcon}
      {children}
    </button>
  );
}

function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { className?: string }) {
  return (
    <input
      {...props}
      className={cn(
        'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900',
        'placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-300',
        className,
      )}
    />
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void; options: { value: string; label: string }[] }) {
  return (
    <select
      value={value}
      onChange={onChange}
      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Modal({ isOpen, onClose, title, size = 'md', children }: { isOpen: boolean; onClose: () => void; title: string; size?: 'md'; children: React.ReactNode }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Static demo data & constants ─────────────────────────────────────────
type EventType = 'discovery' | 'demo' | 'follow_up' | 'negotiation' | 'internal';
type Outcome = 'strong_interest' | 'moving_forward' | 'neutral' | 'stalled' | 'lost';

const EVENT_TYPE_LABELS: Record<EventType, string> = {
  discovery: 'Discovery call',
  demo: 'Product demo',
  follow_up: 'Follow-up',
  negotiation: 'Negotiation',
  internal: 'Internal',
};

const MEETING_OUTCOME_LABELS: Record<Outcome, string> = {
  strong_interest: 'Strong interest',
  moving_forward: 'Moving forward',
  neutral: 'Neutral',
  stalled: 'Stalled',
  lost: 'Lost',
};

const MEETING_OUTCOME_COLORS: Record<Outcome, string> = {
  strong_interest: '#059669',
  moving_forward: '#2563eb',
  neutral: '#64748b',
  stalled: '#d97706',
  lost: '#dc2626',
};

function formatShortDate(iso: string) {
  return format(parseISO(iso), 'MMM d');
}
function formatTime(iso: string) {
  return format(parseISO(iso), 'h:mm a');
}

interface CalendarEvent {
  id: string;
  title: string;
  event_type: EventType;
  event_date: string; // yyyy-MM-dd
  start_time?: string; // full ISO
  end_time?: string;
  attendee_name?: string;
  prep_generated: boolean;
  prep_failed?: boolean;
  debrief_needed?: boolean;
  outcome?: Outcome;
  health_score?: number;
}

const today = new Date();
const iso = (d: Date) => format(d, 'yyyy-MM-dd');
const isoTime = (d: Date, h: number, m: number) => {
  const dt = new Date(d);
  dt.setHours(h, m, 0, 0);
  return dt.toISOString();
};

const DEMO_EVENTS: CalendarEvent[] = [
  {
    id: 'evt-1001',
    title: 'Intro call — Northwind Logistics',
    event_type: 'discovery',
    event_date: iso(subDays(today, 6)),
    start_time: isoTime(subDays(today, 6), 10, 0),
    end_time: isoTime(subDays(today, 6), 10, 30),
    attendee_name: 'Priya Anand',
    prep_generated: true,
    debrief_needed: false,
    outcome: 'moving_forward',
    health_score: 78,
  },
  {
    id: 'evt-1002',
    title: 'Product walkthrough — Solace Health',
    event_type: 'demo',
    event_date: iso(subDays(today, 4)),
    start_time: isoTime(subDays(today, 4), 14, 0),
    end_time: isoTime(subDays(today, 4), 14, 45),
    attendee_name: 'Marcus Delgado',
    prep_generated: true,
    debrief_needed: true,
    outcome: 'strong_interest',
    health_score: 91,
  },
  {
    id: 'evt-1003',
    title: 'Pricing follow-up — Kestrel Robotics',
    event_type: 'follow_up',
    event_date: iso(subDays(today, 2)),
    start_time: isoTime(subDays(today, 2), 9, 30),
    end_time: isoTime(subDays(today, 2), 9, 50),
    attendee_name: 'Lena Ortiz',
    prep_generated: true,
    debrief_needed: true,
    outcome: 'neutral',
    health_score: 52,
  },
  {
    id: 'evt-1004',
    title: 'Weekly pipeline sync',
    event_type: 'internal',
    event_date: iso(subDays(today, 1)),
    start_time: isoTime(subDays(today, 1), 16, 0),
    end_time: isoTime(subDays(today, 1), 16, 30),
    prep_generated: true,
    debrief_needed: false,
  },
  {
    id: 'evt-1005',
    title: 'Discovery — Bramwell & Ives Legal',
    event_type: 'discovery',
    event_date: iso(today),
    start_time: isoTime(today, 11, 0),
    end_time: isoTime(today, 11, 30),
    attendee_name: 'Sophie Bramwell',
    prep_generated: true,
    debrief_needed: false,
    health_score: 64,
  },
  {
    id: 'evt-1006',
    title: 'Renewal check-in — Atlas Freight Co.',
    event_type: 'follow_up',
    event_date: iso(today),
    start_time: isoTime(today, 15, 15),
    end_time: isoTime(today, 15, 45),
    attendee_name: 'Dominic Farrow',
    prep_generated: false,
    prep_failed: false,
    debrief_needed: false,
  },
  {
    id: 'evt-1007',
    title: 'Contract negotiation — Solace Health',
    event_type: 'negotiation',
    event_date: iso(addDays(today, 1)),
    start_time: isoTime(addDays(today, 1), 13, 0),
    end_time: isoTime(addDays(today, 1), 13, 30),
    attendee_name: 'Marcus Delgado',
    prep_generated: true,
    debrief_needed: false,
    health_score: 88,
  },
  {
    id: 'evt-1008',
    title: 'Demo — Ferro & Stone Manufacturing',
    event_type: 'demo',
    event_date: iso(addDays(today, 2)),
    start_time: isoTime(addDays(today, 2), 10, 30),
    end_time: isoTime(addDays(today, 2), 11, 15),
    attendee_name: 'Grace Whitfield',
    prep_generated: true,
    debrief_needed: false,
    health_score: 70,
  },
  {
    id: 'evt-1009',
    title: 'Discovery call — Vantage Insurance Group',
    event_type: 'discovery',
    event_date: iso(addDays(today, 3)),
    start_time: isoTime(addDays(today, 3), 9, 0),
    end_time: isoTime(addDays(today, 3), 9, 30),
    attendee_name: 'Owen Castellano',
    prep_generated: false,
    prep_failed: true,
    debrief_needed: false,
  },
  {
    id: 'evt-1010',
    title: 'Founder sync — board prep',
    event_type: 'internal',
    event_date: iso(addDays(today, 5)),
    start_time: isoTime(addDays(today, 5), 8, 30),
    end_time: isoTime(addDays(today, 5), 9, 0),
    prep_generated: true,
    debrief_needed: false,
  },
  {
    id: 'evt-1011',
    title: 'Second demo — Kestrel Robotics',
    event_type: 'demo',
    event_date: iso(addDays(today, 8)),
    start_time: isoTime(addDays(today, 8), 14, 30),
    end_time: isoTime(addDays(today, 8), 15, 15),
    attendee_name: 'Lena Ortiz',
    prep_generated: true,
    debrief_needed: false,
    health_score: 60,
  },
  {
    id: 'evt-1012',
    title: 'Discovery — Meridian Analytics',
    event_type: 'discovery',
    event_date: iso(addDays(today, 11)),
    start_time: isoTime(addDays(today, 11), 11, 30),
    end_time: isoTime(addDays(today, 11), 12, 0),
    attendee_name: 'Tobias Reinholt',
    prep_generated: false,
    debrief_needed: false,
  },
  {
    id: 'evt-1013',
    title: 'Follow-up — Northwind Logistics',
    event_type: 'follow_up',
    event_date: iso(addDays(today, 14)),
    start_time: isoTime(addDays(today, 14), 10, 0),
    end_time: isoTime(addDays(today, 14), 10, 20),
    attendee_name: 'Priya Anand',
    prep_generated: false,
    debrief_needed: false,
  },
];

const TOTAL_EVENTS_ALL_TIME = 47;
const DEBRIEFS_NEEDED = DEMO_EVENTS.filter((e) => e.debrief_needed).length; // 2
const OVERDUE_COMMITMENTS = 3;

// ── Event card ────────────────────────────────────────────────────────────
function EventCard({ event, onOpen }: { event: CalendarEvent; onOpen: (id: string) => void }) {
  const isPast = new Date(event.event_date) < new Date(new Date().toDateString());

  const ariaLabel = [
    event.title,
    event.attendee_name ? `with ${event.attendee_name}` : null,
    formatShortDate(event.event_date),
    event.start_time ? formatTime(event.start_time) : null,
    event.prep_generated ? 'prep ready' : 'prep pending',
    event.debrief_needed ? 'debrief needed' : null,
  ].filter(Boolean).join(', ');

  return (
    <button
      type="button"
      onClick={() => onOpen(event.id)}
      aria-label={ariaLabel}
      className={cn(
        'w-full text-left bg-white border border-slate-200 rounded-lg p-4',
        'hover:shadow-md hover:border-slate-300 transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2',
        isPast && !event.debrief_needed && 'opacity-70',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-slate-900 truncate">{event.title}</p>
            {event.debrief_needed && (
              <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" aria-hidden="true" />
            )}
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge variant="gray" size="xs">{EVENT_TYPE_LABELS[event.event_type]}</Badge>
            {event.attendee_name && (
              <span className="text-xs text-slate-500">with {event.attendee_name}</span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-slate-500">{formatShortDate(event.event_date)}</p>
          {event.start_time && (
            <p className="text-xs text-slate-500">{formatTime(event.start_time)}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 mt-3">
        {event.prep_failed ? (
          <Badge variant="red" size="xs">Prep failed</Badge>
        ) : event.prep_generated ? (
          <Badge variant="green" size="xs">✓ Prep ready</Badge>
        ) : (
          <Badge variant="gray" size="xs">Preparing…</Badge>
        )}
        {event.outcome && (
          <span className="text-xs font-medium" style={{ color: MEETING_OUTCOME_COLORS[event.outcome] }}>
            {MEETING_OUTCOME_LABELS[event.outcome]}
          </span>
        )}
        {event.health_score != null && (
          <span className={cn(
            'text-xs font-mono ml-auto',
            event.health_score >= 70 ? 'text-emerald-600' : event.health_score >= 40 ? 'text-amber-600' : 'text-red-600',
          )}>
            ❤️ {event.health_score}
          </span>
        )}
      </div>
    </button>
  );
}

// ── Search bar (filters the static dataset locally) ──────────────────────
function CalendarSearchBar({ onResults, onClear }: { onResults: (events: CalendarEvent[]) => void; onClear: () => void }) {
  const [q, setQ] = useState('');
  const [eventType, setEventType] = useState('');
  const [outcome, setOutcome] = useState('');
  const isActive = !!q || !!eventType || !!outcome;

  useEffect(() => {
    if (!isActive) {
      onClear();
      return;
    }
    const filtered = DEMO_EVENTS.filter((e) => {
      const matchesQ = !q || e.title.toLowerCase().includes(q.toLowerCase()) || e.attendee_name?.toLowerCase().includes(q.toLowerCase());
      const matchesType = !eventType || e.event_type === eventType;
      const matchesOutcome = !outcome || e.outcome === outcome;
      return matchesQ && matchesType && matchesOutcome;
    });
    onResults(filtered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, eventType, outcome]);

  return (
    <div className="flex flex-wrap gap-2">
      <div className="relative flex-1 min-w-[180px]">
        <SearchIcon size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input id="calendar-search-input" placeholder="Search meetings…" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Select value={eventType} onChange={(e) => setEventType(e.target.value)} options={[{ value: '', label: 'All types' }, ...Object.entries(EVENT_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l }))]} />
      <Select value={outcome} onChange={(e) => setOutcome(e.target.value)} options={[{ value: '', label: 'All outcomes' }, ...Object.entries(MEETING_OUTCOME_LABELS).map(([v, l]) => ({ value: v, label: l }))]} />
    </div>
  );
}

// ── Create event modal (local state only, no submission side effects) ───
function CreateEventModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [eventDate, setEventDate] = useState(iso(today));
  const [eventType, setEventType] = useState<EventType>('discovery');
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('10:30');
  const [attendeeName, setAttendeeName] = useState('');
  const [attendeeContext, setAttendeeContext] = useState('');
  const [notes, setNotes] = useState('');
  const [createProspect, setCreateProspect] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onClose();
  };

  return (
    <Modal isOpen={open} onClose={onClose} title="New calendar event" size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Title</label>
          <Input placeholder="Meeting with Jane" required value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
            <Input type="date" required value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
            <Select value={eventType} onChange={(e) => setEventType(e.target.value as EventType)} options={Object.entries(EVENT_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l }))} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Start time</label>
            <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">End time</label>
            <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Attendee name</label>
          <Input placeholder="Jane Smith" value={attendeeName} onChange={(e) => setAttendeeName(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Attendee context</label>
          <textarea
            placeholder="Who they are, what they do — helps Foundersales prepare better…"
            rows={3}
            maxLength={2000}
            value={attendeeContext}
            onChange={(e) => setAttendeeContext(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Notes (optional)</label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={createProspect} onChange={(e) => setCreateProspect(e.target.checked)} />
          Add as a CRM prospect
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>Cancel</Button>
          <Button size="sm" type="submit">Create event</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Main page ─────────────────────────────────────────────────
export default function CalendarPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<CalendarEvent[] | null>(null);
  const [fromDate, setFromDate] = useState(() => format(subDays(today, 7), 'yyyy-MM-dd'));
  const [toDate, setToDate] = useState(() => format(addDays(today, 30), 'yyyy-MM-dd'));

  const goToToday = useCallback(() => {
    setFromDate(format(subDays(today, 7), 'yyyy-MM-dd'));
    setToDate(format(addDays(today, 30), 'yyyy-MM-dd'));
  }, []);

  const navigatePrev = () => {
    setFromDate((d) => format(subDays(parseISO(d), 14), 'yyyy-MM-dd'));
    setToDate((d) => format(subDays(parseISO(d), 14), 'yyyy-MM-dd'));
  };
  const navigateNext = () => {
    setFromDate((d) => format(addDays(parseISO(d), 14), 'yyyy-MM-dd'));
    setToDate((d) => format(addDays(parseISO(d), 14), 'yyyy-MM-dd'));
  };

  // Simple client-side "navigation" stub for the demo build — logs instead
  // of routing, since react-router is intentionally not wired up here.
  const openEvent = (eventIdArg: string) => {
    // eslint-disable-next-line no-console
    console.log(`Navigate to /calendar/${eventIdArg}`);
  };

  // Keyboard shortcuts preserved: n (new event), t (today), / (focus search)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
      if (e.key === 'n') setCreateOpen(true);
      else if (e.key === 't') goToToday();
      else if (e.key === '/') {
        e.preventDefault();
        document.getElementById('calendar-search-input')?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goToToday]);

  const eventsInRange = useMemo(() => {
    return DEMO_EVENTS
      .filter((e) => e.event_date >= fromDate && e.event_date <= toDate)
      .sort((a, b) => a.event_date.localeCompare(b.event_date) || (a.start_time ?? '').localeCompare(b.start_time ?? ''));
  }, [fromDate, toDate]);

  const events = searchResults ?? eventsInRange;
  const debriefCount = DEBRIEFS_NEEDED;
  const overdueCount = OVERDUE_COMMITMENTS;

  return (
    <div className="page-container space-y-5 max-w-3xl mx-auto p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold text-slate-900">Calendar</h1>
        <Button leftIcon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>Add event</Button>
      </div>

      <CalendarSearchBar onResults={setSearchResults} onClear={() => setSearchResults(null)} />

      {debriefCount > 0 && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <CheckSquare size={15} className="text-amber-600 shrink-0" />
          <p className="text-sm text-amber-700 flex-1">
            {debriefCount} meeting{debriefCount > 1 ? 's' : ''} need{debriefCount === 1 ? 's' : ''} a debrief.
          </p>
        </div>
      )}
      {overdueCount > 0 && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <AlertTriangle size={15} className="text-red-600 shrink-0" />
          <p className="text-sm text-red-700 flex-1">
            {overdueCount} overdue commitment{overdueCount > 1 ? 's' : ''}.
          </p>
          <Button variant="outline" size="xs" onClick={() => console.log('Navigate to /commitments')}>View</Button>
        </div>
      )}

      {!searchResults && (
        <div className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-4 py-2.5">
          <button onClick={navigatePrev} className="p-2.5 text-slate-500 hover:text-slate-900 transition-colors" aria-label="Previous period">
            <ChevronLeft size={16} />
          </button>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-slate-900">
              {format(parseISO(fromDate), 'MMM d')} – {format(parseISO(toDate), 'MMM d, yyyy')}
            </span>
            <button onClick={goToToday} className="text-xs font-medium text-slate-900 hover:underline">Today</button>
          </div>
          <button onClick={navigateNext} className="p-2.5 text-slate-500 hover:text-slate-900 transition-colors" aria-label="Next period">
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      {events.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-14 bg-white border border-slate-200 rounded-lg">
          <div className="text-slate-300 mb-3"><Calendar size={28} /></div>
          <p className="text-sm font-semibold text-slate-700">No results found</p>
          <p className="text-sm text-slate-500 mt-1">Try adjusting your search or filters.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {events.map((event) => <EventCard key={event.id} event={event} onOpen={openEvent} />)}
        </div>
      )}

      <p className="text-xs text-slate-400 text-center pt-2">
        {TOTAL_EVENTS_ALL_TIME} total events on your calendar
      </p>

      <CreateEventModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
