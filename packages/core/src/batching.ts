/**
 * Batching engine and 4K generation limits (task 9c6fe204).
 *
 * Handles batch processing of generation jobs with configurable
 * resolution limits (up to 4K) and cost tracking.
 */

// ---------------------------------------------------------------------------
// Resolution tiers
// ---------------------------------------------------------------------------

export type ResolutionTier = '720p' | '1080p' | '2k' | '3k' | '4k';

export interface ResolutionSpec {
  width: number;
  height: number;
  tier: ResolutionTier;
  maxBatchSize: number;  // jobs per batch at this resolution
  costMultiplier: number;
}

export const RESOLUTION_TIERS: Record<ResolutionTier, ResolutionSpec> = {
  '720p':  { width: 720,  height: 720,  tier: '720p',  maxBatchSize: 50, costMultiplier: 0.5 },
  '1080p': { width: 1024, height: 1024, tier: '1080p', maxBatchSize: 30, costMultiplier: 1.0 },
  '2k':    { width: 2000, height: 2000, tier: '2k',    maxBatchSize: 15, costMultiplier: 2.0 },
  '3k':    { width: 3000, height: 3000, tier: '3k',    maxBatchSize: 8,  costMultiplier: 3.5 },
  '4k':    { width: 4000, height: 4000, tier: '4k',    maxBatchSize: 4,  costMultiplier: 5.0 },
};

// ---------------------------------------------------------------------------
// Batch planning
// ---------------------------------------------------------------------------

export interface BatchPlan {
  batchId: string;
  resolution: ResolutionSpec;
  jobCount: number;
  estimatedCostCents: number;
  estimatedCompletionSec: number;
}

/**
 * Calculate the maximum batch size for a given resolution,
 * factoring in API concurrency limits and memory constraints.
 */
export function maxBatchForResolution(resolution: ResolutionTier): number {
  return RESOLUTION_TIERS[resolution].maxBatchSize;
}

/**
 * Estimate cost for a batch of jobs at a given resolution.
 */
export function estimateBatchCost(
  resolution: ResolutionTier,
  jobCount: number,
  baseCostCents: number = 3,
): number {
  const tier = RESOLUTION_TIERS[resolution];
  return Math.round(jobCount * baseCostCents * tier.costMultiplier);
}

/**
 * Estimate completion time for a batch (rough heuristic).
 * Higher resolution + more jobs = longer.
 */
export function estimateBatchCompletionSec(
  resolution: ResolutionTier,
  jobCount: number,
  avgJobSec: number = 15,
): number {
  const tier = RESOLUTION_TIERS[resolution];
  const serialTime = jobCount * avgJobSec;
  // Assume 2x parallelism for 1080p+, less for higher res
  const parallelism = resolution === '4k' ? 1 : resolution === '3k' ? 2 : 2;
  return Math.ceil(serialTime / parallelism);
}

/**
 * Build a batch plan: split jobs into optimally-sized batches
 * at the target resolution.
 */
export function planBatches(
  resolution: ResolutionTier,
  totalJobCount: number,
  baseCostCents?: number,
  avgJobSec?: number,
): BatchPlan[] {
  const tier = RESOLUTION_TIERS[resolution];
  const maxPerBatch = tier.maxBatchSize;
  const batches: BatchPlan[] = [];

  let remaining = totalJobCount;
  let batchNum = 0;

  while (remaining > 0) {
    const jobCount = Math.min(remaining, maxPerBatch);
    batches.push({
      batchId: `batch-${resolution}-${batchNum}`,
      resolution: tier,
      jobCount,
      estimatedCostCents: estimateBatchCost(resolution, jobCount, baseCostCents),
      estimatedCompletionSec: estimateBatchCompletionSec(resolution, jobCount, avgJobSec),
    });
    remaining -= jobCount;
    batchNum++;
  }

  return batches;
}

/**
 * Validate resolution request against allowed tiers.
 * Returns the closest allowed resolution if the exact one isn't available.
 */
export function resolveResolution(
  requestedWidth: number,
  requestedHeight: number,
  maxAllowedTier: ResolutionTier = '2k',
): {
  requested: string;
  resolved: ResolutionSpec;
  downscaled: boolean;
} {
  const maxRes = RESOLUTION_TIERS[maxAllowedTier];

  // Find the best matching tier that doesn't exceed limits
  const tiers = Object.values(RESOLUTION_TIERS)
    .filter((t) => t.width <= maxRes.width && t.height <= maxRes.height)
    .sort((a, b) => a.width - b.width);

  let resolved = tiers[0]; // default to smallest
  let downscaled = false;

  for (const tier of tiers) {
    if (requestedWidth <= tier.width && requestedHeight <= tier.height) {
      resolved = tier;
      break;
    }
    // If request exceeds max, use max resolution
    if (requestedWidth > maxRes.width || requestedHeight > maxRes.height) {
      resolved = maxRes;
      downscaled = true;
      break;
    }
  }

  return {
    requested: `${requestedWidth}x${requestedHeight}`,
    resolved,
    downscaled,
  };
}

// ---------------------------------------------------------------------------
// Batch state machine
// ---------------------------------------------------------------------------

export type BatchStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'partial';

const BATCH_TRANSITIONS: Record<BatchStatus, BatchStatus[]> = {
  queued: ['processing', 'failed'],
  processing: ['completed', 'failed', 'partial'],
  completed: ['partial'], // reopen for re-processing
  failed: ['queued'],
  partial: ['processing', 'completed'],
};

export function isValidBatchTransition(
  from: BatchStatus,
  to: BatchStatus,
): boolean {
  return BATCH_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isBatchFinished(status: BatchStatus): boolean {
  return status === 'completed' || status === 'failed';
}
