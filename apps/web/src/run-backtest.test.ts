import { describe, expect, it } from "vitest";
import type { Candle } from "@trading-research/shared";
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
      slippagePerUnit: 0
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
      slippagePerUnit: 0
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
      slippagePerUnit: 0
    });

    expect(result.fills).toHaveLength(2);
    expect(result.feesPaid).toBeCloseTo(5 * 0.01 * 2, 10);
    expect(result.finalEquity).toBeCloseTo(STARTING_CAPITAL + result.realizedPnl - result.feesPaid, 10);
  });

  it("produces identical results when run twice on the same candles", () => {
    const candles = crossyCandles();
    const config = { startingCapital: STARTING_CAPITAL, feePerUnit: 2, slippagePerUnit: 1 };
    expect(runEmaCrossBacktest(candles, config)).toEqual(runEmaCrossBacktest(candles, config));
  });

  it("produces an explicit zero-trade result when no cross can occur", () => {
    const result = runEmaCrossBacktest(neverCrossingCandles(), {
      startingCapital: STARTING_CAPITAL,
      feePerUnit: 0,
      slippagePerUnit: 0
    });
    expect(result.fills).toEqual([]);
    expect(result.equityCurve).toHaveLength(30);
    expect(result.finalEquity).toBe(STARTING_CAPITAL);
    expect(analyzeFills(result.fills).winRate).toBeNull();
  });
});
