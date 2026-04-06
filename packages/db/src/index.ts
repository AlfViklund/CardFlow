import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, type PoolClient } from 'pg';
import { defaultCardCount, slugify, defaultWorkflowSteps, stepInheritanceRules, allowedInheritSource } from '@cardflow/core';
import type {
  CardCreateInput,
  StepCreateInput,
  ApprovalCreateInput,
  CommentCreateInput,
  WorkflowStepDef,
  StepInheritInput,
  ProjectCardInitInput,
  RevisionQueryInput,
  MarketplaceUpdateInput,
  DefaultCardCountUpdateInput,
} from '@cardflow/core';
import type {
  ComplianceRuleInput,
} from '@cardflow/core';
import type { QualityRisk } from '@cardflow/core';
import type {
  GenerationJobCreateInput,
  GenerationOutputCreateInput,
} from '@cardflow/core';

export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString, max: 10 });
}

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

export async function runMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureMigrationsTable(client);

    const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
    const migrationFiles = (await fs.readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
    const applied = new Set(
      (await client.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version')).rows.map(
        (row: { version: string }) => row.version,
      ),
    );

    for (const fileName of migrationFiles) {
      if (applied.has(fileName)) continue;
      const sql = await fs.readFile(path.join(migrationsDir, fileName), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [fileName]);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function healthCheck(pool: Pool): Promise<void> {
  await pool.query('SELECT 1');
}

export async function createProject(
  pool: Pool,
  input: {
    name: string;
    brief: string;
    marketplaces: string[];
    defaultCardCount?: number;
    metadata?: Record<string, unknown>;
  },
) {
  const baseSlug = slugify(input.name) || 'project';
  let slug = baseSlug;
  for (let i = 0; i < 5; i += 1) {
    const existing = await pool.query('SELECT 1 FROM projects WHERE slug = $1', [slug]);
    if (existing.rowCount === 0) break;
    slug = `${baseSlug}-${i + 2}`;
  }

  const result = await pool.query(
    `INSERT INTO projects (name, slug, brief, marketplaces, default_card_count, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.name,
      slug,
      input.brief ?? '',
      input.marketplaces,
      input.defaultCardCount ?? defaultCardCount,
      input.metadata ?? {},
    ],
  );
  return result.rows[0];
}

export async function listProjects(pool: Pool) {
  const result = await pool.query('SELECT * FROM projects ORDER BY created_at DESC');
  return result.rows;
}

export async function getProject(pool: Pool, projectId: string) {
  const result = await pool.query('SELECT * FROM projects WHERE id = $1', [projectId]);
  return result.rows[0] ?? null;
}

export async function createJob(
  pool: Pool,
  input: {
    projectId: string;
    queueName: string;
    type: string;
    payload?: Record<string, unknown>;
  },
) {
  const result = await pool.query(
    `INSERT INTO jobs (project_id, queue_name, type, payload)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [input.projectId, input.queueName, input.type, input.payload ?? {}],
  );
  return result.rows[0];
}

export async function updateJob(
  pool: Pool,
  jobId: string,
  patch: {
    status?: string;
    result?: Record<string, unknown> | null;
    error?: string | null;
    attempts?: number;
    startedAt?: string | null;
    finishedAt?: string | null;
  },
) {
  const result = await pool.query(
    `UPDATE jobs
     SET status = COALESCE($2, status),
         result = COALESCE($3, result),
         error = COALESCE($4, error),
         attempts = COALESCE($5, attempts),
         started_at = COALESCE($6, started_at),
         finished_at = COALESCE($7, finished_at),
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      jobId,
      patch.status ?? null,
      patch.result ?? null,
      patch.error ?? null,
      patch.attempts ?? null,
      patch.startedAt ?? null,
      patch.finishedAt ?? null,
    ],
  );
  return result.rows[0] ?? null;
}

export async function getJob(pool: Pool, jobId: string) {
  const result = await pool.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  return result.rows[0] ?? null;
}

export async function createAsset(
  pool: Pool,
  input: {
    projectId: string;
    kind: string;
    filename: string;
    mimeType: string;
    byteSize: number;
    sha256: string;
    storageBucket: string;
    storageKey: string;
    metadata?: Record<string, unknown>;
  },
) {
  const result = await pool.query(
    `INSERT INTO assets (project_id, kind, filename, mime_type, byte_size, sha256, storage_bucket, storage_key, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      input.projectId,
      input.kind,
      input.filename,
      input.mimeType,
      input.byteSize,
      input.sha256,
      input.storageBucket,
      input.storageKey,
      input.metadata ?? {},
    ],
  );
  return result.rows[0];
}

export async function getAsset(pool: Pool, assetId: string) {
  const result = await pool.query('SELECT * FROM assets WHERE id = $1', [assetId]);
  return result.rows[0] ?? null;
}

export async function createTraceEvent(
  pool: Pool,
  input: {
    traceId: string;
    entityType: string;
    entityId?: string | null;
    eventType: string;
    payload?: Record<string, unknown>;
  },
) {
  const result = await pool.query(
    `INSERT INTO trace_events (trace_id, entity_type, entity_id, event_type, payload)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [input.traceId, input.entityType, input.entityId ?? null, input.eventType, input.payload ?? {}],
  );
  return result.rows[0];
}

export async function nextRevisionVersion(
  pool: Pool,
  input: {
    entityType: string;
    entityId: string;
    branchName?: string;
  },
): Promise<number> {
  const result = await pool.query<{ version: string }>(
    `SELECT COALESCE(MAX(version), 0) + 1 AS version
     FROM revisions
     WHERE entity_type = $1 AND entity_id = $2 AND branch_name = COALESCE($3, 'main')`,
    [input.entityType, input.entityId, input.branchName ?? 'main'],
  );
  return Number(result.rows[0]?.version ?? 1);
}

export async function createRevision(
  pool: Pool,
  input: {
    projectId: string;
    entityType: string;
    entityId: string;
    branchName?: string;
    parentRevisionId?: string | null;
    assetId?: string | null;
    jobId?: string | null;
    note?: string | null;
    trace?: Record<string, unknown>;
  },
) {
  const version = await nextRevisionVersion(pool, {
    entityType: input.entityType,
    entityId: input.entityId,
    branchName: input.branchName,
  });
  const result = await pool.query(
    `INSERT INTO revisions (project_id, asset_id, job_id, entity_type, entity_id, branch_name, version, parent_revision_id, note, trace)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'main'), $7, $8, $9, $10)
     RETURNING *`,
    [
      input.projectId,
      input.assetId ?? null,
      input.jobId ?? null,
      input.entityType,
      input.entityId,
      input.branchName ?? 'main',
      version,
      input.parentRevisionId ?? null,
      input.note ?? null,
      input.trace ?? {},
    ],
  );
  return result.rows[0];
}

// ========================================================================
// Cards
// ========================================================================

export async function createCard(pool: Pool, input: CardCreateInput) {
  const result = await pool.query(
    `INSERT INTO cards (project_id, card_number, title, prompt_instructions, metadata)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      input.projectId,
      input.cardNumber,
      input.title ?? '',
      input.promptInstructions ?? '',
      input.metadata ?? {},
    ],
  );
  return result.rows[0];
}

