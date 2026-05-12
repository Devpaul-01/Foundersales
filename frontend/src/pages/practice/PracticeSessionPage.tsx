// ============================================================
// FILE: src/pages/practice/PracticeSessionPage.tsx
// From practice-25.txt — critical rules:
// - buyer_state.last_reasoning NEVER shown during active session
// - Ghost path: evaluateMessageQualityForGhost → ghosted/ghost_broke response
// - Supabase Realtime delivery status updates on chat_messages
// - session_ended → show rating dialog → POST /complete
// - patience_remaining REMOVED from buyer state
// - PRACTICE_REPLY job absent — V3 inline only
// ============================================================
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { practiceApi } from '@/api/practice';
import { queryClient }  from '@/lib/queryClient';
import { queryKeys }    from '@/lib/queryKeys';
import { useRealtimeChannel } from '@/hooks/useRealtime';
import { useToast }     from '@/hooks/useToast';
import { Button }       from '@/components/ui/Button';
import { Skeleton }     from '@/components/ui/Skeleton';
import { Modal }        from '@/components/ui/Modal';
import { Badge }        from '@/components/ui/Badge';
import { InlineAlert, Spinner } from '@/components/common/index';
import { AppError, type BuyerState, type ChatMessage } from '@/api/types';
import { SCENARIO_LABELS, DIFFICULTY_LABELS } from '@/lib/constants';
import { cn, formatRelativeDate } from '@/lib/utils';
import { METER_TRANSITION } from '@/lib/animations';
import { motion } from 'framer-motion';
import { Send, Square, ChevronUp, Ghost } from 'lucide-react';

