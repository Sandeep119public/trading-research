import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BinanceKline, FetchKlinesFn, FetchKlinesParams } from "@trading-research/data";
import { MemoryCacheStore } from "../src/cache";
import { MAX_RANGE_CANDLES, createDataApi } from "../src/service";
import { createBinanceKlinesFetcher } from "../src/binance";

const MIN = 60_000;
const T0 = 1_700_000_040_000;
/** Fixed clock, well past the fixture range: every default request is historical. */
const NOW = T0 + 30 * 24 * 60 * MIN;

function kline(
  openTime: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 10,
  closeTime = openTime + MIN - 1
): BinanceKline {
  return [openTime, String(open), String(high), String(low), String(close), String(volume), closeTime, "0", 0, "0", "0", "0"];
}

const rows = [
  kline(T0, 100, 101, 99, 100.5),
  kline(T0 + MIN, 100.5, 102, 100, 101.5),
  kline(T0 + 2 * MIN, 101.5, 103, 101, 102.5)
];

const BASE = { symbol: "BTCUSDT", timeframe: "1m", start: String(T0), end: String(T0 + 2 * MIN) };

function request(query: Record<string, string>): Request {
  return new Request(`https://data.test/klines?${new URLSearchParams(query).toString()}`);
}

async function call(api: ReturnType<typeof createDataApi>, query: Record<string, string>) {
  const response = await api(request(query));
  const text = await response.text();
  return {
    status: response.status,
    body: text === "" ? null : JSON.parse(text),
    cors: response.headers.get("access-control-allow-origin")
  };
}

function apiWith(fetchKlines: FetchKlinesFn, cache = new MemoryCacheStore()) {
  return { api: createDataApi({ fetchKlines, cache }), cache };
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("request validation", () => {
  const invalid: Array<[string, Record<string, string>]> = [
    ["missing symbol", { timeframe: "1m", start: String(T0), end: String(T0) }],
    ["missing timeframe", { symbol: "BTCUSDT", start: String(T0), end: String(T0) }],
    ["missing start", { symbol: "BTCUSDT", timeframe: "1m", end: String(T0) }],
    ["non-numeric start", { symbol: "BTCUSDT", timeframe: "1m", start: "yesterday", end: String(T0) }],
    ["negative start", { symbol: "BTCUSDT", timeframe: "1m", start: "-1", end: String(T0) }],
    ["start after end", { symbol: "BTCUSDT", timeframe: "1m", start: String(T0 + MIN), end: String(T0) }],
    ["unsupported symbol", { ...BASE, symbol: "XRPUSDT" }],
    ["unsupported timeframe", { ...BASE, timeframe: "4h" }],
    ["zero limit", { ...BASE, limit: "0" }],
    ["limit above the page cap", { ...BASE, limit: "1001" }]
  ];

  it.each(invalid)("rejects %s with 400 and never touches the exchange", async (_label, query) => {
    const fetchKlines = vi.fn(async () => rows);
    const { api } = apiWith(fetchKlines);
    const result = await call(api, query);
    expect(result.status).toBe(400);
    expect(result.body).toHaveProperty("error");
    expect(typeof result.body.error).toBe("string");
    expect(result.cors).toBe("*");
    expect(fetchKlines).not.toHaveBeenCalled();
  });

  it("rejects a range wider than the service cap before fetching", async () => {
    const fetchKlines = vi.fn(async () => rows);
    const { api } = apiWith(fetchKlines);
    const result = await call(api, {
      ...BASE,
      end: String(T0 + MAX_RANGE_CANDLES * MIN)
    });
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/too large/);
    expect(fetchKlines).not.toHaveBeenCalled();
  });
});

