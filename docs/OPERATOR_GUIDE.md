# Operator Guide — CardFlow Workflow Foundation

> CardFlow Board | QA Engineer — d11d923b
> Generated: 2026-04-06

## 1. What This System Does

CardFlow is a web SaaS for Ozon/Wildberries sellers that automates product card creation. The workflow foundation manages a 7-stage pipeline from image upload through marketplace export, with compliance gating, approval controls, and regeneration capabilities.

## 2. Pipeline Overview

```
Stage 0: input_analysis     — Upload & analyze images, brief, marketplace selection
Stage 1: copy_planning      — Generate titles, descriptions, bullet points
Stage 2: scene_planning     — Define 8 card scenes (hero, feature, usage, detail, etc.)
Stage 3: design_concepts    — Generate design variants, color palettes, typography
Stage 4: final_generation   — Produce 8 final cards with approved design + copy
Stage 5: review             — Human review: approve, comment, or request regeneration
Stage 6: export             — Package cards + metadata for marketplace upload
```

**Key rule:** Each stage must be approved before the next stage can begin. Unapproved predecessors block transitions with a 409 error.

## 3. Marketplace Rule Inheritance

When a project targets multiple marketplaces, the system applies the **strictest** rule from each:

| Rule | WB-only | Ozon-only | Combined (WB+Ozon) |
|------|---------|-----------|---------------------|
| Min resolution | 900×900 | 1000×1000 | **1000×1000** (max) |
| Max file size | 10 MB | 20 MB | **10 MB** (min) |
| Max title length | 60 chars | 120 chars | **60 chars** (min) |
| Max additional images | 10 | 15 | **10** (min) |
| Prohibited keywords | 5 WB-specific | 2 Ozon-specific | **6** (union) |
| Mandatory fields | brand, category, name | brand | **brand, category, name** (union) |
| Background | white_preferred | white_required | **white_required** (stricter) |

**What this means for operators:**
- A project targeting both WB and Ozon has stricter requirements than either alone.
- If an image passes Ozon but fails WB title length, the combined project will fail.
- Keywords prohibited by *either* marketplace are blocked in combined mode.

## 4. Approval Workflow

### Stage Approval
- **Approve**: marks stage as approved, unblocks downstream stages. Warnings can be attached but do not block.
- **Comment with requires_regenerate**: marks stage as `needs_revision`, blocks downstream, triggers regeneration requirement.
- **Partial approval**: if some cards are approved and others are pending/draft, stage status is `partially_approved`. Export is blocked until all cards are approved.

### Card-Level Actions
- **Approve card**: marks individual card as approved with timestamp.
- **Regenerate card**: creates a new revision for that card only. Siblings are unchanged. If the card was previously approved, the stage is downgraded to `partially_approved`.
- **Regenerate element**: regenerates only a specific element (text_overlay, background, badge, icon, position) within a card. Other elements are preserved.

### Regeneration Targets
| Target | Scope | Effect |
|--------|-------|--------|
| Whole stage | All 8 cards | Creates new revision for every card |
| Single card | One card (by card_id) | Only that card gets a new revision |
| Element | One element within a card | Only that element is regenerated |

**Important:** Regenerating an approved card downgrades the stage to `partially_approved`. All cards must be re-approved before export.

## 5. Export Blocking Rules

Export is blocked if **any** of these conditions are true:

1. **Critical compliance failures** — compliance score ≤ 39, or prohibited keywords detected, or mandatory fields missing. Returns 403 with failure count.
2. **Review stage not approved** — stage 5 is still `pending_review` or `needs_revision`. Returns 403 with stage name.
3. **Earlier stage not approved** — any stage 0–4 is not approved. Returns 409 with blocking stage name.
4. **Not all cards approved** — any card in stage 4 is `pending_review` or `draft`. Export blocked with reason "Not all cards in stage 4 are approved".

### Export Package
- Format: ZIP file
- Contents: `cards/card_1.png` through `cards/card_8.png`, `metadata.json`
- Card resolution: 3000×3000
- Metadata fields: title, description, bullet_points, category, attributes

