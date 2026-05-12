// ============================================================
// FILE: src/router/OnboardingRoute.tsx
// ============================================================
import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { ROUTES } from '@/lib/constants';

export function OnboardingRoute() {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) return null;

  if (!isAuthenticated) {
    return <Navigate to={ROUTES.LOGIN} replace />;
  }

  if (user?.onboarding_completed) {
    return <Navigate to={ROUTES.HOME} replace />;
  }

  return <Outlet />;
}