export async function listCardsByProject(pool: Pool, projectId: string) {
  const result = await pool.query(
    'SELECT * FROM cards WHERE project_id = $1 ORDER BY card_number',
    [projectId],
  );
  return result.rows;
}

export async function getCard(pool: Pool, cardId: string) {
  const result = await pool.query('SELECT * FROM cards WHERE id = $1', [cardId]);
  return result.rows[0] ?? null;
}

export async function updateCard(pool: Pool, cardId: string, patch: Record<string, unknown>) {
  const keys = Object.keys(patch);
  if (keys.length === 0) return getCard(pool, cardId);

  const setParts = keys.map((k, i) => `${k} = $${i + 2}`);
  const values = keys.map((k) => patch[k]);

  const result = await pool.query(
    `UPDATE cards SET ${setParts.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
    [cardId, ...values],
  );
  return result.rows[0] ?? null;
}

// ========================================================================
// Steps
// ========================================================================

export async function createStep(pool: Pool, input: StepCreateInput) {
  // Determine position from step type defaults
  const defaults = defaultWorkflowSteps();
  const def = defaults.find((d) => d.type === input.type);
  const position = def?.position ?? 99;

  const result = await pool.query(
    `INSERT INTO steps (card_id, type, position, inherited_from_step_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [input.cardId, input.type, position, input.inheritedFromStepId ?? null],
  );
  return result.rows[0];
}

export async function listStepsByCard(pool: Pool, cardId: string) {
  const result = await pool.query(
    'SELECT * FROM steps WHERE card_id = $1 ORDER BY position',
    [cardId],
  );
  return result.rows;
}

export async function updateStep(pool: Pool, stepId: string, patch: Record<string, unknown>) {
  const keys = Object.keys(patch);
  if (keys.length === 0) return null;

  const setParts = keys.map((k, i) => `${k} = $${i + 2}`);
  const values = keys.map((k) => patch[k]);

  const result = await pool.query(
    `UPDATE steps SET ${setParts.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
    [stepId, ...values],
  );
  return result.rows[0] ?? null;
}

export async function completeStep(pool: Pool, stepId: string, resultData?: Record<string, unknown>) {
  return updateStep(pool, stepId, {
    status: 'completed',
    result: resultData ?? null,
    completed_at: new Date().toISOString(),
  });
}

// ========================================================================
// Approvals
// ========================================================================

export async function createApproval(pool: Pool, input: ApprovalCreateInput) {
  const result = await pool.query(
    `INSERT INTO step_approvals (step_id, action, comment)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [input.stepId, input.action, input.comment ?? null],
  );
  return result.rows[0];
}

export async function listApprovalsByStep(pool: Pool, stepId: string) {
  const result = await pool.query(
    'SELECT * FROM step_approvals WHERE step_id = $1 ORDER BY reviewed_at DESC',
    [stepId],
  );
  return result.rows;
}

// ========================================================================
// Comments
// ========================================================================

export async function createComment(pool: Pool, input: CommentCreateInput) {
  const result = await pool.query(
    `INSERT INTO comments (project_id, card_id, step_id, approval_id, author, body, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.projectId ?? null,
      input.cardId ?? null,
      input.stepId ?? null,
      input.approvalId ?? null,
      input.author,
      input.body,
      input.metadata ?? {},
    ],
  );
  return result.rows[0];
}

export async function listCommentsByProject(pool: Pool, projectId: string) {
  const result = await pool.query(
    'SELECT * FROM comments WHERE project_id = $1 ORDER BY created_at ASC',
    [projectId],
  );
  return result.rows;
}

export async function listCommentsByCard(pool: Pool, cardId: string) {
  const result = await pool.query(
    'SELECT * FROM comments WHERE card_id = $1 ORDER BY created_at ASC',
    [cardId],
  );
  return result.rows;
}

// ========================================================================
// Workflow Definitions
// ========================================================================

export async function upsertWorkflowDefinition(
  pool: Pool,
  input: { marketplace: string; version: number; config: Array<Record<string, unknown>>; active: boolean },
) {
  const result = await pool.query(
    `INSERT INTO workflow_definitions (marketplace, version, config, active)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (marketplace, version) DO UPDATE SET config = $3, active = $4, updated_at = now()
     RETURNING *`,
    [input.marketplace, input.version, JSON.stringify(input.config), input.active],
  );
  return result.rows[0];
}

export async function getActiveWorkflowDefinition(pool: Pool, marketplace: string) {
  const result = await pool.query(
    `SELECT * FROM workflow_definitions WHERE marketplace = $1 AND active = true ORDER BY version DESC LIMIT 1`,
    [marketplace],
  );
  return result.rows[0] ?? null;
}

// ========================================================================
// Step 0 Ingestion
// ========================================================================

export async function upsertStep0Ingestion(
  pool: Pool,
  input: {
    projectId: string;
    mainImageId: string | null;
    brief: string;
    inferredCategory: string | null;
    inferredAttributes: Array<{ key: string; value: string; confidence: number; source: string }>;
    qualityRisks: QualityRisk[];
    blockingReasons: string[];
    canProceed: boolean;
    status: string;
    analysisResult: Record<string, unknown> | null;
  },
) {
  const result = await pool.query(
    `INSERT INTO step0_ingestions (
        project_id, main_image_id, brief, inferred_category,
        inferred_attributes, quality_risks, blocking_reasons,
        can_proceed, status, analysis_result, analyzed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CASE WHEN $9 != 'pending' THEN now() ELSE NULL END)
      ON CONFLICT (project_id) DO UPDATE SET
        main_image_id = $2, brief = $3, inferred_category = $4,
        inferred_attributes = $5, quality_risks = $6, blocking_reasons = $7,
        can_proceed = $8, status = $9, analysis_result = $10,
        analyzed_at = CASE WHEN $9 != 'pending' THEN now() ELSE step0_ingestions.analyzed_at END,
        updated_at = now()
      RETURNING *`,
    [
      input.projectId,
      input.mainImageId ?? null,
      input.brief,
      input.inferredCategory,
      JSON.stringify(input.inferredAttributes),
      JSON.stringify(input.qualityRisks),
      input.blockingReasons,
      input.canProceed,
      input.status,
      input.analysisResult ? JSON.stringify(input.analysisResult) : null,
    ],
  );
  return result.rows[0];
}

export async function getStep0Ingestion(pool: Pool, projectId: string) {
  const result = await pool.query(
    'SELECT * FROM step0_ingestions WHERE project_id = $1',
    [projectId],
  );
  return result.rows[0] ?? null;
}

// ========================================================================
// Validation Records
// ========================================================================

export async function createValidationRecord(
  pool: Pool,
  input: {
    ingestionId: string;
    marketplace: string;
    ruleCode: string;
    field: string;
    message: string;
    isBlocking: boolean;
  },
) {
  const result = await pool.query(
    `INSERT INTO validation_records (ingestion_id, marketplace, rule_code, field, message, is_blocking)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.ingestionId,
      input.marketplace,
      input.ruleCode,
      input.field,
      input.message,
      input.isBlocking,
    ],
  );
  return result.rows[0];
}

