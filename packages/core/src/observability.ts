/**
 * Observability query API for usage/cost dashboards (task 1e153893).
 *
 * Aggregates data from billing, events, and cache layers into
 * structured query responses for the usage and cost dashboards.
 */

// ---------------------------------------------------------------------------
// Query types
// ---------------------------------------------------------------------------

export interface UsageQuery {
  projectId: string;
  range: '7d' | '30d' | '90d';
  granularity?: 'daily' | 'weekly';
}

export interface CostQuery {
  projectId?: string;
  range: '7d' | '30d' | '90d';
  groupBy?: 'provider' | 'project' | 'model';
}

// ---------------------------------------------------------------------------
// Response shapes (matching dashboard contracts)
// ---------------------------------------------------------------------------

export interface UsageResponse {
  balance: number;
  creditsPerPeriod: number;
  periodStart: string;
  periodEnd: string;
  plan: string;
  consumptionByDay: Array<{ date: string; credits: number }>;
  projects: Array<{
    projectId: string;
    projectName: string;
    cardsGenerated: number;
    creditsUsed: number;
    lastStage: string;
  }>;
  totalConsumed: number;
  avgDaily: number;
  lowBalanceThreshold: number;
}

export interface CostResponse {
  totalSpendCents: number;
  totalSpendFormatted: string;
  avgDailySpend: number;
  monthlyBudgetCents: number;
  budgetUsedPct: number;
  forecastMonthEnd: number;
  spendByProvider: Array<{ name: string; cents: number; pct: number }>;
  spendByDay: Array<{ date: string; cents: number }>;
  topProjects: Array<{ projectId: string; name: string; spendCents: number; jobsCount: number }>;
  alerts: Array<{ type: 'warning' | 'critical'; message: string }>;
}

export interface EventTraceResponse {
  events: Array<{
    id: string;
    type: string;
    category: string;
    timestamp: string;
    projectId: string;
    jobId?: string;
    costEstimateCents?: number;
  }>;
  summary: {
    totalEvents: number;
    types: Record<string, number>;
    dateRange: { from: string; to: string };
  };
}

// ---------------------------------------------------------------------------
// Helper: generate daily range
// ---------------------------------------------------------------------------

export function dateRangeForPeriod(range: '7d' | '30d' | '90d'): { startDate: Date; endDate: Date } {
  const endDate = new Date();
  const days = range === '7d' ? 7 : range === '90d' ? 90 : 30;
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days);
  return { startDate, endDate };
}

export function generateDateLabels(
  range: '7d' | '30d' | '90d',
): string[] {
  const { endDate } = dateRangeForPeriod(range);
  const days = range === '7d' ? 7 : range === '90d' ? 90 : 30;
  const labels: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(endDate);
    d.setDate(d.getDate() - i);
    labels.push(d.toISOString());
  }
  return labels;
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

export function formatCents(cents: number): string {
  if (cents < 100) return `${cents}₵`;
  return `$${(cents / 100).toFixed(2)}`;
}

export function calculateBudgetPct(spent: number, budget: number): number {
  return budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
}

export function forecastMonthly(dailyAvg: number, daysInMonth: number = 30): number {
  return Math.round(dailyAvg * daysInMonth);
}

// ---------------------------------------------------------------------------
// Alert generation
// ---------------------------------------------------------------------------

export function generateBudgetAlerts(
  spentCents: number,
  budgetCents: number,
  dailyAvg: number,
  daysRemaining: number,
): Array<{ type: 'warning' | 'critical'; message: string }> {
  const alerts: Array<{ type: 'warning' | 'critical'; message: string }> = [];
  const pct = calculateBudgetPct(spentCents, budgetCents);
  const forecast = spentCents + Math.round(dailyAvg * daysRemaining);

  if (pct > 90) {
    alerts.push({
      type: 'critical',
      message: `Budget critical — ${pct}% of monthly budget consumed.`,
    });
  } else if (pct > 70) {
    alerts.push({
      type: 'warning',
      message: `Budget at ${pct}% — monitor usage closely.`,
    });
  }

  if (forecast > budgetCents) {
    const overage = forecast - budgetCents;
    alerts.push({
      type: 'warning',
      message: `Forecast exceeds budget by ${formatCents(overage)} — consider limiting generation.`,
    });
  }

  return alerts;
}