// ── Buyer state meters ────────────────────────────────────────
// ⚠️ last_reasoning NEVER rendered here — only in replay
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
            <motion.div
              className="h-full rounded-full"
              style={{ backgroundColor: m.color }}
              animate={{ width: isActive ? `${m.value}%` : '0%' }}
              transition={METER_TRANSITION}
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
        {/* Delivery status — user messages only */}
        {isUser && message?.delivery_status && (
          <p className={cn(
            'text-xs mt-1 text-right',
            isUser ? 'text-brand-200' : 'text-text-muted',
          )}>
            {message.delivery_status === 'delivered' ? '✓' :
             message.delivery_status === 'seen'      ? '✓✓' :
             message.delivery_status === 'ghosted'   ? '👻 No reply' : ''}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main session page ─────────────────────────────────────────
export default function PracticeSessionPage() {
  const { sessionId }  = useParams<{ sessionId: string }>();
  const location       = useLocation();
  const navigate       = useNavigate();
  const { showToast }  = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLTextAreaElement>(null);

  // State from router (passed by PracticeSetupPage on start)
  const routeState = location.state as {
    chatId?:          string;
    buyerProfile?:    unknown;
    buyerState?:      BuyerState;
    realtimeChannel?: string;
    practicePrompt?:  string;
    scenarioType?:    string;
    difficulty?:      string;
    instruction?:     string;
    sessionGoal?:     string;
  } | null;

  const [content,         setContent]         = useState('');
  const [buyerState,      setBuyerState]       = useState<BuyerState | null>(routeState?.buyerState ?? null);
  const [streamContent,   setStreamContent]    = useState('');
  const [isStreaming,     setIsStreaming]       = useState(false);
  const [sessionEnded,    setSessionEnded]     = useState(false);
  const [ratingOpen,      setRatingOpen]       = useState(false);
  const [rating,          setRating]           = useState(0);
  const [ghostedIds,      setGhostedIds]       = useState<Set<string>>(new Set());
  const [hint,            setHint]             = useState<string | null>(null);
  const [localMessages,   setLocalMessages]    = useState<ChatMessage[]>([]);

  // Fetch session
  const { data: session, isLoading: sessionLoading } = useQuery({
    queryKey: queryKeys.practiceSession(sessionId!),
    queryFn:  () => practiceApi.getSession(sessionId!).then((r) => r.data.session),
    enabled:  !!sessionId,
  });

  // Fetch messages
  const { data: messagesData, isLoading: msgsLoading } = useQuery({
    queryKey: queryKeys.practiceMessages(sessionId!),
    queryFn:  () => practiceApi.getMessages(sessionId!).then((r) => r.data.messages),
    enabled:  !!sessionId,
  });

  const chatId = routeState?.chatId ?? session?.chat_id ?? '';

  // Realtime delivery status from chat_messages table
  useRealtimeChannel({
    channelName: `practice:${chatId}`,
    table:       'chat_messages',
    event:       'UPDATE',
    enabled:     !!chatId && !sessionEnded,
    onPayload: useCallback((payload) => {
      const updated = payload.new as Partial<ChatMessage> & { id: string };
      setLocalMessages((prev) =>
        prev.map((m) => m.id === updated.id ? { ...m, ...updated } : m),
      );
      queryClient.setQueryData(
        queryKeys.practiceMessages(sessionId!),
        (old: ChatMessage[] | undefined) =>
          old?.map((m) => m.id === updated.id ? { ...m, ...updated } : m),
      );
    }, [sessionId]),
  });

  const allMessages = [
    ...(messagesData ?? []).filter((m) => m.role !== 'system'),
    ...localMessages,
  ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [allMessages, streamContent]);

  // Send message mutation
  const sendMutation = useMutation({
    mutationFn: (text: string) =>
      practiceApi.sendMessage(sessionId!, text).then((r) => r.data),
    onMutate: async (text) => {
      // Optimistic user message
      const tempMsg: ChatMessage = {
        id:              `temp-${Date.now()}`,
        chat_id:         chatId,
        role:            'user',
        content:         text,
        delivery_status: 'pending',
        created_at:      new Date().toISOString(),
      };
      setLocalMessages((prev) => [...prev, tempMsg]);
      setContent('');
      setHint(null);
      setIsStreaming(true);
      return { tempId: tempMsg.id };
    },
    onSuccess: (res, _, ctx) => {
      setIsStreaming(false);
      setStreamContent('');
      setBuyerState(res.buyer_state);

      // Handle ghost scenario per practice-25.txt Issue 3
      if (res.ghosted) {
        setGhostedIds((prev) => new Set([...prev, ctx!.tempId]));
        if (res.hint) setHint(res.hint);
      }

      if (res.ghost_broke) {
        showToast('👀 They responded!', 'success');
      }

      // Refetch messages to get real IDs + assistant response
      queryClient.invalidateQueries({ queryKey: queryKeys.practiceMessages(sessionId!) });

      // Session ended — show rating dialog
      if (res.session_ended) {
        setSessionEnded(true);
        setRatingOpen(true);
      }
    },
    onError: (err) => {
      setIsStreaming(false);
      setStreamContent('');
      if (err instanceof AppError && err.code === 'SESSION_ENDED') {
        setSessionEnded(true);
        setRatingOpen(true);
      } else {
        showToast('Message failed. Please try again.', 'error');
      }
    },
  });

  // Complete session
  const completeMutation = useMutation({
    mutationFn: (r: number) => practiceApi.completeSession(sessionId!, r || undefined),
    onSuccess: () => {
      setRatingOpen(false);
      // Poll for outcome
      navigate(`/practice/${sessionId}/outcome`);
    },
    onError: () => showToast('Could not complete session.', 'error'),
  });

  const handleSend = () => {
    const text = content.trim();
    if (!text || isStreaming || sendMutation.isPending || sessionEnded) return;
    sendMutation.mutate(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const scenarioType = routeState?.scenarioType ?? session?.scenario_type;
  const difficulty   = routeState?.difficulty   ?? session?.difficulty_level;
  const instruction  = routeState?.instruction;

  if (sessionLoading || msgsLoading) {
    return (
      <div className="h-dvh flex flex-col">
        <div className="h-14 border-b border-surface-border bg-white" />
        <div className="flex-1 p-4 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className={cn('h-12 w-3/4', i % 2 === 1 && 'ml-auto')} rounded="2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-dvh bg-surface-base">
      {/* Header */}
      <div className="bg-white border-b border-surface-border px-4 py-3 shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {scenarioType && (
              <Badge variant="blue" size="xs">{SCENARIO_LABELS[scenarioType]}</Badge>
            )}
            {difficulty && (
              <Badge variant="gray" size="xs">{DIFFICULTY_LABELS[difficulty]}</Badge>
            )}
            {routeState?.sessionGoal && (
              <span className="text-xs text-text-muted truncate hidden sm:block">
                Goal: {routeState.sessionGoal}
              </span>
            )}
          </div>
          <Button
            variant="destructive"
            size="xs"
            leftIcon={<Square size={11} />}
            onClick={() => { setSessionEnded(true); setRatingOpen(true); }}
          >
            End
          </Button>
        </div>

        {/* Instruction */}
        {instruction && (
          <p className="text-xs text-text-muted mt-1.5 italic">{instruction}</p>
        )}
      </div>

      {/* Buyer state meters */}
      {buyerState && (
        <div className="px-4 pt-3 shrink-0">
          <BuyerStateMeters state={buyerState} isActive={!sessionEnded} />
        </div>
      )}

      {/* Practice prompt */}
      {routeState?.practicePrompt && allMessages.length === 0 && (
        <div className="mx-4 mt-3 bg-brand-50 border border-brand-200 rounded-lg p-3">
          <p className="text-xs font-medium text-brand mb-1">Scenario</p>
          <p className="text-sm text-text-primary">{routeState.practicePrompt}</p>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {allMessages
          .filter((m) => m.role !== 'system')
          .map((m) => (
            <MessageBubble
              key={m.id}
              message={{
                ...m,
                delivery_status: ghostedIds.has(m.id) ? 'ghosted' : m.delivery_status,
              }}
              isUser={m.role === 'user'}
            />
          ))}

        {/* Streaming assistant bubble */}
        {isStreaming && (
          <MessageBubble streamContent={streamContent} isUser={false} isStreaming />
        )}

        {/* Ghost hint */}
        {hint && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
            <Ghost size={14} className="text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">{hint}</p>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 bg-white border-t border-surface-border px-4 py-3">
        {sessionEnded ? (
          <p className="text-center text-sm text-text-muted italic py-1">Session ended.</p>
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
              disabled={!content.trim() || isStreaming || sendMutation.isPending}
              isLoading={sendMutation.isPending || isStreaming}
              onClick={handleSend}
            >
              Send
            </Button>
          </div>
        )}
        {content.length > 4500 && (
          <p className="text-xs text-warning mt-1">{content.length}/5000</p>
        )}
      </div>

      {/* Rating + complete modal */}
      <Modal isOpen={ratingOpen} onClose={() => {}} title="Rate this session" size="sm" persistent>
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
        <Button
          fullWidth
          isLoading={completeMutation.isPending}
          onClick={() => completeMutation.mutate(rating)}
        >
          {rating > 0 ? `Submit rating & see results` : 'Skip & see results'}
        </Button>
      </Modal>
    </div>
  );
}
