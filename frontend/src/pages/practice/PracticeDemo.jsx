import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Shuffle, Zap, Send, Square, Ghost, Star } from 'lucide-react';

// ============================================================
// HARDCODED DEMO DATA
// (Original file used live API calls — all replaced with static
// realistic data for offline screenshot/demo purposes.)
// ============================================================

const SCENARIO_ICONS = {
  interested: '✅',
  polite_decline: '🙏',
  ghost: '👻',
  skeptical: '🤔',
  price_objection: '💰',
  not_right_time: '⏰',
};

const SCENARIO_LABELS = {
  interested: 'Interested buyer',
  polite_decline: 'Polite decline',
  ghost: 'Ghoster',
  skeptical: 'Skeptical buyer',
  price_objection: 'Price objection',
  not_right_time: 'Not the right time',
};

const SCENARIO_DESCRIPTIONS = {
  interested: 'Warm lead who wants to know more and is ready to move forward.',
  polite_decline: 'Friendly but firm — will let you down easy after a few exchanges.',
  ghost: 'Engaged at first, then goes quiet. Tests your follow-up game.',
  skeptical: 'Doubts your claims and pushes back hard on every point.',
  price_objection: 'Likes the product but keeps steering the talk to cost.',
  not_right_time: 'Interested in principle, but stalls on timing and priorities.',
};

const PRACTICE_SCENARIOS = [
  { type: 'interested' },
  { type: 'polite_decline' },
  { type: 'ghost' },
  { type: 'skeptical' },
  { type: 'price_objection' },
  { type: 'not_right_time' },
];

const PRESSURE_MODIFIERS = [
  { type: 'time_crunch', label: '⏱️ Time crunch', description: 'Buyer has 3 minutes before their next meeting.' },
  { type: 'budget_freeze', label: '🧊 Budget freeze', description: 'Finance just paused all new spend this quarter.' },
  { type: 'competitor', label: '⚔️ Competitor pitch', description: 'Buyer is already mid-evaluation with a rival tool.' },
  { type: 'exec_involved', label: '👔 Exec on the call', description: 'Buyer keeps checking with their VP before answering.' },
];

const DIFFICULTY_LABELS = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

// Setup page: goal input default text for the demo
const DEMO_SESSION_GOAL = 'Book a demo call for next week';

// Session page: hardcoded conversation + buyer state
const DEMO_SCENARIO_TYPE = 'price_objection';
const DEMO_DIFFICULTY = 'intermediate';
const DEMO_INSTRUCTION = 'This buyer liked the demo but thinks the price is too high for a team of 5. Handle the objection without discounting immediately.';

const DEMO_BUYER_STATE = {
  interest_score: 68,
  trust_score: 54,
  confusion_score: 12,
  mood: 'Cautiously interested, but watching the budget closely',
};

const DEMO_MESSAGES = [
  {
    id: 'm1',
    role: 'assistant',
    content: "Hey! Thanks for the walkthrough yesterday — the automation piece really stood out. Only thing is, $499/month feels steep for a team our size.",
    created_at: '2026-09-08T14:02:00Z',
  },
  {
    id: 'm2',
    role: 'user',
    content: "Totally fair to raise that. Out of curiosity, what are you comparing it against — another tool, or just internal budget?",
    delivery_status: 'seen',
    created_at: '2026-09-08T14:03:10Z',
  },
  {
    id: 'm3',
    role: 'assistant',
    content: "Mostly internal budget. We've got 5 seats and I was hoping to stay under $300/month total for this category.",
    created_at: '2026-09-08T14:03:52Z',
  },
  {
    id: 'm4',
    role: 'user',
    content: "Got it — that helps. A few of our teams your size actually start on the Growth tier at $299/mo for up to 5 seats, and add the automation add-on only once they're seeing consistent usage. Want me to break down what's included at that tier?",
    delivery_status: 'delivered',
    created_at: '2026-09-08T14:05:03Z',
  },
];

const DEMO_HINT = 'The buyer just mentioned a specific number. Anchor your next reply to that budget instead of re-pitching the full feature set.';

