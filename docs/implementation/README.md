# CardFlow implementation docs lane

Source of truth:
- Approved planner dossier/package for CardFlow
- Board tasks:
  - `1db4d9ef-f4ff-4804-a082-052b92dff742` — Step 0 rules and analysis jobs
  - `095258be-e6bd-44d5-8ad1-98d543547228` — generation pipeline
  - `72346f88-cb92-4bca-be64-105d2adc6b3c` — compliance runbook and rollout controls
  - `09124ab1-96d9-40e8-b144-eaaf781cb4b9` — provenance storage revision rules and ops rollout

This package is a draft implementation/reference set for the docs lane. It turns the planner intent into operator-facing docs and runbooks.

## Included docs
- `step-0-analysis-jobs.md`
- `generation-pipeline.md`
- `compliance-ops-runbook.md`
- `provenance-revision-runbook.md`
- `gaps-and-questions.md`

## What these docs cover
- Workflow shape from ingestion to export
- Queue/job boundaries and operational expectations
- Compliance and export blocking behavior
- Revision/provenance rules, rollback, and inspection

## What is still missing from the planner dossier package
- Final implementation names for services, queues, and endpoints
- Exact validation thresholds and rule scoring formulas
- Final storage schema names and retention policy
- Alert destinations and escalation policy

## Status
- Drafted from board task specs and CardFlow objective.
- Marked gaps/questions where the planner package does not expose implementation-specific details.
