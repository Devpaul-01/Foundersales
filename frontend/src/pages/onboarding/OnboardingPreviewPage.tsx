import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { onboardingApi } from '@/api/onboarding';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { Badge } from '@/components/ui/Badge';
import { CopyButton } from '@/components/common/index';
import { ROUTES } from '@/lib/constants';
import { 
  Sparkles, 
  Check, 
  ChevronDown, 
  ChevronUp, 
  Save, 
  RefreshCw,
  Edit3,
  X,
  Plus
} from 'lucide-react';
import { showToast } from '@/components/common/Toast';
import { motion, AnimatePresence } from 'framer-motion';

type SectionKey = 'core' | 'hooks' | 'channels' | 'objections' | 'stories' | 'followups';

export default function OnboardingPreviewPage() {
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
  const queryClient = useQueryClient();
  
  const [canProceed, setCanProceed] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionKey>('core');
  const [voiceProfile, setVoiceProfile] = useState<any>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Fetch sample message
  const { data, isLoading: sampleLoading } = useQuery({
    queryKey: ['onboarding', 'sample-message'],
    queryFn: () => onboardingApi.generateSampleMessage().then((r) => r.data),
    staleTime: Infinity,
    retry: 1,
  });

  // Fetch status (for business name)
  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ['onboarding', 'status'],
    queryFn: () => onboardingApi.getStatus().then((r) => r.data),
  });

  // Fetch voice profile for editing
  // Change enabled to true (fetch on page load)
const { data: voiceData, isLoading: voiceLoading, refetch: refetchVoice } = useQuery({
  queryKey: ['onboarding', 'voice-profile'],
  queryFn: () => onboardingApi.getVoiceProfile().then((r) => r.data),
  enabled: true, // ← Fetch immediately
});

