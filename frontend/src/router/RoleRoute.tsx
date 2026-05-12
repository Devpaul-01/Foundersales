// ============================================================
// FILE: src/router/RoleRoute.tsx
// ============================================================
import React from 'react';
import { useRole } from '@/hooks/useRole';
import type { WorkspaceRole } from '@/api/types';

interface RoleRouteProps {
  minRole:  WorkspaceRole;
  children: React.ReactNode;
}

export function RoleRoute({ minRole, children }: RoleRouteProps) {
  const { hasMinRole } = useRole();

  if (!hasMinRole(minRole)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-3 text-center p-8">
        <span className="text-4xl">🔒</span>
        <h2 className="text-lg font-semibold text-text-primary">Access Restricted</h2>
        <p className="text-sm text-text-secondary max-w-xs">
          You need <strong>{minRole}</strong> or higher access to view this section.
          Ask your workspace admin to update your role.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
