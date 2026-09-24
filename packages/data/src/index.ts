import type { Candle } from "@trading-research/shared";

// Binance GET /api/v3/klines row (all numbers arrive as documented):
// [openTimeMs, open, high, low, close, volume, closeTimeMs, quoteVolume,
//  trades, takerBuyBaseVolume, takerBuyQuoteVolume, ignore]
export type BinanceKline = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  ...unknown[]
];

export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000
};

export interface FetchKlinesParams {
  symbol: string;
  interval: Timeframe;
  /** Inclusive lower bound, exchange convention (ms). */
  startTime: number;
  /** Inclusive upper bound, exchange convention (ms). */
  endTime: number;
  limit?: number;
}

export type FetchKlinesFn = (params: FetchKlinesParams) => Promise<BinanceKline[]>;

export interface DataRange {
  startTime: number;
  endTime: number;
}

export interface DataManagerConfig {
  symbol: string;
  timeframe: Timeframe;
  fetchKlines: FetchKlinesFn;
}

const MAX_LIMIT = 1000;
const MAX_PAGES = 500;

function assertRange(range: DataRange): void {
  if (!Number.isFinite(range.startTime) || !Number.isFinite(range.endTime)) {
    throw new RangeError("Range bounds must be finite numbers");
  }
  if (range.startTime < 0 || range.endTime < 0) throw new RangeError("Range bounds must be >= 0");
  if (range.startTime > range.endTime) throw new RangeError("startTime must be <= endTime");
}

/**
 * Convert validated, in-range, fully-closed Binance klines to simulation
 * candles. Timestamps become integer seconds to match the MarketEngine
 * convention. Pure and deterministic: the same input always yields the same
 * output. Throws on malformed rows, duplicate/non-increasing timestamps, or
 * invalid OHLC relationships so bad data can never enter the simulation.
 */
export function normalizeBinanceKlines(klines: readonly BinanceKline[]): Candle[] {
  const candles: Candle[] = [];
  let prevTimestamp = -Infinity;
  for (let i = 0; i < klines.length; i++) {
    const row = klines[i];
    if (!Array.isArray(row) || row.length < 7) {
      throw new Error(`Malformed kline at position ${i}: expected at least 7 fields`);
    }
    const [openTime, open, high, low, close, volume, closeTime] = row;
    if (!Number.isFinite(openTime) || !Number.isFinite(closeTime)) {
      throw new Error(`Malformed kline at position ${i}: openTime/closeTime must be numbers`);
    }
    if (!(closeTime > openTime)) throw new Error(`Malformed kline at position ${i}: closeTime must exceed openTime`);
    const o = Number(open);
    const h = Number(high);
    const l = Number(low);
    const c = Number(close);
    const v = Number(volume);
    if (![o, h, l, c, v].every(Number.isFinite)) {
      throw new Error(`Malformed kline at position ${i}: OHLCV must be numeric`);
    }
    if (o <= 0 || h <= 0 || l <= 0 || c <= 0) throw new Error(`Invalid kline at position ${i}: prices must be > 0`);
    if (v < 0) throw new Error(`Invalid kline at position ${i}: volume must be >= 0`);
    if (h < l) throw new Error(`Invalid kline at position ${i}: high must be >= low`);
    if (h < o || h < c) throw new Error(`Invalid kline at position ${i}: high must contain open and close`);
    if (l > o || l > c) throw new Error(`Invalid kline at position ${i}: low must contain open and close`);
    const timestamp = Math.floor(openTime / 1000);
    if (!(timestamp > prevTimestamp)) {
      throw new Error(`Invalid kline at position ${i}: timestamps must be strictly increasing`);
    }
    prevTimestamp = timestamp;
    candles.push({ timestamp, open: o, high: h, low: l, close: c, volume: v });
  }
  return candles;
}

/**
 * Keep klines whose open falls inside the requested range (Binance's own
 * convention: rows are selected by openTime). Malformed rows are kept here and
 * rejected loudly by `normalizeBinanceKlines` so bad data can never silently
 * enter the simulation.
 */
export function selectKlinesInRange(klines: readonly BinanceKline[], range: DataRange): BinanceKline[] {
  assertRange(range);
  return klines.filter(row => {
    if (!Array.isArray(row) || row.length < 7) return true;
    const openTime = row[0];
    if (!Number.isFinite(openTime)) return true;
    return openTime >= range.startTime && openTime <= range.endTime;
  });
}

