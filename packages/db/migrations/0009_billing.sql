-- cbb08985 — Credits ledger and subscription billing

CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'free',  -- free, basic, pro, enterprise
  status text NOT NULL DEFAULT 'active',  -- active, past_due, cancelled, expired
  credits_per_period integer NOT NULL DEFAULT 0,
  credits_used integer NOT NULL DEFAULT 0,
  period_start timestamptz NOT NULL DEFAULT now(),
  period_end timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Append-only credits ledger
CREATE TABLE IF NOT EXISTS credits_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  type text NOT NULL,  -- purchase, consumption, grant, refund
  amount integer NOT NULL,  -- positive for grants/purchases, negative for consumption
  reference text,  -- generation_job_id or manual note
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credits_ledger_subscription ON credits_ledger(subscription_id);
CREATE INDEX IF NOT EXISTS idx_credits_ledger_created ON credits_ledger(created_at);
CREATE INDEX IF NOT EXISTS idx_credits_ledger_type ON credits_ledger(subscription_id, type);

-- Add billing columns to projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS billing_email text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS subscription_id uuid REFERENCES subscriptions(id);
