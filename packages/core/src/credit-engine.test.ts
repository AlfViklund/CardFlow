import assert from 'node:assert';
import {
  validateConsumption,
  processTopUp,
  processRenewal,
  shouldExpireCredits,
  calculateExpiryDate,
  calculateNextRenewal,
  shouldRenew,
} from './credit-engine';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (err) { console.error(`  ❌ ${name}\n     ${err}`); failed++; }
}

async function main() {
  console.log('Credit Engine Tests (9f473bcd)\n');
  console.log('='.repeat(50));

  await test('validateConsumption: allowed with sufficient balance', () => {
    const result = validateConsumption(500, 50);
    assert(result.allowed);
    assert.strictEqual(result.resultingBalance, 450);
  });

  await test('validateConsumption: blocked if insufficient', () => {
    const result = validateConsumption(50, 100);
    assert(!result.allowed);
    assert(result.reason?.includes('Insufficient'));
  });

  await test('validateConsumption: blocked if zero consumption', () => {
    const result = validateConsumption(500, 0);
    assert(!result.allowed);
    assert(result.reason?.includes('positive'));
  });

  await test('validateConsumption: respects minBalance', () => {
    const result = validateConsumption(100, 80, 50);
    assert(!result.allowed);
    assert.strictEqual(result.resultingBalance, 20);
  });

  await test('processTopUp: adds credits correctly', () => {
    const entry = processTopUp(
      { subscriptionId: 's1', amount: 100, method: 'manual', reason: 'manual top-up' },
      200,
    );
    assert.strictEqual(entry.balance, 300);
    assert.strictEqual(entry.amount, 100);
    assert.strictEqual(entry.type, 'top-up');
  });

  await test('processRenewal: resets credits + carry-forward', () => {
    const result = processRenewal({
      subscriptionId: 's1', plan: 'pro', status: 'active',
      currentBalance: 50, creditsPerPeriod: 500,
      consumedThisPeriod: 450, periodEnd: '2026-05-01',
      autoRenew: true, expiryWarning: false, lowCreditWarning: true,
    });
    assert(result.newBalance > 500); // 50 carry + 500 renewal
    assert.strictEqual(result.entries.length, 2);
    assert(result.entries[0].type === 'top-up');
    assert(result.entries[1].type === 'renewal');
  });

  await test('processRenewal: skips carry-forward for tiny balance', () => {
    const result = processRenewal({
      subscriptionId: 's1', plan: 'basic', status: 'active',
      currentBalance: 10, creditsPerPeriod: 500,
      consumedThisPeriod: 90, periodEnd: '2026-05-01',
      autoRenew: true, expiryWarning: false, lowCreditWarning: true,
    });
    assert.strictEqual(result.newBalance, 500); // 10 < 5% = 25, no carry
    assert.strictEqual(result.entries.length, 1); // only renewal entry
  });

  await test('shouldExpireCredits: never policy never expires', () => {
    assert(!shouldExpireCredits('2026-01-01', null, 'none', new Date('2027-01-01')));
  });

  await test('shouldExpireCredits: billing_cycle expires after periodEnd', () => {
    const past = new Date('2025-01-01').toISOString();
    const future = new Date('2027-01-01').toISOString();
    assert(shouldExpireCredits('2026-01-01', past, 'billing_cycle', new Date(future)));
    assert(!shouldExpireCredits('2026-01-01', future, 'billing_cycle', new Date('2026-06-01')));
  });

  await test('calculateNextRenewal: monthly adds 1 month', () => {
    const next = calculateNextRenewal('2026-01-15', 'monthly');
    assert(next.includes('2026-02'));
  });

  await test('calculateNextRenewal: never returns empty', () => {
    assert.strictEqual(calculateNextRenewal('2026-01-15', 'never'), '');
  });

  await test('shouldRenew: returns false if period not ended', () => {
    assert(!shouldRenew(new Date('2026-01-01'), '2026-02-01', true, 'monthly'));
  });

  await test('shouldRenew: returns true if auto-renew and period ended', () => {
    assert(shouldRenew(new Date('2026-03-01'), '2026-02-01', true, 'monthly'));
  });

  await test('shouldRenew: returns false if autoRenew=false', () => {
    assert(!shouldRenew(new Date('2027-01-01'), '2026-01-01', false, 'monthly'));
  });

  await test('calculateExpiryDate: fixed_date returns date', () => {
    const exp = calculateExpiryDate('2026-01-01', 'fixed_date', '2026-12-31');
    assert.strictEqual(exp, '2026-12-31');
  });

  await test('calculateExpiryDate: never returns null', () => {
    assert.strictEqual(calculateExpiryDate('2026-01-01', 'never'), null);
  });

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log('All tests passed!');
}

main().catch((err) => { console.error(err); process.exit(1); });
