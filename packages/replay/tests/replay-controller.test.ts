import { describe, expect, it, vi } from "vitest";
import { CandleMarketEngine } from "@trading-research/engine";
import { ReplayController } from "../src/index";

const candles = [
  { timestamp: 1, open: 100, high: 101, low: 99, close: 100.5, volume: 10 },
  { timestamp: 2, open: 100.5, high: 102, low: 100, close: 101.5, volume: 12 },
  { timestamp: 3, open: 101.5, high: 103, low: 101, close: 102.5, volume: 14 }
];

describe("ReplayController", () => {
  it("emits only states produced by MarketEngine.step", () => {
    const engine = new CandleMarketEngine(candles);
    const replay = new ReplayController(engine);
    replay.reset(0);
    const seen: number[] = [];
    replay.subscribe(state => seen.push(state.candle.timestamp));
    replay.step();
    expect(seen).toEqual([2]);
  });

  it("is deterministic after reset", () => {
    const engine = new CandleMarketEngine(candles);
    const replay = new ReplayController(engine);
    const first: number[] = [];
    replay.subscribe(state => first.push(state.candle.timestamp));
    replay.reset(0);
    replay.step();
    replay.step();

    const second: number[] = [];
    replay.subscribe(state => second.push(state.candle.timestamp));
    replay.reset(0);
    replay.step();
    replay.step();

    expect(second).toEqual([1, 2, 3]);
  });

  it("supports controlled playback speed", () => {
    vi.useFakeTimers();
    const engine = new CandleMarketEngine(candles);
    const replay = new ReplayController(engine);
    replay.reset(0);
    replay.setSpeed(10);
    replay.play();
    vi.advanceTimersByTime(100);
    replay.pause();
    expect(engine.getState().index).toBe(2);
    vi.useRealTimers();
  });
}
);