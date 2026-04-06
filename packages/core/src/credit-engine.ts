/**
 * Credit consumption, top-up, and renewal engine (task 9f473bcd).
 *
 * Handles credit consumption at generation time, top-ups, credit expiry,
 * subscription renewal, and billing webhook callbacks.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RenewalFrequency = 'monthly' | 'quarterly' | 'yearly' | 'never';
export type TopUpMethod = 'manual' | 'auto' | 'webhook';

export interface SubscriptionRenewal {
  subscriptionId: string;
  plan: string;
  currentPeriodEnd: string;
  nextRenewalDate: string;
  frequency: RenewalFrequency;
  autoRenew: boolean;
  creditsOnRenewal: number;
}

export interface TopUpRequest {
  subscriptionId: string;
  amount: number;
  method: TopUpMethod;
  reason?: string;
  expiresAt?: string;
}

export interface ConsumptionRequest {
  subscriptionId: string;
  jobId?: string;
  credits: number;
  description?: string;
}

export interface CreditLedgerEntry {
  id: string;
  subscriptionId: string;
  type: 'consumption' | 'top-up' | 'renewal' | 'refund' | 'expiry';
  amount: number; // negative for consumption, positive for credits added
  balance: number; // resulting balance
  referenceId?: string; // job_id, invoice_id, etc
  reason?: string;
  timestamp: string;
}

export interface SubscriptionSnapshot {
  subscriptionId: string;
  plan: string;
  status: string;
  currentBalance: number;
  creditsPerPeriod: number;
  consumedThisPeriod: number;
  periodEnd: string;
  autoRenew: boolean;
  expiryWarning: boolean;
  lowCreditWarning: boolean;
}

// ---------------------------------------------------------------------------
// Renewal scheduling
// ---------------------------------------------------------------------------

export function calculateNextRenewal(
  periodEnd: string,
  frequency: RenewalFrequency,
): string {
  const date = new Date(periodEnd);
  switch (frequency) {
    case 'monthly':
      date.setMonth(date.getMonth() + 1);
      break;
    case 'quarterly':
      date.setMonth(date.getMonth() + 3);
      break;
    case 'yearly':
      date.setFullYear(date.getFullYear() + 1);
      break;
    case 'never':
      return '';
  }
  return date.toISOString();
}

export function shouldRenew(
  now: Date,
  periodEnd: string,
  autoRenew: boolean,
  frequency: RenewalFrequency,
): boolean {
  if (!autoRenew || frequency === 'never') return false;
  return now >= new Date(periodEnd);
}

// ---------------------------------------------------------------------------
// Credit expiration
// ---------------------------------------------------------------------------

/**
 * Check if credits should expire based on date and policy.
 */
export function shouldExpireCredits(
  grantDate: string,
  expiryDate: string | null,
  expiryPolicy: 'none' | 'billing_cycle' | 'fixed_date',
  now: Date = new Date(),
): boolean {
  if (expiryPolicy === 'none') return false;
  if (expiryPolicy === 'fixed_date' && expiryDate) {
    return now >= new Date(expiryDate);
  }
  // For billing_cycle, credits expire when the period ends
  if (expiryPolicy === 'billing_cycle') {
    return now >= (expiryDate ? new Date(expiryDate) : new Date(0));
  }
  return false;
}

/**
 * Generate expiry date for a credit grant.
 */
export function calculateExpiryDate(
  grantDate: string,
  expiryPolicy: 'never' | 'billing_cycle' | 'fixed_date',
  fixedExpiryDate?: string,
  periodEnd?: string,
): string | null {
  if (expiryPolicy === 'never') return null;
  if (expiryPolicy === 'fixed_date') return fixedExpiryDate ?? null;
  if (expiryPolicy === 'billing_cycle') return periodEnd ?? null;
  return null;
}

// ---------------------------------------------------------------------------
// Consumption validation
// ---------------------------------------------------------------------------

export function validateConsumption(
  currentBalance: number,
  requestedCredits: number,
  minBalance: number = 0,
): { allowed: boolean; reason?: string; resultingBalance: number } {
  const resultingBalance = currentBalance - requestedCredits;

  if (requestedCredits <= 0) {
    return { allowed: false, reason: 'Consumption must be positive', resultingBalance };
  }

  if (resultingBalance < minBalance) {
    return {
      allowed: false,
      reason: `Insufficient balance. Need ${requestedCredits} credits, have ${currentBalance}.`,
      resultingBalance,
    };
  }

  return { allowed: true, resultingBalance };
}

// ---------------------------------------------------------------------------
// Top-up processing
// ---------------------------------------------------------------------------

export function processTopUp(
  request: TopUpRequest,
  currentBalance: number,
): CreditLedgerEntry {
  const entry: CreditLedgerEntry = {
    id: `topup-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    subscriptionId: request.subscriptionId,
    type: 'top-up',
    amount: request.amount,
    balance: currentBalance + request.amount,
    referenceId: `topup-ref-${Date.now()}`,
    reason: request.reason,
    timestamp: new Date().toISOString(),
  };
  return entry;
}

// ---------------------------------------------------------------------------
// Renewal processing
// ---------------------------------------------------------------------------

export function processRenewal(
  snapshot: SubscriptionSnapshot,
): { newBalance: number; entries: CreditLedgerEntry[] } {
  const entries: CreditLedgerEntry[] = [];

  // If there are leftover credits (< threshold), don't carry forward
  const remainingThreshold = Math.floor(snapshot.creditsPerPeriod * 0.05); // 5%
  const carryForward = snapshot.currentBalance > remainingThreshold
    ? snapshot.currentBalance
    : 0;

  // Add renewal credits
  const newBalance = carryForward + snapshot.creditsPerPeriod;

  if (carryForward > 0) {
    entries.push({
      id: `renewal-carry-${Date.now()}`,
      subscriptionId: snapshot.subscriptionId,
      type: 'top-up',
      amount: carryForward,
      balance: newBalance,
      reason: 'Credit carry-forward from previous period',
      referenceId: 'carry-forward',
      timestamp: new Date().toISOString(),
    });
  }

  entries.push({
    id: `renewal-credits-${Date.now()}`,
    subscriptionId: snapshot.subscriptionId,
    type: 'renewal',
    amount: snapshot.creditsPerPeriod,
    balance: newBalance,
    reason: `Subscription renewal: ${snapshot.plan}`,
    referenceId: snapshot.subscriptionId,
    timestamp: new Date().toISOString(),
  });

  return { newBalance, entries };
}
