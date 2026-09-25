import { afterEach, describe, expect, it, vi } from "vitest";
import { CandleMarketEngine } from "@trading-research/engine";
import { ReplayController } from "@trading-research/replay";
import {
  BinanceDataManager,
  dropFormingCandles,
  expectedSeconds,
  normalizeBinanceKlines,
  rangeIsClosed,
  selectKlinesInRange,
  type BinanceKline
} from "../src/index";

const MIN = 60_000;

function kline(
  openTime: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 10,
  closeTime = openTime + MIN - 1
): BinanceKline {
  return [
    openTime,
    String(open),
    String(high),
    String(low),
    String(close),
    String(volume),
    closeTime,
    "0",
    0,
    "0",
    "0",
    "0"
  ];
}

const T0 = 1_700_000_040_000;
const rows = [
  kline(T0, 100, 101, 99, 100.5),
  kline(T0 + MIN, 100.5, 102, 100, 101.5),
  kline(T0 + 2 * MIN, 101.5, 103, 101, 102.5)
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("binance adapter", () => {
  it("maps the same response to the same candles", () => {
    expect(normalizeBinanceKlines(rows)).toEqual(normalizeBinanceKlines([...rows]));
    expect(normalizeBinanceKlines(rows)).toEqual([
      { timestamp: T0 / 1000, open: 100, high: 101, low: 99, close: 100.5, volume: 10 },
      { timestamp: (T0 + MIN) / 1000, open: 100.5, high: 102, low: 100, close: 101.5, volume: 10 },
      { timestamp: (T0 + 2 * MIN) / 1000, open: 101.5, high: 103, low: 101, close: 102.5, volume: 10 }
    ]);
  });

  it("freezes normalized candles so cached data cannot be corrupted", () => {
    const [first] = normalizeBinanceKlines(rows);
    try {
      first.close = 999999;
    } catch {
      // Frozen candle: the mutation is rejected instead of corrupting state.
    }
    expect(first.close).toBe(100.5);
  });

  it("rejects non-increasing timestamps", () => {
    expect(() => normalizeBinanceKlines([rows[1], rows[0]])).toThrow(/strictly increasing/);
  });

  it("rejects duplicate candles", () => {
    expect(() => normalizeBinanceKlines([rows[0], rows[0]])).toThrow(/strictly increasing/);
  });

  it("rejects invalid OHLC relationships", () => {
    expect(() => normalizeBinanceKlines([kline(T0, 100, 99, 98, 100)])).toThrow(/high/);
    expect(() => normalizeBinanceKlines([kline(T0, 100, 101, 102, 100)])).toThrow(/low/);
    expect(() => normalizeBinanceKlines([kline(T0, 100, 99, 102, 100)])).toThrow();
  });

  it("rejects malformed rows", () => {
    expect(() => normalizeBinanceKlines([[T0, "100"] as unknown as BinanceKline])).toThrow(/Malformed/);
    expect(() => normalizeBinanceKlines([kline(T0, Number.NaN, 101, 99, 100)])).toThrow(/numeric/);
    expect(() => normalizeBinanceKlines([kline(T0, 0, 101, 99, 100)])).toThrow(/> 0/);
    expect(() => normalizeBinanceKlines([kline(T0, 100, 101, 99, 100, -1)])).toThrow(/volume/);
  });

  it("drops the still-forming candle without touching closed rows", () => {
    const now = T0 + 2 * MIN;
    const closed = kline(T0, 100, 101, 99, 100);
    const forming = kline(T0 + MIN, 100, 101, 99, 100, 10, now + MIN);
    expect(dropFormingCandles([closed, forming], now)).toEqual([closed]);
  });

  it("selects rows by openTime within the requested range", () => {
    const selected = selectKlinesInRange(rows, { startTime: T0 + MIN, endTime: T0 + 2 * MIN });
    expect(selected).toHaveLength(2);
    expect(normalizeBinanceKlines(selected)[0].timestamp).toBe((T0 + MIN) / 1000);
  });

  it("expects only candles that have closed, never the forming one", () => {
    const now = T0 + 2 * MIN + 30_000;
    // The candle opened at T0 + 2 * MIN is still forming at `now`, so it is
    // not demanded even though the requested end is well past it.
    expect(expectedSeconds({ startTime: T0, endTime: T0 + 5 * MIN }, "1m", now)).toEqual([
      T0 / 1000,
      (T0 + MIN) / 1000
    ]);
  });

  it("treats a range that reaches the forming candle as still open", () => {
    const now = T0 + 2 * MIN + 30_000;
    expect(rangeIsClosed({ startTime: T0, endTime: T0 + MIN }, "1m", now)).toBe(true);
    expect(rangeIsClosed({ startTime: T0, endTime: T0 + 2 * MIN }, "1m", now)).toBe(false);
    expect(rangeIsClosed({ startTime: T0, endTime: T0 + 5 * MIN }, "1m", now)).toBe(false);
  });
});

describe("BinanceDataManager", () => {
  it("paginates a historical range and respects its bounds", async () => {
    const seen: number[] = [];
    const fetch = vi.fn(async ({ startTime }: { startTime: number }) => {
      seen.push(startTime);
      if (startTime <= T0) return [rows[0], rows[1]];
      return [rows[2]];
    });
    const manager = new BinanceDataManager({ symbol: "BTCUSDT", timeframe: "1m", fetchKlines: fetch as never });
    const candles = await manager.loadRange({ startTime: T0, endTime: T0 + 2 * MIN }, 2);
    expect(candles).toHaveLength(3);
    expect(seen[0]).toBe(T0);
    expect(seen[1]).toBe(T0 + 2 * MIN);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("serves a repeated range from cache without refetching", async () => {
    const fetch = vi.fn(async () => rows);
    const manager = new BinanceDataManager({ symbol: "BTCUSDT", timeframe: "1m", fetchKlines: fetch as never });
    const first = await manager.loadRange({ startTime: T0, endTime: T0 + 2 * MIN });
    const second = await manager.loadRange({ startTime: T0, endTime: T0 + 2 * MIN });
    expect(second).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("treats a range with no closed candle as a hole", async () => {
    vi.spyOn(Date, "now").mockReturnValue(T0 + 2 * MIN + 30_000);
    const fetch = vi.fn(async () => rows);
    const manager = new BinanceDataManager({ symbol: "BTCUSDT", timeframe: "1m", fetchKlines: fetch as never });
    // The whole range is the candle still forming: nothing in it can be
    // answered yet, so an empty success would be a lie.
    await expect(
      manager.loadRange({ startTime: T0 + 2 * MIN, endTime: T0 + 2 * MIN })
    ).rejects.toThrow(/not fully covered/);
  });

  it("refetches a range that reaches the forming candle instead of serving it stale", async () => {
    vi.spyOn(Date, "now").mockReturnValue(T0 + 2 * MIN + 30_000);
    const fetch = vi.fn(async () => rows);
    const manager = new BinanceDataManager({ symbol: "BTCUSDT", timeframe: "1m", fetchKlines: fetch as never });
    // The browser stamps `end = now` and the request arrives a moment later,
    // so `end` lands inside the candle still forming (rows[2]). That candle
    // must not be ingested, coverage must not demand it, and the answer must
    // not be frozen into the cache.
    const range = { startTime: T0, endTime: Date.now() - 1000 };
    const first = await manager.loadRange(range);
    expect(first.map(c => c.timestamp)).toEqual([T0 / 1000, (T0 + MIN) / 1000]);
    await manager.loadRange(range);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects mutation of cached candles and isolates returned arrays", async () => {
    const fetch = vi.fn(async () => rows);
    const manager = new BinanceDataManager({ symbol: "BTCUSDT", timeframe: "1m", fetchKlines: fetch as never });
    await manager.loadRange({ startTime: T0, endTime: T0 + 2 * MIN });
    try {
      manager.getCachedCandles()[0].close = 999999;
    } catch {
      // Frozen cache: the mutation is rejected instead of corrupting state.
    }
    manager.getCachedCandles().push({ timestamp: -1, open: 1, high: 1, low: 1, close: 1, volume: 1 });
    const cached = manager.getCachedCandles();
    expect(cached).toHaveLength(3);
    expect(cached[0].close).toBe(100.5);
  });

  it("clear empties the cache so the next load refetches", async () => {
    const fetch = vi.fn(async () => rows);
    const manager = new BinanceDataManager({ symbol: "BTCUSDT", timeframe: "1m", fetchKlines: fetch as never });
    await manager.loadRange({ startTime: T0, endTime: T0 + 2 * MIN });
    expect(manager.getCachedCandles()).toHaveLength(3);
    manager.clear();
    expect(manager.getCachedCandles()).toHaveLength(0);
    await manager.loadRange({ startTime: T0, endTime: T0 + 2 * MIN });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("never lets malformed data reach the simulation", async () => {
    const fetch = vi.fn(async () => [[T0, "100"] as unknown as BinanceKline]);
    const manager = new BinanceDataManager({ symbol: "BTCUSDT", timeframe: "1m", fetchKlines: fetch as never });
    await expect(manager.loadRange({ startTime: T0, endTime: T0 })).rejects.toThrow(/Malformed/);
    expect(manager.getCachedCandles()).toHaveLength(0);
  });


  it("does not silently truncate when pagination reaches the page limit", async () => {
    const fetch = vi.fn(async ({ startTime }: { startTime: number }) => [
      kline(startTime, 100, 101, 99, 100)
    ]);
    const manager = new BinanceDataManager({ symbol: "BTCUSDT", timeframe: "1m", fetchKlines: fetch as never });
    await expect(
      manager.loadRange({ startTime: T0, endTime: T0 + 500 * MIN }, 1)
    ).rejects.toThrow(/page/i);
    expect(fetch).toHaveBeenCalledTimes(500);
  });

  it("returns timeframe-aligned candles inside an unaligned requested range", async () => {
    const fetch = vi.fn(async () => rows);
    const manager = new BinanceDataManager({ symbol: "BTCUSDT", timeframe: "1m", fetchKlines: fetch as never });
    const candles = await manager.loadRange({
      startTime: T0 + 30_000,
      endTime: T0 + 90_000
    });
    expect(candles.map(c => c.timestamp)).toEqual([(T0 + MIN) / 1000]);
  });

  it("fails loudly when fetched pages leave a hole in a historical range", async () => {
    const gapped = [rows[0], rows[2]];
    const fetch = vi.fn(async () => gapped);
    const manager = new BinanceDataManager({ symbol: "BTCUSDT", timeframe: "1m", fetchKlines: fetch as never });
    await expect(manager.loadRange({ startTime: T0, endTime: T0 + 2 * MIN })).rejects.toThrow(/cover/i);
  });

  it("loads a one-candle historical range", async () => {
    const fetch = vi.fn(async () => rows);
    const manager = new BinanceDataManager({ symbol: "BTCUSDT", timeframe: "1m", fetchKlines: fetch as never });
    const candles = await manager.loadRange({ startTime: T0, endTime: T0 });
    expect(candles).toHaveLength(1);
    expect(candles[0].timestamp).toBe(T0 / 1000);
  });

  it("leaves no partial state when the transport fails mid-pagination", async () => {
    const fetch = vi.fn(async ({ startTime }: { startTime: number }) => {
      if (startTime > T0) throw new Error("network blew up");
      return [rows[0]];
    });
    const manager = new BinanceDataManager({ symbol: "BTCUSDT", timeframe: "1m", fetchKlines: fetch as never });
    await expect(manager.loadRange({ startTime: T0, endTime: T0 + 2 * MIN }, 1)).rejects.toThrow("network blew up");
    expect(manager.getCachedCandles()).toHaveLength(0);
  });

  it("feeds validated candles into MarketEngine with the future-data rule intact", async () => {
    const fetch = vi.fn(async () => rows);
    const manager = new BinanceDataManager({ symbol: "BTCUSDT", timeframe: "1m", fetchKlines: fetch as never });
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
    replay.step();
    expect(timestamps).toEqual([T0 / 1000, (T0 + MIN) / 1000, (T0 + 2 * MIN) / 1000]);
  });
});

describe("BinanceDataManager state", () => {
  it("starts idle and reports cached only once candles exist", async () => {
    const manager = new BinanceDataManager({
      symbol: "BTCUSDT",
      timeframe: "1m",
      fetchKlines: vi.fn(async () => rows) as never
    });
    expect(manager.getState()).toEqual({
      symbol: "BTCUSDT",
      timeframe: "1m",
      status: "idle",
      error: null,
      loadedRange: null,
      candleCount: 0
    });
    await manager.loadRange({ startTime: T0, endTime: T0 + 2 * MIN });
    expect(manager.getState()).toMatchObject({ status: "cached", candleCount: 3 });
  });

  it("notifies subscribers with every status transition of a failed load", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("network blew up");
    });
    const manager = new BinanceDataManager({ symbol: "BTCUSDT", timeframe: "1m", fetchKlines: fetch as never });
    const seen: string[] = [];
    const unsubscribe = manager.subscribe(state => seen.push(state.status));
    await expect(manager.loadRange({ startTime: T0, endTime: T0 + 2 * MIN })).rejects.toThrow("network blew up");
    expect(seen).toEqual(["fetching", "error"]);
    expect(manager.getState()).toMatchObject({ status: "error", error: "network blew up", loadedRange: null });
    unsubscribe();
    await manager.loadRange({ startTime: T0, endTime: T0 + 2 * MIN }).catch(() => undefined);
    expect(seen).toHaveLength(2);
  });

  it("reports a cache-hit load as cached without touching the transport", async () => {
    const fetch = vi.fn(async () => rows);
    const manager = new BinanceDataManager({ symbol: "BTCUSDT", timeframe: "1m", fetchKlines: fetch as never });
    await manager.loadRange({ startTime: T0, endTime: T0 + 2 * MIN });
    const seen: string[] = [];
    manager.subscribe(state => seen.push(state.status));
    await manager.loadRange({ startTime: T0, endTime: T0 + 2 * MIN });
    expect(seen).toEqual(["fetching", "cached"]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("clear resets every piece of mutable state this module owns", async () => {
    const fetch = vi.fn(async () => rows);
    const manager = new BinanceDataManager({ symbol: "BTCUSDT", timeframe: "1m", fetchKlines: fetch as never });
    await manager.loadRange({ startTime: T0, endTime: T0 + 2 * MIN });
    expect(manager.getState()).toMatchObject({ status: "cached", candleCount: 3 });
    manager.clear();
    expect(manager.getState()).toEqual({
      symbol: "BTCUSDT",
      timeframe: "1m",
      status: "idle",
      error: null,
      loadedRange: null,
      candleCount: 0
    });
    expect(manager.getCachedCandles()).toHaveLength(0);
    await manager.loadRange({ startTime: T0, endTime: T0 + 2 * MIN });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("hands out a state snapshot the caller cannot corrupt", async () => {
    const manager = new BinanceDataManager({
      symbol: "BTCUSDT",
      timeframe: "1m",
      fetchKlines: vi.fn(async () => rows) as never
    });
    await manager.loadRange({ startTime: T0, endTime: T0 + 2 * MIN });
    const snapshot = manager.getState();
    snapshot.loadedRange!.endTime = -1;
    snapshot.status = "error";
    expect(manager.getState()).toMatchObject({ status: "cached", loadedRange: { startTime: T0, endTime: T0 + 2 * MIN } });
  });
});
