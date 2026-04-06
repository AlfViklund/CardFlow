/**
 * Credits ledger and subscription billing models (task cbb08985).
 *
 * Types, plan definitions, and subscription state machine for the billing layer.
 * No payment provider — internal ledger only.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export type SubscriptionPlan = 'free' | 'basic' | 'pro' | 'enterprise';
export type SubscriptionStatus = 'active' | 'past_due' | 'cancelled' | 'expired';
export type CreditTransactionType = 'purchase' | 'consumption' | 'grant' | 'refund';

// ---------------------------------------------------------------------------
// Plan definitions
// ---------------------------------------------------------------------------

export interface PlanDefinition {
  plan: SubscriptionPlan;
  creditsPerMonth: number;
  maxJobsPerDay: number;
  maxResolution: string;
  priorityLevel: number;
  priceCentsPerMonth: number;
}

export const PLAN_DEFINITIONS: Record<SubscriptionPlan, PlanDefinition> = {
  free: {
    plan: 'free',
    creditsPerMonth: 20,
    maxJobsPerDay: 3,
    maxResolution: '1024x1024',
    priorityLevel: 0,
    priceCentsPerMonth: 0,
  },
  basic: {
    plan: 'basic',
    creditsPerMonth: 100,
    maxJobsPerDay: 20,
    maxResolution: '2000x2000',
    priorityLevel: 1,
    priceCentsPerMonth: 999,   // $9.99
  },
  pro: {
    plan: 'pro',
    creditsPerMonth: 500,
    maxJobsPerDay: 100,
    maxResolution: '2000x2000',
    priorityLevel: 2,
    priceCentsPerMonth: 2999,  // $29.99
  },
  enterprise: {
    plan: 'enterprise',
    creditsPerMonth: 5000,
    maxJobsPerDay: 500,
    maxResolution: '4000x4000',
    priorityLevel: 3,
    priceCentsPerMonth: 9999,  // $99.99
  },
};

/** Get credits allowance for a plan */
export function getCreditsForPlan(plan: SubscriptionPlan): number {
  return PLAN_DEFINITIONS[plan].creditsPerMonth;
}

/** Check if planA is higher than planB */
export function isPlanHigher(planA: SubscriptionPlan, planB: SubscriptionPlan): boolean {
  return PLAN_DEFINITIONS[planA].priorityLevel > PLAN_DEFINITIONS[planB].priorityLevel;
}

// ---------------------------------------------------------------------------
// Subscription state transitions
// ---------------------------------------------------------------------------

const ALLOWED_TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  active: ['past_due', 'cancelled'],
  past_due: ['active', 'cancelled', 'expired'],
  cancelled: ['active', 'expired'],
  expired: ['active'],
};

const CANCELLED_STATES: SubscriptionStatus[] = ['cancelled', 'expired'];

/** Validate a status transition */
export function isValidTransition(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isSubscriptionCancelled(status: SubscriptionStatus): boolean {
  return CANCELLED_STATES.includes(status);
}

// ---------------------------------------------------------------------------
// Credit consumption
// ---------------------------------------------------------------------------

export interface CreditConsumptionEvent {
  subscriptionId: string;
  jobId: string;
  amount: number;
}

export interface CreditGrantEvent {
  subscriptionId: string;
  reason: string;
  amount: number;
}

/**
 * Calculate how many credits a job costs based on resolution and count.
 * Simplified pricing: base cost + per-resolution multiplier.
 */
export function estimateJobCreditCost(params: {
  width?: number;
  height?: number;
  numImages?: number;
}): number {
  const width = params.width ?? 1024;
  const height = params.height ?? 1024;
  const num = params.numImages ?? 1;

  // Base cost per image (1 credit for 1K, 2 for 2K)
  const pixels = width * height;
  let baseCost = 1;
  if (pixels > 3_000_000) baseCost = 3;        // ~2K
  else if (pixels > 1_000_000) baseCost = 2;    // ~1K

  return baseCost * num;
}

/**
 * Check if a subscription has enough credits.
 */
export function hasSufficientCredits(
  planCredits: number,
  usedCredits: number,
  additionalGrants: number,
  required: number,
): { allowed: boolean; balance: number; required: number } {
  const balance = planCredits - usedCredits + additionalGrants;
  return {
    allowed: balance >= required,
    balance,
    required,
  };
}
