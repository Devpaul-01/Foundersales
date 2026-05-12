-- ============================================================
-- CLUTCH AI - COMPLETE DATABASE SCHEMA
-- Run this in your Supabase SQL editor
-- ============================================================

-- ============================================================
-- USERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Basic info
  name TEXT,
  email TEXT UNIQUE NOT NULL,

  -- Business profile (collected in onboarding Step 1)
  business_name TEXT,
  website TEXT,
  product_description TEXT,
  target_audience TEXT,

  -- AI-generated voice profile (built from all onboarding answers)
  -- Structure: { unique_value_prop, target_customer_description, main_objection, voice_style, success_story, outreach_persona }
  voice_profile JSONB,

  -- Onboarding answers stored as key-value pairs
  -- Structure: { "question text": "answer text", "question text": "answer text" }
  -- This way we never need to know column names - AI questions become the keys
  onboarding_answers JSONB DEFAULT '{}',

  -- Subscription
  tier TEXT DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'enterprise')),
  subscription_status TEXT DEFAULT 'active',

  -- Push notifications
  fcm_token TEXT,

  -- State
  onboarding_completed BOOLEAN DEFAULT FALSE,
  onboarding_step INTEGER DEFAULT 0  -- tracks which step they're on if they quit midway
);

-- ============================================================
-- OPPORTUNITIES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Lead info
  platform TEXT NOT NULL DEFAULT 'reddit',
  source_url TEXT NOT NULL,
  target_context TEXT,          -- who they are, what they posted about
  target_name TEXT,             -- inferred name or username
  prepared_message TEXT NOT NULL,

  -- AI scoring (1-10 each)
  fit_score INTEGER,
  timing_score INTEGER,
  intent_score INTEGER,
  composite_score DECIMAL GENERATED ALWAYS AS (
    (COALESCE(fit_score, 0) + COALESCE(timing_score, 0) + COALESCE(intent_score, 0)) / 3.0
  ) STORED,

  -- Message metadata (for learning which styles work)
  message_style TEXT,    -- 'empathetic', 'direct', 'question_led', 'story_based'
  message_length INTEGER, -- word count

  -- Status lifecycle: pending → viewed → acted → done
  status TEXT DEFAULT 'pending',

  -- Timestamps for each action
  viewed_at TIMESTAMPTZ,
  link_clicked_at TIMESTAMPTZ,
  message_copied_at TIMESTAMPTZ,
  marked_sent_at TIMESTAMPTZ,

  -- Which model generated this (tracking for quality comparison)
  generated_by TEXT DEFAULT 'grok', -- 'grok' or 'perplexity_fallback'

  UNIQUE(user_id, source_url)
);

-- ============================================================
-- FEEDBACK TABLE (General positive/negative system)
-- ============================================================
CREATE TABLE IF NOT EXISTS feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  opportunity_id UUID REFERENCES opportunities(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- General outcome - NOT "did they reply" but general positive/negative
  outcome TEXT NOT NULL CHECK (outcome IN ('positive', 'negative')),

  -- Optional note from user (what specifically happened)
  -- Example: "They replied and we scheduled a call", "No response after 3 days"
  outcome_note TEXT,

  -- Were they directed to Practice Mode after a negative?
  practice_suggested BOOLEAN DEFAULT FALSE,
  practice_accepted BOOLEAN DEFAULT FALSE,

  -- Timestamp of when feedback was prompted (48h after marked_sent)
  prompted_at TIMESTAMPTZ
);

-- ============================================================
-- PRACTICE SESSIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS practice_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Scenario
  scenario_type TEXT NOT NULL,
  -- 'interested', 'polite_decline', 'ghost', 'skeptical', 'price_objection', 'not_right_time'

  practice_prompt TEXT,    -- the fake post/situation shown to user
  user_message TEXT,       -- what the user wrote
  ai_response TEXT,        -- how the AI responded as prospect
  coaching_tip TEXT,       -- tip shown after the response

  -- Outcome tracking
  result TEXT,             -- 'positive', 'negative', 'ghost'
  completed BOOLEAN DEFAULT FALSE,

  -- Was this triggered by a real negative feedback?
  triggered_by_feedback_id UUID REFERENCES feedback(id)
);

-- ============================================================
-- PRACTICE BADGES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS practice_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  earned_at TIMESTAMPTZ DEFAULT NOW(),

  badge_type TEXT NOT NULL,
  -- 'first_send', 'first_rejection_survived', '5_rejections', '10_rejections',
  -- 'handled_price_objection', 'handled_skeptic', '7_day_streak', 'first_positive'

  badge_label TEXT,
  badge_description TEXT
);