describe("serving a range", () => {
  it("serves a full historical range once and answers repeats from cache", async () => {
    const fetchKlines = vi.fn(async () => rows);
    const { api } = apiWith(fetchKlines);

    const first = await call(api, BASE);
    expect(first.status).toBe(200);
    expect(first.body).toEqual(rows);
    expect(first.cors).toBe("*");
    expect(fetchKlines).toHaveBeenCalledTimes(1);

    const second = await call(api, BASE);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(fetchKlines).toHaveBeenCalledTimes(1);
  });

  it("pages a range that spans several upstream pages without leaving a hole", async () => {
    const fiveRows = [
      kline(T0, 100, 101, 99, 100.5),
      kline(T0 + MIN, 100.5, 102, 100, 101.5),
      kline(T0 + 2 * MIN, 101.5, 103, 101, 102.5),
      kline(T0 + 3 * MIN, 102.5, 104, 102, 103.5),
      kline(T0 + 4 * MIN, 103.5, 105, 103, 104.5)
    ];
    const fetchKlines = vi.fn(
      async ({ startTime, limit }: FetchKlinesParams) =>
        fiveRows.filter(row => row[0] >= startTime).slice(0, limit ?? 1000)
    );
    const { api } = apiWith(fetchKlines);

    const result = await call(api, { ...BASE, end: String(T0 + 4 * MIN), limit: "2" });
    expect(result.status).toBe(200);
    expect(result.body).toHaveLength(5);
    expect(result.body.map((row: BinanceKline) => row[0])).toEqual(fiveRows.map(row => row[0]));
    expect(fetchKlines).toHaveBeenCalledTimes(3);
  });

  it("serves only timeframe-aligned candles inside an unaligned range", async () => {
    const fetchKlines = vi.fn(async () => rows);
    const { api } = apiWith(fetchKlines);
    const result = await call(api, { ...BASE, start: String(T0 + 30_000), end: String(T0 + 90_000) });
    expect(result.status).toBe(200);
    expect(result.body).toHaveLength(1);
    expect(result.body[0][0]).toBe(T0 + MIN);
  });

  it("runs the real Binance transport end to end", async () => {
    const binanceFetch = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify(rows), { status: 200 }));
    const handler = createDataApi({
      fetchKlines: createBinanceKlinesFetcher(binanceFetch),
      cache: new MemoryCacheStore()
    });

    const result = await call(handler, BASE);
    expect(result.status).toBe(200);
    expect(result.body).toEqual(rows);

    const url = new URL(String(binanceFetch.mock.calls[0][0]));
    expect(`${url.origin}${url.pathname}`).toBe("https://api.binance.com/api/v3/klines");
    expect(url.searchParams.get("symbol")).toBe("BTCUSDT");
    expect(url.searchParams.get("startTime")).toBe(String(T0));
    expect(binanceFetch).toHaveBeenCalledTimes(1);

    // Repeat: the exchange is not consulted again for a historical range.
    expect(await call(handler, BASE)).toMatchObject({ status: 200, body: rows });
    expect(binanceFetch).toHaveBeenCalledTimes(1);
  });
});

describe("fail loud", () => {
  it("answers 422 instead of a truncated 200 when the range has a hole", async () => {
    const fetchKlines = vi
      .fn<FetchKlinesFn>()
      .mockResolvedValueOnce([rows[0], rows[2]])
      .mockResolvedValue(rows);
    const { api } = apiWith(fetchKlines);

    const gapped = await call(api, BASE);
    expect(gapped.status).toBe(422);
    expect(gapped.body.error).toMatch(/not fully covered/);

    // Nothing partial was cached, so the next request really goes upstream.
    const recovered = await call(api, BASE);
    expect(recovered.status).toBe(200);
    expect(recovered.body).toEqual(rows);
    expect(fetchKlines).toHaveBeenCalledTimes(2);
  });

  it("answers 502 when the exchange call fails", async () => {
    const fetchKlines = vi.fn<FetchKlinesFn>().mockRejectedValue(new Error("Binance responded 500"));
    const { api } = apiWith(fetchKlines);
    const result = await call(api, BASE);
    expect(result.status).toBe(502);
    expect(result.body.error).toMatch(/upstream klines failed: Binance responded 500/);
  });

  it("answers 502 and caches nothing when upstream rows are invalid", async () => {
    const fetchKlines = vi
      .fn<FetchKlinesFn>()
      .mockResolvedValueOnce([[T0, "100"] as unknown as BinanceKline])
      .mockResolvedValue(rows);
    const { api } = apiWith(fetchKlines);

    const invalid = await call(api, BASE);
    expect(invalid.status).toBe(502);
    expect(invalid.body.error).toMatch(/Malformed/);

    const valid = await call(api, BASE);
    expect(valid.status).toBe(200);
    expect(fetchKlines).toHaveBeenCalledTimes(2);
  });

  it("404s an unknown path and 405s a non-GET method", async () => {
    const fetchKlines = vi.fn(async () => rows);
    const { api } = apiWith(fetchKlines);

    const missing = await api(new Request("https://data.test/health"));
    expect(missing.status).toBe(404);

    const post = await api(new Request("https://data.test/klines", { method: "POST" }));
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, OPTIONS");
    expect(fetchKlines).not.toHaveBeenCalled();
  });

  it("answers OPTIONS with CORS headers so the browser can call cross-origin", async () => {
    const { api } = apiWith(vi.fn(async () => rows));
    const response = await api(new Request("https://data.test/klines", { method: "OPTIONS" }));
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
  });
});

