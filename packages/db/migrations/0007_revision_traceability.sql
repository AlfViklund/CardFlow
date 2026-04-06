-- Durable revision traceability: explicit columns for immutable audit trail

-- Revisions: explicit traceability fields (in addition to existing trace jsonb)
ALTER TABLE revisions ADD COLUMN IF NOT EXISTS workflow_version text;
ALTER TABLE revisions ADD COLUMN IF NOT EXISTS prompt_version text;
ALTER TABLE revisions ADD COLUMN IF NOT EXISTS model_id text;
ALTER TABLE revisions ADD COLUMN IF NOT EXISTS seed bigint;
ALTER TABLE revisions ADD COLUMN IF NOT EXISTS reference_hashes text[] DEFAULT '{}';

-- Jobs: traceability fields for generation provenance
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS workflow_version text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS prompt_version text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS model_id text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS seed bigint;

-- Cards: track which workflow version, model, and references were used
ALTER TABLE cards ADD COLUMN IF NOT EXISTS workflow_version text;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS last_generated_model_id text;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS reference_hashes text[] DEFAULT '{}';

-- Index for looking up revisions by model/prompt version
CREATE INDEX IF NOT EXISTS idx_revisions_workflow_version ON revisions(workflow_version) WHERE workflow_version IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_revisions_model_id ON revisions(model_id) WHERE model_id IS NOT NULL;
