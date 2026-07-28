-- 012_calendar_ai_audit_log.sql
-- Structured, queryable answer to "how much is calendar AI costing us, and
-- is the cost gate actually saving anything" — populated exclusively by
-- services/calendarAiGate.js rather than scattered console.log calls.

CREATE TABLE public.calendar_ai_events (
    id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id     uuid NOT NULL,
    user_id          uuid,
    event_id         uuid, -- nullable: some gate decisions (e.g. dedup scan) aren't tied to a single calendar event
    ai_function      text NOT NULL, -- 'prep' | 'research' | 'extract_commitments_signals' | 'follow_up'
    gate_decision    text NOT NULL, -- 'proceed' | 'skipped' | 'reused_cache'
    gate_reason      text,
    model_tier       text, -- 'fast' | 'quality' | NULL when skipped
    created_at       timestamptz DEFAULT now()
);

CREATE INDEX idx_calendar_ai_events_workspace_date ON calendar_ai_events(workspace_id, created_at DESC);
CREATE INDEX idx_calendar_ai_events_function ON calendar_ai_events(ai_function, gate_decision);
