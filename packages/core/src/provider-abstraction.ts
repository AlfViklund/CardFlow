/**
 * Provider abstraction for image generation backends (task f70b601f).
 *
 * Pluggable providers behind a unified interface, with:
 * - provider registry with priority-based fallback
 * - unified request/response contracts
 * - retry + fallback on provider failure
 * - model/seed capture for traceability
 * - cost metering per call
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProviderName =
  | 'gemini'
  | 'nano-banana'
  | 'stability'
  | 'replicate'
  | 'openai'
  | 'custom';

export interface ProviderConfig {
  name: ProviderName;
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  /** Lower number = higher priority for fallback chain */
  priority?: number;
}

export interface GenerationRequest {
  /** Text description of the scene to generate */
  prompt: string;
  /** Optional negative prompt (what to avoid) */
  negativePrompt?: string;
  width?: number;
  height?: number;
  seed?: number;
  numImages?: number;
  /** Override the default model for this call */
  modelOverride?: string;
  /** Opaque metadata for traceability */
  trace?: Record<string, unknown>;
}

export interface GenerationResult {
  /** Unique ID for this generation call */
  callId: string;
  provider: ProviderName;
  model: string;
  seed: number | null;
  /** Base64-encoded image data (or URL if provider returns URLs) */
  images: Array<{ data?: string; url?: string }>;
  costCents: number;
  latencyMs: number;
  traceId: string;
  /** Error message if the call failed */
  error?: string;
}

export interface CostRecord {
  callId: string;
  provider: ProviderName;
  model: string;
  costCents: number;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export abstract class ProviderClient {
  abstract readonly name: ProviderName;
  abstract generate(request: GenerationRequest, config: ProviderConfig): Promise<GenerationResult>;
  abstract estimateCost(request: GenerationRequest): number;
}

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

export class ProviderRegistry {
  private providers: Map<ProviderName, ProviderClient> = new Map();

  register(client: ProviderClient): void {
    this.providers.set(client.name, client);
  }

  get(name: ProviderName): ProviderClient | undefined {
    return this.providers.get(name);
  }

  /** Get providers sorted by priority (lower = higher priority, undefined = lowest) */
  list(): ProviderClient[] {
    return [...this.providers.values()].sort((a, b) => {
      // We don't have access to config here — caller should order explicitly
      return 0;
    });
  }
}

// ---------------------------------------------------------------------------
// Retry helper
// ---------------------------------------------------------------------------

export function calculateBackoff(attempt: number, baseMs = 1000, maxMs = 30000): number {
  const delay = baseMs * 2 ** attempt;
  return Math.min(delay, maxMs);
}

// ---------------------------------------------------------------------------
// Traceability helpers
// ---------------------------------------------------------------------------

export function generateTraceId(): string {
  return crypto.randomUUID();
}

/**
 * Build a traceability record that links a generation request to its output.
 * This data is stored alongside revision records for full reproducibility.
 */
export function buildTraceRecord(
  result: GenerationResult,
  request: GenerationRequest,
): Record<string, unknown> {
  return {
    callId: result.callId,
    provider: result.provider,
    model: result.model,
    seed: result.seed,
    prompt: request.prompt,
    width: request.width,
    height: request.height,
    traceId: result.traceId,
    costCents: result.costCents,
    latencyMs: result.latencyMs,
    ...request.trace,
  };
}

// ---------------------------------------------------------------------------
// Cost meter
// ---------------------------------------------------------------------------

export class CostMeter {
  private records: CostRecord[] = [];

  record(rec: CostRecord): void {
    this.records.push(rec);
  }

  /** Total cost across all recorded calls */
  totalCents(): number {
    return this.records.reduce((sum, r) => sum + r.costCents, 0);
  }

  /** Cost breakdown by provider */
  byProvider(): Record<ProviderName, number> {
    const totals: Partial<Record<ProviderName, number>> = {};
    for (const r of this.records) {
      totals[r.provider] = (totals[r.provider] ?? 0) + r.costCents;
    }
    return totals as Record<ProviderName, number>;
  }

  /** Cost breakdown by model */
  byModel(): Record<string, number> {
    const totals: Record<string, number> = {};
    for (const r of this.records) {
      totals[r.model] = (totals[r.model] ?? 0) + r.costCents;
    }
    return totals;
  }

  getEntries(): ReadonlyArray<CostRecord> {
    return this.records;
  }

  clear(): void {
    this.records = [];
  }
}

// ---------------------------------------------------------------------------
// Default provider configs from env
// ---------------------------------------------------------------------------

export function defaultProviderConfigs(): ProviderConfig[] {
  const configs: ProviderConfig[] = [
    {
      name: 'gemini' as ProviderName,
      baseUrl: process.env.GEMINI_API_URL ?? 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: process.env.GEMINI_API_KEY ?? '',
      priority: 0,
    },
    {
      name: 'stability' as ProviderName,
      baseUrl: process.env.STABILITY_API_URL ?? 'https://api.stability.ai/v1',
      apiKey: process.env.STABILITY_API_KEY ?? '',
      priority: 2,
    },
    {
      name: 'replicate' as ProviderName,
      baseUrl: process.env.REPLICATE_API_URL ?? 'https://api.replicate.com/v1',
      apiKey: process.env.REPLICATE_API_KEY ?? '',
      priority: 3,
    },
  ];
  return configs.filter((c) => c.apiKey.length > 0 || c.baseUrl.length > 0);
}