export async function listValidationRecords(pool: Pool, ingestionId: string) {
  const result = await pool.query(
    'SELECT * FROM validation_records WHERE ingestion_id = $1 ORDER BY is_blocking DESC, created_at',
    [ingestionId],
  );
  return result.rows;
}

export async function batchCreateValidationRecords(
  pool: Pool,
  ingestionId: string,
  records: Array<{ marketplace: string; ruleCode: string; field: string; message: string; isBlocking: boolean }>,
) {
  if (records.length === 0) return [];
  const values = records
    .map((_, i) => `($1, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5}, $${i * 5 + 6})`)
    .join(', ');
  const params: unknown[] = [ingestionId];
  for (const r of records) {
    params.push(r.marketplace, r.ruleCode, r.field, r.message, r.isBlocking);
  }
  const result = await pool.query(
    `INSERT INTO validation_records (ingestion_id, marketplace, rule_code, field, message, is_blocking)
     VALUES ${values}
     RETURNING *`,
    params,
  );
  return result.rows;
}

// ========================================================================
// Workflow State (aggregate load)
// ========================================================================

export async function loadWorkflowState(pool: Pool, cardId: string) {
  const cardRow = await pool.query('SELECT * FROM cards WHERE id = $1', [cardId]);
  const card = cardRow.rows[0];
  if (!card) return null;

  const stepsResult = await pool.query(
    'SELECT * FROM steps WHERE card_id = $1 ORDER BY position',
    [cardId],
  );

  const stepIds = stepsResult.rows.map((s: { id: string }) => s.id);
  let approvalsMap: Record<string, Array<Record<string, unknown>>> = {};
  if (stepIds.length > 0) {
    const approvalsResult = await pool.query(
      'SELECT * FROM step_approvals WHERE step_id = ANY($1) ORDER BY reviewed_at DESC',
      [stepIds],
    );
    approvalsMap = {};
    for (const a of approvalsResult.rows) {
      const sid = a.step_id;
      if (!approvalsMap[sid]) approvalsMap[sid] = [];
      approvalsMap[sid].push(a);
    }
  }

  const commentsResult = await pool.query(
    'SELECT id, author, body, created_at FROM comments WHERE card_id = $1 ORDER BY created_at ASC',
    [cardId],
  );

  const projectResult = await pool.query(
    'SELECT id, name, marketplaces, default_card_count FROM projects WHERE id = $1',
    [card.project_id],
  );
  const project = projectResult.rows[0];

  const steps = stepsResult.rows.map((s: Record<string, unknown>) => ({
    id: s.id,
    type: s.type,
    position: s.position,
    status: s.status,
    result: s.result,
    error: s.error,
    inheritedFromStepId: s.inherited_from_step_id,
    approvals: (approvalsMap[s.id as string] ?? []).map((a: Record<string, unknown>) => ({
      id: a.id,
      action: a.action,
      comment: a.comment,
      reviewedAt: a.reviewed_at,
    })),
    startedAt: s.started_at,
    completedAt: s.completed_at,
    createdAt: s.created_at,
  }));

  return {
    card: {
      id: card.id,
      projectId: card.project_id,
      cardNumber: card.card_number,
      status: card.status,
      title: card.title,
      promptInstructions: card.prompt_instructions,
      currentStep: card.current_step,
      selectedConceptId: card.selected_concept_id,
      metadata: card.metadata,
      steps,
      comments: commentsResult.rows.map((c: Record<string, unknown>) => ({
        id: c.id,
        author: c.author,
        body: c.body,
        createdAt: c.created_at,
      })),
      createdAt: card.created_at,
      updatedAt: card.updated_at,
    },
    project: {
      id: project.id,
      name: project.name,
      marketplaces: project.marketplaces,
      defaultCardCount: project.default_card_count,
    },
  };
}

