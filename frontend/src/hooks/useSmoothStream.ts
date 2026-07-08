// ============================================================
// FILE: src/hooks/useSmoothStream.ts
//
// SSE chunks tend to arrive in uneven bursts — a whole sentence at once,
// then a pause, then another burst — because of network buffering and how
// the LLM provider batches tokens server-side. Rendering each chunk the
// instant it arrives makes "streaming" look like it's lurching in and out
// rather than a smooth, continuous stream, which is the whole visual cue
// people use to tell it's actually being generated live.
//
// This hook buffers incoming text and reveals it to the UI at a steady,
// readable pace via requestAnimationFrame, decoupled from how bursty the
// network delivery is. If a backlog builds up (say, the network paused and
// then a big chunk landed all at once), the reveal speed ramps up so it
// catches back up without ever looking like an instant paste.
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';

const BASE_CHARS_PER_SECOND = 45;   // steady, comfortable reading-while-typing pace
const MAX_CHARS_PER_SECOND  = 260;  // ceiling once we're badly behind — still visibly "typed"
const BACKLOG_FOR_MAX_SPEED = 220;  // buffered chars at which we've ramped to max speed

export function useSmoothStream(onComplete?: () => void) {
  const [displayed, setDisplayed] = useState('');

  const bufferRef     = useRef('');
  const sourceDoneRef = useRef(false); // network/SSE side has finished sending chunks
  const completedRef  = useRef(false); // onComplete already fired for this run
  const rafRef        = useRef<number | null>(null);
  const lastTsRef      = useRef(0);
  const carryRef       = useRef(0);     // fractional character carry-over between frames

  // Always call the latest onComplete without having to re-create the loop.
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const stopLoop = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const tick = useCallback((ts: number) => {
    if (!lastTsRef.current) lastTsRef.current = ts;
    const dt = Math.min(ts - lastTsRef.current, 100); // clamp tab-switch/jank gaps
    lastTsRef.current = ts;

    if (bufferRef.current.length > 0) {
      const backlog = bufferRef.current.length;
      const ramp    = Math.min(backlog / BACKLOG_FOR_MAX_SPEED, 1);
      const speed   = BASE_CHARS_PER_SECOND + ramp * (MAX_CHARS_PER_SECOND - BASE_CHARS_PER_SECOND);

      carryRef.current += (speed * dt) / 1000;
      const take = Math.min(Math.floor(carryRef.current), backlog);

      if (take > 0) {
        carryRef.current -= take;
        const nextChunk = bufferRef.current.slice(0, take);
        bufferRef.current = bufferRef.current.slice(take);
        setDisplayed((prev) => prev + nextChunk);
      }
    }

    if (bufferRef.current.length > 0) {
      rafRef.current = requestAnimationFrame(tick);
    } else {
      rafRef.current = null;
      lastTsRef.current = 0;
      if (sourceDoneRef.current && !completedRef.current) {
        completedRef.current = true;
        onCompleteRef.current?.();
      }
    }
  }, []);

  const ensureLoop = useCallback(() => {
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [tick]);

  // Add newly-arrived network text to the reveal buffer.
  const push = useCallback((chunk: string) => {
    if (!chunk) return;
    bufferRef.current += chunk;
    ensureLoop();
  }, [ensureLoop]);

  // Marks the network side as finished. If the reveal buffer is already
  // empty, completes immediately; otherwise the reveal loop keeps draining
  // it and fires onComplete once every buffered character is on screen.
  const finish = useCallback(() => {
    sourceDoneRef.current = true;
    if (bufferRef.current.length === 0 && !completedRef.current) {
      completedRef.current = true;
      onCompleteRef.current?.();
    } else {
      ensureLoop();
    }
  }, [ensureLoop]);

  // Clears everything for a new streaming run.
  const reset = useCallback(() => {
    stopLoop();
    bufferRef.current = '';
    sourceDoneRef.current = false;
    completedRef.current = false;
    carryRef.current = 0;
    lastTsRef.current = 0;
    setDisplayed('');
  }, [stopLoop]);

  useEffect(() => stopLoop, [stopLoop]);

  return { displayed, push, finish, reset };
}
