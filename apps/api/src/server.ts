import 'dotenv/config';
import crypto from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import {
  approvalCreateSchema,
  assetCreateSchema,
  cardCreateSchema,
  cardUpdateSchema,
  commentCreateSchema,
  defaultStorageBucket,
  defaultWorkflowSteps,
  getMergedRules,
  jobCreateSchema,
  marketplaceSchema,
  marketplaceUploadRules,
  marketplaceUpdateSchema,
  MAX_REFERENCE_IMAGES,
  MAX_TOTAL_IMAGES,
  projectCreateSchema,
  queueName,
  step0AdditionalImagesUploadSchema,
  step0ApprovalSchema,
  step0IngestSchema,
  step0ReferenceImagesUploadSchema,
  stepCreateSchema,
  stepInheritSchema,
  projectCardInitSchema,
  revisionQuerySchema,
  defaultCardCountUpdateSchema,
  regenerationRequestSchema,
  stepActionSchema,
  generationJobCreateSchema,
  generationOutputCreateSchema,
  reproducibilitySchema,
  defaultWbRules,
  defaultOzonRules,
  getAllDefaultRules,
  getMergedComplianceRules,
  calculateComplianceScore,
  ruleCheckResultSchema,
  complianceValidationSchema,
  ComplianceValidator,
  buildComplianceReport,
  validateCardCount,
  type ComplianceInput,
  type ComplianceReport,
  analyzeQuality,
  makeGatingDecision,
  validateExportCard,
  validateProjectForExport,
  generateQualityReport,
} from '@cardflow/core';
import {
  createApproval,
  createAsset,
  createCard,
  createComment,
  createJob,
  createPool,
  createProject,
  createRevision,
  createStep,
  createTraceEvent,
  getActiveWorkflowDefinition,
  getAsset,
  getCard,
  getJob,
  getProject,
  healthCheck,
  listApprovalsByStep,
  listCardsByProject,
  listCommentsByCard,
  listProjects,
  listStepsByCard,
  runMigrations,
  updateCard,
  updateStep,
  upsertWorkflowDefinition,
  upsertStep0Ingestion,
  getStep0Ingestion,
  batchCreateValidationRecords,
  loadWorkflowState,
  inheritStepResult,
  initializeDefaultCards,
  getRevisionHistory,
  createRevisionWithTrace,
  updateProjectMarketplaces,
  updateDefaultCardCount,
  createRegenerationRequest,
  getRegenerationRequest,
  listRegenerationRequestsByCard,
  updateRegenerationStatus,
  getCardWorkflowState,
  getProjectExportReadiness,
  linkIngestionImage,
  listIngestionImages,
  listValidationRecords,
  createGenerationJob,
  getGenerationJob,
  listGenerationJobsByProject,
  listGenerationJobsByCard,
  updateGenerationJobStatus,
  cancelGenerationJob,
  createGenerationOutput,
  listGenerationOutputs,
  createBatchGenerationJobs,
  getUpstreamApprovedData,
  seedComplianceRules,
  getActiveComplianceRules,
  createComplianceValidation,
  getComplianceValidation,
  listComplianceValidationsByProject,
  listComplianceValidationsByCard,
  updateProjectExportBlock,
  getSubscriptionByProject,
  createSubscription,
  updateSubscriptionStatus,
  upgradeSubscription,
  cancelSubscription,
  recordCreditTransaction,
  getCreditBalance,
  getLedgerEntries,
  getCreditsUsed,
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
  // Step 0 quality gating thresholds (configurable)
  step0QualityBlockThreshold: Number(process.env.STEP0_QUALITY_BLOCK_THRESHOLD ?? 40),
  step0QualityWarnThreshold: Number(process.env.STEP0_QUALITY_WARN_THRESHOLD ?? 60),
  step0QualityEnabled: String(process.env.STEP0_QUALITY_ENABLED ?? 'true') === 'true',
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

// Seed compliance rules on startup
await seedComplianceRules(pool, getAllDefaultRules());
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
  workflowSteps: defaultWorkflowSteps(),
}));

// ========================================================================
// Cards
// ========================================================================

app.post('/v1/cards', async (request, reply) => {
  const parsed = cardCreateSchema.parse(request.body);
  const card = await createCard(pool, parsed);
  reply.code(201);
  return card;
});

app.get('/v1/cards/:cardId', async (request, reply) => {
  const { cardId } = request.params as { cardId: string };
  const card = await getCard(pool, cardId);
  if (!card) {
    reply.code(404);
    return { error: 'card not found' };
  }
  return card;
});

app.get('/v1/projects/:projectId/cards', async (request, reply) => {
  const { projectId } = request.params as { projectId: string };
  const cards = await listCardsByProject(pool, projectId);
  return cards;
});

app.patch('/v1/cards/:cardId', async (request, reply) => {
  const { cardId } = request.params as { cardId: string };
  const parsed = cardUpdateSchema.parse(request.body);
  // Build patch: only include defined top-level keys
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (value !== undefined) {
      patch[key] = value !== null ? value : null;
    }
  }
  // Map camelCase to snake_case for DB
  const dbPatch: Record<string, unknown> = {};
  if (patch.status) dbPatch.status = patch.status;
  if (patch.title !== undefined) dbPatch.title = patch.title;
  if (patch.promptInstructions !== undefined) dbPatch.prompt_instructions = patch.promptInstructions;
  if (patch.currentStep !== undefined) dbPatch.current_step = patch.currentStep === null ? null : patch.currentStep;
  if (patch.selectedConceptId !== undefined) dbPatch.selected_concept_id = patch.selectedConceptId === null ? null : patch.selectedConceptId;
  if (patch.metadata !== undefined) dbPatch.metadata = patch.metadata;

  const card = await updateCard(pool, cardId, dbPatch);
  if (!card) {
    reply.code(404);
    return { error: 'card not found' };
  }
  return card;
});

// ========================================================================
// Steps
// ========================================================================

app.post('/v1/cards/:cardId/steps', async (request, reply) => {
  const { cardId } = request.params as { cardId: string };
  const card = await getCard(pool, cardId);
  if (!card) {
    reply.code(404);
    return { error: 'card not found' };
  }
  const body = request.body as Record<string, unknown>;
  const parsed = stepCreateSchema.parse({ ...body, cardId });
  const step = await createStep(pool, parsed);
  reply.code(201);
  return step;
});

app.get('/v1/cards/:cardId/steps', async (request, reply) => {
  const { cardId } = request.params as { cardId: string };
  const steps = await listStepsByCard(pool, cardId);
  return steps;
});

app.patch('/v1/steps/:stepId', async (request, reply) => {
  const { stepId } = request.params as { stepId: string };
  const patch: Record<string, unknown> = {};
  const body = request.body as Record<string, unknown>;
  if (body.status !== undefined) patch.status = body.status;
  if (body.result !== undefined) patch.result = body.result;
  if (body.error !== undefined) patch.error = body.error;
  if (body.inheritedFromStepId !== undefined) patch.inherited_from_step_id = body.inheritedFromStepId;

  const step = await updateStep(pool, stepId, patch);
  if (!step) {
    reply.code(404);
    return { error: 'step not found' };
  }
  return step;
});

// ========================================================================
// Approvals
// ========================================================================

