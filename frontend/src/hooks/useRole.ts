import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { ROLE_HIERARCHY } from '@/lib/constants';
import type { WorkspaceRole } from '@/api/types';

export function useRole() {
  const { role } = useWorkspaceContext();
  const currentRole = (role ?? 'member') as WorkspaceRole;
  const roleIndex = ROLE_HIERARCHY.indexOf(currentRole as typeof ROLE_HIERARCHY[number]);

  /** Returns true if the current user meets the minimum role requirement */
  const hasMinRole = (minRole: WorkspaceRole): boolean =>
    roleIndex >= ROLE_HIERARCHY.indexOf(minRole as typeof ROLE_HIERARCHY[number]);

  return {
    role:      currentRole,
    isMember:  true,                    // everyone is at least member
    isManager: hasMinRole('manager'),
    isAdmin:   hasMinRole('admin'),
    isOwner:   currentRole === 'owner',
    hasMinRole,
  };
}
