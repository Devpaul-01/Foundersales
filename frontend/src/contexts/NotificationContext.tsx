import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';
import { calendarApi } from '@/api/calendar';
import { feedbackApi } from '@/api/feedback';
import { userApi } from '@/api/user';
import { followupApi } from '@/api/followup';
import { useAuthContext } from './AuthContext';

interface NotificationContextValue {
  calendarAlertCount:    number;
  pendingFeedbackCount:  number;
  followupUnviewedCount: number;
  unreadNotificationCount: number;
  refreshCounts:         () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextValue>({
  calendarAlertCount:      0,
  pendingFeedbackCount:    0,
  followupUnviewedCount:   0,
  unreadNotificationCount: 0,
  refreshCounts:           async () => {},
});

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuthContext();
  const [calendarAlertCount,    setCalendarAlertCount]    = useState(0);
  const [pendingFeedbackCount,  setPendingFeedbackCount]  = useState(0);
  const [followupUnviewedCount, setFollowupUnviewedCount] = useState(0);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);

  const refreshCounts = useCallback(async () => {
    if (!isAuthenticated || !user?.onboarding_completed) return;

    const [alertsRes, feedbackRes, notifRes, followupRes] = await Promise.allSettled([
      calendarApi.getAlerts(),
      feedbackApi.getPending(),
      userApi.listNotifications({ limit: 1 }),
      followupApi.getUnviewedCount(),
    ]);

    if (alertsRes.status === 'fulfilled') {
      const d = alertsRes.value.data;
      setCalendarAlertCount(d.debriefs_needed.length + d.overdue_commitments.length);
    }
    if (feedbackRes.status === 'fulfilled') {
      setPendingFeedbackCount(feedbackRes.value.data.opportunities.length);
    }
    if (notifRes.status === 'fulfilled') {
      setUnreadNotificationCount(notifRes.value.data.unread_count);
    }
    if (followupRes.status === 'fulfilled') {
      setFollowupUnviewedCount(followupRes.value.data.unviewed_count);
    }
  }, [isAuthenticated, user?.onboarding_completed]);

  // Poll every 2 minutes when authenticated
  useEffect(() => {
    if (!isAuthenticated) return;
    refreshCounts();
    const interval = setInterval(refreshCounts, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [isAuthenticated, refreshCounts]);

  return (
    <NotificationContext.Provider
      value={{
        calendarAlertCount,
        pendingFeedbackCount,
        followupUnviewedCount,
        unreadNotificationCount,
        refreshCounts,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotificationContext() {
  return useContext(NotificationContext);
}