// Replay page: hardcoded transcript with internal monologue
const DEMO_REPLAY_SESSION = {
  outcome: 'Demo booked',
  scenario: 'price_objection',
  difficulty: 'intermediate',
  rating: 4,
  date: '2026-09-05T16:20:00Z',
};

const DEMO_REPLAY_MESSAGES = [
  { id: 'r1', role: 'assistant', content: "Hi! I saw the demo recording — looks solid, but I'll be honest, the price gave me pause.", created_at: '2026-09-05T15:58:00Z' },
  { id: 'r2', role: 'user', content: "Appreciate the honesty. What number were you expecting to land closer to?", created_at: '2026-09-05T15:59:12Z' },
  { id: 'r3', role: 'assistant', content: "Somewhere around $200 a month, if I'm being real. We're a small team and every tool adds up.", created_at: '2026-09-05T16:00:04Z' },
  { id: 'r4', role: 'user', content: "That's really useful to know. We do have a starter tier at $179/mo that covers the core reporting — the automation stuff can wait until you're getting value from the basics. Want me to send over what's included?", created_at: '2026-09-05T16:01:40Z' },
  { id: 'r5', role: 'assistant', content: "Yeah, send it over. If the starter tier covers reporting I'm probably in.", created_at: '2026-09-05T16:02:30Z' },
  { id: 'r6', role: 'user', content: "Sending now — I'll also grab 15 minutes on your calendar next week so we can get you set up.", created_at: '2026-09-05T16:03:15Z' },
];

const DEMO_MONOLOGUES = {
  r1: "This is a lot of money for what looks like a reporting tool. I need to see if they'll flex on price before I say no outright.",
  r3: "I'm testing whether they'll just cave and offer a discount. If they do, I'll know there's more room to push.",
  r5: "Okay, they actually listened instead of just pushing the expensive plan. That's a good sign — I'll give this a real shot.",
};

// ============================================================
// SHARED UI PRIMITIVES (design tokens preserved from original)
// ============================================================

function cn(...args) {
  return args.filter(Boolean).join(' ');
}

function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function Button({
  children, variant = 'primary', size = 'md', fullWidth, leftIcon, disabled, onClick, type = 'button', isLoading,
}) {
  const base = 'inline-flex items-center justify-center gap-1.5 font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  const sizes = {
    xs: 'text-xs px-2.5 py-1.5',
    sm: 'text-sm px-3 py-2',
    md: 'text-sm px-4 py-2.5',
  };
  const variants = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700',
    destructive: 'bg-red-50 text-red-600 hover:bg-red-100',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(base, sizes[size], variants[variant], fullWidth && 'w-full')}
    >
      {leftIcon}
      {isLoading ? 'Loading…' : children}
    </button>
  );
}

function Badge({ children, variant = 'gray', size = 'sm' }) {
  const variants = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    gray: 'bg-slate-100 text-slate-600 border-slate-200',
  };
  const sizes = { xs: 'text-[11px] px-1.5 py-0.5', sm: 'text-xs px-2 py-0.5' };
  return (
    <span className={cn('inline-flex items-center rounded-full border font-medium', variants[variant], sizes[size])}>
      {children}
    </span>
  );
}

function Input({ label, placeholder, defaultValue }) {
  return (
    <div>
      {label && <label className="block text-sm font-medium text-slate-800 mb-1.5">{label}</label>}
      <input
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      />
    </div>
  );
}

// ============================================================
// PAGE 1 — SETUP
// ============================================================

