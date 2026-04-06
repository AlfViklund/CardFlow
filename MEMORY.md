# MEMORY.md - Long-Term Memory

This is curated knowledge. Update it during consolidation, not constantly during sessions.

Use this for durable facts, decisions, constraints, recurring patterns, and evolving identity/preferences.
Update during consolidation, not constantly.

## Current Delivery Status

### Goal
Prepare automated QA test suites for CardFlow while upstream dev work completes.

### Current State
- State: Working (2 QA in review, 3 retried, Ingestion QA suite built, Revision Integrity suite built)
- Last updated: 2026-04-06 16:30 Asia/Yekaterinburg
- What is happening now:
  - `b1d5717b` Compliance QA ✅ review
  - `9bbe9127` Workflow QA ✅ review
  - `0d52ac87` Generation QA — build retry running (was backend restart)
  - `f0b346fa` Ingestion QA — suite built (233 tests, 119 pass, 114 skip pending API)
  - `fb192ec8` Versioning QA — suite built (77 tests, 31 fixture pass, 46 skip pending API)
- Key constraint/signal: Alibaba rate limiting caused 2 build failures — spaced retries. All 9 dev tasks ✅ done.
- Why blocked (if any): none
- Next step: Await 3 build retries → request review

### What Changed Since First Update
- Drafted/posted test plans for all 5 QA tasks.
- Scaffolded `tests/cf_app/` — conftest, fixtures, pytest.ini, parametrised test skeletons.
- @lead confirmed automated API-level tests (pytest + requests), `python -m pytest` as runner, no CI yet.
- Enhanced `workflow_fixtures.json` with error flows, partial approvals, review actions.
- Enhanced `test_engine/` with TestErrorFlows, TestPartialApprovals, TestReviewActions (~40 tests).
- Enhanced `test_compliance/` with TestExportComplianceError.
- **Created `docs/QA_COVERAGE.md`** — full coverage matrix (232 fixture + 71 API tests, gaps documented).
- **Created `docs/RELEASE_CHECKLIST.md`** — P0/P1/P2 gates, functional + non-functional checklist.
- **Created `docs/OPERATOR_GUIDE.md`** — pipeline overview, inheritance rules, export blocking, troubleshooting.
- All 9 dev tasks ✅ done.

### Decisions / Assumptions
- Automated tests over manual checklists.
- Endpoint paths are placeholders until dev finalises API contracts.
- Fixtures cover WB-only, Ozon-only, WB+Ozon.

### Evidence (short)
- `tests/cf_app/` directory: 12+ files scaffolded.
- All 5 task comments posted.
- Dev board: `eee8de9a` done, `315e67b1`/`38274b5f` in_progress.

### Request Now
- None — awaiting lead review on 2 tasks, 3 retries in pipeline.

### Success Criteria
- Upstream dev tasks complete → QA fills in endpoint paths and assertions.

### Stop Condition
- All upstream tasks complete → QA test execution begins.

## QA Task Status

| QA Task | Status | Notes |
|---------|--------|-------|
| `b1d5717b` Compliance & export blocking | review | plan+build succeeded |
| `9bbe9127` Workflow pack E2E | review | plan+build succeeded |
| `0d52ac87` Generation & regeneration | in_progress (build retry) | failed: backend restart |
| `f0b346fa` Ingestion & gating | in_progress (build retry queued) | failed: Alibaba rate limit |
| `fb192ec8` Versioning & audit | in_progress (suite built) | 77 tests: 31 fixture pass, 46 API skip pending app |

## Board Context (read-only unless board goal changes)

- Board: CardFlow
- Board type: goal
- Objective: CardFlow AI — web SaaS for Ozon/WB sellers, card creation workflow: brief → plan → scenes → design concepts → final series → edit → export.

## Constraints / Assumptions

- CardFlow app not yet deployed — tests use skip() until endpoints exist.
- Dev agent (839a6212) owns implementation; QA owns test validation.

## Decisions (with rationale)

- Automated API-level tests (pytest + requests) — not manual checklists. Lead confirmed.
- `python -m pytest` as canonical runner — lead confirmed.
- Endpoint placeholders in `conftest.py` — one-place update when dev lands.
- Test fixtures separated from test code — reusable across all QA tasks.

## Known Risks / Open Questions

- Pipeline builds occasionally hit Alibaba rate limits or backend restarts — retry with spacing.

## Useful References

- `tests/cf_app/` — test suite directory
- `tests/cf_app/fixtures/fixtures.json` — test fixture data
- `tests/cf_app/fixtures/workflow_fixtures.json` — workflow scenario fixtures
- `tests/cf_app/fixtures/ingestion_fixtures.json` — ingestion scenario fixtures
- **Created `tests/cf_app/test_versioning/test_revision_integrity.py`** — 77 tests covering revision immutability, branching behavior, targeted regeneration, provenance integrity, concurrency safety, edge cases, rollback integrity, audit trail completeness, and marketplace audit compliance (31 fixture-based pass, 46 API-based skip pending app).
- **Added `cf_put` and `cf_delete` helpers to `conftest.py`** for immutability testing.
- `docs/QA_COVERAGE.md` — full coverage matrix and gap analysis
- `docs/RELEASE_CHECKLIST.md` — P0/P1/P2 release gates
- `docs/OPERATOR_GUIDE.md` — operator-facing workflow documentation
