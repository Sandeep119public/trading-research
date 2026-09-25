import { afterEach, describe, expect, it, vi } from "vitest";
import { CandleMarketEngine } from "@trading-research/engine";
import { ReplayController } from "@trading-research/replay";
import { BinanceDataManager, createHttpFetchKlines, type BinanceKline } from "../src/index";

const MIN = 60_000;
const SERVICE = "http://data.test";

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

const T0 = 1_700_000_040_000;
const rows = [
  kline(T0, 100, 101, 99, 100.5),
  kline(T0 + MIN, 100.5, 102, 100, 101.5),
  kline(T0 + 2 * MIN, 101.5, 103, 101, 102.5)
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function serviceTransport(fetchImpl: typeof globalThis.fetch) {
  return createHttpFetchKlines({ baseUrl: `${SERVICE}/`, fetchImpl });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HTTP kline transport", () => {
  it("asks the data service with the documented query contract", async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return jsonResponse(rows);
    });
    const transport = serviceTransport(fetchImpl);
    const out = await transport({ symbol: "ETHUSDT", interval: "15m", startTime: T0, endTime: T0 + 2 * MIN, limit: 500 });
    expect(seen).toEqual([
      `${SERVICE}/klines?symbol=ETHUSDT&timeframe=15m&start=${T0}&end=${T0 + 2 * MIN}&limit=500`
    ]);
    expect(out).toEqual(rows);
  });

  it("throws the service's error detail instead of returning a partial 200", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "range is not fully covered: 1 missing candle" }, 422));
    await expect(serviceTransport(fetchImpl)({ symbol: "BTCUSDT", interval: "1m", startTime: T0, endTime: T0 + MIN })).rejects.toThrow(
      /422: range is not fully covered/
    );
  });

  it("reports an unreachable service as an error, never as empty data", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connection refused");
    });
    await expect(serviceTransport(fetchImpl)({ symbol: "BTCUSDT", interval: "1m", startTime: T0, endTime: T0 })).rejects.toThrow(
      /Data service unreachable: connection refused/
    );
  });

  it("rejects a payload that is not a kline array", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ symbol: "BTCUSDT", rows }));
    await expect(serviceTransport(fetchImpl)({ symbol: "BTCUSDT", interval: "1m", startTime: T0, endTime: T0 })).rejects.toThrow(
      /expected an array of klines/
    );
  });

  it("rejects a non-JSON body", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>proxy error</html>", { status: 200 }));
    await expect(serviceTransport(fetchImpl)({ symbol: "BTCUSDT", interval: "1m", startTime: T0, endTime: T0 })).rejects.toThrow(
      /body that is not JSON/
    );
  });
});

describe("BinanceDataManager over the HTTP transport", () => {
  it("keeps the loadRange contract and serves the repeat load without a second request", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(rows));
    const manager = new BinanceDataManager({
      symbol: "BTCUSDT",
      timeframe: "1m",
      fetchKlines: serviceTransport(fetchImpl)
    });
    const range = { startTime: T0, endTime: T0 + 2 * MIN };

    const candles = await manager.loadRange(range);
    expect(candles.map(c => c.timestamp)).toEqual([T0 / 1000, (T0 + MIN) / 1000, (T0 + 2 * MIN) / 1000]);
    expect(manager.getState()).toMatchObject({
      symbol: "BTCUSDT",
      timeframe: "1m",
      status: "cached",
      error: null,
      loadedRange: range,
      candleCount: 3
    });

    const again = await manager.loadRange(range);
    expect(again).toEqual(candles);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never exposes a candle that has not closed as of now", async () => {
    const now = T0 + 2 * MIN + 30_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const liveRows = [...rows, kline(T0 + 3 * MIN, 102.5, 104, 102, 103)];
    const fetchImpl = vi.fn(async () => jsonResponse(liveRows));
    const manager = new BinanceDataManager({
      symbol: "BTCUSDT",
      timeframe: "1m",
      fetchKlines: serviceTransport(fetchImpl)
    });
    // Live edge: the requested end is past `now`, so the forming candle is
    // legitimately absent and the coverage check is exempt.
    const candles = await manager.loadRange({ startTime: T0, endTime: T0 + 3 * MIN });
    expect(candles.map(c => c.timestamp)).toEqual([T0 / 1000, (T0 + MIN) / 1000]);
    expect(candles.every(c => c.timestamp * 1000 + MIN <= now)).toBe(true);
    expect(manager.getState().candleCount).toBe(2);
  });

  it("feeds HTTP-loaded candles through replay with the future-data rule intact", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(rows));
    const manager = new BinanceDataManager({
      symbol: "BTCUSDT",
      timeframe: "1m",
      fetchKlines: serviceTransport(fetchImpl)
    });
    const candles = await manager.loadRange({ startTime: T0, endTime: T0 + 2 * MIN });
    const engine = new CandleMarketEngine(candles);
    const replay = new ReplayController(engine);
    const timestamps: number[] = [];
    replay.subscribe(state => {
      timestamps.push(state.candle.timestamp);
      expect(state.visibleCandles.some(c => c.timestamp > state.candle.timestamp)).toBe(false);
    });
    replay.reset(0);
    replay.step();
    expect(timestamps).toEqual([T0 / 1000, (T0 + MIN) / 1000]);
  });

  it("surfaces a failed response as an error state with no partial cache, then recovers", async () => {
    const fetchImpl = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(jsonResponse({ error: "upstream klines failed: Binance responded 500" }, 502))
      .mockResolvedValue(jsonResponse(rows));
    const manager = new BinanceDataManager({
      symbol: "BTCUSDT",
      timeframe: "1m",
      fetchKlines: serviceTransport(fetchImpl)
    });
    const statuses: string[] = [];
    const unsubscribe = manager.subscribe(state => statuses.push(state.status));

    await expect(manager.loadRange({ startTime: T0, endTime: T0 + 2 * MIN })).rejects.toThrow(/502: upstream klines failed/);
    expect(manager.getState().status).toBe("error");
    expect(manager.getState().error).toMatch(/upstream klines failed/);
    expect(manager.getState().loadedRange).toBeNull();
    expect(manager.getCachedCandles()).toHaveLength(0);

    const candles = await manager.loadRange({ startTime: T0, endTime: T0 + 2 * MIN });
    expect(candles).toHaveLength(3);
    expect(manager.getState().status).toBe("cached");
    expect(manager.getState().error).toBeNull();
    expect(statuses).toEqual(["fetching", "error", "fetching", "cached"]);
    unsubscribe();
  });
});
