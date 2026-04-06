# Plan: BullMQ Worker Lifecycle & Recovery (c366d801)

## Mission
Enhance the existing BullMQ worker in `apps/worker/src/worker.ts` to handle transient failures with retries, track dead-letter jobs, and recover stalled jobs after restart.

## Current State
- `apps/worker/src/worker.ts`: Basic BullMQ worker with simple job processing, a `setTimeout(250)` placeholder, `failed` event handler, and `SIGINT/SIGTERM` shutdown.
- `@cardflow/db`: Has `jobs` table (`jobs`), `updateJob()`, `getJob()`, `createGenerationJob()`, `updateGenerationJobStatus()`, `createTraceEvent()`, `createRevision()`.
- `@cardflow/core`: Has `queueName`, job schemas, generation job schemas.
- Migration `0001_initial.sql`: `jobs` table with `status`, `attempts`, `error`, etc.

## Work Items

### 1. Migration: `0008_worker_lifecycle.sql`
Add `dead_letter_reason` and `last_retry_at` columns to the `jobs` table, plus index for stalled-job recovery queries.

### 2. Enhanced Worker Handler (`apps/worker/src/worker.ts`)
- Add configurable retry with exponential backoff (max retries from job payload or default 3).
- Distinguish transient failures (network, timeout) from permanent failures (bad input, missing data).
- On transient failure: throw to trigger BullMQ retry with exponential backoff.
- On permanent failure: mark job as `failed` with `dead_letter_reason`, do NOT retry.
- Track retry attempts with timestamps via `updateJob()`.

### 3. Stalled Job Recovery
- On worker startup: query DB for jobs with `status = 'processing'` whose `started_at` is older than a configurable stall threshold (e.g., 5 minutes).
- Re-queue them as new BullMQ jobs, reset status to `queued`, increment attempts.
- Emit trace events for each recovered job.

### 4. Dead Letter Tracking
- Failed jobs that exhausted retries → status = `dead-lettered`.
- Add `getDeadLetterJobs(pool)` DB function for ops inspection.

### 5. DB Layer Updates (`packages/db/src/index.ts`)
- `getStalledJobs(pool, thresholdMinutes: number)`: find stuck processing jobs.
- `markJobAsDeadLetter(pool, jobId, reason)`: set status + dead_letter_reason.
- `getDeadLetterJobs(pool)`: list for ops inspection.

## Done Signal
- Worker implements retry with backoff for transient failures ✅
- Permanent failures go to dead-letter (no retry) ✅
- Startup recovery rehydrates stalled jobs ✅
- All workspaces pass `npm run check` ✅
- Task evidence captured in task comment ✅
