// src/services/voiceMemoService.js
// ============================================================
// VOICE MEMO SERVICE
//
// Supports BOTH in-app recording and uploading an existing audio file —
// both flow through this exact same service, distinguished only by the
// `source` field ('recorded' | 'uploaded'). There is no separate code
// path or AI logic for uploaded vs. recorded audio; a voice memo is a
// voice memo regardless of how the bytes arrived.
//
// Upload mechanics reuse services/storage.js's Cloudinary integration
// (uploadAudioBuffer) rather than a signed-URL direct-to-storage flow —
// this matches the existing file_uploads pattern already used elsewhere
// in the app instead of introducing a second storage integration.
//
// Web-only: no MediaRecorder/native-mobile-specific server logic here —
// the server side just receives a multipart audio buffer regardless of
// how the browser produced it (MediaRecorder blob or a picked file).
// ============================================================

import supabaseAdmin from '../config/supabase.js';
import { uploadAudioBuffer, deleteAudioObject } from './storage.js';
import { transcribeAudio } from './transcription.js';
import { generateMeetingDebrief } from './groqCalendarIntelligence.js';
import { extractCommitmentsAndSignals } from './calendarCommitmentsSignals.js';
import { shouldExtractCommitmentsSignals, recordGateDecision } from './calendarAiGate.js';
import { MeetingDebriefSchema, validateOrFallback } from '../schemas/calendarAiSchemas.js';
import { VOICE_MEMO_LIMITS, BACKGROUND_JOB_TYPES } from '../config/constants.js';
import { backgroundQueue } from '../jobs/queues.js';
import { notifyUser } from './notifications.js';
import { createLogger } from '../utils/logger.js';

const { logError } = createLogger('VoiceMemoService');

function energyFromOutcome(outcome) {
  return { hot: 5, positive: 4, neutral: 3, cold: 2, dead: 1 }[outcome] || 3;
}

/**
 * Single-step upload: receives the raw audio buffer (already parsed from
 * multipart by the route's multer middleware), validates, uploads to
 * Cloudinary, creates the voice_memos row, and enqueues transcription.
 * Used for BOTH recording (browser MediaRecorder blob) and file upload
 * (user-picked existing audio file) — same function, same validation,
 * same downstream pipeline.
 */
