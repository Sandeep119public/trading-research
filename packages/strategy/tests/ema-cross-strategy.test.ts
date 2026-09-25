import { describe, expect, it } from "vitest";
import { CandleMarketEngine } from "@trading-research/engine";
import type { Candle } from "@trading-research/shared";
import { EmaCrossStrategy, type StrategySignal } from "../src/index";

function candlesFromCloses(closes: readonly number[]): Candle[] {
  return closes.map((close, i) => ({
    timestamp: (i + 1) * 60_000,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1
  }));
}

/** The signal emitted on each bar 0..n-1, driving one fresh engine and strategy over `closes`. */
function signalsByBar(closes: readonly number[], config: { fast?: number; slow?: number; quantity: number }): StrategySignal[][] {
  const engine = new CandleMarketEngine(candlesFromCloses(closes));
  const strategy = new EmaCrossStrategy(config);
  const out: StrategySignal[][] = [];
  while (!engine.finished()) {
    out.push(strategy.onBar(engine.step().state));
  }
  return out;
}

/** The single signal the strategy emits at bar T, using a fresh instance so no earlier bar matters. */
function signalAt(closes: readonly number[], t: number, config: { fast?: number; slow?: number; quantity: number }): StrategySignal[] {
  const engine = new CandleMarketEngine(candlesFromCloses(closes));
  const strategy = new EmaCrossStrategy(config);
  let state = engine.step().state;
  while (state.index < t) state = engine.step().state;
  return strategy.onBar(state);
}

// fast=2, slow=3 over [10,10,10,10,20,30,10]:
//   EMA2: -, 10, 10, 10, 16.67, 25.56, 15.19
//   EMA3: -, -,  10, 10, 15,    22.5,  16.25
// cross above at bar 4, cross below at bar 6.
const riseThenFall = [10, 10, 10, 10, 20, 30, 10];

// fast=2, slow=3 over [30,30,30,30,20,10,40,60]:
//   EMA2: -, 30, 30, 30, 23.33, 14.44, 31.48, 50.49
//   EMA3: -, -,  30, 30, 25,    17.5,  28.75, 44.375
// cross below while flat at bar 4 (ignored), cross above at bar 6.
const fallThenRise = [30, 30, 30, 30, 20, 10, 40, 60];