app.post('/v1/steps/:stepId/approvals', async (request, reply) => {
  const { stepId } = request.params as { stepId: string };
  const body = request.body as Record<string, unknown>;
  const parsed = approvalCreateSchema.parse({ ...body, stepId });
  const approval = await createApproval(pool, parsed);
  reply.code(201);
  return approval;
});

app.get('/v1/steps/:stepId/approvals', async (request, reply) => {
  const { stepId } = request.params as { stepId: string };
  const approvals = await listApprovalsByStep(pool, stepId);
  return approvals;
});

// ========================================================================
// Comments
// ========================================================================

app.post('/v1/comments', async (request, reply) => {
  const parsed = commentCreateSchema.parse(request.body);
  const comment = await createComment(pool, parsed);
  reply.code(201);
  return comment;
});

app.get('/v1/cards/:cardId/comments', async (request, reply) => {
  const { cardId } = request.params as { cardId: string };
  const comments = await listCommentsByCard(pool, cardId);
  return comments;
});

// ========================================================================
// Workflow Definitions
// ========================================================================

app.post('/v1/workflow-definitions', async (request, reply) => {
  const { marketplaceSchema } = await import('@cardflow/core');
  const { marketplace, version, config, active } = request.body as Record<string, unknown>;
  marketplaceSchema.parse(marketplace);
  const wf = await upsertWorkflowDefinition(pool, {
    marketplace: marketplace as string,
    version: (version as number) ?? 1,
    config: config as Array<{ type: string; position: number; requiresApproval: boolean; allowedRetries: number; inheritFrom?: string | null }>,
    active: active !== false,
  });
  reply.code(201);
  return wf;
});

app.get('/v1/workflow-definitions/:marketplace/active', async (request, reply) => {
  const { marketplace } = request.params as { marketplace: string };
  const wf = await getActiveWorkflowDefinition(pool, marketplace);
  if (!wf) {
    reply.code(404);
    return { error: `no active workflow for ${marketplace}` };
  }
  return wf;
});

// ========================================================================
// Step 0 — Input Ingestion & Validation
// ========================================================================

/** Analyse image buffer and return metadata + quality risks */
async function analyseImage(
  buffer: Buffer,
  filename: string,
  marketplaces: string[],
): Promise<{ info: Record<string, unknown>; risks: Array<Record<string, unknown>> }> {
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const byteSize = buffer.length;

  // Get image dimensions via Buffer header parsing (minimal — no sharp dep needed)
  // For a proper implementation you'd use `sharp`, but for the foundation we use
  // a lightweight approach: read JPEG/PNG headers manually, or store unknowns.
  let width = 0;
  let height = 0;
  let mimeType = 'application/octet-stream';

  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') {
    mimeType = 'image/jpeg';
    // Read JPEG SOF0 marker for dimensions
    const dims = readJpegDimensions(buffer);
    width = dims?.width ?? 0;
    height = dims?.height ?? 0;
  } else if (ext === 'png') {
    mimeType = 'image/png';
    // PNG: IHDR chunk at offset 8, width (4 bytes), height (4 bytes)
    if (buffer.length >= 24 && buffer[0] === 0x89 && buffer.toString('ascii', 1, 4) === 'PNG') {
      width = buffer.readUInt32BE(16);
      height = buffer.readUInt32BE(20);
    }
  } else if (ext === 'webp') {
    mimeType = 'image/webp';
    // VP8/VP8L header — simplified
    if (buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF') {
      const vp8Offset = buffer.indexOf('VP8 ');
      if (vp8Offset >= 0 && vp8Offset + 10 < buffer.length) {
        width = buffer.readUInt16LE(vp8Offset + 6) & 0x3FFF;
        height = buffer.readUInt16LE(vp8Offset + 8) & 0x3FFF;
      }
    }
  } else if (ext === 'heic' || ext === 'heif') {
    mimeType = 'image/heic';
  }

  const rules = getMergedRules(marketplaces);
  const maxSizeBytes = rules.maxFileSizeMb * 1024 * 1024;
  const risks: Array<Record<string, unknown>> = [];

  if (byteSize > maxSizeBytes) {
    risks.push({ code: 'oversized_file', severity: 'blocker', detail: `File is ${(byteSize / 1024 / 1024).toFixed(1)} MB, limit is ${rules.maxFileSizeMb} MB` });
  }
  if (width > 0 && width < rules.minImageSize) {
    risks.push({ code: 'low_resolution', severity: 'blocker', detail: `Image width ${width}px is below minimum ${rules.minImageSize}px` });
  }
  if (height > 0 && height < rules.minImageSize) {
    risks.push({ code: 'low_resolution', severity: 'blocker', detail: `Image height ${height}px is below minimum ${rules.minImageSize}px` });
  }
  if (!rules.acceptedMimeTypes.includes(mimeType as typeof rules.acceptedMimeTypes[number])) {
    risks.push({ code: 'unsupported_format', severity: 'blocker', detail: `Format ${mimeType} not accepted. Accepted: ${rules.acceptedMimeTypes.join(', ')}` });
  }
  if (width > 0 && height > 0 && (width / height > 10 || height / width > 10)) {
    risks.push({ code: 'aspect_ratio_extreme', severity: 'warning', detail: `Aspect ratio ${width}:${height} is extreme` });
  }

  // Watermark detection: check for common watermark text patterns in JPEG/PNG
  if (mimeType === 'image/jpeg' || mimeType === 'image/png') {
    const watermarkPatterns = ['watermark', 'sample', '©', 'shutterstock', 'istock', 'depositphotos', 'dreamstime'];
    const textContent = buffer.toString('ascii').toLowerCase();
    for (const pattern of watermarkPatterns) {
      if (textContent.includes(pattern)) {
        risks.push({ code: 'watermark_detected', severity: 'warning', detail: `Possible watermark detected: "${pattern}" found in image data` });
        break;
      }
    }
  }

  // Missing background info: warn if image is very small (likely a thumbnail/placeholder)
  if (width > 0 && height > 0 && width < 500 && height < 500) {
    risks.push({ code: 'missing_background_info', severity: 'warning', detail: `Image dimensions ${width}x${height}px suggest a thumbnail — main product photo should be high resolution` });
  }

  return {
    info: { width, height, mimeType, byteSize, sha256, filename },
    risks,
  };
}

/** Minimal JPEG SOF0 dimension reader */
function readJpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  try {
    // Start after SOI (0xFFD8)
    let offset = 2;
    while (offset < buffer.length - 1) {
      if (buffer[offset] !== 0xFF) { offset++; continue; }
      const marker = buffer[offset + 1];
      // SOF0 = 0xC0, SOF1 = 0xC1, SOF2 = 0xC2
      if (marker >= 0xC0 && marker <= 0xC2 && offset + 9 < buffer.length) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }
      // Skip segment
      if (marker !== 0xFF && marker !== 0x00 && marker !== 0xD8 && marker !== 0xD9) {
        const segLen = buffer.readUInt16BE(offset + 2);
        offset += 2 + segLen;
      } else {
        offset += 2;
      }
    }
  } catch {
    // fall through
  }
  return null;
}