export async function createMemo({ workspaceId, userId, eventId, buffer, mimeType, originalFilename, source, clientDurationSeconds }) {
  if (!VOICE_MEMO_LIMITS.ALLOWED_MIME_TYPES.includes(mimeType)) {
    return { error: `Unsupported audio type: ${mimeType}` };
  }
  if (buffer.length > VOICE_MEMO_LIMITS.MAX_SIZE_BYTES) {
    return { error: `File too large. Maximum size is ${VOICE_MEMO_LIMITS.MAX_SIZE_BYTES / 1024 / 1024}MB.` };
  }
  if (clientDurationSeconds && clientDurationSeconds > VOICE_MEMO_LIMITS.MAX_DURATION_SECONDS) {
    return { error: `Recording too long. Maximum duration is ${VOICE_MEMO_LIMITS.MAX_DURATION_SECONDS / 60} minutes.` };
  }

  const { data: event } = await supabaseAdmin.from('user_events').select('id')
    .eq('id', eventId).eq('workspace_id', workspaceId).eq('user_id', userId).single();
  if (!event) return { error: 'Event not found' };

  let uploadResult;
  try {
    uploadResult = await uploadAudioBuffer(buffer, { originalFilename, mimeType, userId });
  } catch (err) {
    logError('createMemo upload', err, { eventId, workspaceId });
    return { error: 'Upload failed. Please try again.' };
  }

  const { data: memo, error } = await supabaseAdmin.from('voice_memos').insert({
    workspace_id: workspaceId,
    user_id: userId,
    event_id: eventId,
    source: source === 'uploaded' ? 'uploaded' : 'recorded',
    original_filename: source === 'uploaded' ? originalFilename : null,
    storage_path: uploadResult.storagePath,
    mime_type: mimeType,
    duration_seconds: uploadResult.durationSeconds || clientDurationSeconds || null,
    file_size_bytes: buffer.length,
    transcription_status: 'pending',
  }).select().single();

  if (error) {
    logError('createMemo insert', error, { eventId, workspaceId });
    await deleteAudioObject(uploadResult.storagePath).catch(() => {});
    return { error: 'Could not save voice memo.' };
  }

  await backgroundQueue.add(
    BACKGROUND_JOB_TYPES.VOICE_MEMO_TRANSCRIBE,
    { memoId: memo.id, workspaceId, userId },
    { jobId: `transcribe_${memo.id}`, attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
  ).catch(err => logError('enqueue voice_memo_transcribe', err, { memoId: memo.id }));

  return { memo };
}

/**
 * Job handler: fetches the uploaded audio, transcribes via Groq Whisper,
 * persists the transcript, and chains into enrichment.
 */
export async function transcribeMemo({ memoId, workspaceId, userId }) {
  const { data: memo } = await supabaseAdmin.from('voice_memos').select('*')
    .eq('id', memoId).eq('workspace_id', workspaceId).single();
  if (!memo || memo.transcription_status === 'completed') return; // idempotency guard

  await supabaseAdmin.from('voice_memos').update({ transcription_status: 'processing' }).eq('id', memoId);

  let transcript;
  try {
    const cloudinary = (await import('../config/cloudinary.js')).default;
    const audioUrl = cloudinary.url(memo.storage_path, { resource_type: 'video' });

    const audioBuffer = await fetch(audioUrl).then(r => r.arrayBuffer());
    transcript = await transcribeAudio(audioBuffer, { mimeType: memo.mime_type, filename: memo.original_filename || 'memo.webm' });

    await supabaseAdmin.from('voice_memos').update({
      transcript_text: transcript.text,
      transcription_status: 'completed',
      transcribed_at: new Date().toISOString(),
    }).eq('id', memoId);
  } catch (err) {
    // Only the transcription step itself lands here now. Enqueueing
    // enrichment is handled separately below, outside this try/catch, so a
    // failure to enqueue can no longer overwrite a transcription that
    // actually succeeded.
    await supabaseAdmin.from('voice_memos').update({
      transcription_status: 'failed',
      transcription_error: err.message?.slice(0, 500),
    }).eq('id', memoId);
    throw err;
  }

  // Transcription is fully committed at this point (DB already says
  // 'completed'). Enqueueing enrichment is a separate concern from here on:
  // if it fails, log it rather than reporting transcription itself as
  // failed and rethrowing. Previously this call lived inside the try above
  // with jobId `voice-enrich:${memoId}` — BullMQ rejects ':' in custom job
  // ids ("Custom Id cannot contain :"), so every transcription successfully
  // completed and then immediately got relabeled 'failed' by the catch
  // block on this line, retrying transcription from scratch up to
  // `attempts` times per memo for no reason related to transcription at all.
  await backgroundQueue.add(
    BACKGROUND_JOB_TYPES.VOICE_MEMO_ENRICH,
    { memoId, workspaceId, userId },
    { jobId: `voice_enrich_${memoId}`, attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
  ).catch(err => logError('enqueue voice_memo_enrich', err, { memoId }));
}

/**
 * Job handler: feeds the transcript into the EXACT SAME debrief +
 * commitment/signal extraction pipeline that typed raw_notes already
 * uses — a voice memo is an alternative input path into existing
 * intelligence, not a parallel AI feature.
 */
export async function enrichMemo({ memoId, workspaceId, userId }) {
  const { data: memo } = await supabaseAdmin.from('voice_memos').select('*, user_events(*)')
    .eq('id', memoId).eq('workspace_id', workspaceId).single();
  if (!memo || memo.debrief_generated) return;

  const event = memo.user_events;
  if (!event) return;

  const gate = shouldExtractCommitmentsSignals(memo.transcript_text);
  await recordGateDecision({ workspaceId, userId, eventId: event.id, aiFunction: 'voice_memo_enrich', gateResult: gate });
  if (!gate.proceed) {
    await supabaseAdmin.from('voice_memos').update({ debrief_generated: true, summarized_at: new Date().toISOString() }).eq('id', memoId);
    return;
  }

  const [{ data: userRow }, { data: wp }] = await Promise.all([
    supabaseAdmin.from('users').select('*').eq('id', userId).single(),
    supabaseAdmin.from('workspace_profiles').select('*').eq('workspace_id', workspaceId).eq('user_id', userId).maybeSingle(),
  ]);
  const userCtx = { ...userRow, ...wp, workspace_id: workspaceId, id: userId };

  const rawDebrief = await generateMeetingDebrief(userCtx, event, memo.transcript_text, event.outcome || 'neutral');
  const FALLBACK_DEBRIEF = {
    summary: `Meeting completed with ${event.attendee_name || 'prospect'} (via voice memo).`,
    what_worked: 'You captured a voice memo — that always beats no notes at all.',
    what_to_improve: 'Consider noting one specific next step out loud at the end of future memos.',
    coachable_moment: 'What you do in the next 48 hours matters more than the meeting outcome itself.',
    next_step_recommendation: 'Review the transcript and send a follow-up confirming one specific next action.',
  };
  const debrief = validateOrFallback(MeetingDebriefSchema, rawDebrief, FALLBACK_DEBRIEF, { context: `voice-memo-debrief:${memoId}` });
  const persistedDebrief = { ...debrief, generated_at: new Date().toISOString() };

  const { data: existingOpenCommitments } = event.prospect_id
    ? await supabaseAdmin.from('conversation_commitments').select('commitment_text')
        .eq('prospect_id', event.prospect_id).eq('workspace_id', workspaceId)
        .in('status', ['pending', 'overdue']).eq('owner', 'founder')
    : { data: [] };

  const { commitments, signals } = await extractCommitmentsAndSignals(
    memo.transcript_text, event.attendee_name, event.outcome, existingOpenCommitments || [],
    { workspaceId, userId, eventId: event.id }
  );

  const updates = [
    supabaseAdmin.from('voice_memos').update({
      ai_summary: persistedDebrief, debrief_generated: true, summarized_at: new Date().toISOString(),
    }).eq('id', memoId),
  ];

  if (!event.debrief_completed_at) {
    updates.push(supabaseAdmin.from('user_events').update({
      debrief_content: persistedDebrief,
      debrief_completed_at: new Date().toISOString(),
      meeting_notes: memo.transcript_text,
      outcome: event.outcome || 'neutral',
      energy_score: energyFromOutcome(event.outcome || 'neutral'),
      signals_extracted: true,
    }).eq('id', event.id).eq('workspace_id', workspaceId));
  }

  await Promise.all(updates);

  if (commitments.length) {
    await supabaseAdmin.from('conversation_commitments').insert(
      commitments.map(c => ({
        workspace_id: workspaceId, user_id: userId, prospect_id: event.prospect_id || null,
        source_type: 'voice_memo', source_id: memo.id, event_id: event.id,
        commitment_text: c.commitment_text, owner: c.owner || 'founder', status: 'pending', due_date: c.due_date || null,
      }))
    ).then(({ error }) => error && logError('voice memo commitments insert', error, { memoId }));
  }
  if (signals.length) {
    await supabaseAdmin.from('conversation_signals').insert(
      signals.map(s => ({
        workspace_id: workspaceId, user_id: userId, prospect_id: event.prospect_id || null,
        source_type: 'voice_memo', source_id: memo.id, detected_at: new Date(), event_id: event.id,
        signal_type: s.signal_type, signal_text: s.signal_text, confidence: s.confidence || null,
      }))
    ).then(({ error }) => error && logError('voice memo signals insert', error, { memoId }));
  }

  if (userRow?.fcm_token && userRow.notification_preferences?.calendar_prep_ready !== false) {
    await notifyUser(userId, {
      title: '🎙️ Meeting summary ready',
      body: `Your voice memo for "${event.title}" has been transcribed and summarized.`,
      data: { type: 'voice_memo_ready', event_id: event.id, memo_id: memoId },
    }, userRow.fcm_token).catch(() => {});
  }
}

export async function retryTranscription({ memoId, workspaceId, userId }) {
  const { data: memo } = await supabaseAdmin.from('voice_memos').select('id, transcription_status')
    .eq('id', memoId).eq('workspace_id', workspaceId).eq('user_id', userId).single();
  if (!memo) return { error: 'Voice memo not found' };
  if (memo.transcription_status === 'completed') return { error: 'Already transcribed' };

  await supabaseAdmin.from('voice_memos').update({ transcription_status: 'pending', transcription_error: null }).eq('id', memoId);
  await backgroundQueue.add(
    BACKGROUND_JOB_TYPES.VOICE_MEMO_TRANSCRIBE,
    { memoId, workspaceId, userId },
    { jobId: `transcribe_retry_${memoId}_${Date.now()}`, attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
  );
  return { success: true };
}

export async function listMemosForEvent(workspaceId, userId, eventId) {
  const { data: memos } = await supabaseAdmin.from('voice_memos').select('*')
    .eq('event_id', eventId).eq('workspace_id', workspaceId).eq('user_id', userId)
    .order('created_at', { ascending: false });

  const cloudinary = (await import('../config/cloudinary.js')).default;
  return (memos || []).map(m => ({
    ...m,
    playback_url: cloudinary.url(m.storage_path, { resource_type: 'video' }),
  }));
}

export async function searchTranscripts(workspaceId, userId, q) {
  const { data } = await supabaseAdmin
    .from('voice_memos')
    .select('event_id, transcript_text')
    .eq('workspace_id', workspaceId).eq('user_id', userId)
    .textSearch('transcript_tsv', q, { type: 'plain' })
    .limit(10);
  return data || [];
}

export async function deleteMemosForEvent(workspaceId, eventId) {
  const { data: memos } = await supabaseAdmin.from('voice_memos').select('storage_path')
    .eq('event_id', eventId).eq('workspace_id', workspaceId);
  for (const memo of (memos || [])) {
    await deleteAudioObject(memo.storage_path).catch(() => {});
  }
  // DB rows are removed automatically via ON DELETE CASCADE on event_id.
}

export default {
  createMemo, transcribeMemo, enrichMemo, retryTranscription,
  listMemosForEvent, searchTranscripts, deleteMemosForEvent,
};
