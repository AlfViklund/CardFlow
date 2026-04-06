# QA Coverage — Workflow Foundation

> CardFlow Board | QA Engineer — d11d923b
> Generated: 2026-04-06

## 1. Scope

This document covers QA test coverage for the CardFlow workflow foundation: staged workflow execution, inheritance behavior (WB/Ozon strictest-rule), regeneration targeting, approval gating, and export blocking rules.

All tests are fixture-based (pytest) and run without a live CardFlow app. API-level tests are scaffolded with `skip()` until upstream dev tasks land.

---

## 2. Coverage Matrix

### 2.1 Staged Workflow (7 stages)

| Area | File | Tests | Status |
|------|------|-------|--------|
| Stage definitions (7 stages, sequential) | `test_scenario_e2e.py::TestPipelineStageValidation` | 11 | ✅ fixture-validated |
| Stage 0: input_analysis | `test_scenario_e2e.py` | 1 | ✅ |
| Stage 5: review (approval, comments, regen) | `test_scenario_e2e.py`, `test_review_actions.py` | 4 | ✅ |
| Stage 6: export (approved cards → package) | `test_scenario_e2e.py` | 1 | ✅ |
| Stage transitions (unapproved predecessor blocks) | `test_export_blocking.py::TestExportBlockedByApprovalState` | 2 | ✅ fixture |
| Stage transition error (409) | `workflow_fixtures.json::error_flow_scenarios` | 1 | ✅ fixture |
| Batch-final partial approval block | `workflow_fixtures.json::error_flow_scenarios` | 1 | ✅ fixture |

**Gaps:**
- No tests for stages 1–4 (copy_planning, scene_planning, design_concepts, final_generation) as standalone units — they are only validated indirectly through E2E scenarios.
- No concurrency tests for multi-user stage transitions.
- No timeout/deadline tests for stalled stages.

### 2.2 Inheritance Behavior (WB / Ozon / Combined)

| Area | File | Tests | Status |
|------|------|-------|--------|
| WB-only rules (resolution 900, title 60, keywords) | `test_rule_precedence.py::TestWBOnlyRulePrecedenceFixtures` | 8 | ✅ fixture |
| Ozon-only rules (resolution 1000, title 120, keywords) | `test_rule_precedence.py::TestOzonOnlyRulePrecedenceFixtures` | 9 | ✅ fixture |
| Combined strictest (max resolution, min title, union keywords) | `test_rule_precedence.py::TestCombinedStrictestRulePrecedence` | 9 | ✅ fixture |
| Combined derivable from individual rules | `test_rule_precedence.py::TestRulePrecedenceCrossValidation` | 7 | ✅ fixture |
| Regression scenarios (7 cross-mode cases) | `test_rule_precedence.py::TestRulePrecedenceRegressionScenarios` | 7 | ✅ fixture |
| Cross-mode comparison (12 assertions) | `test_scenario_e2e.py::TestCrossModeComparison` | 12 | ✅ fixture |
| API-level rule precedence (skipped) | `test_marketplace_rules.py` | 21 | ⏸️ skipped (dev not landed) |

**Derivation rules verified:**
- Resolution: `max(WB, Ozon)` ✅
- File size: `min(WB, Ozon)` ✅
- Title length: `min(WB, Ozon)` ✅
- Additional images: `min(WB, Ozon)` ✅
- Prohibited keywords: `union(WB, Ozon)` ✅
- Mandatory fields: `union(WB, Ozon)` ✅
- Background: stricter of `white_preferred` vs `white_required` → `white_required` ✅

**Gaps:**
- No tests for adding a third marketplace in the future.
- No tests for dynamic rule updates at runtime.

### 2.3 Regeneration Targeting

| Area | File | Tests | Status |
|------|------|-------|--------|
| Whole-stage regeneration (8 new cards) | `test_review_actions.py::TestRegenerateAction` | 1 | ✅ fixture |
| Single-card regeneration (siblings unchanged) | `test_review_actions.py::TestRegenerateAction` | 1 | ✅ fixture |
| Element-level regeneration (preserves others) | `test_review_actions.py::TestRegenerateAction` | 3 | ✅ fixture |
| Regenerate unapproved stage → 400 | `test_export_blocking.py`, `workflow_fixtures.json` | 1 | ✅ fixture |
| Regenerate invalid element → 422 | `test_export_blocking.py`, `workflow_fixtures.json` | 1 | ✅ fixture |
| Valid elements list (text_overlay, background, badge, icon, position) | `test_review_actions.py` | 1 | ✅ fixture |
| Regenerate approved card → stage downgrade to partially_approved | `test_review_actions.py::TestApproveAfterRegenerateFlow` | 2 | ✅ fixture |
| Revision increment on regenerate (r1 → r2) | `test_review_actions.py::TestApproveAfterRegenerateFlow` | 1 | ✅ fixture |
| Comment → regenerate flow | `test_review_actions.py::TestCommentThenRegenerateFlow` | 3 | ✅ fixture |

