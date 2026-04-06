# Plan: d4118303 — Marketplace-Specific Compliance Validation Rules

## Goal
Build the validation engine + API endpoints + tests for WB/Ozon compliance checking with structured reports (pass/warn/block).

## Current State
- DB: `compliance_rules`, `compliance_validations` tables exist (migration 0006)
- Core: types, schemas, `defaultWbRules()` (partial), `calculateComplianceScore()`, `getMergedComplianceRules()`
- DB layer: `seedComplianceRules()`, `getActiveComplianceRules()`, `createComplianceValidation()` — CRUD only
- API: `/v1/compliance/validate` stores **pre-computed** results — no actual validation logic
- API: `/v1/compliance-rules` returns seeded rules from DB

## What's Missing
1. **Validation engine** — actual logic that checks content against rule definitions
2. **Complete rule sets** — WB rules incomplete, Ozon rules minimal
3. **Dual-marketplace strictest merge** — `getMergedComplianceRules()` needs to handle rule-level merge (not just upload-rules)
4. **Card-count limit enforcement** — WB max 30 cards (default 8), must be validated
5. **API endpoint** — `POST /v1/compliance/validate-step0` that runs actual validation against Step 0 ingestion data
6. **Unit tests** — one per rule category + dual-marketplace strictness

## Implementation Plan

### Part 1: Core Package (`packages/core/src/compliance.ts`)

**1A. Rule registry**
- Expand `defaultWbRules()` with all WB-prohibited content categories:
  - `wb_no_prices_in_image` — detect price markers (₽, руб, numbers with currency)
  - `wb_no_discounts` — detect discount badges (-50%, sale symbols)
  - `wb_no_qr_codes` — detect QR/barcode patterns in text metadata
  - `wb_no_contact_info` — phone, email, links, social handles (CRITICAL)
  - `wb_no_cta_text` — "buy now", "order", discount CTAs
  - `wb_no_evaluative_claims` — "лучший", "#1", "топ", "хит"
  - `wb_no_competitor_refs` — ozon, aliexpress, amazon mentions
  - `wb_no_watermark` — watermark detection (CRITICAL)
  - `wb_no_false_claims` — medical, warranty, unverified claims (WARNING)

- Complete Ozon rules:
  - `ozon_no_contact_info` — same pattern detection
  - `ozon_no_watermark` — CRITICAL
  - `ozon_clear_product_photo` — WARNING
  - `ozon_min_res` — 400px minimum (CRITICAL)
  - `ozon_format_requirements` — accepted formats (CRITICAL)
  - `ozon_card_count_limit` — max cards per product

**1B. Validation engine**
- `ComplianceValidator` class
  - Constructor takes rules array + marketplaces
  - `validate(input)` method — takes compliance input, returns structured report
  - Rule check strategies:
    - `text_match` — check text against keyword list (case-insensitive)
    - `regex_match` — check text against regex patterns
    - `numeric_range` — check numeric values against min/max thresholds
    - `enum_check` — check against allowed values
    - `watermark_detection` — heuristic watermark check (same as analyseImage)
    - `card_count_limit` — WB max 30, warn if > 8 (default)

**1C. Report builder**
- `buildValidationReport(ruleResults, marketplaces)` 
  - Returns structured JSON: `{status: 'passed'|'failed'|'warning', score, criticalFailures, warnings, perRuleResults[], russianMessages[]}`
  - Russian messages for each rule:
    - `wb_no_contact_info` passed: "Контактная информация не обнаружена"
    - `wb_no_contact_info` failed: "Обнаружена контактная информация в изображении"
    - etc.

**1D. Card-count enforcement**
- `validateCardCount(count, marketplaces)` — returns pass/warn/block
  - WB: warn if > 8, block if > 30
  - Ozon: block if > max limit
  - WB+Ozon: strictest applies

### Part 2: API (`apps/api/src/server.ts`)

**2A. New endpoint: `POST /v1/compliance/validate-step0`**
- Input: `{ projectId, cardId?, inputText, metadata? }`
- Loads project marketplaces, active compliance rules
- Runs compliance validator
- Stores compliance_validations record
- Updates project export_blocked if critical failures
- Returns structured report

**2B. New endpoint: `POST /v1/compliance/validate-card`**
- Input: `{ cardId }`
- Loads card metadata + project
- Validates card against applicable rules
- Returns report

**2C. Enhance Step 0 approval gate**
- In `POST /v1/step0/:ingestionId/approve`:
  - Check compliance validation with critical failures
  - Block approval if `isExportBlocked(criticalFailures)` — unless `force=true`

### Part 3: Tests (`packages/core/src/compliance.test.ts`)

- `test: wb_prohibited_content_rules` — each WB rule passes/fails correctly
- `test: ozon_rules` — Ozon-specific rules validated
- `test: dual_marketplace_strictest` — WB+Ozon uses strictest
- `test: card_count_limits` — WB limits enforced
- `test: compliance_scoring` — score calculation correct
- `test: russian_messages` — report messages in Russian
- `test: export_gating` — critical failures block export

## Files to Create
- `packages/core/src/compliance.ts` — engine, rule registry, report builder
- `packages/core/src/compliance.test.ts` — unit tests

## Files to Modify
- `packages/core/src/index.ts` — export new compliance module
- `apps/api/src/server.ts` — add validation endpoints + Step 0 gate
- `packages/db/src/index.ts` — add validation by ingestion endpoint

## Acceptance Checklist
- [ ] Rule definitions exist for all WB-prohibited content categories
- [ ] Dual-marketplace mode correctly applies strictest rules
- [ ] Validation returns structured JSON with pass/warn/block + Russian messages
- [ ] Critical (block) failures prevent Step 0 approval
- [ ] Card-count requests blocked/warned by marketplace limits
- [ ] Unit tests cover each rule category + dual-marketplace strictness
