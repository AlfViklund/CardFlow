# Revision Rules and Provenance Storage

Task: `09124ab1-96d9-40e8-b144-eaaf781cb4b9`
Last updated: 2026-04-06

## Purpose
This runbook explains how CardFlow stores immutable revisions, manages branches, and preserves provenance so the team can inspect or recover the full history of generated work.

## Revision Policy

- Every meaningful output change creates a **new revision record** — never mutate in place.
- Each revision carries a **version number** that increments sequentially per `(entity_type, entity_id, branch_name)`.
- The **default branch is `'main'`**.
- A revision links to its **parent revision** (nullable for the first revision).
- No approved artifact is ever overwritten — edits and regenerations create new revision records.

## Revision Table Schema

The `revisions` table stores:

| Column | Description |
|--|--|
| `id` | UUID primary key |
| `project_id` | Owning project |
| `entity_type` | What is being versioned (e.g. `job`, `card`, `generation`) |
| `entity_id` | UUID of the entity |
| `branch_name` | Branch label (default `'main'`) |
| `version` | Sequential version number |
| `parent_revision_id` | UUID link to previous revision |
| `asset_id` | Optional reference to the asset |
| `job_id` | Optional reference to the job that produced this revision |
| `note` | Human-readable note |
| `trace` | JSON metadata blob |
| `workflow_version` | Workflow definition version at time of revision |
| `prompt_version` | Prompt/template version |
| `model_id` | AI model identifier |
| `seed` | Generation seed (for reproducibility) |
| `reference_hashes` | Array of source asset SHA-256 hashes |
| `created_at` | Timestamp |

## Traceability Fields

The following fields enable end-to-end provenance inspection:

| Field | Where | Purpose |
|--|--|--|
| `workflow_version` | `revisions`, `cards`, `jobs` | Which workflow definition produced this output |
| `prompt_version` | `revisions`, `jobs` | Which prompt version was used |
| `model_id` | `revisions`, `jobs` | Which AI model generated the output |
| `seed` | `revisions`, `jobs` | Deterministic generation seed |
| `reference_hashes` | `revisions`, `cards` | SHA-256 hashes of source assets |

These are set via:
- `createRevisionWithTrace()` — creates a revision with full traceability
- `updateRevisionTraceability()` — patches traceability on an existing revision
- `updateCardTraceability()` — updates card-level traceability
- `updateJobTraceability()` — updates job-level traceability

## Branch Semantics

Use branches when:
- A user wants an alternate direction instead of a direct replacement.
- Experimenting with a different design concept without losing the current approved version.

Rules:
- The original revision stays intact on its branch.
- The alternate branch gets its own lineage with its own version sequence.
- The UI should make the branch choice visible so operators don't confuse alternatives with replacements.

### Querying Revision History

```
GET revisions WHERE entity_type = ? AND entity_id = ? AND branch_name = 'main'
ORDER BY version DESC LIMIT ?
```

This returns the revision chain from newest to oldest for a given entity.

## Worker-Generated Revisions

The worker automatically creates a revision on job completion:

```typescript
await createRevision(pool, {
  projectId: dbJob.project_id,
  entityType: 'job',
  entityId: dbJob.id,
  jobId: dbJob.id,
  note: 'worker completion record',
  trace: { bullmqJobId, result },
});
```

Every completed job gets a revision entry as an audit trail.

## Rollback Safety

A rollback **must not** erase history:

1. Revert the schema/config pointer, not the history table.
2. Keep the old provenance records readable.
3. Make sure the recovery path still shows the original branch and lineage.
4. The `parent_revision_id` chain remains intact regardless of rollbacks.

## Operational Runbook

### Inspect a Lineage

1. Query the revision history for the entity.
2. Find the newest revision on the target branch.
3. Trace back through `parent_revision_id` to understand the full chain.
4. Check `trace`, `model_id`, `seed`, and `reference_hashes` for reproducibility.

### Run a Provenance Migration

When adding new traceability fields:

1. Deploy the schema change (`0007_revision_traceability.sql`).
2. Backfill metadata for existing records if possible.
3. Verify a sample of old and new revisions.
4. Confirm read paths still show the same history.

### Recover from a Bad Revision Record

1. Identify the bad revision by `id` or `version`.
2. Find the previous revision via `parent_revision_id`.
3. Restore the previous version's state.
4. Create a new revision documenting the recovery.

### List All Revisions by Model

Use `listRevisionsByModelId(modelId)` to find all revisions that used a specific AI model. Useful for:
- Auditing model usage
- Identifying outputs that may need re-generation after a model deprecation
- Cost reporting
