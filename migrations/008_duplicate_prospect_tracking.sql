-- 009_duplicate_prospect_tracking.sql
-- Three-layer dedup: exact identifier match (email/linkedin) -> normalized
-- name match -> trigram similarity flagged for human review. See
-- services/prospectDedup.js.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE prospects
  ADD COLUMN name_normalized text GENERATED ALWAYS AS (
    lower(regexp_replace(trim(name), '\s+', ' ', 'g'))
  ) STORED;

CREATE INDEX idx_prospects_name_normalized ON prospects(workspace_id, user_id, name_normalized);
CREATE INDEX idx_prospects_name_trgm ON prospects USING GIN (name gin_trgm_ops);

CREATE TABLE public.prospect_merge_candidates (
    id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id     uuid NOT NULL,
    prospect_id_a    uuid NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
    prospect_id_b    uuid NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
    similarity_score numeric(4,3),
    match_reason     text NOT NULL, -- 'name_similarity' | 'email_match' | 'linkedin_match'
    status           text DEFAULT 'pending', -- 'pending' | 'merged' | 'dismissed'
    created_at       timestamptz DEFAULT now(),
    resolved_at      timestamptz,
    resolved_by      uuid,
    CONSTRAINT chk_distinct_prospects CHECK (prospect_id_a != prospect_id_b)
);

CREATE UNIQUE INDEX idx_merge_candidates_pair ON prospect_merge_candidates(
  LEAST(prospect_id_a, prospect_id_b), GREATEST(prospect_id_a, prospect_id_b)
);
CREATE INDEX idx_merge_candidates_workspace_pending
  ON prospect_merge_candidates(workspace_id, status) WHERE status = 'pending';

CREATE FUNCTION public.find_similar_prospects(
  p_workspace_id uuid, p_prospect_id uuid, p_name text, p_threshold numeric
) RETURNS TABLE(id uuid, similarity numeric) AS $$
  SELECT p.id, similarity(p.name, p_name) AS similarity
  FROM prospects p
  WHERE p.workspace_id = p_workspace_id
    AND p.id != p_prospect_id
    AND similarity(p.name, p_name) >= p_threshold
  ORDER BY similarity DESC
  LIMIT 5;
$$ LANGUAGE sql STABLE;
