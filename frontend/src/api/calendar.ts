import apiClient from './client';
import type { CalendarEvent, ConversationCommitment, ConversationSignal, Prospect } from './types';

export const calendarApi = {
  list: (params?: { from?: string; to?: string }) =>
    apiClient.get<{ events: CalendarEvent[] }>('/api/calendar', { params }),

  create: (body: {
    title:             string;
    event_date:        string;
    start_time?:       string | null;
    end_time?:         string | null;
    event_type?:       string;
    notes?:            string | null;
    attendee_name?:    string | null;
    attendee_context?: string | null;
    opportunity_id?:   string | null;
    prospect_id?:      string | null;
  }) =>
    apiClient.post<{ event: CalendarEvent }>('/api/calendar', body),

  getAlerts: () =>
    apiClient.get<{
      debriefs_needed:     CalendarEvent[];
      overdue_commitments: ConversationCommitment[];
      pending_commitments: ConversationCommitment[];
    }>('/api/calendar/alerts'),

  getById: (id: string) =>
    apiClient.get<{
      event:       CalendarEvent & { prospects?: Prospect | null };
      commitments: ConversationCommitment[];
      signals:     ConversationSignal[];
    }>(`/api/calendar/${id}`),

  update: (id: string, body: {
    title?:            string;
    event_date?:       string;
    start_time?:       string;
    end_time?:         string;
    event_type?:       string;
    notes?:            string;
    attendee_name?:    string;
    attendee_context?: string;
    outcome?:          string;
  }) =>
    apiClient.put<{ success: boolean }>(`/api/calendar/${id}`, body),

  delete: (id: string) =>
    apiClient.delete<{ success: boolean }>(`/api/calendar/${id}`),

  submitDebrief: (id: string, body: { outcome: string; raw_notes?: string | null }) =>
    apiClient.post<{
      success: boolean;
      debrief: Record<string, unknown> | null;
      message: string | null;
    }>(`/api/calendar/${id}/debrief`, body),

  generatePrep: (id: string) =>
    apiClient.post<{ prep: Record<string, unknown>; cached: boolean }>(
      `/api/calendar/${id}/prep`,
    ),

  triggerResearch: (id: string) =>
    apiClient.post<{ success: boolean; message: string }>(`/api/calendar/${id}/research`),

  startMeetingNotes: (id: string) =>
    apiClient.post<{ chat_id: string; is_existing: boolean }>(
      `/api/calendar/${id}/start-meeting-notes`,
    ),
};
