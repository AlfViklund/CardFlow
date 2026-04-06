# Plan: ca05a06d — Quality-Risk Scoring Model and Step 0 Gating

## Goal
Build quality-risk analysis for uploaded inputs (main photo, additional photos, reference images). Scores: blur/sharpness, background cleanliness, cropping/product visibility, lighting, resolution, marketplace-specific quality checks. Step 0 gating: block/warn/allow based on combined score.

## Current State (what's already built)
- Step 0 ingestion (`/v1/step0/ingest`) validates file size, format, resolution, brief length
- `analyseImage()` in server.ts has basic dimensional + watermark checks
- QualityRisk type: `{ code, severity: 'warning' | 'blocker', detail }`
- QualityRisk codes: low_resolution, oversized_file, unsupported_format, aspect_ratio_extreme, missing_background_info, watermark_detected
- DB: `step0_ingestions` stores `quality_risks`, `blocking_reasons`, `can_proceed`, `status`
- Compliance engine: rules, validation, scoring — already in place (d4118303)

## What's Missing
1. **Quality scoring engine** — composite score (0-100) from multiple quality dimensions
2. **Blur/sharpness detection** — heuristic-based (no ML for now)
3. **Background cleanliness scoring** — heuristic analysis
4. **Product visibility/cropping check** — aspect ratio + center detection
5. **Lighting quality estimate** — brightness/contrast heuristics
6. **Marketplace-specific quality thresholds** — WB stricter, Ozon relaxed
7. **Gating decision engine** — block/warn/allow based on score + blocking criteria
8. **API endpoint** — quality analysis with structured scoring report

## Implementation Plan

### Part 1: Quality Scoring Engine (`packages/core/src/quality.ts`)

**1A. Quality risk types**
- Extend QualityRisk with severity 'critical' | 'warning' | 'info' (currently only 'warning' | 'blocker')
- Add new codes: blur_detected, poor_lighting, background_clutter, product_off_center, low_contrast

**1B. Quality scoring functions**
- `analyzeSharpness(buffer)`: return sharpness score (0-100) using variance of Laplacian heuristic
  - Read image header → estimate blur from edge density approximation
  - For JPEG: check DCT coefficient distribution (simplified: check high-frequency content)
  - For PNG: check gradient variance in luminance channel

- `analyzeLighting(buffer)`: return lighting score (0-100)
  - Estimate average brightness from available metadata
  - Flag overexposed / underexposed images

- `analyzeBackground(metadata, text)`: return background cleanliness score
  - Check for text-based background hints in brief/metadata
  - For MVP: score based on aspect ratio compliance (product photos typically have clean backgrounds)

- `analyzeProductVisibility(width, height, aspectRatio)`: return visibility score
  - Check if aspect ratio matches recommended product ratios
  - Flag extreme cropping

**1C. Composite quality score**
- Weighted average: sharpness (30%), resolution (25%), lighting (15%), background (15%), product visibility (15%)
- Return: `{overallScore, dimensionScores, risks[], gatingDecision}`

**1D. Gating decision engine**
- `makeGatingDecision(qualityScore, qualityRisks, marketplace, complianceScore?)`
  - Returns: `'blocked' | 'warning' | 'allowed'`
  - Blocked if: qualityScore < 40, or any critical risk, or compliance score blocks it
  - Warning if: qualityScore < 70, or any warning risk
  - Allowed otherwise
  - WB threshold stricter (require score >= 50 to not block, vs Ozon >= 30)

### Part 2: API Endpoints

**2A. Enhance Step 0 analyze endpoint**
- Add quality scoring to ingestion response
- Return structured quality report alongside existing blocking/warning data

**2B. New endpoint: `POST /v1/step0/:ingestionId/analyze-quality`**
- Input: `{ projectId }` (for marketplace context)
- Re-analyzes uploaded images with quality scoring
- Returns: `{overallScore, dimensionScores, gatingDecision, risks[]}`

### Part 3: Tests
- Quality scoring edge cases: very small images (blur), dark images (lighting)
- Marketplace threshold differences: WB stricter, Ozon more lenient
- Gating decisions: block at low scores, warn at medium, allow at high
- Composite score accuracy: weights sum correctly
- Critical vs warning risk classification

## Files to Create
- `packages/core/src/quality.ts` — scoring engine, gating logic
- `packages/core/src/quality.test.ts` — unit tests

## Files to Modify
- `packages/core/src/index.ts` — exports from quality.ts
- `apps/api/src/server.ts` — quality analysis endpoint, enhance ingestion response
- `apps/worker/src/worker.ts` — quality analysis job type (optional, can be sync)

## Acceptance Criteria
- Quality scoring covers: blur, background, cropping, lighting, resolution
- Composite score (0-100) with weighted dimensions
- Gating: blocked (<40 or critical risk), warning (<70 or warning risk), allowed
- Marketplace-specific thresholds: WB stricter than Ozon
- Step 0 ingestion returns quality analysis in response
- Unit tests cover all quality dimensions + gating decisions
