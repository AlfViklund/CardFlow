/**
 * Unit tests for the compliance validation engine (task d4118303).
 * Uses Node's built-in assert — no additional test framework needed.
 * Run: npx tsx packages/core/src/compliance.test.ts
 */

import assert from 'node:assert';
import {
  ComplianceValidator,
  buildComplianceReport,
  getMessageForRule,
  defaultWbRules,
  defaultOzonRules,
  getAllDefaultRules,
  validateCardCount,
} from './compliance';
import type { RuleCheckResult } from './index';

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

// ---------------------------------------------------------------------------
// 1. WB Prohibited content rules
// ---------------------------------------------------------------------------

async function testWbProhibitedContent() {
  console.log('\n1. WB Prohibited Content Rules');

  await test('wb_no_contact_info — detects email', () => {
    const rules = defaultWbRules();
    const v = new ComplianceValidator(rules);
    const results = v.validate({
      inputText: 'Связаться support@example.com',
      metadata: {},
      marketplaces: ['wildberries'],
    });
    const r = results.find((x) => x.ruleCode === 'wb_no_contact_info');
    assert(r, 'wb_no_contact_info rule should exist');
    assert.strictEqual(r?.passed, false, 'Should fail when email present');
    assert.strictEqual(r?.severity, 'critical');
  });

  await test('wb_no_contact_info — passes when clean', () => {
    const rules = defaultWbRules();
    const v = new ComplianceValidator(rules);
    const results = v.validate({
      inputText: 'Красная футболка без принта',
      metadata: {},
      marketplaces: ['wildberries'],
    });
    const r = results.find((x) => x.ruleCode === 'wb_no_contact_info');
    assert.strictEqual(r?.passed, true, 'Should pass when no contact info');
  });

  await test('wb_no_prices_in_image — detects price marker ₽', () => {
    const rules = defaultWbRules();
    const v = new ComplianceValidator(rules);
    const results = v.validate({
      inputText: 'Цена всего 1999 ₽ за комплект',
      metadata: {},
      marketplaces: ['wildberries'],
    });
    const r = results.find((x) => x.ruleCode === 'wb_no_prices_in_image');
    assert.strictEqual(r?.passed, false, 'Should fail when price marker present');
  });

  await test('wb_no_discounts — detects discount pattern -50%', () => {
    const rules = defaultWbRules();
    const v = new ComplianceValidator(rules);
    const results = v.validate({
      inputText: 'Распродажа -50% скидки на всё',
      metadata: {},
      marketplaces: ['wildberries'],
    });
    const r = results.find((x) => x.ruleCode === 'wb_no_discounts');
    assert.strictEqual(r?.passed, false, 'Should fail when discount present');
  });

  await test('wb_no_cta_text — detects "купи сейчас"', () => {
    const rules = defaultWbRules();
    const v = new ComplianceValidator(rules);
    const results = v.validate({
      inputText: 'Купи сейчас, не пропусти!',
      metadata: {},
      marketplaces: ['wildberries'],
    });
    const r = results.find((x) => x.ruleCode === 'wb_no_cta_text');
    assert.strictEqual(r?.passed, false, 'Should fail when CTA present');
  });

  await test('wb_no_evaluative_claims — detects "лучший"', () => {
    const rules = defaultWbRules();
    const v = new ComplianceValidator(rules);
    const results = v.validate({
      inputText: 'Лучший подарок для мамы #1 в рейтинге',
      metadata: {},
      marketplaces: ['wildberries'],
    });
    const r = results.find((x) => x.ruleCode === 'wb_no_evaluative_claims');
    assert.strictEqual(r?.passed, false, 'Should fail when evaluative claim present');
    assert.strictEqual(r?.severity, 'warning');
  });

  await test('wb_no_competitor_refs — detects "ozon"', () => {
    const rules = defaultWbRules();
    const v = new ComplianceValidator(rules);
    const results = v.validate({
      inputText: 'Доступно на ozon и wildberries',
      metadata: {},
      marketplaces: ['wildberries'],
    });
    const r = results.find((x) => x.ruleCode === 'wb_no_competitor_refs');
    assert.strictEqual(r?.passed, false, 'Should fail when competitor mentioned');
  });

  await test('wb_no_false_claims — detects "гарантия"', () => {
    const rules = defaultWbRules();
    const v = new ComplianceValidator(rules);
    const results = v.validate({
      inputText: 'Гарантия качества 100%, одобрено врачами',
      metadata: {},
      marketplaces: ['wildberries'],
    });
    const r = results.find((x) => x.ruleCode === 'wb_no_false_claims');
    assert.strictEqual(r?.passed, false, 'Should fail when false claim present');
    assert.strictEqual(r?.severity, 'warning');
  });
}

