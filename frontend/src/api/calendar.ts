import apiClient from './client';
import type {
  CalendarEvent, ConversationCommitment, ConversationSignal, Prospect,
  MeetingPrep, FollowUpOptions, CursorPagination, EventAttendee, VoiceMemo,
} from './types';

export const calendarApi = {
  // Cursor-based pagination — scales correctly as the dataset grows,
  // since each page is an indexed keyset lookup (migration 014's
  // composite index) rather than an OFFSET scan.
  list: (params?: { from?: string; to?: string; cursor?: string; limit?: number }) =>
    apiClient.get<{ events: CalendarEvent[]; pagination: CursorPagination }>('/api/calendar', { params }),

  search: (params: {
    q?: string; event_type?: string; outcome?: string; prospect_id?: string;
    from?: string; to?: string; cursor?: string; limit?: number;
  }) =>
    apiClient.get<{ events: CalendarEvent[]; pagination: CursorPagination }>('/api/calendar/search', { params }),

  create: (body: {
    title:             string;
    event_date:        string;
    start_time?:       string | null; // full ISO 8601 datetime, not "HH:MM"
    end_time?:         string | null;
    event_timezone?:   string;
    event_type?:       string;
    notes?:            string | null;
    attendee_name?:    string | null;
    attendee_context?: string | null;
    opportunity_id?:   string | null;
    prospect_id?:      string | null;
    create_prospect?:  boolean; // explicit opt-in/out for CRM auto-creation
    recurrence_rule?:  string | null;
  }) =>
    apiClient.post<{ event: CalendarEvent }>('/api/calendar', body),

  getAlerts: () =>
    apiClient.get<{
      debriefs_needed:       CalendarEvent[];
      debriefs_needed_total: number;
      overdue_commitments:   ConversationCommitment[];
      pending_commitments:   ConversationCommitment[];
      commitments_total:     number;
    }>('/api/calendar/alerts'),

  getById: (id: string) =>
    apiClient.get<{
      event:       CalendarEvent & { prospects?: Prospect | null };
      commitments: ConversationCommitment[];
      signals:     ConversationSignal[];
      attendees:   EventAttendee[];
    }>(`/api/calendar/${id}`),

  update: (id: string, body: {
    title?:            string;
    event_date?:       string;
    start_time?:       string; // full ISO 8601 datetime
    end_time?:         string;
    event_type?:       string;
    notes?:            string;
    attendee_name?:    string;
    attendee_context?: string;
    outcome?:          string;
  }) =>
    apiClient.put<{ success: boolean }>(`/api/calendar/${id}`, body),

  updateOutcome: (id: string, outcome: string) =>
    apiClient.patch<{ success: boolean; outcome: string }>(`/api/calendar/${id}/outcome`, { outcome }),

  reschedule: (id: string, body: { event_date: string; start_time?: string | null; end_time?: string | null }) =>
    apiClient.post<{ success: boolean; reschedule_count: number }>(`/api/calendar/${id}/reschedule`, body),

  delete: (id: string) =>
    apiClient.delete<{ success: boolean }>(`/api/calendar/${id}`),

  submitDebrief: (id: string, body: { outcome: string; raw_notes?: string | null }) =>
    apiClient.post<{
      success: boolean;
      debrief: Record<string, unknown> | null;
      message: string | null;
    }>(`/api/calendar/${id}/debrief`, body),

  generatePrep: (id: string) =>
    apiClient.post<{ prep: MeetingPrep; cached: boolean }>(`/api/calendar/${id}/prep`),

  regeneratePrep: (id: string) =>
    apiClient.post<{ prep: MeetingPrep; cached: boolean }>(`/api/calendar/${id}/prep/regenerate`),

  triggerResearch: (id: string) =>
    apiClient.post<{ success: boolean; message: string }>(`/api/calendar/${id}/research`),

  generateFollowUp: (id: string) =>
    apiClient.post<{ follow_up: FollowUpOptions; cached: boolean }>(`/api/calendar/${id}/follow-up`),

  markFollowUpSent: (id: string, variant: 'brief' | 'substantive' | 're_engagement') =>
    apiClient.post<{ success: boolean }>(`/api/calendar/${id}/follow-up/send`, { variant }),

  getTimeline: (id: string) =>
    apiClient.get<{ narrative: string | null; timeline: any[] }>(`/api/calendar/${id}/timeline`),

  startMeetingNotes: (id: string) =>
    apiClient.post<{ chat_id: string; is_existing: boolean }>(
      `/api/calendar/${id}/start-meeting-notes`,
    ),

  addAttendees: (id: string, attendees: { name: string; email?: string; role?: string }[]) =>
    apiClient.post<{ attendees: EventAttendee[] }>(`/api/calendar/${id}/attendees`, { attendees }),

  // ── Voice memos — single multipart request for BOTH recording and
  // uploading an existing file. `source` distinguishes them; the backend
  // pipeline (transcription + AI enrichment) is identical either way.
  uploadVoiceMemo: (id: string, file: Blob, opts: { source: 'recorded' | 'uploaded'; filename?: string; durationSeconds?: number }) => {
    const form = new FormData();
    form.append('audio', file, opts.filename || 'memo.webm');
    form.append('source', opts.source);
    if (opts.durationSeconds) form.append('duration_seconds', String(opts.durationSeconds));
    return apiClient.post<{ memo: VoiceMemo }>(`/api/calendar/${id}/voice-memo`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  listVoiceMemos: (id: string) =>
    apiClient.get<{ voice_memos: VoiceMemo[] }>(`/api/calendar/${id}/voice-memos`),

  retryVoiceMemoTranscription: (id: string, memoId: string) =>
    apiClient.post<{ success: boolean }>(`/api/calendar/${id}/voice-memo/${memoId}/retry`),
};
