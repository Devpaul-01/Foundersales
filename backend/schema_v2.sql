-- ============================================================
-- CLUTCH AI - SCHEMA V2
-- Run the original schema.sql first, then this file.
-- ============================================================

-- ============================================================
-- PART 1: SALES PIPELINE EXTENSIONS
-- ============================================================

-- Extend opportunities with pipeline stage
ALTER TABLE opportunities 
  ADD COLUMN IF NOT EXISTS stage TEXT DEFAULT 'new'
  CHECK (stage IN ('new', 'contacted', 'replied', 'call_demo', 'closed_won', 'closed_lost'));

-- Extend feedback with deal value and scheduling signals
ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS deal_value_usd INTEGER,
  ADD COLUMN IF NOT EXISTS scheduled_call BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_final BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS scheduled_call_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scheduled_call_notes TEXT;

-- ============================================================
-- PART 2: CHAT SYSTEM
-- ============================================================

-- Chat threads (can be linked to an opportunity)
CREATE TABLE IF NOT EXISTS chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  title TEXT,                    -- e.g. "Outreach refinement for John @reddit"
  chat_type TEXT DEFAULT 'general' CHECK (chat_type IN ('general', 'opportunity', 'practice')),
  opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,

  -- For practice chats
  practice_session_id UUID REFERENCES practice_sessions(id) ON DELETE SET NULL,

  -- Metadata
  is_archived BOOLEAN DEFAULT FALSE,
  message_count INTEGER DEFAULT 0,
  last_message_at TIMESTAMPTZ
);

-- Individual messages in a chat
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID REFERENCES chats(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Who sent it
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),

  -- Content
  content TEXT NOT NULL,

  -- For practice mode - message delivery simulation
  -- 'sent' → 'delivered' → 'seen' → 'replied' | 'ghosted'
  delivery_status TEXT DEFAULT 'sent'
    CHECK (delivery_status IN ('sent', 'delivered', 'seen', 'replied', 'ghosted')),
  
  -- Timestamps for each status
  delivered_at TIMESTAMPTZ,
  seen_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  ghosted_at TIMESTAMPTZ,

  -- AI metadata
  model_used TEXT,              -- 'grok', 'perplexity'
  tokens_used INTEGER,
  is_streamed BOOLEAN DEFAULT FALSE,

  -- File attachments
  attachments JSONB DEFAULT '[]', -- [{url, type, name, size_bytes}]

  -- For citations/structured data from search
  citations JSONB DEFAULT '[]',   -- [{url, title, snippet}]
  
  -- Practice-specific
  scenario_type TEXT,             -- Which scenario this reply simulates
  coaching_tip TEXT               -- Shown after practice AI reply
);

-- ============================================================
-- PART 3: MESSAGE QUEUE (Delayed AI Replies)
-- DB-based queue - no Redis needed at MVP scale.
-- Background worker polls every 30s.
-- ============================================================

CREATE TABLE IF NOT EXISTS message_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  scheduled_for TIMESTAMPTZ NOT NULL,
  executed_at TIMESTAMPTZ,

  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'executing', 'done', 'failed', 'cancelled')),

  -- What job to run
  job_type TEXT NOT NULL,
  -- 'practice_reply'     → AI replies to user's practice message
  -- 'practice_ghost'     → Mark as ghosted after timeout
  -- 'practice_seen'      → Mark message as "seen" (realistic delay)
  -- 'practice_delivered' → Mark as "delivered"

  -- Job data
  payload JSONB NOT NULL,
  -- For practice_reply: { chat_id, message_id, scenario_type, user_id }
  -- For practice_ghost: { chat_id, message_id, user_id }

  -- Error handling
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  last_error TEXT
);

-- Index for the worker poll query (critical for performance)
CREATE INDEX IF NOT EXISTS idx_message_queue_pending 
  ON message_queue(status, scheduled_for) 
  WHERE status = 'pending';

-- ============================================================
-- PART 4: FILE UPLOADS
-- ============================================================

CREATE TABLE IF NOT EXISTS file_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Storage
  storage_provider TEXT DEFAULT 'supabase', -- 'supabase' or 'cloudinary'
  storage_path TEXT NOT NULL,               -- path in Supabase Storage bucket
  public_url TEXT NOT NULL,                 -- Direct URL for AI access

  -- File metadata
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER,
  file_type TEXT CHECK (file_type IN ('image', 'pdf', 'document', 'other')),

  -- Association
  chat_id UUID REFERENCES chats(id) ON DELETE SET NULL,
  message_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL
);

-- ============================================================
-- PART 5: EXTENDED ONBOARDING
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role TEXT,           -- 'founder', 'sales', 'freelancer', 'marketer', 'other'
  ADD COLUMN IF NOT EXISTS industry TEXT,        -- 'saas', 'ecommerce', 'services', 'fintech', etc.
  ADD COLUMN IF NOT EXISTS platforms_used JSONB DEFAULT '[]', -- ['reddit','linkedin','twitter']
  ADD COLUMN IF NOT EXISTS outreach_goals JSONB DEFAULT '[]', -- ['get_customers','find_investors','partnerships']
  ADD COLUMN IF NOT EXISTS experience_level TEXT, -- 'beginner', 'intermediate', 'advanced'
  ADD COLUMN IF NOT EXISTS company_size TEXT,    -- 'solo', '2-5', '6-20', '20+'
  ADD COLUMN IF NOT EXISTS monthly_revenue TEXT, -- 'pre-revenue', '<1k', '1k-10k', '10k+'
  ADD COLUMN IF NOT EXISTS debug_mode BOOLEAN DEFAULT FALSE; -- Part 15: frontend debug toasts

