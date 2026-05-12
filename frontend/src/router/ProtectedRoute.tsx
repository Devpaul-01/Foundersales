// ============================================================
// FILE: src/router/ProtectedRoute.tsx
// ============================================================
import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { ROUTES } from '@/lib/constants';

interface ProtectedRouteProps {
  requiresWorkspace?: boolean;
}

export function ProtectedRoute({ requiresWorkspace = true }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  if (isLoading) return null; // Splash handles this

  if (!isAuthenticated) {
    return <Navigate to={ROUTES.LOGIN} replace state={{ from: location.pathname }} />;
  }

  if (!user?.onboarding_completed && !location.pathname.startsWith('/onboarding')) {
    return <Navigate to={ROUTES.ONBOARDING_BASIC} replace />;
  }

  if (requiresWorkspace && !user?.active_workspace_id) {
    return <Navigate to={ROUTES.WORKSPACES} replace />;
  }

  return <Outlet />;
}