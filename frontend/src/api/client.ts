import axios, { type AxiosInstance, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { getTokens, setTokens, clearTokens, scheduleRefresh } from '@/lib/auth';
import { AppError } from '@/api/types';

const BASE_URL = 'http://localhost:5173';

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

export const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

// ── REQUEST interceptor ───────────────────────────────────────
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

// ── RESPONSE interceptor (token refresh with queuing) ─────────
let isRefreshing = false;
let refreshQueue: Array<(token: string) => void> = [];

apiClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // ── 401 → attempt token refresh ──────────────────────────
    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        // Queue concurrent requests until refresh completes
        return new Promise<AxiosResponse>((resolve) => {
          refreshQueue.push((token: string) => {
            if (originalRequest.headers) {
              originalRequest.headers['Authorization'] = `Bearer ${token}`;
            }
            resolve(apiClient(originalRequest));
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const { refreshToken } = getTokens();
        if (!refreshToken) throw new Error('No refresh token');

        const res = await axios.post(`${BASE_URL}/api/auth/refresh`, {
          refresh_token: refreshToken,
        });

        const { access_token, refresh_token, expires_in } = res.data;
        setTokens(access_token, refresh_token, expires_in);
        scheduleRefresh(expires_in);

        // Flush queued requests
        refreshQueue.forEach((cb) => cb(access_token));
        refreshQueue = [];

        if (originalRequest.headers) {
          originalRequest.headers['Authorization'] = `Bearer ${access_token}`;
        }
        return apiClient(originalRequest);
      } catch (refreshError) {
        clearTokens();
        refreshQueue = [];
        // Redirect to login
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    // ── Build AppError from response ─────────────────────────
    const data    = error.response?.data;
    const code    = (data?.error as string)   ?? 'UNKNOWN';
    const message = (data?.message as string) ?? ERROR_MESSAGES[code] ?? 'Something went wrong.';
    const status  = error.response?.status    ?? 0;
    const details = data?.details as Record<string, string[]> | undefined;

    throw new AppError(
      ERROR_MESSAGES[code] ?? message,
      code,
      status,
      details,
    );
  },
);

export default apiClient;
