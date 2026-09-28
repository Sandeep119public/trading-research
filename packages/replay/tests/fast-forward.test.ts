import { describe, expect, it, vi } from "vitest";
import type { Candle, Fill, MarketState } from "@trading-research/shared";
import { CandleMarketEngine } from "@trading-research/engine";
import { ExecutionEngine } from "@trading-research/execution";
import { Portfolio } from "@trading-research/portfolio";
import { ReplayController } from "../src/index";

const candles: Candle[] = [
  { timestamp: 1, open: 100, high: 101, low: 99, close: 100.5, volume: 10 },
  { timestamp: 2, open: 100.5, high: 102, low: 100, close: 101.5, volume: 12 },
  { timestamp: 3, open: 101.5, high: 103, low: 101, close: 102.5, volume: 14 }
];

function fresh() {
  const engine = new CandleMarketEngine(candles);
  const replay = new ReplayController(engine);
  const seen: number[] = [];
  replay.subscribe(state => seen.push(state.candle.timestamp));
  return { engine, replay, seen };
}

describe("fastForwardTo", () => {
  it("emits exactly the states N individual steps would, and lands identically", () => {
    const seek = fresh();
    seek.replay.reset(0);
    seek.replay.fastForwardTo(3);

    const stepped = fresh();
    stepped.replay.reset(0);
    stepped.replay.step();
    stepped.replay.step();

    expect(seek.seen).toEqual(stepped.seen);
    expect(seek.engine.getState()).toEqual(stepped.engine.getState());
  });

  it("produces identical fills and portfolio state as N individual steps", () => {
    function stack() {
      const engine = new CandleMarketEngine(candles);
      const replay = new ReplayController(engine);
      const execution = new ExecutionEngine({ feePerUnit: 0, slippagePerUnit: 0 });
      const portfolio = new Portfolio(1000);
      const fills: Fill[] = [];
      replay.subscribe((s: MarketState) => {
        for (const fill of execution.process(s)) {
          fills.push(fill);
          portfolio.applyFill(fill);
        }
        portfolio.markToMarket(s.candle.close);
      });
      return { engine, replay, execution, portfolio, fills };
    }

    const seek = stack();
    seek.replay.reset(0);
    seek.execution.submit({ id: "m1", side: "buy", quantity: 1, fillMode: "close" }, seek.engine.getState().index);
    seek.replay.fastForwardTo(3);

    const stepped = stack();
    stepped.replay.reset(0);
    stepped.execution.submit({ id: "m1", side: "buy", quantity: 1, fillMode: "close" }, stepped.engine.getState().index);
    stepped.replay.step();
    stepped.replay.step();

    expect(seek.fills).toEqual(stepped.fills);
    expect(seek.portfolio.getState()).toEqual(stepped.portfolio.getState());
  });

  it("never moves backward: a target at or behind T is a no-op", () => {
    const { engine, replay, seen } = fresh();
    replay.reset(0);
    expect(engine.getState().candle.timestamp).toBe(1);

    const atT = replay.fastForwardTo(1);
    const behind = replay.fastForwardTo(0);

    expect(seen).toEqual([1]);
    expect(engine.getState().index).toBe(0);
    expect(atT).toEqual(engine.getState());
    expect(behind).toEqual(engine.getState());
  });

  it("stops cleanly at the last candle when the target is past the end of data", () => {
    const { engine, replay, seen } = fresh();
    replay.reset(0);
    const final = replay.fastForwardTo(9999);

    expect(engine.getState().candle.timestamp).toBe(3);
    expect(engine.finished()).toBe(true);
    expect(seen).toEqual([1, 2, 3]);
    expect(final).toEqual(engine.getState());
    expect(replay.playing).toBe(false);
  });

  it("pauses playback first and keeps ticking nothing after the seek", () => {
    vi.useFakeTimers();
    try {
      const { engine, replay, seen } = fresh();
      replay.reset(0);
      replay.play();
      expect(replay.playing).toBe(true);

      // Stop short of the end: the seek's own pause is what must stop the
      // timer, not the engine hitting the last candle on its own.
      replay.fastForwardTo(2);

      expect(replay.playing).toBe(false);
      vi.advanceTimersByTime(60_000);
      expect(engine.getState().index).toBe(1);
      expect(seen).toEqual([1, 2]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops mid-seek when the subscriber pauses, the way a failure surfaces", () => {
    // The UI's replay subscription reacts to a drain failure with pause() plus
    // the "Replay stopped" banner. Fast-forward must honor that same pause
    // instead of marching on to the target past a broken candle.
    const { engine, replay, seen } = fresh();
    replay.subscribe(state => {
      seen.push(state.candle.timestamp);
      if (state.candle.timestamp === 2) replay.pause();
    });
    replay.reset(0);

    replay.fastForwardTo(9);

    expect(seen).toEqual([1, 2]);
    expect(engine.getState().candle.timestamp).toBe(2);
    expect(replay.playing).toBe(false);
  });
});
