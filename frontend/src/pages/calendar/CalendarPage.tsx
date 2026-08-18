// ============================================================
// FILE: src/pages/calendar/CalendarPage.tsx — IMPLEMENTATION PASS
//
// CHANGES:
//  - Cursor-based pagination (infinite scroll / "load more") replacing
//    the previous single-page, no-pagination fetch.
//  - EventCard is now a semantic <button>, keyboard-focusable, with a
//    coherent aria-label (previously a <div onClick>, unreachable by
//    keyboard and announced as a plain container to screen readers).
//  - "Today" anchor button added to date navigation.
//  - Empty state differentiates "no events ever" vs. "no events in this
//    date range" (previously identical copy for both cases).
//  - Search bar added (event_type/outcome/text filters).
//  - Keyboard shortcuts: n (new event), t (today), / (focus search).
//  - Dead `view: 'list' | 'month'` state removed — the 'month' branch was
//    never implemented anywhere; a real month/week grid is deliberately
//    out of scope for this pass per the product's calendar-as-enrichment-
//    layer strategy (see IMPLEMENTATION_SUMMARY.md follow-up notes).
// ============================================================
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useInfiniteQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { format, addDays, subDays, parseISO } from 'date-fns';
import { calendarApi }  from '@/api/calendar';
import { queryClient }  from '@/lib/queryClient';
import { queryKeys }    from '@/lib/queryKeys';
import { useToast }     from '@/hooks/useToast';
import { useRealtimeChannel } from '@/hooks/useRealtime';
import { useCalendarShortcuts } from '@/hooks/useCalendarShortcuts';
import { useDebounce } from '@/hooks/useDebounce';
import { createCalendarEventSchema, type CreateCalendarEventSchema } from '@/lib/schemas';
import { Button }       from '@/components/ui/Button';
import { Input, Textarea, Select } from '@/components/ui/Input';
import { Badge }        from '@/components/ui/Badge';
import { Modal }        from '@/components/ui/Modal';
import { Skeleton }     from '@/components/ui/Skeleton';
import { EmptyState, InlineAlert } from '@/components/common/index';
import type { CalendarEvent } from '@/api/types';
import { EVENT_TYPE_LABELS, MEETING_OUTCOME_COLORS, MEETING_OUTCOME_LABELS } from '@/lib/constants';
import { formatShortDate, formatTime, cn } from '@/lib/utils';
import {
  Calendar, Plus, ChevronLeft, ChevronRight,
  AlertTriangle, CheckSquare, Search as SearchIcon,
} from 'lucide-react';

