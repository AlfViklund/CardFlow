# Compliance Runbook and Rollout Controls

Task: `72346f88-cb92-4bca-be64-105d2adc6b3c`
Last updated: 2026-04-06

## Purpose

This runbook explains how CardFlow enforces marketplace compliance, how rule precedence works, how review gates affect export, and how operators should manage rule changes safely in production.

---

## 1. Compliance Policy

### 1.1 Scope

CardFlow enforces compliance rules for **Wildberries** and **Ozon** simultaneously. When a project targets both marketplaces, the system applies the **union of all critical-severity rules** from both rule sets.

### 1.2 Core Policy

| Principle | Rule |
|---|---|
| Multi-marketplace | All active marketplace rules apply together |
| Critical blocks export | `criticalFailures > 0` → export is blocked (HTTP 403) |
| Score is informative | Compliance score does **not** gate export — only critical failures do |
| No approved artifact is overwritten | Regenerations and edits create new validation records |

### 1.3 Compliance Score

Score starts at **100** and is reduced by each failed rule check:

| Severity | Deduction |
|---|---|
| `critical` | −30 |
| `warning` | −10 |
| `info` | −3 |

Score is clamped to `[0, 100]`. The score is a health indicator for operators — it does not determine whether export is allowed.

### 1.4 Compliance Categories

| Category | Code | What it covers |
|---|---|---|
| Prohibited content | `prohibited_content` | Contact info, competitor references, false claims, watermarks |
| Visibility & quality | `visibility_quality` | White background, product focus, clutter, clear product visibility |
| Format & resolution | `format_resolution` | Minimum resolution, accepted formats, aspect ratio |

---

## 2. Rule Precedence

### 2.1 Precedence Order

Rules are evaluated in this order:

1. **Severity** — `critical` rules are evaluated first, then `warning`, then `info`
2. **Marketplace-specific** — Rules prefixed with the marketplace code (`wb_`, `ozon_`) apply to that marketplace's content
3. **Category** — Within the same severity, `prohibited_content` rules run before `visibility_quality`, which runs before `format_resolution`
4. **Rule code** — Alphabetical order as a tiebreaker for deterministic output

### 2.2 Combined Marketplace Precedence

When both Wildberries and Ozon are active:

- **Strictest dimension wins**: min dimension = max(WB, Ozon) = 900px
- **Most restrictive size wins**: max file size = min(WB, Ozon) = 10 MB
- **Format intersection**: only formats accepted by **both** marketplaces pass (JPEG, PNG, WebP — HEIC is excluded)
- **Union of critical rules**: a rule that is `critical` in either marketplace is treated as `critical` for the combined validation

### 2.3 Conflict Resolution

If two rules conflict (e.g., different minimum resolutions for the same marketplace):

- The **most restrictive** rule wins (higher minimum, smaller maximum)
- The rule with the **higher severity** takes precedence
- If severity is equal, the rule with the **lower version number** (older, more established) takes precedence

### 2.4 Rule Code Taxonomy

Rule codes follow the pattern: `<marketplace>.<category>.<specific_rule>`

Examples:
- `wb.prohibited_content.no_contact_info`
- `ozon.format_resolution.min_resolution`
- `wb.visibility_quality.white_background`

The short-form codes used in the `compliance_rules` table (e.g., `wb_no_contact_info`) are aliases that map to the full taxonomy.

---

## 3. Default Rules

### 3.1 Prohibited Content

| Code | Description | Severity | Marketplace |
|---|---|---|---|
| `wb_no_contact_info` | No phone numbers, emails, or external links | critical | Wildberries |
| `wb_no_competitor_refs` | No references to other marketplaces or brands | critical | Wildberries |
| `wb_false_claims` | No unverified claims (medical, warranty, "best", "#1") | warning | Wildberries |
| `ozon_no_contact_info` | No phone numbers, emails, or external links | critical | Ozon |

### 3.2 Visibility & Quality

| Code | Description | Severity | Marketplace |
|---|---|---|---|
| `wb_white_background_main` | Main product photo should be on white background | warning | Wildberries |
| `wb_product_focus` | Product must be the clear focal point | warning | Wildberries |
| `wb_no_clutter` | Minimal distracting elements in frame | info | Wildberries |
| `ozon_clear_product_photo` | Product must be clearly visible | warning | Ozon |

### 3.3 Format & Resolution