// ---------------------------------------------------------------------------
// 2. WB Format & resolution rules
// ---------------------------------------------------------------------------

async function testWbFormatResolution() {
  console.log('\n2. WB Format & Resolution Rules');

  await test('wb_min_900px — fails at 600px', () => {
    const rules = defaultWbRules();
    const v = new ComplianceValidator(rules);
    const results = v.validate({
      inputText: '',
      metadata: { width: 600, height: 600 },
      marketplaces: ['wildberries'],
    });
    const r = results.find((x) => x.ruleCode === 'wb_min_900px');
    assert.strictEqual(r?.passed, false, 'Should fail at 600px');
    assert.strictEqual(r?.severity, 'critical');
  });

  await test('wb_min_900px — passes at 1000px', () => {
    const rules = defaultWbRules();
    const v = new ComplianceValidator(rules);
    const results = v.validate({
      inputText: '',
      metadata: { width: 1000, height: 1200 },
      marketplaces: ['wildberries'],
    });
    const r = results.find((x) => x.ruleCode === 'wb_min_900px');
    assert.strictEqual(r?.passed, true, 'Should pass at 1000px');
  });

  await test('wb_format — fails for unsupported format (gif)', () => {
    const rules = defaultWbRules();
    const v = new ComplianceValidator(rules);
    const results = v.validate({
      inputText: '',
      metadata: { mimeType: 'image/gif' },
      marketplaces: ['wildberries'],
    });
    const r = results.find((x) => x.ruleCode === 'wb_format_jpeg_png_webp');
    assert.strictEqual(r?.passed, false, 'Should fail for gif');
  });

  await test('wb_format — passes for jpeg', () => {
    const rules = defaultWbRules();
    const v = new ComplianceValidator(rules);
    const results = v.validate({
      inputText: '',
      metadata: { mimeType: 'image/jpeg' },
      marketplaces: ['wildberries'],
    });
    const r = results.find((x) => x.ruleCode === 'wb_format_jpeg_png_webp');
    assert.strictEqual(r?.passed, true, 'Should pass for jpeg');
  });

  await test('wb_aspect_ratio — passes 1:1', () => {
    const rules = defaultWbRules();
    const v = new ComplianceValidator(rules);
    const results = v.validate({
      inputText: '',
      metadata: { width: 1000, height: 1000 },
      marketplaces: ['wildberries'],
    });
    const r = results.find((x) => x.ruleCode === 'wb_aspect_ratio');
    assert.strictEqual(r?.passed, true, 'Should pass 1:1');
  });

  await test('wb_aspect_ratio — passes 3:4', () => {
    const rules = defaultWbRules();
    const v = new ComplianceValidator(rules);
    const results = v.validate({
      inputText: '',
      metadata: { width: 900, height: 1200 },
      marketplaces: ['wildberries'],
    });
    const r = results.find((x) => x.ruleCode === 'wb_aspect_ratio');
    assert.strictEqual(r?.passed, true, 'Should pass 3:4');
  });
}

// ---------------------------------------------------------------------------
// 3. Ozon-specific rules
// ---------------------------------------------------------------------------

async function testOzonRules() {
  console.log('\n3. Ozon Rules');

  await test('ozon_no_contact_info — detects email', () => {
    const rules = defaultOzonRules();
    const v = new ComplianceValidator(rules);
    const results = v.validate({
      inputText: 'Email: test@test.ru',
      metadata: {},
      marketplaces: ['ozon'],
    });
    const r = results.find((x) => x.ruleCode === 'ozon_no_contact_info');
    assert.strictEqual(r?.passed, false, 'Should detect contact info');
  });

  await test('ozon_min_res — fails at 300px', () => {
    const rules = defaultOzonRules();
    const v = new ComplianceValidator(rules);
    const results = v.validate({
      inputText: '',
      metadata: { width: 300, height: 300 },
      marketplaces: ['ozon'],
    });
    const r = results.find((x) => x.ruleCode === 'ozon_min_res');
    assert.strictEqual(r?.passed, false, 'Should fail at 300px');
  });

  await test('ozon_min_res — passes at 500px', () => {
    const rules = defaultOzonRules();
    const v = new ComplianceValidator(rules);
    const results = v.validate({
      inputText: '',
      metadata: { width: 500, height: 500 },
      marketplaces: ['ozon'],
    });
    const r = results.find((x) => x.ruleCode === 'ozon_min_res');
    assert.strictEqual(r?.passed, true, 'Should pass at 500px');
  });

  await test('ozon_format — passes heic (Ozon allows)', () => {
    const rules = defaultOzonRules();
    const v = new ComplianceValidator(rules);
    const results = v.validate({
      inputText: '',
      metadata: { mimeType: 'image/heic' },
      marketplaces: ['ozon'],
    });
    const r = results.find((x) => x.ruleCode === 'ozon_format_requirements');
    assert.strictEqual(r?.passed, true, 'Should pass heic for Ozon');
  });
}

