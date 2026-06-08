// FILE: src/pages/settings/TeamMembersPage.tsx
// GET  /api/workspaces/:id/members
// GET  /api/workspaces/:id/invites
// POST /api/workspaces/:id/invite-test (TEST ENDPOINT)
// DELETE /api/workspaces/:id/invites/:inviteId
// PUT  /api/workspaces/:id/members/:uid/role
// DELETE /api/workspaces/:id/members/:uid
import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { workspacesApi } from '@/api/workspaces';
import { queryClient }   from '@/lib/queryClient';
import { queryKeys }     from '@/lib/queryKeys';
import { useWorkspace }  from '@/hooks/useWorkspace';
import { useRole }       from '@/hooks/useRole';
import { useToast }      from '@/hooks/useToast';
import { inviteMemberSchema, type InviteMemberSchema } from '@/lib/schemas';
import { Button }        from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Badge }         from '@/components/ui/Badge';
import { Avatar }        from '@/components/ui/Avatar';
import { Modal }         from '@/components/ui/Modal';
import { Skeleton }      from '@/components/ui/Skeleton';
import { InlineAlert, ConfirmDialog } from '@/components/common/index';
import { formatShortDate } from '@/lib/utils';
import { UserPlus, X, Clock, Copy, Check } from 'lucide-react';
import type { WorkspaceMember, PendingInvite } from '@/api/types';

const ROLE_OPTIONS = [
  { value: 'member',  label: 'Member'  },
  { value: 'manager', label: 'Manager' },
  { value: 'admin',   label: 'Admin'   },
];

