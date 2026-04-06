/**
 * Billing DB layer — subscriptions and credits ledger queries.
 */

import { type Pool } from 'pg';

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export async function getSubscriptionByProject(pool: Pool, projectId: string) {
  const result = await pool.query(
    'SELECT * FROM subscriptions WHERE project_id = $1',
    [projectId],
  );
  return result.rows[0] ?? null;
}

export async function createSubscription(
  pool: Pool,
  input: {
    projectId: string;
    plan?: string;
    creditsPerPeriod?: number;
    periodEnd?: string;
  },
) {
  const result = await pool.query(
    `INSERT INTO subscriptions (project_id, plan, credits_per_period, status, period_start, period_end)
     VALUES ($1, COALESCE($2, 'free'), COALESCE($3, 20), 'active', now(), COALESCE($4, now() + interval '30 days'))
     RETURNING *`,
    [input.projectId, input.plan, input.creditsPerPeriod, input.periodEnd],
  );
  return result.rows[0];
}

export async function updateSubscriptionStatus(
  pool: Pool,
  subscriptionId: string,
  status: string,
) {
  const result = await pool.query(
    `UPDATE subscriptions SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [subscriptionId, status],
  );
  return result.rows[0] ?? null;
}

export async function upgradeSubscription(
  pool: Pool,
  subscriptionId: string,
  newPlan: string,
  newCredits: number,
) {
  const result = await pool.query(
    `UPDATE subscriptions
     SET plan = $2, credits_per_period = $3, status = 'active', updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [subscriptionId, newPlan, newCredits],
  );
  return result.rows[0] ?? null;
}

export async function cancelSubscription(pool: Pool, subscriptionId: string) {
  return updateSubscriptionStatus(pool, subscriptionId, 'cancelled');
}

// ---------------------------------------------------------------------------
// Credits ledger — append-only
// ---------------------------------------------------------------------------

export async function recordCreditTransaction(
  pool: Pool,
  input: {
    subscriptionId: string;
    type: string;
    amount: number;
    reference?: string;
  },
) {
  const result = await pool.query(
    `INSERT INTO credits_ledger (subscription_id, type, amount, reference)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [input.subscriptionId, input.type, input.amount, input.reference ?? null],
  );
  return result.rows[0];
}

export async function getCreditBalance(
  pool: Pool,
  subscriptionId: string,
) {
  const result = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS balance
     FROM credits_ledger
     WHERE subscription_id = $1`,
    [subscriptionId],
  );
  return Number(result.rows[0]?.balance ?? 0);
}

export async function getLedgerEntries(
  pool: Pool,
  subscriptionId: string,
  limit: number = 100,
  offset: number = 0,
) {
  const result = await pool.query(
    `SELECT * FROM credits_ledger
     WHERE subscription_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [subscriptionId, limit, offset],
  );
  return result.rows;
}

export async function getCreditsUsed(
  pool: Pool,
  subscriptionId: string,
) {
  const result = await pool.query(
    `SELECT COALESCE(SUM(ABS(amount)), 0) AS consumed
     FROM credits_ledger
     WHERE subscription_id = $1 AND type = 'consumption'`,
    [subscriptionId],
  );
  return Number(result.rows[0]?.consumed ?? 0);
}
