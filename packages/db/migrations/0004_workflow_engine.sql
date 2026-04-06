-- Workflow engine: regeneration requests, export readiness tracking

CREATE TABLE IF NOT EXISTS regeneration_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  step_id uuid REFERENCES steps(id) ON DELETE CASCADE,
  scope text NOT NULL,                -- 'stage' | 'card' | 'element'
  element text,                       -- null for stage/card, or 'text' | 'scene' | 'design' | 'background' | 'position'
  reason text,
  status text NOT NULL DEFAULT 'pending',  -- pending | enqueued | completed | failed
  previous_step_result jsonb,         -- snapshot of what we're regenerating from
  new_step_id uuid REFERENCES steps(id) ON DELETE SET NULL,
  trace_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_reg_requests_card ON regeneration_requests(card_id);
CREATE INDEX IF NOT EXISTS idx_reg_requests_step ON regeneration_requests(step_id);
