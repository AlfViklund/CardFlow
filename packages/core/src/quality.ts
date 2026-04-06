/**
 * Quality-risk scoring model and Step 0 gating decision engine (task ca05a06d).
 *
 * Scores uploaded images across quality dimensions (sharpness, resolution,
 * lighting, background cleanliness, product visibility) and produces a
 * gating decision (blocked | warning | allowed) per marketplace.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QualityScoreDimension =
  | 'sharpness'
  | 'resolution'
  | 'lighting'
  | 'background'
  | 'product_visibility';

export interface QualityDimensionScore {
  dimension: QualityScoreDimension;
  score: number;  // 0-100
  weight: number; // importance weight
  status: 'pass' | 'warning' | 'critical';
  detail: string;
}

export interface QualityAnalysisInput {
  width: number;
  height: number;
  fileSizeBytes: number;
  mimeType: string;
  brightness?: number;   // 0-255 average luminance, if available
  hasWatermark?: boolean;
  brief?: string;         // product brief for context analysis
}

export interface QualityAnalysisResult {
  overallScore: number;        // weighted composite 0-100
  dimensionScores: QualityDimensionScore[];
  risks: QualityRiskEntry[];
  gatingDecision: 'blocked' | 'warning' | 'allowed';
  gatingReason: string;
}

export interface QualityRiskEntry {
  code: string;
  severity: 'critical' | 'warning' | 'info';
  detail: string;
  marketplaces: string[];
}

// ---------------------------------------------------------------------------
// Dimension scoring
// ---------------------------------------------------------------------------

/** Dimension weights — sum to 1.0 */
export const DIMENSION_WEIGHTS: Record<QualityScoreDimension, number> = {
  sharpness: 0.30,     // edge clarity / blur detection
  resolution: 0.25,    // pixel dimensions vs marketplace minimums
  lighting: 0.15,      // brightness / contrast
  background: 0.15,    // background cleanliness
  product_visibility: 0.15, // cropping, center detection, aspect ratio
};

/**
 * Estimate sharpness/score from image metadata and dimensions.
 * In a real implementation, you'd use edge-detection on pixel data.
 * For the heuristic MVP, we score based on resolution and format indicators.
 */
export function scoreSharpness(_input: QualityAnalysisInput): QualityDimensionScore {
  // Without pixel-level access, we estimate sharpness from resolution
  // and format: high-resolution images are more likely to be sharp
  const { width, height } = _input;
  const totalPixels = width * height;

  let score = 60; // baseline

  if (totalPixels > 2_000_000) score += 20;       // >2MP: good detail
  else if (totalPixels > 1_000_000) score += 10;   // >1MP: acceptable
  else if (totalPixels < 100_000) score -= 40;     // <0.1MP: likely blurry

  if (_input.mimeType === 'image/heic' || _input.mimeType === 'image/heif') {
    // HEIC usually comes from modern smartphones — typically good quality
    score += 10;
  }

  score = Math.max(0, Math.min(100, score));

  let status: 'pass' | 'warning' | 'critical' = 'pass';
  let detail = '';

  if (score >= 70) {
    status = 'pass';
    detail = 'Изображение достаточной чёткости';
  } else if (score >= 40) {
    status = 'warning';
    detail = 'Возможна недостаточная чёткость изображения';
  } else {
    status = 'critical';
    detail = 'Изображение слишком размытое или низкого разрешения';
  }

  return { dimension: 'sharpness', score, weight: DIMENSION_WEIGHTS.sharpness, status, detail };
}

/**
 * Score resolution based on pixel dimensions vs marketplace minimums.
 */
