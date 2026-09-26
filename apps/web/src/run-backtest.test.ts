import { describe, expect, it } from "vitest";
import { BacktestDriver } from "@trading-research/backtest";
import type { Candle } from "@trading-research/shared";
import { EmaCrossStrategy } from "@trading-research/strategy";
import { analyzeFills } from "./fill-analysis";
import { runEmaCrossBacktest } from "./run-backtest";

const STARTING_CAPITAL = 10000;

/** Deterministic series engineered for exactly one golden cross and one death
 * cross: 60 bars down, 60 bars up, 60 bars down. EMA(20) reacts faster than
 * EMA(50) to both reversals, so the sample strategy buys once (while flat, the
 * initial down-phase cross below is ignored) and sells once on the way back
 * down. Open tracks the previous close so next-open fills land on real prices. */
function crossyCandles(): Candle[] {
  const closes: number[] = [];
  for (let i = 0; i < 60; i++) closes.push(200 - i);
  for (let i = 60; i < 120; i++) closes.push(141 + (i - 60));
  for (let i = 120; i < 180; i++) closes.push(200 - (i - 120));
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1];
    return {
      timestamp: 1700000000 + i * 300,
      open,
      high: Math.max(open, close) + 1,
      low: Math.min(open, close) - 1,
      close,
      volume: 10
    };
  });
}

/** Shorter than EMA(50)'s seed point: the strategy can never see a cross. */
function neverCrossingCandles(): Candle[] {
  return Array.from({ length: 30 }, (_, i) => ({
    timestamp: 1700000000 + i * 300,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 10
  }));
}

describe("runEmaCrossBacktest", () => {
  it("runs the sample strategy to one round trip with one equity point per bar", () => {
    const candles = crossyCandles();
    const result = runEmaCrossBacktest(candles, {
      startingCapital: STARTING_CAPITAL,
      feePerUnit: 0,
      slippagePerUnit: 0,
      size: 0.01
    });

    expect(result.fills).toHaveLength(2);
    expect(result.fills.map(f => f.side)).toEqual(["buy", "sell"]);
    expect(result.fills.map(f => f.orderId)).toEqual(["backtest-1", "backtest-2"]);
    expect(result.fills[0].index).toBeLessThan(result.fills[1].index);
    expect(result.equityCurve).toHaveLength(candles.length);

    const stats = analyzeFills(result.fills);
    expect(stats.trades).toBe(1);
    expect(stats.winRate).not.toBeNull();
  });

  it("keeps derived fill numbers in sync with the result's own metrics", () => {
    const candles = crossyCandles();
    const result = runEmaCrossBacktest(candles, {
      startingCapital: STARTING_CAPITAL,
      feePerUnit: 0,
      slippagePerUnit: 0,
      size: 0.01
    });

    const realizedFromFills = analyzeFills(result.fills).rows.reduce((sum, row) => sum + row.realizedPnl, 0);
    expect(realizedFromFills).toBeCloseTo(result.realizedPnl, 10);
    expect(result.finalEquity).toBeCloseTo(STARTING_CAPITAL + result.realizedPnl - result.feesPaid, 10);
    expect(result.feesPaid).toBe(0);
  });

  it("passes configured fees through to the result and the final equity identity", () => {
    const candles = crossyCandles();
    const result = runEmaCrossBacktest(candles, {
      startingCapital: STARTING_CAPITAL,
      feePerUnit: 5,
      slippagePerUnit: 0,
      size: 0.01
    });

    expect(result.fills).toHaveLength(2);
    expect(result.feesPaid).toBeCloseTo(5 * 0.01 * 2, 10);
    expect(result.finalEquity).toBeCloseTo(STARTING_CAPITAL + result.realizedPnl - result.feesPaid, 10);
  });

  it("produces identical results when run twice on the same candles", () => {
    const candles = crossyCandles();
    const config = { startingCapital: STARTING_CAPITAL, feePerUnit: 2, slippagePerUnit: 1, size: 0.01 };
    expect(runEmaCrossBacktest(candles, config)).toEqual(runEmaCrossBacktest(candles, config));
  });

  it("produces an explicit zero-trade result when no cross can occur", () => {
    const result = runEmaCrossBacktest(neverCrossingCandles(), {
      startingCapital: STARTING_CAPITAL,
      feePerUnit: 0,
      slippagePerUnit: 0,
      size: 0.01
    });
    expect(result.fills).toEqual([]);
    expect(result.equityCurve).toHaveLength(30);
    expect(result.finalEquity).toBe(STARTING_CAPITAL);
    expect(analyzeFills(result.fills).winRate).toBeNull();
  });

  it("is byte-identical to the previous hardcoded wiring under the default config", () => {
    // The old path built EmaCrossStrategy with quantity 0.01 directly; the
    // new path maps config.size to the same quantity. Same inputs must give
    // the same result down to the last decimal — this is the proof the
    // change is additive, not a silent behavior shift on the default path.
    const candles = crossyCandles();
    const viaConfig = runEmaCrossBacktest(candles, {
      startingCapital: STARTING_CAPITAL,
      feePerUnit: 0,
      slippagePerUnit: 0,
      size: 0.01
    });
    const direct = new BacktestDriver(
      candles,
      { startingCapital: STARTING_CAPITAL, feePerUnit: 0, slippagePerUnit: 0, size: 0.01 }
    ).run(new EmaCrossStrategy({ quantity: 0.01 }));
    expect(viaConfig).toEqual(direct);
  });

  it("changes fills, fees, and prices when fee/slippage/size change (before/after)", () => {
    const candles = crossyCandles();
    const flat = runEmaCrossBacktest(candles, {
      startingCapital: STARTING_CAPITAL,
      feePerUnit: 0,
      slippagePerUnit: 0,
      size: 0.01
    });
    const rich = runEmaCrossBacktest(candles, {
      startingCapital: STARTING_CAPITAL,
      feePerUnit: 5,
      slippagePerUnit: 2,
      size: 0.02
    });
    expect(flat.fills).toHaveLength(2);
    expect(rich.fills).toHaveLength(2);
    // Size flows into the strategy quantity: both fills double.
    expect(flat.fills.map(f => f.quantity)).toEqual([0.01, 0.01]);
    expect(rich.fills.map(f => f.quantity)).toEqual([0.02, 0.02]);
    // Same signal bars, so the price gap is exactly the slippage: the buy
    // shifts up, the sell shifts down.
    expect(rich.fills[0].price - flat.fills[0].price).toBeCloseTo(2, 10);
    expect(rich.fills[1].price - flat.fills[1].price).toBeCloseTo(-2, 10);
    expect(flat.feesPaid).toBe(0);
    expect(rich.fills.map(f => f.fee)).toEqual([0.1, 0.1]);
    expect(rich.feesPaid).toBeCloseTo(0.2, 10);
    expect(rich.realizedPnl).not.toBeCloseTo(flat.realizedPnl, 10);
    expect(rich.finalEquity).not.toBe(flat.finalEquity);
  });
});