/** Infer category and key attributes from the brief text (rule-based) */
function inferCategory(brief: string): Array<{ key: string; value: string; confidence: number; source: 'rule' }> {
  const lower = brief.toLowerCase();
  const attributes: Array<{ key: string; value: string; confidence: number; source: 'rule' }> = [];

  const categoryKeywords: Array<{ value: string; keywords: string[] }> = [
    { value: 'clothing', keywords: ['одежд', 'cloth', 'футболк', 'shirt', 'плать', 'dress', 'брюк', 'pant', 'куртк', 'jacket', 'свитер', 'sweater', 'худи', 'hoodie', 'рубашк', 'blouse', 'блузк', 'юбк', 'skirt', 'пальто', 'coat', 'жилет', 'vest'] },
    { value: 'footwear', keywords: ['обув', 'shoe', 'ботин', 'boot', 'кроссовк', 'sneaker', 'туфл', 'сандали', 'sandal', 'кед', 'slipper', 'тапочк', 'валенок', 'сапог'] },
    { value: 'electronics', keywords: ['электрон', 'electronic', 'телефон', 'phone', 'наушник', 'headphone', 'зарядк', 'charger', 'кабель', 'cable', 'аккумулятор', 'battery', 'bluetooth', 'usb', 'powerbank', 'колонк', 'speaker'] },
    { value: 'cosmetics', keywords: ['косметик', 'cosmetic', 'крем', 'cream', 'шампун', 'shampoo', 'помад', 'lipstick', 'парфюм', 'perfume', 'тушь', 'mascara', 'тональн', 'foundation', 'пудр', 'powder', 'лак для ногтей', 'nail polish'] },
    { value: 'home_kitchen', keywords: ['кухн', 'kitchen', 'посуд', 'dish', 'кастрюл', 'pot', 'сковород', 'pan', 'домашн', 'home', 'полотенц', 'towel', 'подушк', 'pillow', 'одеял', 'blanket', 'штор', 'curtain'] },
    { value: 'accessories', keywords: ['аксессуар', 'accessory', 'сумк', 'bag', 'час', 'watch', 'очк', 'glasses', 'ремен', 'belt', 'кошел', 'wallet', 'зонт', 'umbrella', 'шарф', 'scarf', 'перчатк', 'glove'] },
    { value: 'toys', keywords: ['игрушк', 'toy', 'детск', 'child', 'конструктор', 'building', 'кукл', 'doll', 'машинк', 'car toy', 'пазл', 'puzzle', 'настольн', 'board game', 'мягк', 'plush'] },
    { value: 'sports', keywords: ['спорт', 'sport', 'тренажер', 'trainer', 'гантел', 'dumbbell', 'коврик', 'mat', 'велосипед', 'bicycle', 'лыж', 'ski', 'бег', 'running', 'йога', 'yoga', 'фитнес', 'fitness'] },
    { value: 'books', keywords: ['книг', 'book', 'учебник', 'textbook', 'тетрад', 'notebook', 'журнал', 'magazine', 'раскраск', 'coloring', 'ежедневник', 'planner'] },
    { value: 'auto', keywords: ['авто', 'auto', 'автомобил', 'car', 'запчаст', 'part', 'шин', 'tire', 'масло моторн', 'motor oil', 'дворник', 'wiper', 'коврик авто', 'car mat'] },
    { value: 'pets', keywords: ['животн', 'pet', 'корм для', 'pet food', 'ошейник', 'collar', 'кошач', 'cat', 'собач', 'dog', 'лежанк', 'pet bed', 'игрушк для', 'pet toy'] },
  ];

  for (const cat of categoryKeywords) {
    for (const keyword of cat.keywords) {
      if (lower.includes(keyword)) {
        attributes.push({ key: 'category', value: cat.value, confidence: 0.4, source: 'rule' });
        break;
      }
    }
  }

  // Infer gender targeting
  if (lower.includes('мужск') || lower.includes('men') || lower.includes('male') || lower.includes('для мужчин') || lower.includes('for men')) {
    attributes.push({ key: 'gender', value: 'male', confidence: 0.5, source: 'rule' });
  } else if (lower.includes('женск') || lower.includes('women') || lower.includes('female') || lower.includes('для женщин') || lower.includes('for women')) {
    attributes.push({ key: 'gender', value: 'female', confidence: 0.5, source: 'rule' });
  } else if (lower.includes('детск') || lower.includes('child') || lower.includes('kids') || lower.includes('baby')) {
    attributes.push({ key: 'gender', value: 'unisex_children', confidence: 0.4, source: 'rule' });
  } else {
    attributes.push({ key: 'gender', value: 'unisex', confidence: 0.3, source: 'rule' });
  }

  // Infer color mentions
  const colorKeywords: Array<{ value: string; keywords: string[] }> = [
    { value: 'black', keywords: ['черн', 'black', 'чёрн'] },
    { value: 'white', keywords: ['бел', 'white'] },
    { value: 'red', keywords: ['красн', 'red'] },
    { value: 'blue', keywords: ['син', 'blue', 'голуб'] },
    { value: 'green', keywords: ['зелен', 'green'] },
    { value: 'pink', keywords: ['розов', 'pink'] },
    { value: 'gray', keywords: ['сер', 'gray', 'grey'] },
    { value: 'beige', keywords: ['бежев', 'beige'] },
  ];
  for (const color of colorKeywords) {
    for (const keyword of color.keywords) {
      if (lower.includes(keyword)) {
        attributes.push({ key: 'color', value: color.value, confidence: 0.5, source: 'rule' });
        break;
      }
    }
  }

  // Infer size mentions
  const sizePatterns = [/\b(xs|s|m|l|xl|xxl|xxxl)\b/i, /\b(размер|size)\s*[:\-]?\s*(\d+)/i];
  for (const pattern of sizePatterns) {
    const match = brief.match(pattern);
    if (match) {
      attributes.push({ key: 'size', value: match[0], confidence: 0.6, source: 'rule' });
      break;
    }
  }

  // Infer material mentions
  const materialKeywords: Array<{ value: string; keywords: string[] }> = [
    { value: 'cotton', keywords: ['хлоп', 'cotton'] },
    { value: 'leather', keywords: ['кож', 'leather'] },
    { value: 'silk', keywords: ['шелк', 'silk'] },
    { value: 'polyester', keywords: ['полиэстер', 'polyester'] },
    { value: 'denim', keywords: ['деним', 'denim', 'джинс'] },
    { value: 'wool', keywords: ['шерст', 'wool'] },
    { value: 'linen', keywords: ['лен', 'linen', 'льн'] },
  ];
  for (const mat of materialKeywords) {
    for (const keyword of mat.keywords) {
      if (lower.includes(keyword)) {
        attributes.push({ key: 'material', value: mat.value, confidence: 0.5, source: 'rule' });
        break;
      }
    }
  }

  return attributes;
}