| Code | Description | Severity | Marketplace |
|---|---|---|---|
| `wb_min_900px` | Minimum 900×900px for main image | critical | Wildberries |
| `wb_format_jpeg_png_webp` | Accepted formats: JPEG, PNG, WebP | critical | Wildberries |
| `wb_no_watermark` | No watermarks or logos on images | critical | Wildberries |
| `wb_aspect_ratio` | Aspect ratio should be 3:4 or 1:1 | warning | Wildberries |
| `ozon_min_res` | Minimum resolution limits apply (400px) | critical | Ozon |
| `ozon_no_watermark` | No watermarks permitted | critical | Ozon |

---

## 4. Compliance Validation Result

Each validation run produces a record with these fields:

| Field | Type | Description |
|---|---|---|
| `projectId` | UUID | Owning project |
| `cardId` | UUID | Card being validated (nullable for project-level checks) |
| `stepId` | UUID | Workflow step that triggered the validation |
| `status` | enum | `passed`, `failed`, or `warning` |
| `complianceScore` | int | 0–100 score |
| `criticalFailures` | int | Count of failed critical rules |
| `warnings` | int | Count of failed warning rules |
| `ruleResults` | array | Per-rule results: `{ruleCode, passed, severity, detail}` |
| `report` | string | Human-readable summary |
| `validatedAt` | timestamp | When the validation ran |
| `ruleVersion` | string | Version snapshot of the rules at validation time |

---

## 5. Review Workflow Behavior

### 5.1 Approval Gates

The CardFlow workflow has three stages that require explicit approval before export:

| Stage | What it gates | Status transitions |
|---|---|---|
| `concept` | Design concept approval | `pending` → `approved` or `rejected` |
| `final` | Final card series approval | `pending` → `approved` or `rejected` |
| `export` | Final export readiness check | `pending` → `approved` or `blocked` |

### 5.2 Stage Ordering

Stages execute strictly sequentially:

```
copy → scenes → design-concept → final → export
```

A downstream stage **cannot start** until the upstream stage is `completed`. Approval gates sit between stages.

### 5.3 Regeneration Effects on Approval

When a user regenerates content at an approved stage:

| Scope | Effect on approval status |
|---|---|
| Full stage regeneration | Stage status → `pending` (requires re-approval) |
| Single card regeneration | Card status → `pending`; stage → `partially_approved` |
| Single element regeneration | Element status → `pending`; card → `partially_approved` |

**Rule:** After regenerating an approved stage, the stage status downgrades to `partially_approved`. Export remains blocked until all stages are fully approved again.

### 5.4 Force Approval

Operators can override a blocked approval gate with `force: true`. This:
- Creates a `force_approval` audit record
- Logs the operator ID, timestamp, and reason
- Does **not** clear the underlying compliance failures — only the approval gate

Force approval should be used sparingly and only when the blocking rule is known to be a false positive.

---

## 6. Export-Blocking Conditions

Export is blocked when **any** of the following conditions are true:

### 6.1 Compliance Block (HTTP 403)

| Condition | Detail |
|---|---|
| `criticalFailures > 0` | One or more critical compliance rules failed |
| `export_blocked = true` on project | Project-level flag set by a prior critical failure |

### 6.2 Approval Block (HTTP 403)

| Condition | Detail |
|---|---|
| Unapproved review stage | `concept`, `final`, or `export` stage is `pending` or `rejected` |
| `partially_approved` stage | Regeneration occurred after approval; re-approval needed |

### 6.3 Workflow Block (HTTP 409)

| Condition | Detail |
|---|---|
| Incomplete workflow steps | Not all steps are `completed` or `skipped` |
| Missing required output | A stage produced no output (e.g., generation failed) |

### 6.4 Block Response Format

```json
{
  "status": 403,
  "blocked": true,
  "reasons": [
    {
      "cardId": "uuid",
      "reason": "critical_compliance_failure",
      "ruleCode": "wb_no_watermark",
      "detail": "Watermark detected on main image"
    }
  ],
  "complianceScore": 70,
  "criticalFailures": 1
}
```

### 6.5 Unblocking Export

To unblock export:

1. **Fix the content** — edit the card/image to resolve the compliance failure
2. **Re-validate** — run compliance validation again
3. **Re-approve** — if an approval gate was affected, approve the stage
4. **Verify** — confirm `export_blocked = false` on the project

If the blocking rule itself is incorrect:
1. Deactivate the rule (`is_active = false`)
2. Re-validate
3. Re-approve if needed
4. File a rule correction ticket

---

## 7. Operator Procedures

### 7.1 Updating Rules

#### Adding a New Rule

1. Add the rule to the seed function or insert directly into `compliance_rules`:
   ```sql
   INSERT INTO compliance_rules (rule_code, description, severity, marketplace, category, is_active, metadata)
   VALUES ('wb_new_rule', 'Description of the rule', 'warning', 'wildberries', 'prohibited_content', true, '{}')
   ON CONFLICT (rule_code) DO UPDATE SET
     description = EXCLUDED.description,
     severity = EXCLUDED.severity,
     metadata = EXCLUDED.metadata;
   ```
