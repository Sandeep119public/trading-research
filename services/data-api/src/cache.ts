export interface CacheStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlSeconds: number): Promise<void>;
}

/** The slice of the Workers KV API this service uses. Structural on purpose:
 * the service stays testable and deployable without Cloudflare's type package. */
export interface KvNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export function createKvCacheStore(kv: KvNamespace): CacheStore {
  return {
    get: key => kv.get(key),
    put: (key, value, ttlSeconds) => kv.put(key, value, { expirationTtl: ttlSeconds })
  };
}

interface Entry {
  value: string;
  expiresAt: number;
}

/** Per-isolate fallback used when no KV namespace is bound: the same cache
 * contract, just not shared between isolates. */
export class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly maxEntries = 256) {}

  async get(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  async put(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