describe("EmaCrossStrategy signal generation", () => {
  it("enters long on the bar where the fast EMA crosses above the slow EMA", () => {
    const signals = signalsByBar(riseThenFall, { fast: 2, slow: 3, quantity: 1 });
    expect(signals[4]).toEqual([{ side: "buy", quantity: 1 }]);
    expect(signals.slice(0, 4)).toEqual([[], [], [], []]);
  });

  it("exits long with a reduceOnly sell on the bar where the fast EMA crosses below", () => {
    const signals = signalsByBar(riseThenFall, { fast: 2, slow: 3, quantity: 0.25 });
    expect(signals[6]).toEqual([{ side: "sell", quantity: 0.25, reduceOnly: true }]);
  });

  it("emits nothing outside the bars where a crossing actually happens", () => {
    const signals = signalsByBar(riseThenFall, { fast: 2, slow: 3, quantity: 1 });
    expect(signals.map((s, i) => (s.length > 0 ? i : null)).filter(i => i !== null)).toEqual([4, 6]);
  });

  it("stays flat through a cross below while flat: long-only, it never opens a short", () => {
    const flatOnly = signalsByBar(fallThenRise, { fast: 2, slow: 3, quantity: 1 });
    expect(flatOnly.slice(0, 6)).toEqual([[], [], [], [], [], []]);
    // ...and the same strategy does enter later on a cross above, so the
    // silence above is the position guard, not a dead strategy.
    expect(flatOnly[6]).toEqual([{ side: "buy", quantity: 1 }]);
  });

  it("does not re-enter while already long (V1 forbids pyramiding)", () => {
    // fast=1 makes the fast EMA track the close exactly, so bar 4 can be built
    // to land exactly ON the slow EMA (a tie, not a cross below) and bar 5 can
    // then cross above again while the position is already long.
    const signals = signalsByBar([4, 4, 4, 6, 5, 7], { fast: 1, slow: 3, quantity: 1 });
    expect(signals[3]).toEqual([{ side: "buy", quantity: 1 }]);
    expect(signals[5]).toEqual([]);
  });

  it("emits nothing during warmup, before both EMAs exist", () => {
    const signals = signalsByBar([10, 20, 30, 40], { fast: 2, slow: 3, quantity: 1 });
    expect(signals).toEqual([[], [], [], []]);
  });

  it("uses EMA20/EMA50 by default", () => {
    // 51 flat bars then a jump: both EMAs sit on 10 until bar 51, where the
    // fast one reacts first and crosses above the slow one.
    const closes = [...Array(51).fill(10), 100];
    const signals = signalsByBar(closes, { quantity: 1 });
    expect(signals[51]).toEqual([{ side: "buy", quantity: 1 }]);
    expect(signals.slice(0, 51).every(s => s.length === 0)).toBe(true);
  });

  it("never returns more than one signal on any bar", () => {
    const closes = Array.from({ length: 200 }, (_, i) => 100 + 10 * Math.sin(i / 3) + 5 * Math.sin(i / 7));
    const signals = signalsByBar(closes, { fast: 3, slow: 8, quantity: 1 });
    expect(signals.every(s => s.length <= 1)).toBe(true);
  });

  it("reset() clears the remembered position", () => {
    const entry = [10, 10, 10, 10, 20, 30]; // cross above at bar 4
    const decline = [30, 30, 30, 30, 20, 10]; // cross below at bar 4
    const drive = (strategy: EmaCrossStrategy, closes: readonly number[]): StrategySignal[] => {
      const engine = new CandleMarketEngine(candlesFromCloses(closes));
      const out: StrategySignal[] = [];
      while (!engine.finished()) out.push(...strategy.onBar(engine.step().state));
      return out;
    };
    // Control: entry then decline without reset → the cross below exits the
    // long the first segment opened.
    const control = new EmaCrossStrategy({ fast: 2, slow: 3, quantity: 1 });
    expect(drive(control, entry)).toEqual([{ side: "buy", quantity: 1 }]);
    expect(drive(control, decline)).toEqual([{ side: "sell", quantity: 1, reduceOnly: true }]);
    // Same segments with reset() between them → the position is gone, and a
    // cross below while flat emits nothing instead of a phantom sell.
    const resetStrategy = new EmaCrossStrategy({ fast: 2, slow: 3, quantity: 1 });
    expect(drive(resetStrategy, entry)).toEqual([{ side: "buy", quantity: 1 }]);
    resetStrategy.reset();
    expect(drive(resetStrategy, decline)).toEqual([]);
  });

  it("rejects invalid configuration instead of trading on it", () => {
    expect(() => new EmaCrossStrategy({ quantity: 0 })).toThrow(RangeError);
    expect(() => new EmaCrossStrategy({ quantity: Number.NaN })).toThrow(RangeError);
    expect(() => new EmaCrossStrategy({ fast: 0, slow: 3, quantity: 1 })).toThrow(RangeError);
    expect(() => new EmaCrossStrategy({ fast: 5, slow: 5, quantity: 1 })).toThrow(/fast must be < slow/);
    expect(() => new EmaCrossStrategy({ fast: 9, slow: 3, quantity: 1 })).toThrow(/fast must be < slow/);
    expect(() => new EmaCrossStrategy({ slow: 2.5, quantity: 1 })).toThrow(RangeError);
  });
});

describe("EmaCrossStrategy Future Data Rule", () => {
  const prefix = [10, 10, 10, 10, 20, 30];
  const quietContinuation = [...prefix, 30, 30, 30, 30, 30];
  const wildContinuation = [...prefix, 999, 1, 500, 2];
  const config = { fast: 2, slow: 3, quantity: 1 };

  it("gives the same signal at bar T on two datasets that differ only after T", () => {
    for (let t = 0; t < prefix.length; t++) {
      expect(signalAt(wildContinuation, t, config)).toEqual(signalAt(quietContinuation, t, config));
      expect(signalAt(quietContinuation, t, config)).toEqual(signalAt(prefix, t, config));
    }
    // Guard against the comparison above being vacuous: bar T of this prefix
    // is the crossing bar, so a real signal is being compared.
    expect(signalAt(quietContinuation, 4, config)).toEqual([{ side: "buy", quantity: 1 }]);
  });

  it("gives the same per-bar signals when one instance walks each dataset", () => {
    const quiet = signalsByBar(quietContinuation, config);
    const wild = signalsByBar(wildContinuation, config);
    expect(wild.slice(0, prefix.length)).toEqual(quiet.slice(0, prefix.length));
    // The two runs do diverge afterwards, which is the point: only the past
    // is shared, the futures are not.
    expect(wild.slice(prefix.length)).not.toEqual(quiet.slice(prefix.length));
  });

  it("sees exactly the candles up to T, never one more", () => {
    const engine = new CandleMarketEngine(candlesFromCloses(wildContinuation));
    const strategy = new EmaCrossStrategy(config);
    for (let t = 0; t < wildContinuation.length; t++) {
      const state = engine.step().state;
      strategy.onBar(state);
      expect(state.visibleCandles).toHaveLength(t + 1);
      expect(state.visibleCandles.at(-1)?.timestamp).toBe(state.candle.timestamp);
      expect(state.visibleCandles.some(c => c.timestamp > state.candle.timestamp)).toBe(false);
    }
  });
});
