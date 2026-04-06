/**
 * Cost-control alerts and budget guardrails (task d403c990).
 *
 * - Configurable daily/weekly/monthly budget caps
 * - Credit balance low-water warnings (20%, 5%)
 * - Hard spend cap (blocks generation)
 * - Soft alert notifications (in-app toast + event log)
 */

// ---------------------------------------------------------------------------
// Alert types
// ---------------------------------------------------------------------------

export type AlertType = 'budget_warning' | 'budget_critical' | 'low_credit' | 'spend_cap_reached' | 'spend_cap_blocked';
export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertScope = 'daily' | 'weekly' | 'monthly' | 'perpetual';

export interface AlertConfig {
  dailyBudgetCents: number;
  weeklyBudgetCents: number;
  monthlyBudgetCents: number;
  lowCreditThresholdPct: number;    // e.g. 20 for 20%
  criticalCreditThresholdPct: number; // e.g. 5 for 5%
  hardSpendCapCents: number;          // 0 = disabled
}

export const DEFAULT_ALERT_CONFIG: AlertConfig = {
  dailyBudgetCents: 1000,      // $10/day
  weeklyBudgetCents: 5000,     // $50/week
  monthlyBudgetCents: 20000,   // $200/month
  lowCreditThresholdPct: 20,
  criticalCreditThresholdPct: 5,
  hardSpendCapCents: 0,          // disabled by default
};

export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  timestamp: string;
  projectId: string;
  /** Toast notification: show in-app */
  showInApp: boolean;
  /** Persist to events table */
  persist: boolean;
}

// ---------------------------------------------------------------------------
// Budget monitoring
// ---------------------------------------------------------------------------

export function checkBudgetCap(
  spentCents: number,
  budgetCents: number,
  scope: AlertScope,
): 'ok' | 'warning' | 'blocked' {
  if (budgetCents <= 0) return 'ok';
  const ratio = spentCents / budgetCents;

  if (ratio >= 1.0) return 'blocked';
  if (ratio >= 0.8) return 'warning';
  return 'ok';
}

export function checkCreditLevel(
  remaining: number,
  total: number,
  config: AlertConfig,
): 'ok' | 'low' | 'critical' {
  if (total <= 0 || remaining <= 0) return 'critical';
  const pct = (remaining / total) * 100;

  if (pct < config.criticalCreditThresholdPct) return 'critical';
  if (pct < config.lowCreditThresholdPct) return 'low';
  return 'ok';
}

// ---------------------------------------------------------------------------
// Alert generation
// ---------------------------------------------------------------------------

function generateId(): string {
  const hex = () => Math.random().toString(16).substring(2, 10);
  return `${hex()}-${hex()}-${hex()}`.substring(0, 36);
}

export function generateSpendAlerts(
  projectId: string,
  currentSpend: { dailyCents: number; weeklyCents: number; monthlyCents: number },
  creditBalance: { remaining: number; total: number },
  config: AlertConfig = DEFAULT_ALERT_CONFIG,
): Alert[] {
  const alerts: Alert[] = [];

  // Daily budget check
  const dailyRatio = config.dailyBudgetCents > 0 ? currentSpend.dailyCents / config.dailyBudgetCents : 0;
  if (dailyRatio >= 1.0) {
    alerts.push({
      id: generateId(),
      type: 'spend_cap_reached',
      severity: 'critical',
      title: 'Daily budget reached',
      message: `You've used ${(dailyRatio * 100).toFixed(0)}% of your daily budget ($${(currentSpend.dailyCents / 100).toFixed(2)} / $${(config.dailyBudgetCents / 100).toFixed(2)}).`,
      timestamp: new Date().toISOString(),
      projectId,
      showInApp: true,
      persist: true,
    });
  } else if (dailyRatio >= 0.8) {
    alerts.push({
      id: generateId(),
      type: 'budget_warning',
      severity: 'warning',
      title: 'Daily budget running low',
      message: `You've used ${(dailyRatio * 100).toFixed(0)}% of your daily budget.`,
      timestamp: new Date().toISOString(),
      projectId,
      showInApp: true,
      persist: true,
    });
  }

  // Monthly budget critical
  const monthlyRatio = config.monthlyBudgetCents > 0 ? currentSpend.monthlyCents / config.monthlyBudgetCents : 0;
  if (monthlyRatio >= 0.9) {
    alerts.push({
      id: generateId(),
      type: 'budget_critical',
      severity: 'critical',
      title: 'Monthly budget almost exhausted',
      message: `You've spent $${(currentSpend.monthlyCents / 100).toFixed(2)} of $${(config.monthlyBudgetCents / 100).toFixed(2)} this month.`,
      timestamp: new Date().toISOString(),
      projectId,
      showInApp: true,
      persist: true,
    });
  }

  // Credit balance warnings
  const creditLevel = checkCreditLevel(creditBalance.remaining, creditBalance.total, config);
  if (creditLevel === 'critical') {
    alerts.push({
      id: generateId(),
      type: 'low_credit',
      severity: 'critical',
      title: 'Credits almost depleted',
      message: `Only ${creditBalance.remaining} credits remaining (${((creditBalance.remaining / Math.max(creditBalance.total, 1)) * 100).toFixed(0)}%).`,
      timestamp: new Date().toISOString(),
      projectId,
      showInApp: true,
      persist: true,
    });
  } else if (creditLevel === 'low') {
    alerts.push({
      id: generateId(),
      type: 'low_credit',
      severity: 'warning',
      title: 'Credits running low',
      message: `${creditBalance.remaining} credits remaining (${((creditBalance.remaining / Math.max(creditBalance.total, 1)) * 100).toFixed(0)}%).`,
      timestamp: new Date().toISOString(),
      projectId,
      showInApp: true,
      persist: true,
    });
  }

  // Hard spend cap check
  if (config.hardSpendCapCents > 0 && currentSpend.monthlyCents >= config.hardSpendCapCents) {
    alerts.push({
      id: generateId(),
      type: 'spend_cap_blocked',
      severity: 'critical',
      title: 'Spend cap reached — generation blocked',
      message: `New generation jobs are blocked until the next billing cycle. Spend cap: $${(config.hardSpendCapCents / 100).toFixed(2)}.`,
      timestamp: new Date().toISOString(),
      projectId,
      showInApp: true,
      persist: true,
    });
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// Hard cap enforcement
// ---------------------------------------------------------------------------

export function canCreateJob(
  projectId: string,
  currentSpendCents: number,
  hardCapCents: number,
  creditBalance: number,
  jobCostEstimateCents: number,
): { allowed: boolean; reason?: string } {
  // Check hard cap
  if (hardCapCents > 0 && currentSpendCents >= hardCapCents) {
    return { allowed: false, reason: 'Spend cap reached. New jobs blocked.' };
  }

  // Check if job would exceed cap
  if (hardCapCents > 0 && currentSpendCents + jobCostEstimateCents > hardCapCents) {
    const remaining = hardCapCents - currentSpendCents;
    return {
      allowed: false,
      reason: `Job costs ${jobCostEstimateCents}¢ but only ${remaining}¢ remaining in budget.`,
    };
  }

  // Check credit balance
  if (creditBalance < jobCostEstimateCents) {
    return {
      allowed: false,
      reason: `Insufficient credits. Need ${jobCostEstimateCents}¢, have ${creditBalance}¢.`,
    };
  }

  return { allowed: true };
}
