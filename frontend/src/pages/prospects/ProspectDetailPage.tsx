// FILE: src/pages/prospects/ProspectDetailPage.tsx
import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { prospectsApi }  from '@/api/prospects';
import { chatApi }       from '@/api/chat';
import { queryClient }   from '@/lib/queryClient';
import { queryKeys }     from '@/lib/queryKeys';
import { useToast }      from '@/hooks/useToast';
import { updateProspectSchema, type UpdateProspectSchema } from '@/lib/schemas';
import { Button }        from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Badge, PlatformBadge } from '@/components/ui/Badge';
import { Avatar }        from '@/components/ui/Avatar';
import { Modal }         from '@/components/ui/Modal';
import { Tabs }          from '@/components/ui/Tabs';
import { Skeleton }      from '@/components/ui/Skeleton';
import { InlineAlert, PageLoader, CopyButton } from '@/components/common/index';
import { PLATFORM_LABELS, PROSPECT_STATUS_LABELS } from '@/lib/constants';
import { formatShortDate, formatRelativeDate, cn } from '@/lib/utils';
import {
  ArrowLeft, ExternalLink, MessageCircle,
  Edit2, Trash2, Mail, Building2,
} from 'lucide-react';

const DETAIL_TABS = [
  { value: 'overview',      label: 'Overview'      },
  { value: 'opportunities', label: 'Opportunities' },
  { value: 'activity',      label: 'Activity'      },
];

