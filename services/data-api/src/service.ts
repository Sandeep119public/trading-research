import {
  MAX_PAGE_LIMIT,
  SUPPORTED_SYMBOLS,
  SUPPORTED_TIMEFRAMES,
  TIMEFRAME_MS,
  expectedSeconds,
  fetchKlinesRange,
  normalizeBinanceKlines,
  rangeIsClosed,
  type BinanceKline,
  type DataRange,
  type FetchKlinesFn,
  type SupportedSymbol,
  type SupportedTimeframe
} from "@trading-research/data";
import type { CacheStore } from "./cache";

/**
 * Cap on one request's span so a single URL cannot pin an isolate into a
 * multi-hundred-page fetch run before the shared pagination guard trips.
 */
export const MAX_RANGE_CANDLES = 50_000;

/** Cached ranges are historical and immutable, but bounds keep growth finite. */
export const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface DataApiDeps {
  fetchKlines: FetchKlinesFn;
  cache: CacheStore;
}

interface Query {
  symbol: SupportedSymbol;
  timeframe: SupportedTimeframe;
  range: DataRange;
  limit: number;
}

type Parsed = { ok: true; value: Query } | { ok: false; error: string };

/** Raised when the fetched rows cannot account for every candle the requested
 * range implies. Deliberately not an upstream failure: the upstream answered,
 * the range simply cannot be served in full. */
class RangeNotCoveredError extends Error {}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isSupportedSymbol(value: string): value is SupportedSymbol {
  return (SUPPORTED_SYMBOLS as readonly string[]).includes(value);
}

function isSupportedTimeframe(value: string): value is SupportedTimeframe {
  return (SUPPORTED_TIMEFRAMES as readonly string[]).includes(value);
}

function parseInteger(raw: string | null, name: string): { ok: true; value: number } | { ok: false; error: string } {
  if (raw === null || raw === "") return { ok: false, error: `${name} is required` };
  if (!/^\d+$/.test(raw)) return { ok: false, error: `${name} must be a non-negative integer, got "${raw}"` };
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) return { ok: false, error: `${name} is out of range` };
  return { ok: true, value };
}

function parseQuery(params: URLSearchParams): Parsed {
  const symbol = params.get("symbol");
  if (!symbol) return { ok: false, error: "symbol is required" };
  if (!isSupportedSymbol(symbol)) {
    return { ok: false, error: `unsupported symbol: ${symbol}. Supported: ${SUPPORTED_SYMBOLS.join(", ")}` };
  }
  const timeframe = params.get("timeframe");
  if (!timeframe) return { ok: false, error: "timeframe is required" };
  if (!isSupportedTimeframe(timeframe)) {
    return { ok: false, error: `unsupported timeframe: ${timeframe}. Supported: ${SUPPORTED_TIMEFRAMES.join(", ")}` };
  }

  const start = parseInteger(params.get("start"), "start");
  if (!start.ok) return start;
  const end = parseInteger(params.get("end"), "end");
  if (!end.ok) return end;
  if (start.value > end.value) return { ok: false, error: `start must be <= end, got ${start.value} > ${end.value}` };

  let limit = MAX_PAGE_LIMIT;
  if (params.get("limit") !== null) {
    const parsed = parseInteger(params.get("limit"), "limit");
    if (!parsed.ok) return parsed;
    if (parsed.value < 1 || parsed.value > MAX_PAGE_LIMIT) {
      return { ok: false, error: `limit must be in 1..${MAX_PAGE_LIMIT}, got ${parsed.value}` };
    }
    limit = parsed.value;
  }

  return {
    ok: true,
    value: { symbol, timeframe, range: { startTime: start.value, endTime: end.value }, limit }
  };
}

const JSON_HEADERS = { "content-type": "application/json", "access-control-allow-origin": "*" };
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "*"
};

function rowsResponse(rows: unknown): Response {
  return new Response(JSON.stringify(rows), { status: 200, headers: JSON_HEADERS });
}

