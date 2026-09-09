// ============================================================
// FILE: src/pages/practice/PracticeSessionPage.tsx
// DEMO / SCREENSHOT BUILD — fully static, zero network calls.
//
// Changes from production version:
// - No react-query, no practiceApi, no useRealtimeChannel, no
//   queryClient/queryKeys — the whole data layer is removed.
// - Session, buyer state, and message history are hardcoded below
//   to look like an active, mid-conversation "Skeptical Prospect"
//   session with a "Competitor Pitch" pressure modifier — matching
//   the demo defaults on PracticeSetupPage.
// - Sending a message locally appends a user bubble, then after a
//   short delay appends one of a few pre-written buyer replies and
//   nudges the meters — all client-side, nothing hits a network.
// - "End" opens the same rating modal; "Submit" just resolves
//   locally (no navigation to a real outcome page).
// - Local UI-only components (Button/Modal/Badge/InlineAlert) are
//   included at the bottom so this renders standalone. Swap the
//   imports back to '@/components/ui/*' when wiring to the real app.
// ============================================================
import React, { useState, useRef, useEffect } from 'react';
import { Send, Square, Ghost } from 'lucide-react';

// ── Static domain data (hardcoded, no API) ─────────────────────
type DeliveryStatus = 'pending' | 'delivered' | 'seen' | 'ghosted';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  delivery_status?: DeliveryStatus;
  created_at: string;
}

interface BuyerState {
  interest_score: number;
  trust_score: number;
  confusion_score: number;
  mood: string;
}

const SCENARIO_LABEL   = 'Skeptical Prospect';
const DIFFICULTY_LABEL = 'Intermediate';
const SESSION_GOAL     = 'Handle the price objection without discounting more than 10%';
const INSTRUCTION      = 'This buyer has seen a competitor pitch yesterday — expect comparisons.';
const PRACTICE_PROMPT  =
  'You’re following up with Marcus Webb, Head of Ops at a 40-person logistics company. He took your demo two weeks ago but has gone quiet since a competitor reached out. Re-open the conversation and rebuild momentum.';

// Seeded conversation — looks like a session already 6 messages deep.
const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: 'm1',
    role: 'user',
    content: 'Hey Marcus, following up on our demo last week — did you get a chance to loop in your team?',
    delivery_status: 'seen',
    created_at: '2026-09-08T14:02:00Z',
  },
  {
    id: 'm2',
    role: 'assistant',
    content: 'Yeah, we did. Honestly, we also took a call with Routeflow this week and their pricing looks a lot more straightforward than yours.',
    created_at: '2026-09-08T14:03:10Z',
  },
  {
    id: 'm3',
    role: 'user',
    content: 'Totally fair to compare — what specifically stood out about their pricing versus what I walked you through?',
    delivery_status: 'seen',
    created_at: '2026-09-08T14:04:02Z',
  },
  {
    id: 'm4',
    role: 'assistant',
    content: "Flat monthly fee, no per-seat charges. With your model we'd be paying more once we add the warehouse team next quarter.",
    created_at: '2026-09-08T14:05:40Z',
  },
  {
    id: 'm5',
    role: 'user',
    content: 'Good to know. Most teams our size actually end up cheaper on our per-seat plan once you factor in the automation hours it saves — want me to run the numbers for your actual headcount?',
    delivery_status: 'seen',
    created_at: '2026-09-08T14:06:55Z',
  },
  {
    id: 'm6',
    role: 'assistant',
    content: 'Sure, send it over. I’m not against switching, I just don’t want to get locked into something that gets expensive as we grow.',
    created_at: '2026-09-08T14:07:30Z',
  },
];

const INITIAL_BUYER_STATE: BuyerState = {
  interest_score: 58,
  trust_score: 46,
  confusion_score: 22,
  mood: 'Cautiously open, still price-anchored on the competitor',
};

// A few canned buyer replies the demo cycles through when you send a message,
// so the conversation keeps feeling alive without any backend.
const CANNED_REPLIES = [
  {
    content: 'Okay, that math actually checks out. What does onboarding look like if we move forward this month?',
    delta: { interest: 9, trust: 7, confusion: -4 },
    mood: 'Warming up — the numbers landed',
  },
  {
    content: 'I hear you, but my boss is going to ask why we didn’t just go with the cheaper flat-rate option.',
    delta: { interest: -2, trust: 2, confusion: 3 },
    mood: 'Still weighing it against the competitor',
  },
  {
    content: 'Can you get me something in writing? I’d want to bring this to our ops review on Thursday.',
    delta: { interest: 6, trust: 5, confusion: -2 },
    mood: 'Ready to escalate internally',
  },
];

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function clamp(n: number) {
  return Math.max(0, Math.min(100, n));
}

