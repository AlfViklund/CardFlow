/**
 * Unit tests for the layout rendering engine (task a057a6c7).
 * Run: npx tsx packages/core/src/layout-rendering.test.ts
 */

import assert from 'node:assert';
import {
  resolvePixelValue,
  resolveBox,
  contrastRatio,
  parseHexColor,
  checkTextContrast,
  wrapText,
  truncateToLines,
  validateLayoutSpec,
  mergeLayoutSpec,
  buildMarketplaceLayout,
  default2KPreset,
  wbLayoutPreset,
  ozonLayoutPreset,
  type LayoutSpec,
} from './layout-rendering';

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
// 1. Pixel resolution
// ---------------------------------------------------------------------------

async function testPixelResolution() {
  console.log('\n1. Pixel Resolution');

  await test('absolute returns exact value', () => {
    assert.strictEqual(resolvePixelValue({ type: 'absolute', px: 100 }, 2000), 100);
  });

  await test('percentage calculates correctly (50% of 2000 = 1000)', () => {
    assert.strictEqual(resolvePixelValue({ type: 'percent', pct: 50 }, 2000), 1000);
  });

  await test('percentage rounds (7% of 2000 = 140)', () => {
    assert.strictEqual(resolvePixelValue({ type: 'percent', pct: 7 }, 2000), 140);
  });

  await test('resolveBox computes all fields', () => {
    const resolved = resolveBox(
      {
        x: { type: 'percent', pct: 5 },
        y: { type: 'percent', pct: 70 },
        width: { type: 'percent', pct: 90 },
        height: { type: 'percent', pct: 25 },
      },
      2000,
      2000,
    );
    assert.strictEqual(resolved.x, 100);
    assert.strictEqual(resolved.y, 1400);
    assert.strictEqual(resolved.width, 1800);
    assert.strictEqual(resolved.height, 500);
    assert.strictEqual(resolved.padding, 0);
  });
}

// ---------------------------------------------------------------------------
// 2. Contrast calculation
// ---------------------------------------------------------------------------

async function testContrast() {
  console.log('\n2. Contrast Calculation');

  await test('black vs white = 21:1', () => {
    const ratio = contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 });
    assert(Math.abs(ratio - 21) < 0.1, `Expected ~21:1, got ${ratio}`);
  });

  await test('same color = 1:1', () => {
    const ratio = contrastRatio({ r: 128, g: 128, b: 128 }, { r: 128, g: 128, b: 128 });
    assert(Math.abs(ratio - 1) < 0.01, `Expected 1:1, got ${ratio}`);
  });

  await test('parseHexColor handles #rrggbb', () => {
    const c = parseHexColor('#ff0080');
    assert.strictEqual(c.r, 255);
    assert.strictEqual(c.g, 0);
    assert.strictEqual(c.b, 128);
  });

  await test('parseHexColor handles #rgb shorthand', () => {
    const c = parseHexColor('#f08');
    assert.strictEqual(c.r, 255);
    assert.strictEqual(c.g, 0);
    assert.strictEqual(c.b, 136);
  });

  await test('checkTextContrast passes black on white (WCAG AA)', () => {
    const result = checkTextContrast('#000000', '#ffffff', 4.5);
    assert(result.passes, 'Black on white should pass WCAG AA');
    assert(result.actualRatio >= 4.5);
  });

  await test('checkTextContrast fails light gray on white', () => {
    const result = checkTextContrast('#cccccc', '#ffffff', 4.5);
    assert(!result.passes, 'Light gray on white should fail');
    assert(result.suggestedColor, 'Should suggest alternative');
  });

  await test('checkTextContrast suggests black for light bg', () => {
    const result = checkTextContrast('#cccccc', '#ffffff');
    assert.strictEqual(result.suggestedColor, '#000000');
  });

  await test('checkTextContrast suggests white for dark bg', () => {
    const result = checkTextContrast('#333333', '#000000');
    assert.strictEqual(result.suggestedColor, '#ffffff');
  });
}

// ---------------------------------------------------------------------------
// 3. Text wrapping
// ---------------------------------------------------------------------------

async function testTextWrapping() {
  console.log('\n3. Text Wrapping');

  await test('Short text fits on one line', () => {
    const lines = wrapText('Hello World', 200, 10); // maxChars = 20
    assert.deepStrictEqual(lines, ['Hello World']);
  });

  await test('Long text wraps to multiple lines', () => {
    const lines = wrapText('This is a test of text wrapping functionality that should split into multiple lines', 30, 10); // maxChars = 3
    assert(lines.length > 1, `Should wrap to multiple lines, got ${lines.length}`);
  });

  await test('truncateToLines respects maxLines', () => {
    const text = 'Line1\nLine2\nLine3\nLine4\nLine5';
    const result = truncateToLines(text, 3);
    const resultLines = result.split('\n');
    assert(resultLines.length < 6, 'Should produce fewer or equal lines');
    assert(result.endsWith('...'), 'Should end with ellipsis');
  });

  await test('truncateToLines returns unchanged if under limit', () => {
    const text = 'Line1\nLine2';
    const result = truncateToLines(text, 5);
    assert.strictEqual(result, text);
  });
}

