import apiClient from './client';
import type { Workspace, WorkspaceWithMeta, WorkspaceMember, PendingInvite } from './types';

export const workspacesApi = {
  list: () =>
    apiClient.get<{ workspaces: WorkspaceWithMeta[] }>('/api/workspaces'),

  create: (body: { name: string }) =>
    apiClient.post<{ workspace: Workspace }>('/api/workspaces', body),

  /** Canonical switch endpoint (POST /api/workspaces/switch) */
  switch: (workspaceId: string) =>
    apiClient.post<{ success: boolean; workspace: Workspace & { role: string } }>(
      '/api/workspaces/switch', { workspace_id: workspaceId },
    ),

  getById: (id: string) =>
    apiClient.get<{ workspace: WorkspaceWithMeta }>(`/api/workspaces/${id}`),

  update: (id: string, body: { name?: string; settings?: Record<string, unknown> }) =>
    apiClient.put<{ success: boolean }>(`/api/workspaces/${id}`, body),

  delete: (id: string) =>
    apiClient.delete<{ success: boolean }>(`/api/workspaces/${id}`),

  invite: (id: string, body: { email: string; role: 'admin' | 'manager' | 'member' }) =>
    apiClient.post<{ success: boolean; message: string; expires_at: string }>(
      `/api/workspaces/${id}/invite`, body,
    ),

  listInvites: (id: string) =>
    apiClient.get<{ invites: PendingInvite[] }>(`/api/workspaces/${id}/invites`),

  revokeInvite: (workspaceId: string, inviteId: string) =>
    apiClient.delete<{ success: boolean }>(`/api/workspaces/${workspaceId}/invites/${inviteId}`),

  listMembers: (id: string) =>
    apiClient.get<{ members: WorkspaceMember[] }>(`/api/workspaces/${id}/members`),

  updateMemberRole: (workspaceId: string, userId: string, role: string) =>
    apiClient.put<{ success: boolean; role: string }>(
      `/api/workspaces/${workspaceId}/members/${userId}/role`, { role },
    ),

  removeMember: (workspaceId: string, userId: string) =>
    apiClient.delete<{ success: boolean }>(`/api/workspaces/${workspaceId}/members/${userId}`),

  leave: (id: string) =>
    apiClient.delete<{ success: boolean }>(`/api/workspaces/${id}/leave`),

  transferOwnership: (id: string, newOwnerId: string) =>
    apiClient.put<{ success: boolean }>(`/api/workspaces/${id}/transfer-ownership`, {
      new_owner_user_id: newOwnerId,
    }),

  nudgeMember: (workspaceId: string, userId: string, message: string) =>
    apiClient.post<{ success: boolean }>(`/api/workspaces/${workspaceId}/nudge`, {
      user_id: userId, message,
    }),

  getAnalytics: (id: string) =>
    apiClient.get<Record<string, unknown>>(`/api/workspaces/${id}/analytics`),
};
