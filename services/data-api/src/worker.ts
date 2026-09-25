import { createBinanceKlinesFetcher } from "./binance";
import { MemoryCacheStore, createKvCacheStore, type KvNamespace } from "./cache";
import { createDataApi } from "./service";

export interface Env {
  /** Present only when a KV namespace is bound in wrangler.toml. */
  KV?: KvNamespace;
}

// Fallback cache when no KV namespace is bound. Per isolate, but still a real
// cache: repeated requests for the same historical range do not re-hit Binance.
const isolateCache = new MemoryCacheStore();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cache = env.KV ? createKvCacheStore(env.KV) : isolateCache;
    return createDataApi({ fetchKlines: createBinanceKlinesFetcher(), cache })(request);
  }
};
