-- 004_multi_attendee.sql
-- event_attendees is additive. user_events.attendee_name/attendee_context
-- remain the "primary attendee" fields for backward compatibility with
-- every existing AI prompt and read path.

CREATE TABLE public.event_attendees (
    id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    event_id      uuid NOT NULL REFERENCES user_events(id) ON DELETE CASCADE,
    workspace_id  uuid NOT NULL,
    prospect_id   uuid REFERENCES prospects(id) ON DELETE SET NULL,
    name          text NOT NULL,
    email         text,
    role          text DEFAULT 'attendee', -- 'organizer' | 'attendee' | 'optional'
    is_primary    boolean DEFAULT false,
    created_at    timestamptz DEFAULT now()
);

CREATE INDEX idx_event_attendees_event ON event_attendees(event_id);
CREATE INDEX idx_event_attendees_prospect ON event_attendees(prospect_id) WHERE prospect_id IS NOT NULL;
CREATE INDEX idx_event_attendees_workspace ON event_attendees(workspace_id);
