import apiClient from './client';
import type { UserGoal, GoalNote } from './types';

export const goalsApi = {
  list: () =>
    apiClient.get<{ goals: UserGoal[] }>('/api/goals'),

  create: (body: {
    goal_text:     string;
    goal_type?:    string;
    target_value?: number | null;
    target_unit?:  string | null;
    target_date?:  string | null;
  }) =>
    apiClient.post<{ success: boolean; goal: UserGoal }>('/api/goals', body),

  update: (id: string, body: {
    goal_text?:    string;
    target_value?: number | null;
    target_unit?:  string | null;
    target_date?:  string | null;
    status?:       'active' | 'completed' | 'paused';
  }) =>
    apiClient.put<{ success: boolean }>(`/api/goals/${id}`, body),

  delete: (id: string) =>
    apiClient.delete<{ success: boolean }>(`/api/goals/${id}`),

  listNotes: (goalId: string) =>
    apiClient.get<{ notes: GoalNote[] }>(`/api/goals/${goalId}/notes`),

  addNote: (goalId: string, body: { note_text: string; explicit_delta?: number | null }) =>
    apiClient.post<{
      success:           boolean;
      note:              GoalNote;
      coaching_response: string;
      progress_delta:    number | null;
      new_value:         number;
      goal_completed:    boolean;
    }>(`/api/goals/${goalId}/notes`, body),

  deleteNote: (goalId: string, noteId: string) =>
    apiClient.delete<{ success: boolean }>(`/api/goals/${goalId}/notes/${noteId}`),

  getPipelineInsight: (goalId: string) =>
    apiClient.get<{
      insight: { title: string; body: string; action: string | null } | null;
      cached:  boolean;
    }>(`/api/goals/${goalId}/pipeline-insight`),
};