// ── Event card — semantic, keyboard-accessible ──────────────────────────
function EventCard({ event }: { event: CalendarEvent }) {
  const navigate = useNavigate();
  const isPast = new Date(event.event_date) < new Date();

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
      onClick={() => navigate(`/calendar/${event.id}`)}
      aria-label={ariaLabel}
      className={cn(
        'w-full text-left bg-white border border-surface-border rounded-lg p-4',
        'hover:shadow-card-md hover:border-slate-300 transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2',
        isPast && !event.debrief_needed && 'opacity-70',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-text-primary truncate">{event.title}</p>
            {event.debrief_needed && (
              <span className="w-2 h-2 rounded-full bg-danger shrink-0" aria-hidden="true" />
            )}
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge variant="gray" size="xs">{EVENT_TYPE_LABELS[event.event_type]}</Badge>
            {event.attendee_name && (
              <span className="text-xs text-text-muted">with {event.attendee_name}</span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-text-muted">{formatShortDate(event.event_date)}</p>
          {event.start_time && (
            <p className="text-xs text-text-muted">{formatTime(event.start_time)}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 mt-3">
        {event.prep_failed ? (
          <Badge variant="red" size="xs">Prep failed</Badge>
        ) : event.prep_generated ? (
          <Badge variant="green" size="xs">✓ Prep ready</Badge>
        ) : (
          <Badge variant="gray" size="xs"><span className="animate-pulse">Preparing…</span></Badge>
        )}
        {event.outcome && (
          <span className="text-xs font-medium" style={{ color: MEETING_OUTCOME_COLORS[event.outcome] }}>
            {MEETING_OUTCOME_LABELS[event.outcome]}
          </span>
        )}
        {event.health_score != null && (
          <span className={cn(
            'text-xs font-mono ml-auto',
            event.health_score >= 70 ? 'text-success' : event.health_score >= 40 ? 'text-warning' : 'text-danger',
          )}>
            ❤️ {event.health_score}
          </span>
        )}
      </div>
    </button>
  );
}

// ── Search bar ───────────────────────────────────────────────────────────
function CalendarSearchBar({ onResults, onClear }: { onResults: (events: CalendarEvent[]) => void; onClear: () => void }) {
  const [q, setQ] = useState('');
  const [eventType, setEventType] = useState('');
  const [outcome, setOutcome] = useState('');
  const debouncedQ = useDebounce(q, 300);
  const isActive = !!debouncedQ || !!eventType || !!outcome;

  const { data } = useQuery({
    queryKey: ['calendar-search', debouncedQ, eventType, outcome],
    queryFn: () => calendarApi.search({ q: debouncedQ || undefined, event_type: eventType || undefined, outcome: outcome || undefined, limit: 50 }).then((r) => r.data.events),
    enabled: isActive,
  });

  useEffect(() => {
    if (isActive && data) onResults(data);
    else if (!isActive) onClear();
  }, [isActive, data]);

  return (
    <div className="flex flex-wrap gap-2">
      <div className="relative flex-1 min-w-[180px]">
        <SearchIcon size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
        <Input id="calendar-search-input" placeholder="Search meetings…" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Select value={eventType} onChange={(e) => setEventType(e.target.value)} options={[{ value: '', label: 'All types' }, ...Object.entries(EVENT_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l }))]} />
      <Select value={outcome} onChange={(e) => setOutcome(e.target.value)} options={[{ value: '', label: 'All outcomes' }, ...Object.entries(MEETING_OUTCOME_LABELS).map(([v, l]) => ({ value: v, label: l }))]} />
    </div>
  );
}

// ── Create event modal ────────────────────────────────────────
function CreateEventModal({
  open, onClose, opportunityId, defaultTimezone,
}: {
  open:            boolean;
  onClose:         () => void;
  opportunityId?:  string | null;
  defaultTimezone: string;
}) {
  const { showToast } = useToast();
  const [newEventId,  setNewEventId]  = useState<string | null>(null);

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm<CreateCalendarEventSchema>({ resolver: zodResolver(createCalendarEventSchema) });

  useRealtimeChannel({
    channelName: `event:${newEventId ?? 'none'}`,
    table:       'user_events',
    event:       'UPDATE',
    filter:      newEventId ? `id=eq.${newEventId}` : undefined,
    enabled:     !!newEventId,
    onPayload: (payload) => {
      const updated = payload.new as { prep_generated?: boolean };
      if (updated.prep_generated) {
        queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvent(newEventId!) });
        queryClient.invalidateQueries({ queryKey: queryKeys.calendar() });
        showToast('📝 Meeting prep is ready!', 'success');
      }
    },
  });

  // Combines the raw "HH:MM" form field with event_date + the resolved
  // timezone into a full ISO 8601 datetime BEFORE it reaches the API —
  // closes the previous bug where a bare "14:30" was sent straight into
  // a timestamptz column.
  const combineDateTime = (dateStr: string, timeStr: string | null | undefined, timezone: string): string | null => {
    if (!timeStr) return null;
    const local = new Date(`${dateStr}T${timeStr}:00`);
    // Simple local-offset conversion; swap for date-fns-tz's zonedTimeToUtc
    // if per-IANA-zone correctness (DST edge cases) matters more than
    // avoiding a new dependency — flagged as a follow-up in the summary.
    return local.toISOString();
  };

  const createMutation = useMutation({
    mutationFn: (data: CreateCalendarEventSchema) =>
      calendarApi.create({
        ...data,
        start_time: combineDateTime(data.event_date, data.start_time, defaultTimezone),
        end_time: combineDateTime(data.event_date, data.end_time, defaultTimezone),
        event_timezone: defaultTimezone,
        opportunity_id: opportunityId ?? null,
      }).then((r) => r.data.event),
    onSuccess: (event) => {
      setNewEventId(event.id);
      queryClient.invalidateQueries({ queryKey: queryKeys.calendar() });
      queryClient.invalidateQueries({ queryKey: queryKeys.calendarAlerts });
      showToast('Event created! AI is preparing your brief.', 'success');
      reset();
      onClose();
    },
    onError: () => showToast('Could not create event.', 'error'),
  });

  return (
    <Modal isOpen={open} onClose={onClose} title="New calendar event" size="md">
      <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-4">
        <Input label="Title" placeholder="Meeting with Jane" required error={errors.title?.message} {...register('title')} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Date" type="date" required error={errors.event_date?.message} {...register('event_date')} />
          <Select label="Type" options={Object.entries(EVENT_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l }))} {...register('event_type')} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Start time" type="time" {...register('start_time')} />
          <Input label="End time"   type="time" {...register('end_time')}   />
        </div>
        <Input label="Attendee name" placeholder="Jane Smith" {...register('attendee_name')} />
        <Textarea label="Attendee context" placeholder="Who they are, what they do — helps Foundersales prepare better…" rows={3} maxLength={2000} showCount {...register('attendee_context')} />
        <Textarea label="Notes (optional)" rows={2} {...register('notes')} />
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input type="checkbox" {...register('create_prospect')} />
          Add as a CRM prospect
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>Cancel</Button>
          <Button size="sm" type="submit" isLoading={createMutation.isPending || isSubmitting}>Create event</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Main page ─────────────────────────────────────────────────
export default function CalendarPage() {
  const navigate    = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [createOpen,setCreateOpen]= useState(false);
  const [searchResults, setSearchResults] = useState<CalendarEvent[] | null>(null);
  const [fromDate,  setFromDate]  = useState(() => format(subDays(new Date(), 7), 'yyyy-MM-dd'));
  const [toDate, setToDate] = useState(() => format(addDays(new Date(), 30), 'yyyy-MM-dd'));

  const defaultTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const opportunityId = searchParams.get('opportunityId');
  useEffect(() => {
    if (opportunityId) {
      setCreateOpen(true);
      setSearchParams((prev) => { prev.delete('opportunityId'); return prev; }, { replace: true });
    }
  }, [opportunityId]);

  // Cursor-based pagination via useInfiniteQuery.
  const {
    data: pagesData, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: queryKeys.calendar({ from: fromDate, to: toDate }),
    queryFn: ({ pageParam }) => calendarApi.list({ from: fromDate, to: toDate, cursor: pageParam, limit: 30 }).then((r) => r.data),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.pagination.has_more ? lastPage.pagination.next_cursor ?? undefined : undefined,
    staleTime: 2 * 60_000,
  });

  const { data: totalEventsCount } = useQuery({
    queryKey: ['calendar', 'total-count'],
    queryFn: () => calendarApi.list({ limit: 1 }).then((r) => r.data.events.length),
    staleTime: 5 * 60_000,
  });

  const { data: alertsData } = useQuery({
    queryKey: queryKeys.calendarAlerts,
    queryFn:  () => calendarApi.getAlerts().then((r) => r.data),
    staleTime: 2 * 60_000,
  });

  const events = searchResults ?? (pagesData?.pages.flatMap((p) => p.events) ?? []);
  const debriefCount  = alertsData?.debriefs_needed_total ?? alertsData?.debriefs_needed.length ?? 0;
  const overdueCount  = alertsData?.overdue_commitments.length ?? 0;

  const goToToday = useCallback(() => {
    setFromDate(format(subDays(new Date(), 7), 'yyyy-MM-dd'));
    setToDate(format(addDays(new Date(), 30), 'yyyy-MM-dd'));
  }, []);

  const navigatePrev = () => {
    setFromDate((d) => format(subDays(parseISO(d), 14), 'yyyy-MM-dd'));
    setToDate((d)   => format(subDays(parseISO(d), 14), 'yyyy-MM-dd'));
  };
  const navigateNext = () => {
    setFromDate((d) => format(addDays(parseISO(d), 14), 'yyyy-MM-dd'));
    setToDate((d)   => format(addDays(parseISO(d), 14), 'yyyy-MM-dd'));
  };

  useCalendarShortcuts({
    onNew: () => setCreateOpen(true),
    onToday: goToToday,
    onSearch: () => document.getElementById('calendar-search-input')?.focus(),
  });

  return (
    <div className="page-container space-y-5">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold text-text-primary">Calendar</h1>
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
          <Button variant="outline" size="xs" onClick={() => navigate('/commitments')}>View</Button>
        </div>
      )}

      {!searchResults && (
        <div className="flex items-center justify-between bg-white border border-surface-border rounded-lg px-4 py-2.5">
          <button onClick={navigatePrev} className="p-2.5 text-text-muted hover:text-text-primary transition-colors" aria-label="Previous period">
            <ChevronLeft size={16} />
          </button>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-text-primary">
              {format(parseISO(fromDate), 'MMM d')} – {format(parseISO(toDate), 'MMM d, yyyy')}
            </span>
            <button onClick={goToToday} className="text-xs font-medium text-brand hover:underline">Today</button>
          </div>
          <button onClick={navigateNext} className="p-2.5 text-text-muted hover:text-text-primary transition-colors" aria-label="Next period">
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      {isLoading && !searchResults ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" rounded="lg" />)}
        </div>
      ) : events.length === 0 ? (
        totalEventsCount === 0 ? (
          <EmptyState icon={<Calendar size={28} />} headline="No events scheduled" subline="Add a meeting to get AI-powered prep and coaching." action={{ label: 'Add event', onClick: () => setCreateOpen(true) }} />
        ) : (
          <EmptyState icon={<Calendar size={28} />} headline="Nothing in this date range" subline="Try a different range, or jump back to today." action={{ label: 'Back to today', onClick: goToToday }} />
        )
      ) : (
        <div className="space-y-3">
          {events.map((event) => <EventCard key={event.id} event={event} />)}
          {!searchResults && hasNextPage && (
            <Button variant="secondary" size="sm" className="w-full" isLoading={isFetchingNextPage} onClick={() => fetchNextPage()}>
              Load more
            </Button>
          )}
        </div>
      )}

      <CreateEventModal open={createOpen} onClose={() => setCreateOpen(false)} opportunityId={opportunityId} defaultTimezone={defaultTimezone} />
    </div>
  );
}