/**
 * Drop the still-forming (partial) candle: any row closing after `nowMs`.
 * Pure and deterministic for a given `nowMs`. Malformed rows are kept for the
 * normalizer to reject.
 */
export function dropFormingCandles(klines: readonly BinanceKline[], nowMs: number): BinanceKline[] {
  return klines.filter(row => {
    if (!Array.isArray(row) || row.length < 7) return true;
    const closeTime = row[6];
    if (!Number.isFinite(closeTime)) return true;
    return closeTime <= nowMs;
  });
}

/**
 * Data-side owner: symbol, timeframe, fetching, validation, normalization,
 * and local in-memory caching. Knows nothing about orders, positions, P&L,
 * strategies, replay speed, or backtest statistics. Download (here) and replay
 * (MarketEngine) stay separate: this class only supplies validated datasets.
 */
export class BinanceDataManager {
  private readonly symbol: string;
  private readonly timeframe: Timeframe;
  private readonly fetchKlines: FetchKlinesFn;
  private readonly cache = new Map<number, Candle>();

  constructor(config: DataManagerConfig) {
    if (!config.symbol) throw new Error("symbol is required");
    if (!(config.timeframe in TIMEFRAME_MS)) throw new RangeError(`Unsupported timeframe: ${config.timeframe}`);
    if (typeof config.fetchKlines !== "function") throw new Error("fetchKlines transport is required");
    this.symbol = config.symbol;
    this.timeframe = config.timeframe;
    this.fetchKlines = config.fetchKlines;
  }

  getSymbol(): string {
    return this.symbol;
  }

  getTimeframe(): Timeframe {
    return this.timeframe;
  }

  getCachedCandles(): Candle[] {
    return [...this.cache.values()].sort((a, b) => a.timestamp - b.timestamp);
  }

  clear(): void {
    this.cache.clear();
  }

  async loadRange(range: DataRange, limit = MAX_LIMIT): Promise<Candle[]> {
    assertRange(range);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new RangeError(`limit must be an integer in 1..${MAX_LIMIT}`);
    }
    if (this.isRangeCached(range)) return this.sliceRange(range);
    const intervalMs = TIMEFRAME_MS[this.timeframe];
    const raw: BinanceKline[] = [];
    let cursor = range.startTime;
    let prevCursor = -Infinity;
    for (let page = 0; page < MAX_PAGES; page++) {
      if (!(cursor > prevCursor)) throw new Error("Kline pagination stalled: cursor did not advance");
      prevCursor = cursor;
      const rows = await this.fetchKlines({
        symbol: this.symbol,
        interval: this.timeframe,
        startTime: cursor,
        endTime: range.endTime,
        limit
      });
      if (rows.length === 0) break;
      raw.push(...rows);
      if (rows.length < limit) break;
      const lastOpen = rows[rows.length - 1][0];
      if (!Number.isFinite(lastOpen)) throw new Error("Malformed kline page: last openTime is not a number");
      cursor = lastOpen + intervalMs;
      if (cursor > range.endTime) break;
    }
    const selected = selectKlinesInRange(dropLiveFormingCandle(raw, range.endTime), range);
    for (const candle of normalizeBinanceKlines(selected)) {
      this.cache.set(candle.timestamp, candle);
    }
    return this.sliceRange(range);
  }

  private isRangeCached(range: DataRange): boolean {
    return this.expectedSeconds(range).every(ts => this.cache.has(ts));
  }

  private sliceRange(range: DataRange): Candle[] {
    // Compare in the truncated-seconds domain: raw openTime ms values lose
    // their sub-second part on normalization, so re-deriving membership from
    // ms bounds would wrongly drop boundary candles.
    const wanted = new Set(this.expectedSeconds(range));
    return this.getCachedCandles().filter(c => wanted.has(c.timestamp));
  }

  private expectedSeconds(range: DataRange): number[] {
    const intervalMs = TIMEFRAME_MS[this.timeframe];
    const out: number[] = [];
    for (let open = range.startTime; open <= range.endTime; open += intervalMs) {
      out.push(Math.floor(open / 1000));
    }
    return out;
  }
}

/**
 * At the live edge (requested end >= now) Binance includes the still-forming
 * candle as the last row. Drop rows that have not closed as of now so partial
 * data never enters the simulation. Historical ranges (end < now) are purely
 * deterministic and untouched.
 */
function dropLiveFormingCandle(raw: BinanceKline[], endTime: number): BinanceKline[] {
  const now = Date.now();
  if (endTime < now) return raw;
  return dropFormingCandles(raw, now);
}