// ---------------------------------------------------------------------------
// 4. Dual-marketplace strictest rules
// ---------------------------------------------------------------------------

async function testDualMarketplace() {
  console.log('\n4. Dual Marketplace Strictness');

  await test('WB+Ozon includes both WB and Ozon rules', () => {
    const rules = getAllDefaultRules();
    const wbRules = rules.filter((r) => r.marketplace === 'wildberries');
    const ozonRules = rules.filter((r) => r.marketplace === 'ozon');
    assert(wbRules.length > 0, 'Should have WB rules');
    assert(ozonRules.length > 0, 'Should have Ozon rules');
    assert(wbRules.length > 10, 'Should have extensive WB rules');
  });

  await test('WB+Ozon triggers failure for both marketplace rules', () => {
    const rules = getAllDefaultRules();
    const v = new ComplianceValidator(rules);
    const results = v.validate({
      inputText: 'Связаться на test@test.ru, доступно на ozon',
      metadata: {},
      marketplaces: ['wildberries', 'ozon'],
    });
    const wbFailure = results.find((x) => x.ruleCode === 'wb_no_contact_info');
    const ozonFailure = results.find((x) => x.ruleCode === 'ozon_no_contact_info');
    assert.strictEqual(wbFailure?.passed, false, 'WB rule should fail');
    assert.strictEqual(ozonFailure?.passed, false, 'Ozon rule should fail');
  });

  await test('WB+Ozon triggers strictness for Ozon-specific violations', () => {
    const rules = getAllDefaultRules();
    const v = new ComplianceValidator(rules);
    const results = v.validate({
      inputText: '',
      metadata: { width: 350, height: 350 },
      marketplaces: ['wildberries', 'ozon'],
    });
    // WB minimum is 900px, Ozon is 400px — both should fail
    const wbMin = results.find((x) => x.ruleCode === 'wb_min_900px');
    const ozonMin = results.find((x) => x.ruleCode === 'ozon_min_res');
    assert.strictEqual(wbMin?.passed, false, 'WB 900px should fail at 350');
    assert.strictEqual(ozonMin?.passed, false, 'Ozon 400px should fail at 350');
  });
}

// ---------------------------------------------------------------------------
// 5. Card count limits
// ---------------------------------------------------------------------------

async function testCardCountLimits() {
  console.log('\n5. Card Count Limits');

  await test('WB: 8 cards passes', () => {
    const r = validateCardCount(8, ['wildberries']);
    assert.strictEqual(r.passed, true, '8 cards should pass');
  });

  await test('WB: 15 cards warns (above recommended, below max)', () => {
    const r = validateCardCount(15, ['wildberries']);
    assert.strictEqual(r.passed, false, '15 cards should fail (warning)');
    assert.strictEqual(r.severity, 'warning', 'Should be warning severity');
  });

  await test('WB: 31 cards blocks (above max)', () => {
    const r = validateCardCount(31, ['wildberries']);
    assert.strictEqual(r.passed, false, '31 cards should fail (critical)');
    assert.strictEqual(r.severity, 'critical', 'Should be critical severity');
  });

  await test('WB+Ozon: 15 cards warns (strictest applies)', () => {
    const r = validateCardCount(15, ['wildberries', 'ozon']);
    assert.strictEqual(r.passed, false, '15 cards should warn with both marketplaces');
    assert.strictEqual(r.severity, 'warning');
  });
}

// ---------------------------------------------------------------------------
// 6. Compliance scoring
// ---------------------------------------------------------------------------

