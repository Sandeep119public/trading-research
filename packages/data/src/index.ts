import type { Candle } from "@trading-research/shared";

export * from "./http";

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

/**
 * The one universe the whole system may offer: the data service only ever
 * fetches these, and the UI only ever offers these, so a selectable option
 * can never point at something the service cannot serve. Declared here (the
 * shared data layer) so service and client cannot drift apart.
 */
export const SUPPORTED_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"] as const;

export const SUPPORTED_TIMEFRAMES = ["1m", "5m", "15m", "1h"] as const satisfies readonly Timeframe[];

export type SupportedSymbol = (typeof SUPPORTED_SYMBOLS)[number];

export type SupportedTimeframe = (typeof SUPPORTED_TIMEFRAMES)[number];

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

/** Binance's own page cap; also the largest page a caller may ask for. */
export const MAX_PAGE_LIMIT = 1000;
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
    // Freeze: normalized candles are cached and handed to the simulation, so
    // no consumer may be able to mutate history through a live reference.
    candles.push(Object.freeze({ timestamp, open: o, high: h, low: l, close: c, volume: v }) as Candle);
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
 * local in-memory caching, and load status. Knows nothing about orders,
 * positions, P&L, strategies, replay speed, or backtest statistics. Download
 * (here) and replay (MarketEngine) stay separate: this class only supplies
 * validated datasets. Symbol and timeframe arrive as configuration and never
 * change underneath a loaded cache: a new selection builds a new manager, so
 * candles from two datasets can never mix.
 */
export class BinanceDataManager {
  private readonly symbol: string;
  private readonly timeframe: Timeframe;
  private readonly fetchKlines: FetchKlinesFn;
  private readonly cache = new Map<number, Candle>();
  private readonly listeners = new Set<DataManagerListener>();
  private state: DataManagerState;

  constructor(config: DataManagerConfig) {
    if (!config.symbol) throw new Error("symbol is required");
    if (!(config.timeframe in TIMEFRAME_MS)) throw new RangeError(`Unsupported timeframe: ${config.timeframe}`);
    if (typeof config.fetchKlines !== "function") throw new Error("fetchKlines transport is required");
    this.symbol = config.symbol;
    this.timeframe = config.timeframe;
    this.fetchKlines = config.fetchKlines;
    this.state = {
      symbol: this.symbol,
      timeframe: this.timeframe,
      status: "idle",
      error: null,
      loadedRange: null,
      candleCount: 0
    };
  }

  getSymbol(): string {
    return this.symbol;
  }

  getTimeframe(): Timeframe {
    return this.timeframe;
  }

  getState(): DataManagerState {
    const { loadedRange } = this.state;
    return { ...this.state, loadedRange: loadedRange ? { ...loadedRange } : null };
  }

