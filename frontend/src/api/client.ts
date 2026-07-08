// src/api/client.ts
import axios, { type AxiosInstance, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { getTokens, performTokenRefresh } from '@/lib/auth';
import { AppError } from '@/api/types';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ── Error message map ─────────────────────────────────────────
const ERROR_MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS:     'Incorrect email or password.',
  EMAIL_TAKEN:             'An account with this email already exists.',
  UNAUTHORIZED:            'Your session has expired. Please sign in again.',
  ACCOUNT_DELETED:         'This account has been deleted.',
  PERMISSION_DENIED:       "You don't have permission to do this.",
  ONBOARDING_REQUIRED:     'Please complete onboarding first.',
  VOICE_PROFILE_MISSING:   'Complete onboarding to use this feature.',
  QUOTA_EXCEEDED:          'Daily discovery limit reached. Resets at midnight.',
  RATE_LIMIT_EXCEEDED:     'Too many requests. Please slow down.',
  NO_ACTIVE_WORKSPACE:     'Please select a workspace first.',
  OWNER_CANNOT_LEAVE:      'Transfer ownership before leaving.',
  ALREADY_A_MEMBER:        "You're already in this workspace.",
  INVALID_OR_EXPIRED_TOKEN: 'This invite link has expired.',
  SESSION_ENDED:           'This practice session has already ended.',
  SESSION_ALREADY_COMPLETED: 'Completed sessions cannot be deleted.',
  PROFILE_NOT_FOUND:       'User profile not found.',
  NOT_FOUND:               'Resource not found.',
  REGISTRATION_FAILED:     'Account setup failed. Please try again.',
  VALIDATION_ERROR:        'Please check your input and try again.',
};

// ✅ Create the axios instance
export const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true, // ✅ Send cookies (refresh token) with requests
});

// ✅ Request interceptor — adds access token from memory
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const { accessToken } = getTokens();
    if (accessToken && config.headers) {
      config.headers['Authorization'] = `Bearer ${accessToken}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// Build a clean AppError out of any axios error. This is now done for
// EVERY failure path (including public/auth-endpoint failures), so that
// `err instanceof AppError` checks in components (e.g. LoginPage) always
// see the real server-provided message instead of a raw Axios error.
function buildAppError(error: any): AppError {
  const data = error?.response?.data;
  const code = (data?.error as string) ?? 'UNKNOWN';
  const message =
    (data?.message as string) ?? ERROR_MESSAGES[code] ?? error?.message ?? 'Something went wrong.';
  const status = error?.response?.status ?? 0;
  const details = data?.details as Record<string, string[]> | undefined;
  return new AppError(ERROR_MESSAGES[code] ?? message, code, status, details);
}

// ✅ Response interceptor — handles token refresh
apiClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // Routes that never need a refresh-and-retry attempt: either they're
    // unauthenticated by design (login/register/forgot-password/etc.), or
    // they're the refresh endpoint itself (retrying that would loop).
    const isAuthEndpoint =
      originalRequest.url?.includes('/login') ||
      originalRequest.url?.includes('/register') ||
      originalRequest.url?.includes('/forgot-password') ||
      originalRequest.url?.includes('/reset-password') ||
      originalRequest.url?.includes('/google/url') ||
      originalRequest.url?.includes('/google/callback') ||
      originalRequest.url?.includes('/health') ||
      originalRequest.url?.includes('/refresh');

    // Only attempt refresh on 401s from real authenticated endpoints, and
    // only once per request.
    if (!isAuthEndpoint && error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        // performTokenRefresh() dedupes concurrent calls within this tab
        // AND serializes calls across tabs (Web Locks API), so this is
        // safe to call from many simultaneous failing requests at once —
        // only one real network call to /api/auth/refresh will happen.
        const { access_token } = await performTokenRefresh();

        if (originalRequest.headers) {
          originalRequest.headers['Authorization'] = `Bearer ${access_token}`;
        }
        return apiClient(originalRequest);
      } catch (refreshError) {
        // Refresh failed — clear session and bounce to login.
        if (typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
          window.location.href = '/login';
        }
        return Promise.reject(buildAppError(refreshError));
      }
    }

    return Promise.reject(buildAppError(error));
  },
);

export default apiClient;