2. Deploy the seed migration or run the upsert
3. Re-run validation on a sample of existing projects to assess impact
4. Monitor `compliance_validations` for the next 24 hours for unexpected failures
5. Update this document with the new rule in §3

#### Modifying an Existing Rule

1. Determine the change classification (see §8.3):
   - **PATCH** — description text only, no behavioral change
   - **MINOR** — severity change within the same category, or metadata update
   - **MAJOR** — new critical rule, rule removal, or cross-category change
2. For PATCH/MINOR: update the rule and monitor
3. For MAJOR: get lead approval before deploying
4. Re-validate affected projects
5. Update the rule table in §3

#### Deactivating a Rule

1. Set `is_active = false` in `compliance_rules`
2. Re-validate projects that were blocked by this rule
3. Confirm `export_blocked` flags clear as expected
4. Document the deactivation reason and date

### 7.2 Interpreting Validation Reports

A validation report contains:

```
Project: <name>
Card: <id>
Status: FAILED
Compliance Score: 64/100
Critical Failures: 1
Warnings: 2

Rule Results:
  [FAIL] wb_no_watermark (critical) — Watermark detected on main image
  [FAIL] wb_white_background_main (warning) — Background is not white (detected: gray)
  [FAIL] wb_aspect_ratio (warning) — Current ratio 16:9, expected 3:4 or 1:1
  [PASS] wb_min_900px (critical) — 1200×1200px
  [PASS] wb_format_jpeg_png_webp (critical) — image/jpeg
  ...
```

**How to read it:**

1. Check `Status` first — `passed`, `failed`, or `warning`
2. Look at `Critical Failures` — any number > 0 means export is blocked
3. Read each `[FAIL]` line for the specific rule and detail
4. The `Compliance Score` tells you the overall health but does not determine blocking
5. `[PASS]` lines confirm which rules are satisfied

**Common patterns:**

| Pattern | Likely cause | Action |
|---|---|---|
| All format rules fail | Wrong image format uploaded | Re-upload in JPEG/PNG/WebP |
| Resolution rules fail | Image too small | Re-upload at higher resolution |
| Watermark rule fails | Logo or text overlay on image | Remove watermark and re-upload |
| Multiple rules fail on one card | Source image has multiple issues | Fix the source image, then re-validate |

### 7.3 Monitoring Failures in Production

#### Key Metrics to Watch

| Metric | Source | Alert threshold |
|---|---|---|---|
| `criticalFailures` per hour | `compliance_validations` | > 10 in 1 hour |
| `export_blocked` projects | `projects` table | > 5% of active projects |
| Validation latency | Validation endpoint | p95 > 5 seconds |
| Stale validations | `compliance_validations.validatedAt` | > 24 hours old for active projects |
| Score distribution | `compliance_validations.complianceScore` | Sudden shift in mean or variance |

#### Monitoring Queries

```sql
-- Projects blocked in the last hour
SELECT COUNT(*) FROM projects
WHERE export_blocked = true
AND updated_at > NOW() - INTERVAL '1 hour';

-- Top failing rules in the last 24 hours
SELECT rule_code, COUNT(*) as failure_count
FROM compliance_validations cv,
     jsonb_array_elements(cv.rule_results) as rule
WHERE rule->>'passed' = 'false'
AND cv.validated_at > NOW() - INTERVAL '24 hours'
GROUP BY rule_code
ORDER BY failure_count DESC
LIMIT 10;

-- Score distribution shift
SELECT
  AVG(compliance_score) as mean_score,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY compliance_score) as median_score,
  COUNT(*) as validation_count
FROM compliance_validations
WHERE validated_at > NOW() - INTERVAL '1 hour';
```

#### Failure Response Playbook

| Symptom | First action | Escalation |
|---|---|---|
| Spike in critical failures | Check if a new rule was deployed recently | If yes, consider deactivating the rule; if no, investigate source images |
| Many projects blocked | Check for a common failing rule | If one rule causes > 50% of blocks, evaluate rule correctness |
| Validation timeouts | Check database connection pool and queue depth | Scale workers or increase timeout if infrastructure-related |
| Score distribution shift | Compare rule changes in the last 24 hours | If no rule changes, check for upstream data quality issues |

---

## 8. Rollout Notes

### 8.1 Configuration

#### Environment Variables

