// FILE: src/pages/prospects/ProspectDetailPage.tsx
// DEMO BUILD — all data is hardcoded locally for screenshot/demo purposes.
// No API calls, no react-query, no loading states. Fully offline.
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { updateProspectSchema, type UpdateProspectSchema } from '@/lib/schemas';
import { Button }        from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Badge, PlatformBadge } from '@/components/ui/Badge';
import { Avatar }        from '@/components/ui/Avatar';
import { Modal }         from '@/components/ui/Modal';
import { Tabs }          from '@/components/ui/Tabs';
import { PLATFORM_LABELS, PROSPECT_STATUS_LABELS } from '@/lib/constants';
import { formatShortDate, formatRelativeDate } from '@/lib/utils';
import {
  ArrowLeft, ExternalLink, MessageCircle,
  Edit2, Trash2, Mail, Building2,
} from 'lucide-react';

const DETAIL_TABS = [
  { value: 'overview',      label: 'Overview'      },
  { value: 'opportunities', label: 'Opportunities' },
  { value: 'activity',      label: 'Activity'      },
];

// ---------------------------------------------------------------------------
// Hardcoded demo record — a single, fully-populated prospect for screenshots
// ---------------------------------------------------------------------------
const DEMO_PROSPECT = {
  id: 'p_1001',
  name: 'Elena Marsh',
  company: 'Northwind Capital',
  title: 'VP of Business Development',
  email: 'elena.marsh@northwindcap.com',
  linkedin_url: 'https://linkedin.com/in/elenamarsh',
  platform: 'linkedin',
  status: 'active',
  is_stale: false,
  notes:
    'Met Elena at the SaaStr Annual conference in June — she runs BD for Northwind\'s growth-stage portfolio companies. ' +
    'She\'s looking for a way to standardize outbound relationship tracking across ~14 portfolio teams. ' +
    'Budget authority sits with her, but final sign-off needs her CFO. Prefers async updates over calls when possible.',
  created_at: '2026-06-02T14:20:00Z',
  last_contact_at: '2026-09-05T09:12:00Z',
} as const;

const DEMO_OPPORTUNITIES = [
  {
    id: 'opp_2001',
    company_name: 'Northwind Capital — Platform Rollout',
    stage: 'Proposal sent',
    status: 'open',
  },
  {
    id: 'opp_2002',
    company_name: 'Northwind Portfolio — Brightline Co',
    stage: 'Discovery',
    status: 'open',
  },
  {
    id: 'opp_2003',
    company_name: 'Northwind Portfolio — Ferro Systems',
    stage: 'Closed won',
    status: 'won',
  },
];

const DEMO_INTEL = [
  {
    label: 'Recent activity',
    content:
      'Posted on LinkedIn last week about scaling BD ops across a portfolio without adding headcount — strong signal for our multi-team pricing tier.',
  },
  {
    label: 'Company context',
    content:
      'Northwind Capital closed a $180M growth fund in Q2 and is actively pushing operational tooling standardization across its 14 portfolio companies.',
  },
  {
    label: 'Talking points',
    content:
      'Lead with the multi-workspace rollout story from Ferro Systems (already closed won) — Elena referenced wanting proof points from similar portfolio deployments.',
  },
  {
    label: 'Relationship notes',
    content:
      'Warm and responsive over email, slower on LinkedIn. Two prior calls have run long — she likes to go deep on implementation details.',
  },
];

const DEMO_ACTIVITY = [
  { label: 'Added',              date: '2026-06-02T14:20:00Z' },
  { label: 'First outreach',     date: '2026-06-05T10:00:00Z' },
  { label: 'Intro call',         date: '2026-06-18T15:30:00Z' },
  { label: 'Demo scheduled',     date: '2026-07-09T11:00:00Z' },
  { label: 'Proposal sent',      date: '2026-08-20T13:45:00Z' },
  { label: 'Last contact',       date: '2026-09-05T09:12:00Z' },
];

export default function ProspectDetailPage() {
  const navigate      = useNavigate();
  const [tab,         setTab]         = useState('overview');
  const [editOpen,    setEditOpen]    = useState(false);
  const [deleteOpen,  setDeleteOpen]  = useState(false);

  const prospect      = DEMO_PROSPECT;
  const opportunities = DEMO_OPPORTUNITIES;
  const intel         = DEMO_INTEL;

  const { register, handleSubmit, reset, formState: { errors } } =
    useForm<UpdateProspectSchema>({
      resolver:      zodResolver(updateProspectSchema),
      defaultValues: prospect as unknown as UpdateProspectSchema,
    });

  // Demo-only handlers — no network calls, just local UI state changes.
  const onSaveEdit = (_d: UpdateProspectSchema) => {
    setEditOpen(false);
  };
  const onConfirmDelete = () => {
    setDeleteOpen(false);
    navigate('/prospects');
  };
  const onOpenChat = () => {
    navigate('/chat/demo-chat-1001');
  };

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
            <Button size="sm" variant="ghost" leftIcon={<Edit2 size={12} />} onClick={() => { reset(prospect as unknown as UpdateProspectSchema); setEditOpen(true); }}>
              Edit
            </Button>
            <Button
              size="sm"
              leftIcon={<MessageCircle size={12} />}
              onClick={onOpenChat}
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
          <div className="bg-white border border-surface-border rounded-lg p-5">
            <p className="text-xs font-semibold text-text-primary mb-2">Notes</p>
            <p className="text-sm text-text-secondary whitespace-pre-wrap">{prospect.notes}</p>
          </div>
          <div className="bg-white border border-surface-border rounded-lg p-5 space-y-3">
            <p className="text-xs font-semibold text-text-primary">AI intelligence</p>
            {intel.map((item, i) => (
              <div key={i} className="space-y-1">
                <p className="text-xs font-medium text-text-muted uppercase tracking-wide">{item.label}</p>
                <p className="text-sm text-text-secondary">{item.content}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Opportunities tab */}
      {tab === 'opportunities' && (
        <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
          {opportunities.map((opp) => (
            <div
              key={opp.id}
              onClick={() => navigate(`/opportunities/${opp.id}`)}
              className="flex items-center justify-between px-4 py-3 hover:bg-surface-hover cursor-pointer border-b border-surface-border last:border-0"
            >
              <div>
                <p className="text-sm font-medium text-text-primary">{opp.company_name}</p>
                <p className="text-xs text-text-muted mt-0.5">{opp.stage}</p>
              </div>
              <Badge variant={opp.status === 'won' ? 'green' : 'blue'} size="xs">{opp.status}</Badge>
            </div>
          ))}
        </div>
      )}

      {/* Activity tab */}
      {tab === 'activity' && (
        <div className="bg-white border border-surface-border rounded-lg p-5">
          <div className="space-y-1">
            {DEMO_ACTIVITY.map((event, i) => (
              <div key={i} className="flex items-center justify-between text-sm py-1">
                <span className="text-text-muted">{event.label}</span>
                <span className="text-text-primary">
                  {event.label === 'Last contact'
                    ? formatRelativeDate(event.date)
                    : formatShortDate(event.date)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Edit modal */}
      <Modal isOpen={editOpen} onClose={() => setEditOpen(false)} title="Edit prospect" size="md">
        <form onSubmit={handleSubmit(onSaveEdit)} className="space-y-4">
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
              <Button size="sm" type="submit">Save</Button>
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
          <Button variant="danger" size="sm" onClick={onConfirmDelete}>
            Delete
          </Button>
        </div>
      </Modal>
    </div>
  );
}
