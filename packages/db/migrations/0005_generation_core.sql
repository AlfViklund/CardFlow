-- Staged async generation core: generation jobs, outputs, provider tracking
CREATE TABLE IF NOT EXISTS generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  card_id uuid REFERENCES cards(id) ON DELETE SET NULL,
  stage text NOT NULL,              -- copy | scenes | design-concept | final
  status text NOT NULL DEFAULT 'queued',  -- queued | processing | completed | failed | cancelled
  scope text NOT NULL DEFAULT 'card',    -- card | batch | element
  element text,                     -- text | scene | design | background | position
  provider text,                    -- which AI provider was used
  model text,                       -- which model
  prompt text,                      -- the generation prompt
  seed bigint,                      -- reproducibility
  input_data jsonb,                 -- what we're generating from
  output_data jsonb,                -- generation results
  error text,
  parent_generation_id uuid REFERENCES generation_jobs(id) ON DELETE SET NULL,
  batch_id uuid,                    -- links generations in the same batch
  attempts integer NOT NULL DEFAULT 0,
  trace_id uuid NOT NULL DEFAULT gen_random_uuid(),
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS generation_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id uuid NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  card_id uuid REFERENCES cards(id) ON DELETE SET NULL,
  output_type text NOT NULL,        -- text | scene | concept_image | final_card | batch_metadata
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  storage_key text,                  -- S3 key for image outputs
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_generation_jobs_project ON generation_jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_card ON generation_jobs(card_id);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_status ON generation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_batch ON generation_jobs(batch_id);
CREATE INDEX IF NOT EXISTS idx_generation_outputs_generation ON generation_outputs(generation_id);
