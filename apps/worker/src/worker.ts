import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import IORedis from 'ioredis';
import { Worker } from 'bullmq';
import { queueName } from '@cardflow/core';
import {
  createPool,
  createRevision,
  createTraceEvent,
  getJob,
  runMigrations,
  updateJob,
} from '@cardflow/db';

const env = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://cardflow:cardflow@localhost:15432/cardflow',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:16379',
};

const pool = createPool(env.databaseUrl);
await runMigrations(pool);

const redis = new IORedis(env.redisUrl, { maxRetriesPerRequest: null });

const worker = new Worker(
  queueName,
  async (job) => {
    const jobId = String(job.data.jobId);
    const dbJob = await getJob(pool, jobId);
    if (!dbJob) {
      throw new Error(`job ${jobId} not found in database`);
    }

    await updateJob(pool, jobId, {
      status: 'processing',
      startedAt: new Date().toISOString(),
      attempts: job.attemptsMade + 1,
    });

    await createTraceEvent(pool, {
      traceId: dbJob.trace_id,
      entityType: 'job',
      entityId: dbJob.id,
      eventType: 'job.started',
      payload: { bullmqJobId: job.id, attempt: job.attemptsMade + 1 },
    });

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
      attempts: job.attemptsMade + 1,
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
  },
  { connection: redis, concurrency: 2 },
);

worker.on('failed', async (job, error) => {
  if (!job?.data?.jobId) return;
  const jobId = String(job.data.jobId);
  const dbJob = await getJob(pool, jobId);
  if (!dbJob) return;

  await updateJob(pool, jobId, {
    status: 'failed',
    error: error.message,
    finishedAt: new Date().toISOString(),
    attempts: job.attemptsMade,
  });

  await createTraceEvent(pool, {
    traceId: dbJob.trace_id,
    entityType: 'job',
    entityId: dbJob.id,
    eventType: 'job.failed',
    payload: { error: error.message, attemptsMade: job.attemptsMade },
  });
});

worker.on('ready', () => {
  console.log(`worker listening on queue ${queueName}`);
});

async function shutdown(signal: string) {
  console.log(`shutting down worker (${signal})`);
  await worker.close();
  await redis.quit();
  await pool.end();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