describe("live edge and cache", () => {
  it("never caches a range that reaches the still-forming candle", async () => {
    const liveNow = T0 + 2 * MIN + 30_000;
    vi.spyOn(Date, "now").mockReturnValue(liveNow);
    const fetchKlines = vi.fn(async () => rows);
    const { api } = apiWith(fetchKlines);
    // Exactly what the browser sends: `end` stamped as "now", already a moment
    // stale by the time it reaches the service, so `end < now` while the
    // candle opened at T0 + 2 * MIN is still forming.
    const query = { ...BASE, end: String(liveNow - 1000) };

    const first = await call(api, query);
    expect(first.status).toBe(200);
    expect(first.body).toEqual([rows[0], rows[1]]);
    expect(first.body.every((row: BinanceKline) => row[6] <= liveNow)).toBe(true);

    // The closed set grows with time, so this answer must never stick.
    await call(api, query);
    expect(fetchKlines).toHaveBeenCalledTimes(2);
  });

  it("drops the forming candle at the live edge and never caches it", async () => {
    const liveNow = T0 + 2 * MIN + 30_000;
    vi.spyOn(Date, "now").mockReturnValue(liveNow);
    const liveRows = [...rows, kline(T0 + 3 * MIN, 102.5, 104, 102, 103)];
    const fetchKlines = vi.fn(async () => liveRows);
    const { api } = apiWith(fetchKlines);
    const liveQuery = { ...BASE, end: String(T0 + 4 * MIN) };

    const first = await call(api, liveQuery);
    expect(first.status).toBe(200);
    expect(first.body).toEqual([liveRows[0], liveRows[1]]);
    expect(first.body.every((row: BinanceKline) => row[6] <= liveNow)).toBe(true);

    // The closed set grows with time, so a live-edge answer must never stick.
    const second = await call(api, liveQuery);
    expect(second.status).toBe(200);
    expect(fetchKlines).toHaveBeenCalledTimes(2);
  });

  it("422s a live range that is missing a closed candle", async () => {
    const liveNow = T0 + 2 * MIN + 30_000;
    vi.spyOn(Date, "now").mockReturnValue(liveNow);
    // rows[1] (closed) never comes back: the range must not be served short.
    const fetchKlines = vi.fn(async () => [rows[0]]);
    const { api } = apiWith(fetchKlines);

    const result = await call(api, { ...BASE, end: String(liveNow - 1000) });
    expect(result.status).toBe(422);
    expect(result.body.error).toMatch(/not fully covered/);
    expect(fetchKlines).toHaveBeenCalledTimes(1);
  });

  it("422s a range whose candles have not closed yet", async () => {
    const liveNow = T0 + 2 * MIN + 30_000;
    vi.spyOn(Date, "now").mockReturnValue(liveNow);
    // The only candle this range covers is the one still forming.
    const fetchKlines = vi.fn(async () => [rows[2]]);
    const { api } = apiWith(fetchKlines);

    const result = await call(api, { ...BASE, start: String(T0 + 2 * MIN), end: String(T0 + 2 * MIN) });
    expect(result.status).toBe(422);
    expect(result.body.error).toMatch(/not fully covered/);
  });

  it("serves from the cache even when the cache itself is broken", async () => {
    const fetchKlines = vi.fn(async () => rows);
    const brokenCache = {
      get: async () => {
        throw new Error("kv unavailable");
      },
      put: async () => {
        throw new Error("kv unavailable");
      }
    };
    const handler = createDataApi({ fetchKlines, cache: brokenCache });
    expect(await call(handler, BASE)).toMatchObject({ status: 200, body: rows });
    expect(await call(handler, BASE)).toMatchObject({ status: 200, body: rows });
    expect(fetchKlines).toHaveBeenCalledTimes(2);
  });
});
