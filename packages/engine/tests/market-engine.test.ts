import { describe, expect, it } from "vitest";
import { CandleMarketEngine } from "../src/index";

const candles = [
  { timestamp: 1, open: 100, high: 102, low: 99, close: 101, volume: 10 },
  { timestamp: 2, open: 101, high: 103, low: 100, close: 102, volume: 11 },
  { timestamp: 3, open: 102, high: 104, low: 101, close: 103, volume: 12 }
];

describe("CandleMarketEngine", () => {
  it("advances one candle at a time", () => {
    const engine = new CandleMarketEngine(candles);
    engine.reset(0);
    expect(engine.step().state.candle.close).toBe(101);
    expect(engine.step().state.candle.close).toBe(102);
  });

  it("never exposes future candles", () => {
    const engine = new CandleMarketEngine(candles);
    engine.reset(1);
    const state = engine.step().state;
    expect(state.visibleCandles).toHaveLength(2);
    expect(state.visibleCandles.at(-1)?.timestamp).toBe(2);
    expect(state.visibleCandles.some(c => c.timestamp > state.candle.timestamp)).toBe(false);
  });

  it("is deterministic after reset", () => {
    const engine = new CandleMarketEngine(candles);
    engine.reset(0);
    const first = [engine.step(), engine.step(), engine.step()];
    engine.reset(0);
    const second = [engine.step(), engine.step(), engine.step()];
    expect(second).toEqual(first);
  });

  it("does not let consumers mutate the stored dataset", () => {
    const engine = new CandleMarketEngine(candles);
    engine.reset(0);
    const state = engine.step().state;
    try {
      state.candle.close = 999999;
    } catch {
      // Frozen dataset: the mutation is rejected instead of corrupting state.
    }
    engine.reset(0);
    expect(engine.step().state.candle.close).toBe(101);
  });
});