app.post('/v1/step0/ingest', async (request, reply) => {
  const parsed = step0IngestSchema.parse(request.body);

  const project = await getProject(pool, parsed.projectId);
  if (!project) {
    reply.code(404);
    return { error: 'project not found' };
  }

  const marketplaces = project.marketplaces as string[];
  const rules = getMergedRules(marketplaces);
  const allRisks: Array<Record<string, unknown>> = [];
  const blockingReasons: string[] = [];

  // Decode main image
  const mainBuffer = Buffer.from(parsed.mainImage.contentBase64, 'base64');
  const mainResult = await analyseImage(mainBuffer, parsed.mainImage.filename, marketplaces);
  allRisks.push(...mainResult.risks);

  // Decode additional images
  const additionalInfos: Array<Record<string, unknown>> = [];
  if (parsed.additionalImages.length > rules.maxAdditionalPhotos) {
    blockingReasons.push(`Too many additional photos: ${parsed.additionalImages.length} > ${rules.maxAdditionalPhotos}`);
  }
  for (const img of parsed.additionalImages) {
    const buf = Buffer.from(img.contentBase64, 'base64');
    const result = await analyseImage(buf, img.filename, marketplaces);
    additionalInfos.push(result.info);
    allRisks.push(...result.risks);
  }

  // Decode reference images
  const referenceInfos: Array<Record<string, unknown>> = [];
  if (parsed.referenceImages.length > MAX_REFERENCE_IMAGES) {
    blockingReasons.push(`Too many reference images: ${parsed.referenceImages.length} > ${MAX_REFERENCE_IMAGES}`);
  }
  for (const img of parsed.referenceImages) {
    const buf = Buffer.from(img.contentBase64, 'base64');
    const result = await analyseImage(buf, img.filename, marketplaces);
    referenceInfos.push(result.info);
    allRisks.push(...result.risks);
  }

  // Total image count check
  const totalImages = 1 + parsed.additionalImages.length + parsed.referenceImages.length;
  if (totalImages > MAX_TOTAL_IMAGES) {
    blockingReasons.push(`Total images ${totalImages} exceeds maximum ${MAX_TOTAL_IMAGES}`);
  }

  // Brief check
  if (!parsed.brief || parsed.brief.trim().length < 10) {
    blockingReasons.push('Brief is too short or missing (minimum 10 characters)');
  }

  // Collect blockers from risks
  const isBlocker = (r: Record<string, unknown>) => r.severity === 'blocker';
  for (const risk of allRisks.filter(isBlocker)) {
    blockingReasons.push(risk.detail as string);
  }

  // Deduplicate blocking reasons
  const uniqueBlockers = [...new Set(blockingReasons)];
  const canProceed = uniqueBlockers.length === 0;

  // Infer category from brief (rule-based — AI integration is a later task)
  const inferredCategory = inferCategory(parsed.brief);

  // Upload main image to storage
  const mainAssetKey = `projects/${parsed.projectId}/step0/${crypto.randomUUID()}-${parsed.mainImage.filename}`;
  await storage.putObject({
    key: mainAssetKey,
    content: mainBuffer,
    contentType: mainResult.info.mimeType as string || 'application/octet-stream',
  });

  // Create asset record for main image
  const mainAsset = await createAsset(pool, {
    projectId: parsed.projectId,
    kind: 'source_image',
    filename: parsed.mainImage.filename,
    mimeType: mainResult.info.mimeType as string || 'application/octet-stream',
    byteSize: mainResult.info.byteSize as number,
    sha256: mainResult.info.sha256 as string,
    storageBucket: env.s3Bucket,
    storageKey: mainAssetKey,
    metadata: { role: 'step0_main_image', ...mainResult.info },
  });

  // Upload and persist additional images
  const additionalAssetIds: string[] = [];
  for (let i = 0; i < parsed.additionalImages.length; i++) {
    const img = parsed.additionalImages[i];
    const buf = Buffer.from(img.contentBase64, 'base64');
    const assetKey = `projects/${parsed.projectId}/step0/${crypto.randomUUID()}-${img.filename}`;
    const imgResult = await analyseImage(buf, img.filename, marketplaces);
    await storage.putObject({
      key: assetKey,
      content: buf,
      contentType: imgResult.info.mimeType as string || 'application/octet-stream',
    });
    const asset = await createAsset(pool, {
      projectId: parsed.projectId,
      kind: 'source_image',
      filename: img.filename,
      mimeType: imgResult.info.mimeType as string || 'application/octet-stream',
      byteSize: imgResult.info.byteSize as number,
      sha256: imgResult.info.sha256 as string,
      storageBucket: env.s3Bucket,
      storageKey: assetKey,
      metadata: { role: 'step0_additional_photo', position: i, ...imgResult.info },
    });
    additionalAssetIds.push(asset.id);
  }

  // Upload and persist reference images
  const referenceAssetIds: string[] = [];
  for (let i = 0; i < parsed.referenceImages.length; i++) {
    const img = parsed.referenceImages[i];
    const buf = Buffer.from(img.contentBase64, 'base64');
    const assetKey = `projects/${parsed.projectId}/step0/${crypto.randomUUID()}-${img.filename}`;
    const imgResult = await analyseImage(buf, img.filename, marketplaces);
    await storage.putObject({
      key: assetKey,
      content: buf,
      contentType: imgResult.info.mimeType as string || 'application/octet-stream',
    });
    const asset = await createAsset(pool, {
      projectId: parsed.projectId,
      kind: 'reference_image',
      filename: img.filename,
      mimeType: imgResult.info.mimeType as string || 'application/octet-stream',
      byteSize: imgResult.info.byteSize as number,
      sha256: imgResult.info.sha256 as string,
      storageBucket: env.s3Bucket,
      storageKey: assetKey,
      metadata: { role: 'step0_reference_image', position: i, ...imgResult.info },
    });
    referenceAssetIds.push(asset.id);
  }

  // Create revision for this ingestion
  await createRevision(pool, {
    projectId: parsed.projectId,
    entityType: 'step0_ingestion',
    entityId: mainAsset.id,
    assetId: mainAsset.id,
    note: 'Step 0 input ingestion',
    trace: { brief: parsed.brief, marketplaces, canProceed },
  });

  // Save ingestion record
  const inferredAttributes = inferCategory(parsed.brief);
  const categoryAttr = inferredAttributes.find(a => a.key === 'category') ?? null;
  const ingestion = await upsertStep0Ingestion(pool, {
    projectId: parsed.projectId,
    mainImageId: mainAsset.id,
    brief: parsed.brief,
    inferredCategory: categoryAttr ? categoryAttr.value : null,
    inferredAttributes: inferredAttributes,
    qualityRisks: allRisks as any,
    blockingReasons: uniqueBlockers,
    canProceed,
    status: canProceed ? 'ready' : 'blocked',
    analysisResult: {
      mainImage: mainResult.info,
      additionalImages: additionalInfos,
      referenceImages: referenceInfos,
      brief: parsed.brief,
      inferredCategory: categoryAttr,
      inferredAttributes,
    },
  });

  // Link additional images to ingestion
  for (let i = 0; i < additionalAssetIds.length; i++) {
    await linkIngestionImage(pool, {
      ingestionId: ingestion.id,
      assetId: additionalAssetIds[i],
      role: 'additional_photo',
      position: i,
    });
  }

  // Link reference images to ingestion
  for (let i = 0; i < referenceAssetIds.length; i++) {
    await linkIngestionImage(pool, {
      ingestionId: ingestion.id,
      assetId: referenceAssetIds[i],
      role: 'reference_image',
      position: i,
    });
  }

  // Create validation records for each marketplace
  const validationRecords = [];
  for (const mp of marketplaces) {
    const mpRules = marketplaceUploadRules[mp as keyof typeof marketplaceUploadRules];
    // File size rule
    const maxSizeBytes = mpRules.maxFileSizeMb * 1024 * 1024;
    if ((mainResult.info.byteSize as number) > maxSizeBytes) {
      validationRecords.push({
        marketplace: mp,
        ruleCode: 'file_size_exceeded',
        field: 'mainImage',
        message: `File size ${(mainResult.info.byteSize as number)} exceeds ${mpRules.maxFileSizeMb} MB limit for ${mp}`,
        isBlocking: true,
      });
    }
    // Format rule
    const mainMime = mainResult.info.mimeType as string;
    if (!((mpRules.acceptedMimeTypes as unknown) as readonly string[]).includes(mainMime)) {
      validationRecords.push({
        marketplace: mp,
        ruleCode: 'unsupported_format',
        field: 'mainImage',
        message: `Format ${mainResult.info.mimeType} not accepted by ${mp}`,
        isBlocking: true,
      });
    }
    // Resolution rule
    if ((mainResult.info.width as number) > 0 && (mainResult.info.width as number) < mpRules.minImageSize) {
      validationRecords.push({
        marketplace: mp,
        ruleCode: 'resolution_too_low',
        field: 'mainImage',
        message: `Image width ${mainResult.info.width}px below ${mpRules.minImageSize}px minimum for ${mp}`,
        isBlocking: true,
      });
    }
    // Brief required
    if (!parsed.brief || parsed.brief.trim().length < 10) {
      validationRecords.push({
        marketplace: mp,
        ruleCode: 'brief_too_short',
        field: 'brief',
        message: `Brief must be at least 10 characters for ${mp}`,
        isBlocking: true,
      });
    }
    // Additional photos limit
    if (parsed.additionalImages.length > mpRules.maxAdditionalPhotos) {
      validationRecords.push({
        marketplace: mp,
        ruleCode: 'too_many_additional_photos',
        field: 'additionalImages',
        message: `${parsed.additionalImages.length} additional photos exceeds ${mpRules.maxAdditionalPhotos} limit for ${mp}`,
        isBlocking: true,
      });
    }
  }
  await batchCreateValidationRecords(pool, ingestion.id, validationRecords);

  // Task f99f32fe — Step 0 quality gating decision
  let qualityGating: Record<string, unknown> | null = null;
  if (env.step0QualityEnabled && mainResult.info.width) {
    const qualityResult = analyzeQuality(
      {
        width: mainResult.info.width as number,
        height: mainResult.info.height as number,
        fileSizeBytes: mainResult.info.byteSize as number,
        mimeType: mainResult.info.mimeType as string,
        brief: parsed.brief,
      },
      marketplaces,
    );

    const gatingResult = makeGatingDecision(
      qualityResult.overallScore,
      qualityResult.risks,
      marketplaces,
    );

    qualityGating = {
      overallScore: qualityResult.overallScore,
      gatingDecision: gatingResult.decision,
      reason: gatingResult.reason,
      dimensionScores: qualityResult.dimensionScores,
      risks: qualityResult.risks,
    };

    // Update ingestion with quality gating result
    await pool.query(
      `UPDATE step0_ingestions SET metadata = JSONB_SET(COALESCE(metadata, '{}'::jsonb), '{quality_gating}', $1) WHERE id = $2`,
      [qualityGating, ingestion.id],
    );
  }

  reply.code(201);
  return {
    ingestionId: ingestion.id,
    canProceed,
    blockingReasons: uniqueBlockers,
    qualityRisks: allRisks,
    inferredCategory,
    mainAssetId: mainAsset.id,
    additionalAssetIds,
    referenceAssetIds,
    totalImages,
    qualityGating,
  };
});

