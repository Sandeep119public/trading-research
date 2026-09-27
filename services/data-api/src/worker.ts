import { createBinanceKlinesFetcher } from "./binance";
import { MemoryCacheStore, createKvCacheStore, type KvNamespace } from "./cache";
import { createDataApi, unexpectedErrorResponse, type DataApiDeps } from "./service";

export interface Env {
  /** Present only when a KV namespace is bound in wrangler.toml. */
  KV?: KvNamespace;
}

// Fallback cache when no KV namespace is bound. Per isolate, but still a real
// cache: repeated requests for the same historical range do not re-hit Binance.
const isolateCache = new MemoryCacheStore();

/**
 * The worker entry with injectable deps: every request runs inside one
 * try/catch, so a failure outside the handler's own error paths (cache
 * construction, unexpected bugs) answers with the service's JSON 500 contract
 * instead of the platform's opaque error response.
 */
export function createWorkerHandler(makeDeps: (env: Env) => DataApiDeps) {
  return async function fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await createDataApi(makeDeps(env))(request);
    } catch (error) {
      return unexpectedErrorResponse(error);
    }
  };
}

export default {
  fetch: createWorkerHandler(env => ({
    fetchKlines: createBinanceKlinesFetcher(),
    cache: env.KV ? createKvCacheStore(env.KV) : isolateCache
  }))
};
