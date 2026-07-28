// frontend/src/components/calendar/VoiceMemoRecorder.tsx
// ============================================================
// Supports BOTH workflows in one simple component:
//   - Record in-app via the browser MediaRecorder API
//   - Upload an existing audio file via a file picker
// Both submit through the same calendarApi.uploadVoiceMemo() call,
// distinguished only by `source`. Web-only — no native/mobile recording
// APIs are used.
// ============================================================
import React, { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Mic, Square, Upload, Loader2 } from 'lucide-react';
import { calendarApi } from '@/api/calendar';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { useToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

const MAX_DURATION_SECONDS = 20 * 60;
const ALLOWED_UPLOAD_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/m4a', 'audio/x-m4a', 'audio/mp4', 'audio/ogg', 'audio/webm'];

export function VoiceMemoRecorder({ eventId }: { eventId: string }) {
  const { showToast } = useToast();
  const [mode, setMode] = useState<'idle' | 'recording'>('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadMutation = useMutation({
    mutationFn: ({ blob, source, filename, durationSeconds }: { blob: Blob; source: 'recorded' | 'uploaded'; filename?: string; durationSeconds?: number }) =>
      calendarApi.uploadVoiceMemo(eventId, blob, { source, filename, durationSeconds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.voiceMemos(eventId) });
      showToast('Voice memo uploaded — transcribing now.', 'success');
    },
    onError: () => showToast('Could not upload voice memo.', 'error'),
  });

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        uploadMutation.mutate({ blob, source: 'recorded', filename: 'memo.webm', durationSeconds: elapsedSeconds });
        setElapsedSeconds(0);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setMode('recording');

      timerRef.current = setInterval(() => {
        setElapsedSeconds((s) => {
          if (s + 1 >= MAX_DURATION_SECONDS) { stopRecording(); return s; }
          return s + 1;
        });
      }, 1000);
    } catch (err) {
      showToast('Microphone access denied or unavailable.', 'error');
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    setMode('idle');
  };

  const handleFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file later
    if (!file) return;
    if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) {
      showToast('Unsupported audio file type.', 'error');
      return;
    }
    uploadMutation.mutate({ blob: file, source: 'uploaded', filename: file.name });
  };

  const formatElapsed = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="flex items-center gap-2">
      {mode === 'idle' ? (
        <>
          <Button size="sm" variant="secondary" leftIcon={<Mic size={13} />} onClick={startRecording} isLoading={uploadMutation.isPending}>
            Record memo
          </Button>
          <Button size="sm" variant="ghost" leftIcon={<Upload size={13} />} onClick={() => fileInputRef.current?.click()} isLoading={uploadMutation.isPending}>
            Upload audio
          </Button>
          <input ref={fileInputRef} type="file" accept="audio/*" className="hidden" onChange={handleFilePicked} />
        </>
      ) : (
        <Button
          size="sm"
          variant="danger"
          leftIcon={<Square size={13} />}
          onClick={stopRecording}
          className={cn('animate-pulse')}
        >
          Stop — {formatElapsed(elapsedSeconds)}
        </Button>
      )}
      {uploadMutation.isPending && <Loader2 size={14} className="animate-spin text-text-muted" />}
    </div>
  );
}