### Marketplace-Specific Export Limits
| Marketplace | Max files | Max size | Formats |
|-------------|-----------|----------|---------|
| Wildberries | 10 | 10 MB | PNG, JPG |
| Ozon | 15 | 20 MB | PNG, JPG, WebP |

**Note:** WebP is allowed for Ozon but not for Wildberries.

## 6. Quality Scoring

| Score Range | Label | Severity | Can Approve? |
|-------------|-------|----------|-------------|
| 90–100 | Excellent | pass | Yes |
| 75–89 | Good | pass | Yes |
| 60–74 | Acceptable | warning | Yes (with warning) |
| 40–59 | Poor | warning | Yes (with warning) |
| 0–39 | Critical | critical | **No** |

**Warning-level scores (40–74)** allow approval but attach a warning flag that travels with the export. **Critical scores (0–39)** block approval entirely.

## 7. Revision System

Every card maintains an immutable revision chain:

- Revisions are numbered sequentially (1, 2, 3, ...) with no gaps.
- Each regeneration creates a new revision; the original is never modified.
- PATCH, DELETE, and PUT on revision endpoints return 405 (not allowed).
- Rolling back to an earlier revision creates a **new** revision with the old payload — the original is untouched.
- Each revision includes traceability: prompt_version, workflow_version, seed, model_id, reference_hashes, input_hashes, generation_timestamp.

## 8. Common Operator Scenarios

### Scenario: User uploads images, gets warnings but wants to proceed
- Warnings (non-square aspect, transparency, empty brief) do **not** block the pipeline.
- User can approve and continue. Warnings are attached to the export package.

### Scenario: User wants to regenerate only one card after partial approval
- Use single-card regeneration with the card_id.
- The regenerated card goes to `pending_review`.
- Stage status becomes `partially_approved`.
- User must re-approve the regenerated card before export.

### Scenario: Export fails with 403
- Check compliance report for critical failures.
- Verify all stages 0–5 are approved.
- Verify all 8 cards in stage 4 are approved (not `pending_review` or `draft`).

### Scenario: Export fails with 409
- An earlier stage is not approved.
- The error message includes the blocking stage name.
- Approve the blocking stage, then retry export.

## 9. Known Limitations & Risks

1. **Single approver only** — no multi-approver workflow. If the approver is unavailable, the pipeline stalls.
2. **No approval timeout** — stages in `pending_review` do not auto-expire. Manual intervention required.
3. **No export idempotency guarantee** — double-export behavior is not yet verified.
4. **No rate limiting** — regeneration and export endpoints have no throttle limits.
5. **Two marketplaces only** — strictest-rule logic is tested for WB + Ozon. Adding a third marketplace needs verification.
6. **No concurrent operation handling tested** — simultaneous regenerations or rollback races are not yet tested.

## 10. Troubleshooting

| Symptom | Likely Cause | Action |
|---------|-------------|--------|
| Stage transition returns 409 | Predecessor stage not approved | Approve the blocking stage first |
| Export returns 403 with "critical" | Compliance score ≤ 39 or prohibited keywords | Check compliance report, fix flagged issues |
| Export returns 403 with "blocked" | Review stage not approved | Complete review (approve or comment) |
| Export returns 403 with "Not all cards" | Some cards not approved | Approve all remaining cards |
| Regenerate returns 400 | Stage not approved | Use force flag or approve stage first |
| Regenerate returns 422 | Invalid element name | Use one of: text_overlay, background, badge, icon, position |
| Revision PATCH/DELETE/PUT returns 405 | Revisions are immutable | This is expected — revisions cannot be modified |

## 11. Test Suite Location

- **Fixture tests** (runnable now): `tests/cf_app/`
- **Run command**: `python -m pytest tests/cf_app/ -v`
- **Test fixtures**: `tests/cf_app/fixtures/`
- **QA coverage doc**: `docs/QA_COVERAGE.md`
- **Release checklist**: `docs/RELEASE_CHECKLIST.md`
