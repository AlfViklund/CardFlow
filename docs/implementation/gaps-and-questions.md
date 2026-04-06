# Cross-doc gaps and questions

These are the implementation details that are still missing from the approved planner dossier/package or were not visible in the board task specs.

## Shared gaps
- Final service, queue, and endpoint names
- Exact retry and timeout policies
- Final retention policy for generated and superseded artifacts
- Alert destinations and escalation paths
- Whether the docs should assume a single monolith or a split frontend/backend/worker deployment in every environment

## Step 0 / analysis gaps
- Which analysis engine is the approved default?
- What are the supported input types in MVP?
- Which block reasons are user-fixable?

## Generation pipeline gaps
- Canonical stage names
- Queue names and worker naming conventions
- Whether the target output is always 8 cards or project-configurable

## Compliance gaps (updated 2026-04-06)
- ~~Exact block reason taxonomy~~ — Resolved: taxonomy defined as `<MARKETPLACE>.<RULE_CATEGORY>.<SPECIFIC_REASON>` in compliance-ops-runbook.md §2.4
- ~~Whether a numeric compliance score is required~~ — Resolved: score is informative only, export gate driven by `criticalFailures > 0` (§1.2)
- ~~Approval requirements for changing production rules~~ — Resolved: MAJOR changes require lead approval; PATCH/MINOR follow standard promotion path (§8.3)
- ~~Rule precedence order~~ — Resolved: severity → marketplace → category → alphabetical (§2.1)
- ~~Review workflow behavior~~ — Resolved: three approval gates (`concept`, `final`, `export`) with regeneration downgrade rules (§5)
- ~~Export-blocking conditions~~ — Resolved: compliance (403), approval (403), workflow (409) blocks with response format (§6)
- ~~Operator procedures~~ — Resolved: rule update, validation report interpretation, production monitoring (§7)
- ~~Rollout notes~~ — Resolved: configuration, alerting, safe rule-version changes (§8)

## Provenance / revision gaps
- Final storage schema for immutable revisions
- Retention window for lineage history
- Approved backfill strategy for legacy records
