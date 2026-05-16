import apiClient from './client';
import type { User, Workspace, ActiveMembership, SessionTokens, LoginResponse, VoiceProfile } from './types';

export const authApi = {
  register: (body: { email: string; password: string; name?: string }) =>
    apiClient.post<{ success: boolean; needsVerification: boolean; email: string; message: string }>(
      '/api/auth/register', body,
    ),

  login: (body: { email: string; password: string }) =>
    apiClient.post<LoginResponse>('/api/auth/login', body),

  logout: () =>
    apiClient.post<{ success: boolean }>('/api/auth/logout'),

  // src/api/auth.ts - Updated
refresh: () =>
  apiClient.post<SessionTokens>('/api/auth/refresh', {}), // Empty body, cookie handles it

  getMe: () =>
    apiClient.get<{
      user:               User;
      active_workspace:   Workspace | null;
      active_membership:  ActiveMembership | null;
    }>('/api/auth/me'),

  /** PUT /api/auth/me — updates user + workspace profile fields */
  updateMe: (body: {
    name?:                string;
    business_name?:       string;
    product_description?: string;
    target_audience?:     string;
    website?:             string;
    role?:                string;
    industry?:            string;
    experience_level?:    string;
    bio?:                 string;
    preferred_platforms?: string[];
  }) =>
    apiClient.put<{ success: boolean }>('/api/auth/me', body),

  deleteAccount: () =>
    apiClient.delete<{ success: boolean; message: string }>('/api/auth/account'),

  ensureProfile: (body: { name?: string; provider: 'email' | 'google' }) =>
    apiClient.post<{ user: User; isNewUser: boolean }>('/api/auth/profile/ensure', body),

  getGoogleOAuthUrl: () =>
    apiClient.get<{ url: string }>('/api/auth/google/url'),

  resendVerification: (email: string) =>
    apiClient.post<{ success: boolean; message: string }>(
      '/api/auth/resend-verification', { email },
    ),
};
