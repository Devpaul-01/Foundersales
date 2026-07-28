-- 013_booking_pages.sql
-- Native booking-link feature (Calendly-equivalent). Booked meetings flow
-- directly into the existing user_events + AI-prep pipeline via
-- resolveOrCreateProspect, same as any other attendee-bearing event.
-- No dependency on calendar sync — this is a standalone Foundersales-native
-- feature.

CREATE TABLE public.availability_windows (
    id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id uuid NOT NULL,
    user_id      uuid NOT NULL,
    day_of_week  integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0 = Sunday
    start_time   time NOT NULL,
    end_time     time NOT NULL,
    timezone     text NOT NULL,
    is_active    boolean DEFAULT true,
    CONSTRAINT chk_window_order CHECK (start_time < end_time)
);

CREATE INDEX idx_availability_windows_user ON availability_windows(workspace_id, user_id) WHERE is_active = true;

CREATE TABLE public.booking_pages (
    id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id      uuid NOT NULL,
    user_id           uuid NOT NULL,
    slug              text NOT NULL UNIQUE,
    title             text DEFAULT 'Book a meeting',
    duration_minutes  integer DEFAULT 30,
    buffer_minutes    integer DEFAULT 10,
    max_days_ahead    integer DEFAULT 30,
    is_active         boolean DEFAULT true,
    created_at        timestamptz DEFAULT now(),
    updated_at        timestamptz DEFAULT now()
);

CREATE INDEX idx_booking_pages_user ON booking_pages(workspace_id, user_id);
