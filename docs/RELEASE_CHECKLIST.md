# Release Checklist — Workflow Foundation

> CardFlow Board | QA Engineer — d11d923b
> Generated: 2026-04-06

## Pre-Release Gates

### P0 — Must Pass Before Release

- [ ] **All fixture-based tests pass** (`python -m pytest tests/cf_app/ -v --ignore=tests/cf_app/test_ingestion --ignore=tests/cf_app/test_compliance/test_marketplace_rules.py`)
  - Expected: 232 tests, 0 failures
  - Current: not yet run against live code (app not deployed)
- [ ] **No skipped tests in fixture-only suite** — any `pytest.skip()` in fixture tests is a release blocker
- [ ] **Versioning tests implemented** — `tests/cf_app/test_versioning/` must contain test code (currently empty)
- [ ] **Ingestion API tests un-skipped** — upstream dev task `315e67b1` must land
- [ ] **Compliance API tests un-skipped** — upstream dev task `3f40bd18` must land
- [ ] **Workflow API tests un-skipped** — upstream dev task `38274b5f` must land

### P1 — Should Pass Before Release

- [ ] **Combined strictest-rule derivation verified** — combined rules must equal derivable values from individual WB + Ozon rules
- [ ] **Export blocking on critical compliance** — 403 returned with failure count in error message
- [ ] **Export blocking on incomplete approval** — 403/409 returned with stage name in error message
- [ ] **Regeneration targeting isolation** — single-card regen does not affect siblings
- [ ] **Revision immutability** — PATCH/DELETE/PUT on revision endpoints return 405
- [ ] **Rollback creates new revision** — original revision untouched, new revision appended

### P2 — Nice to Have

- [ ] **Concurrency tests pass** — simultaneous card regeneration, regenerate + rollback race
- [ ] **Export idempotency verified** — double-export produces identical package
- [ ] **Approval timeout behavior documented** — what happens to stalled `pending_review` stages
- [ ] **Rate limiting configured** — regeneration and export endpoints have throttle limits

---

## Functional Checklist

### Staged Workflow

- [ ] 7 stages defined and sequential (0–6)
- [ ] Stage 0 (input_analysis) accepts: main_image, additional_images, reference_images, brief
- [ ] Stage 5 (review) outputs: approval, comments, regeneration_requests
- [ ] Stage 6 (export) accepts: approved_final_cards
- [ ] Unapproved predecessor blocks stage transition (409)
- [ ] Batch-final blocked if any upstream stage unapproved (409)

### Inheritance Behavior (Strictest-Rule)

- [ ] WB-only: 900x900 min resolution, 60-char title, WB keywords
- [ ] Ozon-only: 1000x1000 min resolution, 120-char title, Ozon keywords
- [ ] Combined: max resolution (1000), min title (60), union keywords (6 total), union mandatory fields
- [ ] Combined file size: min(WB=10MB, Ozon=20MB) = 10MB
- [ ] Combined background: stricter of white_preferred vs white_required = white_required
- [ ] Regression: 900px passes WB, fails Ozon, fails combined
- [ ] Regression: 1000px passes all modes
- [ ] Regression: WB-specific keyword flagged in WB + combined, not Ozon
- [ ] Regression: Ozon-specific keyword flagged in Ozon + combined, not WB

### Regeneration Targeting

- [ ] Whole-stage regeneration creates new revisions for all 8 cards
- [ ] Single-card regeneration only affects that card; siblings unchanged
- [ ] Element-level regeneration preserves other elements (background, layout)
- [ ] Valid elements: text_overlay, background, badge, icon, position
- [ ] Regenerate unapproved stage → 400 (requires force flag)
- [ ] Regenerate invalid element → 422
- [ ] Regenerate approved card → stage downgraded to partially_approved
- [ ] Regenerate increments revision number (r1 → r2)

### Approval Gating

- [ ] Approve stage → stage_status = "approved"
- [ ] Approve with warning → warning attached, downstream unblocked, export_flag = "warning_pending"
- [ ] Approve single card → card status updated, timestamp recorded
- [ ] Comment with requires_regenerate → stage_status = "needs_revision", downstream blocked
- [ ] Partial approval (not all cards) → stage_status = "partially_approved", export blocked
- [ ] All cards approved → stage_status = "approved", export_allowed = true

### Export Blocking

- [ ] Critical compliance failures → 403 with failure count
- [ ] Unapproved review stage → 403 with stage name
- [ ] Unapproved earlier stage → 409 with blocking stage name
- [ ] Partial card approval → export blocked, reason includes "Not all cards"
- [ ] All conditions met → export succeeds, ZIP package generated
- [ ] Export package contains: cards/, metadata.json
- [ ] Metadata includes: title, description, bullet_points, category, attributes
- [ ] WB export: max 10 files, 10MB, png/jpg only
- [ ] Ozon export: max 15 files, 20MB, png/jpg/webp
- [ ] WebP allowed for Ozon, not for WB

### Compliance Scoring

- [ ] Excellent: 90–100, severity = pass
- [ ] Good: 75–89, severity = pass
- [ ] Acceptable: 60–74, severity = warning
- [ ] Poor: 40–59, severity = warning
- [ ] Critical: 0–39, severity = critical, blocks approval
- [ ] No gaps between thresholds
- [ ] Score 35 → critical, blocks approval
- [ ] Score 65 → acceptable, allows approval with warning

### Validation Report

- [ ] Report has: project_id, uploaded_at, marketplaces, main_image, analysis, marketplace_validation
- [ ] Analysis has: category, attributes, quality_flags, overall_quality_score, can_approve, blocking_reasons, warnings
- [ ] Quality flags have: code, severity (critical|warning|info), message
- [ ] Marketplace validation has both wildberries and ozon sections
- [ ] Each marketplace section has: passes, failures, warnings
- [ ] All blocking cases have error_code
- [ ] All warning cases have warning_code
- [ ] All cases have can_approve field

---

## Non-Functional Checklist

- [ ] **Performance**: fixture tests complete in < 30 seconds
- [ ] **Determinism**: same fixtures produce same test results on every run
- [ ] **Isolation**: tests do not depend on execution order
- [ ] **Coverage**: fixture tests cover all defined scenarios in JSON fixtures
- [ ] **Documentation**: QA_COVERAGE.md and OPERATOR_GUIDE.md exist and are current

---

## Post-Release Verification

- [ ] Run full test suite against live CardFlow app (once deployed)
- [ ] Verify all previously-skipped API tests now pass
- [ ] Implement versioning tests from `versioning_fixtures.json`
- [ ] Add concurrency tests for simultaneous operations
- [ ] Add export idempotency tests
- [ ] Add approval timeout tests

---

## Sign-Off

| Role | Name | Date | Status |
|------|------|------|--------|
| QA Engineer | d11d923b | 2026-04-06 | ⏸️ Pending dev tasks |
| Lead | — | — | — |
