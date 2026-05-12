import apiClient from './client';
import type { FileUpload } from './types';

export const suggestionsApi = {
  get: () =>
    apiClient.get<{ suggestions: string[] }>('/api/suggestions'),
};

export const uploadApi = {
  upload: (
    file: File,
    chatId?: string,
    onProgress?: (pct: number) => void,
  ) => {
    const formData = new FormData();
    formData.append('file', file);
    if (chatId) formData.append('chat_id', chatId);

    return apiClient.post<{ success: boolean; file: FileUpload }>(
      '/api/upload',
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (onProgress && e.total) {
            onProgress(Math.round((e.loaded * 100) / e.total));
          }
        },
      },
    );
  },

  delete: (id: string) =>
    apiClient.delete<{ success: boolean }>(`/api/upload/${id}`),

  list: (params?: { chat_id?: string; limit?: number }) =>
    apiClient.get<{ files: FileUpload[] }>('/api/upload', { params }),
};

export const workspaceActivityApi = {
  list: (params?: { limit?: number; offset?: number }) =>
    apiClient.get<{
      events:       import('./types').WorkspaceActivityEvent[];
      total:        number;
      workspace_id: string;
      limit:        number;
      offset:       number;
    }>('/api/workspace/activity', { params }),
};
