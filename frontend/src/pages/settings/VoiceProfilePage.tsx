// FILE: src/pages/settings/VoiceProfilePage.tsx
// GET /api/onboarding/status — voice_profile display + manual edit
// POST /api/onboarding/rebuild-voice-profile
// PUT  /api/onboarding/profile
import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { onboardingApi } from '@/api/onboarding';
import { queryClient }   from '@/lib/queryClient';
import { queryKeys }     from '@/lib/queryKeys';
import { useToast }      from '@/hooks/useToast';
import { voiceProfileSchema, type VoiceProfileSchema } from '@/lib/schemas';
import { Button }        from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Modal }         from '@/components/ui/Modal';
import { Skeleton }      from '@/components/ui/Skeleton';
import { InlineAlert }   from '@/components/common/index';
import { Mic2, RefreshCw, Edit2, X, Plus } from 'lucide-react';
import type { VoiceProfile } from '@/api/types';

function VoiceField({ label, value }: { label: string; value: string | string[] }) {
  if (Array.isArray(value)) {
    return (
      <div>
        <p className="text-xs text-text-muted mb-1">{label}</p>
        <div className="flex flex-wrap gap-1.5">
          {value.map((v) => (
            <span key={v} className="px-2 py-0.5 rounded bg-slate-100 text-xs text-text-secondary">{v}</span>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div>
      <p className="text-xs text-text-muted mb-0.5">{label}</p>
      <p className="text-sm text-text-primary">{value}</p>
    </div>
  );
}

export default function VoiceProfilePage() {
  const { showToast } = useToast();
  const [editOpen,    setEditOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.onboardingStatus,
    queryFn:  () => onboardingApi.getStatus().then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  const rebuildMutation = useMutation({
    mutationFn: () => onboardingApi.rebuildVoiceProfile(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.onboardingStatus });
      showToast('Voice profile rebuilt!', 'success');
    },
    onError: () => showToast('Could not rebuild voice profile.', 'error'),
  });

  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting } } =
    useForm<VoiceProfileSchema>({
      resolver:      zodResolver(voiceProfileSchema),
      defaultValues: data?.voice_profile as VoiceProfileSchema | undefined,
    });

  // Sync form defaults when data loads
  React.useEffect(() => {
    if (data?.voice_profile) {
      Object.entries(data.voice_profile).forEach(([k, v]) => {
        setValue(k as keyof VoiceProfileSchema, v as any);
      });
    }
  }, [data, setValue]);

  const saveMutation = useMutation({
    mutationFn: (d: VoiceProfileSchema) => onboardingApi.updateVoiceProfile(d as VoiceProfile),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.onboardingStatus });
      showToast('Voice profile saved.', 'success');
      setEditOpen(false);
    },
    onError: () => showToast('Could not save.', 'error'),
  });

  const vp = data?.voice_profile;

  return (
    <div className="page-container max-w-2xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-text-primary">Voice profile</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshCw size={12} className={rebuildMutation.isPending ? 'animate-spin' : ''} />}
            isLoading={rebuildMutation.isPending}
            onClick={() => rebuildMutation.mutate()}
          >
            Rebuild
          </Button>
          {vp && (
            <Button size="sm" leftIcon={<Edit2 size={12} />} onClick={() => setEditOpen(true)}>
              Edit
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12" rounded="lg" />
          ))}
        </div>
      ) : !vp ? (
        <InlineAlert type="warning" message="Complete onboarding to generate your voice profile." />
      ) : (
        <div className="bg-white border border-surface-border rounded-lg p-5 space-y-4">
          <VoiceField label="Unique value prop"       value={vp.unique_value_prop}           />
          <VoiceField label="Target customer"         value={vp.target_customer_description} />
          <VoiceField label="ICP trigger"             value={vp.icp_trigger}                 />
          <VoiceField label="Main objection"          value={vp.main_objection}              />
          <VoiceField label="Objection reframe"       value={vp.objection_reframe}           />
          <VoiceField label="Best proof point"        value={vp.best_proof_point}            />
          <VoiceField label="Voice style"             value={vp.voice_style}                 />
          <VoiceField label="Outreach persona"        value={vp.outreach_persona}            />
          <VoiceField label="Phrases to avoid"        value={vp.avoid_phrases ?? []}         />
        </div>
      )}

      {/* Edit modal */}
      <Modal isOpen={editOpen} onClose={() => setEditOpen(false)} title="Edit voice profile" size="lg">
        <form onSubmit={handleSubmit((d) => saveMutation.mutate(d))} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          <Textarea label="Unique value prop"   rows={2} error={errors.unique_value_prop?.message}           {...register('unique_value_prop')}           />
          <Textarea label="Target customer"     rows={2} error={errors.target_customer_description?.message} {...register('target_customer_description')} />
          <Textarea label="ICP trigger"         rows={2} error={errors.icp_trigger?.message}                 {...register('icp_trigger')}                 />
          <Textarea label="Main objection"      rows={2} error={errors.main_objection?.message}              {...register('main_objection')}              />
          <Textarea label="Objection reframe"   rows={2} error={errors.objection_reframe?.message}           {...register('objection_reframe')}           />
          <Textarea label="Best proof point"    rows={2} error={errors.best_proof_point?.message}            {...register('best_proof_point')}            />
          <Input    label="Voice style"         error={errors.voice_style?.message}                          {...register('voice_style')}                 />
          <Input    label="Outreach persona"    error={errors.outreach_persona?.message}                     {...register('outreach_persona')}            />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" size="sm" type="button" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button size="sm" type="submit" isLoading={saveMutation.isPending || isSubmitting}>Save</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