export default function ProspectDetailPage() {
  const { id }        = useParams<{ id: string }>();
  const navigate      = useNavigate();
  const { showToast } = useToast();
  const [tab,         setTab]         = useState('overview');
  const [editOpen,    setEditOpen]    = useState(false);
  const [deleteOpen,  setDeleteOpen]  = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.prospect(id!),
    queryFn:  () => prospectsApi.getById(id!).then((r) => r.data),
    enabled:  !!id,
  });

  const chatMutation = useMutation({
    mutationFn: () =>
      chatApi.create({
        chat_type:    'general',
        chat_mode:    'general',
        context_id:   id,
        context_type: 'prospect',
      }).then((r) => r.data.chat),
    onSuccess: (chat) => navigate(`/chat/${chat.id}`),
    onError:   () => showToast('Could not open chat.', 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => prospectsApi.delete(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.prospects() });
      showToast('Prospect deleted.', 'info');
      navigate('/prospects');
    },
    onError: () => showToast('Could not delete prospect.', 'error'),
  });

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm<UpdateProspectSchema>({
      resolver:      zodResolver(updateProspectSchema),
      defaultValues: data?.prospect,
    });

  const updateMutation = useMutation({
    mutationFn: (d: UpdateProspectSchema) => prospectsApi.update(id!, d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.prospect(id!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.prospects() });
      showToast('Prospect updated.', 'success');
      setEditOpen(false);
    },
    onError: () => showToast('Could not update prospect.', 'error'),
  });

  if (isLoading) return <PageLoader />;
  if (!data?.prospect) return (
    <div className="page-container">
      <InlineAlert type="error" message="Prospect not found." />
    </div>
  );

  const { prospect, opportunities = [], intel = [] } = data;

  return (
    <div className="page-container max-w-3xl space-y-5">
      <button onClick={() => navigate('/prospects')} className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary">
        <ArrowLeft size={14} /> Prospects
      </button>

      {/* Header card */}
      <div className="bg-white border border-surface-border rounded-lg p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar name={prospect.name} size="xl" />
            <div>
              <h1 className="text-xl font-bold text-text-primary">{prospect.name}</h1>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {prospect.title && (
                  <span className="text-sm text-text-muted">{prospect.title}</span>
                )}
                {prospect.company && (
                  <span className="flex items-center gap-1 text-sm text-text-muted">
                    <Building2 size={12} />{prospect.company}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Badge
                  variant={
                    prospect.status === 'converted' ? 'green' :
                    prospect.status === 'lost'      ? 'red'   :
                    prospect.status === 'stale'     ? 'yellow': 'blue'
                  }
                  size="sm"
                >
                  {PROSPECT_STATUS_LABELS[prospect.status]}
                </Badge>
                {prospect.platform && <PlatformBadge platform={prospect.platform} />}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" variant="ghost" leftIcon={<Edit2 size={12} />} onClick={() => { reset(prospect); setEditOpen(true); }}>
              Edit
            </Button>
            <Button
              size="sm"
              leftIcon={<MessageCircle size={12} />}
              isLoading={chatMutation.isPending}
              onClick={() => chatMutation.mutate()}
            >
              Chat
            </Button>
          </div>
        </div>

        {/* Quick links */}
        <div className="flex items-center gap-3 mt-4 pt-4 border-t border-surface-border flex-wrap">
          {prospect.email && (
            <a href={`mailto:${prospect.email}`} className="flex items-center gap-1.5 text-xs text-brand hover:underline">
              <Mail size={12} /> {prospect.email}
            </a>
          )}
          {prospect.linkedin_url && (
            <a href={prospect.linkedin_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-brand hover:underline">
              <ExternalLink size={12} /> LinkedIn
            </a>
          )}
        </div>
      </div>

      <Tabs tabs={DETAIL_TABS} value={tab} onChange={setTab} variant="underline" />

      {/* Overview tab */}
      {tab === 'overview' && (
        <div className="space-y-4">
          {prospect.notes && (
            <div className="bg-white border border-surface-border rounded-lg p-5">
              <p className="text-xs font-semibold text-text-primary mb-2">Notes</p>
              <p className="text-sm text-text-secondary whitespace-pre-wrap">{prospect.notes}</p>
            </div>
          )}
          {intel.length > 0 && (
            <div className="bg-white border border-surface-border rounded-lg p-5 space-y-3">
              <p className="text-xs font-semibold text-text-primary">AI intelligence</p>
              {intel.map((item: any, i: number) => (
                <div key={i} className="space-y-1">
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wide">{item.label}</p>
                  <p className="text-sm text-text-secondary">{item.content}</p>
                </div>
              ))}
            </div>
          )}
          {!prospect.notes && intel.length === 0 && (
            <div className="text-center py-8 text-sm text-text-muted">
              No overview data yet. Add notes or chat with Clutch to research this prospect.
            </div>
          )}
        </div>
      )}

      {/* Opportunities tab */}
      {tab === 'opportunities' && (
        <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
          {opportunities.length === 0 ? (
            <div className="p-8 text-center text-sm text-text-muted">No linked opportunities.</div>
          ) : (
            opportunities.map((opp: any) => (
              <div
                key={opp.id}
                onClick={() => navigate(`/opportunities/${opp.id}`)}
                className="flex items-center justify-between px-4 py-3 hover:bg-surface-hover cursor-pointer border-b border-surface-border last:border-0"
              >
                <div>
                  <p className="text-sm font-medium text-text-primary">{opp.company_name}</p>
                  <p className="text-xs text-text-muted mt-0.5">{opp.stage}</p>
                </div>
                <Badge variant="blue" size="xs">{opp.status}</Badge>
              </div>
            ))
          )}
        </div>
      )}

      {/* Activity tab */}
      {tab === 'activity' && (
        <div className="bg-white border border-surface-border rounded-lg p-5">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">Added</span>
              <span className="text-text-primary">{formatShortDate(prospect.created_at)}</span>
            </div>
            {prospect.last_contact_at && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-muted">Last contact</span>
                <span className="text-text-primary">{formatRelativeDate(prospect.last_contact_at)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit modal */}
      <Modal isOpen={editOpen} onClose={() => setEditOpen(false)} title="Edit prospect" size="md">
        <form onSubmit={handleSubmit((d) => updateMutation.mutate(d))} className="space-y-4">
          <Input label="Name" required error={errors.name?.message} {...register('name')} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Company" {...register('company')} />
            <Input label="Title" {...register('title')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Email" type="email" {...register('email')} />
            <Select
              label="Status"
              options={Object.entries(PROSPECT_STATUS_LABELS).map(([v, l]) => ({ value: v, label: l }))}
              {...register('status')}
            />
          </div>
          <Select
            label="Platform"
            options={[
              { value: '', label: 'None' },
              ...Object.entries(PLATFORM_LABELS).map(([v, l]) => ({ value: v, label: l })),
            ]}
            {...register('platform')}
          />
          <Input label="LinkedIn URL" {...register('linkedin_url')} />
          <Textarea label="Notes" rows={3} maxLength={2000} showCount {...register('notes')} />
          <div className="flex justify-between items-center pt-1">
            <Button
              size="sm"
              variant="danger-ghost"
              leftIcon={<Trash2 size={12} />}
              type="button"
              onClick={() => { setEditOpen(false); setDeleteOpen(true); }}
            >
              Delete
            </Button>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" type="button" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button size="sm" type="submit" isLoading={updateMutation.isPending || isSubmitting}>Save</Button>
            </div>
          </div>
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete prospect?" size="sm">
        <p className="text-sm text-text-secondary mb-5">
          This will permanently delete {prospect.name} and all associated data.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setDeleteOpen(false)}>Cancel</Button>
          <Button variant="danger" size="sm" isLoading={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
            Delete
          </Button>
        </div>
      </Modal>
    </div>
  );
}
