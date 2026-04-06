# Plan: 37533c09 — Batch Final-Series Generation with Recoverable Export

## Goal
Build batch final run: orchestrated multi-card job generation, parallel provider calls, overlay composition, ZIP export with compliance gating, and cost tracking.

## Current State
- DB: `generation_jobs`, `generation_outputs` tables exist (migrations 0005)
- DB: `createBatchGenerationJobs()`, `getUpstreamApprovedData()` already implemented
- Core: `generationJobCreateSchema`, `generationOutputCreateSchema`, AI provider enum, stage enums
- API: `POST /v1/generation/batch` endpoint already exists (creates batch jobs via queue)
- Worker: exists but batch final run logic needs implementation
- Compliance: `isExportBlocked()` exists in core, validation data in `compliance_validations`
- Storage: MinIO S3-compatible storage with `ensureBucket()`, `putObject()`, `getObject()`

## What's Missing
1. **Batch orchestrator** — takes approved cards, runs optimized provider calls with cost tracking
2. **Overlay composition** — programmatic text/badges/icons/tables on images
3. **Recoverable ZIP export** — structured packages with JSON/CSV metadata, marketplace presets
4. **Compliance gating** — export blocked on critical failures
5. **Cost tracking** — per-batch budget limits
6. **Recoverable export** — failures without re-running generation

## Implementation Plan

### Part 1: Core Package (`packages/core/src/batch.ts`)

**1A. Batch generation types**
- `BatchGenerationInput`: projectId, marketplaces, cardCount, budgetLimit
- `BatchProgress`: batchId, totalCards, completedCards, failedCards, totalCost
- `ExportPackage`: ZIP contents list, compliance status, marketplace preset

**1B. Overlay composition engine**
- `composeOverlay(baseImage, overlays)` — compose text/badges on card images
- Overlay types: text (position, font, color), badge (icon position), table (structured data)
- Simple canvas-based composition (or metadata-only for MVP, actual rendering is provider responsibility)

### Part 2: API (`apps/api/src/server.ts`)

**2A. New endpoint: `POST /v1/generation/batch-export`**
- Input: `{ projectId }`
- Validates all cards have been generated
- Checks compliance (blocks on critical failures)
- Creates ZIP package: { jpg/png images + metadata.json + compliance_report.json }
- Stores in MinIO, returns download URL

**2B. Enhance existing batch endpoint**
- Add cost tracking parameter: `{ budgetLimit }`
- Track total provider API costs in batch metadata

**2C. Recoverable export endpoint**
- `POST /v1/export/{projectId}/recover` — rebuild ZIP from existing outputs without re-generating

### Part 3: Worker (`apps/worker/src/worker.ts`)

**3A. Batch job handler**
- Process batch_final jobs: orchestrate provider calls for all cards
- Handle partial failures gracefully (retry individual cards)
- Track costs per batch run

**3B. Export job handler**
- Assemble ZIP from completed outputs
- Apply marketplace-specific presets (WB: 3:4 ratio, Ozon: 1:1)
- Include compliance report in export

### Part 4: Tests

- Test batch orchestrator logic
- Test compliance gating (blocks on critical)
- Test ZIP export structure
- Test cost tracking/budget enforcement
- Test recoverable export (rebuild without re-generation)

## Files to Create
- `packages/core/src/batch.ts` — batch types and orchestration logic
- `apps/worker/src/export-handler.ts` — export job handler
- Tests for batch, export, and compliance gating

## Files to Modify
- `apps/api/src/server.ts` — batch-export and recoverable export endpoints
- `apps/worker/src/worker.ts` — batch final and export job types

## Acceptance Checklist
- [ ] Batch generation orchestrates all 8 default cards through queue
- [ ] Export produces ZIP with JPG/PNG + JSON/CSV metadata
- [ ] Export blocked when critical compliance failures exist
- [ ] Export failures recoverable without re-running generation
- [ ] Cost per batch tracked within budget limits