function errorResponse(status: number, error: string, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify({ error }), { status, headers: { ...JSON_HEADERS, ...extraHeaders } });
}

/**
 * The data service: one endpoint, one job — historical OHLCV over HTTP.
 *
 * Contract: `GET /klines?symbol&timeframe&start&end[&limit]` answers with the
 * Binance kline rows for the whole range (`limit` is the upstream page size,
 * never a truncation of the answer), after running them through the shared
 * `packages/data` pipeline: pagination guard, live-edge forming-candle
 * exclusion, range selection, normalization. Nothing trading-related,
 * authenticated, or symbol/timeframe-scope-escaping lives here.
 *
 * Failure is always a non-200 with an `error` body: a range that cannot be
 * covered in full is an error response, never a shorter 200.
 */
export function createDataApi(deps: DataApiDeps) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (request.method !== "GET") {
      return errorResponse(405, `method not allowed: ${request.method}`, { allow: "GET, OPTIONS" });
    }
    if (url.pathname !== "/klines") return errorResponse(404, `unknown path ${url.pathname}: try GET /klines`);

    const query = parseQuery(url.searchParams);
    if (!query.ok) return errorResponse(400, query.error);
    const { symbol, timeframe, range, limit } = query.value;

    const spanCandles = (range.endTime - range.startTime) / TIMEFRAME_MS[timeframe] + 1;
    if (spanCandles > MAX_RANGE_CANDLES) {
      return errorResponse(
        400,
        `range is too large: ${Math.ceil(spanCandles)} ${timeframe} candles exceeds the ${MAX_RANGE_CANDLES} candle limit`
      );
    }

    // Coverage is checked for every range, live or not: a live range still has
    // to contain every candle that has closed inside it, or the answer would
    // be a silently short 200. Only caching is restricted to closed ranges,
    // because their answers are the ones that can never change.
    const cacheable = rangeIsClosed(range, timeframe);
    const cacheKey = `klines:${symbol}:${timeframe}:${range.startTime}:${range.endTime}`;

    if (cacheable) {
      const hit = await readCache(deps.cache, cacheKey);
      if (hit !== null) {
        try {
          return rowsResponse(JSON.parse(hit));
        } catch {
          // Corrupt entry: refetch instead of serving garbage.
        }
      }
    }

    let rows: BinanceKline[];
    try {
      rows = await fetchKlinesRange({ symbol, timeframe, range, limit, fetchKlines: deps.fetchKlines });
      // Normalization is validation: malformed rows must never be served or
      // cached, so this runs before either.
      const candles = normalizeBinanceKlines(rows);
      assertCovered(range, timeframe, candles.map(c => c.timestamp));
    } catch (err) {
      if (err instanceof RangeNotCoveredError) return errorResponse(422, err.message);
      return errorResponse(502, `upstream klines failed: ${message(err)}`);
    }

    if (cacheable) await writeCache(deps.cache, cacheKey, rows);
    return rowsResponse(rows);
  };
}

function assertCovered(range: DataRange, timeframe: SupportedTimeframe, timestamps: readonly number[]): void {
  const have = new Set(timestamps);
  const missing = expectedSeconds(range, timeframe).filter(ts => !have.has(ts));
  if (missing.length > 0) {
    throw new RangeNotCoveredError(
      `range ${range.startTime}..${range.endTime} is not fully covered: ${missing.length} candle(s) missing, first at ${missing[0]}`
    );
  }
}

/** The cache is an optimization, not a dependency: if it cannot answer, the
 * range still gets fetched. */
async function readCache(cache: CacheStore, key: string): Promise<string | null> {
  try {
    return await cache.get(key);
  } catch {
    return null;
  }
}

async function writeCache(cache: CacheStore, key: string, rows: unknown): Promise<void> {
  try {
    await cache.put(key, JSON.stringify(rows), CACHE_TTL_SECONDS);
  } catch {
    // Serving a range must not fail because caching failed.
  }
}
