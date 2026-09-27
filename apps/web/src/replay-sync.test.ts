import { describe, expect, it } from "vitest";
import type { MarketState } from "@trading-research/shared";
import { ExecutionEngine } from "@trading-research/execution";
import { Portfolio } from "@trading-research/portfolio";
import { syncFromMarket, syncFromMarketSafe } from "./replay-sync";

function state(index: number, open: number, high: number, low: number, close: number): MarketState {
  return {
    candle: { timestamp: 1000 + index, open, high, low, close, volume: 10 },
    index,
    visibleCandles: []
  };
}

describe("syncFromMarket", () => {
  it("applies a manual close fill and opens the position", () => {
    const execution = new ExecutionEngine({ feePerUnit: 0, slippagePerUnit: 0 });
    const portfolio = new Portfolio(1000);
    execution.submit({ id: "m1", side: "buy", quantity: 1, fillMode: "close" }, 0);
    syncFromMarket(execution, portfolio, state(0, 100, 101, 99, 100));
    expect(portfolio.getState().position).toMatchObject({ side: "long", quantity: 1, entryPrice: 100 });
  });

  it("applies a stop hit, closes the position, and realizes P&L", () => {
    const execution = new ExecutionEngine({ feePerUnit: 0, slippagePerUnit: 0 });
    const portfolio = new Portfolio(1000);
    execution.submit({ id: "m1", side: "buy", quantity: 1, fillMode: "close", stopLoss: 90, takeProfit: 110 }, 0);
    syncFromMarket(execution, portfolio, state(0, 100, 101, 99, 100));
    syncFromMarket(execution, portfolio, state(1, 100, 120, 80, 100));
    const snap = portfolio.getState();
    expect(snap.position).toBeNull();
    expect(snap.realizedPnl).toBeCloseTo(-10);
  });
});

describe("syncFromMarketSafe", () => {
  it("returns null when the drain succeeds", () => {
    const execution = new ExecutionEngine({ feePerUnit: 0, slippagePerUnit: 0 });
    const portfolio = new Portfolio(1000);
    execution.submit({ id: "m1", side: "buy", quantity: 1, fillMode: "close" }, 0);
    expect(syncFromMarketSafe(execution, portfolio, state(0, 100, 101, 99, 100))).toBeNull();
    expect(portfolio.getState().position).toMatchObject({ side: "long", quantity: 1 });
  });

  it("returns the engine's message instead of throwing when a fill price is invalid", () => {
    // Slippage larger than the candle's close makes the sell fill price
    // negative; ExecutionEngine rejects it. The replay subscription must
    // surface that message (and pause), not blow up inside a timer tick.
    const execution = new ExecutionEngine({ feePerUnit: 0, slippagePerUnit: 1000 });
    const portfolio = new Portfolio(1000);
    execution.submit({ id: "m1", side: "sell", quantity: 1, fillMode: "close" }, 0);
    expect(syncFromMarketSafe(execution, portfolio, state(0, 100, 101, 99, 100))).toBe(
      "execution price must be a finite number > 0"
    );
    expect(portfolio.getState().position).toBeNull();
  });
});
