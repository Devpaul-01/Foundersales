// ============================================================
// FILE: src/pages/calendar/CalendarEventDetailPage.tsx — DEMO/STATIC BUILD
//
// NOTE: This is a frontend-only demo build for screenshots.
// All data is hardcoded locally. There are NO network calls,
// no react-query, no mutations, no realtime channels, and no
// loading/skeleton states. Tabs, the debrief modal, follow-up
// "mark sent" toggling, and commitment "done" toggling still
// work — they just operate on local component state seeded
// with realistic static data instead of a server.
// ============================================================
import React, { useState } from 'react';
import { format, parseISO, subDays } from 'date-fns';
import {
  ArrowLeft, Calendar, MessageCircle, Search,
  CheckCircle2, Clock, AlertTriangle, RefreshCw, Mail, Mic,
} from 'lucide-react';

// ── Local UI primitives ───────────────────────────────────────────────────
function cn(...args: Array<string | false | null | undefined>) {
  return args.filter(Boolean).join(' ');
}

const ICON_SIZE_INLINE = 14;

function Badge({ children, variant = 'gray', size = 'sm' }: { children: React.ReactNode; variant?: 'gray' | 'green' | 'red'; size?: 'xs' | 'sm' }) {
  const variants: Record<string, string> = {
    gray: 'bg-slate-100 text-slate-600',
    green: 'bg-emerald-50 text-emerald-700',
    red: 'bg-red-50 text-red-700',
  };
  const sizes: Record<string, string> = { xs: 'text-[11px] px-1.5 py-0.5', sm: 'text-xs px-2 py-0.5' };
  return (
    <span className={cn('inline-flex items-center rounded-full font-medium', variants[variant], sizes[size])}>
      {children}
    </span>
  );
}

function Button({
  children, variant = 'primary', size = 'sm', leftIcon, className, onClick, type = 'button',
}: {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'xs' | 'sm';
  leftIcon?: React.ReactNode;
  className?: string;
  onClick?: () => void;
  type?: 'button' | 'submit';
}) {
  const variants: Record<string, string> = {
    primary: 'bg-slate-900 text-white hover:bg-slate-800',
    secondary: 'bg-slate-100 text-slate-700 hover:bg-slate-200',
    outline: 'border border-slate-300 text-slate-700 hover:bg-slate-50',
    ghost: 'text-slate-600 hover:bg-slate-100',
  };
  const sizes: Record<string, string> = { xs: 'text-xs px-2 py-1', sm: 'text-sm px-3 py-1.5' };
  return (
    <button
      type={type}
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2',
        variants[variant], sizes[size], className,
      )}
    >
      {leftIcon}
      {children}
    </button>
  );
}

