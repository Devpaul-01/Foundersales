import React, { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { CopyButton } from '@/components/common/index';
import {
  Sparkles,
  Check,
  ChevronDown,
  ChevronUp,
  Save,
  RefreshCw,
  Edit3,
  X,
  Plus,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

type SectionKey = 'core' | 'hooks' | 'channels' | 'objections' | 'stories' | 'followups';

// ---------------------------------------------------------------------------
// Static demo data — no network calls, no loading states, no empty states.
// ---------------------------------------------------------------------------

const DEMO_STATUS = {
  business_name: 'Northbeam Analytics',
};

const DEMO_SAMPLE_MESSAGE = {
  based_on_opportunity: true,
  opportunity_context: 'r/SaaS — thread on manual reporting pain (312 upvotes)',
  sample_message:
    `Hey Priya — saw your comment about losing every Friday afternoon to pulling reports together for stakeholders. That exact pain is what pushed us to build Northbeam.\n\n` +
    `We work with data teams around 15–40 people who are stuck stitching together spreadsheets from six different tools before a Monday standup. Most get their weekly reporting down from 4 hours to about 20 minutes once dashboards are wired up.\n\n` +
    `Not trying to sell you anything here — just curious whether reporting is still a manual grind for your team, or if you've found a workaround already?`,
};

const DEMO_VOICE_PROFILE = {
  unique_value_prop: 'Cuts weekly reporting time from 4 hours to 20 minutes for data teams',
  icp_trigger: 'Friday afternoon, right after a stakeholder asks for numbers "by Monday"',
  voice_style: 'Direct, data-first, no-fluff',
  outreach_persona: 'Curious peer, not a salesperson',
  cta_style: 'Offer a 12-minute live dashboard audit, no deck',
  main_objection: "We already have a BI tool, we don't need another dashboard",
  objection_reframe:
    'Reframe as: this replaces the manual pull-and-clean step before your BI tool, not the BI tool itself',
  best_proof_point: 'Beta customer Lattice Metrics cut reporting from 4 hrs to 20 min in the first sprint',
  opening_hooks: [
    'Does your Friday still disappear into reports?',
    'Saw your post about the reporting grind — that resonated',
    'Quick question about how your team pulls weekly numbers today',
    'What does your current reporting stack actually look like end to end?',
  ],
  avoid_phrases: ['synergy', 'game-changer', 'circle back', 'touch base', 'revolutionary'],
  story_vault: [
    {
      title: 'Lattice Metrics — 4hrs to 20min',
      quote:
        '"We used to have someone dedicated to Monday reporting. Now it just... exists. It updates itself."',
      outcome: 'Reporting time cut by 91%, saved ~15 hrs/week across the team',
    },
    {
      title: 'Fernhill Studio — first close in 9 days',
      quote:
        '"I was skeptical about another tool, but the audit call showed me exactly where we were bleeding time."',
      outcome: 'Closed from cold outreach to signed contract in 9 days',
    },
    {
      title: 'Torque Logistics — team-wide rollout',
      quote:
        '"Every ops lead has their own dashboard now instead of pinging me for numbers."',
      outcome: 'Rolled out to 22 seats within the first month',
    },
  ],
  follow_up_sequence: [
    'Day 2: Share the Lattice Metrics case study, no ask',
    'Day 5: Ask if reporting is still eating their Friday',
    'Day 9: Offer the 12-minute dashboard audit directly',
    'Day 14: Soft break-up message, leave the door open',
  ],
};

export default function OnboardingPreviewPage() {
  const [showEditor, setShowEditor] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionKey>('core');
  const [voiceProfile, setVoiceProfile] = useState<any>(DEMO_VOICE_PROFILE);
  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [isRegenerating, setIsRegenerating] = useState(false);

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
    setSaveStatus('saving');
    setTimeout(() => {
      setSaveStatus('saved');
      setIsDirty(false);
      setTimeout(() => setSaveStatus('idle'), 2000);
    }, 500);
  };

  const handleRegenerate = () => {
    setIsRegenerating(true);
    setTimeout(() => {
      setVoiceProfile(DEMO_VOICE_PROFILE);
      setIsDirty(false);
      setIsRegenerating(false);
    }, 700);
  };

  const handleComplete = () => {
    // Static demo — no navigation/network side effects.
  };

  const sections = [
    { id: 'core' as const, label: 'Core Positioning', icon: '🎯' },
    { id: 'hooks' as const, label: 'Opening Hooks', icon: '🎣' },
    { id: 'channels' as const, label: 'Channel Tones', icon: '📢' },
    { id: 'objections' as const, label: 'Objections', icon: '🛡️' },
    { id: 'stories' as const, label: 'Story Vault', icon: '📖' },
    { id: 'followups' as const, label: 'Follow-ups', icon: '⏰' },
  ];

  const status = DEMO_STATUS;
  const data = DEMO_SAMPLE_MESSAGE;

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
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-subtle border border-surface-border text-xs font-medium text-text-secondary">
            <span className="w-1.5 h-1.5 rounded-full bg-brand inline-block" />
            {status.business_name}
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-subtle border border-surface-border text-xs font-medium text-text-secondary">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 inline-block" />
            {voiceProfile.voice_style}
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-subtle border border-surface-border text-xs font-medium text-text-secondary">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
            {voiceProfile.outreach_persona}
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-subtle border border-surface-border text-xs font-medium text-text-secondary max-w-xs truncate">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block shrink-0" />
            <span className="truncate">{voiceProfile.unique_value_prop}</span>
          </span>
        </div>
      </div>

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
                    onClick={handleRegenerate}
                    isLoading={isRegenerating}
                    className="text-xs"
                  >
                    <RefreshCw size={12} className="mr-1" />
                    Regenerate
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={!isDirty || saveStatus === 'saving'}
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
                    <div className="space-y-2.5">
                      {(voiceProfile.story_vault || []).map((story: any, idx: number) => (
                        <div key={idx} className="rounded-lg border border-surface-border bg-surface-subtle p-3.5">
                          <p className="text-sm font-semibold text-text-primary">{story.title}</p>
                          <p className="text-xs text-text-muted mt-1 line-clamp-2 leading-relaxed">{story.quote}</p>
                          <p className="text-xs font-medium text-success mt-1.5">{story.outcome}</p>
                        </div>
                      ))}
                    </div>
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
            {data.based_on_opportunity && data.opportunity_context && (
              <p className="text-xs text-text-muted mt-0.5 truncate max-w-xs">
                Based on: {data.opportunity_context}
              </p>
            )}
          </div>
          <CopyButton text={data.sample_message} />
        </div>

        {/* Message body */}
        <div className="px-5 py-4">
          <p className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap">
            {data.sample_message}
          </p>
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
        >
          Let's go →
        </Button>
      </div>
    </div>
  );
}
