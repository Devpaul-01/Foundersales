import React, { createContext, useContext, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { workspacesApi } from '@/api/workspaces';
import { queryClient } from '@/lib/queryClient';
import { useAuthContext } from './AuthContext';
import type { Workspace, ActiveMembership, WorkspaceRole } from '@/api/types';

interface WorkspaceContextValue {
  activeWorkspace:   Workspace | null;
  activeMembership:  ActiveMembership | null;
  role:              WorkspaceRole | null;
  /** Switch to another workspace — clears all query cache */
  switchWorkspace:   (workspaceId: string) => Promise<void>;
  /** Whether a workspace switch is in progress */
  isSwitching:       boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { activeWorkspace, activeMembership, refreshUser } = useAuthContext();
  const navigate = useNavigate();
  const [isSwitching, setIsSwitching] = React.useState(false);

  const switchWorkspace = useCallback(async (workspaceId: string) => {
    setIsSwitching(true);
    try {
      // Use canonical POST /api/workspaces/switch
      await workspacesApi.switch(workspaceId);
      // Clear ALL cached data — workspace scope has changed
      queryClient.clear();
      // Re-hydrate user (active_workspace_id has changed)
      await refreshUser();
      navigate('/home');
    } finally {
      setIsSwitching(false);
    }
  }, [refreshUser, navigate]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      activeWorkspace,
      activeMembership,
      role:       (activeMembership?.role ?? null) as WorkspaceRole | null,
      switchWorkspace,
      isSwitching,
    }),
    [activeWorkspace, activeMembership, switchWorkspace, isSwitching],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspaceContext(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspaceContext must be used within WorkspaceProvider');
  return ctx;
}
