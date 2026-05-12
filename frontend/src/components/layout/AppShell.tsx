import React, { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { AuthProvider } from '@/contexts/AuthContext';
import { WorkspaceProvider } from '@/contexts/WorkspaceContext';
import { NotificationProvider } from '@/contexts/NotificationContext';
import { ToastProvider } from '@/components/common/Toast';
import { SplashScreen } from './SplashScreen';
import { useAuth } from '@/hooks/useAuth';
import { useFCMRegistration } from '@/hooks/useNotifications';

function InnerShell() {
  const { isLoading }              = useAuth();
  const [splashDone, setSplashDone] = useState(false);
  useFCMRegistration();

  useEffect(() => {
    if (!isLoading) {
      const t = setTimeout(() => setSplashDone(true), 400);
      return () => clearTimeout(t);
    }
  }, [isLoading]);

  return (
    <>
      <AnimatePresence>{!splashDone && <SplashScreen isVisible />}</AnimatePresence>
      <div style={{ visibility: splashDone ? 'visible' : 'hidden' }}>
        <Outlet />
      </div>
    </>
  );
}

export function AppShell() {
  return (
    <AuthProvider>
      <WorkspaceProvider>
        <NotificationProvider>
          <ToastProvider>
            <InnerShell />
          </ToastProvider>
        </NotificationProvider>
      </WorkspaceProvider>
    </AuthProvider>
  );
}
