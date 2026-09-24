import { describe, expect, it } from "vitest";
import type { Candle, MarketState } from "@trading-research/shared";
import { BacktestDriver, type Strategy } from "../src/index";

function candle(index: number, open: number, high: number, low: number, close: number): Candle {
  return { timestamp: 1000 + index, open, high, low, close, volume: 10 };
}

const buyOnce: Strategy = {
  onBar(state: MarketState) {
    return state.index === 0 ? [{ side: "buy", quantity: 1 }] : [];
  }
};

describe("BacktestDriver", () => {
  it("fills a signal on candle N at candle N+1 open", () => {
    const driver = new BacktestDriver(
      [candle(0, 100, 101, 99, 100), candle(1, 105, 106, 104, 105.5), candle(2, 106, 107, 105, 106)],
      { startingCapital: 1000, feePerUnit: 0, slippagePerUnit: 0 }
    );
    const result = driver.run(buyOnce);
    expect(result.fills).toHaveLength(1);
    expect(result.fills[0].index).toBe(1);
    expect(result.fills[0].price).toBeCloseTo(105);
  });

  it("never fills a signal at the same candle close", () => {
    const seen: Array<{ signalIndex: number; fillIndex: number | null }> = [];
    const driver = new BacktestDriver(
      [candle(0, 100, 101, 99, 100), candle(1, 105, 106, 104, 105.5)],
      { startingCapital: 1000, feePerUnit: 0, slippagePerUnit: 0 }
    );
    const result = driver.run({
      onBar(state) {
        if (state.index !== 0) return [];
        seen.push({ signalIndex: state.index, fillIndex: null });
        return [{ side: "buy", quantity: 1 }];
      }
    });
    expect(result.fills).toHaveLength(1);
    expect(result.fills[0].index).toBeGreaterThan(seen[0].signalIndex);
    expect(result.fills[0].price).not.toBeCloseTo(100);
  });

  it("applies the same fees and slippage as replay execution", () => {
    const driver = new BacktestDriver(
      [candle(0, 100, 101, 99, 100), candle(1, 105, 106, 104, 105.5)],
      { startingCapital: 1000, feePerUnit: 2, slippagePerUnit: 1 }
    );
    const result = driver.run(buyOnce);
    expect(result.fills[0].price).toBeCloseTo(106);
    expect(result.fills[0].fee).toBeCloseTo(2);
    expect(result.feesPaid).toBeCloseTo(2);
  });

  it("uses identical SL/TP behavior to replay (SL first)", () => {
    const driver = new BacktestDriver(
      [candle(0, 100, 101, 99, 100), candle(1, 100, 101, 99, 100), candle(2, 100, 120, 80, 100)],
      { startingCapital: 1000, feePerUnit: 0, slippagePerUnit: 0 }
    );
    const result = driver.run({
      onBar(state) {
        return state.index === 0 ? [{ side: "buy", quantity: 1, stopLoss: 90, takeProfit: 110 }] : [];
      }
    });
    expect(result.fills.map(f => f.kind)).toEqual(["market", "stop"]);
    expect(result.realizedPnl).toBeCloseTo(-10);
  });

  it("takes equity from Portfolio with no duplicate accounting", () => {
    const driver = new BacktestDriver(
      [candle(0, 100, 101, 99, 100), candle(1, 105, 106, 104, 110)],
      { startingCapital: 1000, feePerUnit: 1, slippagePerUnit: 0 }
    );
    const result = driver.run(buyOnce);
    expect(result.equityCurve).toHaveLength(2);
    expect(result.equityCurve[result.equityCurve.length - 1]).toBeCloseTo(result.finalEquity);
    expect(result.finalEquity).toBeCloseTo(1000 + 0 - 1 + 5);
  });

  it("is identical for the same candles and strategy", () => {
    const candles = [candle(0, 100, 101, 99, 100), candle(1, 105, 106, 104, 110)];
    const config = { startingCapital: 1000, feePerUnit: 0.5, slippagePerUnit: 0.25 };
    const first = new BacktestDriver(candles, config).run(buyOnce);
    const second = new BacktestDriver(candles, config).run(buyOnce);
    expect(second).toEqual(first);
  });

  it("resets and reruns to identical trades and equity", () => {
    const driver = new BacktestDriver(
      [candle(0, 100, 101, 99, 100), candle(1, 105, 106, 104, 110)],
      { startingCapital: 1000, feePerUnit: 0, slippagePerUnit: 0 }
    );
    const first = driver.run(buyOnce);
    driver.reset();
    const second = driver.run(buyOnce);
    expect(second.fills).toEqual(first.fills);
    expect(second.finalEquity).toBe(first.finalEquity);
  });

  it("never exposes candle N+1 while processing N", () => {
    const maxSeen: number[] = [];
    const driver = new BacktestDriver(
      [candle(0, 100, 101, 99, 100), candle(1, 105, 106, 104, 110), candle(2, 110, 111, 109, 110.5)],
      { startingCapital: 1000, feePerUnit: 0, slippagePerUnit: 0 }
    );
    driver.run({
      onBar(state) {
        maxSeen.push(state.candle.timestamp);
        expect(state.visibleCandles).toHaveLength(state.index + 1);
        expect(state.visibleCandles.at(-1)?.timestamp).toBe(state.candle.timestamp);
        expect(state.visibleCandles.some(c => c.timestamp > state.candle.timestamp)).toBe(false);
        return [];
      }
    });
    expect(maxSeen).toEqual([1000, 1001, 1002]);
  });
});
