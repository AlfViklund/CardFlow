# Generation Pipeline

Task: `095258be-e6bd-44d5-8ad1-98d543547228`
Last updated: 2026-04-06

## Purpose
The generation pipeline turns a validated brief into a staged series of CardFlow outputs. The key requirement is not generating one image — it is creating a **consistent multi-card series** with controlled regeneration and traceable lineage.

## Pipeline Architecture

The pipeline consists of two layers:

- **Orchestration layer** — decides what to generate next, enforces stage ordering, and manages approvals.
- **Worker layer** — executes generation jobs asynchronously via a BullMQ queue backed by Redis.

```
Step 0 (ingestion) → copy → scenes → design-concept → final
        ↓                ↓          ↓          ↓          ↓
  validation       marketing    product     visual    generated
  + analysis       text plan   photography  layout     cards
```

## Queue & Worker Configuration

| Setting | Value | Source |
|--|--|--|
| Queue name | `cardflow-jobs` | `@cardflow/core` |
| Default card count | `8` | `defaultCardCount` (configurable 1–24) |
| Storage bucket | `cardflow-dev` | `defaultStorageBucket` |
| Worker concurrency | `2` | `apps/worker/src/worker.ts` |
| Max retries | `3` (env: `WORKER_MAX_RETRIES`) | worker config |
| Stall threshold | `5 minutes` (env: `WORKER_STALL_THRESHOLD_MIN`) | worker config |
| Backoff strategy | Exponential: 1min → 2min → 4min → 8min → 16min (capped) | worker settings |

### Stalled Job Recovery

On boot the worker scans for jobs stuck in `processing` beyond the stall threshold. Each stalled job is:
1. Re-queued in the database (status → `queued`)
2. Re-enqueued into BullMQ
3. Traced with a `job.recovered` event

### Error Classification

- **Transient errors** — `ECONNREFUSED`, `ETIMEDOUT`, `ECONNRESET`, `socket hang up`, `timeout`, `deadlock`, `too many clients`, `rate limit`, `503`, `504` — trigger retries via BullMQ.
- **Permanent errors** — everything else (including "job not found") — are terminal.
- **Dead-letter** — after retries exhausted or on permanent failure, the job is marked `dead-lettered` with a reason and a `job.dead-lettered` trace event.

## Generation Stages

### Canonical Stage Names

| Stage | Produces | Depends On |
|--|--|--|
| `copy` | Marketing text for each card | Step 0 analysis output |
| `scenes` | Product photography scene descriptions | `copy` |
| `design-concept` | Visual layout / design concept | `scenes` |
| `final` | Final generated cards | `design-concept` |

Stage transitions are strictly sequential: `copy` → `scenes` → `design-concept` → `final`.
Downstream stages cannot start until the upstream stage is completed.

### Job Model

Each generation job carries:

- `projectId`, `cardId` (nullable for batch jobs)
- `stage` — one of `copy`, `scenes`, `design-concept`, `final`
- `scope` — `card`, `batch`, or `element`
- `element` — optional: `text`, `scene`, `design`, `background`, `position`
- `provider` — optional: `openai`, `stability`, `replicate`, `midjourney`, `custom`
- `model`, `seed`, `prompt` — reproducibility fields
- `inputData` — raw input payload
- `parentGenerationId` — for regeneration lineage
- `batchId` — for batch operations

Stage statuses: `queued` → `processing` → `completed` | `failed` | `cancelled`

### Targeted Regeneration

Regeneration supports three scopes:

| Scope | What | Effect |
|--|--|--|
| `stage` | Re-run an entire stage for a card | All outputs for that stage are regenerated |
| `card` | Re-run a single card | Same as stage but card-scoped |
| `element` | Re-run one element within a card | Only the targeted element changes |

**Rules:**
- Prior outputs remain available for comparison.
- Regeneration creates a new version on the same lineage or a linked branch.
- Downstream stages are not automatically re-run — an explicit handoff is required.
- After regenerating an approved stage, the stage status downgrades to `partially_approved`.

## Storage Layout

- **Database** — `generation_jobs` and `generation_outputs` tables (PostgreSQL)
- **Assets** — stored in bucket `cardflow-dev` with a storage key per artifact
- **Revisions** — every job completion creates a `revisions` row with trace metadata
- **Trace events** — `trace_events` table records `job.started`, `job.completed`, `job.retrying`, `job.dead-lettered`

Each generated artifact (output) includes:
- `generation_id`, `card_id`, `output_type`
- `content` (JSON), `storage_key`, `metadata`
- Output types: `text`, `scene`, `concept_image`, `final_card`, `batch_metadata`

## Monitoring & Alerting

Watch for:
- Queue depth growth (jobs backing up in Redis)
- Jobs exceeding stall threshold (5 min)
- Dead-letter pile-up (permanent failures)
- Stage duration anomalies
- Pass/fail ratio changes across stages

## Cost Control

- Batch jobs share a `batchId` for cost aggregation.
- `model` and `provider` fields allow routing to different price tiers.
- `seed` enables reproducible outputs without re-running expensive generations.
- Monitor `attempts` count per job — high retry counts indicate upstream instability.

## Operational Runbook

### Smoke Check
1. Create a project with one card.
2. Submit a copy generation job (`scope: card`).
3. Confirm the job is enqueued to `cardflow-jobs` and processed by the worker.
4. Confirm a revision is created for the job completion.
5. Trigger a targeted regeneration on one element.
6. Confirm the new artifact keeps lineage and the old one remains readable.

### Recover a Dead-Lettered Job
1. Query the `jobs` table for `status = 'dead-lettered'`.
2. Inspect the `dead_letter_reason` field.
3. If the cause was transient (e.g. provider outage), re-queue manually.
4. If the cause is permanent (bad input), fix the input and create a new job.

### Rollback a Bad Generation
1. The previous generation output is preserved — never overwritten.
2. Use the revision history to identify the last-good version.
3. Revert the card's `selected_concept_id` or re-run from the previous stage.