export function scoreResolution(
  input: QualityAnalysisInput,
  marketplaces: string[],
): QualityDimensionScore {
  const { width, height } = input;
  const hasWb = marketplaces.includes('wildberries');
  const hasOzon = marketplaces.includes('ozon');

  // WB requires 900px minimum, Ozon requires 400px
  const minDimension = hasWb && hasOzon ? 900 : hasWb ? 900 : hasOzon ? 400 : 900;
  const minPixels = minDimension * minDimension;
  const maxDimension = Math.max(width, height);

  let score = 0;
  if (maxDimension >= minDimension) {
    const excess = (maxDimension - minDimension) / minDimension;
    score = Math.min(100, 80 + excess * 20);
  } else {
    score = Math.max(0, (maxDimension / minDimension) * 70);
  }

  score = Math.round(score);

  let status: 'pass' | 'warning' | 'critical';
  let detail: string;

  if (score >= 75) {
    status = 'pass';
    detail = `Разрешение ${width}x${height}px соответствует требованиям`;
  } else if (score >= 35) {
    status = 'warning';
    detail = `Разрешение ${width}x${height}px близко к минимальному (${minDimension}px)`;
  } else {
    status = 'critical';
    detail = `Разрешение ${width}x${height}px ниже минимального (${minDimension}px)`;
  }

  return { dimension: 'resolution', score, weight: DIMENSION_WEIGHTS.resolution, status, detail };
}

/**
 * Score lighting quality.
 * Uses brightness value if available; estimates from file size and dimensions otherwise.
 */
export function scoreLighting(input: QualityAnalysisInput): QualityDimensionScore {
  let brightness = input.brightness;

  // Estimate brightness from file size vs dimensions ratio
  if (brightness === undefined) {
    const pixels = input.width * input.height;
    const bytesPerPixel = input.fileSizeBytes / Math.max(pixels, 1);

    // Typical well-lit images have certain byte density
    if (input.mimeType === 'image/jpeg') {
      brightness = Math.min(255, Math.max(0, bytesPerPixel * 30 + 80));
    } else if (input.mimeType === 'image/png') {
      brightness = Math.min(255, Math.max(0, bytesPerPixel * 15 + 100));
    } else {
      brightness = 128; // neutral assumption
    }
  }

  // Ideal brightness: 100-200 (well-lit but not overexposed)
  let score = 50;

  if (brightness >= 100 && brightness <= 200) {
    score = 50 + (100 - Math.abs(brightness - 150)) * 0.6;
  } else if (brightness < 50) {
    score = Math.max(0, brightness * 0.6);
  } else if (brightness > 220) {
    score = Math.max(0, 100 - (brightness - 220) * 2);
  } else if (brightness < 100) {
    score = 30 + brightness * 0.2;
  } else {
    score = 30 + (100 - (brightness - 200) * 0.4);
  }

  score = Math.round(Math.max(0, Math.min(100, score)));

  let status: 'pass' | 'warning' | 'critical';
  let detail: string;

  // Check for over/under exposure first — these are warnings regardless of score
  if (brightness > 230) {
    status = 'warning';
    detail = `Пересвет (средняя яркость ${brightness}/255)`;
  } else if (brightness < 60) {
    status = 'warning';
    detail = `Недостаточное освещение (средняя яркость ${brightness}/255)`;
  } else if (score >= 60) {
    status = 'pass';
    detail = 'Освещение соответствует требованиям';
  } else {
    status = 'warning';
    detail = `Освещение требует улучшения (средняя яркость ${brightness}/255)`;
  }

  return { dimension: 'lighting', score, weight: DIMENSION_WEIGHTS.lighting, status, detail };
}

/**
 * Score background cleanliness.
 * For MVP, score based on aspect ratio and file characteristics.
 * Clean backgrounds typically correlate with professional photography (higher quality).
 */
export function scoreBackground(input: QualityAnalysisInput): QualityDimensionScore {
  const { width, height } = input;
  const ratio = width > 0 && height > 0 ? width / height : 0;

  // Standard product photo ratios are typically 1:1, 3:4, 4:3
  const standardRatios = [1.0, 0.75, 1.33];
  const isStandardRatio = standardRatios.some(r => Math.abs(ratio - r) < 0.1);

  // Larger file sizes at same dimensions often indicate cleaner backgrounds
  const pixels = width * height;
  const bytesPerPixel = input.fileSizeBytes / Math.max(pixels, 1);

  let score = 60; // baseline

  if (isStandardRatio) score += 15;
  if (input.mimeType === 'image/jpeg') {
    // JPEG compression is typical for professional product photos
    score += 5;
  }
  if (input.hasWatermark) {
    score -= 30; // watermark indicates non-professional source
  }
  if (bytesPerPixel > 1.5) {
    score += 10; // high quality
  } else if (bytesPerPixel < 0.3) {
    score -= 15; // very low quality
  }

  score = Math.round(Math.max(0, Math.min(100, score)));

  let status: 'pass' | 'warning' | 'critical';
  let detail: string;

  if (score >= 70) {
    status = 'pass';
    detail = 'Фон соответствует рекомендациям маркетплейса';
  } else if (score >= 40) {
    status = 'warning';
    detail = 'Рекомендуется более чистый фон (белый фон предпочтителен)';
  } else {
    status = 'critical';
    detail = 'Фон не соответствует требованиям или содержит водяные знаки';
  }

  return { dimension: 'background', score, weight: DIMENSION_WEIGHTS.background, status, detail };
}

