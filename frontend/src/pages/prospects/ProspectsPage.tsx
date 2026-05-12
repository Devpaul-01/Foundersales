// FILE: src/pages/prospects/ProspectsPage.tsx
// Infinite scroll list, platform badges, staleness indicator
// POST /api/prospects to add, GET /api/prospects with filters
import React, { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { prospectsApi }  from '@/api/prospects';
import { queryClient }   from '@/lib/queryClient';
import { queryKeys }     from '@/lib/queryKeys';
import { useToast }      from '@/hooks/useToast';
import { createProspectSchema, type CreateProspectSchema } from '@/lib/schemas';
import { Button }        from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Badge, PlatformBadge } from '@/components/ui/Badge';
import { Avatar }        from '@/components/ui/Avatar';
import { Modal }         from '@/components/ui/Modal';
import { Skeleton }      from '@/components/ui/Skeleton';
import { EmptyState, Spinner } from '@/components/common/index';
import { PLATFORM_LABELS, PROSPECT_STATUS_LABELS } from '@/lib/constants';
import { formatRelativeDate, cn } from '@/lib/utils';
import { Users, Plus, ChevronRight, Search } from 'lucide-react';
import type { Prospect } from '@/api/types';

const STATUS_TABS = [
  { value: '',          label: 'All'      },
  { value: 'active',    label: 'Active'   },
  { value: 'stale',     label: 'Stale'    },
  { value: 'converted', label: 'Converted'},
  { value: 'lost',      label: 'Lost'     },
];

function ProspectRow({ prospect }: { prospect: Prospect }) {
  const navigate = useNavigate();
  return (
    <div
      onClick={() => navigate(`/prospects/${prospect.id}`)}
      className="flex items-center gap-3 px-4 py-3 hover:bg-surface-hover cursor-pointer border-b border-surface-border last:border-0 transition-colors"
    >
      <Avatar name={prospect.name} size="md" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-text-primary truncate">{prospect.name}</p>
          {prospect.is_stale && (
            <span className="w-1.5 h-1.5 rounded-full bg-warning shrink-0" title="Stale" />
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {prospect.company && (
            <span className="text-xs text-text-muted truncate">{prospect.company}</span>
          )}
          {prospect.platform && (
            <PlatformBadge platform={prospect.platform} />
          )}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <Badge
          variant={
            prospect.status === 'converted' ? 'green' :
            prospect.status === 'lost'      ? 'red'   :
            prospect.status === 'stale'     ? 'yellow': 'blue'
          }
          size="xs"
        >
          {PROSPECT_STATUS_LABELS[prospect.status]}
        </Badge>
        <p className="text-xs text-text-muted mt-0.5">
          {formatRelativeDate(prospect.last_contact_at ?? prospect.created_at)}
        </p>
      </div>
      <ChevronRight size={14} className="text-text-muted shrink-0" />
    </div>
  );
}

function AddProspectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { showToast } = useToast();
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm<CreateProspectSchema>({ resolver: zodResolver(createProspectSchema) });

  const createMutation = useMutation({
    mutationFn: (d: CreateProspectSchema) => prospectsApi.create(d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.prospects() });
      showToast('Prospect added!', 'success');
      reset();
      onClose();
    },
    onError: () => showToast('Could not add prospect.', 'error'),
  });

  return (
    <Modal isOpen={open} onClose={onClose} title="Add prospect" size="md">
      <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-4">
        <Input label="Name" required error={errors.name?.message} {...register('name')} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Company" {...register('company')} />
          <Input label="Title / Role" {...register('title')} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Email" type="email" {...register('email')} />
          <Select
            label="Platform"
            options={[
              { value: '', label: 'None' },
              ...Object.entries(PLATFORM_LABELS).map(([v, l]) => ({ value: v, label: l })),
            ]}
            {...register('platform')}
          />
        </div>
        <Input label="LinkedIn URL" placeholder="https://linkedin.com/in/…" {...register('linkedin_url')} />
        <Textarea
          label="Notes"
          placeholder="How you met, context, mutual connections…"
          rows={3}
          maxLength={2000}
          showCount
          {...register('notes')}
        />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>Cancel</Button>
          <Button size="sm" type="submit" isLoading={createMutation.isPending || isSubmitting}>
            Add prospect
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function ProspectsPage() {
  const [statusFilter, setStatusFilter] = useState('');
  const [search,       setSearch]       = useState('');
  const [addOpen,      setAddOpen]      = useState(false);
  const loaderRef = useRef<HTMLDivElement>(null);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useInfiniteQuery({
      queryKey: queryKeys.prospects({ status: statusFilter, search }),
      queryFn:  ({ pageParam = 1 }) =>
        prospectsApi.list({ page: pageParam, limit: 25, status: statusFilter || undefined, search: search || undefined })
          .then((r) => r.data),
      getNextPageParam: (last) =>
        last.pagination.has_more ? last.pagination.page + 1 : undefined,
      initialPageParam: 1,
      staleTime: 60_000,
    });

  // Intersection observer for infinite scroll
  const observerCb = useCallback((entries: IntersectionObserverEntry[]) => {
    if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  React.useEffect(() => {
    const el = loaderRef.current;
    if (!el) return;
    const ob = new IntersectionObserver(observerCb, { rootMargin: '200px' });
    ob.observe(el);
    return () => ob.disconnect();
  }, [observerCb]);

  const allProspects = data?.pages.flatMap((p) => p.prospects) ?? [];

  return (
    <div className="page-container space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-text-primary">Prospects</h1>
        <Button leftIcon={<Plus size={14} />} onClick={() => setAddOpen(true)}>
          Add prospect
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or company…"
          className="w-full pl-9 pr-4 py-2 text-sm border border-surface-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setStatusFilter(t.value)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors',
              statusFilter === t.value
                ? 'bg-brand text-white'
                : 'text-text-muted hover:bg-surface-hover',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="w-9 h-9 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        ) : allProspects.length === 0 ? (
          <EmptyState
            icon={<Users size={28} />}
            headline="No prospects yet"
            subline="Add your first prospect to start tracking relationships."
            action={{ label: 'Add prospect', onClick: () => setAddOpen(true) }}
          />
        ) : (
          <>
            {allProspects.map((p) => <ProspectRow key={p.id} prospect={p} />)}
            <div ref={loaderRef} className="h-4 flex items-center justify-center">
              {isFetchingNextPage && <Spinner size="sm" />}
            </div>
          </>
        )}
      </div>

      <AddProspectModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}
