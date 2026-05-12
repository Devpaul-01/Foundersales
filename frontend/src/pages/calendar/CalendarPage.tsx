// ============================================================
// FILE: src/pages/calendar/CalendarPage.tsx
// From calendar-7.txt:
// - GET /api/calendar with from/to params
// - GET /api/calendar/alerts for banner counts
// - debrief_needed computed field shown as red dot
// - POST /api/calendar creates event + subscribes to Realtime
//   for prep_generated update (calendar-7.txt Issue 14 fix)
// - Date range navigation
// ============================================================
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { format, addDays, subDays, parseISO, startOfMonth, endOfMonth } from 'date-fns';
import { calendarApi }  from '@/api/calendar';
import { queryClient }  from '@/lib/queryClient';
import { queryKeys }    from '@/lib/queryKeys';
import { useToast }     from '@/hooks/useToast';
import { useRealtimeChannel } from '@/hooks/useRealtime';
import { createCalendarEventSchema, type CreateCalendarEventSchema } from '@/lib/schemas';
import { Button }       from '@/components/ui/Button';
import { Input, Textarea, Select } from '@/components/ui/Input';
import { Badge }        from '@/components/ui/Badge';
import { Modal }        from '@/components/ui/Modal';
import { Tabs }         from '@/components/ui/Tabs';
import { Skeleton }     from '@/components/ui/Skeleton';
import { EmptyState, InlineAlert } from '@/components/common/index';
import { AppError, type CalendarEvent } from '@/api/types';
import { EVENT_TYPE_LABELS, MEETING_OUTCOME_COLORS, MEETING_OUTCOME_LABELS } from '@/lib/constants';
import { formatShortDate, formatTime, cn } from '@/lib/utils';
import {
  Calendar, Plus, ChevronLeft, ChevronRight,
  AlertTriangle, CheckSquare, Clock, Zap,
} from 'lucide-react';

