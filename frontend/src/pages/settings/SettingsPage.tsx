// FILE: src/pages/settings/SettingsPage.tsx
// Demo build — static local data, no API calls
import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { updateProfileSchema, type UpdateProfileSchema } from '@/lib/schemas';
import { Button }      from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Modal }       from '@/components/ui/Modal';
import { ChevronRight, Bell, Mic2, Brain, Users, Trash2 } from 'lucide-react';

const SETTINGS_NAV = [
  { path: '/settings/voice',         label: 'Voice profile',     icon: <Mic2  size={16} />, desc: 'Customize your AI outreach style'  },
  { path: '/settings/memory',        label: 'AI Memory',         icon: <Brain size={16} />, desc: 'Facts Clutch remembers about you'   },
  { path: '/settings/notifications', label: 'Notifications',     icon: <Bell  size={16} />, desc: 'Push & email preferences'           },
  { path: '/settings/members',       label: 'Team members',      icon: <Users size={16} />, desc: 'Invite & manage workspace members'  },
];

const DEMO_PROFILE: UpdateProfileSchema = {
  name:                'Priya Anand',
  business_name:       'Northwind Analytics',
  product_description:
    'Northwind Analytics is a marketing attribution platform for B2B SaaS companies. We connect ad spend, CRM, and product usage data into a single pipeline so revenue teams can see which channels actually drive pipeline and close-won deals — not just clicks.',
  target_audience:
    'Series A–B B2B SaaS companies with 20–200 employees and an existing paid acquisition motion. Primary buyers are VP Marketing and RevOps leads.',
  website:             'https://northwindanalytics.io',
  role:                'founder',
  industry:            'saas',
  experience_level:    'intermediate',
  bio:
    'Second-time founder. Previously led growth at a Series C fintech startup. Based in Austin, TX. Focused on building Northwind into the default attribution layer for mid-market SaaS.',
};

export default function SettingsPage() {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [savedJustNow, setSavedJustNow] = useState(false);

  const { register, handleSubmit, formState: { errors, isDirty, isSubmitting } } =
    useForm<UpdateProfileSchema>({
      resolver:      zodResolver(updateProfileSchema),
      defaultValues: DEMO_PROFILE,
    });

  const onSubmit = (_d: UpdateProfileSchema) => {
    setSavedJustNow(true);
    setTimeout(() => setSavedJustNow(false), 2000);
  };

  return (
    <div className="page-container max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-text-primary">Settings</h1>
        {savedJustNow && (
          <span className="text-xs text-success font-medium">✓ Profile saved</span>
        )}
      </div>

      {/* Profile form */}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="bg-white border border-surface-border rounded-lg p-5 space-y-4">
          <p className="text-sm font-semibold text-text-primary">Profile</p>
          <Input label="Name" {...register('name')} error={errors.name?.message} />
          <Input label="Business name" {...register('business_name')} />
          <Textarea
            label="Product / service description"
            rows={3}
            maxLength={2000}
            showCount
            helperText="The more detail, the better Clutch's AI suggestions."
            {...register('product_description')}
          />
          <Textarea
            label="Target audience / ICP"
            rows={2}
            maxLength={1000}
            showCount
            {...register('target_audience')}
          />
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Role"
              options={[
                { value: '',          label: 'Select…'    },
                { value: 'founder',   label: 'Founder'    },
                { value: 'sales',     label: 'Sales rep'  },
                { value: 'freelancer',label: 'Freelancer' },
                { value: 'other',     label: 'Other'      },
              ]}
              {...register('role')}
            />
            <Select
              label="Industry"
              options={[
                { value: '',        label: 'Select…'     },
                { value: 'saas',    label: 'SaaS'        },
                { value: 'services',label: 'Services'    },
                { value: 'ecom',    label: 'E-commerce'  },
                { value: 'fintech', label: 'Fintech'     },
                { value: 'other',   label: 'Other'       },
              ]}
              {...register('industry')}
            />
          </div>
          <Input
            label="Website"
            placeholder="https://yoursite.com"
            type="url"
            {...register('website')}
            error={errors.website?.message}
          />
          <Textarea
            label="Bio"
            rows={2}
            maxLength={2000}
            showCount
            placeholder="A short bio for context…"
            {...register('bio')}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              type="submit"
              disabled={!isDirty}
              isLoading={isSubmitting}
            >
              Save changes
            </Button>
          </div>
        </div>
      </form>

      {/* Quick nav links */}
      <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
        {SETTINGS_NAV.map((item) => (
          <button
            key={item.path}
            type="button"
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-hover border-b border-surface-border last:border-0 transition-colors text-left"
          >
            <span className="text-text-muted">{item.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary">{item.label}</p>
              <p className="text-xs text-text-muted">{item.desc}</p>
            </div>
            <ChevronRight size={14} className="text-text-muted shrink-0" />
          </button>
        ))}
      </div>

      {/* Danger zone */}
      <div className="border border-danger/30 rounded-lg p-5 space-y-3">
        <p className="text-sm font-semibold text-danger">Danger zone</p>
        <p className="text-sm text-text-secondary">
          Permanently delete your account and all associated data. This cannot be undone.
        </p>
        <Button
          variant="danger"
          size="sm"
          leftIcon={<Trash2 size={12} />}
          onClick={() => setDeleteOpen(true)}
        >
          Delete account
        </Button>
      </div>

      {/* Delete confirm */}
      <Modal isOpen={deleteOpen} onClose={() => { setDeleteOpen(false); setDeleteConfirm(''); }} title="Delete account?" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            This will permanently erase your account, workspace, and all data. There is no undo.
          </p>
          <Input
            label='Type "DELETE" to confirm'
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => { setDeleteOpen(false); setDeleteConfirm(''); }}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={deleteConfirm !== 'DELETE'}
              onClick={() => { setDeleteOpen(false); setDeleteConfirm(''); }}
            >
              Delete permanently
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
