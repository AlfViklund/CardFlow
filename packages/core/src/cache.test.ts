import assert from 'node:assert';
import {
  generateCacheKey,
  hashInput,
  InMemoryGenerationCache,
  CacheHitTracker,
  DEFAULT_CACHE_CONFIG,
} from './cache';

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
  console.log('Caching Tests (db4252d5)\n');
  console.log('='.repeat(50));

  await test('generateCacheKey produces stable keys', () => {
    const key1 = generateCacheKey({
      promptHash: 'abc123',
      modelId: 'dall-e-3',
      seed: 42,
      resolution: '2000x2000',
    });
    const key2 = generateCacheKey({
      promptHash: 'abc123',
      modelId: 'dall-e-3',
      seed: 42,
      resolution: '2000x2000',
    });
    assert.strictEqual(key1, key2, 'Same inputs should produce same cache key');
  });

  await test('generateCacheKey differs with different seeds', () => {
    const key1 = generateCacheKey({ promptHash: 'abc', modelId: 'm1', seed: 1 });
    const key2 = generateCacheKey({ promptHash: 'abc', modelId: 'm1', seed: 2 });
    assert.notStrictEqual(key1, key2);
  });

  await test('generateCacheKey differs with different models', () => {
    const key1 = generateCacheKey({ promptHash: 'abc', modelId: 'dall-e-3' });
    const key2 = generateCacheKey({ promptHash: 'abc', modelId: 'sdxl' });
    assert.notStrictEqual(key1, key2);
  });

  await test('hashInput is deterministic', () => {
    const h1 = hashInput('hello world');
    const h2 = hashInput('hello world');
    assert.strictEqual(h1, h2);
    assert(hashInput('hello').length > 0);
  });

  await test('cache set and get roundtrip', () => {
    const cache = new InMemoryGenerationCache();
    cache.set('test-key', {
      resultId: 'r-1',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      outputRefs: ['url-1', 'url-2'],
    });

    const result = cache.get('test-key');
    assert(result, 'Should find cached result');
    assert.strictEqual(result?.resultId, 'r-1');
    assert.strictEqual(result?.hitCount, 1); // incremented on access
  });

  await test('cache returns null for missing keys', () => {
    const cache = new InMemoryGenerationCache();
    assert(cache.get('nonexistent') === null);
  });

  await test('track cache hit rate', () => {
    const tracker = new CacheHitTracker();
    tracker.registerMiss();
    tracker.registerHit();
    tracker.registerHit();
    tracker.registerMiss();

    const stats = tracker.getStats();
    assert.strictEqual(stats.totalRequests, 4);
    assert.strictEqual(stats.cacheHits, 2);
    assert.strictEqual(stats.cacheMisses, 2);
    assert.strictEqual(stats.hitRate, 50);
  });

  await test('cache evicts on max entries', () => {
    const cache = new InMemoryGenerationCache({ maxEntries: 2 });
    cache.set('key1', { resultId: 'r1', createdAt: '', expiresAt: '', outputRefs: [] });
    cache.set('key2', { resultId: 'r2', createdAt: '', expiresAt: '', outputRefs: [] });
    cache.set('key3', { resultId: 'r3', createdAt: '', expiresAt: '', outputRefs: [] });

    // size should be 2 (oldest evicted)
    assert.strictEqual(cache.size, 2);
    assert(cache.get('key3'), 'newest should be present');
  });

  await test('cache clear removes all entries', () => {
    const cache = new InMemoryGenerationCache();
    cache.set('k1', { resultId: 'r1', createdAt: '', expiresAt: '', outputRefs: [] });
    cache.set('k2', { resultId: 'r2', createdAt: '', expiresAt: '', outputRefs: [] });
    cache.clear();
    assert.strictEqual(cache.size, 0);
  });

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log('All tests passed!');
}

main().catch((err) => { console.error(err); process.exit(1); });