**Gaps:**
- No tests for concurrent regeneration of the same card.
- No tests for regeneration rate limits or throttling.
- No tests for regeneration after multiple rollback cycles.

### 2.4 Approval Gating

| Area | File | Tests | Status |
|------|------|-------|--------|
| Approve stage → status approved | `test_review_actions.py::TestApproveAction` | 3 | ✅ fixture |
| Approve with warning → warning attached, downstream unblocked | `test_review_actions.py::TestApproveAction` | 3 | ✅ fixture |
| Approve single card → card status updated, timestamp recorded | `test_review_actions.py::TestApproveAction` | 2 | ✅ fixture |
| Comment → needs_revision, downstream blocked | `test_review_actions.py::TestCommentAction` | 5 | ✅ fixture |
| Partial approval (5 approved, 2 pending, 1 draft) | `workflow_fixtures.json::partial_approval_scenarios` | 3 | ✅ fixture |
| All cards approved → export ready | `workflow_fixtures.json::partial_approval_scenarios` | 3 | ✅ fixture |
| Prior state validation (pending_review before approve) | `test_review_actions.py::TestApproveAction` | 1 | ✅ fixture |

**Gaps:**
- No tests for approval timeout / auto-expiry.
- No tests for approval revocation after the fact.
- No tests for multi-approver workflows.

### 2.5 Export Blocking Rules

| Area | File | Tests | Status |
|------|------|-------|--------|
| Export blocked: critical compliance (403) | `test_export_blocking.py::TestExportBlockedByCriticalCompliance` | 7 | ✅ fixture |
| Export blocked: unapproved review stage (403) | `test_export_blocking.py::TestExportBlockedByApprovalState` | 2 | ✅ fixture |
| Export blocked: unapproved earlier stage (409) | `test_export_blocking.py::TestExportBlockedByApprovalState` | 1 | ✅ fixture |
| Export blocked: partial card approval | `test_export_blocking.py::TestExportBlockedByApprovalState` | 3 | ✅ fixture |
| Export allowed: all cards approved | `test_export_blocking.py::TestExportAllowedWhenAllConditionsMet` | 5 | ✅ fixture |
| Export package format (ZIP), contents, metadata | `test_export_blocking.py::TestExportPackageContents` | 8 | ✅ fixture |
| WB export limits (10 files, 10MB, png/jpg) | `test_export_blocking.py::TestExportPackageContents` | 1 | ✅ fixture |
| Ozon export limits (15 files, 20MB, png/jpg/webp) | `test_export_blocking.py::TestExportPackageContents` | 2 | ✅ fixture |
| WebP: Ozon allows, WB does not | `test_export_blocking.py::TestExportPackageContents` | 1 | ✅ fixture |
| Export regression: score thresholds | `test_export_blocking.py::TestExportBlockingRegressionScenarios` | 4 | ✅ fixture |
| Export package card resolution (3000x3000) | `test_export_blocking.py::TestExportBlockingRegressionScenarios` | 1 | ✅ fixture |

**Gaps:**
- No tests for export idempotency (double-export).
- No tests for export cancellation mid-flight.
- No tests for export package integrity (checksums).

### 2.6 Compliance Scoring

| Area | File | Tests | Status |
|------|------|-------|--------|
| Quality thresholds (excellent/good/acceptable/poor/critical) | `test_compliance_scoring.py::TestQualityScoreThresholds` | 3 | ✅ fixture |
| Threshold gap coverage (0–100, no gaps) | `test_compliance_scoring.py::TestQualityScoreThresholds` | 2 | ✅ fixture |
| Score computation across modes | `test_compliance_scoring.py::TestComplianceScoreComputation` | 5 | ✅ fixture |
| Score → approval mapping (parametrised, 11 cases) | `test_compliance_scoring.py::TestScoreImpactOnApproval` | 14 | ✅ fixture |
| Blocking vs warning cases (10 scenarios) | `test_compliance_scoring.py::TestBlockingVsWarningCases` | 10 | ✅ fixture |
| Score consistency across modes | `test_compliance_scoring.py::TestScoreConsistencyAcrossMarketplaceModes` | 3 | ✅ fixture |

### 2.7 Validation Report

| Area | File | Tests | Status |
|------|------|-------|--------|
| Report structure (required fields) | `test_validation_report.py::TestValidationReportStructure` | 13 | ✅ fixture |
| Per-marketplace sections (WB + Ozon) | `test_validation_report.py::TestPerMarketplaceValidationReport` | 8 | ✅ fixture |
| Failure details (error codes, min dimensions) | `test_validation_report.py::TestValidationReportFailureDetails` | 8 | ✅ fixture |
| Report consistency across modes | `test_validation_report.py::TestValidationReportConsistency` | 7 | ✅ fixture |