app.get('/v1/projects/:projectId/step0', async (request, reply) => {
  const { projectId } = request.params as { projectId: string };
  const ingestion = await getStep0Ingestion(pool, projectId);
  if (!ingestion) {
    reply.code(404);
    return { error: 'no step 0 ingestion found for this project' };
  }
  return ingestion;
});

app.get('/v1/step0/:ingestionId/images', async (request, reply) => {
  const { ingestionId } = request.params as { ingestionId: string };
  const images = await listIngestionImages(pool, ingestionId);
  return { ingestionId, images };
});

app.post('/v1/step0/:ingestionId/additional-images', async (request, reply) => {
  const { ingestionId } = request.params as { ingestionId: string };
  const ingestion = await getStep0Ingestion(pool, '');
  // Look up ingestion by ID — we need to find it via the ingestion table
  const body = request.body as Record<string, unknown>;
  const parsed = step0AdditionalImagesUploadSchema.parse({ ingestionId, images: body.images ?? [] });

  // Fetch the ingestion to get project context
  const projectResult = await pool.query(
    'SELECT p.*, si.id as ingestion_id FROM step0_ingestions si JOIN projects p ON p.id = si.project_id WHERE si.id = $1',
    [parsed.ingestionId],
  );
  if (projectResult.rows.length === 0) {
    reply.code(404);
    return { error: 'ingestion not found' };
  }
  const project = projectResult.rows[0];
  const marketplaces = project.marketplaces as string[];
  const rules = getMergedRules(marketplaces);

  // Check current additional image count
  const existingImages = await listIngestionImages(pool, parsed.ingestionId);
  const existingAdditional = existingImages.filter((img: { role: string }) => img.role === 'additional_photo');
  const totalCount = existingAdditional.length + parsed.images.length;
  if (totalCount > rules.maxAdditionalPhotos) {
    reply.code(400);
    return { error: `Too many additional photos: ${totalCount} would exceed ${rules.maxAdditionalPhotos} limit` };
  }

  const uploadedAssets: string[] = [];
  for (let i = 0; i < parsed.images.length; i++) {
    const img = parsed.images[i];
    const buf = Buffer.from(img.contentBase64, 'base64');
    const result = await analyseImage(buf, img.filename, marketplaces);

    const assetKey = `projects/${project.id}/step0/${crypto.randomUUID()}-${img.filename}`;
    await storage.putObject({
      key: assetKey,
      content: buf,
      contentType: result.info.mimeType as string || 'application/octet-stream',
    });

    const asset = await createAsset(pool, {
      projectId: project.id,
      kind: 'source_image',
      filename: img.filename,
      mimeType: result.info.mimeType as string || 'application/octet-stream',
      byteSize: result.info.byteSize as number,
      sha256: result.info.sha256 as string,
      storageBucket: env.s3Bucket,
      storageKey: assetKey,
      metadata: { role: 'step0_additional_photo', position: existingAdditional.length + i, ...result.info },
    });

    await linkIngestionImage(pool, {
      ingestionId: parsed.ingestionId,
      assetId: asset.id,
      role: 'additional_photo',
      position: existingAdditional.length + i,
    });

    uploadedAssets.push(asset.id);
  }

  reply.code(201);
  return { ingestionId: parsed.ingestionId, uploadedAssets };
});

