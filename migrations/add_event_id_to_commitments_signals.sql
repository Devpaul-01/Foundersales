-- ============================================================
-- MIGRATION: Add event_id to conversation_commitments and conversation_signals
-- Date: 2026-08-17
-- Purpose: Link commitments and signals to specific events for voice memo enrichment
-- ============================================================

-- ============================================================
-- 1. Add event_id to conversation_commitments
-- ============================================================

-- Add the column
ALTER TABLE conversation_commitments 
ADD COLUMN IF NOT EXISTS event_id UUID;

-- Add foreign key constraint (optional but recommended)
ALTER TABLE conversation_commitments 
ADD CONSTRAINT fk_conversation_commitments_event 
FOREIGN KEY (event_id) 
REFERENCES user_events(id) 
ON DELETE SET NULL;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_conversation_commitments_event_id 
ON conversation_commitments(event_id);

-- ============================================================
-- 2. Add event_id to conversation_signals
-- ============================================================

-- Add the column
ALTER TABLE conversation_signals 
ADD COLUMN IF NOT EXISTS event_id UUID;

-- Add foreign key constraint (optional but recommended)
ALTER TABLE conversation_signals 
ADD CONSTRAINT fk_conversation_signals_event 
FOREIGN KEY (event_id) 
REFERENCES user_events(id) 
ON DELETE SET NULL;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_conversation_signals_event_id 
ON conversation_signals(event_id);

-- ============================================================
-- 3. Verify the migration (optional - run to check)
-- ============================================================

-- Check columns exist
SELECT 
  table_name, 
  column_name, 
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name IN ('conversation_commitments', 'conversation_signals')
  AND column_name = 'event_id'
ORDER BY table_name;

-- ============================================================
-- ROLLBACK (if needed)
-- ============================================================
-- DROP INDEX IF EXISTS idx_conversation_signals_event_id;
-- DROP INDEX IF EXISTS idx_conversation_commitments_event_id;
-- ALTER TABLE conversation_signals DROP COLUMN IF EXISTS event_id;
-- ALTER TABLE conversation_commitments DROP COLUMN IF EXISTS event_id;