export default function TeamMembersPage() {
  const { activeWorkspace }  = useWorkspace();
  const { isAdmin, isOwner } = useRole();
  const { showToast }        = useToast();
  const wsId = activeWorkspace?.id ?? '';
  const [inviteOpen,  setInviteOpen]  = useState(false);
  const [removeTarget, setRemoveTarget] = useState<WorkspaceMember | null>(null);
  
  // State for showing generated invite link
  const [generatedInvite, setGeneratedInvite] = useState<{
    url: string;
    email: string;
    workspaceName: string;
    expiresAt: string;
  } | null>(null);
  
  const [copied, setCopied] = useState(false);

  const { data: members, isLoading: membersLoading } = useQuery({
    queryKey: queryKeys.members(wsId),
    queryFn:  () => workspacesApi.listMembers(wsId).then((r) => r.data.members),
    enabled:  !!wsId,
    staleTime: 60_000,
  });

  const { data: invites, isLoading: invitesLoading } = useQuery({
    queryKey: queryKeys.invites(wsId),
    queryFn:  () => workspacesApi.listInvites(wsId).then((r) => r.data.invites),
    enabled:  !!wsId && isAdmin,
    staleTime: 60_000,
  });

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm<InviteMemberSchema>({ resolver: zodResolver(inviteMemberSchema), defaultValues: { role: 'member' } });

  // TEST MUTATION - uses invite-test endpoint
  const inviteMutation = useMutation({
    mutationFn: (d: InviteMemberSchema) => workspacesApi.inviteTest(wsId, d),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.invites(wsId) });
      
      // Store the generated invite info to show in modal
      setGeneratedInvite({
        url: response.data.invite_url,
        email: response.data.email,
        workspaceName: response.data.workspace_name,
        expiresAt: response.data.expires_at,
      });
      
      reset();
      // Don't close the invite modal yet - we'll show the link modal
    },
    onError: (error: any) => {
      console.error('Invite error:', error);
      const message = error?.response?.data?.error || 'Could not create invite.';
      showToast(message, 'error');
    },
  });

  const revokeInviteMutation = useMutation({
    mutationFn: (inviteId: string) => workspacesApi.revokeInvite(wsId, inviteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.invites(wsId) });
      showToast('Invite revoked.', 'info');
    },
    onError: () => showToast('Could not revoke invite.', 'error'),
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ uid, role }: { uid: string; role: string }) =>
      workspacesApi.updateMemberRole(wsId, uid, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.members(wsId) });
      showToast('Role updated.', 'success');
    },
    onError: () => showToast('Could not update role.', 'error'),
  });

  const removeMutation = useMutation({
    mutationFn: (uid: string) => workspacesApi.removeMember(wsId, uid),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.members(wsId) });
      setRemoveTarget(null);
      showToast('Member removed.', 'info');
    },
    onError: () => showToast('Could not remove member.', 'error'),
  });

  const handleCopyLink = async () => {
    if (generatedInvite?.url) {
      await navigator.clipboard.writeText(generatedInvite.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      showToast('Invite link copied to clipboard!', 'success');
    }
  };

  if (!isAdmin) {
    return (
      <div className="page-container">
        <InlineAlert type="error" message="Admin access required to manage members." />
      </div>
    );
  }

  return (
    <div className="page-container max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-text-primary">Team members</h1>
        <Button size="sm" leftIcon={<UserPlus size={13} />} onClick={() => setInviteOpen(true)}>
          Invite member
        </Button>
      </div>

      {/* Members */}
      <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide px-4 py-2.5 border-b border-surface-border bg-surface-base">
          Active members
        </p>
        {membersLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="w-8 h-8 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          (members ?? []).map((m) => (
            <div key={m.user_id} className="flex items-center gap-3 px-4 py-3 border-b border-surface-border last:border-0">
              <Avatar name={m.name ?? m.email} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">{m.name ?? m.email}</p>
                <p className="text-xs text-text-muted truncate">{m.email}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {isOwner && m.role !== 'owner' ? (
                  <Select
                    options={ROLE_OPTIONS}
                    value={m.role}
                    onChange={(e) => updateRoleMutation.mutate({ uid: m.user_id, role: e.target.value })}
                    className="text-xs py-1 px-2 h-7"
                  />
                ) : (
                  <Badge variant="gray" size="xs">{m.role}</Badge>
                )}
                {isAdmin && m.role !== 'owner' && (
                  <button
                    onClick={() => setRemoveTarget(m)}
                    className="p-1 text-text-muted hover:text-danger transition-colors"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pending invites */}
      {isAdmin && (
        <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide px-4 py-2.5 border-b border-surface-border bg-surface-base">
            Pending invites
          </p>
          {invitesLoading ? (
            <div className="p-4"><Skeleton className="h-10 w-full" /></div>
          ) : !(invites ?? []).length ? (
            <p className="text-sm text-text-muted px-4 py-4">No pending invites.</p>
          ) : (
            (invites ?? []).map((inv: PendingInvite) => (
              <div key={inv.id} className="flex items-center gap-3 px-4 py-3 border-b border-surface-border last:border-0">
                <Clock size={13} className="text-text-muted shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary truncate">{inv.email}</p>
                  <p className="text-xs text-text-muted">
                    {inv.role} · Expires {formatShortDate(inv.expires_at)}
                    {inv.is_expired && <span className="text-danger ml-1">(expired)</span>}
                  </p>
                </div>
                <button
                  onClick={() => revokeInviteMutation.mutate(inv.id)}
                  className="text-xs text-danger hover:underline shrink-0"
                >
                  Revoke
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Invite modal */}
      <Modal isOpen={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite team member" size="sm">
        <form onSubmit={handleSubmit((d) => inviteMutation.mutate(d))} className="space-y-4">
          <Input
            label="Email address"
            type="email"
            required
            placeholder="colleague@company.com"
            error={errors.email?.message}
            {...register('email')}
          />
          <Select
            label="Role"
            options={ROLE_OPTIONS}
            error={errors.role?.message}
            {...register('role')}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" type="button" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button size="sm" type="submit" isLoading={inviteMutation.isPending || isSubmitting}>
              Create invite
            </Button>
          </div>
        </form>
      </Modal>

      {/* Invite Link Modal (shows after invite is created) */}
      <Modal 
        isOpen={!!generatedInvite} 
        onClose={() => {
          setGeneratedInvite(null);
          setInviteOpen(false);
        }} 
        title="Invite created (test mode)" 
        size="sm"
      >
        {generatedInvite && (
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-md p-3">
              <p className="text-xs text-amber-700 font-medium mb-1">⚠️ Test Mode Active</p>
              <p className="text-xs text-amber-600">
                Email sending is disabled. Copy the link below and share it manually with the user.
              </p>
            </div>

            <div>
              <p className="text-xs text-text-muted mb-1">Invite for:</p>
              <p className="text-sm font-medium text-text-primary">{generatedInvite.email}</p>
            </div>

            <div>
              <p className="text-xs text-text-muted mb-1">Workspace:</p>
              <p className="text-sm text-text-primary">{generatedInvite.workspaceName}</p>
            </div>

            <div>
              <p className="text-xs text-text-muted mb-1">Expires:</p>
              <p className="text-sm text-text-primary">{formatShortDate(generatedInvite.expiresAt)}</p>
            </div>

            <div>
              <p className="text-xs text-text-muted mb-2">Invite Link (copy and share):</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-surface-base p-2 rounded border border-surface-border break-all font-mono">
                  {generatedInvite.url}
                </code>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleCopyLink}
                  leftIcon={copied ? <Check size={14} /> : <Copy size={14} />}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </Button>
              </div>
            </div>

            <div className="pt-2">
              <Button
                size="sm"
                fullWidth
                onClick={() => {
                  setGeneratedInvite(null);
                  setInviteOpen(false);
                }}
              >
                Done
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Remove confirm */}
      <ConfirmDialog
        isOpen={!!removeTarget}
        title={`Remove ${removeTarget?.name ?? removeTarget?.email}?`}
        message="They will lose access to this workspace immediately."
        confirmLabel="Remove"
        variant="danger"
        isLoading={removeMutation.isPending}
        onConfirm={() => removeTarget && removeMutation.mutate(removeTarget.user_id)}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
}