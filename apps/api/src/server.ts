import 'dotenv/config';
import crypto from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import {
  assetCreateSchema,
  defaultStorageBucket,
  jobCreateSchema,
  marketplaceSchema,
  projectCreateSchema,
  queueName,
} from '@cardflow/core';
import {
  createAsset,
  createJob,
  createPool,
  createProject,
  createRevision,
  createTraceEvent,
  getAsset,
  getJob,
  getProject,
  healthCheck,
  listProjects,
  runMigrations,
} from '@cardflow/db';
import { createStorageClient } from '@cardflow/storage';

const env = {
  port: Number(process.env.API_PORT ?? 3400),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://cardflow:cardflow@localhost:15432/cardflow',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:16379',
  s3Endpoint: process.env.S3_ENDPOINT ?? 'localhost',
  s3Port: Number(process.env.S3_PORT ?? 19000),
  s3UseSSL: String(process.env.S3_USE_SSL ?? 'false') === 'true',
  s3AccessKey: process.env.S3_ACCESS_KEY ?? 'cardflow',
  s3SecretKey: process.env.S3_SECRET_KEY ?? 'cardflowsecret',
  s3Bucket: process.env.S3_BUCKET ?? defaultStorageBucket,
};

const pool = createPool(env.databaseUrl);
await runMigrations(pool);

const redis = new IORedis(env.redisUrl, { maxRetriesPerRequest: null });
const queue = new Queue(queueName, { connection: redis });
const storage = createStorageClient({
  endpoint: env.s3Endpoint,
  port: env.s3Port,
  useSSL: env.s3UseSSL,
  accessKey: env.s3AccessKey,
  secretKey: env.s3SecretKey,
  bucket: env.s3Bucket,
});
await storage.ensureBucket();

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

app.get('/healthz', async () => ({ ok: true, service: 'api' }));

app.get('/readyz', async (request, reply) => {
  try {
    await healthCheck(pool);
    await redis.ping();
    await storage.client.bucketExists(env.s3Bucket);
    return { ok: true, db: 'ok', redis: 'ok', storage: 'ok' };
  } catch (error) {
    request.log.error(error, 'readiness check failed');
    reply.code(503);
    return {
      ok: false,
      db: 'unknown',
      redis: 'unknown',
      storage: 'unknown',
    };
  }
});

app.get('/v1/projects', async () => listProjects(pool));

app.post('/v1/projects', async (request, reply) => {
  const parsed = projectCreateSchema.parse(request.body);
  const project = await createProject(pool, parsed);
  reply.code(201);
  return project;
});

app.get('/v1/projects/:projectId', async (request, reply) => {
  const { projectId } = request.params as { projectId: string };
  const project = await getProject(pool, projectId);
  if (!project) {
    reply.code(404);
    return { error: 'project not found' };
  }
  return project;
});

app.post('/v1/jobs', async (request, reply) => {
  const parsed = jobCreateSchema.parse(request.body);
  const job = await createJob(pool, parsed);
  await queue.add(job.type, { jobId: job.id, projectId: job.project_id, payload: job.payload }, {
    jobId: job.id,
    attempts: 3,
    removeOnComplete: 100,
    removeOnFail: 100,
  });
  await createTraceEvent(pool, {
    traceId: job.trace_id,
    entityType: 'job',
    entityId: job.id,
    eventType: 'job.enqueued',
    payload: { queueName: job.queue_name, type: job.type },
  });
  reply.code(201);
  return job;
});

app.get('/v1/jobs/:jobId', async (request, reply) => {
  const { jobId } = request.params as { jobId: string };
  const job = await getJob(pool, jobId);
  if (!job) {
    reply.code(404);
    return { error: 'job not found' };
  }
  return job;
});

app.post('/v1/assets', async (request, reply) => {
  const parsed = assetCreateSchema.parse(request.body);
  const fileBuffer = Buffer.from(parsed.content, 'utf8');
  const assetKey = `projects/${parsed.projectId}/assets/${crypto.randomUUID()}-${parsed.filename}`;
  const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  await storage.putObject({
    key: assetKey,
    content: fileBuffer,
    contentType: parsed.mimeType,
  });

  const asset = await createAsset(pool, {
    projectId: parsed.projectId,
    kind: parsed.kind,
    filename: parsed.filename,
    mimeType: parsed.mimeType,
    byteSize: fileBuffer.length,
    sha256,
    storageBucket: env.s3Bucket,
    storageKey: assetKey,
    metadata: parsed.metadata,
  });

  await createRevision(pool, {
    projectId: parsed.projectId,
    entityType: 'asset',
    entityId: asset.id,
    assetId: asset.id,
    note: 'initial asset upload',
    trace: { storageKey: assetKey, sha256 },
  });

  await createTraceEvent(pool, {
    traceId: asset.id,
    entityType: 'asset',
    entityId: asset.id,
    eventType: 'asset.uploaded',
    payload: { storageBucket: env.s3Bucket, storageKey: assetKey, byteSize: fileBuffer.length },
  });

  reply.code(201);
  return asset;
});

app.get('/v1/assets/:assetId', async (request, reply) => {
  const { assetId } = request.params as { assetId: string };
  const asset = await getAsset(pool, assetId);
  if (!asset) {
    reply.code(404);
    return { error: 'asset not found' };
  }
  return asset;
});

app.get('/v1/assets/:assetId/download', async (request, reply) => {
  const { assetId } = request.params as { assetId: string };
  const asset = await getAsset(pool, assetId);
  if (!asset) {
    reply.code(404);
    return { error: 'asset not found' };
  }

  const stream = await storage.getObject(asset.storage_key);
  reply.header('content-type', asset.mime_type);
  reply.header('content-disposition', `attachment; filename="${asset.filename}"`);
  return reply.send(stream);
});

app.get('/v1/debug/bootstrap', async () => ({
  queueName,
  bucket: env.s3Bucket,
  defaultCardCount: 8,
  marketplaces: marketplaceSchema.options,
}));

const address = await app.listen({ port: env.port, host: '0.0.0.0' });
app.log.info(`API listening on ${address}`);

async function shutdown(signal: string) {
  app.log.info({ signal }, 'shutting down api');
  await app.close();
  await queue.close();
  await redis.quit();
  await pool.end();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
