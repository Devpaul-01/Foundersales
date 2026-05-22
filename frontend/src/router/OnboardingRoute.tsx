// ============================================================
// FILE: src/router/OnboardingRoute.tsx
// ============================================================
import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { ROUTES } from '@/lib/constants';

export function OnboardingRoute() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  if (isLoading) return null;

  if (!isAuthenticated) {
    return <Navigate to={ROUTES.LOGIN} replace />;
  }

  // ✅ Allow preview page even if onboarding is completed
  const isPreviewRoute = location.pathname === '/onboarding/preview';
  const isSetPasswordRoute = location.pathname === '/set-password';
  
  if (user?.onboarding_completed && !isPreviewRoute && !isSetPasswordRoute) {
    return <Navigate to={ROUTES.HOME} replace />;
  }

  return <Outlet />;
}