/**
 * Unit tests for the quality-risk scoring engine (task ca05a06d).
 * Run: npx tsx packages/core/src/quality.test.ts
 */

import assert from 'node:assert';
import {
  analyzeQuality,
  scoreSharpness,
  scoreResolution,
  scoreLighting,
  scoreBackground,
  scoreProductVisibility,
  makeGatingDecision,
  generateQualityReport,
  type QualityAnalysisInput,
} from './quality';

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

// Sample inputs
const goodImage: QualityAnalysisInput = {
  width: 1200,
  height: 1200,
  fileSizeBytes: 800_000,
  mimeType: 'image/jpeg',
  brightness: 145,
  hasWatermark: false,
  brief: 'Стильная красная куртка, размер 48',
};

const poorImage: QualityAnalysisInput = {
  width: 200,
  height: 200,
  fileSizeBytes: 5_000,
  mimeType: 'image/png',
  brightness: 30,
  hasWatermark: true,
  brief: 'photo',
};

const mediumImage: QualityAnalysisInput = {
  width: 800,
  height: 600,
  fileSizeBytes: 200_000,
  mimeType: 'image/jpeg',
  brightness: 110,
  hasWatermark: false,
  brief: 'Товар для маркетплейса',
};

// ---------------------------------------------------------------------------
// 1. Sharpness scoring
// ---------------------------------------------------------------------------

async function testSharpnessScoring() {
  console.log('\n1. Sharpness Scoring');

  await test('High-res JPEG scores well', () => {
    const result = scoreSharpness({ width: 2000, height: 2000, fileSizeBytes: 2_000_000, mimeType: 'image/jpeg' });
    assert(result.score >= 70, `Score should be >= 70 for 4MP image, got ${result.score}`);
    assert.strictEqual(result.status, 'pass');
  });

  await test('Very low-res scores poorly', () => {
    const result = scoreSharpness({ width: 100, height: 100, fileSizeBytes: 5_000, mimeType: 'image/jpeg' });
    assert(result.score <= 30, `Score should be <= 30 for 100x100, got ${result.score}`);
  });

  await test('HEIC gets quality bonus', () => {
    const result1 = scoreSharpness({ width: 1000, height: 1000, fileSizeBytes: 1_000_000, mimeType: 'image/jpeg' });
    const result2 = scoreSharpness({ width: 1000, height: 1000, fileSizeBytes: 1_000_000, mimeType: 'image/heic' });
    assert(result2.score >= result1.score, 'HEIC should score same or higher');
  });
}

// ---------------------------------------------------------------------------
// 2. Resolution scoring
// ---------------------------------------------------------------------------

async function testResolutionScoring() {
  console.log('\n2. Resolution Scoring');

  await test('WB threshold: 900px minimum', () => {
    const pass = scoreResolution({ width: 1200, height: 1200, fileSizeBytes: 1_000_000, mimeType: 'image/jpeg' }, ['wildberries']);
    assert(pass.status === 'pass', `1200x1200 should pass WB, got status: ${pass.status}`);

    const fail = scoreResolution({ width: 500, height: 500, fileSizeBytes: 500_000, mimeType: 'image/jpeg' }, ['wildberries']);
    assert(fail.status === 'critical' || fail.status === 'warning', `500x500 should not pass WB`);
  });

  await test('Ozon threshold: 400px minimum', () => {
    const pass = scoreResolution({ width: 500, height: 500, fileSizeBytes: 500_000, mimeType: 'image/jpeg' }, ['ozon']);
    assert(pass.status === 'pass', `500x500 should pass Ozon`);

    const fail = scoreResolution({ width: 300, height: 300, fileSizeBytes: 300_000, mimeType: 'image/jpeg' }, ['ozon']);
    assert(fail.status !== 'pass', `300x300 should not pass Ozon`);
  });
}

// ---------------------------------------------------------------------------
// 3. Lighting scoring
// ---------------------------------------------------------------------------