function SetupPage() {
  const [selectedScenario, setSelectedScenario] = useState('price_objection');
  const [selectedModifier, setSelectedModifier] = useState('budget_freeze');

  return (
    <div className="max-w-2xl mx-auto space-y-6 p-5">
      <button className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft size={14} /> Practice
      </button>

      <div>
        <h1 className="text-xl font-bold text-slate-900">New practice session</h1>
        <p className="text-sm text-slate-500 mt-1">Choose your scenario and Clutch AI generates a realistic buyer.</p>
      </div>

      <div className="space-y-6">
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-900">Choose scenario</h2>
            <button className="flex items-center gap-1 text-xs text-slate-500 hover:text-blue-600 transition-colors">
              <Shuffle size={12} /> Random
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {PRACTICE_SCENARIOS.map((s) => {
              const isSelected = selectedScenario === s.type;
              return (
                <button
                  key={s.type}
                  onClick={() => setSelectedScenario(s.type)}
                  className={cn(
                    'flex flex-col items-start gap-1.5 p-3 rounded-lg border transition-all text-left',
                    isSelected ? 'border-blue-500 bg-blue-50 shadow-sm' : 'bg-white border-slate-200 hover:border-slate-300',
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-base">{SCENARIO_ICONS[s.type]}</span>
                    <span className={cn('text-xs font-semibold', isSelected ? 'text-blue-600' : 'text-slate-900')}>
                      {SCENARIO_LABELS[s.type]}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 leading-snug">{SCENARIO_DESCRIPTIONS[s.type]}</p>
                </button>
              );
            })}
          </div>
        </div>

        <Input label="Session goal (optional)" defaultValue={DEMO_SESSION_GOAL} />

        <div>
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Pressure modifier</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {PRESSURE_MODIFIERS.map((m) => {
              const isSelected = selectedModifier === m.type;
              return (
                <button
                  key={m.type}
                  onClick={() => setSelectedModifier(isSelected ? null : m.type)}
                  className={cn(
                    'flex items-start gap-2 p-3 rounded-lg border transition-all text-left',
                    isSelected ? 'border-blue-500 bg-blue-50' : 'bg-white border-slate-200 hover:border-slate-300',
                  )}
                >
                  <span className="text-sm leading-none mt-0.5">{m.label.split(' ')[0]}</span>
                  <div>
                    <p className={cn('text-xs font-medium', isSelected ? 'text-blue-600' : 'text-slate-900')}>
                      {m.label.split(' ').slice(1).join(' ')}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">{m.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <Button fullWidth size="md" leftIcon={<Zap size={14} />}>
          Start session
        </Button>
      </div>
    </div>
  );
}

// ============================================================
// PAGE 2 — ACTIVE SESSION
// ============================================================

function BuyerStateMeters({ state }) {
  const meters = [
    { label: 'Interest', value: state.interest_score, color: '#2563eb', icon: '🎯' },
    { label: 'Trust', value: state.trust_score, color: '#3b82f6', icon: '💙' },
    { label: 'Confusion', value: state.confusion_score, color: '#f59e0b', icon: '🤔' },
  ];
  return (
    <div className="space-y-2 p-3 bg-slate-50 rounded-lg border border-slate-200">
      {meters.map((m) => (
        <div key={m.label} className="flex items-center gap-2">
          <span className="text-xs w-4">{m.icon}</span>
          <span className="text-xs text-slate-500 w-16 shrink-0">{m.label}</span>
          <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ backgroundColor: m.color, width: `${m.value}%` }} />
          </div>
          <span className="text-xs font-mono text-slate-500 w-6 text-right">{m.value}</span>
        </div>
      ))}
      {state.mood && <p className="text-xs text-slate-500 italic text-center pt-1">"{state.mood}"</p>}
    </div>
  );
}

function MessageBubble({ message, isUser }) {
  return (
    <div className={cn('flex gap-2', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-sm shrink-0 mt-1">
          🤖
        </div>
      )}
      <div className={cn(
        'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
        isUser ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-white border border-slate-200 text-slate-900 rounded-bl-sm',
      )}>
        <p>{message.content}</p>
        {isUser && message.delivery_status && (
          <p className={cn('text-xs mt-1 text-right', isUser ? 'text-blue-200' : 'text-slate-500')}>
            {message.delivery_status === 'delivered' ? '✓' :
             message.delivery_status === 'seen' ? '✓✓' :
             message.delivery_status === 'ghosted' ? '👻 No reply' : ''}
          </p>
        )}
      </div>
    </div>
  );
}

function SessionPage() {
  const [content, setContent] = useState('');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  return (
    <div className="flex flex-col h-[720px] bg-slate-50 rounded-xl overflow-hidden border border-slate-200">
      <div className="bg-white border-b border-slate-200 px-4 py-3 shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Badge variant="blue" size="xs">{SCENARIO_LABELS[DEMO_SCENARIO_TYPE]}</Badge>
            <Badge variant="gray" size="xs">{DIFFICULTY_LABELS[DEMO_DIFFICULTY]}</Badge>
            <span className="text-xs text-slate-500 truncate hidden sm:block">Goal: {DEMO_SESSION_GOAL}</span>
          </div>
          <Button variant="destructive" size="xs" leftIcon={<Square size={11} />}>
            End
          </Button>
        </div>
        <p className="text-xs text-slate-500 mt-1.5 italic">{DEMO_INSTRUCTION}</p>
      </div>

      <div className="px-4 pt-3 shrink-0">
        <BuyerStateMeters state={DEMO_BUYER_STATE} />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {DEMO_MESSAGES.map((m) => (
          <MessageBubble key={m.id} message={m} isUser={m.role === 'user'} />
        ))}

        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
          <Ghost size={14} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700">{DEMO_HINT}</p>
        </div>

        <div ref={messagesEndRef} />
      </div>

      <div className="shrink-0 bg-white border-t border-slate-200 px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write your message… (Enter to send)"
            rows={1}
            className="flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
            style={{ minHeight: '40px' }}
          />
          <Button size="sm" leftIcon={<Send size={13} />} disabled={!content.trim()}>
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// PAGE 3 — REPLAY
// ============================================================

function ReplayPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-5 p-5">
      <button className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft size={14} /> Outcome
      </button>

      <div>
        <div className="flex items-center gap-2 mb-2">
          <h1 className="text-xl font-bold text-slate-900">Session replay</h1>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
            {DEMO_REPLAY_SESSION.outcome}
          </span>
        </div>
        <p className="text-sm text-slate-500 mt-0.5">Buyer's hidden thoughts are revealed. 💭 = what the buyer was thinking.</p>
        <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
          <span>{SCENARIO_LABELS[DEMO_REPLAY_SESSION.scenario]}</span>
          <span>·</span>
          <span>{DIFFICULTY_LABELS[DEMO_REPLAY_SESSION.difficulty]}</span>
          <span>·</span>
          <span className="flex items-center gap-0.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star key={i} size={11} className={i < DEMO_REPLAY_SESSION.rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'} />
            ))}
          </span>
        </div>
      </div>

      <div className="space-y-4">
        {DEMO_REPLAY_MESSAGES.map((m) => {
          const thought = DEMO_MONOLOGUES[m.id];
          const isUser = m.role === 'user';
          return (
            <div key={m.id} className="space-y-1">
              <div className={cn('flex gap-2', isUser ? 'flex-row-reverse' : 'flex-row')}>
                {!isUser && (
                  <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-sm shrink-0 mt-1">
                    🤖
                  </div>
                )}
                <div className={cn(
                  'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                  isUser ? 'bg-blue-600 text-white rounded-br-sm ml-auto' : 'bg-white border border-slate-200 text-slate-900 rounded-bl-sm',
                )}>
                  {m.content}
                  <p className={cn('text-xs mt-1', isUser ? 'text-blue-200 text-right' : 'text-slate-400')}>
                    {formatDateTime(m.created_at)}
                  </p>
                </div>
              </div>

              {thought && !isUser && (
                <div className="ml-9 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <span className="text-sm">💭</span>
                  <div>
                    <p className="text-xs font-medium text-amber-700 mb-0.5">What the buyer was thinking:</p>
                    <p className="text-xs text-amber-600 italic">{thought}</p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// DEMO SHELL — tab switcher so all 3 pages are screenshot-ready
// ============================================================

export default function PracticeDemo() {
  const [tab, setTab] = useState('setup');
  const tabs = [
    { key: 'setup', label: 'Setup' },
    { key: 'session', label: 'Active session' },
    { key: 'replay', label: 'Replay' },
  ];

  return (
    <div className="min-h-screen bg-white">
      <div className="border-b border-slate-200 px-5 py-2.5 flex gap-1 bg-white sticky top-0 z-10">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'text-xs font-medium px-3 py-1.5 rounded-md transition-colors',
              tab === t.key ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'setup' && <SetupPage />}
      {tab === 'session' && <div className="p-5"><SessionPage /></div>}
      {tab === 'replay' && <ReplayPage />}
    </div>
  );
}
