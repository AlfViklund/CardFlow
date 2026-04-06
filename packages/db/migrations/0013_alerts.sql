-- d403c990 — Cost-control alerts and budget guardrails

CREATE TABLE IF NOT EXISTS alert_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  daily_budget_cents integer NOT NULL DEFAULT 1000,
  weekly_budget_cents integer NOT NULL DEFAULT 5000,
  monthly_budget_cents integer NOT NULL DEFAULT 20000,
  low_credit_threshold_pct integer NOT NULL DEFAULT 20,
  critical_credit_threshold_pct integer NOT NULL DEFAULT 5,
  hard_spend_cap_cents integer NOT NULL DEFAULT 0,  -- 0 = disabled
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Notification log (persisted alerts)
CREATE TABLE IF NOT EXISTS alert_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type text NOT NULL,
  severity text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  seen boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alert_configs_project ON alert_configs(project_id);
CREATE INDEX IF NOT EXISTS idx_alert_notifications_project ON alert_notifications(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_notifications_unseen ON alert_notifications(project_id, seen) WHERE seen = false;