app.post('/v1/step0/:ingestionId/reference-images', async (request, reply) => {
  const { ingestionId } = request.params as { ingestionId: string };
  const body = request.body as Record<string, unknown>;
  const parsed = step0ReferenceImagesUploadSchema.parse({ ingestionId, images: body.images ?? [] });

  const projectResult = await pool.query(
    'SELECT p.*, si.id as ingestion_id FROM step0_ingestions si JOIN projects p ON p.id = si.project_id WHERE si.id = $1',
    [parsed.ingestionId],
  );
  if (projectResult.rows.length === 0) {
    reply.code(404);
    return { error: 'ingestion not found' };
  }
  const project = projectResult.rows[0];
  const marketplaces = project.marketplaces as string[];

  const existingImages = await listIngestionImages(pool, parsed.ingestionId);
  const existingReference = existingImages.filter((img: { role: string }) => img.role === 'reference_image');
  const totalCount = existingReference.length + parsed.images.length;
  if (totalCount > MAX_REFERENCE_IMAGES) {
    reply.code(400);
    return { error: `Too many reference images: ${totalCount} would exceed ${MAX_REFERENCE_IMAGES} limit` };
  }

  const uploadedAssets: string[] = [];
  for (let i = 0; i < parsed.images.length; i++) {
    const img = parsed.images[i];
    const buf = Buffer.from(img.contentBase64, 'base64');
    const result = await analyseImage(buf, img.filename, marketplaces);

    const assetKey = `projects/${project.id}/step0/${crypto.randomUUID()}-${img.filename}`;
    await storage.putObject({
      key: assetKey,
      content: buf,
      contentType: result.info.mimeType as string || 'application/octet-stream',
    });

    const asset = await createAsset(pool, {
      projectId: project.id,
      kind: 'reference_image',
      filename: img.filename,
      mimeType: result.info.mimeType as string || 'application/octet-stream',
      byteSize: result.info.byteSize as number,
      sha256: result.info.sha256 as string,
      storageBucket: env.s3Bucket,
      storageKey: assetKey,
      metadata: { role: 'step0_reference_image', position: existingReference.length + i, ...result.info },
    });

    await linkIngestionImage(pool, {
      ingestionId: parsed.ingestionId,
      assetId: asset.id,
      role: 'reference_image',
      position: existingReference.length + i,
    });

    uploadedAssets.push(asset.id);
  }

  reply.code(201);
  return { ingestionId: parsed.ingestionId, uploadedAssets };
});

app.get('/v1/step0/:ingestionId/validation', async (request, reply) => {
  const { ingestionId } = request.params as { ingestionId: string };
  const records = await listValidationRecords(pool, ingestionId);
  const blockingCodes = records.filter((r: { is_blocking: boolean }) => r.is_blocking).map((r: { rule_code: string }) => r.rule_code);
  const warningCodes = records.filter((r: { is_blocking: boolean }) => !r.is_blocking).map((r: { rule_code: string }) => r.rule_code);
  return {
    ingestionId,
    canApprove: blockingCodes.length === 0,
    rules: records,
    blockingCodes,
    warningCodes,
  };
});

app.post('/v1/step0/:ingestionId/approve', async (request, reply) => {
  const { ingestionId } = request.params as { ingestionId: string };
  const parsed = step0ApprovalSchema.parse({ ingestionId, ...(request.body as Record<string, unknown>) });

  const projectResult = await pool.query(
    'SELECT p.*, si.id as ingestion_id, si.can_proceed, si.blocking_reasons, si.status FROM step0_ingestions si JOIN projects p ON p.id = si.project_id WHERE si.id = $1',
    [parsed.ingestionId],
  );
  if (projectResult.rows.length === 0) {
    reply.code(404);
    return { error: 'ingestion not found' };
  }
  const row = projectResult.rows[0];

  if (!parsed.force && !row.can_proceed) {
    reply.code(400);
    return {
      error: 'cannot approve: ingestion has blocking issues',
      blockingReasons: row.blocking_reasons,
      hint: 'use force=true to override',
    };
  }

  const updated = await pool.query(
    `UPDATE step0_ingestions SET status = 'ready', can_proceed = true, updated_at = now() WHERE id = $1 RETURNING *`,
    [parsed.ingestionId],
  );

  reply.code(200);
  return { ingestionId: parsed.ingestionId, approved: true, forced: parsed.force, ingestion: updated.rows[0] };
});

// ========================================================================
// Project Card Initialization
// ========================================================================

app.post('/v1/projects/:projectId/init-cards', async (request, reply) => {
  const { projectId } = request.params as { projectId: string };
  const body = request.body as Record<string, unknown>;
  const parsed = projectCardInitSchema.parse({ projectId, ...body });
  const result = await initializeDefaultCards(pool, parsed);
  if ((result as any).error) {
    reply.code(400);
    return result;
  }
  reply.code(201);
  return result;
});

// ========================================================================
// Workflow State (aggregate load)
// ========================================================================

app.get('/v1/cards/:cardId/workflow-state', async (request, reply) => {
  const { cardId } = request.params as { cardId: string };
  const state = await loadWorkflowState(pool, cardId);
  if (!state) {
    reply.code(404);
    return { error: 'card not found' };
  }
  return state;
});

// ========================================================================
// Step Inheritance
// ========================================================================

app.post('/v1/steps/:stepId/inherit', async (request, reply) => {
  const { stepId } = request.params as { stepId: string };
  const body = request.body as Record<string, unknown>;
  const parsed = stepInheritSchema.parse({ targetStepId: stepId, ...body });
  const result = await inheritStepResult(pool, parsed);
  if ((result as any).error) {
    reply.code(400);
    return result;
  }
  return result;
});

// ========================================================================
// Revision History
// ========================================================================

app.get('/v1/entities/:entityType/:entityId/revisions', async (request, reply) => {
  const { entityType, entityId } = request.params as { entityType: string; entityId: string };
  const { branchName, limit } = request.query as { branchName?: string; limit?: string };
  const parsed = revisionQuerySchema.parse({
    entityType,
    entityId,
    branchName: branchName ?? 'main',
    limit: limit ? Number(limit) : 50,
  });
  const revisions = await getRevisionHistory(pool, parsed);
  return revisions;
});

// Create a new revision with full provenance trail
app.post('/v1/entities/:entityType/:entityId/revisions', async (request, reply) => {
  const { entityType, entityId } = request.params as { entityType: string; entityId: string };
  const body = request.body as Record<string, unknown>;
  const revision = await createRevisionWithTrace(pool, {
    projectId: body.projectId as string,
    entityType,
    entityId,
    branchName: (body.branchName as string) ?? 'main',
    assetId: (body.assetId as string) ?? null,
    jobId: (body.jobId as string) ?? null,
    note: (body.note as string) ?? null,
    trace: (body.trace as Record<string, unknown>) ?? {},
    workflowVersion: (body.workflowVersion as string) ?? null,
    promptVersion: (body.promptVersion as string) ?? null,
    modelId: (body.modelId as string) ?? null,
    seed: (body.seed as number) ?? null,
    referenceHashes: (body.referenceHashes as string[]) ?? [],
  });
  reply.code(201);
  return revision;
});

// ========================================================================
// Marketplace Selection Update
// ========================================================================

app.patch('/v1/projects/:projectId/marketplaces', async (request, reply) => {
  const { projectId } = request.params as { projectId: string };
  const parsed = marketplaceUpdateSchema.parse(request.body);
  const project = await getProject(pool, projectId);
  if (!project) {
    reply.code(404);
    return { error: 'project not found' };
  }
  const updated = await updateProjectMarketplaces(pool, projectId, parsed);
  return updated;
});

// ========================================================================
// Default Card Count Update
// ========================================================================

app.patch('/v1/projects/:projectId/default-card-count', async (request, reply) => {
  const { projectId } = request.params as { projectId: string };
  const parsed = defaultCardCountUpdateSchema.parse(request.body);
  const project = await getProject(pool, projectId);
  if (!project) {
    reply.code(404);
    return { error: 'project not found' };
  }
  const updated = await updateDefaultCardCount(pool, projectId, parsed);
  return updated;
});

// ========================================================================
// Staged Async Generation Core (task 179ad31e)
// ========================================================================

