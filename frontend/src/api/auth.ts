// src/api/auth.ts
import apiClient from './client';
import type { User, Workspace, ActiveMembership, SessionTokens, VoiceProfile } from './types';

// Add this interface
export interface LoginResponse extends SessionTokens {
  user: {
    id: string;
    email: string;
    name?: string;
  };
  onboarding: {
    step: number;
    completed: boolean;
  };
}

export const authApi = {
  register: (body: { email: string; password: string; name?: string }) =>
    apiClient.post<{ success: boolean; needsVerification: boolean; email: string; message: string }>(
      '/api/auth/register', body,
    ),

  login: (body: { email: string; password: string }) =>
    apiClient.post<LoginResponse>('/api/auth/login', body),

  logout: () =>
    apiClient.post<{ success: boolean }>('/api/auth/logout'),

  refresh: () =>
    apiClient.post<SessionTokens>('/api/auth/refresh', {}),
  // src/api/auth.ts — add these to the authApi object

forgotPassword: (email: string) =>
  apiClient.post<{ success: boolean; message: string }>(
    '/api/auth/forgot-password', 
    { email }
  ),

resetPassword: (accessToken: string, newPassword: string) =>
  apiClient.post<{ success: boolean; message: string }>(
    '/api/auth/reset-password',
    { access_token: accessToken, new_password: newPassword }
  ),

  getMe: () =>
    apiClient.get<{
      user:               User;
      active_workspace:   Workspace | null;
      active_membership:  ActiveMembership | null;
    }>('/api/auth/me'),

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