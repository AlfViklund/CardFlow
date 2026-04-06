-- Compliance engine: marketplace rules, validation results, compliance scores

CREATE TABLE IF NOT EXISTS compliance_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marketplace text NOT NULL,           -- wildberries | ozon
  category text NOT NULL,              -- prohibited_content | visibility_quality | format_resolution
  rule_code text NOT NULL UNIQUE,
  description text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',  -- critical | warning | info
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,  -- thresholds, patterns, regex etc
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance_validations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  card_id uuid REFERENCES cards(id) ON DELETE SET NULL,
  step_id uuid REFERENCES steps(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',  -- pending | passed | failed | warning
  compliance_score numeric(5,2) NOT NULL DEFAULT 100.00,  -- 0-100
  critical_failures integer NOT NULL DEFAULT 0,
  warnings integer NOT NULL DEFAULT 0,
  rule_results jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{rule_code, passed, severity, detail}]
  report text,                        -- human-readable compliance report
  validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Export block flag
ALTER TABLE projects ADD COLUMN IF NOT EXISTS export_blocked boolean NOT NULL DEFAULT false;
-- Last compliance score
ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_compliance_score numeric(5,2);

CREATE INDEX IF NOT EXISTS idx_compliance_rules_marketplace ON compliance_rules(marketplace);
CREATE INDEX IF NOT EXISTS idx_compliance_rules_active ON compliance_rules(marketplace) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_compliance_validations_project ON compliance_validations(project_id);
CREATE INDEX IF NOT EXISTS idx_compliance_validations_card ON compliance_validations(card_id);
