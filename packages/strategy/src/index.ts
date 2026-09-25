import type { MarketState, OrderSide } from "@trading-research/shared";

/**
 * What a strategy sees at bar T: the engine's `MarketState` — `candle` (bar T),
 * `index`, and `visibleCandles` (bars 0..T, frozen by the engine). That slice
 * is the Future Data Rule made structural, so a strategy holding this
 * reference cannot read past T however it walks the array. It is named here so
 * the strategy contract speaks its own vocabulary; a field joins it only when
 * some module owns that data and hands it over.
 */
export type StrategyContext = MarketState;

export interface StrategySignal {
  side: OrderSide;
  quantity: number;
  stopLoss?: number;
  takeProfit?: number;
  reduceOnly?: boolean;
}

/**
 * The V1 strategy contract.
 *
 * At most ONE signal per bar: the ExecutionEngine holds a single pending
 * order, so a second signal in the same bar could never be honored. Returning
 * more than one is a contract violation — BacktestDriver throws before
 * submitting any of them, it does not silently take the first.
 */
export interface Strategy {
  onBar(context: StrategyContext): StrategySignal[];

  /**
   * Clear everything remembered across bars (position flags, indicator
   * state, ...). BacktestDriver.run() calls this before each run, so one
   * instance can be reused and still produce identical results. A strategy
   * with no cross-bar state need not define it.
   */
  reset?(): void;
}

/**
 * Exponential moving average: seeded with the simple average of the first
 * `period` values, then `value * k + previous * (1 - k)` with
 * `k = 2 / (period + 1)`. Returns an array aligned to the input, `undefined`
 * wherever the seed point has not been reached.
 *
 * Pure and causal: the value at index i uses only values[0..i], so appending
 * later values can never change it. That is what makes an indicator computed
 * this way safe to run bar by bar under the Future Data Rule.
 */
export function ema(values: readonly number[], period: number): Array<number | undefined> {
  if (!Number.isInteger(period) || period < 1) throw new RangeError("period must be an integer >= 1");
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) throw new RangeError(`values[${i}] must be a finite number`);
  }
  const out: Array<number | undefined> = new Array(values.length).fill(undefined);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let previous = sum / period;
  out[period - 1] = previous;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    previous = values[i] * k + previous * (1 - k);
    out[i] = previous;
  }
  return out;
}

export interface EmaCrossConfig {
  /** Fast EMA period. Defaults to 20. */
  fast?: number;
  /** Slow EMA period. Defaults to 50. */
  slow?: number;
  /** Units per entry and per exit. V1 has no sizing model, so size is strategy config. */
  quantity: number;
}

function assertPeriod(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be an integer >= 1`);
}

/**
 * EMA(fast)/EMA(slow) crossover — the sample strategy that exercises the
 * Strategy contract against a real BacktestDriver run.
 *
 * Long-only:
 *  - fast crosses ABOVE slow → enter long (ignored while already long: V1
 *    forbids pyramiding)
 *  - fast crosses BELOW slow → exit long, i.e. flatten. It never opens a
 *    short, so a first cross below while flat emits nothing.
 *
 * No lookahead: both EMAs are recomputed from `context.visibleCandles` on every
 * bar, so the signal at T is a function of bars 0..T only, and recomputing is
 * idempotent — re-seeing a bar cannot corrupt the indicator. The single piece
 * of remembered state is whether this strategy is in a position, which
 * `reset()` clears and BacktestDriver.run() calls before every run.
 *
 * The position flag tracks this strategy's own emitted signals, not
 * Portfolio's: a fill always lands on the next candle's open after the signal,
 * and the only signal that can go unfilled is one on the dataset's last bar.
 */
export class EmaCrossStrategy implements Strategy {
  private readonly fast: number;
  private readonly slow: number;
  private readonly quantity: number;
  private inPosition = false;

  constructor(config: EmaCrossConfig) {
    if (config === null || typeof config !== "object") throw new RangeError("config is required");
    const fast = config.fast ?? 20;
    const slow = config.slow ?? 50;
    assertPeriod("fast", fast);
    assertPeriod("slow", slow);
    if (fast >= slow) throw new RangeError("fast must be < slow");
    if (!Number.isFinite(config.quantity) || config.quantity <= 0) {
      throw new RangeError("quantity must be a finite number > 0");
    }
    this.fast = fast;
    this.slow = slow;
    this.quantity = config.quantity;
  }

  reset(): void {
    this.inPosition = false;
  }

  onBar(context: StrategyContext): StrategySignal[] {
    const i = context.index;
    if (i < 1) return [];
    const closes = context.visibleCandles.map(c => c.close);
    const fastSeries = ema(closes, this.fast);
    const slowSeries = ema(closes, this.slow);
    const previousFast = fastSeries[i - 1];
    const previousSlow = slowSeries[i - 1];
    const fast = fastSeries[i];
    const slow = slowSeries[i];
    // Before the slow EMA's seed point there is nothing to cross.
    if (previousFast === undefined || previousSlow === undefined) return [];
    if (fast === undefined || slow === undefined) return [];
    const crossedUp = previousFast <= previousSlow && fast > slow;
    const crossedDown = previousFast >= previousSlow && fast < slow;
    if (crossedUp && !this.inPosition) {
      this.inPosition = true;
      return [{ side: "buy", quantity: this.quantity }];
    }
    if (crossedDown && this.inPosition) {
      this.inPosition = false;
      return [{ side: "sell", quantity: this.quantity, reduceOnly: true }];
    }
    return [];
  }
}