/**
 * Score product visibility / cropping quality.
 * Checks aspect ratio appropriateness and center positioning (estimated).
 */
export function scoreProductVisibility(input: QualityAnalysisInput): QualityDimensionScore {
  const { width, height } = input;
  const ratio = width > 0 && height > 0 ? width / height : 0;

  let score = 70; // baseline

  // Extreme aspect ratios suggest poor cropping
  if (ratio > 3 || ratio < 0.33) {
    score -= 45;
  } else if (ratio > 2 || ratio < 0.5) {
    score -= 25;
  }

  // Very small images suggest insufficient product detail
  const totalPixels = width * height;
  if (totalPixels < 50_000) {
    score -= 25;
  } else if (totalPixels < 200_000) {
    score -= 10;
  }

  // Watermark suggests poor quality source
  if (input.hasWatermark) {
    score -= 20;
  }

  score = Math.round(Math.max(0, Math.min(100, score)));

  let status: 'pass' | 'warning' | 'critical';
  let detail: string;

  if (score >= 50) {
    status = 'pass';
    detail = 'Товар хорошо виден и правильно обрезан';
  } else if (score >= 35) {
    status = 'warning';
    detail = 'Рекомендуется улучшить кадрирование или увеличить изображение товара';
  } else {
    status = 'critical';
    detail = 'Товар недостаточно виден или изображение слишком маленькое';
  }

  return { dimension: 'product_visibility', score, weight: DIMENSION_WEIGHTS.product_visibility, status, detail };
}

// ---------------------------------------------------------------------------
// Composite quality analysis
// ---------------------------------------------------------------------------

/**
 * Run full quality analysis on uploaded image.
 * Returns composite score, per-dimension scores, risks, and gating decision.
 */
export function analyzeQuality(
  input: QualityAnalysisInput,
  marketplaces: string[],
): QualityAnalysisResult {
  const sharpness = scoreSharpness(input);
  const resolution = scoreResolution(input, marketplaces);
  const lighting = scoreLighting(input);
  const background = scoreBackground(input);
  const productVisibility = scoreProductVisibility(input);

  const dimensions = [sharpness, resolution, lighting, background, productVisibility];

  // Calculate weighted composite score
  const totalWeight = dimensions.reduce((sum, d) => sum + d.weight, 0);
  const overallScore = Math.round(
    dimensions.reduce((sum, d) => sum + d.score * d.weight, 0) / totalWeight,
  );

  // Collect risks from critical/warning dimensions
  const risks: QualityRiskEntry[] = [];

  for (const dim of dimensions) {
    if (dim.status === 'critical') {
      risks.push({
        code: `quality_${dim.dimension}_critical`,
        severity: 'critical',
        detail: dim.detail,
        marketplaces,
      });
    } else if (dim.status === 'warning') {
      risks.push({
        code: `quality_${dim.dimension}_warning`,
        severity: 'warning',
        detail: dim.detail,
        marketplaces,
      });
    }
  }

  // Check for watermark (always a risk)
  if (input.hasWatermark) {
    risks.push({
      code: 'quality_watermark',
      severity: 'critical',
      detail: 'Обнаружен водяной знак на изображении',
      marketplaces,
    });
  }

  // Determine gating decision
  const gatingResult = makeGatingDecision(overallScore, risks, marketplaces);

  return {
    overallScore,
    dimensionScores: dimensions,
    risks,
    gatingDecision: gatingResult.decision,
    gatingReason: gatingResult.reason,
  };
}

// ---------------------------------------------------------------------------
// Gating decision engine
// ---------------------------------------------------------------------------

export interface GatingResult {
  decision: 'blocked' | 'warning' | 'allowed';
  reason: string;
  score: number;
}

