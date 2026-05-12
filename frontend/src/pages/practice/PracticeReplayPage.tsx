// ============================================================
// FILE: src/pages/practice/PracticeReplayPage.tsx
// From practice-25.txt §3.17:
// - internal_monologue shown ONLY here (never during active session)
// - GET /practice/:id/replay
// ============================================================
import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { practiceApi } from '@/api/practice';
import { queryKeys }   from '@/lib/queryKeys';
import { Button }      from '@/components/ui/Button';
import { Skeleton }    from '@/components/ui/Skeleton';
import { InlineAlert, PageLoader } from '@/components/common/index';
import { ArrowLeft } from 'lucide-react';
import { cn, formatDateTime } from '@/lib/utils';

export default function PracticeReplayPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate      = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.practiceReplay(sessionId!),
    queryFn:  () => practiceApi.getReplay(sessionId!).then((r) => r.data),
    enabled:  !!sessionId,
  });

  if (isLoading) return <PageLoader />;

  const { session, messages = [], internal_monologues = [] } = data ?? {};
  const monologueMap = Object.fromEntries(
    internal_monologues.map((m) => [m.message_id, m.thought]),
  );

  const visibleMessages = messages.filter((m) => m.role !== 'system');

  return (
    <div className="page-container max-w-2xl space-y-5">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary">
        <ArrowLeft size={14} /> Outcome
      </button>

      <div>
        <h1 className="text-xl font-bold text-text-primary">Session replay</h1>
        <p className="text-sm text-text-muted mt-0.5">
          Buyer's hidden thoughts are revealed. 💭 = what the buyer was thinking.
        </p>
      </div>

      <div className="space-y-4">
        {visibleMessages.map((m) => {
          const thought = monologueMap[m.id];
          const isUser  = m.role === 'user';
          return (
            <div key={m.id} className="space-y-1">
              <div className={cn('flex gap-2', isUser ? 'flex-row-reverse' : 'flex-row')}>
                {!isUser && (
                  <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center text-brand text-sm shrink-0 mt-1">
                    🤖
                  </div>
                )}
                <div className={cn(
                  'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                  isUser
                    ? 'bg-brand text-white rounded-br-sm ml-auto'
                    : 'bg-white border border-surface-border text-text-primary rounded-bl-sm',
                )}>
                  {m.content}
                  <p className={cn('text-xs mt-1', isUser ? 'text-brand-200 text-right' : 'text-text-muted')}>
                    {formatDateTime(m.created_at)}
                  </p>
                </div>
              </div>

              {/* Internal monologue — ONLY shown in replay per practice-25.txt */}
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
