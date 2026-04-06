import assert from 'node:assert';
import {
  maxBatchForResolution,
  estimateBatchCost,
  estimateBatchCompletionSec,
  planBatches,
  resolveResolution,
  isValidBatchTransition,
  isBatchFinished,
  RESOLUTION_TIERS,
} from './batching';

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
  console.log('Batching Engine Tests (9c6fe204)\n');
  console.log('='.repeat(50));

  await test('Resolution tiers defined correctly', () => {
    assert.strictEqual(RESOLUTION_TIERS['4k'].width, 4000);
    assert.strictEqual(RESOLUTION_TIERS['4k'].height, 4000);
    assert.strictEqual(RESOLUTION_TIERS['2k'].width, 2000);
  });

  await test('4K max batch size is 4', () => {
    assert.strictEqual(maxBatchForResolution('4k'), 4);
    assert.strictEqual(maxBatchForResolution('2k'), 15);
  });

  await test('4K costs 5x base cost', () => {
    const cost = estimateBatchCost('4k', 4, 3);
    assert.strictEqual(cost, Math.round(4 * 3 * 5));
  });

  await test('Batch planning splits into correct number of batches', () => {
    const batches = planBatches('4k', 12, 3);
    assert.strictEqual(batches.length, 3); // 12 / 4 = 3 batches
    assert.strictEqual(batches[0].jobCount, 4);
    assert.strictEqual(batches[2].jobCount, 4);
  });

  await test('Batch planning: partial last batch', () => {
    const batches = planBatches('2k', 20, 3); // max 15 per batch
    assert.strictEqual(batches.length, 2);
    assert.strictEqual(batches[0].jobCount, 15);
    assert.strictEqual(batches[1].jobCount, 5);
  });

  await test('resolveResolution: exact 2K matches 2K tier', () => {
    const result = resolveResolution(2000, 2000, '2k');
    assert.strictEqual(result.resolved.tier, '2k');
    assert(!result.downscaled);
  });

  await test('resolveResolution: 4K request capped at 2K max', () => {
    const result = resolveResolution(4000, 4000, '2k');
    assert.strictEqual(result.resolved.tier, '2k');
    assert(result.downscaled);
  });

  await test('resolveResolution: 720x720 resolves to 720p', () => {
    const result = resolveResolution(720, 720, '4k');
    assert.strictEqual(result.resolved.tier, '720p');
  });

  await test('Batch transition: queued → processing is valid', () => {
    assert(isValidBatchTransition('queued', 'processing'));
  });

  await test('Batch transition: queued → completed is NOT valid', () => {
    assert(!isValidBatchTransition('queued', 'completed'));
  });

  await test('Batch transition: failed → queued is valid (retry)', () => {
    assert(isValidBatchTransition('failed', 'queued'));
  });

  await test('isBatchFinished: completed/failed are finished', () => {
    assert(isBatchFinished('completed'));
    assert(isBatchFinished('failed'));
    assert(!isBatchFinished('processing'));
    assert(!isBatchFinished('queued'));
  });

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log('All tests passed!');
}

main().catch((err) => { console.error(err); process.exit(1); });
