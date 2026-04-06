-- CardFlow cards, steps, approvals, comments, workflow definitions

CREATE TABLE IF NOT EXISTS workflow_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marketplace text NOT NULL,              -- 'wildberries' | 'ozon'
  version integer NOT NULL DEFAULT 1,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,  -- ordered step template array with inheritance rules
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (marketplace, version)
);

CREATE TABLE IF NOT EXISTS cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  card_number integer NOT NULL,           -- 1..N (default 8)
  status text NOT NULL DEFAULT 'draft',   -- draft | step-active | approved | needs-revision | rejected
  title text NOT NULL DEFAULT '',
  prompt_instructions text NOT NULL DEFAULT '',
  current_step text,                      -- references steps.type in active workflow
  selected_concept_id uuid,               -- links to the chosen concept revision
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  type text NOT NULL,                     -- brief | text-plan | scenes | concept | final | revision | export
  position integer NOT NULL,              -- ordered within card's workflow
  status text NOT NULL DEFAULT 'pending', -- pending | in-progress | completed | needs-revision | skipped
  result jsonb,                           -- output data from this step
  error text,
  inherited_from_step_id uuid REFERENCES steps(id) ON DELETE SET NULL,  -- step inheritance
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (card_id, type)
);

CREATE TABLE IF NOT EXISTS step_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id uuid NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  action text NOT NULL,                   -- approved | rejected | requested-changes
  comment text,
  reviewed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  card_id uuid REFERENCES cards(id) ON DELETE CASCADE,
  step_id uuid REFERENCES steps(id) ON DELETE CASCADE,
  approval_id uuid REFERENCES step_approvals(id) ON DELETE CASCADE,
  author text NOT NULL,
  body text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (project_id IS NOT NULL) OR
    (card_id IS NOT NULL) OR
    (step_id IS NOT NULL) OR
    (approval_id IS NOT NULL)
  )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cards_project_id ON cards(project_id);
CREATE INDEX IF NOT EXISTS idx_steps_card_id ON steps(card_id);
CREATE INDEX IF NOT EXISTS idx_step_approvals_step_id ON step_approvals(step_id);
CREATE INDEX IF NOT EXISTS idx_comments_project ON comments(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comments_card ON comments(card_id) WHERE card_id IS NOT NULL;
