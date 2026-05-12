import { useEffect } from 'react';
import { userApi } from '@/api/user';
import { useAuth } from './useAuth';

/**
 * Registers the device FCM token on mount (if permission granted).
 * Handles foreground push messages by showing an in-app toast.
 * Firebase is optional — gracefully skipped if env vars are missing.
 */
export function useFCMRegistration() {
  const { user, isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated || !user) return;

    async function register() {
      try {
        // Dynamic import so Firebase only loads when needed
        const { initFCM, requestNotificationPermission } = await import('@/lib/fcm');
        const permission = await requestNotificationPermission();
        if (permission !== 'granted') return;

        const token = await initFCM();
        if (!token) return;

        // Only update if the token has changed
        if (user?.fcm_token !== token) {
          await userApi.updateFcmToken(token);
        }
      } catch {
        // FCM is optional — silently skip on failure
      }
    }

    register();
  }, [isAuthenticated, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
}

export { useNotificationContext as useNotifications } from '@/contexts/NotificationContext';
