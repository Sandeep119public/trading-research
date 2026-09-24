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
    const seen: number[] = [];
    replay.subscribe(state => seen.push(state.candle.timestamp));
    replay.reset(0);
    replay.step();
    expect(seen).toEqual([1, 2]);
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

    expect(second).toEqual(first);
  });

  it("supports controlled playback speed", () => {
    vi.useFakeTimers();
    try {
      const engine = new CandleMarketEngine(candles);
      const replay = new ReplayController(engine);
      replay.reset(0);
      replay.setSpeed(10);
      replay.play();
      vi.advanceTimersByTime(100);
      replay.pause();
      // reset() leaves index at 0; 10x = 100ms per step, so 100ms advances once.
      expect(engine.getState().index).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("notifies playing changes including auto-pause at end", () => {
    vi.useFakeTimers();
    try {
      const engine = new CandleMarketEngine(candles);
      const replay = new ReplayController(engine);
      const playingStates: boolean[] = [];
      const unsubscribe = replay.subscribePlaying(v => playingStates.push(v));
      replay.reset(0);
      expect(replay.playing).toBe(false);
      replay.play();
      expect(replay.playing).toBe(true);
      replay.setSpeed(10);
      vi.advanceTimersByTime(200);
      expect(engine.getState().index).toBe(2);
      expect(replay.playing).toBe(false);
      expect(playingStates).toEqual([true, false]);
      unsubscribe();
    } finally {
      vi.useRealTimers();
    }
  });
});