async function testLightingScoring() {
  console.log('\n3. Lighting Scoring');

  await test('Good brightness (145) scores well', () => {
    const result = scoreLighting({ width: 1000, height: 1000, fileSizeBytes: 1_000_000, mimeType: 'image/jpeg', brightness: 145 });
    assert(result.score >= 50, `Score should be >= 50 for brightness 145, got ${result.score}`);
    assert.strictEqual(result.status, 'pass');
  });

  await test('Very dark image (brightness 10) scores poorly', () => {
    const result = scoreLighting({ width: 1000, height: 1000, fileSizeBytes: 1_000_000, mimeType: 'image/jpeg', brightness: 10 });
    assert(result.score < 40, `Score should be < 40 for brightness 10, got ${result.score}`);
  });

  await test('Overexposed image (brightness 240) warns', () => {
    const result = scoreLighting({ width: 1000, height: 1000, fileSizeBytes: 1_000_000, mimeType: 'image/jpeg', brightness: 240 });
    assert(result.status === 'warning', `Overexposed should warn`);
  });
}

// ---------------------------------------------------------------------------
// 4. Background scoring
// ---------------------------------------------------------------------------

async function testBackgroundScoring() {
  console.log('\n4. Background Scoring');

  await test('Standard ratio (1:1) scores well', () => {
    const result = scoreBackground({ width: 1000, height: 1000, fileSizeBytes: 1_000_000, mimeType: 'image/jpeg' });
    assert(result.score >= 60, `Standard ratio should score >= 60, got ${result.score}`);
  });

  await test('Watermark penalizes background score', () => {
    const noWatermark = scoreBackground({ width: 1000, height: 1000, fileSizeBytes: 1_000_000, mimeType: 'image/jpeg' });
    const withWatermark = scoreBackground({ width: 1000, height: 1000, fileSizeBytes: 1_000_000, mimeType: 'image/jpeg', hasWatermark: true });
    assert(withWatermark.score < noWatermark.score, 'Watermark should lower background score');
  });
}

// ---------------------------------------------------------------------------
// 5. Product visibility scoring
// ---------------------------------------------------------------------------

async function testProductVisibilityScoring() {
  console.log('\n5. Product Visibility Scoring');

  await test('Standard ratio scores well', () => {
    const result = scoreProductVisibility({ width: 1000, height: 1000, fileSizeBytes: 1_000_000, mimeType: 'image/jpeg' });
    assert(result.score >= 60, `Standard ratio should score >= 60`);
  });

  await test('Extreme aspect ratio (10:1) penalizes', () => {
    const result = scoreProductVisibility({ width: 2000, height: 200, fileSizeBytes: 500_000, mimeType: 'image/jpeg' });
    assert(result.score < 50, `Extreme ratio 10:1 should score < 50, got ${result.score}`);
    assert.strictEqual(result.status, 'critical');
  });

  await test('Tiny image penalizes', () => {
    const result = scoreProductVisibility({ width: 100, height: 100, fileSizeBytes: 5_000, mimeType: 'image/jpeg' });
    assert(result.score < 50, `Tiny image should score < 50, got ${result.score}`);
  });
}

// ---------------------------------------------------------------------------
// 6. Composite quality analysis
// ---------------------------------------------------------------------------

async function testCompositeAnalysis() {
  console.log('\n6. Composite Quality Analysis');

  await test('Good image scores >= 60', () => {
    const result = analyzeQuality(goodImage, ['wildberries']);
    assert(result.overallScore >= 60, `Good image should score >= 60, got ${result.overallScore}`);
    assert.strictEqual(result.gatingDecision, 'allowed');
  });

  await test('Poor image is blocked', () => {
    const result = analyzeQuality(poorImage, ['wildberries']);
    assert.strictEqual(result.gatingDecision, 'blocked');
    assert(result.risks.length > 0, 'Poor image should have risks');
  });

  await test('Dimension scores sum to weighted average', () => {
    const result = analyzeQuality(goodImage, ['wildberries']);
    const totalWeight = result.dimensionScores.reduce((sum, d) => sum + d.weight, 0);
    const weightedSum = result.dimensionScores.reduce((sum, d) => sum + d.score * d.weight, 0);
    const expected = Math.round(weightedSum / totalWeight);
    assert(result.overallScore === expected, `Composite score ${result.overallScore} should equal weighted avg ${expected}`);
  });
}

