// FILE: src/pages/settings/VoiceProfilePage.tsx
// STATIC DEMO BUILD — all data is hardcoded locally for screenshots.
// No network calls, no react-query, no loading states.
import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { voiceProfileSchema, type VoiceProfileSchema } from '@/lib/schemas';
import { Button }        from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Modal }         from '@/components/ui/Modal';
import { Mic2, RefreshCw, Edit2, Sparkles, Clock } from 'lucide-react';
import type { VoiceProfile } from '@/api/types';

// ---------------------------------------------------------------------------
// Hardcoded demo data — stands in for GET /api/onboarding/status
// ---------------------------------------------------------------------------
const DEMO_VOICE_PROFILE: VoiceProfile = {
  unique_value_prop:
    'We cut new-hire ramp time in half by pairing every rep with an AI coach that listens to live calls and nudges them in real time — not just after-the-fact scorecards.',
  target_customer_description:
    'VP or Director of Sales at a 50–300 person B2B SaaS company running an outbound or hybrid sales motion, usually with 8+ reps and at least one dedicated sales enablement hire.',
  icp_trigger:
    'They just hired 3+ new AEs in the last quarter and ramp time is eating into their pipeline targets, or their top rep is about to go on leave and they have no way to replicate that playbook.',
  main_objection:
    "We already have Gong/Chorus for call recording, so we don't need another tool watching our calls.",
  objection_reframe:
    "Gong tells you what happened after the call ends. We're live in the call with the rep, so the coaching lands while it still changes the outcome — think of us as the co-pilot, Gong as the flight recorder.",
  best_proof_point:
    'Vantar Health cut average ramp time from 96 days to 47 days across 14 new AEs in their first full quarter using us, with a 22% lift in second-call show rate.',
  voice_style:
    'Direct and a little irreverent. Short sentences. No corporate jargon like "synergy" or "leverage." Confident but never salesy — reads like a sharp peer, not a pitch deck.',
  outreach_persona:
    'Founder-to-founder energy. Curious first, pitchy second. Leads with a specific observation about their team, not a generic hook.',
  avoid_phrases: [
    'circle back',
    'synergy',
    'game-changer',
    'best-in-class',
    'touch base',
    'move the needle',
    "I'll let you go",
  ],
} as VoiceProfile;

const LAST_REBUILT_AT = 'Sep 3, 2026 · 9:14 AM';
const SOURCE_CALLS_ANALYZED = 128;

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
      <p className="text-sm text-text-primary leading-relaxed">{value}</p>
    </div>
  );
}

export default function VoiceProfilePage() {
  const [editOpen, setEditOpen] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [vp, setVp] = useState<VoiceProfile>(DEMO_VOICE_PROFILE);
  const [lastRebuilt, setLastRebuilt] = useState(LAST_REBUILT_AT);

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm<VoiceProfileSchema>({
      resolver:      zodResolver(voiceProfileSchema),
      defaultValues: vp as unknown as VoiceProfileSchema,
    });

  // Local, in-memory "rebuild" — no network call, just a brief simulated delay
  // so the loading state on the button is still demoable.
  const handleRebuild = () => {
    setIsRebuilding(true);
    setTimeout(() => {
      setIsRebuilding(false);
      setLastRebuilt('Just now');
    }, 900);
  };

  // Local, in-memory "save" — just writes back to component state.
  const onSubmit = (d: VoiceProfileSchema) => {
    setVp((prev) => ({ ...prev, ...(d as unknown as VoiceProfile) }));
    setEditOpen(false);
  };

  const openEdit = () => {
    reset(vp as unknown as VoiceProfileSchema);
    setEditOpen(true);
  };

  return (
    <div className="page-container max-w-2xl space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <Mic2 size={16} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-text-primary">Voice profile</h1>
            <p className="text-sm text-text-muted mt-0.5">
              Learned from {SOURCE_CALLS_ANALYZED} analyzed calls · last rebuilt {lastRebuilt}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshCw size={12} className={isRebuilding ? 'animate-spin' : ''} />}
            isLoading={isRebuilding}
            onClick={handleRebuild}
          >
            Rebuild
          </Button>
          <Button size="sm" leftIcon={<Edit2 size={12} />} onClick={openEdit}>
            Edit
          </Button>
        </div>
      </div>

      <div className="bg-white border border-surface-border rounded-lg p-5 space-y-4">
        <div className="flex items-center gap-1.5 text-xs text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-md px-2.5 py-1.5 w-fit">
          <Sparkles size={12} />
          <span>Generated from your last 90 days of outbound activity</span>
        </div>

        <VoiceField label="Unique value prop"       value={vp.unique_value_prop}           />
        <VoiceField label="Target customer"         value={vp.target_customer_description} />
        <VoiceField label="ICP trigger"             value={vp.icp_trigger}                 />
        <VoiceField label="Main objection"          value={vp.main_objection}              />
        <VoiceField label="Objection reframe"       value={vp.objection_reframe}           />
        <VoiceField label="Best proof point"        value={vp.best_proof_point}            />
        <VoiceField label="Voice style"              value={vp.voice_style}                 />
        <VoiceField label="Outreach persona"        value={vp.outreach_persona}            />
        <VoiceField label="Phrases to avoid"        value={vp.avoid_phrases ?? []}         />

        <div className="flex items-center gap-1.5 text-xs text-text-muted pt-1 border-t border-surface-border">
          <Clock size={12} />
          <span>Last rebuilt {lastRebuilt}</span>
        </div>
      </div>

      {/* Edit modal */}
      <Modal isOpen={editOpen} onClose={() => setEditOpen(false)} title="Edit voice profile" size="lg">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
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
            <Button size="sm" type="submit" isLoading={isSubmitting}>Save</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