// ── Buyer state meters ────────────────────────────────────────
function BuyerStateMeters({ state, isActive }: { state: BuyerState; isActive: boolean }) {
  const meters = [
    { label: 'Interest',  value: state.interest_score,  color: '#2563eb', icon: '🎯' },
    { label: 'Trust',     value: state.trust_score,     color: '#3b82f6', icon: '💙' },
    { label: 'Confusion', value: state.confusion_score, color: '#f59e0b', icon: '🤔' },
  ];

  return (
    <div className="space-y-2 p-3 bg-surface-base rounded-lg border border-surface-border">
      {meters.map((m) => (
        <div key={m.label} className="flex items-center gap-2">
          <span className="text-xs w-4">{m.icon}</span>
          <span className="text-xs text-text-muted w-16 shrink-0">{m.label}</span>
          <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700 ease-out"
              style={{ backgroundColor: m.color, width: isActive ? `${m.value}%` : '0%' }}
            />
          </div>
          <span className="text-xs font-mono text-text-muted w-6 text-right">{m.value}</span>
        </div>
      ))}
      {state.mood && (
        <p className="text-xs text-text-muted italic text-center pt-1">"{state.mood}"</p>
      )}
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────
function MessageBubble({
  message, isUser, streamContent, isStreaming,
}: {
  message?:      ChatMessage;
  isUser:        boolean;
  streamContent?: string;
  isStreaming?:  boolean;
}) {
  const content = streamContent ?? message?.content ?? '';
  if (!content && !isStreaming) return null;

  return (
    <div className={cn('flex gap-2', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center text-brand text-sm shrink-0 mt-1">
          🤖
        </div>
      )}
      <div className={cn(
        'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
        isUser
          ? 'bg-brand text-white rounded-br-sm'
          : 'bg-white border border-surface-border text-text-primary rounded-bl-sm',
      )}>
        <p className={cn(isStreaming && 'streaming-cursor')}>{content}</p>
        <div className={cn('flex items-center gap-1.5 mt-1', isUser ? 'justify-end' : 'justify-between')}>
          {!isUser && message?.created_at && (
            <span className="text-xs text-text-muted">{formatTime(message.created_at)}</span>
          )}
          {isUser && (
            <>
              {message?.created_at && <span className="text-xs text-brand-200">{formatTime(message.created_at)}</span>}
              {message?.delivery_status && (
                <span className="text-xs text-brand-200">
                  {message.delivery_status === 'delivered' ? '✓' :
                   message.delivery_status === 'seen'      ? '✓✓' :
                   message.delivery_status === 'ghosted'   ? '👻 No reply' :
                   message.delivery_status === 'pending'   ? '…' : ''}
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main session page ─────────────────────────────────────────
export default function PracticeSessionPage() {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef        = useRef<HTMLTextAreaElement>(null);

  const [content,       setContent]       = useState('');
  const [messages,      setMessages]      = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [buyerState,    setBuyerState]    = useState<BuyerState>(INITIAL_BUYER_STATE);
  const [streamContent, setStreamContent] = useState('');
  const [isStreaming,   setIsStreaming]   = useState(false);
  const [sessionEnded,  setSessionEnded]  = useState(false);
  const [ratingOpen,    setRatingOpen]    = useState(false);
  const [rating,        setRating]        = useState(0);
  const [submitted,     setSubmitted]     = useState(false);
  const [replyIndex,    setReplyIndex]    = useState(0);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamContent]);

  const handleSend = () => {
    const text = content.trim();
    if (!text || isStreaming || sessionEnded) return;

    const userMsg: ChatMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: text,
      delivery_status: 'delivered',
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setContent('');
    setIsStreaming(true);

    // Simulate the buyer "typing" then replying, and mark the user's message seen.
    const reply = CANNED_REPLIES[replyIndex % CANNED_REPLIES.length];
    window.setTimeout(() => {
      setMessages((prev) =>
        prev.map((m) => (m.id === userMsg.id ? { ...m, delivery_status: 'seen' } : m)),
      );
      const buyerMsg: ChatMessage = {
        id: `local-reply-${Date.now()}`,
        role: 'assistant',
        content: reply.content,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, buyerMsg]);
      setBuyerState((prev) => ({
        interest_score:  clamp(prev.interest_score + reply.delta.interest),
        trust_score:     clamp(prev.trust_score + reply.delta.trust),
        confusion_score: clamp(prev.confusion_score + reply.delta.confusion),
        mood: reply.mood,
      }));
      setIsStreaming(false);
      setStreamContent('');
      setReplyIndex((i) => i + 1);
    }, 1300);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleEnd = () => {
    setSessionEnded(true);
    setRatingOpen(true);
  };

  const handleSubmitRating = () => {
    // Demo only — resolves locally instead of navigating to a real outcome page.
    setRatingOpen(false);
    setSubmitted(true);
  };

  return (
    <div className="flex flex-col h-dvh bg-surface-base">
      {/* Header */}
      <div className="bg-white border-b border-surface-border px-4 py-3 shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Badge variant="blue" size="xs">{SCENARIO_LABEL}</Badge>
            <Badge variant="gray" size="xs">{DIFFICULTY_LABEL}</Badge>
            <span className="text-xs text-text-muted truncate hidden sm:block">
              Goal: {SESSION_GOAL}
            </span>
          </div>
          <Button
            variant="destructive"
            size="xs"
            leftIcon={<Square size={11} />}
            onClick={handleEnd}
          >
            End
          </Button>
        </div>
        <p className="text-xs text-text-muted mt-1.5 italic">{INSTRUCTION}</p>
      </div>

      {/* Buyer state meters */}
      <div className="px-4 pt-3 shrink-0">
        <BuyerStateMeters state={buyerState} isActive={!sessionEnded} />
      </div>

      {/* Practice prompt */}
      <div className="mx-4 mt-3 bg-brand-50 border border-brand-200 rounded-lg p-3">
        <p className="text-xs font-medium text-brand mb-1">Scenario</p>
        <p className="text-sm text-text-primary">{PRACTICE_PROMPT}</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} isUser={m.role === 'user'} />
        ))}

        {isStreaming && (
          <MessageBubble streamContent="" isUser={false} isStreaming />
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 bg-white border-t border-surface-border px-4 py-3">
        {sessionEnded ? (
          <p className="text-center text-sm text-text-muted italic py-1">
            {submitted ? 'Session complete — rating submitted.' : 'Session ended.'}
          </p>
        ) : (
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Write your message… (Enter to send)"
              maxLength={5000}
              rows={1}
              className={cn(
                'flex-1 resize-none rounded-xl border border-surface-border px-3 py-2',
                'text-sm text-text-primary placeholder:text-text-muted',
                'focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand',
                'transition-colors max-h-32 overflow-y-auto',
              )}
              style={{ minHeight: '40px' }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
              }}
            />
            <Button
              size="sm"
              leftIcon={<Send size={13} />}
              onClick={handleSend}
              isLoading={isStreaming}
            >
              Send
            </Button>
          </div>
        )}
        {content.length > 4500 && (
          <p className="text-xs text-amber-600 mt-1">{content.length}/5000</p>
        )}
      </div>

      {/* Rating + complete modal */}
      <Modal isOpen={ratingOpen} onClose={() => {}} title="Rate this session">
        <p className="text-sm text-text-secondary mb-4">How useful was this practice session?</p>
        <div className="flex justify-center gap-2 mb-6">
          {[1, 2, 3, 4, 5].map((r) => (
            <button
              key={r}
              onClick={() => setRating(r)}
              className={cn(
                'text-2xl transition-transform hover:scale-110',
                r <= rating ? 'opacity-100' : 'opacity-30',
              )}
            >
              ⭐
            </button>
          ))}
        </div>
        <Button fullWidth onClick={handleSubmitRating}>
          {rating > 0 ? 'Submit rating & see results' : 'Skip & see results'}
        </Button>
      </Modal>
    </div>
  );
}

// ============================================================
// Minimal local UI primitives — standalone stand-ins for
// '@/components/ui/*' so this file has zero external deps.
// ============================================================

function cn(...args: Array<string | false | null | undefined>) {
  return args.filter(Boolean).join(' ');
}

function Button({
  children,
  fullWidth,
  size = 'md',
  leftIcon,
  isLoading,
  onClick,
  variant = 'primary',
}: {
  children: React.ReactNode;
  fullWidth?: boolean;
  size?: 'xs' | 'sm' | 'md';
  leftIcon?: React.ReactNode;
  isLoading?: boolean;
  onClick?: () => void;
  variant?: 'primary' | 'destructive';
}) {
  const sizeClasses = size === 'xs' ? 'text-xs px-2.5 py-1.5' : size === 'sm' ? 'text-xs px-3 py-2' : 'text-sm px-4 py-2.5';
  const variantClasses =
    variant === 'destructive'
      ? 'bg-red-600 hover:bg-red-700 text-white'
      : 'bg-brand hover:bg-brand-600 text-white';
  return (
    <button
      onClick={onClick}
      disabled={isLoading}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-70',
        sizeClasses,
        variantClasses,
        fullWidth && 'w-full',
      )}
    >
      {isLoading ? (
        <span className="inline-block h-3.5 w-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
      ) : (
        leftIcon
      )}
      {children}
    </button>
  );
}

function Badge({
  children,
  variant = 'gray',
  size = 'xs',
}: {
  children: React.ReactNode;
  variant?: 'gray' | 'blue';
  size?: 'xs' | 'sm';
}) {
  const variantClasses: Record<string, string> = {
    gray: 'bg-slate-100 text-slate-700',
    blue: 'bg-blue-100 text-blue-700',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium',
        size === 'xs' ? 'text-[11px] px-2 py-0.5' : 'text-xs px-2.5 py-1',
        variantClasses[variant],
      )}
    >
      {children}
    </span>
  );
}

function Modal({
  isOpen,
  title,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5">
        <h3 className="text-base font-semibold text-text-primary mb-3">{title}</h3>
        {children}
      </div>
    </div>
  );
}