// ── Event card ────────────────────────────────────────────────
function EventCard({ event }: { event: CalendarEvent }) {
  const navigate = useNavigate();
  return (
    <div
      onClick={() => navigate(`/calendar/${event.id}`)}
      className="bg-white border border-surface-border rounded-lg p-4 hover:shadow-card-md hover:border-slate-300 transition-all cursor-pointer"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-text-primary truncate">{event.title}</p>
            {event.debrief_needed && (
              <span className="w-2 h-2 rounded-full bg-danger shrink-0" title="Debrief needed" />
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
        {event.prep_generated ? (
          <Badge variant="green" size="xs">✓ Prep ready</Badge>
        ) : (
          <Badge variant="gray" size="xs">
            <span className="animate-pulse">Preparing…</span>
          </Badge>
        )}
        {event.outcome && (
          <span
            className="text-xs font-medium"
            style={{ color: MEETING_OUTCOME_COLORS[event.outcome] }}
          >
            {MEETING_OUTCOME_LABELS[event.outcome]}
          </span>
        )}
        {event.health_score != null && (
          <span className={cn(
            'text-xs font-mono ml-auto',
            event.health_score >= 70 ? 'text-success' :
            event.health_score >= 40 ? 'text-warning' : 'text-danger',
          )}>
            ❤️ {event.health_score}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Create event modal ────────────────────────────────────────
function CreateEventModal({
  open, onClose,
}: {
  open:    boolean;
  onClose: () => void;
}) {
  const { showToast } = useToast();
  const [newEventId,  setNewEventId]  = useState<string | null>(null);

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm<CreateCalendarEventSchema>({ resolver: zodResolver(createCalendarEventSchema) });

  // Subscribe to prep_generated for the newly created event (calendar-7.txt Issue 14)
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

  const createMutation = useMutation({
    mutationFn: (data: CreateCalendarEventSchema) =>
      calendarApi.create(data).then((r) => r.data.event),
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
        <Input
          label="Title"
          placeholder="Meeting with Jane"
          required
          error={errors.title?.message}
          {...register('title')}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Date"
            type="date"
            required
            error={errors.event_date?.message}
            {...register('event_date')}
          />
          <Select
            label="Type"
            options={Object.entries(EVENT_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l }))}
            {...register('event_type')}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Start time" type="time" {...register('start_time')} />
          <Input label="End time"   type="time" {...register('end_time')}   />
        </div>
        <Input
          label="Attendee name"
          placeholder="Jane Smith"
          {...register('attendee_name')}
        />
        <Textarea
          label="Attendee context"
          placeholder="Who they are, what they do — helps Clutch prepare better…"
          rows={3}
          maxLength={2000}
          showCount
          {...register('attendee_context')}
        />
        <Textarea
          label="Notes (optional)"
          rows={2}
          {...register('notes')}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>Cancel</Button>
          <Button size="sm" type="submit" isLoading={createMutation.isPending || isSubmitting}>
            Create event
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Main page ─────────────────────────────────────────────────
export default function CalendarPage() {
  const navigate    = useNavigate();
  const [view,      setView]      = useState<'list' | 'month'>('list');
  const [createOpen,setCreateOpen]= useState(false);
  const [fromDate,  setFromDate]  = useState(
    () => format(subDays(new Date(), 7), 'yyyy-MM-dd'),
  );
  const [toDate, setToDate] = useState(
    () => format(addDays(new Date(), 30), 'yyyy-MM-dd'),
  );

  const { data: eventsData, isLoading } = useQuery({
    queryKey: queryKeys.calendar({ from: fromDate, to: toDate }),
    queryFn:  () => calendarApi.list({ from: fromDate, to: toDate }).then((r) => r.data.events),
    staleTime: 2 * 60_000,
  });

  const { data: alertsData } = useQuery({
    queryKey: queryKeys.calendarAlerts,
    queryFn:  () => calendarApi.getAlerts().then((r) => r.data),
    staleTime: 2 * 60_000,
  });

  const events = eventsData ?? [];
  const debriefCount  = alertsData?.debriefs_needed.length ?? 0;
  const overdueCount  = alertsData?.overdue_commitments.length ?? 0;

  const navigatePrev = () => {
    setFromDate((d) => format(subDays(parseISO(d), 14), 'yyyy-MM-dd'));
    setToDate((d)   => format(subDays(parseISO(d), 14), 'yyyy-MM-dd'));
  };
  const navigateNext = () => {
    setFromDate((d) => format(addDays(parseISO(d), 14), 'yyyy-MM-dd'));
    setToDate((d)   => format(addDays(parseISO(d), 14), 'yyyy-MM-dd'));
  };

  return (
    <div className="page-container space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold text-text-primary">Calendar</h1>
        <Button leftIcon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
          Add event
        </Button>
      </div>

      {/* Alert banners */}
      {debriefCount > 0 && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <CheckSquare size={15} className="text-amber-600 shrink-0" />
          <p className="text-sm text-amber-700 flex-1">
            {debriefCount} meeting{debriefCount > 1 ? 's' : ''} need{debriefCount === 1 ? 's' : ''} a debrief.
          </p>
          <Button variant="outline" size="xs" onClick={() => navigate('/commitments')}>
            Review
          </Button>
        </div>
      )}
      {overdueCount > 0 && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <AlertTriangle size={15} className="text-red-600 shrink-0" />
          <p className="text-sm text-red-700 flex-1">
            {overdueCount} overdue commitment{overdueCount > 1 ? 's' : ''}.
          </p>
          <Button variant="outline" size="xs" onClick={() => navigate('/commitments')}>
            View
          </Button>
        </div>
      )}

      {/* Date navigation */}
      <div className="flex items-center justify-between bg-white border border-surface-border rounded-lg px-4 py-2.5">
        <button onClick={navigatePrev} className="p-1 text-text-muted hover:text-text-primary transition-colors">
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-medium text-text-primary">
          {format(parseISO(fromDate), 'MMM d')} – {format(parseISO(toDate), 'MMM d, yyyy')}
        </span>
        <button onClick={navigateNext} className="p-1 text-text-muted hover:text-text-primary transition-colors">
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Events list */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" rounded="lg" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          icon={<Calendar size={28} />}
          headline="No events scheduled"
          subline="Add a meeting to get AI-powered prep and coaching."
          action={{ label: 'Add event', onClick: () => setCreateOpen(true) }}
        />
      ) : (
        <div className="space-y-3">
          {events.map((event) => <EventCard key={event.id} event={event} />)}
        </div>
      )}

      <CreateEventModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
