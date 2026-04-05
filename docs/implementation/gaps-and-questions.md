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

## Compliance gaps
- Exact block reason taxonomy
- Whether a numeric compliance score is required
- Approval requirements for changing production rules

## Provenance / revision gaps
- Final storage schema for immutable revisions
- Retention window for lineage history
- Approved backfill strategy for legacy records
