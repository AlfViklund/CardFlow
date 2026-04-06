import assert from 'node:assert';
import {
  checkBudgetCap,
  checkCreditLevel,
  generateSpendAlerts,
  canCreateJob,
  DEFAULT_ALERT_CONFIG,
} from './alerts';

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
  console.log('Cost-Control Alerts Tests (d403c990)\n');
  console.log('='.repeat(50));

  await test('checkBudgetCap: ok when under 80%', () => {
    assert.strictEqual(checkBudgetCap(500, 1000, 'daily'), 'ok');
  });

  await test('checkBudgetCap: warning at 80%+', () => {
    assert.strictEqual(checkBudgetCap(800, 1000, 'daily'), 'warning');
  });

  await test('checkBudgetCap: blocked at 100%', () => {
    assert.strictEqual(checkBudgetCap(1000, 1000, 'daily'), 'blocked');
  });

  await test('checkBudgetCap: no budget = ok', () => {
    assert.strictEqual(checkBudgetCap(9999, 0, 'daily'), 'ok');
  });

  await test('checkCreditLevel: ok when above threshold', () => {
    assert.strictEqual(
      checkCreditLevel(250, 1000, DEFAULT_ALERT_CONFIG),
      'ok',
    );
  });

  await test('checkCreditLevel: low at 5%', () => {
    assert.strictEqual(
      checkCreditLevel(150, 1000, DEFAULT_ALERT_CONFIG),
      'low',
    );
  });

  await test('checkCreditLevel: critical at 2%', () => {
    assert.strictEqual(
      checkCreditLevel(20, 1000, DEFAULT_ALERT_CONFIG),
      'critical',
    );
  });

  await test('canCreateJob: allowed under cap', () => {
    const result = canCreateJob('p1', 500, 3000, 200, 100);
    assert(result.allowed, `Should be allowed, got: ${result.reason}`);
  });

  await test('canCreateJob: blocked by hard cap', () => {
    const result = canCreateJob('p1', 3000, 3000, 200, 100);
    assert(!result.allowed);
    assert(result.reason?.includes('Spend cap'));
  });

  await test('canCreateJob: blocked by insufficient credits', () => {
    const result = canCreateJob('p1', 500, 3000, 50, 100);
    assert(!result.allowed);
    assert(result.reason?.includes('Insufficient credits'));
  });

  await test('generateSpendAlerts: no alerts when healthy', () => {
    const alerts = generateSpendAlerts('p1', {
      dailyCents: 200,
      weeklyCents: 1000,
      monthlyCents: 5000,
    }, { remaining: 500, total: 1000 });
    assert(alerts.length === 0, `Expected 0 alerts, got ${alerts.length}`);
  });

  await test('generateSpendAlerts: budget warning at 80%', () => {
    const alerts = generateSpendAlerts('p1', {
      dailyCents: 850, // 85% of 1000
      weeklyCents: 1000,
      monthlyCents: 5000,
    }, { remaining: 500, total: 1000 });
    assert(alerts.some(a => a.type === 'budget_warning'), 'Should have budget warning');
  });

  await test('generateSpendAlerts: critical credit at 2%', () => {
    const alerts = generateSpendAlerts('p1', {
      dailyCents: 100,
      weeklyCents: 500,
      monthlyCents: 2000,
    }, { remaining: 20, total: 1000 }); // 2%
    assert(alerts.some(a => a.type === 'low_credit' && a.severity === 'critical'), 'Should have critical credit alert');
  });

  await test('generateSpendAlerts: spend cap blocks generation', () => {
    const config = { ...DEFAULT_ALERT_CONFIG, hardSpendCapCents: 5000 };
    const alerts = generateSpendAlerts('p1', {
      dailyCents: 100,
      weeklyCents: 500,
      monthlyCents: 6000, // exceeds cap
    }, { remaining: 500, total: 1000 }, config);
    assert(alerts.some(a => a.type === 'spend_cap_blocked'), 'Should have spend cap blocked alert');
  });

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log('All tests passed!');
}

main().catch((err) => { console.error(err); process.exit(1); });
