import type { BinanceKline, FetchKlinesFn } from "@trading-research/data";

const BINANCE_KLINES_URL = "https://api.binance.com/api/v3/klines";

/** Binance REST as the `FetchKlinesFn` transport. Nothing else lives here:
 * range assembly, validation, and caching belong to the service handler. */
export function createBinanceKlinesFetcher(fetchImpl: typeof globalThis.fetch = (input, init) =>
  globalThis.fetch(input, init)
): FetchKlinesFn {
  return async ({ symbol, interval, startTime, endTime, limit }) => {
    const query = new URLSearchParams({
      symbol,
      interval,
      startTime: String(startTime),
      endTime: String(endTime),
      limit: String(limit ?? 1000)
    });
    const response = await fetchImpl(`${BINANCE_KLINES_URL}?${query.toString()}`);
    if (!response.ok) {
      throw new Error(`Binance responded ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`);
    }
    const body: unknown = await response.json();
    if (!Array.isArray(body)) throw new Error("Binance returned a payload that is not an array of klines");
    return body as BinanceKline[];
  };
}