// ---------------------------------------------------------------------------
// 4. Layout validation
// ---------------------------------------------------------------------------

async function testValidation() {
  console.log('\n4. Layout Validation');

  await test('Valid spec produces no errors', () => {
    const spec: LayoutSpec = {
      canvasWidth: 2000,
      canvasHeight: 2000,
      textBlocks: [{
        content: 'Test text',
        box: { x: { type: 'percent', pct: 5 }, y: { type: 'percent', pct: 50 }, width: { type: 'percent', pct: 90 }, height: { type: 'percent', pct: 10 } },
        color: '#000000',
      }],
    };
    const issues = validateLayoutSpec(spec);
    assert(issues.filter(i => i.severity === 'error').length === 0, 'No errors for valid spec');
  });

  await test('Canvas too wide produces error', () => {
    const spec: LayoutSpec = { canvasWidth: 15000 };
    const issues = validateLayoutSpec(spec);
    const errors = issues.filter(i => i.severity === 'error');
    assert(errors.length > 0, 'Should have error for oversized canvas');
    assert(errors[0].field === 'canvasWidth');
  });

  await test('Empty text content produces warning', () => {
    const spec: LayoutSpec = {
      textBlocks: [{
        content: '',
        box: { x: { type: 'absolute', px: 0 }, y: { type: 'absolute', px: 0 }, width: { type: 'absolute', px: 100 }, height: { type: 'absolute', px: 50 } },
      }],
    };
    const issues = validateLayoutSpec(spec);
    const warnings = issues.filter(i => i.severity === 'warning');
    assert(warnings.some(w => w.field.includes('content')), 'Should warn about empty text block');
  });

  await test('Invalid maxLines produces error', () => {
    const spec: LayoutSpec = {
      textBlocks: [{
        content: 'Test',
        box: { x: { type: 'absolute', px: 0 }, y: { type: 'absolute', px: 0 }, width: { type: 'absolute', px: 100 }, height: { type: 'absolute', px: 50 } },
        maxLines: -1,
      }],
    };
    const issues = validateLayoutSpec(spec);
    assert(issues.some(i => i.field.includes('maxLines') && i.severity === 'error'));
  });
}

// ---------------------------------------------------------------------------
// 5. Merging and presets
// ---------------------------------------------------------------------------

async function testMerging() {
  console.log('\n5. Layout Merging & Presets');

  await test('mergeLayoutSpec overrides base values', () => {
    const base: LayoutSpec = { canvasWidth: 2000, outputFormat: 'jpeg' };
    const override: LayoutSpec = { canvasWidth: 1000, outputFormat: 'png' };
    const merged = mergeLayoutSpec(base, override);
    assert.strictEqual(merged.canvasWidth, 1000);
    assert.strictEqual(merged.outputFormat, 'png');
  });

  await test('mergeLayoutSpec preserves undefined overrides', () => {
    const base: LayoutSpec = { canvasWidth: 2000, outputFormat: 'jpeg' };
    const override: LayoutSpec = { canvasWidth: 1000 };
    const merged = mergeLayoutSpec(base, override);
    assert.strictEqual(merged.canvasWidth, 1000);
    assert.strictEqual(merged.outputFormat, 'jpeg');
  });

  await test('wbLayoutPreset has expected dimensions', () => {
    assert.strictEqual(wbLayoutPreset.canvasWidth, 2000);
    assert.strictEqual(wbLayoutPreset.canvasHeight, 2000);
    assert(wbLayoutPreset.textBlocks && wbLayoutPreset.textBlocks.length > 0);
    assert(wbLayoutPreset.badges && wbLayoutPreset.badges.length > 0);
  });

  await test('ozonLayoutPreset has expected dimensions', () => {
    assert.strictEqual(ozonLayoutPreset.canvasWidth, 2000);
    assert.strictEqual(ozonLayoutPreset.canvasHeight, 2000);
  });

  await test('default2KPreset is 2000x2000', () => {
    assert.strictEqual(default2KPreset.canvasWidth, 2000);
    assert.strictEqual(default2KPreset.canvasHeight, 2000);
  });

  await test('buildMarketplaceLayout merges presets correctly', () => {
    const wbLayout = buildMarketplaceLayout('wildberries');
    assert.strictEqual(wbLayout.canvasWidth, 2000);
    assert(wbLayout.textBlocks && wbLayout.textBlocks.length > 0, 'WB should have text blocks');

    const ozonLayout = buildMarketplaceLayout('ozon');
    assert.strictEqual(ozonLayout.canvasWidth, 2000);
    assert(ozonLayout.textBlocks && ozonLayout.textBlocks.length > 0, 'Ozon should have text blocks');
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Layout Rendering Engine Tests (a057a6c7)\n');
  console.log('='.repeat(50));

  await testPixelResolution();
  await testContrast();
  await testTextWrapping();
  await testValidation();
  await testMerging();

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
