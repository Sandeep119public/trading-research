import type { BinanceKline, FetchKlinesFn } from "@trading-research/data";

const BINANCE_KLINES_URL = "https://api.binance.com/api/v3/klines";

const DEFAULT_TIMEOUT_MS = 10_000;

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

/** Binance REST as the `FetchKlinesFn` transport. Nothing else lives here:
 * range assembly, validation, and caching belong to the service handler.
 * The request aborts after `timeoutMs`, so a hung upstream is a 502 with a
 * timeout message instead of an isolate stuck waiting. */
export function createBinanceKlinesFetcher(
  fetchImpl: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, init),
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): FetchKlinesFn {
  return async ({ symbol, interval, startTime, endTime, limit }) => {
    const query = new URLSearchParams({
      symbol,
      interval,
      startTime: String(startTime),
      endTime: String(endTime),
      limit: String(limit ?? 1000)
    });
    let response: Response;
    try {
      response = await fetchImpl(`${BINANCE_KLINES_URL}?${query.toString()}`, {
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (err) {
      if (isTimeout(err)) throw new Error(`Binance timed out after ${timeoutMs}ms`);
      throw err;
    }
    if (!response.ok) {
      throw new Error(`Binance responded ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (err) {
      if (isTimeout(err)) throw new Error(`Binance timed out after ${timeoutMs}ms`);
      throw new Error(`Binance returned a body that is not JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!Array.isArray(body)) throw new Error("Binance returned a payload that is not an array of klines");
    return body as BinanceKline[];
  };
}
