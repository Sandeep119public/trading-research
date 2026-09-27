import { describe, expect, it } from "vitest";
import { CandleMarketEngine } from "@trading-research/engine";
import { ExecutionEngine } from "@trading-research/execution";
import { Portfolio } from "@trading-research/portfolio";
import type { Candle } from "@trading-research/shared";
import { executeManualIntent } from "./intents";

function candles(): Candle[] {
  return [
    { timestamp: 1700000000, open: 99, high: 101, low: 98, close: 100, volume: 10 },
    { timestamp: 1700000300, open: 100, high: 102, low: 99, close: 101, volume: 10 }
  ];
}

function stack() {
  const engine = new CandleMarketEngine(candles());
  // Same initialization the replay stack performs on load: reset then step,
  // so the engine has a current candle for the intent's fill index.
  engine.reset(0);
  engine.step();
  const execution = new ExecutionEngine({ feePerUnit: 0, slippagePerUnit: 0 });
  const portfolio = new Portfolio(1000);
  return { engine, execution, portfolio };
}

describe("executeManualIntent", () => {
  it("opens a position when flat and fills it at the current close", () => {
    const { engine, execution, portfolio } = stack();
    const submitted = executeManualIntent(execution, portfolio, engine, {
      kind: "open",
      side: "buy",
      quantity: 1
    });
    expect(submitted).toBe(true);
    expect(portfolio.getState().position).toMatchObject({ side: "long", quantity: 1, entryPrice: 100 });
    expect(execution.pendingCount()).toBe(0);
  });

  it("is a no-op when the live portfolio already holds a position (render-snapshot race)", () => {
    const { engine, execution, portfolio } = stack();
    executeManualIntent(execution, portfolio, engine, { kind: "open", side: "buy", quantity: 1 });
    // A stale render snapshot taken before the tick that opened this position
    // would say "flat" and submit — which the engine rejects as pyramiding.
    // The intent must read the live Portfolio instead: no submit, no throw.
    let submitted = true;
    expect(() => {
      submitted = executeManualIntent(execution, portfolio, engine, { kind: "open", side: "buy", quantity: 1 });
    }).not.toThrow();
    expect(submitted).toBe(false);
    expect(execution.pendingCount()).toBe(0);
    expect(portfolio.getState().position).toMatchObject({ side: "long", quantity: 1 });
  });

  it("closes an open position with a reduce-only intent", () => {
    const { engine, execution, portfolio } = stack();
    executeManualIntent(execution, portfolio, engine, { kind: "open", side: "buy", quantity: 1 });
    const submitted = executeManualIntent(execution, portfolio, engine, { kind: "close" });
    expect(submitted).toBe(true);
    expect(portfolio.getState().position).toBeNull();
    expect(execution.pendingCount()).toBe(0);
  });

  it("is a no-op when flat instead of throwing a reduceOnly rejection", () => {
    const { engine, execution, portfolio } = stack();
    let submitted = true;
    expect(() => {
      submitted = executeManualIntent(execution, portfolio, engine, { kind: "close" });
    }).not.toThrow();
    expect(submitted).toBe(false);
    expect(execution.pendingCount()).toBe(0);
  });
});
