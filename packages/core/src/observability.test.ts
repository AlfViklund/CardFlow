import assert from 'node:assert';
import {
  dateRangeForPeriod,
  generateDateLabels,
  formatCents,
  calculateBudgetPct,
  forecastMonthly,
  generateBudgetAlerts,
} from './observability';

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

async function main() {
  console.log('Observability API Tests (1e153893)\n');
  console.log('='.repeat(50));

  await test('7d range has 7 days', () => {
    const labels = generateDateLabels('7d');
    assert.strictEqual(labels.length, 7);
  });

  await test('30d range has 30 days', () => {
    const labels = generateDateLabels('30d');
    assert.strictEqual(labels.length, 30);
  });

  await test('90d range has 90 days', () => {
    const labels = generateDateLabels('90d');
    assert.strictEqual(labels.length, 90);
  });

  await test('formatCents: under $1', () => {
    assert.strictEqual(formatCents(50), '50₵');
  });

  await test('formatCents: over $1', () => {
    assert.strictEqual(formatCents(350), '$3.50');
  });

  await test('calculateBudgetPct: 50%', () => {
    assert.strictEqual(calculateBudgetPct(1500, 3000), 50);
  });

  await test('calculateBudgetPct: capped at 100%', () => {
    assert.strictEqual(calculateBudgetPct(5000, 3000), 100);
  });

  await test('forecastMonthly: simple projection', () => {
    assert.strictEqual(forecastMonthly(100, 30), 3000);
  });

  await test('generateBudgetAlerts: no alerts when healthy', () => {
    const alerts = generateBudgetAlerts(500, 3000, 20, 20);
    assert.strictEqual(alerts.length, 0, `Expected no alerts, got ${alerts.length}`);
  });

  await test('generateBudgetAlerts: warning at 70%+', () => {
    const alerts = generateBudgetAlerts(2200, 3000, 20, 5);
    assert(alerts.some(a => a.type === 'warning'), 'Should have warning');
  });

  await test('generateBudgetAlerts: critical at 90%+', () => {
    const alerts = generateBudgetAlerts(2800, 3000, 20, 5);
    assert(alerts.some(a => a.type === 'critical'), 'Should have critical alert');
  });

  await test('generateBudgetAlerts: forecast exceeds budget', () => {
    const alerts = generateBudgetAlerts(1000, 3000, 100, 25); // 1000 + 2500 = 3500 > 3000
    assert(alerts.some(a => a.message.includes('Forecast')), 'Should have forecast warning');
  });

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log('All tests passed!');
}

main().catch((err) => { console.error(err); process.exit(1); });