// Then in the editor, you can still call refetchVoice() if needed

  useEffect(() => {
    if (voiceData?.voice_profile) {
      setVoiceProfile(voiceData.voice_profile);
    }
  }, [voiceData]);

  // Enforce 5-second minimum viewing time
  useEffect(() => {
    const timer = setTimeout(() => {
      setCanProceed(true);
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (updates: Partial<any>) => onboardingApi.updateVoiceProfile(updates),
    onSuccess: () => {
      setSaveStatus('saved');
      setIsDirty(false);
      showToast('Voice profile saved', 'success');
      setTimeout(() => setSaveStatus('idle'), 2000);
      queryClient.invalidateQueries({ queryKey: ['onboarding', 'voice-profile'] });
      queryClient.invalidateQueries({ queryKey: ['onboarding', 'sample-message'] });
      refetchStatus();
    },
    onError: () => {
      setSaveStatus('error');
      showToast('Failed to save', 'error');
      setTimeout(() => setSaveStatus('idle'), 2000);
    },
  });

  // Regenerate mutation
  // Replace the regenerateMutation I gave you with this:
const regenerateMutation = useMutation({
  mutationFn: () => onboardingApi.rebuildVoiceProfile().then(r => r.data),
  onSuccess: (res) => {
    setVoiceProfile(res.voice_profile);
    setIsDirty(false);
    showToast('Voice profile regenerated from your answers', 'success');
    queryClient.invalidateQueries({ queryKey: ['onboarding', 'voice-profile'] });
    queryClient.invalidateQueries({ queryKey: ['onboarding', 'sample-message'] });
    refetchStatus();
  },
  onError: () => showToast('Failed to regenerate', 'error'),
});
  

  const handleFieldChange = (path: string, value: any) => {
    setVoiceProfile((prev: any) => {
      const keys = path.split('.');
      const newProfile = { ...prev };
      let current = newProfile;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!current[keys[i]]) current[keys[i]] = {};
        current = current[keys[i]];
      }
      current[keys[keys.length - 1]] = value;
      return newProfile;
    });
    setIsDirty(true);
    setSaveStatus('idle');
  };

  const handleSave = () => {
    if (!isDirty) return;
    updateMutation.mutate(voiceProfile);
  };

  const handleComplete = () => {
    if (!canProceed || isNavigating) return;
    setIsNavigating(true);
    
    const needsPassword = localStorage.getItem('needs_password_set') === 'true';
    
    if (needsPassword) {
      navigate('/set-password', { replace: true });
    } else {
      navigate(ROUTES.HOME, { replace: true });
    }
  };

  const sections = [
    { id: 'core' as const, label: 'Core Positioning', icon: '🎯' },
    { id: 'hooks' as const, label: 'Opening Hooks', icon: '🎣' },
    { id: 'channels' as const, label: 'Channel Tones', icon: '📢' },
    { id: 'objections' as const, label: 'Objections', icon: '🛡️' },
    { id: 'stories' as const, label: 'Story Vault', icon: '📖' },
    { id: 'followups' as const, label: 'Follow-ups', icon: '⏰' },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="text-center pt-2 pb-1">
        <div className="relative w-14 h-14 mx-auto mb-4">
          <div className="absolute inset-0 rounded-2xl bg-brand-100 opacity-60 blur-sm" />
          <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-50 to-brand-100 border border-brand-200 flex items-center justify-center shadow-sm">
            <Sparkles className="text-brand" size={24} />
          </div>
        </div>
        <h1 className="text-[1.6rem] font-bold tracking-tight text-text-primary leading-tight">
          Here's what Clutch writes for you
        </h1>
        <p className="text-sm text-text-muted mt-1.5 leading-relaxed">
          A real outreach message, built around your voice and profile.
        </p>
      </div>

      {/* Voice profile summary + Edit button */}
      {status && (
        <div className="rounded-xl border border-surface-border bg-white shadow-sm overflow-hidden">
          {/* Card header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-border bg-surface-subtle">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-success/10">
                <Check size={11} className="text-success" strokeWidth={3} />
              </span>
              <span className="text-sm font-semibold text-text-primary">Your Clutch AI Profile</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowEditor(!showEditor)}
              className="text-text-muted hover:text-text-primary gap-1 -mr-1"
            >
              <Edit3 size={13} />
              {showEditor ? 'Close' : 'Edit'}
              {showEditor ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </Button>
          </div>

          {/* Profile chips */}
          <div className="px-5 py-4 flex flex-wrap gap-2">
            {status.business_name && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-subtle border border-surface-border text-xs font-medium text-text-secondary">
                <span className="w-1.5 h-1.5 rounded-full bg-brand inline-block" />
                {status.business_name}
              </span>
            )}
            {voiceProfile?.voice_style && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-subtle border border-surface-border text-xs font-medium text-text-secondary">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 inline-block" />
                {voiceProfile.voice_style}
              </span>
            )}
            {voiceProfile?.outreach_persona && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-subtle border border-surface-border text-xs font-medium text-text-secondary">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                {voiceProfile.outreach_persona}
              </span>
            )}
            {voiceProfile?.unique_value_prop && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-subtle border border-surface-border text-xs font-medium text-text-secondary max-w-xs truncate">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block shrink-0" />
                <span className="truncate">{voiceProfile.unique_value_prop}</span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Expandable Editor */}
      <AnimatePresence>
        {showEditor && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-xl border border-surface-border bg-white shadow-sm overflow-hidden">
              {/* Editor header */}
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-border bg-surface-subtle">
                <h3 className="text-sm font-semibold text-text-primary">Edit Voice Profile</h3>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => regenerateMutation.mutate()}
                    isLoading={regenerateMutation.isPending}
                    className="text-xs"
                  >
                    <RefreshCw size={12} className="mr-1" />
                    Regenerate
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={!isDirty || updateMutation.isPending}
                    variant={isDirty ? 'primary' : 'secondary'}
                    className="text-xs"
                  >
                    {saveStatus === 'saved' ? (
                      <><Check size={12} className="mr-1" /> Saved</>
                    ) : saveStatus === 'saving' ? (
                      'Saving...'
                    ) : (
                      <><Save size={12} className="mr-1" /> Save</>
                    )}
                  </Button>
                </div>
              </div>

              {/* Pill tabs */}
              <div className="px-5 pt-4 pb-1">
                <div className="flex gap-1 overflow-x-auto bg-surface-subtle rounded-lg p-1">
                  {sections.map(section => (
                    <button
                      key={section.id}
                      onClick={() => setActiveSection(section.id)}
                      className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap rounded-md ${
                        activeSection === section.id
                          ? 'bg-white text-text-primary shadow-sm border border-surface-border'
                          : 'text-text-muted hover:text-text-secondary'
                      }`}
                    >
                      <span>{section.icon}</span>
                      {section.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Editor Content */}
              {voiceLoading ? (
                <div className="space-y-3 px-5 py-4">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : voiceProfile ? (
                <div className="space-y-4 max-h-[400px] overflow-y-auto px-5 py-4">

                  {/* Core Positioning */}
                  {activeSection === 'core' && (
                    <div className="space-y-4">
                      {[
                        { label: 'Unique Value Prop', field: 'unique_value_prop', placeholder: 'e.g. Cuts reporting from 4 hours to 20 minutes', multiline: true },
                        { label: 'ICP Trigger', field: 'icp_trigger', placeholder: 'e.g. Friday at 2 PM, after a missed deadline' },
                        { label: 'Voice Style', field: 'voice_style', placeholder: 'e.g. direct, data-first, no-fluff' },
                        { label: 'CTA Style', field: 'cta_style', placeholder: 'e.g. book a 12-min live dashboard audit' },
                      ].map(({ label, field, placeholder, multiline }) => (
                        <div key={field}>
                          <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5">
                            {label}
                          </label>
                          {multiline ? (
                            <Textarea
                              rows={2}
                              value={voiceProfile[field] || ''}
                              onChange={(e) => handleFieldChange(field, e.target.value)}
                              className="text-sm"
                              placeholder={placeholder}
                            />
                          ) : (
                            <Input
                              value={voiceProfile[field] || ''}
                              onChange={(e) => handleFieldChange(field, e.target.value)}
                              placeholder={placeholder}
                              className="text-sm"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Opening Hooks */}
                  {activeSection === 'hooks' && (
                    <div>
                      <div className="flex justify-between items-center mb-3">
                        <label className="text-xs font-semibold text-text-muted uppercase tracking-wide">Opening Hooks</label>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const hooks = [...(voiceProfile.opening_hooks || []), ''];
                            handleFieldChange('opening_hooks', hooks);
                          }}
                          className="text-xs"
                        >
                          <Plus size={12} className="mr-1" /> Add Hook
                        </Button>
                      </div>
                      <div className="space-y-2">
                        {(voiceProfile.opening_hooks || []).map((hook: string, idx: number) => (
                          <div key={idx} className="flex gap-2 items-center">
                            <span className="text-xs font-mono text-text-muted w-5 shrink-0 text-right">{idx + 1}.</span>
                            <Input
                              value={hook}
                              onChange={(e) => {
                                const newHooks = [...(voiceProfile.opening_hooks || [])];
                                newHooks[idx] = e.target.value;
                                handleFieldChange('opening_hooks', newHooks);
                              }}
                              placeholder="Does your Friday still disappear into reports?"
                              className="flex-1 text-sm"
                            />
                            <button
                              onClick={() => {
                                const newHooks = [...(voiceProfile.opening_hooks || [])];
                                newHooks.splice(idx, 1);
                                handleFieldChange('opening_hooks', newHooks);
                              }}
                              className="text-text-muted hover:text-error transition-colors p-1 rounded"
                            >
                              <X size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Avoid Phrases */}
                  {activeSection === 'channels' && (
                    <div>
                      <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">
                        Phrases to Avoid
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {(voiceProfile.avoid_phrases || []).map((phrase: string, idx: number) => (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-error/8 border border-error/20 text-xs font-medium text-error"
                          >
                            {phrase}
                            <button
                              onClick={() => {
                                const newPhrases = [...(voiceProfile.avoid_phrases || [])];
                                newPhrases.splice(idx, 1);
                                handleFieldChange('avoid_phrases', newPhrases);
                              }}
                              className="hover:opacity-70 transition-opacity"
                            >
                              <X size={11} />
                            </button>
                          </span>
                        ))}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const newPhrases = [...(voiceProfile.avoid_phrases || []), ''];
                            handleFieldChange('avoid_phrases', newPhrases);
                          }}
                          className="text-xs"
                        >
                          <Plus size={11} className="mr-1" /> Add phrase
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Main Objection */}
                  {activeSection === 'objections' && (
                    <div className="space-y-4">
                      {[
                        { label: 'Main Objection', field: 'main_objection', placeholder: 'What makes people hesitate?' },
                        { label: 'Objection Reframe', field: 'objection_reframe', placeholder: 'How you respond' },
                        { label: 'Best Proof Point', field: 'best_proof_point', placeholder: 'e.g. Beta agencies cut reporting 4hrs→20min' },
                      ].map(({ label, field, placeholder }) => (
                        <div key={field}>
                          <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5">
                            {label}
                          </label>
                          <Textarea
                            rows={2}
                            value={voiceProfile[field] || ''}
                            onChange={(e) => handleFieldChange(field, e.target.value)}
                            placeholder={placeholder}
                            className="text-sm"
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Story Vault */}
                  {activeSection === 'stories' && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-semibold text-text-muted uppercase tracking-wide">Story Vault</label>
                      </div>
                      <p className="text-xs text-text-muted mb-3">
                        Your best client stories — used in outreach automatically.
                      </p>
                      {(voiceProfile.story_vault || []).length === 0 ? (
                        <div className="text-center py-6 rounded-lg border border-dashed border-surface-border">
                          <p className="text-sm text-text-muted">No stories yet.</p>
                          <p className="text-xs text-text-muted mt-0.5">Regenerate from answers or add manually.</p>
                        </div>
                      ) : (
                        <div className="space-y-2.5">
                          {(voiceProfile.story_vault || []).map((story: any, idx: number) => (
                            <div key={idx} className="rounded-lg border border-surface-border bg-surface-subtle p-3.5">
                              <p className="text-sm font-semibold text-text-primary">{story.title}</p>
                              <p className="text-xs text-text-muted mt-1 line-clamp-2 leading-relaxed">{story.quote}</p>
                              <p className="text-xs font-medium text-success mt-1.5">{story.outcome}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Follow-up Sequence */}
                  {activeSection === 'followups' && (
                    <div>
                      <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">
                        Follow-up Sequence
                      </label>
                      <div className="space-y-2">
                        {(voiceProfile.follow_up_sequence || []).map((step: string, idx: number) => (
                          <div key={idx} className="flex gap-2 items-center">
                            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-brand-50 border border-brand-100 text-[10px] font-bold text-brand shrink-0">
                              {idx + 1}
                            </span>
                            <Input
                              value={step}
                              onChange={(e) => {
                                const newSeq = [...(voiceProfile.follow_up_sequence || [])];
                                newSeq[idx] = e.target.value;
                                handleFieldChange('follow_up_sequence', newSeq);
                              }}
                              placeholder={`Step ${idx + 1} message`}
                              className="flex-1 text-sm"
                            />
                            <button
                              onClick={() => {
                                const newSeq = [...(voiceProfile.follow_up_sequence || [])];
                                newSeq.splice(idx, 1);
                                handleFieldChange('follow_up_sequence', newSeq);
                              }}
                              className="text-text-muted hover:text-error transition-colors p-1 rounded"
                            >
                              <X size={13} />
                            </button>
                          </div>
                        ))}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const seq = [...(voiceProfile.follow_up_sequence || []), ''];
                            handleFieldChange('follow_up_sequence', seq);
                          }}
                          className="text-xs mt-1"
                        >
                          <Plus size={12} className="mr-1" /> Add Follow-up Step
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-10 text-text-muted text-sm">Loading profile...</div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Generated message */}
      <div className="rounded-xl border border-brand-200 bg-white shadow-sm overflow-hidden">
        {/* Card header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-brand-100 bg-brand-50/50">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Generated outreach message</h3>
            {data?.based_on_opportunity && data.opportunity_context && (
              <p className="text-xs text-text-muted mt-0.5 truncate max-w-xs">
                Based on: {data.opportunity_context}
              </p>
            )}
          </div>
          {data?.sample_message && <CopyButton text={data.sample_message} />}
        </div>

        {/* Message body */}
        <div className="px-5 py-4">
          {sampleLoading ? (
            <div className="space-y-2.5">
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-5/6" />
              <Skeleton className="h-3.5 w-4/5" />
              <Skeleton className="h-3.5 w-3/4" />
            </div>
          ) : (
            <p className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap">
              {data?.sample_message ?? 'Could not generate a sample message — complete your profile first.'}
            </p>
          )}
        </div>

        <p className="text-xs text-text-muted px-5 pb-4 -mt-1">
          Edit your profile above to change the voice and tone.
        </p>
      </div>

      {/* CTA */}
      <div className="space-y-2 pt-1">
        <Button
          fullWidth
          size="md"
          onClick={handleComplete}
          disabled={!canProceed || isNavigating}
          className="relative"
        >
          {!canProceed ? (
            <span className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
              Setting up your workspace...
            </span>
          ) : (
            "Let's go →"
          )}
        </Button>
        {!canProceed && (
          <p className="text-xs text-text-muted text-center">
            Just a moment while we get everything ready
          </p>
        )}
      </div>
    </div>
  );
}
