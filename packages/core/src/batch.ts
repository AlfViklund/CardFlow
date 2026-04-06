/**
 * Batch final-series generation with recoverable export (task 37533c09).
 *
 * Orchestrates multi-card generation through the queue, tracks per-batch costs,
 * enforces budget limits, and builds recoverable ZIP export packages blocked
 * by compliance validation.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BatchGenerationInput {
  projectId: string;
  cardCount?: number;
  marketplaces: string[];
  budgetLimit?: number;
}

export interface BatchProgress {
  batchId: string;
  totalCards: number;
  completedCards: number;
  failedCards: number;
  totalCost: number;
  status: 'queued' | 'processing' | 'completed' | 'partial' | 'failed';
  errors: string[];
}

export interface ExportPackageManifest {
  projectId: string;
  cardCount: number;
  files: string[];
  complianceScore: number;
  criticalFailures: number;
  marketplace: string;
  generatedAt: string;
}

export interface OverlayConfig {
  type: 'text' | 'badge' | 'icon' | 'table';
  content: string;
  position: { x: number; y: number };
  fontSize?: number;
  color?: string;
  backgroundColor?: string;
}

// ---------------------------------------------------------------------------
// Batch orchestrator helpers
// ---------------------------------------------------------------------------

export function createBatchMetadata(input: BatchGenerationInput): Record<string, unknown> {
  return {
    projectId: input.projectId,
    marketplaces: input.marketplaces,
    targetCards: input.cardCount ?? 8,
    budgetLimit: input.budgetLimit ?? null,
    createdAt: new Date().toISOString(),
    status: 'queued',
    totalCost: 0,
    completedCards: 0,
    failedCards: 0,
  };
}

export function isWithinBudget(currentCost: number, budgetLimit?: number | null): boolean {
  if (!budgetLimit) return true;
  return currentCost < budgetLimit;
}

export function generateCardProviderConfig(
  cardNumber: number,
  stage: string,
  provider: string | null,
  seed: number | null,
) {
  return {
    cardNumber,
    stage,
    provider: provider ?? 'default',
    useSeed: seed !== null,
  };
}

/** All cards must be generated before export can proceed */
export function canProceedWithBatch(totalCards: number, completedCards: number): boolean {
  return completedCards >= totalCards && totalCards > 0;
}

// ---------------------------------------------------------------------------
// Export package builder
// ---------------------------------------------------------------------------

export function buildExportFileList(
  cardCount: number,
  formats: string[] = ['jpg', 'png', 'webp'],
): string[] {
  const files: string[] = [];
  for (let i = 1; i <= cardCount; i++) {
    for (const fmt of formats) {
      files.push(`card_${i}.${fmt}`);
    }
  }
  files.push('metadata.json');
  files.push('compliance_report.json');
  files.push('manifest.csv');
  return files;
}

export function buildExportManifest(
  projectId: string,
  cardCount: number,
  marketplace: string,
  complianceScore: number,
): ExportPackageManifest {
  return {
    projectId,
    cardCount,
    files: buildExportFileList(cardCount),
    complianceScore,
    criticalFailures: 0,
    marketplace,
    generatedAt: new Date().toISOString(),
  };
}

export function buildCsvManifest(
  cards: Array<{
    cardNumber: number;
    filename: string;
    mimeType: string;
    seed?: number | null;
    model?: string;
  }>,
): string {
  const header = 'card_number,filename,mime_type,seed,model\n';
  const rows = cards.map(
    (c) => `${c.cardNumber},${c.filename},${c.mimeType},${c.seed ?? ''},${c.model ?? ''}`,
  ).join('\n');
  return header + rows;
}

/** Generate a deterministic S3 storage key for the export ZIP */
export function generateExportStorageKey(
  projectId: string,
  batchId: string,
  marketplace: string,
): string {
  return `projects/${projectId}/exports/${marketplace}/${batchId}.zip`;
}

export function canRecoverExport(existingOutputs: number, requiredCards: number): boolean {
  return existingOutputs >= requiredCards && requiredCards > 0;
}