// ========================================================================
// Step Inheritance
// ========================================================================

export async function inheritStepResult(pool: Pool, input: StepInheritInput) {
  const sourceStep = await pool.query('SELECT * FROM steps WHERE id = $1', [input.sourceStepId]);
  if (sourceStep.rows.length === 0) return { error: 'source step not found' };

  const targetStep = await pool.query('SELECT * FROM steps WHERE id = $1', [input.targetStepId]);
  if (targetStep.rows.length === 0) return { error: 'target step not found' };

  const source = sourceStep.rows[0];
  const target = targetStep.rows[0];

  if (source.result == null) return { error: 'source step has no result to inherit' };

  const allowedSource = allowedInheritSource(target.type as string);
  if (allowedSource !== null && source.type !== allowedSource) {
    return { error: `step of type '${target.type}' can only inherit from '${allowedSource}', not '${source.type}'` };
  }

  const fieldsToInherit = input.inheritFields.length > 0 ? input.inheritFields : ['result'];
  const patch: Record<string, unknown> = {
    inherited_from_step_id: input.sourceStepId,
  };
  if (fieldsToInherit.includes('result')) {
    patch.result = source.result;
  }

  const result = await pool.query(
    `UPDATE steps SET ${Object.keys(patch).map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
    [input.targetStepId, ...Object.values(patch)],
  );
  return result.rows[0];
}

// ========================================================================
// Project Default Card Initialization
// ========================================================================

export async function initializeDefaultCards(pool: Pool, input: ProjectCardInitInput) {
  const project = await pool.query('SELECT * FROM projects WHERE id = $1', [input.projectId]);
  if (project.rows.length === 0) return { error: 'project not found' };

  const existingCards = await pool.query(
    'SELECT COUNT(*) FROM cards WHERE project_id = $1',
    [input.projectId],
  );
  const existingCount = Number(existingCards.rows[0]?.count ?? 0);
  if (existingCount > 0) return { error: `project already has ${existingCount} cards` };

  const cardCount = input.cardCount ?? project.rows[0].default_card_count;
  const created: Array<Record<string, unknown>> = [];

  for (let i = 1; i <= cardCount; i += 1) {
    const cardResult = await pool.query(
      `INSERT INTO cards (project_id, card_number, title, prompt_instructions, metadata)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [input.projectId, i, `Card ${i}`, '', {}],
    );
    const card = cardResult.rows[0];
    created.push(card);

    if (input.includeSteps) {
      const steps = defaultWorkflowSteps();
      for (const step of steps) {
        await pool.query(
          `INSERT INTO steps (card_id, type, position, status)
           VALUES ($1, $2, $3, $4)`,
          [card.id, step.type, step.position, 'pending'],
        );
      }
    }
  }

  return { cards: created, count: created.length };
}

// ========================================================================
// Revision History
// ========================================================================

export async function getRevisionHistory(pool: Pool, input: RevisionQueryInput) {
  const result = await pool.query(
    `SELECT * FROM revisions
     WHERE entity_type = $1 AND entity_id = $2 AND branch_name = $3
     ORDER BY version DESC
     LIMIT $4`,
    [input.entityType, input.entityId, input.branchName, input.limit],
  );
  return result.rows.map((r: Record<string, unknown>) => ({
    id: r.id,
    projectId: r.project_id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    branchName: r.branch_name,
    version: r.version,
    parentRevisionId: r.parent_revision_id,
    assetId: r.asset_id,
    jobId: r.job_id,
    note: r.note,
    trace: r.trace,
    createdAt: r.created_at,
  }));
}

// ========================================================================
// Marketplace Selection Update
// ========================================================================

export async function updateProjectMarketplaces(pool: Pool, projectId: string, input: MarketplaceUpdateInput) {
  const result = await pool.query(
    `UPDATE projects SET marketplaces = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [projectId, input.marketplaces],
  );
  return result.rows[0] ?? null;
}

// ========================================================================
// Default Card Count Update
// ========================================================================

export async function updateDefaultCardCount(pool: Pool, projectId: string, input: DefaultCardCountUpdateInput) {
  const result = await pool.query(
    `UPDATE projects SET default_card_count = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [projectId, input.defaultCardCount],
  );
  return result.rows[0] ?? null;
}

// ========================================================================
// Regeneration Requests (task 38274b5f)
// ========================================================================