### 2.8 Ingestion & Gating

| Area | File | Tests | Status |
|------|------|-------|--------|
| Valid upload scenarios (6 types) | `test_ingestion.py::TestValidUploadScenarios` | 6 | ⏸️ skipped (dev) |
| Invalid input scenarios (13 types) | `test_ingestion.py::TestInvalidInputScenarios` | 13 | ⏸️ skipped (dev) |
| Blocking vs warning classification | `test_ingestion.py::TestBlockingVsWarningCases` | 6 | ⏸️ skipped (dev) |
| Analysis result schema | `test_ingestion.py::TestAnalysisResultSchema` | 4 | ✅ fixture |
| Marketplace rules at ingestion | `test_ingestion.py::TestMarketplaceRulesAtIngestion` | 3 | ✅ fixture |

### 2.9 Versioning & Audit (scaffolded, no tests yet)

| Area | File | Tests | Status |
|------|------|-------|--------|
| Revision schema | `versioning_fixtures.json` | — | ✅ fixture defined, no tests |
| Revision actions (9 types) | `versioning_fixtures.json` | — | ✅ fixture defined, no tests |
| Branching scenarios (linear, batch, mixed) | `versioning_fixtures.json` | — | ✅ fixture defined, no tests |
| Immutability checks (PATCH/DELETE/PUT blocked, hash stability) | `versioning_fixtures.json` | — | ✅ fixture defined, no tests |
| Rollback scenarios | `versioning_fixtures.json` | — | ✅ fixture defined, no tests |
| Audit entry schema | `versioning_fixtures.json` | — | ✅ fixture defined, no tests |
| Concurrency scenarios | `versioning_fixtures.json` | — | ✅ fixture defined, no tests |
| Provenance integrity | `versioning_fixtures.json` | — | ✅ fixture defined, no tests |
| Edge cases (empty list, deleted project, pagination, cross-project) | `versioning_fixtures.json` | — | ✅ fixture defined, no tests |

**Gaps:**
- `test_versioning/` directory exists but contains only `__init__.py` — no test implementations.
- All versioning tests need to be written once the versioning API lands.

---

## 3. Test Counts

| Category | Fixture Tests (runnable now) | API Tests (skipped) | Total |
|----------|------------------------------|---------------------|-------|
| Staged workflow E2E | 51 | 0 | 51 |
| Review actions | 44 | 0 | 44 |
| Rule precedence | 33 | 21 | 54 |
| Export blocking | 26 | 0 | 26 |
| Compliance scoring | 35 | 0 | 35 |
| Validation report | 36 | 0 | 36 |
| Ingestion & gating | 7 | 29 | 36 |
| Marketplace rules (API) | 0 | 21 | 21 |
| Versioning & audit | 0 | 0 | 0 (fixtures only) |
| **Total** | **232** | **71** | **303** |

---

## 4. Known Gaps & Follow-Up Risks

### High Risk
1. **Versioning tests not written** — `test_versioning/` is empty. Fixtures are comprehensive but no test code exists. Must write tests for immutability, rollback, audit, and concurrency before release.
2. **All API-level tests skipped** — 71 tests depend on upstream dev tasks. No live integration testing until endpoints exist.

### Medium Risk
3. **No concurrency tests** — simultaneous stage transitions, concurrent card regeneration, and race conditions are not tested.
4. **No export idempotency tests** — double-export behavior is unverified.
5. **No approval timeout tests** — what happens if a stage sits in `pending_review` indefinitely?
6. **No rate limiting tests** — regeneration, approval, and export endpoints have no throttle tests.

### Low Risk
7. **Third marketplace not tested** — strictest-rule logic assumes 2 marketplaces. Adding a third needs verification.
8. **No dynamic rule update tests** — if marketplace rules change at runtime, behavior is untested.

---

## 5. Operational Assumptions

1. **CardFlow app not deployed** — all tests run against fixture data. `pytest.skip()` gates API-level tests.
2. **Endpoint paths are placeholders** in `conftest.py` — one-place update when dev lands.
3. **8-card default** — all fixtures assume 8 cards per project (scenes 1–8).
4. **Quality score range 0–100** — thresholds are contiguous with no gaps.
5. **Single approver** — no multi-approver workflow is modeled.
6. **No soft deletes** — deleted projects return 404/410, not a soft-deleted state.
7. **Atomic batch regeneration** — stage regeneration of 8 cards is all-or-nothing.
8. **Revision numbering is sequential** — no gaps, no reuse.
