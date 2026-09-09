// FILE: src/pages/prospects/ProspectsPage.tsx
// DEMO BUILD — all data is hardcoded locally for screenshot/demo purposes.
// No API calls, no react-query, no loading states. Fully offline.
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createProspectSchema, type CreateProspectSchema } from '@/lib/schemas';
import { Button }        from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Badge, PlatformBadge } from '@/components/ui/Badge';
import { Avatar }        from '@/components/ui/Avatar';
import { Modal }         from '@/components/ui/Modal';
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

// ---------------------------------------------------------------------------
// Hardcoded demo data — realistic, varied prospects across statuses/platforms
// ---------------------------------------------------------------------------
const DEMO_PROSPECTS: Prospect[] = [
  {
    id: 'p_1001',
    name: 'Elena Marsh',
    company: 'Northwind Capital',
    title: 'VP of Business Development',
    email: 'elena.marsh@northwindcap.com',
    linkedin_url: 'https://linkedin.com/in/elenamarsh',
    platform: 'linkedin',
    status: 'active',
    is_stale: false,
    notes: 'Met at the SaaStr conference. Interested in Q1 pilot.',
    created_at: '2026-06-02T14:20:00Z',
    last_contact_at: '2026-09-05T09:12:00Z',
  },
  {
    id: 'p_1002',
    name: 'Marcus Odeh',
    company: 'Fenwick & Rowe',
    title: 'Director of Partnerships',
    email: 'marcus@fenwickrowe.io',
    linkedin_url: 'https://linkedin.com/in/marcusodeh',
    platform: 'linkedin',
    status: 'active',
    is_stale: false,
    notes: 'Warm intro from Sarah. Following up after demo call.',
    created_at: '2026-07-14T11:05:00Z',
    last_contact_at: '2026-09-06T16:40:00Z',
  },
  {
    id: 'p_1003',
    name: 'Priya Natarajan',
    company: 'Cobalt Systems',
    title: 'Head of Growth',
    email: 'priya.n@cobaltsys.com',
    linkedin_url: 'https://linkedin.com/in/priyanatarajan',
    platform: 'twitter',
    status: 'stale',
    is_stale: true,
    notes: 'Reached out after her podcast episode on outbound sales.',
    created_at: '2026-05-20T08:30:00Z',
    last_contact_at: '2026-07-02T13:15:00Z',
  },
  {
    id: 'p_1004',
    name: 'Jonah Whitfield',
    company: 'Lumen Analytics',
    title: 'CEO',
    email: 'jonah@lumenanalytics.co',
    linkedin_url: 'https://linkedin.com/in/jonahwhitfield',
    platform: 'email',
    status: 'converted',
    is_stale: false,
    notes: 'Signed annual contract in August. Great champion internally.',
    created_at: '2026-04-11T10:00:00Z',
    last_contact_at: '2026-08-28T12:00:00Z',
  },
  {
    id: 'p_1005',
    name: 'Talia Reyes',
    company: 'Briarwood Partners',
    title: 'Investment Associate',
    email: 'talia.reyes@briarwoodvc.com',
    linkedin_url: 'https://linkedin.com/in/taliareyes',
    platform: 'linkedin',
    status: 'active',
    is_stale: false,
    notes: 'Exploring co-investment opportunities. Bi-weekly check-ins.',
    created_at: '2026-08-01T09:45:00Z',
    last_contact_at: '2026-09-07T10:20:00Z',
  },
  {
    id: 'p_1006',
    name: 'Derek Sun',
    company: 'Palmetto Foods',
    title: 'Procurement Manager',
    email: 'dsun@palmettofoods.com',
    linkedin_url: '',
    platform: 'phone',
    status: 'lost',
    is_stale: false,
    notes: 'Went with a competitor due to pricing. Revisit in 6 months.',
    created_at: '2026-03-18T15:30:00Z',
    last_contact_at: '2026-06-10T11:00:00Z',
  },
  {
    id: 'p_1007',
    name: 'Aisha Bello',
    company: 'Kestrel Media Group',
    title: 'Marketing Director',
    email: 'aisha.bello@kestrelmedia.com',
    linkedin_url: 'https://linkedin.com/in/aishabello',
    platform: 'linkedin',
    status: 'active',
    is_stale: false,
    notes: 'Referred by Jonah Whitfield. Scheduling intro call next week.',
    created_at: '2026-08-22T13:10:00Z',
    last_contact_at: '2026-09-04T08:55:00Z',
  },
  {
    id: 'p_1008',
    name: 'Connor Blake',
    company: 'Ashford & Vale',
    title: 'Chief of Staff',
    email: 'connor.blake@ashfordvale.com',
    linkedin_url: 'https://linkedin.com/in/connorblake',
    platform: 'twitter',
    status: 'stale',
    is_stale: true,
    notes: 'No response after two follow-ups. Try a different channel.',
    created_at: '2026-05-05T09:00:00Z',
    last_contact_at: '2026-06-25T14:30:00Z',
  },
  {
    id: 'p_1009',
    name: 'Ines Cordova',
    company: 'Solstice Ventures',
    title: 'Principal',
    email: 'ines@solsticevc.com',
    linkedin_url: 'https://linkedin.com/in/inescordova',
    platform: 'email',
    status: 'active',
    is_stale: false,
    notes: 'Sent updated deck. Awaiting feedback from her partners.',
    created_at: '2026-07-30T16:00:00Z',
    last_contact_at: '2026-09-01T09:30:00Z',
  },
  {
    id: 'p_1010',
    name: 'Owen Fitzgerald',
    company: 'Harrow Industrial',
    title: 'VP of Operations',
    email: 'owen.fitzgerald@harrowind.com',
    linkedin_url: 'https://linkedin.com/in/owenfitzgerald',
    platform: 'linkedin',
    status: 'converted',
    is_stale: false,
    notes: 'Closed mid-tier plan. Upsell opportunity in Q1.',
    created_at: '2026-02-09T12:20:00Z',
    last_contact_at: '2026-08-15T10:10:00Z',
  },
  {
    id: 'p_1011',
    name: 'Yuki Tanaka',
    company: 'Meridian Robotics',
    title: 'Founder & CEO',
    email: 'yuki@meridianrobotics.ai',
    linkedin_url: 'https://linkedin.com/in/yukitanaka',
    platform: 'linkedin',
    status: 'active',
    is_stale: false,
    notes: 'Deep technical fit. Wants a security review before rollout.',
    created_at: '2026-08-10T11:40:00Z',
    last_contact_at: '2026-09-07T15:05:00Z',
  },
  {
    id: 'p_1012',
    name: 'Grace Holloway',
    company: 'Birchfield Legal',
    title: 'Managing Partner',
    email: 'grace.holloway@birchfieldlegal.com',
    linkedin_url: '',
    platform: 'phone',
    status: 'lost',
    is_stale: false,
    notes: 'Budget frozen for the year. Follow up in January.',
    created_at: '2026-01-25T10:15:00Z',
    last_contact_at: '2026-04-02T09:00:00Z',
  },
] as unknown as Prospect[];

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
  const { register, handleSubmit, reset, formState: { errors } } =
    useForm<CreateProspectSchema>({ resolver: zodResolver(createProspectSchema) });

  // Demo-only submit handler — no network call, just closes the modal.
  const onSubmit = (_d: CreateProspectSchema) => {
    reset();
    onClose();
  };

  return (
    <Modal isOpen={open} onClose={onClose} title="Add prospect" size="md">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
          <Button size="sm" type="submit">
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

  // Local, static filtering over hardcoded data — no fetching involved.
  const filteredProspects = DEMO_PROSPECTS.filter((p) => {
    const matchesStatus = !statusFilter || p.status === statusFilter;
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      p.name.toLowerCase().includes(q) ||
      (p.company ?? '').toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  });

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
        {filteredProspects.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-14 px-6 text-center">
            <div className="w-12 h-12 rounded-full bg-surface-hover flex items-center justify-center text-text-muted">
              <Users size={22} />
            </div>
            <div>
              <p className="text-sm font-semibold text-text-primary">No matching prospects</p>
              <p className="text-xs text-text-muted mt-1">Try a different search term or status filter.</p>
            </div>
          </div>
        ) : (
          filteredProspects.map((p) => <ProspectRow key={p.id} prospect={p} />)
        )}
      </div>

      <AddProspectModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}