app.post('/v1/generation-jobs', async (request, reply) => {
  const parsed = generationJobCreateSchema.parse(request.body);
  const job = await createGenerationJob(pool, parsed);
  
  // Enqueue in BullMQ for async processing
  await queue.add(queueName, {
    type: 'generation.execute',
    generationId: job.id,
    stage: job.stage,
    cardId: job.card_id,
    provider: job.provider,
  }, {
    jobId: `gen-${job.id}`,
    attempts: 3,
    removeOnComplete: 100,
    removeOnFail: 100,
  });
  
  reply.code(201);
  return job;
});

app.get('/v1/generation-jobs/:jobId', async (request, reply) => {
  const { jobId } = request.params as { jobId: string };
  const job = await getGenerationJob(pool, jobId);
  if (!job) {
    reply.code(404);
    return { error: 'generation job not found' };
  }
  return job;
});

app.get('/v1/projects/:projectId/generation-jobs', async (request, reply) => {
  const { projectId } = request.params as { projectId: string };
  const jobs = await listGenerationJobsByProject(pool, projectId);
  return jobs;
});

app.get('/v1/cards/:cardId/generation-jobs', async (request, reply) => {
  const { cardId } = request.params as { cardId: string };
  const jobs = await listGenerationJobsByCard(pool, cardId);
  return jobs;
});

app.patch('/v1/generation-jobs/:jobId/status', async (request, reply) => {
  const { jobId } = request.params as { jobId: string };
  const body = request.body as Record<string, unknown>;
  const status = body.status as string;
  if (!status || !['queued', 'processing', 'completed', 'failed', 'cancelled'].includes(status)) {
    reply.code(400);
    return { error: 'invalid status' };
  }
  const outputData = body.outputData ?? null;
  const error = body.error ?? null;
  const job = await updateGenerationJobStatus(pool, jobId, status, outputData as Record<string, unknown>, error as string);
  if (!job) {
    reply.code(404);
    return { error: 'generation job not found' };
  }
  return job;
});

app.post('/v1/generation-jobs/:jobId/cancel', async (request, reply) => {
  const { jobId } = request.params as { jobId: string };
  const job = await cancelGenerationJob(pool, jobId);
  if (!job) {
    reply.code(404);
    return { error: 'generation job not found' };
  }
  return job;
});

app.post('/v1/generation-outputs', async (request, reply) => {
  const parsed = generationOutputCreateSchema.parse(request.body);
  const output = await createGenerationOutput(pool, parsed);
  reply.code(201);
  return output;
});

app.get('/v1/generation-jobs/:jobId/outputs', async (request, reply) => {
  const { jobId } = request.params as { jobId: string };
  const outputs = await listGenerationOutputs(pool, jobId);
  return outputs;
});

app.post('/v1/projects/:projectId/generation-batch', async (request, reply) => {
  const { projectId } = request.params as { projectId: string };
  const body = request.body as Record<string, unknown>;
  const { stage, cardIds, provider, model, seed, prompt, inputData, parentGenerationId } = body;
  
  if (!stage || !Array.isArray(cardIds) || cardIds.length === 0) {
    reply.code(400);
    return { error: 'stage and cardIds required' };
  }
  
  const batchId = crypto.randomUUID();
  const jobs = await createBatchGenerationJobs(
    pool,
    projectId,
    stage as string,
    cardIds as string[],
    batchId,
    provider as string | null,
    model as string | null,
    seed as number | null,
    prompt as string | null,
    inputData as Record<string, unknown> | null,
    parentGenerationId as string | null,
  );
  
  // Enqueue all jobs
  for (const job of jobs) {
    await queue.add(queueName, {
      type: 'generation.execute',
      generationId: job.id,
      stage: job.stage,
      cardId: job.card_id,
      batchId,
      provider: job.provider,
    }, {
      jobId: `gen-${job.id}`,
      attempts: 3,
      removeOnComplete: 100,
      removeOnFail: 100,
    });
  }
  
  reply.code(201);
  return { batchId, jobs: jobs.map((j: { id: string }) => j.id) };
});

app.get('/v1/cards/:cardId/upstream-approved-data', async (request, reply) => {
  const { cardId } = request.params as { cardId: string };
  const { stage } = request.query as { stage: string };
  if (!stage) {
    reply.code(400);
    return { error: 'stage query param required' };
  }
  const data = await getUpstreamApprovedData(pool, cardId, stage);
  return data;
});

// Task 3f40bd18 — Compliance Engine
// ========================================================================

app.get('/v1/compliance-rules', async (request, reply) => {
  const { markets } = request.query as { markets?: string };
  const marketplaces = markets ? markets.split(',').map(m => m.trim()) : ['wildberries'];
  const rules = await getActiveComplianceRules(pool, marketplaces);
  return rules;
});

app.post('/v1/compliance/validate', async (request, reply) => {
  const body = request.body as Record<string, unknown>;
  const parsed = complianceValidationSchema.parse({
    projectId: body.projectId,
    cardId: (body.cardId as string) ?? null,
    stepId: (body.stepId as string) ?? null,
    status: body.status,
    complianceScore: body.complianceScore,
    criticalFailures: body.criticalFailures,
    warnings: body.warnings,
    ruleResults: (body.ruleResults as Array<Record<string, unknown>>) ?? [],
    report: (body.report as string) ?? null,
  });
  const validation = await createComplianceValidation(pool, {
    projectId: parsed.projectId,
    cardId: parsed.cardId ?? null,
    stepId: parsed.stepId ?? null,
    status: parsed.status,
    complianceScore: parsed.complianceScore,
    criticalFailures: parsed.criticalFailures,
    warnings: parsed.warnings,
    ruleResults: parsed.ruleResults as Array<Record<string, unknown>>,
    report: parsed.report ?? null,
  });
  reply.code(201);
  return validation;
});

app.get('/v1/projects/:projectId/compliance', async (request, reply) => {
  const { projectId } = request.params as { projectId: string };
  return listComplianceValidationsByProject(pool, projectId);
});

app.get('/v1/cards/:cardId/compliance', async (request, reply) => {
  const { cardId } = request.params as { cardId: string };
  return listComplianceValidationsByCard(pool, cardId);
});

app.get('/v1/projects/:projectId/export-status', async (request, reply) => {
  const { projectId } = request.params as { projectId: string };
  const project = await getProject(pool, projectId);
  if (!project) {
    reply.code(404);
    return { error: 'project not found' };
  }
  return {
    projectId,
    exportBlocked: project.export_blocked ?? false,
    complianceScore: project.last_compliance_score,
  };
});

app.post('/v1/projects/:projectId/export-block', async (request, reply) => {
  const { projectId } = request.params as { projectId: string };
  const payload = request.body as { blocked?: boolean };
  return updateProjectExportBlock(pool, projectId, payload.blocked ?? true);
});

// ========================================================================
// Task d4118303 — Compliance validation engine endpoints
// ========================================================================

