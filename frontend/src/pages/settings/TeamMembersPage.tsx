// FILE: src/pages/settings/TeamMembersPage.tsx
// DEMO BUILD — all data is hardcoded locally for screenshot/demo purposes.
// No network calls, no React Query, no loading states.
import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button }        from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Badge }         from '@/components/ui/Badge';
import { Avatar }        from '@/components/ui/Avatar';
import { Modal }         from '@/components/ui/Modal';
import { InlineAlert, ConfirmDialog } from '@/components/common/index';
import { UserPlus, X, Clock, Copy, Check } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types (kept local to this demo file so it has zero external data deps)
// ---------------------------------------------------------------------------
type Role = 'owner' | 'admin' | 'manager' | 'member';

interface WorkspaceMember {
  user_id: string;
  name: string | null;
  email: string;
  role: Role;
  avatarColor?: string;
}

interface PendingInvite {
  id: string;
  email: string;
  role: Exclude<Role, 'owner'>;
  expires_at: string;
  is_expired: boolean;
}

interface InviteMemberSchema {
  email: string;
  role: string;
}

const ROLE_OPTIONS = [
  { value: 'member',  label: 'Member'  },
  { value: 'manager', label: 'Manager' },
  { value: 'admin',   label: 'Admin'   },
];

// ---------------------------------------------------------------------------
// Hardcoded demo data
// ---------------------------------------------------------------------------
const CURRENT_WORKSPACE_NAME = 'Northwind Studio';

const INITIAL_MEMBERS: WorkspaceMember[] = [
  { user_id: 'u_01', name: 'Priya Natarajan', email: 'priya@northwindstudio.com', role: 'owner'   },
  { user_id: 'u_02', name: 'Marcus Chen',     email: 'marcus@northwindstudio.com', role: 'admin'   },
  { user_id: 'u_03', name: 'Elena Fischer',   email: 'elena@northwindstudio.com',  role: 'manager' },
  { user_id: 'u_04', name: 'Devon Michaels',  email: 'devon@northwindstudio.com',  role: 'member'  },
  { user_id: 'u_05', name: 'Aisha Bello',     email: 'aisha@northwindstudio.com',  role: 'member'  },
  { user_id: 'u_06', name: 'Tom Bradshaw',    email: 'tom@northwindstudio.com',    role: 'manager' },
  { user_id: 'u_07', name: 'Sofia Marchetti', email: 'sofia@northwindstudio.com',  role: 'member'  },
];

const INITIAL_INVITES: PendingInvite[] = [
  { id: 'inv_01', email: 'jordan.reeves@gmail.com',   role: 'member',  expires_at: '2026-09-15T00:00:00Z', is_expired: false },
  { id: 'inv_02', email: 'k.oyelaran@outlook.com',    role: 'manager', expires_at: '2026-09-10T00:00:00Z', is_expired: false },
  { id: 'inv_03', email: 'contractor@freelance.io',   role: 'member',  expires_at: '2026-08-29T00:00:00Z', is_expired: true  },
];

// Simple, dependency-free date formatter (mirrors the shape of formatShortDate)
function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function TeamMembersPage() {
  // In the real app these come from hooks; hardcoded here for the demo.
  const isAdmin = true;
  const isOwner = true;

  const [members, setMembers] = useState<WorkspaceMember[]>(INITIAL_MEMBERS);
  const [invites, setInvites] = useState<PendingInvite[]>(INITIAL_INVITES);

  const [inviteOpen,   setInviteOpen]   = useState(false);
  const [removeTarget, setRemoveTarget] = useState<WorkspaceMember | null>(null);

  const [generatedInvite, setGeneratedInvite] = useState<{
    url: string;
    email: string;
    workspaceName: string;
    expiresAt: string;
  } | null>(null);

  const [copied, setCopied] = useState(false);

  const { register, handleSubmit, reset, formState: { errors } } =
    useForm<InviteMemberSchema>({ defaultValues: { role: 'member', email: '' } });

  const onCreateInvite = (d: InviteMemberSchema) => {
    const expires = new Date();
    expires.setDate(expires.getDate() + 7);

    const newInvite: PendingInvite = {
      id: `inv_${Math.random().toString(36).slice(2, 8)}`,
      email: d.email,
      role: d.role as PendingInvite['role'],
      expires_at: expires.toISOString(),
      is_expired: false,
    };

    setInvites((prev) => [newInvite, ...prev]);

    setGeneratedInvite({
      url: `https://app.northwindstudio.com/invite/${newInvite.id}`,
      email: d.email,
      workspaceName: CURRENT_WORKSPACE_NAME,
      expiresAt: newInvite.expires_at,
    });

    reset();
  };

  const revokeInvite = (inviteId: string) => {
    setInvites((prev) => prev.filter((i) => i.id !== inviteId));
  };

  const updateRole = (uid: string, role: string) => {
    setMembers((prev) => prev.map((m) => (m.user_id === uid ? { ...m, role: role as Role } : m)));
  };

  const removeMember = (uid: string) => {
    setMembers((prev) => prev.filter((m) => m.user_id !== uid));
    setRemoveTarget(null);
  };

  const handleCopyLink = async () => {
    if (generatedInvite?.url) {
      try {
        await navigator.clipboard.writeText(generatedInvite.url);
      } catch {
        // clipboard may be unavailable in some demo/embedded contexts — ignore
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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
        <div>
          <h1 className="text-xl font-bold text-text-primary">Team members</h1>
          <p className="text-xs text-text-muted mt-0.5">{CURRENT_WORKSPACE_NAME} · {members.length} members</p>
        </div>
        <Button size="sm" leftIcon={<UserPlus size={13} />} onClick={() => setInviteOpen(true)}>
          Invite member
        </Button>
      </div>

      {/* Members */}
      <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide px-4 py-2.5 border-b border-surface-border bg-surface-base">
          Active members
        </p>
        {members.map((m) => (
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
                  onChange={(e) => updateRole(m.user_id, e.target.value)}
                  className="text-xs py-1 px-2 h-7"
                />
              ) : (
                <Badge variant="gray" size="xs">{m.role}</Badge>
              )}
              {isAdmin && m.role !== 'owner' && (
                <button
                  onClick={() => setRemoveTarget(m)}
                  className="p-1 text-text-muted hover:text-danger transition-colors"
                  aria-label={`Remove ${m.name ?? m.email}`}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Pending invites */}
      {isAdmin && (
        <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide px-4 py-2.5 border-b border-surface-border bg-surface-base">
            Pending invites
          </p>
          {invites.length === 0 ? (
            <p className="text-sm text-text-muted px-4 py-4">No pending invites.</p>
          ) : (
            invites.map((inv) => (
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
                  onClick={() => revokeInvite(inv.id)}
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
        <form onSubmit={handleSubmit(onCreateInvite)} className="space-y-4">
          <Input
            label="Email address"
            type="email"
            required
            placeholder="colleague@company.com"
            error={errors.email?.message}
            {...register('email', { required: 'Email is required' })}
          />
          <Select
            label="Role"
            options={ROLE_OPTIONS}
            error={errors.role?.message}
            {...register('role')}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" type="button" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button size="sm" type="submit">
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
        title="Invite created"
        size="sm"
      >
        {generatedInvite && (
          <div className="space-y-4">
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
              <p className="text-xs text-text-muted mb-2">Invite link:</p>
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
        onConfirm={() => removeTarget && removeMember(removeTarget.user_id)}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
}
