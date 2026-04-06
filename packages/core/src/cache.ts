/**
 * Caching logic to avoid redundant AI generation (task db4252d5).
 *
 * Deduplicates generation requests by hashing stable inputs.
 * Supports in-memory and Redis-backed caching with TTL.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GenerationCacheKey {
  promptHash: string;      // hash of the generation prompt
  modelId: string;         // AI model used
  seed?: number | null;    // seed for reproducibility
  resolution?: string;     // e.g. 2000x2000
  stylePreset?: string;    // style preset applied
  negativePromptHash?: string; // hash of negative prompt
}

export interface CachedGenerationResult {
  cacheKey: string;
  resultId: string;
  createdAt: string;
  expiresAt: string;
  hitCount: number;
  outputRefs: string[];    // storage URLs or asset IDs for cached outputs
}

export interface CacheConfig {
  /** Default TTL in seconds (default: 86400 = 24h) */
  defaultTtlSeconds: number;
  /** Maximum cache entries (for in-memory mode) */
  maxEntries: number;
  /** Whether to use Redis (default: false) */
  useRedis: boolean;
  /** Redis key prefix (default: cardflow:gen:') */
  redisPrefix: string;
}

export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  defaultTtlSeconds: 86400,
  maxEntries: 5000,
  useRedis: false,
  redisPrefix: 'cardflow:gen:',
};

// ---------------------------------------------------------------------------
// Cache key generation
// ---------------------------------------------------------------------------

/**
 * Generate a stable cache key from generation inputs.
 * This ensures identical requests always produce the same key.
 */
export function generateCacheKey(input: GenerationCacheKey): string {
  const parts = [
    input.promptHash,
    input.modelId,
    input.seed ?? '',
    input.resolution ?? '',
    input.stylePreset ?? '',
    input.negativePromptHash ?? '',
  ].filter(Boolean);

  // Simple deterministic hash from the parts
  const str = parts.join('|');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }

  return `gen:${Math.abs(hash).toString(16)}:${input.modelId}`;
}

/**
 * Hash a string using a simple deterministic algorithm.
 * For production, you'd use SHA-256 — this is sufficient for deduplication
 * in the MVP context.
 */
export function hashInput(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16);
}

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  result: CachedGenerationResult;
  expiresAt: number; // ms timestamp
}

export class InMemoryGenerationCache {
  private store: Map<string, CacheEntry> = new Map();
  private readonly config: CacheConfig;

  constructor(config?: Partial<CacheConfig>) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
  }

  get(key: string): CachedGenerationResult | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    // Check TTL
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    // Increment hit count
    entry.result.hitCount++;
    return entry.result;
  }

  set(key: string, result: Omit<CachedGenerationResult, 'cacheKey' | 'hitCount'>): void {
    // Evict oldest if at capacity
    if (this.store.size >= this.config.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }

    const expiresAt = Date.now() + this.config.defaultTtlSeconds * 1000;

    this.store.set(key, {
      result: {
        ...result,
        cacheKey: key,
        hitCount: 0,
      },
      expiresAt,
    });
  }

  /**
   * Try to get from cache. If found, return the cached result.
   * If not found, execute the generator function, cache the result, and return it.
   */
  async getOrGenerate<T extends Record<string, unknown>>(
    cacheKey: string,
    generator: () => Promise<T>,
  ): Promise<T | CachedGenerationResult> {
    const cached = this.get(cacheKey);
    if (cached) return cached;

    // Execute generator
    const result = await generator();

    // Cache the result if the generator returns an object with outputRefs
    if (typeof result === 'object' && result !== null && 'outputRefs' in result) {
      const cacheResult: CachedGenerationResult = {
        cacheKey,
        
        resultId: String(result.resultId ?? ''),
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + this.config.defaultTtlSeconds * 1000).toISOString(),
        hitCount: 0,
        outputRefs: (result.outputRefs as string[]) ?? [],
      };
      this.set(cacheKey, cacheResult);
    }

    return result;
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }

  getStats(): { size: number; maxEntries: number } {
    return { size: this.store.size, maxEntries: this.config.maxEntries };
  }
}

// ---------------------------------------------------------------------------
// Cache hit tracking
// ---------------------------------------------------------------------------

export interface CacheHitStats {
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  hitRate: number;
  spaceSavedEstimate: number; // estimated cost savings from cache hits
}

export class CacheHitTracker {
  private stats: CacheHitStats = {
    totalRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    hitRate: 0,
    spaceSavedEstimate: 0,
  };

  registerHit(costSavedCents: number = 0): void {
    this.stats.totalRequests++;
    this.stats.cacheHits++;
    this.stats.spaceSavedEstimate += costSavedCents;
    this.stats.hitRate = Math.round(
      (this.stats.cacheHits / Math.max(this.stats.totalRequests, 1)) * 1000
    ) / 10;
  }

  registerMiss(): void {
    this.stats.totalRequests++;
    this.stats.cacheMisses++;
    this.stats.hitRate = Math.round(
      (this.stats.cacheHits / Math.max(this.stats.totalRequests, 1)) * 1000
    ) / 10;
  }

  getStats(): CacheHitStats {
    return { ...this.stats };
  }

  reset(): void {
    this.stats = {
      totalRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      hitRate: 0,
      spaceSavedEstimate: 0,
    };
  }
}
