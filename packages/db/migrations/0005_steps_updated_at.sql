-- Add updated_at to steps table (was missing from 0002_cards_workflow)

ALTER TABLE steps ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Backfill existing rows
UPDATE steps SET updated_at = created_at WHERE updated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_steps_updated_at ON steps(updated_at);
