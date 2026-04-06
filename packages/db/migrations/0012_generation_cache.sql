-- db4252d5 — Generation cache for deduplication

CREATE TABLE IF NOT EXISTS generation_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key text NOT NULL UNIQUE,          -- stable hash of inputs
  result_id uuid NOT NULL,                  -- generation result ID
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  model_id text NOT NULL,
  prompt_hash text NOT NULL,
  output_refs jsonb NOT NULL DEFAULT '[]', -- URLs/asset IDs of generated outputs
  hit_count integer NOT NULL DEFAULT 0,
  cost_saved_cents integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  last_accessed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gen_cache_key ON generation_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_gen_cache_model ON generation_cache(model_id);
CREATE INDEX IF NOT EXISTS idx_gen_cache_expires ON generation_cache(expires_at);

-- Periodic cleanup of expired cache entries
DO $$ BEGIN
  -- This would be called by a cron/scheduled task in production
  -- DELETE FROM generation_cache WHERE expires_at < now();
EXCEPTION WHEN OTHERS THEN
  NULL; -- skip on migration errors
END $$;