| Variable | Purpose | Default | Notes |
|---|---|---|---|
| `COMPLIANCE_RULES_TABLE` | Table name for rules | `compliance_rules` | Do not change in production without migration |
| `COMPLIANCE_VALIDATIONS_TABLE` | Table name for validation records | `compliance_validations` | Same as above |
| `MAX_COMPLIANCE_RULES` | Maximum number of active rules | `100` | Safety limit to prevent runaway rule sets |
| `COMPLIANCE_VALIDATION_TIMEOUT_MS` | Max time for a validation run | `30000` | Increase if validation includes slow AI checks |

#### Configuration Files

- Rule seeds are defined in the seed function `seedComplianceRules()`
- Rule metadata (version, changelog) should be tracked alongside the seed function in version control

### 8.2 Alerting

#### Alert Destinations

| Alert | Channel | Severity |
|---|---|---|
| Critical failure spike (> 10/hour) | Ops channel | P1 |
| Export-blocked projects > 5% | Ops channel | P2 |
| Validation timeout | Dev channel | P2 |
| Rule deployment without approval | Security channel | P1 |
| Stale validations (> 24h) | Ops channel | P3 |

#### Alert Setup

1. Configure monitoring queries (see §7.3) as scheduled checks
2. Route alerts to the appropriate channel based on severity
3. Set up dashboards for:
   - Compliance score over time (per project and aggregate)
   - Critical failure count by rule code
   - Export-blocked project count
   - Validation latency (p50, p95, p99)

### 8.3 Safe Rule-Version Changes

#### Change Classification

| Classification | Examples | Approval needed | Rollback |
|---|---|---|---|
| **PATCH** | Description text fix, typo correction | None | Revert seed |
| **MINOR** | Severity change within same category, metadata update, new `info` rule | Peer review | Deactivate rule |
| **MAJOR** | New `critical` rule, rule removal, cross-category change, combined marketplace rule change | Lead approval | Deactivate rule + re-validate all affected projects |

#### Safe Deployment Checklist

Before deploying a rule change:

- [ ] Change is classified (PATCH / MINOR / MAJOR)
- [ ] Approval obtained (if MAJOR)
- [ ] Seed function updated with new rule version
- [ ] Test run on a staging project with representative data
- [ ] Impact assessment: how many existing projects will be affected?
- [ ] Rollback plan documented
- [ ] Monitoring alerts confirmed active
- [ ] This document updated with the new rule

#### Deployment Steps

1. **Deploy to staging** — run the seed function in a non-production environment
2. **Validate** — run compliance checks on a sample of projects
3. **Compare** — check that the delta in failures matches expectations
4. **Deploy to production** — run the seed function in production
5. **Monitor** — watch the metrics in §7.3 for 24 hours
6. **Confirm** — verify no unexpected blocks or score shifts

#### Rollback Steps

1. Identify the problematic rule by `rule_code`
2. Set `is_active = false` (immediate effect on next validation)
3. Re-validate affected projects
4. Confirm `export_blocked` flags clear
5. Investigate root cause
6. Deploy a corrected rule version when ready

---

## 9. Project Export Block

The `projects` table tracks project-level compliance state:

| Column | Type | Description |
|---|---|---|
| `export_blocked` | boolean | `true` when a compliance validation has critical failures |
| `last_compliance_score` | int | Most recent compliance score for the project |

To unblock: either fix the underlying content or deactivate the blocking rule and re-validate.

---

## 10. Validation Report Format

Each marketplace gets its own validation section in reports:

- Per-marketplace rule results
- Failure details with error codes and minimum dimensions
- Consistency between single-mode and combined-mode results

### 10.1 Report Structure

```
=== Compliance Validation Report ===
Project: <project_name>
Validated At: <timestamp>
Rule Version: <version>

--- Wildberries ---
Status: PASSED / FAILED / WARNING
Score: <score>/100
Critical Failures: <count>
Warnings: <count>

Rules:
  [PASS/FAIL] <rule_code> (<severity>) — <detail>
  ...

--- Ozon ---
Status: PASSED / FAILED / WARNING
Score: <score>/100
Critical Failures: <count>
Warnings: <count>

Rules:
  [PASS/FAIL] <rule_code> (<severity>) — <detail>
  ...

--- Combined (Both Marketplaces) ---
Status: PASSED / FAILED / WARNING
Score: <score>/100
Critical Failures: <count>
Warnings: <count>

Blocking Rules:
  <rule_code> — <detail>

Unblocking Steps:
  1. <step>
  2. <step>
```

### 10.2 Consistency Checks

When running combined-mode validation:
- Each marketplace's individual results should be a subset of the combined results
- A rule that passes in single-mode should also pass in combined-mode (unless the combined mode applies a stricter variant)
- The combined critical failure count should equal the union of both marketplaces' critical failures
