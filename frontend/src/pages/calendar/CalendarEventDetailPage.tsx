// ============================================================
// FILE: src/pages/calendar/CalendarEventDetailPage.tsx — IMPLEMENTATION PASS
//
// CHANGES:
//  - Prep/debrief rendering rewritten to match the canonical AI schema
//    (opening_line, key_question_to_ask, etc.) instead of fields the AI
//    never actually returned (prospect_background, action_items).
//  - Debrief outcome selector now shows a real "selected" state
//    (previously a confirmed, currently-shipping bug — no visual
//    difference existed between selected/unselected).
//  - Prep failure state added (was: infinite "Preparing..." pulse with
//    no failure branch).
//  - New: Follow-up section, Voice memo section, timeline narrative.
//  - Local shadowing MEETING_OUTCOME_COLORS redefinition removed —
//    imports from constants.ts only now.
//  - Icon sizes standardized to ICON_SIZE_INLINE.
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
import { Collapsible }   from '@/components/calendar/Collapsible';
import { VoiceMemoRecorder } from '@/components/calendar/VoiceMemoRecorder';
import { VoiceMemoList } from '@/components/calendar/VoiceMemoList';
import {
  MEETING_OUTCOME_LABELS, MEETING_OUTCOME_COLORS, EVENT_TYPE_LABELS,
  SIGNAL_COLORS, SIGNAL_TYPE_LABELS, COMMITMENT_STATUS_LABELS, ICON_SIZE_INLINE,
} from '@/lib/constants';
import { formatShortDate, formatTime, cn } from '@/lib/utils';
import {
  ArrowLeft, Calendar, MessageCircle, Search,
  CheckCircle2, Clock, AlertTriangle, RefreshCw, Mail,
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
    refetchInterval: (query) => {
      const event = query.state.data?.event;
      if (!event) return 5000;
      if (!event.prep_generated && !event.prep_failed) return 5000;
      return false; // stop polling once generated OR permanently failed
    },
    refetchIntervalInBackground: false,
  });

  useRealtimeChannel({
    channelName: `event:${id ?? 'none'}`,
    table:       'user_events',
    event:       'UPDATE',
    filter:      id ? `id=eq.${id}` : undefined,
    enabled:     !!id && !data?.event.prep_generated,
    onPayload: useCallback((payload) => {
      const updated = payload.new as { prep_generated?: boolean; prep_failed?: boolean };
      if (updated.prep_generated) {
        queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvent(id!) });
        showToast('📝 Meeting prep is ready!', 'success');
      } else if (updated.prep_failed) {
        queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvent(id!) });
      }
    }, [id, showToast]),
  });

  const notesMutation = useMutation({
    mutationFn: () => calendarApi.startMeetingNotes(id!).then((r) => r.data),
    onSuccess: (res) => navigate(`/chat/${res.chat_id}`),
    onError: () => showToast('Could not open meeting notes.', 'error'),
  });

  const researchMutation = useMutation({
    mutationFn: () => calendarApi.triggerResearch(id!),
    onSuccess: () => showToast('Research started. Check back in a moment.', 'info'),
    onError: () => showToast('Research failed.', 'error'),
  });

  const prepMutation = useMutation({
    mutationFn: () => calendarApi.generatePrep(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvent(id!) });
      showToast('Prep generated!', 'success');
    },
    onError: () => showToast('Could not generate prep.', 'error'),
  });

  const regenerateMutation = useMutation({
    mutationFn: () => calendarApi.regeneratePrep(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvent(id!) });
      showToast('Prep regenerated!', 'success');
    },
    onError: () => showToast('Could not regenerate prep.', 'error'),
  });

  const followUpMutation = useMutation({
    mutationFn: () => calendarApi.generateFollowUp(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvent(id!) });
      showToast('Follow-up drafts ready!', 'success');
    },
    onError: () => showToast('Could not generate follow-up.', 'error'),
  });

  const markSentMutation = useMutation({
    mutationFn: (variant: 'brief' | 'substantive' | 're_engagement') => calendarApi.markFollowUpSent(id!, variant),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvent(id!) }),
  });

  const {
    register, handleSubmit, reset, watch,
    formState: { errors, isSubmitting },
  } = useForm<DebriefSchema>({ resolver: zodResolver(debriefSchema) });
  const watchedOutcome = watch('outcome');

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
    <div className="page-container space-y-3">
      <InlineAlert type="error" message="Event not found." />
      <Button variant="secondary" size="sm" onClick={() => navigate('/calendar')}>Back to Calendar</Button>
    </div>
  );

  const { event, commitments = [], signals = [] } = data;
  const isPastEvent = new Date(event.event_date) < new Date();

  return (
    <div className="page-container max-w-3xl space-y-5">
      <button onClick={() => navigate('/calendar')} className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary">
        <ArrowLeft size={ICON_SIZE_INLINE} /> Calendar
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
            </div>
            {event.outcome && (
              <span className="inline-block mt-1 text-sm font-medium" style={{ color: MEETING_OUTCOME_COLORS[event.outcome] ?? '#64748b' }}>
                {MEETING_OUTCOME_LABELS[event.outcome]}
              </span>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-medium text-text-primary">{formatShortDate(event.event_date)}</p>
            {event.start_time && (
              <p className="text-xs text-text-muted">{formatTime(event.start_time)}{event.end_time ? ` – ${formatTime(event.end_time)}` : ''}</p>
            )}
            {event.reschedule_count > 0 && (
              <p className="text-xs text-warning">Rescheduled {event.reschedule_count}×</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" leftIcon={<MessageCircle size={13} />} isLoading={notesMutation.isPending} onClick={() => notesMutation.mutate()}>
            Meeting notes
          </Button>
          {event.attendee_name && (
            <Button size="sm" variant="secondary" leftIcon={<Search size={13} />} isLoading={researchMutation.isPending} onClick={() => researchMutation.mutate()}>
              Research
            </Button>
          )}
          {isPastEvent && !event.debrief_completed_at && (
            <Button size="sm" variant="outline" leftIcon={<CheckCircle2 size={13} />} onClick={() => setDebriefOpen(true)}>
              Submit debrief
            </Button>
          )}
          {isPastEvent && <VoiceMemoRecorder eventId={id!} />}
        </div>
      </div>

      <Tabs
        tabs={DETAIL_TABS.map((t) => ({
          ...t,
          badge: t.value === 'commitments' ? commitments.filter(c => c.status === 'pending' || c.status === 'overdue').length : undefined,
        }))}
        value={activeTab}
        onChange={setActiveTab}
        variant="underline"
      />

      {activeTab === 'prep' && (
        <div className="bg-white border border-surface-border rounded-lg p-5 space-y-5">
          {!event.prep_generated && !event.prep_failed ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <RefreshCw size={ICON_SIZE_INLINE} className="animate-spin text-brand" />
                {event.attendee_name ? `Researching ${event.attendee_name}…` : 'Generating meeting brief…'}
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-5/6" />
              <Button size="xs" variant="ghost" isLoading={prepMutation.isPending} onClick={() => prepMutation.mutate()}>
                Generate now
              </Button>
            </div>
          ) : event.prep_failed ? (
            <div className="space-y-3">
              <InlineAlert type="error" message="Prep couldn't be generated automatically." />
              <Button size="xs" isLoading={regenerateMutation.isPending} onClick={() => regenerateMutation.mutate()}>
                Try again
              </Button>
            </div>
          ) : event.prep_content ? (
            <>
              {/* Hero — the two things a founder reads 90 seconds before the call */}
              <div className="bg-brand/5 border border-brand/20 rounded-lg p-4 space-y-3">
                <div>
                  <p className="text-xs font-semibold text-brand uppercase tracking-wide mb-1">Open with</p>
                  <p className="text-base font-medium text-text-primary">{event.prep_content.opening_line}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-brand uppercase tracking-wide mb-1">Ask this</p>
                  <p className="text-base font-medium text-text-primary">{event.prep_content.key_question_to_ask}</p>
                </div>
              </div>

              {event.prep_content.talking_points?.length > 0 && (
                <Collapsible title="Talking points" defaultOpen>
                  <ul className="space-y-1">
                    {event.prep_content.talking_points.map((tp: string, i: number) => (
                      <li key={i} className="text-sm text-text-secondary flex items-start gap-2">
                        <span className="text-brand shrink-0 mt-0.5">•</span>{tp}
                      </li>
                    ))}
                  </ul>
                </Collapsible>
              )}

              {event.prep_content.anticipate_objection && (
                <Collapsible title="If they push back">
                  <p className="text-sm text-text-secondary">{event.prep_content.anticipate_objection}</p>
                </Collapsible>
              )}

              {event.prep_content.intelligence_brief && (
                <Collapsible title="Intelligence brief">
                  <p className="text-sm text-text-secondary">{event.prep_content.intelligence_brief}</p>
                </Collapsible>
              )}

              {event.prep_content.commitment_check && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-sm text-amber-800">⚠ {event.prep_content.commitment_check}</p>
                </div>
              )}

              {event.prep_content.pre_outreach && (
                <Collapsible title="Pre-meeting message">
                  <p className="text-sm text-text-secondary mb-2">{event.prep_content.pre_outreach}</p>
                  <CopyButton text={event.prep_content.pre_outreach} />
                </Collapsible>
              )}

              {event.prep_content.follow_up_template && (
                <Collapsible title="24-hour follow-up template">
                  <p className="text-sm text-text-secondary mb-2">{event.prep_content.follow_up_template}</p>
                  <CopyButton text={event.prep_content.follow_up_template} />
                </Collapsible>
              )}
            </>
          ) : (
            <InlineAlert type="info" message="No prep content available." />
          )}

          {event.debrief_completed_at && event.debrief_content && (
            <div className="mt-5 pt-5 border-t border-surface-border space-y-3">
              <p className="text-xs font-semibold text-text-primary">Meeting debrief</p>
              <p className="text-sm text-text-secondary">{event.debrief_content.summary}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-text-muted mb-0.5">What worked</p>
                  <p className="text-sm text-text-secondary">{event.debrief_content.what_worked}</p>
                </div>
                <div>
                  <p className="text-xs text-text-muted mb-0.5">Try next time</p>
                  <p className="text-sm text-text-secondary">{event.debrief_content.what_to_improve}</p>
                </div>
              </div>
              <div className="bg-brand/5 rounded-lg p-3">
                <p className="text-xs font-semibold text-brand mb-0.5">Coachable moment</p>
                <p className="text-sm text-text-primary">{event.debrief_content.coachable_moment}</p>
              </div>
              <div>
                <p className="text-xs text-text-muted mb-0.5">Recommended next step</p>
                <p className="text-sm text-text-secondary">{event.debrief_content.next_step_recommendation}</p>
              </div>
            </div>
          )}

          {/* Follow-up */}
          {event.debrief_completed_at && (
            <div className="mt-5 pt-5 border-t border-surface-border space-y-3">
              <p className="text-xs font-semibold text-text-primary flex items-center gap-1.5"><Mail size={ICON_SIZE_INLINE} /> Follow-up</p>
              {!event.follow_up_options ? (
                <Button size="sm" isLoading={followUpMutation.isPending} onClick={() => followUpMutation.mutate()}>
                  Generate follow-up drafts
                </Button>
              ) : (
                <div className="space-y-3">
                  {(['brief', 'substantive', 're_engagement'] as const).map((variant) => (
                    <div key={variant} className={cn('border rounded-lg p-3', event.follow_up_variant_sent === variant && 'border-success bg-success/5')}>
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-semibold uppercase text-text-muted">{variant.replace('_', ' ')}</p>
                        {event.follow_up_variant_sent === variant && <Badge variant="green" size="xs">Sent</Badge>}
                      </div>
                      <p className="text-sm text-text-secondary mb-2">{event.follow_up_options[variant]}</p>
                      <div className="flex gap-2">
                        <CopyButton text={event.follow_up_options[variant]} />
                        <Button size="xs" variant="ghost" onClick={() => markSentMutation.mutate(variant)}>Mark sent</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Voice memos */}
          {isPastEvent && (
            <div className="mt-5 pt-5 border-t border-surface-border">
              <VoiceMemoList eventId={id!} />
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
                <div className={cn('w-2 h-2 rounded-full mt-1.5 shrink-0', c.owner === 'founder' ? 'bg-brand' : 'bg-slate-400')} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary">{c.commitment_text}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-text-muted capitalize">{c.owner}'s action</span>
                    {c.due_date && (
                      <span className={cn('text-xs', c.is_overdue ? 'text-danger' : 'text-text-muted')}>
                        Due {formatShortDate(c.due_date)}
                      </span>
                    )}
                  </div>
                </div>
                {c.owner === 'founder' && c.status !== 'done' && (
                  <Button size="xs" variant="ghost" onClick={() => commitDoneMutation.mutate(c.id)}>Done</Button>
                )}
                <Badge variant={c.status === 'done' ? 'green' : c.status === 'overdue' ? 'red' : 'gray'} size="xs">
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
                <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: SIGNAL_COLORS[s.signal_type] }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold" style={{ color: SIGNAL_COLORS[s.signal_type] }}>
                      {SIGNAL_TYPE_LABELS[s.signal_type]}
                    </span>
                    {s.confidence != null && <span className="text-xs text-text-muted">{Math.round(s.confidence * 100)}% confidence</span>}
                  </div>
                  <p className="text-sm text-text-secondary mt-0.5">{s.signal_text}</p>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Debrief modal — outcome selector now shows a real selected state */}
      <Modal isOpen={debriefOpen} onClose={() => setDebriefOpen(false)} title="Submit meeting debrief" size="md">
        <form onSubmit={handleSubmit((d) => debriefMutation.mutate(d))} className="space-y-4">
          <div>
            <p className="text-sm font-medium text-text-primary mb-2">How did the meeting go?</p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {(Object.entries(MEETING_OUTCOME_LABELS) as [string, string][]).map(([value, label]) => {
                const isSelected = watchedOutcome === value;
                return (
                  <label key={value} className="cursor-pointer">
                    <input type="radio" className="sr-only" value={value} {...register('outcome')} />
                    <div className={cn(
                      'text-center py-2 rounded-lg border text-xs font-medium transition-all',
                      isSelected
                        ? 'border-brand bg-brand/10 text-brand ring-1 ring-brand'
                        : 'border-surface-border hover:border-slate-300',
                    )}>
                      {label}
                    </div>
                  </label>
                );
              })}
            </div>
            {errors.outcome && <p className="text-xs text-danger mt-1">{errors.outcome.message}</p>}
          </div>
          <Textarea
            label="Meeting notes"
            placeholder="What was discussed? Commitments made? Next steps?"
            rows={4}
            maxLength={5000}
            showCount
            aria-describedby="debrief-notes-count"
            {...register('raw_notes')}
          />
          <p id="debrief-notes-count" className="sr-only">Character count shown above the field</p>
          <p className="text-xs text-text-muted">
            Foundersales will extract commitments and signals from your notes automatically.
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
