-- Step 0 ingestion: analysis results, validation records

CREATE TABLE IF NOT EXISTS step0_ingestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',  -- pending | analyzing | ready | blocked
  main_image_id uuid,          -- links to assets table
  brief text NOT NULL DEFAULT '',
  inferred_category text,
  inferred_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  quality_risks jsonb NOT NULL DEFAULT '[]'::jsonb,
  blocking_reasons text[] NOT NULL DEFAULT '{}',
  can_proceed boolean NOT NULL DEFAULT false,
  analysis_result jsonb,       -- full analysis payload for audit
  analyzed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id)
);

CREATE TABLE IF NOT EXISTS validation_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingestion_id uuid NOT NULL REFERENCES step0_ingestions(id) ON DELETE CASCADE,
  marketplace text NOT NULL,
  rule_code text NOT NULL,
  field text NOT NULL,
  message text NOT NULL,
  is_blocking boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_step0_ingestions_project ON step0_ingestions(project_id);
CREATE INDEX IF NOT EXISTS idx_validation_records_ingestion ON validation_records(ingestion_id);
