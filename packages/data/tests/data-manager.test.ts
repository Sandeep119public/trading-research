import { describe, expect, it, vi } from "vitest";
import { CandleMarketEngine } from "@trading-research/engine";
import { ReplayController } from "@trading-research/replay";
import {
  BinanceDataManager,
  dropFormingCandles,
  normalizeBinanceKlines,
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

const T0 = 1_700_000_000_000;
const rows = [
  kline(T0, 100, 101, 99, 100.5),
  kline(T0 + MIN, 100.5, 102, 100, 101.5),
  kline(T0 + 2 * MIN, 101.5, 103, 101, 102.5)
];

describe("binance adapter", () => {
  it("maps the same response to the same candles", () => {
    expect(normalizeBinanceKlines(rows)).toEqual(normalizeBinanceKlines([...rows]));
    expect(normalizeBinanceKlines(rows)).toEqual([
      { timestamp: T0 / 1000, open: 100, high: 101, low: 99, close: 100.5, volume: 10 },
      { timestamp: (T0 + MIN) / 1000, open: 100.5, high: 102, low: 100, close: 101.5, volume: 10 },
      { timestamp: (T0 + 2 * MIN) / 1000, open: 101.5, high: 103, low: 101, close: 102.5, volume: 10 }
    ]);
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

  it("never lets malformed data reach the simulation", async () => {
    const fetch = vi.fn(async () => [[T0, "100"] as unknown as BinanceKline]);
    const manager = new BinanceDataManager({ symbol: "BTCUSDT", timeframe: "1m", fetchKlines: fetch as never });
    await expect(manager.loadRange({ startTime: T0, endTime: T0 })).rejects.toThrow(/Malformed/);
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