function Modal({ isOpen, onClose, title, children }: { isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Tabs({ tabs, value, onChange }: { tabs: { value: string; label: string; badge?: number }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1 border-b border-slate-200">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            value === t.value ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700',
          )}
        >
          {t.label}
          {!!t.badge && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-slate-900 text-white text-[10px] font-semibold">
              {t.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function Collapsible({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-slate-200 rounded-lg">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-semibold text-slate-800"
      >
        {title}
        <span className={cn('transition-transform text-slate-400', open && 'rotate-180')}>⌄</span>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-md px-2 py-1"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

function InlineAlert({ type, message }: { type: 'info' | 'error'; message: string }) {
  const styles = type === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-slate-50 border-slate-200 text-slate-600';
  return <div className={cn('text-sm border rounded-lg px-3 py-2', styles)}>{message}</div>;
}

// ── Static constants & demo data ──────────────────────────────────────────
type EventType = 'discovery' | 'demo' | 'follow_up' | 'negotiation' | 'internal';
type Outcome = 'strong_interest' | 'moving_forward' | 'neutral' | 'stalled' | 'lost';
type SignalType = 'buying_signal' | 'risk_signal' | 'competitor_mention' | 'budget_signal';
type CommitmentStatus = 'pending' | 'done' | 'overdue';

const EVENT_TYPE_LABELS: Record<EventType, string> = {
  discovery: 'Discovery call',
  demo: 'Product demo',
  follow_up: 'Follow-up',
  negotiation: 'Negotiation',
  internal: 'Internal',
};

const MEETING_OUTCOME_LABELS: Record<Outcome, string> = {
  strong_interest: 'Strong interest',
  moving_forward: 'Moving forward',
  neutral: 'Neutral',
  stalled: 'Stalled',
  lost: 'Lost',
};

const MEETING_OUTCOME_COLORS: Record<Outcome, string> = {
  strong_interest: '#059669',
  moving_forward: '#2563eb',
  neutral: '#64748b',
  stalled: '#d97706',
  lost: '#dc2626',
};

const SIGNAL_TYPE_LABELS: Record<SignalType, string> = {
  buying_signal: 'Buying signal',
  risk_signal: 'Risk signal',
  competitor_mention: 'Competitor mention',
  budget_signal: 'Budget signal',
};

const SIGNAL_COLORS: Record<SignalType, string> = {
  buying_signal: '#059669',
  risk_signal: '#dc2626',
  competitor_mention: '#d97706',
  budget_signal: '#2563eb',
};

const COMMITMENT_STATUS_LABELS: Record<CommitmentStatus, string> = {
  pending: 'Pending',
  done: 'Done',
  overdue: 'Overdue',
};

function formatShortDate(iso: string) {
  return format(parseISO(iso), 'MMM d, yyyy');
}
function formatTime(iso: string) {
  return format(parseISO(iso), 'h:mm a');
}

const today = new Date();
const isoTime = (d: Date, h: number, m: number) => {
  const dt = new Date(d);
  dt.setHours(h, m, 0, 0);
  return dt.toISOString();
};
const meetingDate = subDays(today, 4);

interface Commitment {
  id: string;
  commitment_text: string;
  owner: 'founder' | 'prospect';
  status: CommitmentStatus;
  due_date?: string;
  is_overdue?: boolean;
}

interface Signal {
  id: string;
  signal_type: SignalType;
  signal_text: string;
  confidence?: number;
}

const DEMO_EVENT = {
  id: 'evt-1002',
  title: 'Product walkthrough — Solace Health',
  event_type: 'demo' as EventType,
  event_date: format(meetingDate, 'yyyy-MM-dd'),
  start_time: isoTime(meetingDate, 14, 0),
  end_time: isoTime(meetingDate, 14, 45),
  attendee_name: 'Marcus Delgado',
  outcome: 'strong_interest' as Outcome,
  reschedule_count: 1,
  prep_generated: true,
  prep_failed: false,
  debrief_completed_at: isoTime(meetingDate, 16, 10),
  prep_content: {
    opening_line: "Thanks for making time, Marcus — last week you mentioned onboarding new case managers was taking almost three weeks. Want to start there?",
    key_question_to_ask: "What would it take for this to be a top-three priority for your team this quarter, versus a 'nice to have' for next year?",
    talking_points: [
      'Solace Health processed 12% more referrals last quarter but headcount only grew 4% — capacity is the real constraint.',
      'Marcus flagged HIPAA-compliant audit trails as a hard requirement in the discovery call.',
      'Their current tool (Careframe) lacks automated escalation — this is our clearest wedge.',
      'Champion is Marcus, but final budget sign-off sits with the COO, Renata Ilic.',
    ],
    anticipate_objection: "They may push back on implementation timeline given they just went through a rocky EHR migration in Q2. Acknowledge the migration fatigue directly, then anchor on our 2-week white-glove onboarding and offer a phased rollout starting with one care team.",
    intelligence_brief: "Solace Health raised a $14M Series B in March and is expanding into two new states this year. Marcus was promoted to Director of Care Operations in January and this is his first major tooling decision — a strong signal he's motivated to make a visible win. Careframe (incumbent) has had two public outages in the last 90 days per their status page.",
    commitment_check: "You committed to sending Marcus the SOC 2 report and a case-manager ROI calculator by end of week — that's due tomorrow.",
    pre_outreach: "Hi Marcus — looking forward to our walkthrough tomorrow at 2pm. I'll tailor the demo around the case-manager onboarding bottleneck we discussed. Anything specific you'd like me to make sure I cover for Renata?",
    follow_up_template: "Hi Marcus, great talking today — as promised, here's the ROI calculator and SOC 2 report. Given the timeline pressure from the EHR migration, I'd suggest we start with a single care team pilot in October. Free Thursday for a 20-minute call with Renata?",
  },
  debrief_content: {
    summary: 'Strong session — Marcus was highly engaged and brought Renata in for the last 15 minutes unprompted, which we read as a very positive buying signal. Live demo of the escalation workflow landed well.',
    what_worked: 'Leading with the capacity/headcount stat immediately reframed the conversation around urgency instead of features.',
    what_to_improve: 'Spent too long on the reporting dashboard — Renata seemed less interested in analytics than in implementation risk. Read the room and pivot faster next time.',
    coachable_moment: "When Renata asked about the EHR migration timeline, there was a 4-second pause before responding. Practice a tighter, more confident answer to timeline-risk questions — it's the #1 objection with recently-migrated accounts.",
    next_step_recommendation: 'Send the SOC 2 report and ROI calculator within 24 hours, then propose a single-care-team pilot to reduce perceived implementation risk before pushing for a full rollout commitment.',
  },
  follow_up_options: {
    brief: "Hi Marcus, great talking today. Sending the SOC 2 report and ROI calculator over shortly. Let's find time next week to loop in Renata.",
    substantive: "Hi Marcus, thanks for a great session — and for pulling Renata in, that was helpful context. As discussed, I'll get you the SOC 2 report and the case-manager ROI calculator by end of day tomorrow. Given the EHR migration you mentioned, I think a single-team pilot in October makes the most sense as a low-risk starting point. Would Thursday work for a short call with Renata to walk through that plan?",
    re_engagement: "Hi Marcus, wanted to check in since our walkthrough last week — happy to answer any follow-up questions from Renata or the team whenever you're ready to pick things back up.",
  } as Record<'brief' | 'substantive' | 're_engagement', string>,
  follow_up_variant_sent: 'substantive' as 'brief' | 'substantive' | 're_engagement' | null,
};

const DEMO_COMMITMENTS: Commitment[] = [
  {
    id: 'cmt-1',
    commitment_text: 'Send SOC 2 Type II report and case-manager ROI calculator',
    owner: 'founder',
    status: 'pending',
    due_date: format(new Date(), 'yyyy-MM-dd'),
  },
  {
    id: 'cmt-2',
    commitment_text: 'Loop in Renata Ilic (COO) for a follow-up call to review pilot proposal',
    owner: 'founder',
    status: 'pending',
    due_date: format(subDays(new Date(today.getTime() - 3 * 86400000), -6), 'yyyy-MM-dd'),
  },
  {
    id: 'cmt-3',
    commitment_text: 'Confirm which care team will participate in the October pilot',
    owner: 'prospect',
    status: 'overdue',
    due_date: format(subDays(today, 1), 'yyyy-MM-dd'),
    is_overdue: true,
  },
  {
    id: 'cmt-4',
    commitment_text: 'Share internal budget approval timeline with Marcus',
    owner: 'prospect',
    status: 'done',
    due_date: format(subDays(today, 2), 'yyyy-MM-dd'),
  },
];

const DEMO_SIGNALS: Signal[] = [
  {
    id: 'sig-1',
    signal_type: 'buying_signal',
    signal_text: "Marcus proactively brought the COO, Renata, into the final 15 minutes of the call without being asked — a strong indicator of internal momentum.",
    confidence: 0.91,
  },
  {
    id: 'sig-2',
    signal_type: 'budget_signal',
    signal_text: "Renata asked directly about annual vs. multi-year pricing, suggesting budget conversations are already underway internally.",
    confidence: 0.78,
  },
  {
    id: 'sig-3',
    signal_type: 'risk_signal',
    signal_text: "Team expressed clear fatigue around their recent EHR migration and hesitancy about starting another large rollout so soon.",
    confidence: 0.83,
  },
  {
    id: 'sig-4',
    signal_type: 'competitor_mention',
    signal_text: "Careframe (incumbent) was mentioned twice, both times in the context of recent reliability issues and outages.",
    confidence: 0.69,
  },
];

const DETAIL_TABS = [
  { value: 'prep', label: 'Prep' },
  { value: 'commitments', label: 'Commitments' },
  { value: 'signals', label: 'Signals' },
];

const DEMO_VOICE_MEMOS = [
  { id: 'vm-1', duration: '1:42', created_at: isoTime(meetingDate, 16, 5), transcript_preview: "Quick note right after the call — Renata's questions about pricing felt like she's already comparing us against a budget line, not just evaluating fit..." },
  { id: 'vm-2', duration: '0:38', created_at: isoTime(meetingDate, 16, 8), transcript_preview: "Reminder to myself: follow up on the pilot team question before Thursday, don't let it slip." },
];

// ── Sub-sections ──────────────────────────────────────────────────────────
function VoiceMemoRecorder() {
  return (
    <Button size="sm" variant="secondary" leftIcon={<Mic size={13} />} onClick={() => console.log('Start voice memo recording (demo)')}>
      Record memo
    </Button>
  );
}

function VoiceMemoList() {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
        <Mic size={ICON_SIZE_INLINE} /> Voice memos
      </p>
      {DEMO_VOICE_MEMOS.map((vm) => (
        <div key={vm.id} className="flex items-start gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3">
          <div className="shrink-0 text-xs font-mono text-slate-500 bg-white border border-slate-200 rounded-md px-2 py-1">{vm.duration}</div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-slate-600">{vm.transcript_preview}</p>
            <p className="text-xs text-slate-400 mt-1">{formatTime(vm.created_at)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────
export default function CalendarEventDetailPage() {
  const [activeTab, setActiveTab] = useState('prep');
  const [debriefOpen, setDebriefOpen] = useState(false);

  const [commitments, setCommitments] = useState<Commitment[]>(DEMO_COMMITMENTS);
  const [followUpSent, setFollowUpSent] = useState<'brief' | 'substantive' | 're_engagement' | null>(DEMO_EVENT.follow_up_variant_sent);

  // Debrief form local state
  const [debriefOutcome, setDebriefOutcome] = useState<Outcome | ''>('');
  const [debriefNotes, setDebriefNotes] = useState('');

  const event = DEMO_EVENT;
  const isPastEvent = new Date(event.event_date) < new Date();

  const markCommitmentDone = (id: string) => {
    setCommitments((prev) => prev.map((c) => (c.id === id ? { ...c, status: 'done', is_overdue: false } : c)));
  };

  const markFollowUpSent = (variant: 'brief' | 'substantive' | 're_engagement') => {
    setFollowUpSent(variant);
  };

  const submitDebrief = (e: React.FormEvent) => {
    e.preventDefault();
    setDebriefOpen(false);
    setDebriefOutcome('');
    setDebriefNotes('');
  };

  return (
    <div className="page-container max-w-3xl mx-auto space-y-5 p-6">
      <button onClick={() => console.log('Navigate to /calendar')} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900">
        <ArrowLeft size={ICON_SIZE_INLINE} /> Calendar
      </button>

      {/* Event header */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-slate-900">{event.title}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <Badge variant="gray" size="xs">{EVENT_TYPE_LABELS[event.event_type]}</Badge>
              {event.attendee_name && (
                <span className="text-sm text-slate-500">with {event.attendee_name}</span>
              )}
            </div>
            {event.outcome && (
              <span className="inline-block mt-1 text-sm font-medium" style={{ color: MEETING_OUTCOME_COLORS[event.outcome] ?? '#64748b' }}>
                {MEETING_OUTCOME_LABELS[event.outcome]}
              </span>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-medium text-slate-900">{formatShortDate(event.event_date)}</p>
            {event.start_time && (
              <p className="text-xs text-slate-500">{formatTime(event.start_time)}{event.end_time ? ` – ${formatTime(event.end_time)}` : ''}</p>
            )}
            {event.reschedule_count > 0 && (
              <p className="text-xs text-amber-600">Rescheduled {event.reschedule_count}×</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" leftIcon={<MessageCircle size={13} />} onClick={() => console.log('Open meeting notes chat (demo)')}>
            Meeting notes
          </Button>
          {event.attendee_name && (
            <Button size="sm" variant="secondary" leftIcon={<Search size={13} />} onClick={() => console.log('Trigger research (demo)')}>
              Research
            </Button>
          )}
          {isPastEvent && !event.debrief_completed_at && (
            <Button size="sm" variant="outline" leftIcon={<CheckCircle2 size={13} />} onClick={() => setDebriefOpen(true)}>
              Submit debrief
            </Button>
          )}
          {isPastEvent && <VoiceMemoRecorder />}
        </div>
      </div>

      <Tabs
        tabs={DETAIL_TABS.map((t) => ({
          ...t,
          badge: t.value === 'commitments' ? commitments.filter((c) => c.status === 'pending' || c.status === 'overdue').length : undefined,
        }))}
        value={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === 'prep' && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-5">
          {/* Hero — the two things a founder reads 90 seconds before the call */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
            <div>
              <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-1">Open with</p>
              <p className="text-base font-medium text-slate-900">{event.prep_content.opening_line}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-1">Ask this</p>
              <p className="text-base font-medium text-slate-900">{event.prep_content.key_question_to_ask}</p>
            </div>
          </div>

          <Collapsible title="Talking points" defaultOpen>
            <ul className="space-y-1">
              {event.prep_content.talking_points.map((tp: string, i: number) => (
                <li key={i} className="text-sm text-slate-600 flex items-start gap-2">
                  <span className="text-slate-400 shrink-0 mt-0.5">•</span>{tp}
                </li>
              ))}
            </ul>
          </Collapsible>

          <Collapsible title="If they push back">
            <p className="text-sm text-slate-600">{event.prep_content.anticipate_objection}</p>
          </Collapsible>

          <Collapsible title="Intelligence brief">
            <p className="text-sm text-slate-600">{event.prep_content.intelligence_brief}</p>
          </Collapsible>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <p className="text-sm text-amber-800">⚠ {event.prep_content.commitment_check}</p>
          </div>

          <Collapsible title="Pre-meeting message">
            <p className="text-sm text-slate-600 mb-2">{event.prep_content.pre_outreach}</p>
            <CopyButton text={event.prep_content.pre_outreach} />
          </Collapsible>

          <Collapsible title="24-hour follow-up template">
            <p className="text-sm text-slate-600 mb-2">{event.prep_content.follow_up_template}</p>
            <CopyButton text={event.prep_content.follow_up_template} />
          </Collapsible>

          {event.debrief_completed_at && event.debrief_content && (
            <div className="mt-5 pt-5 border-t border-slate-200 space-y-3">
              <p className="text-xs font-semibold text-slate-900">Meeting debrief</p>
              <p className="text-sm text-slate-600">{event.debrief_content.summary}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">What worked</p>
                  <p className="text-sm text-slate-600">{event.debrief_content.what_worked}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">Try next time</p>
                  <p className="text-sm text-slate-600">{event.debrief_content.what_to_improve}</p>
                </div>
              </div>
              <div className="bg-slate-900/5 rounded-lg p-3">
                <p className="text-xs font-semibold text-slate-900 mb-0.5">Coachable moment</p>
                <p className="text-sm text-slate-800">{event.debrief_content.coachable_moment}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Recommended next step</p>
                <p className="text-sm text-slate-600">{event.debrief_content.next_step_recommendation}</p>
              </div>
            </div>
          )}

          {/* Follow-up */}
          {event.debrief_completed_at && (
            <div className="mt-5 pt-5 border-t border-slate-200 space-y-3">
              <p className="text-xs font-semibold text-slate-900 flex items-center gap-1.5"><Mail size={ICON_SIZE_INLINE} /> Follow-up</p>
              <div className="space-y-3">
                {(['brief', 'substantive', 're_engagement'] as const).map((variant) => (
                  <div key={variant} className={cn('border rounded-lg p-3', followUpSent === variant && 'border-emerald-400 bg-emerald-50/50')}>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-semibold uppercase text-slate-500">{variant.replace('_', ' ')}</p>
                      {followUpSent === variant && <Badge variant="green" size="xs">Sent</Badge>}
                    </div>
                    <p className="text-sm text-slate-600 mb-2">{event.follow_up_options[variant]}</p>
                    <div className="flex gap-2">
                      <CopyButton text={event.follow_up_options[variant]} />
                      <Button size="xs" variant="ghost" onClick={() => markFollowUpSent(variant)}>Mark sent</Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Voice memos */}
          {isPastEvent && (
            <div className="mt-5 pt-5 border-t border-slate-200">
              <VoiceMemoList />
            </div>
          )}
        </div>
      )}

      {activeTab === 'commitments' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          {commitments.map((c) => (
            <div key={c.id} className="flex items-start gap-3 px-4 py-3 border-b border-slate-200 last:border-0">
              <div className={cn('w-2 h-2 rounded-full mt-1.5 shrink-0', c.owner === 'founder' ? 'bg-slate-900' : 'bg-slate-400')} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-900">{c.commitment_text}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-slate-500 capitalize">{c.owner}'s action</span>
                  {c.due_date && (
                    <span className={cn('text-xs', c.is_overdue ? 'text-red-600' : 'text-slate-500')}>
                      Due {formatShortDate(c.due_date)}
                    </span>
                  )}
                </div>
              </div>
              {c.owner === 'founder' && c.status !== 'done' && (
                <Button size="xs" variant="ghost" onClick={() => markCommitmentDone(c.id)}>Done</Button>
              )}
              <Badge variant={c.status === 'done' ? 'green' : c.status === 'overdue' ? 'red' : 'gray'} size="xs">
                {COMMITMENT_STATUS_LABELS[c.status]}
              </Badge>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'signals' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          {DEMO_SIGNALS.map((s) => (
            <div key={s.id} className="flex items-start gap-3 px-4 py-3 border-b border-slate-200 last:border-0">
              <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: SIGNAL_COLORS[s.signal_type] }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold" style={{ color: SIGNAL_COLORS[s.signal_type] }}>
                    {SIGNAL_TYPE_LABELS[s.signal_type]}
                  </span>
                  {s.confidence != null && <span className="text-xs text-slate-500">{Math.round(s.confidence * 100)}% confidence</span>}
                </div>
                <p className="text-sm text-slate-600 mt-0.5">{s.signal_text}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Debrief modal */}
      <Modal isOpen={debriefOpen} onClose={() => setDebriefOpen(false)} title="Submit meeting debrief">
        <form onSubmit={submitDebrief} className="space-y-4">
          <div>
            <p className="text-sm font-medium text-slate-900 mb-2">How did the meeting go?</p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {(Object.entries(MEETING_OUTCOME_LABELS) as [Outcome, string][]).map(([value, label]) => {
                const isSelected = debriefOutcome === value;
                return (
                  <label key={value} className="cursor-pointer">
                    <input
                      type="radio"
                      className="sr-only"
                      value={value}
                      checked={isSelected}
                      onChange={() => setDebriefOutcome(value)}
                    />
                    <div className={cn(
                      'text-center py-2 rounded-lg border text-xs font-medium transition-all',
                      isSelected
                        ? 'border-slate-900 bg-slate-900/10 text-slate-900 ring-1 ring-slate-900'
                        : 'border-slate-200 hover:border-slate-300',
                    )}>
                      {label}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Meeting notes</label>
            <textarea
              placeholder="What was discussed? Commitments made? Next steps?"
              rows={4}
              maxLength={5000}
              value={debriefNotes}
              onChange={(e) => setDebriefNotes(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
            />
          </div>
          <p className="text-xs text-slate-500">
            Foundersales will extract commitments and signals from your notes automatically.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" type="button" onClick={() => setDebriefOpen(false)}>Cancel</Button>
            <Button size="sm" type="submit">Save debrief</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