app.post('/v1/compliance/validate-step0', async (request, reply) => {
  const { projectId, inputText, metadata } = request.body as {
    projectId: string;
    inputText: string;
    metadata?: Record<string, unknown>;
  };

  const project = await getProject(pool, projectId);
  if (!project) {
    reply.code(404);
    return { error: 'project not found' };
  }

  const marketplaces = project.marketplaces as string[];
  const rules = getAllDefaultRules().filter((r) => marketplaces.includes(r.marketplace));
  const validator = new ComplianceValidator(rules);

  const complianceInput: ComplianceInput = {
    inputText: inputText ?? '',
    metadata: metadata ?? {},
    marketplaces,
  };

  const ruleResults = validator.validate(complianceInput);
  const report = buildComplianceReport(ruleResults, marketplaces);

  // Persist the validation
  const validation = await createComplianceValidation(pool, {
    projectId,
    cardId: null,
    stepId: null,
    status: report.status,
    complianceScore: report.score,
    criticalFailures: report.criticalFailures,
    warnings: report.warnings,
    ruleResults: ruleResults as Array<Record<string, unknown>>,
    report: report.messages.join('\n'),
  });

  // Update project export block if critical failures
  if (report.criticalFailures > 0) {
    await updateProjectExportBlock(pool, projectId, true);
  }

  reply.code(201);
  return { ...report, validationId: validation.id };
});

app.post('/v1/compliance/validate-card', async (request, reply) => {
  const { cardId, inputText, metadata } = request.body as {
    cardId: string;
    inputText?: string;
    metadata?: Record<string, unknown>;
  };

  const card = await getCard(pool, cardId);
  if (!card) {
    reply.code(404);
    return { error: 'card not found' };
  }

  const project = await getProject(pool, card.project_id);
  if (!project) {
    reply.code(404);
    return { error: 'project not found' };
  }

  const marketplaces = project.marketplaces as string[];
  const rules = getAllDefaultRules().filter((r) => marketplaces.includes(r.marketplace));
  const validator = new ComplianceValidator(rules);

  // Include card count in validation if it's in the project
  const projectCards = await listCardsByProject(pool, project.id);
  const cardCountResult = validateCardCount(projectCards.length, marketplaces);

  const complianceInput: ComplianceInput = {
    inputText: inputText ?? (card.brief ?? ''),
    metadata: { ...metadata, cardNumber: card.card_number, ...card.metadata },
    marketplaces,
  };

  const ruleResults = validator.validate(complianceInput);

  // Add card count result
  ruleResults.push(cardCountResult);

  const report = buildComplianceReport(ruleResults, marketplaces);

  const validation = await createComplianceValidation(pool, {
    projectId: project.id,
    cardId,
    stepId: null,
    status: report.status,
    complianceScore: report.score,
    criticalFailures: report.criticalFailures,
    warnings: report.warnings,
    ruleResults: ruleResults as Array<Record<string, unknown>>,
    report: report.messages.join('\n'),
  });

  if (report.criticalFailures > 0) {
    await updateProjectExportBlock(pool, project.id, true);
  }

  reply.code(201);
  return { ...report, validationId: validation.id };
});

app.post('/v1/compliance/validate-card-count', async (request, reply) => {
  const { projectId, cardCount } = request.body as {
    projectId: string;
    cardCount: number;
  };

  const project = await getProject(pool, projectId);
  if (!project) {
    reply.code(404);
    return { error: 'project not found' };
  }

  const marketplaces = project.marketplaces as string[];
  const result = validateCardCount(cardCount, marketplaces);

  reply.code(result.severity === 'critical' ? 422 : 200);
  return result;
});

// ========================================================================
// Task ca05a06d — Quality-risk scoring and Step 0 gating
// ========================================================================

app.post('/v1/quality/analyze', async (request, reply) => {
  const { imageMetadata, marketplaces, mainImage } = request.body as {
    imageMetadata?: {
      width?: number;
      height?: number;
      fileSizeBytes?: number;
      mimeType?: string;
      brightness?: number;
    };
    marketplaces?: string[];
    mainImage?: {
      contentBase64?: string;
      filename?: string;
    };
  };

  const mp = marketplaces ?? ['wildberries'];
  const width = imageMetadata?.width ?? 0;
  const height = imageMetadata?.height ?? 0;
  const fileSizeBytes = imageMetadata?.fileSizeBytes ?? 0;
  const mimeType = imageMetadata?.mimeType ?? '';
  const brightness = imageMetadata?.brightness;

  const qualityResult = analyzeQuality(
    { width, height, fileSizeBytes, mimeType, brightness },
    mp,
  );

  const gatingResult = makeGatingDecision(
    qualityResult.overallScore,
    qualityResult.risks,
    mp,
  );

  reply.code(gatingResult.decision === 'blocked' ? 422 : 200);
  return {
    ...qualityResult,
    gatingResult,
    report: generateQualityReport(qualityResult, mp),
  };
});

// ========================================================================
// Task cbb08985 — Billing endpoints
// ========================================================================

app.get('/v1/billing/:projectId', async (request, reply) => {
  const { projectId } = request.params as { projectId: string };
  const subscription = await getSubscriptionByProject(pool, projectId);
  if (!subscription) {
    reply.code(404);
    return { error: 'No subscription configured' };
  }
  const balance = await getCreditBalance(pool, subscription.id);
  const consumed = await getCreditsUsed(pool, subscription.id);
  return { subscription, balance, consumed };
});

app.get('/v1/billing/:projectId/ledger', async (request, reply) => {
  const { projectId } = request.params as { projectId: string };
  const { limit, offset } = request.query as { limit?: string; offset?: string };
  const subscription = await getSubscriptionByProject(pool, projectId);
  if (!subscription) { reply.code(404); return { error: 'No subscription' }; }
  const entries = await getLedgerEntries(
    pool,
    subscription.id,
    Number(limit) || 100,
    Number(offset) || 0,
  );
  return { projectId, ledger: entries };
});

app.post('/v1/billing/:projectId/subscription', async (request, reply) => {
  const { projectId } = request.params as { projectId: string };
  const body = request.body as Record<string, unknown>;
  const existing = await getSubscriptionByProject(pool, projectId);
  if (existing) { reply.code(409); return { error: 'Subscription exists', subscription: existing }; }
  const subscription = await createSubscription(pool, {
    projectId,
    plan: (body.plan as string) ?? 'free',
    creditsPerPeriod: (body.creditsPerPeriod as number) ?? 20,
  });
  reply.code(201);
  return subscription;
});

app.post('/v1/billing/:projectId/upgrade', async (request, reply) => {
  const { projectId } = request.params as { projectId: string };
  const { plan } = request.body as { plan: string };
  if (!plan) { reply.code(400); return { error: 'Plan required' }; }
  const subscription = await getSubscriptionByProject(pool, projectId);
  if (!subscription) { reply.code(404); return { error: 'No subscription' }; }
  const credits = getCreditsForPlan(plan as any);
  const updated = await upgradeSubscription(pool, subscription.id, plan, credits);
  await recordCreditTransaction(pool, {
    subscriptionId: subscription.id,
    type: 'purchase',
    amount: credits,
    reference: `upgrade to ${plan}`,
  });
  return updated;
});

app.post('/v1/billing/:projectId/grant', async (request, reply) => {
  const { projectId } = request.params as { projectId: string };
  const { amount, reason } = request.body as { amount: number; reason: string };
  if (!amount || amount <= 0) { reply.code(400); return { error: 'Positive amount required' }; }
  const subscription = await getSubscriptionByProject(pool, projectId);
  if (!subscription) { reply.code(404); return { error: 'No subscription' }; }
  const entry = await recordCreditTransaction(pool, {
    subscriptionId: subscription.id,
    type: 'grant',
    amount,
    reference: reason,
  });
  return entry;
});

// Seed compliance rules on startup
await seedComplianceRules(pool, getAllDefaultRules());

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