export async function createRegenerationRequest(
  pool: Pool,
  input: {
    cardId: string;
    stepId: string | null;
    scope: string;
    element: string | null;
    reason: string | null;
    previousStepResult: Record<string, unknown> | null;
  },
) {
  const result = await pool.query(
    `INSERT INTO regeneration_requests
       (card_id, step_id, scope, element, reason, previous_step_result)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.cardId,
      input.stepId,
      input.scope,
      input.element,
      input.reason ?? null,
      input.previousStepResult ? JSON.stringify(input.previousStepResult) : null,
    ],
  );
  return result.rows[0];
}

export async function getRegenerationRequest(pool: Pool, regenId: string) {
  const result = await pool.query(
    'SELECT * FROM regeneration_requests WHERE id = $1',
    [regenId],
  );
  return result.rows[0] ?? null;
}

export async function listRegenerationRequestsByCard(pool: Pool, cardId: string) {
  const result = await pool.query(
    'SELECT * FROM regeneration_requests WHERE card_id = $1 ORDER BY created_at DESC',
    [cardId],
  );
  return result.rows;
}

export async function updateRegenerationStatus(
  pool: Pool,
  regenId: string,
  status: string,
  newStepId: string | null = null,
) {
  const result = await pool.query(
    `UPDATE regeneration_requests
     SET status = $2,
         new_step_id = $3,
         completed_at = CASE WHEN $2 IN ('completed', 'failed') THEN now() ELSE completed_at END
     WHERE id = $1
     RETURNING *`,
    [regenId, status, newStepId],
  );
  return result.rows[0] ?? null;
}

// ========================================================================
// Step 0 Ingestion Images
// ========================================================================

export async function linkIngestionImage(
  pool: Pool,
  input: {
    ingestionId: string;
    assetId: string;
    role: 'additional_photo' | 'reference_image';
    position: number;
  },
) {
  const result = await pool.query(
    `INSERT INTO step0_ingestion_images (ingestion_id, asset_id, role, position)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (ingestion_id, asset_id) DO UPDATE SET role = $3, position = $4
     RETURNING *`,
    [input.ingestionId, input.assetId, input.role, input.position],
  );
  return result.rows[0];
}

export async function listIngestionImages(pool: Pool, ingestionId: string) {
  const result = await pool.query(
    `SELECT si.*, a.filename, a.mime_type, a.byte_size, a.sha256, a.storage_key
     FROM step0_ingestion_images si
     JOIN assets a ON a.id = si.asset_id
     WHERE si.ingestion_id = $1
     ORDER BY si.role, si.position`,
    [ingestionId],
  );
  return result.rows;
}

export async function getIngestionImage(pool: Pool, ingestionId: string, assetId: string) {
  const result = await pool.query(
    `SELECT si.*, a.filename, a.mime_type, a.byte_size, a.sha256, a.storage_key
     FROM step0_ingestion_images si
     JOIN assets a ON a.id = si.asset_id
     WHERE si.ingestion_id = $1 AND si.asset_id = $2`,
    [ingestionId, assetId],
  );
  return result.rows[0] ?? null;
}

export async function unlinkIngestionImage(pool: Pool, ingestionId: string, assetId: string) {
  const result = await pool.query(
    `DELETE FROM step0_ingestion_images
     WHERE ingestion_id = $1 AND asset_id = $2
     RETURNING *`,
    [ingestionId, assetId],
  );
  return result.rows[0] ?? null;
}

// ========================================================================
// Workflow State Aggregates
// ========================================================================

export async function getCardWorkflowState(pool: Pool, cardId: string) {
  const card = await getCard(pool, cardId);
  if (!card) return null;

  const steps = await listStepsByCard(pool, cardId);
  const comments = await listCommentsByCard(pool, cardId);

  const approvedSteps: string[] = [];
  const blockedSteps: Array<{ type: string; reason: string }> = [];

  for (const step of steps) {
    if (step.status === 'completed') {
      // Check if it has an approval
      const approvals = await listApprovalsByStep(pool, step.id);
      const hasApproval = approvals.some(
        (a: { action: string }) => a.action === 'approved',
      );
      if (hasApproval || !steps.find(
        (s: { type: string; id: string }) => s.id === step.id
      )?.type.match(/^(concept|final|export)$/)) {
        approvedSteps.push(step.type);
      }
    } else if (step.status === 'skipped') {
      approvedSteps.push(step.type);
    } else if (step.status === 'needs-revision') {
      blockedSteps.push({ type: step.type, reason: 'needs revision' });
    }
  }

  // Export is ready when all steps are completed/skipped
  const exportReady = steps.every(
    (s: { status: string }) => ['completed', 'skipped'].includes(s.status),
  );

  const exportBlockers: string[] = [];
  if (!exportReady) {
    for (const step of steps) {
      if (!['completed', 'skipped'].includes(step.status)) {
        exportBlockers.push(`Step ${step.type} is ${step.status}`);
      }
    }
    // Check that all approved steps have actual approvals
    for (const step of steps.filter(
      (s: { type: string; status: string }) => ['concept', 'final', 'export'].includes(s.type) && s.status === 'completed',
    )) {
      const approvals = await listApprovalsByStep(pool, step.id);
      if (!approvals.some((a: { action: string }) => a.action === 'approved')) {
        exportBlockers.push(`Step ${step.type} completed but not approved`);
      }
    }
  }

  const currentStep = steps.find(
    (s: { status: string }) => s.status === 'in-progress',
  );

  return {
    cardId: card.id,
    status: card.status,
    currentStepType: currentStep?.type ?? null,
    currentStepStatus: currentStep?.status ?? null,
    approvedSteps,
    blockedSteps,
    exportReady: exportBlockers.length === 0,
    exportBlockers,
  };
}

export async function getProjectExportReadiness(pool: Pool, projectId: string) {
  const cards = await listCardsByProject(pool, projectId);
  const cardDetails = [];

  for (const card of cards) {
    const state = await getCardWorkflowState(pool, card.id);
    if (!state) continue;

    cardDetails.push({
      cardNumber: card.card_number,
      exportReady: state.exportReady,
      blockers: state.exportBlockers,
    });
  }

  const readyCards = cardDetails.filter((c: { exportReady: boolean }) => c.exportReady).length;
  const allReady = readyCards === cards.length && cards.length > 0;

  return {
    projectId,
    ready: allReady,
    totalCards: cards.length,
    readyCards,
    cardDetails,
    reproducibility: {
      seeds: {},
      modelIds: {},
      promptVersions: {},
    },
  };
}

// ========================================================================
// Generation Jobs (task 179ad31e)
// ========================================================================

export async function createGenerationJob(
  pool: Pool,
  input: GenerationJobCreateInput,
) {
  const result = await pool.query(
    `INSERT INTO generation_jobs (
        project_id, card_id, stage, scope, element,
        provider, model, seed, prompt, input_data,
        parent_generation_id, batch_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
    [
      input.projectId,
      input.cardId ?? null,
      input.stage,
      input.scope,
      input.element ?? null,
      input.provider ?? null,
      input.model ?? null,
      input.seed ?? null,
      input.prompt ?? null,
      input.inputData ? JSON.stringify(input.inputData) : null,
      input.parentGenerationId ?? null,
      input.batchId ?? null,
    ],
  );
  return result.rows[0];
}

export async function getGenerationJob(pool: Pool, jobId: string) {
  const result = await pool.query(
    'SELECT * FROM generation_jobs WHERE id = $1',
    [jobId],
  );
  return result.rows[0] ?? null;
}

export async function listGenerationJobsByProject(pool: Pool, projectId: string) {
  const result = await pool.query(
    'SELECT * FROM generation_jobs WHERE project_id = $1 ORDER BY queued_at DESC',
    [projectId],
  );
  return result.rows;
}

export async function listGenerationJobsByCard(pool: Pool, cardId: string) {
  const result = await pool.query(
    'SELECT * FROM generation_jobs WHERE card_id = $1 ORDER BY queued_at DESC',
    [cardId],
  );
  return result.rows;
}

export async function updateGenerationJobStatus(
  pool: Pool,
  jobId: string,
  status: string,
  outputData: Record<string, unknown> | null = null,
  error: string | null = null,
) {
  const result = await pool.query(
    `UPDATE generation_jobs
     SET status = $2,
         output_data = COALESCE($3, output_data),
         error = COALESCE($4, error),
         attempts = attempts + 1,
         started_at = CASE WHEN $2 = 'processing' AND started_at IS NULL THEN now() ELSE started_at END,
         completed_at = CASE WHEN $2 IN ('completed', 'failed', 'cancelled') THEN now() ELSE completed_at END,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      jobId,
      status,
      outputData ? JSON.stringify(outputData) : null,
      error,
    ],
  );
  return result.rows[0] ?? null;
}

export async function cancelGenerationJob(pool: Pool, jobId: string) {
  return updateGenerationJobStatus(pool, jobId, 'cancelled');
}

// ========================================================================
// Generation Outputs
// ========================================================================

export async function createGenerationOutput(
  pool: Pool,
  input: GenerationOutputCreateInput,
) {
  const result = await pool.query(
    `INSERT INTO generation_outputs (generation_id, card_id, output_type, content, storage_key, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.generationId,
      input.cardId ?? null,
      input.outputType,
      JSON.stringify(input.content),
      input.storageKey ?? null,
      JSON.stringify(input.metadata),
    ],
  );
  return result.rows[0];
}

export async function listGenerationOutputs(pool: Pool, generationId: string) {
  const result = await pool.query(
    'SELECT * FROM generation_outputs WHERE generation_id = $1 ORDER BY created_at',
    [generationId],
  );
  return result.rows;
}

// ========================================================================
// Batch Generation Helpers
// ========================================================================

export async function createBatchGenerationJobs(
  pool: Pool,
  projectId: string,
  stage: string,
  cardIds: string[],
  batchId: string,
  provider: string | null = null,
  model: string | null = null,
  seed: number | null = null,
  prompt: string | null = null,
  inputData: Record<string, unknown> | null = null,
  parentGenerationId: string | null = null,
) {
  const jobs = [];
  for (const cardId of cardIds) {
    const job = await createGenerationJob(pool, {
      projectId,
      cardId,
      stage: stage as any,
      scope: 'batch',
      element: null,
      provider: (provider ?? undefined) as any,
      model: model ?? undefined,
      seed: seed ?? undefined,
      prompt: prompt ?? undefined,
      inputData: inputData ?? undefined,
      parentGenerationId: parentGenerationId ?? undefined,
      batchId,
    });
    jobs.push(job);
  }
  return jobs;
}

export async function getUpstreamApprovedData(
  pool: Pool,
  cardId: string,
  stage: string,
) {
  // Find the latest completed generation for each upstream stage
  const order = ['copy', 'scenes', 'design-concept'] as const;
  const stageIdx = order.indexOf(stage as typeof order[number]);
  if (stageIdx <= 0) return {};

  const upstreamStages = order.slice(0, stageIdx);
  const results: Record<string, unknown> = {};

  for (const upstreamStage of upstreamStages) {
    const result = await pool.query(
      `SELECT * FROM generation_jobs
       WHERE card_id = $1 AND stage = $2 AND status = 'completed'
       ORDER BY completed_at DESC
       LIMIT 1`,
      [cardId, upstreamStage],
    );
    if (result.rows[0] && result.rows[0].output_data) {
      results[upstreamStage] = result.rows[0].output_data;
    }
  }

  return results;
}

// ========================================================================
// Compliance Rules & Validations (task 3f40bd18)
// ========================================================================

export async function seedComplianceRules(pool: Pool, rules: ComplianceRuleInput[]) {
  for (const rule of rules) {
    await pool.query(
      `INSERT INTO compliance_rules (marketplace, category, rule_code, description, severity, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (rule_code) DO UPDATE SET
         description = $4, severity = $5, metadata = $6, updated_at = now()`,
      [rule.marketplace, rule.category, rule.ruleCode, rule.description, rule.severity, JSON.stringify(rule.metadata)],
    );
  }
}

export async function getActiveComplianceRules(pool: Pool, marketplaces: string[]) {
  const result = await pool.query(
    `SELECT * FROM compliance_rules
     WHERE marketplace = ANY($1) AND is_active = true
     ORDER BY
       CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 WHEN 'info' THEN 3 END,
       category, rule_code`,
    [marketplaces],
  );
  return result.rows;
}

export async function createComplianceValidation(
  pool: Pool,
  input: {
    projectId: string;
    cardId: string | null;
    stepId: string | null;
    status: string;
    complianceScore: number;
    criticalFailures: number;
    warnings: number;
    ruleResults: Array<Record<string, unknown>>;
    report: string | null;
  },
) {
  const result = await pool.query(
    `INSERT INTO compliance_validations
       (project_id, card_id, step_id, status, compliance_score,
        critical_failures, warnings, rule_results, report, validated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     RETURNING *`,
    [
      input.projectId,
      input.cardId,
      input.stepId,
      input.status,
      input.complianceScore,
      input.criticalFailures,
      input.warnings,
      JSON.stringify(input.ruleResults),
      input.report ?? null,
    ],
  );

  // Update project export block if critical failures
  if (input.criticalFailures > 0) {
    await pool.query(
      `UPDATE projects SET export_blocked = true, last_compliance_score = $2 WHERE id = $1`,
      [input.projectId, input.complianceScore],
    );
  }

  return result.rows[0];
}

export async function getComplianceValidation(pool: Pool, validationId: string) {
  const result = await pool.query(
    'SELECT * FROM compliance_validations WHERE id = $1',
    [validationId],
  );
  return result.rows[0] ?? null;
}

export async function listComplianceValidationsByProject(pool: Pool, projectId: string) {
  const result = await pool.query(
    'SELECT * FROM compliance_validations WHERE project_id = $1 ORDER BY validated_at DESC',
    [projectId],
  );
  return result.rows;
}

export async function listComplianceValidationsByCard(pool: Pool, cardId: string) {
  const result = await pool.query(
    'SELECT * FROM compliance_validations WHERE card_id = $1 ORDER BY validated_at DESC',
    [cardId],
  );
  return result.rows;
}

export async function updateProjectExportBlock(pool: Pool, projectId: string, blocked: boolean) {
  const result = await pool.query(
    `UPDATE projects SET export_blocked = $2 WHERE id = $1 RETURNING id, export_blocked`,
    [projectId, blocked],
  );
  return result.rows[0] ?? null;
}

// ========================================================================
// Revision Traceability (task c9a5e0bb)
// ========================================================================

export async function updateRevisionTraceability(
  pool: Pool,
  revisionId: string,
  patch: {
    workflowVersion?: string;
    promptVersion?: string;
    modelId?: string;
    seed?: number | null;
    referenceHashes?: string[];
  },
) {
  const result = await pool.query(
    `UPDATE revisions SET
       workflow_version = COALESCE($2, workflow_version),
       prompt_version = COALESCE($3, prompt_version),
       model_id = COALESCE($4, model_id),
       seed = COALESCE($5, seed),
       reference_hashes = COALESCE($6, reference_hashes)
     WHERE id = $1 RETURNING *`,
    [
      revisionId,
      patch.workflowVersion ?? null,
      patch.promptVersion ?? null,
      patch.modelId ?? null,
      patch.seed ?? null,
      patch.referenceHashes ?? null,
    ],
  );
  return result.rows[0] ?? null;
}

export async function createRevisionWithTrace(
  pool: Pool,
  input: {
    projectId: string;
    entityType: string;
    entityId: string;
    branchName?: string;
    assetId?: string | null;
    jobId?: string | null;
    note?: string | null;
    trace?: Record<string, unknown>;
    workflowVersion?: string;
    promptVersion?: string;
    modelId?: string;
    seed?: number | null;
    referenceHashes?: string[];
  },
) {
  const version = await nextRevisionVersion(pool, {
    entityType: input.entityType,
    entityId: input.entityId,
    branchName: input.branchName,
  });
  const result = await pool.query(
    `INSERT INTO revisions (
       project_id, asset_id, job_id, entity_type, entity_id,
       branch_name, version, parent_revision_id, note, trace,
       workflow_version, prompt_version, model_id, seed, reference_hashes
     )
     VALUES (
       $1, $2, $3, $4, $5,
       COALESCE($6, 'main'), $7, $8, $9, $10,
       $11, $12, $13, $14, $15
     )
     RETURNING *`,
    [
      input.projectId,
      input.assetId ?? null,
      input.jobId ?? null,
      input.entityType,
      input.entityId,
      input.branchName ?? 'main',
      version,
      null,
      input.note ?? null,
      input.trace ?? {},
      input.workflowVersion ?? null,
      input.promptVersion ?? null,
      input.modelId ?? null,
      input.seed ?? null,
      input.referenceHashes ?? [],
    ],
  );
  return result.rows[0];
}

export async function updateCardTraceability(
  pool: Pool,
  cardId: string,
  patch: {
    workflowVersion?: string;
    lastGeneratedModelId?: string;
    referenceHashes?: string[];
  },
) {
  const result = await pool.query(
    `UPDATE cards SET
       workflow_version = COALESCE($2, workflow_version),
       last_generated_model_id = COALESCE($3, last_generated_model_id),
       reference_hashes = COALESCE($4, reference_hashes),
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [
      cardId,
      patch.workflowVersion ?? null,
      patch.lastGeneratedModelId ?? null,
      patch.referenceHashes ?? null,
    ],
  );
  return result.rows[0] ?? null;
}

export async function updateJobTraceability(
  pool: Pool,
  jobId: string,
  patch: {
    workflowVersion?: string;
    promptVersion?: string;
    modelId?: string;
    seed?: number | null;
  },
) {
  const result = await pool.query(
    `UPDATE jobs SET
       workflow_version = COALESCE($2, workflow_version),
       prompt_version = COALESCE($3, prompt_version),
       model_id = COALESCE($4, model_id),
       seed = COALESCE($5, seed),
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [
      jobId,
      patch.workflowVersion ?? null,
      patch.promptVersion ?? null,
      patch.modelId ?? null,
      patch.seed ?? null,
    ],
  );
  return result.rows[0] ?? null;
}

export async function listRevisionsByModelId(pool: Pool, modelId: string) {
  const result = await pool.query(
    `SELECT * FROM revisions WHERE model_id = $1 ORDER BY created_at DESC`,
    [modelId],
  );
  return result.rows;
}

// ========================================================================
// Worker Lifecycle (task c366d801)
// ========================================================================

/** Find jobs stuck in 'processing' state beyond the stall threshold */
export async function getStalledJobs(pool: Pool, thresholdMinutes: number = 5) {
  const result = await pool.query(
    `SELECT * FROM jobs
     WHERE status = 'processing'
       AND started_at < now() - ($1 * interval '1 minute')
     ORDER BY started_at ASC`,
    [thresholdMinutes],
  );
  return result.rows;
}

/** Re-queue a stalled job back to 'queued' so the worker picks it up again */
export async function requeueStalledJob(pool: Pool, jobId: string) {
  const result = await pool.query(
    `UPDATE jobs
     SET status = 'queued',
         started_at = null,
         stall_detected_at = now(),
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [jobId],
  );
  return result.rows[0] ?? null;
}

/** Mark a job as dead-lettered (exhausted retries, permanent failure) */
export async function markJobAsDeadLetter(pool: Pool, jobId: string, reason: string) {
  const result = await pool.query(
    `UPDATE jobs
     SET status = 'dead-lettered',
         dead_letter_reason = $2,
         finished_at = now(),
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [jobId, reason],
  );
  return result.rows[0] ?? null;
}

/** List dead-lettered jobs for ops inspection */
export async function getDeadLetterJobs(pool: Pool) {
  const result = await pool.query(
    `SELECT * FROM jobs
     WHERE status = 'dead-lettered'
     ORDER BY updated_at DESC`,
  );
  return result.rows;
}

/** Record a retry attempt with timestamp */
export async function recordJobRetry(pool: Pool, jobId: string) {
  const result = await pool.query(
    `UPDATE jobs
     SET last_retry_at = now(),
         attempts = attempts + 1,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [jobId],
  );
  return result.rows[0] ?? null;
}



// ---------------------------------------------------------------------------
// Task cbb08985 — Billing DB layer
// ---------------------------------------------------------------------------

export * from './billing';

// ---------------------------------------------------------------------------
// Task a054cea4 — Events DB layer
// ---------------------------------------------------------------------------

export async function insertEvent(
  pool: Pool,
  input: {
    projectId: string;
    category: string;
    type: string;
    userId?: string;
    stepId?: string;
    jobId?: string;
    cardId?: string;
    modelId?: string;
    resolution?: string;
    costEstimateCents?: number;
    eventData?: Record<string, unknown>;
  },
) {
  const result = await pool.query(
    `INSERT INTO events (
        project_id, category, type, user_id, step_id, job_id, card_id,
        model_id, resolution, cost_estimate_cents, event_data
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
    [
      input.projectId,
      input.category,
      input.type,
      input.userId ?? null,
      input.stepId ?? null,
      input.jobId ?? null,
      input.cardId ?? null,
      input.modelId ?? null,
      input.resolution ?? null,
      input.costEstimateCents ?? null,
      input.eventData ? JSON.stringify(input.eventData) : '{}',
    ],
  );
  return result.rows[0];
}

export async function getEventsByProject(
  pool: Pool,
  projectId: string,
  limit = 100,
  offset = 0,
) {
  const result = await pool.query(
    `SELECT * FROM events
     WHERE project_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [projectId, limit, offset],
  );
  return result.rows;
}

export async function getEventsByJob(
  pool: Pool,
  jobId: string,
) {
  const result = await pool.query(
    `SELECT * FROM events WHERE job_id = $1 ORDER BY created_at ASC`,
    [jobId],
  );
  return result.rows;
}

export async function getEventsByType(
  pool: Pool,
  eventType: string,
  limit = 50,
) {
  const result = await pool.query(
    `SELECT * FROM events WHERE type = $1 ORDER BY created_at DESC LIMIT $2`,
    [eventType, limit],
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// Task 9c6fe204 — Batching DB layer
// ---------------------------------------------------------------------------

export async function createBatchGroup(
  pool: Pool,
  input: {
    projectId: string;
    batchType: string;
    maxResolution?: string;
    totalJobs?: number;
    costBudgetCents?: number;
  },
) {
  const result = await pool.query(
    `INSERT INTO batch_groups (project_id, batch_type, max_resolution, total_jobs, cost_budget_cents)
     VALUES ($1, $2, COALESCE($3, '2000x2000'), COALESCE($4, 0), $5)
     RETURNING *`,
    [input.projectId, input.batchType, input.maxResolution, input.totalJobs, input.costBudgetCents ?? null],
  );
  return result.rows[0];
}

export async function addBatchMember(
  pool: Pool,
  batchGroupId: string,
  jobId: string,
  sequenceOrder: number,
) {
  const result = await pool.query(
    `INSERT INTO batch_group_members (batch_group_id, job_id, sequence_order)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [batchGroupId, jobId, sequenceOrder],
  );
  return result.rows[0];
}

export async function updateBatchGroupStatus(
  pool: Pool,
  batchGroupId: string,
  status: string,
) {
  const result = await pool.query(
    `UPDATE batch_groups SET status = $2, updated_at = now(),
       completed_at = CASE WHEN $2 IN ('completed', 'failed') THEN now() ELSE completed_at END
     WHERE id = $1 RETURNING *`,
    [batchGroupId, status],
  );
  return result.rows[0];
}

export async function completeBatchMember(
  pool: Pool,
  batchGroupId: string,
  jobId: string,
  resultData?: Record<string, unknown>,
  error?: string,
) {
  const result = await pool.query(
    `UPDATE batch_group_members
     SET status = $3, result = $4, error = $5, completed_at = now()
     WHERE batch_group_id = $1 AND job_id = $2
     RETURNING *`,
    [batchGroupId, jobId, error ? 'failed' : 'completed', resultData ? JSON.stringify(resultData) : null, error ?? null],
  );
  return result.rows[0];
}

export async function getBatchGroupWithMembers(
  pool: Pool,
  batchGroupId: string,
) {
  const groupResult = await pool.query(
    'SELECT * FROM batch_groups WHERE id = $1',
    [batchGroupId],
  );
  if (groupResult.rows.length === 0) return null;

  const membersResult = await pool.query(
    `SELECT bgm.*, gj.type as job_type, gj.status as job_status
     FROM batch_group_members bgm
     LEFT JOIN generation_jobs gj ON gj.id = bgm.job_id
     WHERE bgm.batch_group_id = $1
     ORDER BY bgm.sequence_order`,
    [batchGroupId],
  );

  return {
    ...groupResult.rows[0],
    members: membersResult.rows,
  };
}

export async function getBatchGroupsByProject(
  pool: Pool,
  projectId: string,
  limit = 50,
) {
  const result = await pool.query(
    `SELECT * FROM batch_groups
     WHERE project_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [projectId, limit],
  );
  return result.rows;
}
