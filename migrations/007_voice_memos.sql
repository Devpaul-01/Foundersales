-- 008_voice_memos.sql
-- Voice memo feature. `source` distinguishes in-app recordings from
-- uploaded existing audio files — both flow through the same transcription
-- + enrichment pipeline downstream (see services/voiceMemoService.js).

CREATE TABLE public.voice_memos (
    id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id          uuid NOT NULL,
    user_id               uuid NOT NULL,
    event_id              uuid REFERENCES user_events(id) ON DELETE CASCADE,
    source                text NOT NULL DEFAULT 'recorded', -- 'recorded' | 'uploaded'
    original_filename     text,                              -- set when source = 'uploaded'
    storage_path          text NOT NULL,
    mime_type             text NOT NULL,
    duration_seconds      integer,
    file_size_bytes       integer,
    transcription_status  text DEFAULT 'pending', -- 'pending' | 'processing' | 'completed' | 'failed'
    transcription_error   text,
    transcript_text       text,
    transcript_tsv        tsvector,
    ai_summary            jsonb,
    debrief_generated     boolean DEFAULT false,
    created_at            timestamptz DEFAULT now(),
    transcribed_at        timestamptz,
    summarized_at         timestamptz
);

CREATE INDEX idx_voice_memos_event ON voice_memos(event_id);
CREATE INDEX idx_voice_memos_workspace_user ON voice_memos(workspace_id, user_id);
CREATE INDEX idx_voice_memos_transcript_search ON voice_memos USING GIN(transcript_tsv);
CREATE INDEX idx_voice_memos_pending ON voice_memos(transcription_status) WHERE transcription_status IN ('pending', 'processing');

CREATE FUNCTION voice_memos_tsv_trigger() RETURNS trigger AS $$
BEGIN
  NEW.transcript_tsv := to_tsvector('english', COALESCE(NEW.transcript_text, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_voice_memos_tsv
  BEFORE INSERT OR UPDATE OF transcript_text ON voice_memos
  FOR EACH ROW EXECUTE FUNCTION voice_memos_tsv_trigger();
