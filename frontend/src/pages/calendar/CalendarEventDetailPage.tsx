// ============================================================
// FILE: src/pages/calendar/CalendarEventDetailPage.tsx
// From calendar-7.txt + architecture §3.21:
// - Realtime subscription for prep_generated (polls fallback)
// - Debrief modal with outcome + raw_notes
// - Commitments and signals tabs
// - POST /api/calendar/:id/start-meeting-notes
// ============================================================
import React, { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { calendarApi }   from '@/api/calendar';
import { commitmentsApi }from '@/api/commitments';
import { queryClient }   from '@/lib/queryClient';
import { queryKeys }     from '@/lib/queryKeys';
import { useToast }      from '@/hooks/useToast';
import { useRealtimeChannel } from '@/hooks/useRealtime';
import { useNotificationContext } from '@/contexts/NotificationContext';
import { debriefSchema, type DebriefSchema } from '@/lib/schemas';
import { Button }        from '@/components/ui/Button';
import { Badge }         from '@/components/ui/Badge';
import { Modal }         from '@/components/ui/Modal';
import { Select, Textarea } from '@/components/ui/Input';
import { Tabs }          from '@/components/ui/Tabs';
import { Skeleton }      from '@/components/ui/Skeleton';
import { InlineAlert, PageLoader, CopyButton } from '@/components/common/index';
import { MEETING_OUTCOME_LABELS, EVENT_TYPE_LABELS, SIGNAL_COLORS, SIGNAL_TYPE_LABELS, COMMITMENT_STATUS_LABELS } from '@/lib/constants';
import { formatShortDate, formatTime, formatRelativeDate, cn } from '@/lib/utils';
import {
  ArrowLeft, Calendar, MessageCircle, Search,
  CheckCircle2, Clock, AlertTriangle, RefreshCw,
} from 'lucide-react';

const DETAIL_TABS = [
  { value: 'prep',         label: 'Prep'        },
  { value: 'commitments',  label: 'Commitments' },
  { value: 'signals',      label: 'Signals'     },
];

export default function CalendarEventDetailPage() {
  const { id }         = useParams<{ id: string }>();
  const navigate       = useNavigate();
  const { showToast }  = useToast();
  const { refreshCounts } = useNotificationContext();
  const [activeTab,    setActiveTab]    = useState('prep');
  const [debriefOpen,  setDebriefOpen]  = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: queryKeys.calendarEvent(id!),
    queryFn:  () => calendarApi.getById(id!).then((r) => r.data),
    enabled:  !!id,
    // Poll every 5s when prep not yet generated (fallback from Realtime)
    refetchInterval: (query) => {
      const event = query.state.data?.event;
      if (!event) return 5000;
      if (!event.prep_generated) return 5000;
      return false;
    },
    refetchIntervalInBackground: false,
  });

  // Realtime prep subscription
  useRealtimeChannel({
    channelName: `event:${id ?? 'none'}`,
    table:       'user_events',
    event:       'UPDATE',
    filter:      id ? `id=eq.${id}` : undefined,
    enabled:     !!id && !data?.event.prep_generated,
    onPayload: useCallback((payload) => {
      const updated = payload.new as { prep_generated?: boolean };
      if (updated.prep_generated) {
        queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvent(id!) });
        showToast('📝 Meeting prep is ready!', 'success');
      }
    }, [id, showToast]),
  });

  // Meeting notes chat
  const notesMutation = useMutation({
    mutationFn: () => calendarApi.startMeetingNotes(id!).then((r) => r.data),
    onSuccess: (res) => navigate(`/chat/${res.chat_id}`),
    onError: () => showToast('Could not open meeting notes.', 'error'),
  });

  // Research
  const researchMutation = useMutation({
    mutationFn: () => calendarApi.triggerResearch(id!),
    onSuccess: () => showToast('Research started. Check back in a moment.', 'info'),
    onError: () => showToast('Research failed.', 'error'),
  });

  // Manual prep
  const prepMutation = useMutation({
    mutationFn: () => calendarApi.generatePrep(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvent(id!) });
      showToast('Prep generated!', 'success');
    },
    onError: () => showToast('Could not generate prep.', 'error'),
  });

  // Debrief form
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm<DebriefSchema>({ resolver: zodResolver(debriefSchema) });

  const debriefMutation = useMutation({
    mutationFn: (d: DebriefSchema) =>
      calendarApi.submitDebrief(id!, d).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvent(id!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.calendarAlerts });
      queryClient.invalidateQueries({ queryKey: queryKeys.commitments() });
      refreshCounts();
      showToast('Debrief saved!', 'success');
      setDebriefOpen(false);
      reset();
    },
    onError: () => showToast('Could not save debrief.', 'error'),
  });

  // Commitment done
  const commitDoneMutation = useMutation({
    mutationFn: (cId: string) => commitmentsApi.update(cId, { status: 'done' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvent(id!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.commitments() });
      refreshCounts();
    },
  });

  if (isLoading) return <PageLoader />;
  if (!data?.event) return (
    <div className="page-container">
      <InlineAlert type="error" message="Event not found." />
    </div>
  );

  const { event, commitments = [], signals = [] } = data;
  const isPastEvent = new Date(event.event_date) < new Date();

  return (
    <div className="page-container max-w-3xl space-y-5">
      <button onClick={() => navigate('/calendar')} className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary">
        <ArrowLeft size={14} /> Calendar
      </button>

      {/* Event header */}
      <div className="bg-white border border-surface-border rounded-lg p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-text-primary">{event.title}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <Badge variant="gray" size="xs">{EVENT_TYPE_LABELS[event.event_type]}</Badge>
              {event.attendee_name && (
                <span className="text-sm text-text-muted">with {event.attendee_name}</span>
              )}
              {event.outcome && (
                <span className="text-sm font-medium" style={{ color: MEETING_OUTCOME_COLORS?.[event.outcome] ?? '#64748b' }}>
                  {MEETING_OUTCOME_LABELS[event.outcome]}
                </span>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-medium text-text-primary">{formatShortDate(event.event_date)}</p>
            {event.start_time && (
              <p className="text-xs text-text-muted">{formatTime(event.start_time)}{event.end_time ? ` – ${formatTime(event.end_time)}` : ''}</p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            leftIcon={<MessageCircle size={13} />}
            isLoading={notesMutation.isPending}
            onClick={() => notesMutation.mutate()}
          >
            Meeting notes
          </Button>
          {event.attendee_name && (
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<Search size={13} />}
              isLoading={researchMutation.isPending}
              onClick={() => researchMutation.mutate()}
            >
              Research
            </Button>
          )}
          {isPastEvent && !event.debrief_completed_at && (
            <Button
              size="sm"
              variant="outline"
              leftIcon={<CheckCircle2 size={13} />}
              onClick={() => setDebriefOpen(true)}
            >
              Submit debrief
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        tabs={DETAIL_TABS.map((t) => ({
          ...t,
          badge: t.value === 'commitments' ? commitments.filter(c => c.status === 'pending' || c.status === 'overdue').length : undefined,
        }))}
        value={activeTab}
        onChange={setActiveTab}
        variant="underline"
      />

      {/* Tab content */}
      {activeTab === 'prep' && (
        <div className="bg-white border border-surface-border rounded-lg p-5">
          {!event.prep_generated ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <RefreshCw size={14} className="animate-spin text-brand" />
                {event.attendee_name
                  ? `Researching ${event.attendee_name}…`
                  : 'Generating meeting brief…'}
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-5/6" />
              <Button
                size="xs"
                variant="ghost"
                isLoading={prepMutation.isPending}
                onClick={() => prepMutation.mutate()}
              >
                Generate now
              </Button>
            </div>
          ) : event.prep_content ? (
            <div className="space-y-4">
              {event.prep_content.prospect_background && (
                <div>
                  <p className="text-xs font-semibold text-text-primary mb-1">Prospect background</p>
                  <p className="text-sm text-text-secondary leading-relaxed">{event.prep_content.prospect_background}</p>
                </div>
              )}
              {event.prep_content.talking_points?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-text-primary mb-1">Talking points</p>
                  <ul className="space-y-1">
                    {event.prep_content.talking_points.map((tp: string, i: number) => (
                      <li key={i} className="text-sm text-text-secondary flex items-start gap-2">
                        <span className="text-brand shrink-0 mt-0.5">•</span>{tp}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {event.prep_content.open_commitments?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-text-primary mb-1">Open commitments</p>
                  <ul className="space-y-1">
                    {event.prep_content.open_commitments.map((oc: string, i: number) => (
                      <li key={i} className="text-sm text-text-secondary flex items-start gap-2">
                        <span className="text-warning shrink-0 mt-0.5">⚠</span>{oc}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <InlineAlert type="info" message="No prep content available." />
          )}

          {/* Debrief content */}
          {event.debrief_completed_at && event.debrief_content && (
            <div className="mt-5 pt-5 border-t border-surface-border space-y-3">
              <p className="text-xs font-semibold text-text-primary">Meeting debrief</p>
              {event.debrief_content.summary && (
                <p className="text-sm text-text-secondary">{event.debrief_content.summary}</p>
              )}
              {event.debrief_content.action_items?.length > 0 && (
                <div>
                  <p className="text-xs text-text-muted mb-1">Action items</p>
                  {event.debrief_content.action_items.map((a: string, i: number) => (
                    <p key={i} className="text-sm text-text-secondary">• {a}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'commitments' && (
        <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
          {commitments.length === 0 ? (
            <div className="p-8 text-center text-sm text-text-muted">No commitments from this meeting.</div>
          ) : (
            commitments.map((c) => (
              <div key={c.id} className="flex items-start gap-3 px-4 py-3 border-b border-surface-border last:border-0">
                <div className={cn(
                  'w-2 h-2 rounded-full mt-1.5 shrink-0',
                  c.owner === 'founder' ? 'bg-brand' : 'bg-slate-400',
                )} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary">{c.commitment_text}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-text-muted capitalize">{c.owner}'s action</span>
                    {c.due_date && (
                      <span className={cn(
                        'text-xs',
                        c.is_overdue ? 'text-danger' : 'text-text-muted',
                      )}>
                        Due {formatShortDate(c.due_date)}
                      </span>
                    )}
                  </div>
                </div>
                {c.owner === 'founder' && c.status !== 'done' && (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => commitDoneMutation.mutate(c.id)}
                  >
                    Done
                  </Button>
                )}
                <Badge
                  variant={
                    c.status === 'done'    ? 'green' :
                    c.status === 'overdue' ? 'red'   : 'gray'
                  }
                  size="xs"
                >
                  {COMMITMENT_STATUS_LABELS[c.status]}
                </Badge>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'signals' && (
        <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
          {signals.length === 0 ? (
            <div className="p-8 text-center text-sm text-text-muted">No signals detected.</div>
          ) : (
            signals.map((s) => (
              <div key={s.id} className="flex items-start gap-3 px-4 py-3 border-b border-surface-border last:border-0">
                <div
                  className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                  style={{ backgroundColor: SIGNAL_COLORS[s.signal_type] }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-xs font-semibold"
                      style={{ color: SIGNAL_COLORS[s.signal_type] }}
                    >
                      {SIGNAL_TYPE_LABELS[s.signal_type]}
                    </span>
                    {s.confidence != null && (
                      <span className="text-xs text-text-muted">{Math.round(s.confidence * 100)}% confidence</span>
                    )}
                  </div>
                  <p className="text-sm text-text-secondary mt-0.5">{s.signal_text}</p>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Debrief modal */}
      <Modal isOpen={debriefOpen} onClose={() => setDebriefOpen(false)} title="Submit meeting debrief" size="md">
        <form onSubmit={handleSubmit((d) => debriefMutation.mutate(d))} className="space-y-4">
          <div>
            <p className="text-sm font-medium text-text-primary mb-2">How did the meeting go?</p>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {(Object.entries(MEETING_OUTCOME_LABELS) as [string, string][]).map(([value, label]) => (
                <label key={value} className="cursor-pointer">
                  <input type="radio" className="sr-only" value={value} {...register('outcome')} />
                  <div className={cn(
                    'text-center py-2 rounded-lg border text-xs font-medium transition-all',
                    'hover:border-slate-300',
                  )}>
                    {label}
                  </div>
                </label>
              ))}
            </div>
            {errors.outcome && <p className="text-xs text-danger mt-1">{errors.outcome.message}</p>}
          </div>
          <Textarea
            label="Meeting notes"
            placeholder="What was discussed? Commitments made? Next steps?"
            rows={4}
            maxLength={5000}
            showCount
            {...register('raw_notes')}
          />
          <p className="text-xs text-text-muted">
            Clutch will extract commitments and signals from your notes automatically.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" type="button" onClick={() => setDebriefOpen(false)}>Cancel</Button>
            <Button size="sm" type="submit" isLoading={debriefMutation.isPending || isSubmitting}>
              Save debrief
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// needed for MEETING_OUTCOME_COLORS in this file
const MEETING_OUTCOME_COLORS: Record<string, string> = {
  hot:      '#ef4444',
  positive: '#10b981',
  neutral:  '#64748b',
  cold:     '#3b82f6',
  dead:     '#94a3b8',
};
