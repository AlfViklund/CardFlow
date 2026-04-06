/**
 * Unit tests for billing module (cbb08985).
 * Run: npx tsx packages/core/src/billing.test.ts
 */

import assert from 'node:assert';
import {
  getCreditsForPlan,
  isPlanHigher,
  isValidTransition,
  isSubscriptionCancelled,
  estimateJobCreditCost,
  hasSufficientCredits,
  PLAN_DEFINITIONS,
} from './billing';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${err}`);
    failed++;
  }
}

async function testPlanDefs() {
  console.log('\n1. Plan Definitions');

  await test('Free plan has 20 credits/month', () => {
    assert.strictEqual(getCreditsForPlan('free'), 20);
  });

  await test('Pro plan has 500 credits/month', () => {
    assert.strictEqual(getCreditsForPlan('pro'), 500);
  });

  await test('Enterprise has highest priority', () => {
    assert(PLAN_DEFINITIONS.enterprise.priorityLevel > PLAN_DEFINITIONS.pro.priorityLevel);
  });

  await test('Pro is higher than basic', () => {
    assert(isPlanHigher('pro', 'basic'));
    assert(!isPlanHigher('basic', 'pro'));
  });
}

async function testStateTransitions() {
  console.log('\n2. Subscription State Transitions');

  await test('active → cancelled is valid', () => {
    assert(isValidTransition('active', 'cancelled'));
  });

  await test('cancelled → active is valid (reactivate)', () => {
    assert(isValidTransition('cancelled', 'active'));
  });

  await test('active → expired is NOT valid', () => {
    assert(!isValidTransition('active', 'expired'));
  });

  await test('past_due → active is valid', () => {
    assert(isValidTransition('past_due', 'active'));
  });

  await test('cancelled and expired are cancelled states', () => {
    assert(isSubscriptionCancelled('cancelled'));
    assert(isSubscriptionCancelled('expired'));
    assert(!isSubscriptionCancelled('active'));
  });
}

async function testCreditCalculation() {
  console.log('\n3. Credit Calculation');

  await test('1K image = 2 credits', () => {
    assert.strictEqual(estimateJobCreditCost({ width: 1024, height: 1024, numImages: 1 }), 2);
  });

  await test('2K image = 3 credits', () => {
    assert.strictEqual(estimateJobCreditCost({ width: 2000, height: 2000, numImages: 1 }), 3);
  });

  await test('4 images cost 4x single', () => {
    const single = estimateJobCreditCost({ width: 1024, height: 1024, numImages: 1 });
    const quad = estimateJobCreditCost({ width: 1024, height: 1024, numImages: 4 });
    assert.strictEqual(quad, single * 4);
  });

  await test('hasSufficientCredits: enough balance', () => {
    const result = hasSufficientCredits(100, 50, 0, 20);
    assert(result.allowed);
    assert.strictEqual(result.balance, 50);
  });

  await test('hasSufficientCredits: insufficient balance', () => {
    const result = hasSufficientCredits(100, 90, 0, 20);
    assert(!result.allowed);
    assert.strictEqual(result.balance, 10);
  });

  await test('hasSufficientCredits: grants add to balance', () => {
    const result = hasSufficientCredits(100, 90, 30, 20);
    assert(result.allowed);
    assert.strictEqual(result.balance, 40);
  });
}

async function main() {
  console.log('Billing Tests (cbb08985)\n');
  console.log('='.repeat(50));

  await testPlanDefs();
  await testStateTransitions();
  await testCreditCalculation();

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) process.exit(1);
  console.log('All tests passed!');
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