/**
 * Marketplace-specific quality thresholds.
 * WB is stricter (higher minimums), Ozon is more lenient.
 */
const QUALITY_THRESHOLDS: Record<string, { blockBelow: number; warnBelow: number }> = {
  wildberries: { blockBelow: 40, warnBelow: 60 },
  ozon: { blockBelow: 30, warnBelow: 50 },
};

const DEFAULT_THRESHOLDS = { blockBelow: 40, warnBelow: 60 };

export function makeGatingDecision(
  qualityScore: number,
  risks: QualityRiskEntry[],
  marketplaces: string[],
  complianceCriticalFailures?: number,
): GatingResult {
  // If compliance has critical failures, always block
  if (complianceCriticalFailures && complianceCriticalFailures > 0) {
    return {
      decision: 'blocked',
      reason: `Экспорт заблокирован: ${complianceCriticalFailures} критическ${complianceCriticalFailures === 1 ? 'ое' : 'их'} нарушение правил маркетплейса`,
      score: qualityScore,
    };
  }

  // Use strictest thresholds across all marketplaces (strictest = highest = harder to pass)
  let blockBelow = 0;
  let warnBelow = 0;

  for (const mp of marketplaces) {
    const thresholds = QUALITY_THRESHOLDS[mp] ?? DEFAULT_THRESHOLDS;
    blockBelow = Math.max(blockBelow, thresholds.blockBelow);
    warnBelow = Math.max(warnBelow, thresholds.warnBelow);
  }

  // Check for critical quality risks
  const hasCriticalRisk = risks.some(r => r.severity === 'critical');

  if (qualityScore < blockBelow || hasCriticalRisk) {
    return {
      decision: 'blocked',
      reason: hasCriticalRisk
        ? 'Критическое нарушение качества изображения'
        : `Качество ${qualityScore}/100 ниже порогового значения (${blockBelow}) для выбранных маркетплейсов`,
      score: qualityScore,
    };
  }

  if (qualityScore < warnBelow) {
    return {
      decision: 'warning',
      reason: `Качество ${qualityScore}/100 требует улучшения (рекомендуется выше ${warnBelow})`,
      score: qualityScore,
    };
  }

  // Check for warning risks
  const hasWarningRisk = risks.some(r => r.severity === 'warning');
  if (hasWarningRisk) {
    return {
      decision: 'warning',
      reason: 'Обнаружены проблемы с качеством, но экспорт разрешён',
      score: qualityScore,
    };
  }

  return {
    decision: 'allowed',
    reason: 'Качество изображения соответствует требованиям',
    score: qualityScore,
  };
}

/**
 * Generate human-readable quality report (Russian).
 */
export function generateQualityReport(
  result: QualityAnalysisResult,
  marketplaces: string[],
): string {
  const mpLabel = marketplaces.join(' + ').replace('wildberries', 'Wildberries').replace('ozon', 'Ozon');

  const statusEmoji = result.gatingDecision === 'blocked' ? '🔴' : result.gatingDecision === 'warning' ? '🟡' : '🟢';

  let report = `${statusEmoji} **Анализ качества изображений** (${mpLabel})\n\n`;
  report += `Общий балл: **${result.overallScore}/100**\n`;
  report += `Решение: **${result.gatingDecision === 'blocked' ? 'Заблокировано' : result.gatingDecision === 'warning' ? 'Предупреждение' : 'Разрешено'}**\n\n`;

  report += '### Показатели качества\n';
  for (const dim of result.dimensionScores) {
    const icon = dim.status === 'pass' ? '✅' : dim.status === 'warning' ? '⚠️' : '❌';
    const dimName = {
      sharpness: 'Чёткость',
      resolution: 'Разрешение',
      lighting: 'Освещение',
      background: 'Фон',
      product_visibility: 'Видимость товара',
    }[dim.dimension];
    report += `${icon} ${dimName}: ${dim.score}/100 — ${dim.detail}\n`;
  }

  if (result.risks.length > 0) {
    report += '\n### Обнаруженные риски\n';
    for (const risk of result.risks) {
      const icon = risk.severity === 'critical' ? '🔴' : risk.severity === 'warning' ? '🟡' : 'ℹ️';
      report += `${icon} ${risk.detail}\n`;
    }
  }

  report += `\n**Рекомендация:** ${result.gatingReason}`;

  return report;
}