  subscribe(listener: DataManagerListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getCachedCandles(): Candle[] {
    return [...this.cache.values()].sort((a, b) => a.timestamp - b.timestamp);
  }

  /** Reset every piece of mutable state this module owns: candles, load status, and the loaded-range snapshot. */
  clear(): void {
    this.cache.clear();
    this.publish({ status: "idle", error: null, loadedRange: null, candleCount: 0 });
  }

  async loadRange(range: DataRange, limit = MAX_PAGE_LIMIT): Promise<Candle[]> {
    this.publish({ status: "fetching", error: null });
    try {
      assertRange(range);
      assertLimit(limit);
      let candles: Candle[];
      // Only a range made entirely of closed candles can be answered from the
      // cache: a live-edge range gains candles as time passes, so it must be
      // refetched to stay true.
      if (rangeIsClosed(range, this.timeframe) && this.isRangeCached(range)) {
        candles = this.sliceRange(range);
      } else {
        const selected = await fetchKlinesRange({
          symbol: this.symbol,
          timeframe: this.timeframe,
          range,
          limit,
          fetchKlines: this.fetchKlines
        });
        // Validate before caching: malformed rows must not leave a
        // half-populated cache behind.
        for (const candle of normalizeBinanceKlines(selected)) {
          this.cache.set(candle.timestamp, candle);
        }
        // Every closed candle the range implies must be present. Fail loudly
        // instead of handing the simulation a silently incomplete dataset; the
        // still-forming candle is not expected, so a live edge is not a hole.
        if (!this.isRangeCached(range)) {
          throw new Error(
            `Range ${range.startTime}..${range.endTime} is not fully covered: fetched klines leave a hole`
          );
        }
        candles = this.sliceRange(range);
      }
      this.publish({ status: "cached", error: null, loadedRange: { ...range }, candleCount: candles.length });
      return candles;
    } catch (err) {
      this.publish({ status: "error", error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  private publish(patch: Partial<DataManagerState>): void {
    this.state = { ...this.state, ...patch };
    const snapshot = this.getState();
    for (const listener of [...this.listeners]) listener(snapshot);
  }

  private isRangeCached(range: DataRange): boolean {
    return expectedSeconds(range, this.timeframe).every(ts => this.cache.has(ts));
  }

  private sliceRange(range: DataRange): Candle[] {
    // Compare in the truncated-seconds domain: raw openTime ms values lose
    // their sub-second part on normalization, so re-deriving membership from
    // ms bounds would wrongly drop boundary candles.
    const wanted = new Set(expectedSeconds(range, this.timeframe));
    return this.getCachedCandles().filter(c => wanted.has(c.timestamp));
  }
}

/**
 * Every timeframe-aligned open inside the requested range that has actually
 * closed as of `nowMs`, as integer seconds. This is the definition of "the
 * range is fully covered": whoever serves a range (client cache, data
 * service) checks its candles against this list instead of trusting that a
 * response merely "looks complete". The still-forming candle is not expected
 * to exist yet, so a range ending inside it is not a hole. When no candle in
 * the range has closed at all (the range sits in the future, or entirely
 * inside the forming candle), the range's own opens are required instead, so
 * a caller reports "not covered" rather than an empty success.
 */
export function expectedSeconds(range: DataRange, timeframe: Timeframe, nowMs: number = Date.now()): number[] {
  assertRange(range);
  const intervalMs = TIMEFRAME_MS[timeframe];
  const opensUpTo = (end: number): number[] => {
    const out: number[] = [];
    let open = Math.floor(range.startTime / intervalMs) * intervalMs;
    if (open < range.startTime) open += intervalMs;
    for (; open <= end; open += intervalMs) {
      out.push(Math.floor(open / 1000));
    }
    return out;
  };
  const closed = opensUpTo(Math.min(range.endTime, lastClosedOpen(nowMs, intervalMs)));
  return closed.length > 0 ? closed : opensUpTo(range.endTime);
}

/**
 * True when every candle the range implies has closed, so the answer for this
 * range can never change again: exactly the ranges worth caching. A range that
 * reaches the forming candle is a live-edge range and must be refetched.
 */
export function rangeIsClosed(range: DataRange, timeframe: Timeframe, nowMs: number = Date.now()): boolean {
  assertRange(range);
  return range.endTime < formingOpen(nowMs, TIMEFRAME_MS[timeframe]);
}

/** Open of the candle still forming at `nowMs` (exactly `nowMs` when it opens). */
function formingOpen(nowMs: number, intervalMs: number): number {
  return Math.floor(nowMs / intervalMs) * intervalMs;
}

/** Newest grid open whose candle has closed by `nowMs` (open + interval - 1 <= now). */
function lastClosedOpen(nowMs: number, intervalMs: number): number {
  return Math.floor((nowMs - intervalMs + 1) / intervalMs) * intervalMs;
}

export interface FetchRangeConfig {
  symbol: string;
  timeframe: Timeframe;
  range: DataRange;
  limit?: number;
  fetchKlines: FetchKlinesFn;
}

/**
 * Page Binance (or any Binance-shaped transport) until the requested range is
 * covered, then hand back the rows that belong to it: rows selected by
 * openTime, and any candle that has not closed as of now excluded. Shared by
 * the browser DataManager and the data service so neither keeps its own copy
 * of the pagination guard, the live-edge rule, or the range selection.
 *
 * Throws instead of returning a short answer: a stalled cursor, a malformed
 * page, or a pagination run that never completes are all "cannot serve this
 * range" conditions, never a truncated success.
 */
export async function fetchKlinesRange(config: FetchRangeConfig): Promise<BinanceKline[]> {
  const { symbol, timeframe, range, fetchKlines } = config;
  const limit = config.limit ?? MAX_PAGE_LIMIT;
  assertRange(range);
  assertLimit(limit);
  if (!(timeframe in TIMEFRAME_MS)) throw new RangeError(`Unsupported timeframe: ${timeframe}`);
  const intervalMs = TIMEFRAME_MS[timeframe];
  const raw: BinanceKline[] = [];
  let cursor = range.startTime;
  let prevCursor = -Infinity;
  let paginationComplete = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    if (!(cursor > prevCursor)) throw new Error("Kline pagination stalled: cursor did not advance");
    prevCursor = cursor;
    const rows = await fetchKlines({
      symbol,
      interval: timeframe,
      startTime: cursor,
      endTime: range.endTime,
      limit
    });
    if (rows.length === 0) {
      paginationComplete = true;
      break;
    }
    raw.push(...rows);
    if (rows.length < limit) {
      paginationComplete = true;
      break;
    }
    // A transport may answer whole ranges rather than single pages (the HTTP
    // data service does: `limit` is its upstream page size, never a truncation
    // of the answer). A full-size answer is therefore not proof of more pages:
    // stop as soon as the accumulated rows cover every closed candle the range
    // implies. Without this, a live-edge range issues a follow-up request that
    // sits entirely inside the still-forming candle, which no server can cover.
    if (coversExpected(raw, range, timeframe)) {
      paginationComplete = true;
      break;
    }
    const lastOpen = rows[rows.length - 1][0];
    if (!Number.isFinite(lastOpen)) throw new Error("Malformed kline page: last openTime is not a number");
    cursor = lastOpen + intervalMs;
    if (cursor > range.endTime) {
      paginationComplete = true;
      break;
    }
  }
  if (!paginationComplete) {
    throw new Error("Kline pagination exceeded " + MAX_PAGES + " pages before the requested range was fully covered");
  }
  // A candle that has not closed as of now is partial data no matter which
  // end the caller asked for: an end captured milliseconds ago still lands
  // before `now` while the current candle is forming.
  return selectKlinesInRange(dropFormingCandles(raw, Date.now()), range);
}

function assertLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new RangeError(`limit must be an integer in 1..${MAX_PAGE_LIMIT}`);
  }
}

/**
 * True when the accumulated rows already contain every closed candle the
 * range implies (the `expectedSeconds` definition of "fully covered"). Extra
 * rows — e.g. a still-forming candle a direct upstream returns — are ignored,
 * and malformed rows are skipped here and left for the normalizer to reject.
 */
function coversExpected(raw: readonly BinanceKline[], range: DataRange, timeframe: Timeframe): boolean {
  const have = new Set<number>();
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 7) continue;
    const openTime = row[0];
    if (!Number.isFinite(openTime)) continue;
    have.add(Math.floor(openTime / 1000));
  }
  return expectedSeconds(range, timeframe).every(ts => have.has(ts));
}

export type DataManagerStatus = "idle" | "fetching" | "cached" | "error";

/**
 * Everything the Data Manager panel needs, owned by the same module that owns
 * the candles. `status` is a real state, not a UI invention: "cached" means
 * candles for the last requested range are available locally, "fetching"
 * means a request is in flight, "error" means the last attempt failed and
 * `error` says why.
 */
export interface DataManagerState {
  symbol: string;
  timeframe: Timeframe;
  status: DataManagerStatus;
  error: string | null;
  loadedRange: DataRange | null;
  candleCount: number;
}

export type DataManagerListener = (state: DataManagerState) => void;

