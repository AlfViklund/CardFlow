-- 9c6fe204 — Batching engine and 4K generation limits

ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS batch_size integer DEFAULT 1;
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS max_resolution text DEFAULT '2000x2000';
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS cost_budget_cents integer;

-- Batch job groups table for 4K resolution batching
CREATE TABLE IF NOT EXISTS batch_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  batch_type text NOT NULL,         -- 4k_render, export_package, bulk_generate
  status text NOT NULL DEFAULT 'queued', -- queued | processing | completed | failed | partial
  max_resolution text NOT NULL DEFAULT '2000x2000',
  total_jobs integer NOT NULL DEFAULT 0,
  completed_jobs integer NOT NULL DEFAULT 0,
  failed_jobs integer NOT NULL DEFAULT 0,
  total_cost_cents integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Individual job references within a batch group
CREATE TABLE IF NOT EXISTS batch_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_group_id uuid NOT NULL REFERENCES batch_groups(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  sequence_order integer NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  result jsonb,
  error text,
  completed_at timestamptz,
  UNIQUE(batch_group_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_batch_groups_project ON batch_groups(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_batch_group_members_group ON batch_group_members(batch_group_id);