-- ============================================================
-- PART 6: TOKEN-BASED USAGE TRACKING
-- ============================================================

-- Replace request-count tracking with token tracking
ALTER TABLE usage_tracking
  ADD COLUMN IF NOT EXISTS grok_tokens_in INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grok_tokens_out INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS perplexity_tokens_in INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS perplexity_tokens_out INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_cost_cents INTEGER DEFAULT 0;

-- Monthly rollup for billing/dashboard
CREATE TABLE IF NOT EXISTS monthly_token_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  month DATE NOT NULL,                          -- First day of month

  grok_tokens_total INTEGER DEFAULT 0,
  perplexity_tokens_total INTEGER DEFAULT 0,
  total_cost_cents INTEGER DEFAULT 0,

  -- Allowance (from their tier)
  token_allowance INTEGER DEFAULT 100000,
  allowance_used_pct DECIMAL DEFAULT 0,

  UNIQUE(user_id, month)
);

-- ============================================================
-- PART 7: PRACTICE SESSION RATINGS
-- ============================================================

ALTER TABLE practice_sessions
  ADD COLUMN IF NOT EXISTS rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS rating_note TEXT,
  ADD COLUMN IF NOT EXISTS chat_id UUID REFERENCES chats(id) ON DELETE SET NULL;

-- ============================================================
-- PART 8: CALENDAR SYSTEM EXTENSION
-- ============================================================

-- Extend existing user_events
ALTER TABLE user_events
  ADD COLUMN IF NOT EXISTS opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS prep_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attendee_name TEXT,
  ADD COLUMN IF NOT EXISTS attendee_context TEXT;

-- ============================================================
-- PART 9: PIPELINE METRICS VIEW (computed, no maintenance)
-- ============================================================

CREATE OR REPLACE VIEW pipeline_metrics AS
SELECT
  o.user_id,
  COUNT(*) FILTER (WHERE o.stage = 'new') AS new_count,
  COUNT(*) FILTER (WHERE o.stage = 'contacted') AS contacted_count,
  COUNT(*) FILTER (WHERE o.stage = 'replied') AS replied_count,
  COUNT(*) FILTER (WHERE o.stage = 'call_demo') AS call_demo_count,
  COUNT(*) FILTER (WHERE o.stage = 'closed_won') AS closed_won_count,
  COUNT(*) FILTER (WHERE o.stage = 'closed_lost') AS closed_lost_count,
  
  -- Revenue metrics
  COALESCE(SUM(f.deal_value_usd) FILTER (WHERE o.stage = 'closed_won'), 0) AS total_revenue,
  COALESCE(SUM(f.deal_value_usd) FILTER (WHERE o.stage = 'call_demo'), 0) AS pipeline_value,
  
  -- Win rate: won / (won + lost)
  CASE 
    WHEN (COUNT(*) FILTER (WHERE o.stage IN ('closed_won', 'closed_lost'))) = 0 THEN 0
    ELSE ROUND(
      COUNT(*) FILTER (WHERE o.stage = 'closed_won')::DECIMAL /
      COUNT(*) FILTER (WHERE o.stage IN ('closed_won', 'closed_lost')) * 100, 1
    )
  END AS win_rate_pct

FROM opportunities o
LEFT JOIN feedback f ON f.opportunity_id = o.id
GROUP BY o.user_id;

-- ============================================================
-- PART 10: RLS FOR NEW TABLES
-- ============================================================

ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_token_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chats_own" ON chats FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "messages_own" ON chat_messages FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "uploads_own" ON file_uploads FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "monthly_usage_own" ON monthly_token_usage FOR ALL USING (auth.uid() = user_id);
-- message_queue is backend-only (service role), no user RLS needed

-- ============================================================
-- PART 11: INDEXES FOR NEW TABLES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chats_opportunity ON chats(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON chat_messages(chat_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_delivery ON chat_messages(delivery_status) WHERE delivery_status != 'replied';
CREATE INDEX IF NOT EXISTS idx_uploads_user ON file_uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_stage ON opportunities(user_id, stage);
CREATE INDEX IF NOT EXISTS idx_monthly_usage ON monthly_token_usage(user_id, month DESC);

-- ============================================================
-- PART 12: UPDATED_AT TRIGGERS FOR NEW TABLES
-- ============================================================

CREATE TRIGGER chats_updated_at
  BEFORE UPDATE ON chats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Supabase Realtime: Enable for tables frontend subscribes to
-- Run in Supabase dashboard → Database → Replication
-- Or via SQL:
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE message_queue;
ALTER PUBLICATION supabase_realtime ADD TABLE opportunities;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notification_preferences JSONB DEFAULT '{"new_opportunities":true,"feedback_reminders":true,"practice_replies":true,"calendar_prep_ready":true}';

-- Add completed_at to practice_sessions
ALTER TABLE practice_sessions
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Add is_deleted to users  
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;