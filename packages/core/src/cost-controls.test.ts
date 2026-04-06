/**
 * Unit tests for cost controls and rate-limiting (task 56cc7032).
 * Run: npx tsx packages/core/src/cost-controls.test.ts
 */

import assert from 'node:assert';
import {
  calculateTotalCost,
  costsByProvider,
  costsByCard,
  predictBatchCost,
  isRateLimited,
  checkBudget,
  generateBatchCostReport,
  DEFAULT_BUDGET_CONFIG,
  type CostEntry,
  type BudgetConfig,
  type RateLimitEntry,
} from './cost-controls';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

const sampleBudget: BudgetConfig = {
  projectId: 'proj-1',
  ...DEFAULT_BUDGET_CONFIG,
  maxCostPerBatch: 500, // $5 for testing (in cents)
  maxCostPerProject: 2000, // $20 for testing
  maxCostPerCard: 100, // $1 per card
  maxRatePerMinute: 5,
  maxRatePerHour: 50,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function testCostCalculation() {
  console.log('\n1. Cost Calculation');

  await test('Empty entries → total 0', () => {
    assert.strictEqual(calculateTotalCost([]), 0);
  });

  await test('Multiple entries sum correctly', () => {
    const entries: CostEntry[] = [
      { projectId: 'p', batchId: 'b1', cardNumber: 1, provider: 'openai', model: 'gpt4', cost: 100, timestamp: '2026-04-06T00:00:00Z' },
      { projectId: 'p', batchId: 'b1', cardNumber: 2, provider: 'openai', model: 'gpt4', cost: 200, timestamp: '2026-04-06T00:00:00Z' },
    ];
    assert.strictEqual(calculateTotalCost(entries), 300);
  });

  await test('Costs by provider aggregates correctly', () => {
    const entries: CostEntry[] = [
      { projectId: 'p', batchId: 'b', cardNumber: 1, provider: 'openai', model: 'gpt4', cost: 100, timestamp: '2026-04-06T00:00:00Z' },
      { projectId: 'p', batchId: 'b', cardNumber: 2, provider: 'stability', model: 'sdxl', cost: 200, timestamp: '2026-04-06T00:00:00Z' },
    ];
    const result = costsByProvider(entries);
    assert.strictEqual(result['openai'], 100);
    assert.strictEqual(result['stability'], 200);
  });

  await test('Costs by card aggregates correctly', () => {
    const entries: CostEntry[] = [
      { projectId: 'p', batchId: 'b', cardNumber: 1, provider: 'openai', model: 'gpt4', cost: 50, timestamp: '2026-04-06T00:00:00Z' },
      { projectId: 'p', batchId: 'b', cardNumber: 1, provider: 'openai', model: 'gpt4', cost: 30, timestamp: '2026-04-06T00:00:00Z' },
      { projectId: 'p', batchId: 'b', cardNumber: 2, provider: 'openai', model: 'gpt4', cost: 80, timestamp: '2026-04-06T00:00:00Z' },
    ];
    const result = costsByCard(entries);
    assert.strictEqual(result[1], 80);
    assert.strictEqual(result[2], 80);
  });
}

async function testPrediction() {
  console.log('\n2. Cost Prediction');

  await test('Batch within budget → allowed', () => {
    const result = predictBatchCost(8, 30, sampleBudget); // 8 cards x 30c = 240
    assert(result.allowed, `8x30=240 < 500 should be allowed`);
    assert.strictEqual(result.predictedCost, 240);
  });

  await test('Batch over budget → blocked', () => {
    const result = predictBatchCost(8, 100, sampleBudget); // 8 cards x 100c = 800
    assert(!result.allowed, `8x100=800 > 500 should be blocked`);
  });
}

async function testRateLimiting() {
  console.log('\n3. Rate Limiting');

  await test('Under per-minute limit → allowed', () => {
    const calls: RateLimitEntry[] = Array(3).fill(null).map(() => ({
      timestamp: new Date().toISOString(),
    }));
    const result = isRateLimited(calls, 5, 50);
    assert(!result.limited, '3/5 calls per minute should be allowed');
  });

  await test('Over per-minute limit → blocked with retry', () => {
    const calls: RateLimitEntry[] = Array(6).fill(null).map(() => ({
      timestamp: new Date().toISOString(),
    }));
    const result = isRateLimited(calls, 5, 50);
    assert(result.limited, '6/5 calls per minute should be limited');
    assert(result.reason.includes('6/5'), 'Reason should show exceeded count');
    assert(result.retryAfterMs && result.retryAfterMs > 0, 'Should have retry delay');
  });

  await test('Old calls don\'t count toward limit', () => {
    const now = new Date();
    const twoMinutesAgo = new Date(now.getTime() - 120 * 1000).toISOString();
    const calls: RateLimitEntry[] = Array(5).fill(null).map(() => ({
      timestamp: twoMinutesAgo,
    }));
    const result = isRateLimited(calls, 5, 50);
    assert(!result.limited, 'Old calls should not trigger limit');
  });
}

async function testBudget() {
  console.log('\n4. Budget Checking');

  await test('Under budget → all allowed', () => {
    const costs: CostEntry[] = [
      { projectId: 'p', batchId: 'b1', cardNumber: 1, provider: 'openai', model: 'gpt4', cost: 50, timestamp: new Date().toISOString() },
    ];
    const snapshot = checkBudget('proj-1', costs, sampleBudget, []);
    assert(snapshot.budgetStatus.perCardAllowed);
    assert(snapshot.budgetStatus.perBatchAllowed);
    assert(snapshot.budgetStatus.perProjectAllowed);
    assert(snapshot.budgetStatus.rateLimitAllowed);
  });

  await test('Over per-card budget → blocked', () => {
    const costs: CostEntry[] = [
      { projectId: 'p', batchId: 'b1', cardNumber: 1, provider: 'openai', model: 'gpt4', cost: 150, timestamp: new Date().toISOString() },
    ];
    const snapshot = checkBudget('proj-1', costs, sampleBudget, []);
    assert(!snapshot.budgetStatus.perCardAllowed, '150 > 100 should be blocked per card');
  });

  await test('Over per-batch budget → blocked', () => {
    const costs: CostEntry[] = [
      { projectId: 'p', batchId: 'b1', cardNumber: 1, provider: 'openai', model: 'gpt4', cost: 300, timestamp: new Date().toISOString() },
      { projectId: 'p', batchId: 'b1', cardNumber: 2, provider: 'openai', model: 'gpt4', cost: 300, timestamp: new Date().toISOString() },
    ];
    const snapshot = checkBudget('proj-1', costs, sampleBudget, []);
    assert(!snapshot.budgetStatus.perBatchAllowed, `600 > 500 should be blocked per batch`);
  });
}

async function testCostReport() {
  console.log('\n5. Cost Reporting');

  await test('Batch cost report aggregates correctly', () => {
    const entries: CostEntry[] = [
      { projectId: 'p', batchId: 'b1', cardNumber: 1, provider: 'openai', model: 'gpt4', cost: 100, timestamp: '2026-04-06T00:00:00Z' },
      { projectId: 'p', batchId: 'b1', cardNumber: 2, provider: 'stability', model: 'sdxl', cost: 200, timestamp: '2026-04-06T00:00:00Z' },
      { projectId: 'p', batchId: 'b2', cardNumber: 1, provider: 'openai', model: 'gpt4', cost: 50, timestamp: '2026-04-06T00:00:00Z' },
    ];

    const report = generateBatchCostReport('b1', entries);
    assert.strictEqual(report.batchId, 'b1');
    assert.strictEqual(report.totalCost, 300);
    assert.strictEqual(report.totalCards, 2);
    assert.strictEqual(report.costPerCard, 150);
    assert.strictEqual(report.costsByProvider['openai'], 100);
    assert.strictEqual(report.costsByProvider['stability'], 200);
  });

  await test('Empty batch report', () => {
    const report = generateBatchCostReport('empty', []);
    assert.strictEqual(report.totalCost, 0);
    assert.strictEqual(report.totalCards, 0);
    assert.strictEqual(report.costPerCard, 0);
  });
}

async function testDefaultBudgetConfig() {
  console.log('\n6. Default Budget Config');

  await test('Default values are reasonable', () => {
    assert.strictEqual(DEFAULT_BUDGET_CONFIG.maxCostPerBatch, 5000); // $50
    assert.strictEqual(DEFAULT_BUDGET_CONFIG.maxCostPerProject, 20000); // $200
    assert.strictEqual(DEFAULT_BUDGET_CONFIG.maxCostPerCard, 200); // $2
    assert.strictEqual(DEFAULT_BUDGET_CONFIG.maxRatePerMinute, 60);
    assert.strictEqual(DEFAULT_BUDGET_CONFIG.maxRatePerHour, 1000);
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Cost Controls Tests (56cc7032)\n');
  console.log('='.repeat(50));

  await testCostCalculation();
  await testPrediction();
  await testRateLimiting();
  await testBudget();
  await testCostReport();
  await testDefaultBudgetConfig();

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
  console.log('All tests passed!');
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
