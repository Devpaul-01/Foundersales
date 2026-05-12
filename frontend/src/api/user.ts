import apiClient from './client';
import type { NotificationPreferences, UserMemoryFact, UserNotification, WorkspaceWithMeta } from './types';

export const userApi = {
  getProfile: () =>
    apiClient.get<{ user: import('./types').User }>('/api/user/profile'),

  updateFcmToken: (token: string) =>
    apiClient.put<{ success: boolean }>('/api/user/fcm-token', { token }),

  updateDebugMode: (enabled: boolean) =>
    apiClient.put<{ success: boolean; debug_mode: boolean }>('/api/user/debug', { enabled }),

  updateNotificationPreferences: (
    prefs: Partial<NotificationPreferences> & {
      memory_enabled?:       boolean;
      email_digest_enabled?: boolean;
    },
  ) =>
    apiClient.put<{ success: boolean; notification_preferences: NotificationPreferences }>(
      '/api/user/notification-preferences', prefs,
    ),

  getMemoryFacts: () =>
    apiClient.get<{ facts: UserMemoryFact[] }>('/api/user/memory'),

  deleteMemoryFact: (id: string) =>
    apiClient.delete<{ success: boolean }>(`/api/user/memory/${id}`),

  listWorkspaces: () =>
    apiClient.get<{ workspaces: WorkspaceWithMeta[] }>('/api/user/workspaces'),

  switchWorkspace: (workspaceId: string) =>
    apiClient.post<{ success: boolean; workspace: { id: string; name: string; plan: string; role: string } }>(
      '/api/user/switch-workspace', { workspace_id: workspaceId },
    ),

  acceptInvite: (token: string) =>
    apiClient.post<{
      success:             boolean;
      workspace:           import('./types').Workspace;
      role:                string;
      message:             string;
      needs_profile_setup: boolean;
    }>(`/api/user/accept-invite/${token}`),

  listNotifications: (params: { limit?: number; offset?: number }) =>
    apiClient.get<{ notifications: UserNotification[]; unread_count: number }>(
      '/api/user/notifications', { params },
    ),

  markNotificationRead: (id: string) =>
    apiClient.post<{ success: boolean }>(`/api/user/notifications/${id}/read`),

  markAllNotificationsRead: () =>
    apiClient.post<{ success: boolean }>('/api/user/notifications/read-all'),
};
