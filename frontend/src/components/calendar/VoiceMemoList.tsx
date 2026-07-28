// frontend/src/components/calendar/VoiceMemoList.tsx
import React from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { calendarApi } from '@/api/calendar';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { VOICE_MEMO_STATUS_LABELS } from '@/lib/constants';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Collapsible } from './Collapsible';

export function VoiceMemoList({ eventId }: { eventId: string }) {
  const { data } = useQuery({
    queryKey: queryKeys.voiceMemos(eventId),
    queryFn: () => calendarApi.listVoiceMemos(eventId).then((r) => r.data.voice_memos),
    refetchInterval: (query) => {
      const memos = query.state.data;
      if (!memos?.length) return false;
      return memos.some((m) => m.transcription_status === 'pending' || m.transcription_status === 'processing') ? 5000 : false;
    },
  });

  const retryMutation = useMutation({
    mutationFn: (memoId: string) => calendarApi.retryVoiceMemoTranscription(eventId, memoId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.voiceMemos(eventId) }),
  });

  if (!data?.length) return null;

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-text-primary">Voice memos</p>
      {data.map((memo) => (
        <div key={memo.id} className="border border-surface-border rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <Badge variant={memo.transcription_status === 'completed' ? 'green' : memo.transcription_status === 'failed' ? 'red' : 'gray'} size="xs">
              {VOICE_MEMO_STATUS_LABELS[memo.transcription_status]}
            </Badge>
            <span className="text-xs text-text-muted">{memo.source === 'uploaded' ? memo.original_filename : 'Recorded in-app'}</span>
          </div>

          {memo.transcription_status === 'completed' && (
            <>
              <audio controls src={memo.playback_url} className="w-full h-8" />
              {memo.transcript_text && (
                <Collapsible title="Transcript">
                  <p className="text-sm text-text-secondary whitespace-pre-wrap">{memo.transcript_text}</p>
                </Collapsible>
              )}
              {memo.ai_summary && (
                <Collapsible title="AI summary">
                  <p className="text-sm text-text-secondary">{memo.ai_summary.summary}</p>
                </Collapsible>
              )}
            </>
          )}

          {memo.transcription_status === 'failed' && (
            <Button size="xs" variant="ghost" leftIcon={<RefreshCw size={12} />} isLoading={retryMutation.isPending} onClick={() => retryMutation.mutate(memo.id)}>
              Retry transcription
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