async function testComplianceScoring() {
  console.log('\n6. Compliance Scoring');

  await test('All pass → score 100', () => {
    const results: RuleCheckResult[] = [
      { ruleCode: 'wb_test1', passed: true, severity: 'critical', detail: '' },
      { ruleCode: 'wb_test2', passed: true, severity: 'warning', detail: '' },
    ];
    const report = buildComplianceReport(results, ['wildberries']);
    assert.strictEqual(report.score, 100);
    assert.strictEqual(report.criticalFailures, 0);
    assert.strictEqual(report.warnings, 0);
    assert.strictEqual(report.status, 'passed');
  });

  await test('1 critical failure → score 70, status failed', () => {
    const results: RuleCheckResult[] = [
      { ruleCode: 'wb_test1', passed: false, severity: 'critical', detail: '' },
      { ruleCode: 'wb_test2', passed: true, severity: 'warning', detail: '' },
    ];
    const report = buildComplianceReport(results, ['wildberries']);
    assert.strictEqual(report.score, 70);
    assert.strictEqual(report.criticalFailures, 1);
    assert.strictEqual(report.status, 'failed');
  });

  await test('2 warnings → score 80, status warning', () => {
    const results: RuleCheckResult[] = [
      { ruleCode: 'wb_test1', passed: false, severity: 'warning', detail: '' },
      { ruleCode: 'wb_test2', passed: false, severity: 'warning', detail: '' },
    ];
    const report = buildComplianceReport(results, ['wildberries']);
    assert.strictEqual(report.score, 80);
    assert.strictEqual(report.warnings, 2);
    assert.strictEqual(report.status, 'warning');
  });

  await test('Score clamps to 0 minimum', () => {
    const results: RuleCheckResult[] = Array(10).fill(null).map((_, i) => ({
      ruleCode: `wb_test${i}`,
      passed: false,
      severity: 'critical' as const,
      detail: '',
    }));
    const report = buildComplianceReport(results, ['wildberries']);
    assert.strictEqual(report.score, 0, 'Score should be clamped to 0');
  });
}

// ---------------------------------------------------------------------------
// 7. Russian messages
// ---------------------------------------------------------------------------

async function testRussianMessages() {
  console.log('\n7. Russian Messages in Report');

  const rules = defaultWbRules();
  const v = new ComplianceValidator(rules);
  const results = v.validate({
    inputText: 'Купи сейчас support@test.com лучший #1 ozon гарантия 1999 ₽ -50% скидка',
    metadata: { width: 500 },
    marketplaces: ['wildberries'],
  });
  const report = buildComplianceReport(results, ['wildberries']);

  // All messages should contain Cyrillic characters (Russian)
  const cyrillicRe = /[\u0400-\u04FF]/;
  for (const msg of report.messages) {
    assert(cyrillicRe.test(msg), `Message should be in Russian: "${msg}"`);
  }

  await test('All report messages are in Russian', () => {
    assert(report.messages.length > 0);
    for (const msg of report.messages) {
      assert(cyrillicRe.test(msg), `Message should be in Russian: "${msg}"`);
    }
  });

  // Verify specific rule messages exist
  await test('getMessageForRule returns Russian for wb_no_contact_info failed', () => {
    const msg = getMessageForRule('wb_no_contact_info', false);
    assert(cyrillicRe.test(msg), `Should be Russian: "${msg}"`);
    assert(msg.includes('Обнаружена'), 'Should contain "Обнаружена"');
  });

  await test('getMessageForRule returns Russian for wb_no_contact_info passed', () => {
    const msg = getMessageForRule('wb_no_contact_info', true);
    assert(cyrillicRe.test(msg), `Should be Russian: "${msg}"`);
    assert(msg.includes('не обнаружена'), 'Should contain "не обнаружена"');
  });
}

// ---------------------------------------------------------------------------
// 8. Export gating
// ---------------------------------------------------------------------------

async function testExportGating() {
  console.log('\n8. Export Gating');

  await test('Critical failures block export', () => {
    const rules = defaultWbRules();
    const v = new ComplianceValidator(rules);
    const results = v.validate({
      inputText: 'Связаться: email@test.ru',
      metadata: {},
      marketplaces: ['wildberries'],
    });
    const report = buildComplianceReport(results, ['wildberries']);
    assert.strictEqual(report.status, 'failed', 'Should be failed');
    assert(report.criticalFailures > 0, 'Should have critical failures');
  });

  await test('No critical failures → export allowed', () => {
    const results: RuleCheckResult[] = [
      { ruleCode: 'wb_test', passed: true, severity: 'critical', detail: '' },
      { ruleCode: 'wb_test2', passed: true, severity: 'warning', detail: '' },
    ];
    const report = buildComplianceReport(results, ['wildberries']);
    assert.strictEqual(report.status, 'passed', 'Should be passed');
    assert.strictEqual(report.criticalFailures, 0, 'No critical failures');
  });

  await test('Warnings only → export allowed but flagged', () => {
    const results: RuleCheckResult[] = [
      { ruleCode: 'wb_test', passed: false, severity: 'warning', detail: '' },
    ];
    const report = buildComplianceReport(results, ['wildberries']);
    assert.strictEqual(report.status, 'warning', 'Should be warning');
    assert.strictEqual(report.criticalFailures, 0, 'No critical failures');
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Compliance Validation Tests (d4118303)\n');
  console.log('='.repeat(50));

  await testWbProhibitedContent();
  await testWbFormatResolution();
  await testOzonRules();
  await testDualMarketplace();
  await testCardCountLimits();
  await testComplianceScoring();
  await testRussianMessages();
  await testExportGating();

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
