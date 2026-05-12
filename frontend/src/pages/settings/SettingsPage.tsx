// FILE: src/pages/settings/SettingsPage.tsx
// Profile update + account danger zone
// PUT /api/auth/me, DELETE /api/auth/account
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { authApi }     from '@/api/auth';
import { queryClient } from '@/lib/queryClient';
import { queryKeys }   from '@/lib/queryKeys';
import { useAuth }     from '@/hooks/useAuth';
import { useToast }    from '@/hooks/useToast';
import { updateProfileSchema, type UpdateProfileSchema } from '@/lib/schemas';
import { Button }      from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Modal }       from '@/components/ui/Modal';
import { Badge }       from '@/components/ui/Badge';
import { PLATFORM_LABELS } from '@/lib/constants';
import { ChevronRight, Shield, Bell, Mic2, Brain, Users, Trash2 } from 'lucide-react';

const SETTINGS_NAV = [
  { path: '/settings/voice',         label: 'Voice profile',     icon: <Mic2  size={16} />, desc: 'Customize your AI outreach style'  },
  { path: '/settings/memory',        label: 'AI Memory',         icon: <Brain size={16} />, desc: 'Facts Clutch remembers about you'   },
  { path: '/settings/notifications', label: 'Notifications',     icon: <Bell  size={16} />, desc: 'Push & email preferences'           },
  { path: '/settings/members',       label: 'Team members',      icon: <Users size={16} />, desc: 'Invite & manage workspace members', adminOnly: true },
];

export default function SettingsPage() {
  const navigate       = useNavigate();
  const { user, logout } = useAuth();
  const { showToast }  = useToast();
  const [deleteOpen,   setDeleteOpen]  = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');

  const { register, handleSubmit, formState: { errors, isDirty, isSubmitting } } =
    useForm<UpdateProfileSchema>({
      resolver:      zodResolver(updateProfileSchema),
      defaultValues: {
        name:               user?.name               ?? '',
        business_name:      user?.business_name      ?? '',
        product_description:user?.product_description?? '',
        target_audience:    user?.target_audience    ?? '',
        website:            user?.website            ?? '',
        role:               user?.role               ?? '',
        industry:           user?.industry           ?? '',
        experience_level:   user?.experience_level   ?? '',
        bio:                user?.bio                ?? '',
      },
    });

  const updateMutation = useMutation({
    mutationFn: (d: UpdateProfileSchema) => authApi.updateMe(d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.me });
      showToast('Profile saved.', 'success');
    },
    onError: () => showToast('Could not save profile.', 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => authApi.deleteAccount(),
    onSuccess: async () => {
      await logout();
      navigate('/login');
    },
    onError: () => showToast('Could not delete account.', 'error'),
  });

  return (
    <div className="page-container max-w-2xl space-y-6">
      <h1 className="text-xl font-bold text-text-primary">Settings</h1>

      {/* Profile form */}
      <form onSubmit={handleSubmit((d) => updateMutation.mutate(d))} className="space-y-4">
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
              isLoading={updateMutation.isPending || isSubmitting}
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
            onClick={() => navigate(item.path)}
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
              isLoading={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              Delete permanently
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
