import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, type PoolClient } from 'pg';
import { defaultCardCount, slugify } from '@cardflow/core';

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