-- ============================================================
-- USER PERFORMANCE PROFILES (summarized learning - updated by background job)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_performance_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Aggregate stats
  total_sent INTEGER DEFAULT 0,
  total_positive INTEGER DEFAULT 0,
  total_negative INTEGER DEFAULT 0,

  -- Computed rates
  positive_rate DECIMAL DEFAULT 0,

  -- What works for THIS user (discovered by AI analysis of their feedback)
  best_platform TEXT,
  best_message_style TEXT,
  best_message_length TEXT,   -- 'short', 'medium', 'long'

  -- Compact AI-readable summary injected into prompts
  -- Example: "User gets best results on Reddit with empathetic openers under 80 words"
  learned_patterns TEXT,

  -- When we last ran summarization (so we don't re-run unnecessarily)
  last_summarized_at TIMESTAMPTZ,
  messages_at_last_summary INTEGER DEFAULT 0  -- how many sent when we last summarized
);

-- ============================================================
-- USAGE TRACKING (API cost control)
-- ============================================================
CREATE TABLE IF NOT EXISTS usage_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  date DATE DEFAULT CURRENT_DATE,

  perplexity_calls INTEGER DEFAULT 0,
  grok_calls INTEGER DEFAULT 0,
  perplexity_tokens INTEGER DEFAULT 0,
  grok_tokens INTEGER DEFAULT 0,

  UNIQUE(user_id, date)
);

-- Global usage (for billing cap - separate from per-user)
CREATE TABLE IF NOT EXISTS global_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE DEFAULT CURRENT_DATE UNIQUE,
  perplexity_calls INTEGER DEFAULT 0,
  total_estimated_cost_cents INTEGER DEFAULT 0
);

-- ============================================================
-- DAILY METRICS (aggregated - updated nightly by background job)
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,

  opportunities_shown INTEGER DEFAULT 0,
  opportunities_viewed INTEGER DEFAULT 0,
  links_clicked INTEGER DEFAULT 0,
  messages_copied INTEGER DEFAULT 0,
  messages_sent INTEGER DEFAULT 0,
  positive_outcomes INTEGER DEFAULT 0,
  negative_outcomes INTEGER DEFAULT 0,

  -- Computed
  execution_rate DECIMAL DEFAULT 0,   -- sent / shown
  positive_rate DECIMAL DEFAULT 0,    -- positive / sent

  UNIQUE(user_id, date)
);

-- ============================================================
-- EVENTS TABLE (upcoming events feature)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  title TEXT NOT NULL,
  event_date DATE NOT NULL,
  event_type TEXT,  -- 'podcast', 'conference', 'launch', 'meeting', 'demo', 'interview'
  notes TEXT,

  -- Prep status
  prep_generated BOOLEAN DEFAULT FALSE,
  prep_content JSONB  -- { talking_points, pre_outreach, follow_up_template }
);

-- ============================================================
-- BACKGROUND JOB LOGS (simple health tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS job_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  job_name TEXT NOT NULL,
  status TEXT NOT NULL,  -- 'started', 'completed', 'failed'
  users_processed INTEGER DEFAULT 0,
  opportunities_found INTEGER DEFAULT 0,
  error_message TEXT,
  duration_ms INTEGER
);

-- ============================================================
-- ROW LEVEL SECURITY (CRITICAL - enables user data isolation)
-- ============================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_performance_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_events ENABLE ROW LEVEL SECURITY;

-- Users can only see/edit their own data
CREATE POLICY "users_own_data" ON users FOR ALL USING (auth.uid() = id);
CREATE POLICY "opportunities_own_data" ON opportunities FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "feedback_own_data" ON feedback FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "practice_own_data" ON practice_sessions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "badges_own_data" ON practice_badges FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "performance_own_data" ON user_performance_profiles FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "usage_own_data" ON usage_tracking FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "metrics_own_data" ON daily_metrics FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "events_own_data" ON user_events FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- INDEXES (for query performance)
-- ============================================================
CREATE INDEX idx_opportunities_user_status ON opportunities(user_id, status);
CREATE INDEX idx_opportunities_user_created ON opportunities(user_id, created_at DESC);
CREATE INDEX idx_feedback_opportunity ON feedback(opportunity_id);
CREATE INDEX idx_feedback_user_created ON feedback(user_id, created_at DESC);
CREATE INDEX idx_usage_user_date ON usage_tracking(user_id, date);
CREATE INDEX idx_metrics_user_date ON daily_metrics(user_id, date DESC);
CREATE INDEX idx_practice_user ON practice_sessions(user_id, created_at DESC);

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
