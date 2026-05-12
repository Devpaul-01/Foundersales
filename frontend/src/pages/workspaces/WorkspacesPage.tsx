import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { workspacesApi }    from '@/api/workspaces';
import { queryClient }      from '@/lib/queryClient';
import { queryKeys }        from '@/lib/queryKeys';
import { useWorkspace }     from '@/hooks/useWorkspace';
import { useToast }         from '@/hooks/useToast';
import { createWorkspaceSchema, type CreateWorkspaceSchema } from '@/lib/schemas';
import { Button }           from '@/components/ui/Button';
import { Input }            from '@/components/ui/Input';
import { Badge }            from '@/components/ui/Badge';
import { Modal }            from '@/components/ui/Modal';
import { Skeleton }         from '@/components/ui/Skeleton';
import { Spinner }          from '@/components/common/index';
import { formatShortDate, cn } from '@/lib/utils';
import { Building2, Plus, CheckCircle2, LogIn } from 'lucide-react';
import type { Workspace } from '@/api/types';

export default function WorkspacesPage() {
  const navigate           = useNavigate();
  const { switchWorkspace, activeWorkspace } = useWorkspace();
  const { showToast }      = useToast();
  const [createOpen,       setCreateOpen]  = useState(false);
  const [switchingId,      setSwitchingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.workspaces,
    queryFn:  () => workspacesApi.list().then((r) => r.data.workspaces),
    staleTime: 60_000,
  });

  const { register, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting } } =
    useForm<CreateWorkspaceSchema>({ resolver: zodResolver(createWorkspaceSchema) });

  // Auto-derive slug from name
  const nameVal = watch('name', '');
  React.useEffect(() => {
    const slug = nameVal.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    setValue('slug', slug);
  }, [nameVal, setValue]);

  const createMutation = useMutation({
    mutationFn: (d: CreateWorkspaceSchema) => workspacesApi.create(d).then((r) => r.data.workspace),
    onSuccess: async (ws) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      showToast(`"${ws.name}" created!`, 'success');
      reset();
      setCreateOpen(false);
      setSwitchingId(ws.id);
      await switchWorkspace(ws.id);
      navigate('/home');
    },
    onError: () => showToast('Could not create workspace.', 'error'),
  });

  const handleSwitch = async (wsId: string) => {
    if (wsId === activeWorkspace?.id) {
      navigate('/home');
      return;
    }
    setSwitchingId(wsId);
    try {
      await switchWorkspace(wsId);
      navigate('/home');
    } catch {
      showToast('Could not switch workspace.', 'error');
      setSwitchingId(null);
    }
  };

  const workspaces: Workspace[] = data ?? [];

  return (
    <div className="min-h-screen bg-surface-base flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-5">
        {/* Logo */}
        <div className="text-center">
          <Building2 size={36} className="text-brand mx-auto" />
          <h1 className="text-2xl font-bold text-text-primary mt-2">Your workspaces</h1>
          <p className="text-sm text-text-muted mt-1">Select a workspace to continue.</p>
        </div>

        {/* Workspace list */}
        <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="w-10 h-10 rounded-lg" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
              ))}
            </div>
          ) : workspaces.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-text-muted">You have no workspaces yet.</p>
            </div>
          ) : (
            workspaces.map((ws) => {
              const isActive  = ws.id === activeWorkspace?.id;
              const switching = switchingId === ws.id;
              return (
                <button
                  key={ws.id}
                  onClick={() => handleSwitch(ws.id)}
                  disabled={!!switchingId}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-hover border-b border-surface-border last:border-0 transition-colors text-left disabled:opacity-60"
                >
                  <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center text-brand font-bold text-sm shrink-0">
                    {ws.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-text-primary truncate">{ws.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Badge variant="gray" size="xs">{ws.plan}</Badge>
                      <span className="text-xs text-text-muted">
                        {ws.role} · {formatShortDate(ws.created_at)}
                      </span>
                    </div>
                  </div>
                  <div className="shrink-0">
                    {switching ? (
                      <Spinner size="sm" />
                    ) : isActive ? (
                      <CheckCircle2 size={16} className="text-success" />
                    ) : (
                      <LogIn size={14} className="text-text-muted" />
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <Button
          variant="outline"
          className="w-full"
          leftIcon={<Plus size={14} />}
          onClick={() => setCreateOpen(true)}
        >
          Create new workspace
        </Button>
      </div>

      {/* Create modal */}
      <Modal isOpen={createOpen} onClose={() => setCreateOpen(false)} title="Create workspace" size="sm">
        <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-4">
          <Input
            label="Workspace name"
            placeholder="Acme Corp"
            required
            error={errors.name?.message}
            {...register('name')}
          />
          <Input
            label="Slug (URL-friendly)"
            placeholder="acme-corp"
            helperText="Used in URLs — auto-generated from name."
            error={errors.slug?.message}
            {...register('slug')}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" type="button" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button size="sm" type="submit" isLoading={createMutation.isPending || isSubmitting}>
              Create
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
