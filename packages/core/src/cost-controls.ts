/**
 * Cost controls and rate-limiting for batch generation pipeline (task 56cc7032).
 *
 * Tracks per-batch and per-project costs against configurable budget limits,
 * enforces rate limits on provider API calls, and blocks batch generation
 * when budget or rate limits are exceeded.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CostEntry {
  projectId: string;
  batchId: string;
  cardNumber: number;
  provider: string;
  model: string;
  cost: number;      // in cents (or smallest currency unit)
  tokensIn?: number;
  tokensOut?: number;
  timestamp: string;
}

export interface BudgetConfig {
  projectId: string;
  maxCostPerBatch: number;     // max cost for a single batch run
  maxCostPerProject: number;   // max total cost for a project
  maxCostPerCard: number;      // max cost for a single card generation
  maxRatePerMinute: number;    // max API calls per minute
  maxRatePerHour: number;      // max API calls per hour
}

export interface UsageSnapshot {
  projectId: string;
  currentPeriod: {
    totalCost: number;
    batchCount: number;
    cardCount: number;
    apiCalls: number;
    periodStart: string;
  };
  budgetStatus: {
    perCardAllowed: boolean;
    perBatchAllowed: boolean;
    perProjectAllowed: boolean;
    rateLimitAllowed: boolean;
  };
}

export interface RateLimitEntry {
  timestamp: string; // ISO timestamp
}

// ---------------------------------------------------------------------------
// Default Budget Config
// ---------------------------------------------------------------------------

export const DEFAULT_BUDGET_CONFIG: Omit<BudgetConfig, 'projectId'> = {
  maxCostPerBatch: 5000,     // $50 per batch (in cents)
  maxCostPerProject: 20000,  // $200 per project (in cents)
  maxCostPerCard: 200,       // $2 per card (in cents)
  maxRatePerMinute: 60,      // 60 calls/min
  maxRatePerHour: 1000,      // 1000 calls/hour
};

// ---------------------------------------------------------------------------
// Budget tracking
// ---------------------------------------------------------------------------

/**
 * Calculate total cost of a cost entries array
 */
export function calculateTotalCost(entries: CostEntry[]): number {
  return entries.reduce((sum, e) => sum + e.cost, 0);
}

/**
 * Calculate cost by provider
 */
export function costsByProvider(entries: CostEntry[]): Record<string, number> {
  const costs: Record<string, number> = {};
  for (const e of entries) {
    costs[e.provider] = (costs[e.provider] ?? 0) + e.cost;
  }
  return costs;
}

/**
 * Calculate cost per card
 */
export function costsByCard(entries: CostEntry[]): Record<number, number> {
  const costs: Record<number, number> = {};
  for (const e of entries) {
    costs[e.cardNumber] = (costs[e.cardNumber] ?? 0) + e.cost;
  }
  return costs;
}

/**
 * Predict if a new batch will exceed budget
 */
export function predictBatchCost(
  cardCount: number,
  estimatedCostPerCard: number,
  budgetConfig: BudgetConfig,
): { allowed: boolean; predictedCost: number; limit: number } {
  const predictedCost = cardCount * estimatedCostPerCard;
  const perCardAllowed = estimatedCostPerCard <= budgetConfig.maxCostPerCard;
  const perBatchAllowed = predictedCost <= budgetConfig.maxCostPerBatch;

  return {
    allowed: perCardAllowed && perBatchAllowed,
    predictedCost,
    limit: Math.min(budgetConfig.maxCostPerCard * cardCount, budgetConfig.maxCostPerBatch),
  };
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/**
 * Check if a rate limit has been exceeded
 */
export function isRateLimited(
  recentCalls: RateLimitEntry[],
  maxPerMinute: number,
  maxPerHour: number,
): { limited: boolean; reason: string; retryAfterMs?: number } {
  const now = new Date();
  const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const callsLastMinute = recentCalls.filter(
    (c) => new Date(c.timestamp) > oneMinuteAgo,
  ).length;

  const callsLastHour = recentCalls.filter(
    (c) => new Date(c.timestamp) > oneHourAgo,
  ).length;

  if (callsLastMinute >= maxPerMinute) {
    // Calculate retry after: find the oldest call in the window and wait until it expires
    const minuteCalls = recentCalls
      .filter((c) => new Date(c.timestamp) > oneMinuteAgo)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const oldestInWindow = minuteCalls[0];
    const retryAfterMs = oldestInWindow ?
      new Date(oldestInWindow.timestamp).getTime() + 60 * 1000 - now.getTime() : 60 * 1000;

    return {
      limited: true,
      reason: `Rate limit exceeded: ${callsLastMinute}/${maxPerMinute} calls per minute`,
      retryAfterMs: Math.max(retryAfterMs, 1000), // minimum 1 second retry
    };
  }

  if (callsLastHour >= maxPerHour) {
    const hourCalls = recentCalls
      .filter((c) => new Date(c.timestamp) > oneHourAgo)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const oldestInWindow = hourCalls[0];
    const retryAfterMs = oldestInWindow ?
      new Date(oldestInWindow.timestamp).getTime() + 60 * 60 * 1000 - now.getTime() : 60 * 60 * 1000;

    return {
      limited: true,
      reason: `Hourly rate limit exceeded: ${callsLastHour}/${maxPerHour} calls per hour`,
      retryAfterMs: Math.max(retryAfterMs, 1000),
    };
  }

  return { limited: false, reason: '' };
}

/**
 * Check budget and return usage snapshot
 */
export function checkBudget(
  projectId: string,
  currentCosts: CostEntry[],
  budgetConfig: BudgetConfig,
  recentCalls: RateLimitEntry[],
): UsageSnapshot {
  const totalCost = calculateTotalCost(currentCosts);
  const batchCount = [...new Set(currentCosts.map((c) => c.batchId))].length;
  const cardCount = [...new Set(currentCosts.map((c) => c.cardNumber))].length;

  const rateCheck = isRateLimited(
    recentCalls,
    budgetConfig.maxRatePerMinute,
    budgetConfig.maxRatePerHour,
  );

  return {
    projectId,
    currentPeriod: {
      totalCost,
      batchCount,
      cardCount,
      apiCalls: recentCalls.length,
      periodStart: new Date().toISOString(),
    },
    budgetStatus: {
      perCardAllowed: currentCosts.every((c) => c.cost <= budgetConfig.maxCostPerCard),
      perBatchAllowed: totalCost <= budgetConfig.maxCostPerBatch,
      perProjectAllowed: totalCost <= budgetConfig.maxCostPerProject,
      rateLimitAllowed: !rateCheck.limited,
    },
  };
}

/**
 * Generate cost report for a batch
 */
export function generateBatchCostReport(
  batchId: string,
  entries: CostEntry[],
): {
  batchId: string;
  totalCost: number;
  totalCards: number;
  costPerCard: number;
  costsByProvider: Record<string, number>;
  timestamp: string;
} {
  const batchEntries = entries.filter((e) => e.batchId === batchId);
  const totalCost = calculateTotalCost(batchEntries);
  const uniqueCards = [...new Set(batchEntries.map((e) => e.cardNumber))];

  return {
    batchId,
    totalCost,
    totalCards: uniqueCards.length,
    costPerCard: uniqueCards.length > 0 ? totalCost / uniqueCards.length : 0,
    costsByProvider: costsByProvider(batchEntries),
    timestamp: new Date().toISOString(),
  };
}
