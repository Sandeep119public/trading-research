import { describe, expect, it } from "vitest";
import type { MarketState } from "@trading-research/shared";
import { ExecutionEngine } from "../src/index";

function state(index: number, open: number, high: number, low: number, close: number): MarketState {
  return {
    candle: { timestamp: 1000 + index, open, high, low, close, volume: 10 },
    index,
    visibleCandles: []
  };
}

describe("ExecutionEngine", () => {
  it("fills replay market orders at the current candle close", () => {
    const engine = new ExecutionEngine({ feePerUnit: 0.5, slippagePerUnit: 0.1 });
    engine.submit({ id: "a", side: "buy", quantity: 2, fillMode: "close" }, 0);
    const fills = engine.process(state(0, 100, 101, 99, 100));
    expect(fills).toHaveLength(1);
    expect(fills[0].price).toBeCloseTo(100.1);
    expect(fills[0].fee).toBeCloseTo(1);
    expect(fills[0].kind).toBe("market");
  });

  it("fills backtest orders at the next candle open, not the same candle", () => {
    const engine = new ExecutionEngine({ feePerUnit: 0, slippagePerUnit: 0 });
    engine.submit({ id: "b", side: "buy", quantity: 1, fillMode: "nextOpen" }, 0);
    expect(engine.process(state(0, 100, 101, 99, 100))).toHaveLength(0);
    const fills = engine.process(state(1, 105, 106, 104, 105.5));
    expect(fills).toHaveLength(1);
    expect(fills[0].price).toBeCloseTo(105);
    expect(fills[0].index).toBe(1);
  });

  it("keeps SL/TP inactive on the entry candle and active afterwards", () => {
    const engine = new ExecutionEngine({ feePerUnit: 0, slippagePerUnit: 0 });
    engine.submit({ id: "c", side: "buy", quantity: 1, fillMode: "close", stopLoss: 90, takeProfit: 110 }, 0);
    const entry = engine.process(state(0, 100, 120, 80, 100));
    expect(entry).toHaveLength(1);
    expect(engine.hasOpenRisk()).toBe(true);
    const exits = engine.process(state(1, 100, 101, 99, 100));
    expect(exits).toHaveLength(0);
  });

  it("prefers SL when both SL and TP are reachable (long and short)", () => {
    const longEngine = new ExecutionEngine({ feePerUnit: 0, slippagePerUnit: 0 });
    longEngine.submit({ id: "l", side: "buy", quantity: 1, fillMode: "close", stopLoss: 95, takeProfit: 105 }, 0);
    longEngine.process(state(0, 100, 101, 99, 100));
    const longExit = longEngine.process(state(1, 100, 120, 80, 100));
    expect(longExit).toHaveLength(1);
    expect(longExit[0].kind).toBe("stop");
    expect(longExit[0].side).toBe("sell");

    const shortEngine = new ExecutionEngine({ feePerUnit: 0, slippagePerUnit: 0 });
    shortEngine.submit({ id: "s", side: "sell", quantity: 1, fillMode: "close", stopLoss: 105, takeProfit: 95 }, 0);
    shortEngine.process(state(0, 100, 101, 99, 100));
    const shortExit = shortEngine.process(state(1, 100, 120, 80, 100));
    expect(shortExit).toHaveLength(1);
    expect(shortExit[0].kind).toBe("stop");
    expect(shortExit[0].side).toBe("buy");
  });

  it("resolves exact boundaries against the trader", () => {
    const slEngine = new ExecutionEngine({ feePerUnit: 0, slippagePerUnit: 0 });
    slEngine.submit({ id: "sl", side: "buy", quantity: 1, fillMode: "close", stopLoss: 90, takeProfit: 110 }, 0);
    slEngine.process(state(0, 100, 101, 99, 100));
    const slTouch = slEngine.process(state(1, 100, 110, 90, 100));
    expect(slTouch).toHaveLength(1);
    expect(slTouch[0].kind).toBe("stop");

    const tpEngine = new ExecutionEngine({ feePerUnit: 0, slippagePerUnit: 0 });
    tpEngine.submit({ id: "tp", side: "buy", quantity: 1, fillMode: "close", stopLoss: 90, takeProfit: 110 }, 0);
    tpEngine.process(state(0, 100, 101, 99, 100));
    const tpTouch = tpEngine.process(state(1, 100, 110, 91, 100));
    expect(tpTouch).toHaveLength(0);
  });

  it("applies fees and slippage from configuration", () => {
    const cheap = new ExecutionEngine({ feePerUnit: 0, slippagePerUnit: 0 });
    cheap.submit({ id: "x", side: "buy", quantity: 1, fillMode: "close" }, 0);
    const cheapFill = cheap.process(state(0, 100, 100, 100, 100))[0];

    const pricey = new ExecutionEngine({ feePerUnit: 2, slippagePerUnit: 1 });
    pricey.submit({ id: "x", side: "buy", quantity: 1, fillMode: "close" }, 0);
    const priceyFill = pricey.process(state(0, 100, 100, 100, 100))[0];

    expect(priceyFill.price).toBeGreaterThan(cheapFill.price);
    expect(priceyFill.fee).toBeGreaterThan(cheapFill.fee);
  });

  it("owns and resets deterministic order-id allocation", () => {
    const engine = new ExecutionEngine({ feePerUnit: 0, slippagePerUnit: 0 });
    expect(engine.nextOrderId("manual")).toBe("manual-1");
    expect(engine.nextOrderId("manual")).toBe("manual-2");
    engine.reset();
    expect(engine.nextOrderId("manual")).toBe("manual-1");
  });

  it("reset clears pending orders, open risk, and used ids", () => {
    const engine = new ExecutionEngine({ feePerUnit: 0, slippagePerUnit: 0 });
    engine.submit({ id: "a", side: "buy", quantity: 1, fillMode: "close" }, 0);
    expect(engine.pendingCount()).toBe(1);
    engine.reset();
    expect(engine.pendingCount()).toBe(0);
    expect(engine.hasOpenRisk()).toBe(false);
    engine.submit({ id: "a", side: "buy", quantity: 1, fillMode: "close" }, 0);
    expect(engine.process(state(0, 100, 101, 99, 100))).toHaveLength(1);
    expect(engine.hasOpenRisk()).toBe(true);
    engine.reset();
    expect(engine.pendingCount()).toBe(0);
    expect(engine.hasOpenRisk()).toBe(false);
  });

  it("is deterministic after reset", () => {
    const run = () => {
      const engine = new ExecutionEngine({ feePerUnit: 0.1, slippagePerUnit: 0.2 });
      engine.submit({ id: "d", side: "buy", quantity: 1, fillMode: "close", stopLoss: 90, takeProfit: 110 }, 0);
      const a = engine.process(state(0, 100, 101, 99, 100));
      const b = engine.process(state(1, 100, 120, 80, 100));
      return [...a, ...b];
    };
    const first = run();
    const second = run();
    expect(second).toEqual(first);
  });
});
