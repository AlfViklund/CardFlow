import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import IORedis from 'ioredis';
import { Worker, Queue } from 'bullmq';
import { queueName } from '@cardflow/core';
import {
  createPool,
  createRevision,
  createTraceEvent,
  getJob,
  runMigrations,
  updateJob,
  getStalledJobs,
  requeueStalledJob,
  markJobAsDeadLetter,
  recordJobRetry,
} from '@cardflow/db';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const env = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://cardflow:cardflow@localhost:15432/cardflow',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:16379',
  maxRetries: parseInt(process.env.WORKER_MAX_RETRIES ?? '3', 10),
  stallThresholdMinutes: parseInt(process.env.WORKER_STALL_THRESHOLD_MIN ?? '5', 10),
};

// Transient error patterns — these should trigger retries
const TRANSIENT_PATTERNS = [
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ECONNRESET',
  'socket hang up',
  'timeout',
  'deadlock',
  'too many clients',
  'rate limit',
  '503',
  '504',
] as const;

function isTransientError(message: string): boolean {
  const lower = message.toLowerCase();
  return TRANSIENT_PATTERNS.some((pattern) => lower.includes(pattern.toLowerCase()));
}

class TransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientError';
  }
}

class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentError';
  }
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

const pool = createPool(env.databaseUrl);
await runMigrations(pool);

const redis = new IORedis(env.redisUrl, { maxRetriesPerRequest: null });
const queue = new Queue(queueName, { connection: redis });

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

const worker = new Worker(
  queueName,
  async (job) => {
    const jobId = String(job.data.jobId);
    const dbJob = await getJob(pool, jobId);
    if (!dbJob) {
      throw new PermanentError(`job ${jobId} not found in database`);
    }

    await updateJob(pool, jobId, {
      status: 'processing',
      startedAt: new Date().toISOString(),
    });

    await createTraceEvent(pool, {
      traceId: dbJob.trace_id,
      entityType: 'job',
      entityId: dbJob.id,
      eventType: 'job.started',
      payload: { bullmqJobId: job.id, attempt: job.attemptsMade + 1 },
    });

    try {
      // TODO: replace placeholder stub with real generation/dispatch handler per job type
      await new Promise((resolve) => setTimeout(resolve, 250));

      const result = {
        processedAt: new Date().toISOString(),
        workerId: randomUUID(),
        queueJobId: job.id,
        type: dbJob.type,
        payload: dbJob.payload,
      };

      const completed = await updateJob(pool, jobId, {
        status: 'completed',
        result,
        finishedAt: new Date().toISOString(),
      });

      await createRevision(pool, {
        projectId: dbJob.project_id,
        entityType: 'job',
        entityId: dbJob.id,
        jobId: dbJob.id,
        note: 'worker completion record',
        trace: { bullmqJobId: job.id, result },
      });

      await createTraceEvent(pool, {
        traceId: dbJob.trace_id,
        entityType: 'job',
        entityId: dbJob.id,
        eventType: 'job.completed',
        payload: { result, completedAt: completed?.finished_at ?? new Date().toISOString() },
      });

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      if (isTransientError(message)) {
        // Wrap so BullMQ retries via its retry mechanism
        await recordJobRetry(pool, jobId);
        throw new TransientError(message);
      }

      // Permanent failure — throw; the `failed` event handler decides
      // whether to dead-letter or retry.
      throw err;
    }
  },
  {
    connection: redis,
    concurrency: 2,
    settings: {
      backoffStrategy: (attemptsMade: number) => {
        // 1min, 2min, 4min, 8min, 16min — capped at 16min
        return Math.min(60_000 * Math.pow(2, attemptsMade - 1), 16 * 60_000);
      },
    },
  },
);

// ---------------------------------------------------------------------------
// Failure handling — dead-letter after exhausted retries
// ---------------------------------------------------------------------------

worker.on('failed', async (job, error) => {
  if (!job?.data?.jobId) return;
  const jobId = String(job.data.jobId);
  const dbJob = await getJob(pool, jobId);
  if (!dbJob) return;

  const message = error?.message ?? 'unknown error';
  const exhausted = job.attemptsMade >= env.maxRetries;
  const permanent = !isTransientError(message);

  if (exhausted || permanent) {
    const reason = exhausted
      ? `exhausted ${env.maxRetries} retries: ${message}`
      : `permanent failure: ${message}`;

    await markJobAsDeadLetter(pool, jobId, reason);
    await createTraceEvent(pool, {
      traceId: dbJob.trace_id,
      entityType: 'job',
      entityId: dbJob.id,
      eventType: 'job.dead-lettered',
      payload: { reason, attemptsMade: job.attemptsMade, exhausted },
    });
  } else {
    // Transient, still has retries remaining — BullMQ will re-enqueue
    await updateJob(pool, jobId, {
      status: 'queued',
      error: message,
    });
    await createTraceEvent(pool, {
      traceId: dbJob.trace_id,
      entityType: 'job',
      entityId: dbJob.id,
      eventType: 'job.retrying',
      payload: { error: message, attemptsMade: job.attemptsMade, maxRetries: env.maxRetries },
    });
  }
});

worker.on('error', (err) => {
  console.error(`worker error: ${err.message}`);
});

worker.on('ready', () => {
  console.log(`worker listening on queue ${queueName}`);
});

// ---------------------------------------------------------------------------
// Stalled-job recovery on startup
// ---------------------------------------------------------------------------

async function recoverStalledJobs() {
  const stalled = await getStalledJobs(pool, env.stallThresholdMinutes);
  if (stalled.length === 0) return;

  console.log(`recovering ${stalled.length} stalled job(s)`);

  for (const row of stalled) {
    const jobId = row.id as string;
    const requeued = await requeueStalledJob(pool, jobId);
    if (!requeued) continue;

    // Re-enqueue into BullMQ so the worker picks it up
    await queue.add(
      'recovered',
      { jobId, recovered: true },
      { jobId, removeOnComplete: true },
    );

    await createTraceEvent(pool, {
      traceId: row.trace_id,
      entityType: 'job',
      entityId: jobId,
      eventType: 'job.recovered',
      payload: {
        previousStatus: row.status,
        requeuedAt: requeued.updated_at,
        attempts: row.attempts,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown(signal: string) {
  console.log(`shutting down worker (${signal})`);
  await worker.close();
  await queue.close();
  await redis.quit();
  await pool.end();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

// Boot
await recoverStalledJobs();
