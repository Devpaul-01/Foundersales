// ============================================================
// FILE: src/lib/fcm.ts
// ============================================================
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  return Notification.requestPermission();
}

export async function initFCM(): Promise<string | null> {
  const apiKey   = import.meta.env.VITE_FIREBASE_API_KEY;
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
  if (!apiKey || !vapidKey) return null;

  try {
    const { initializeApp, getApps } = await import('firebase/app');
    const { getMessaging, getToken }  = await import('firebase/messaging');

    const app = getApps().length
      ? getApps()[0]
      : initializeApp({
          apiKey,
          authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
          projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
          messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
          appId:             import.meta.env.VITE_FIREBASE_APP_ID,
        });

    const messaging = getMessaging(app);
    return await getToken(messaging, { vapidKey });
  } catch {
    return null;
  }
}

export function onForegroundMessage(
  callback: (payload: unknown) => void,
): () => void {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
  if (!apiKey) return () => {};

  let unsub = () => {};
  (async () => {
    try {
      const { getApps }        = await import('firebase/app');
      const { getMessaging, onMessage } = await import('firebase/messaging');
      if (!getApps().length) return;
      unsub = onMessage(getMessaging(getApps()[0]), callback as never);
    } catch { /* ignore */ }
  })();

  return () => unsub();
}