// ---------------------------------------------------------------------------
// 7. Gating decisions
// ---------------------------------------------------------------------------

async function testGatingDecisions() {
  console.log('\n7. Gating Decisions');

  await test('High score, no risks → allowed', () => {
    const result = makeGatingDecision(85, [], ['wildberries']);
    assert.strictEqual(result.decision, 'allowed');
  });

  await test('Score below WB block threshold (40) → blocked', () => {
    const result = makeGatingDecision(35, [], ['wildberries']);
    assert.strictEqual(result.decision, 'blocked');
  });

  await test('Critical risk → blocked regardless of score', () => {
    const result = makeGatingDecision(75, [
      { code: 'quality_test', severity: 'critical', detail: 'Critical issue', marketplaces: ['wildberries'] },
    ], ['wildberries']);
    assert.strictEqual(result.decision, 'blocked');
  });

  await test('Medium score → warning', () => {
    const result = makeGatingDecision(55, [
      { code: 'quality_test', severity: 'warning', detail: 'Minor issue', marketplaces: ['wildberries'] },
    ], ['wildberries']);
    assert.strictEqual(result.decision, 'warning');
  });

  await test('WB is stricter than Ozon at same score', () => {
    const wbResult = makeGatingDecision(45, [], ['wildberries']);
    const ozonResult = makeGatingDecision(45, [], ['ozon']);
    // WB blockBelow is 40, Ozon blockBelow is 30.
    // At 45, both should be allowed (45 > 40)
    // Let's test at 35 instead
    const wbBlocked = makeGatingDecision(35, [], ['wildberries']);
    const ozonAllowed = makeGatingDecision(35, [], ['ozon']);
    assert.strictEqual(wbBlocked.decision, 'blocked', 'WB should block at 35');
    assert.notStrictEqual(ozonAllowed.decision, 'blocked', 'Ozon should not block at 35');
  });

  await test('Compliance critical failure → blocked', () => {
    const result = makeGatingDecision(80, [], ['wildberries'], 1);
    assert.strictEqual(result.decision, 'blocked');
    assert(result.reason.includes('критическ'), 'Reason should mention compliance violations');
  });

  await test('Dual marketplace uses strictest threshold', () => {
    // At score 35: WB blocks (35 < 40), Ozon warns (35 >= 30)
    // Dual marketplace should use WB's stricter threshold → blocked
    const singleOzon = makeGatingDecision(35, [], ['ozon']);
    const dualMarket = makeGatingDecision(35, [], ['wildberries', 'ozon']);
    assert(dualMarket.decision === 'blocked', `Dual should block at 35, got ${dualMarket.decision}`);
    assert(singleOzon.decision !== 'blocked', `Ozon alone should not block at 35`);
  });
}

// ---------------------------------------------------------------------------
// 8. Russian report messages
// ---------------------------------------------------------------------------

async function testRussianReportMessages() {
  console.log('\n8. Russian Report Messages');

  await test('Quality report for good image contains Russian text', () => {
    const result = analyzeQuality(goodImage, ['wildberries']);
    const report = generateQualityReport(result, ['wildberries']);
    assert(report.includes('Анализ качества'), 'Report should have Russian title');
    assert(report.includes('✅') || report.includes('⚠️') || report.includes('❌'), 'Report should have status icons');
  });

  await test('Blocked report explains the issue in Russian', () => {
    const result = analyzeQuality(poorImage, ['wildberries']);
    const report = generateQualityReport(result, ['wildberries']);
    assert(report.includes('🔴') || report.includes('blocked') || report.includes('Заблокировано'), 'Report should indicate blocked status');
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Quality-Risk Scoring Tests (ca05a06d)\n');
  console.log('='.repeat(50));

  await testSharpnessScoring();
  await testResolutionScoring();
  await testLightingScoring();
  await testBackgroundScoring();
  await testProductVisibilityScoring();
  await testCompositeAnalysis();
  await testGatingDecisions();
  await testRussianReportMessages();

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
