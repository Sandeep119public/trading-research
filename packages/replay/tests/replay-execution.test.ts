import { describe, expect, it } from "vitest";
import type { Candle, MarketState } from "@trading-research/shared";
import { CandleMarketEngine } from "@trading-research/engine";
import { ExecutionEngine, type OrderIntent } from "@trading-research/execution";
import { Portfolio } from "@trading-research/portfolio";
import { ReplayController } from "../src/index";

function candle(index: number, open: number, high: number, low: number, close: number): Candle {
  return { timestamp: 1000 + index, open, high, low, close, volume: 10 };
}

function stack(candles: Candle[], feePerUnit = 0, startingCapital = 1000) {
  const engine = new CandleMarketEngine(candles);
  const replay = new ReplayController(engine);
  const execution = new ExecutionEngine({ feePerUnit, slippagePerUnit: 0 });
  const portfolio = new Portfolio(startingCapital);
  replay.subscribe((s: MarketState) => {
    for (const fill of execution.process(s)) portfolio.applyFill(fill);
    portfolio.markToMarket(s.candle.close);
  });
  const drainCurrent = () => {
    const s = engine.getState();
    for (const fill of execution.process(s)) portfolio.applyFill(fill);
    portfolio.markToMarket(s.candle.close);
  };
  const submitManual = (order: OrderIntent) => {
    execution.submit(order, engine.getState().index);
    drainCurrent();
  };
  return { engine, replay, execution, portfolio, drainCurrent, submitManual };
}

describe("replay execution integration", () => {
  it("fills a manual close entry and opens a long", () => {
    const s = stack([candle(0, 100, 101, 99, 100), candle(1, 100, 101, 99, 101)]);
    s.replay.reset(0);
    s.submitManual({ id: "m1", side: "buy", quantity: 1, fillMode: "close" });
    expect(s.portfolio.getState().position).toMatchObject({ side: "long", quantity: 1, entryPrice: 100 });
  });

  it("exits via SL on a subsequent candle", () => {
    const st = stack([candle(0, 100, 101, 99, 100), candle(1, 100, 101, 99, 100), candle(2, 100, 101, 80, 95)]);
    st.replay.reset(0);
    st.submitManual({ id: "m1", side: "buy", quantity: 1, fillMode: "close", stopLoss: 90, takeProfit: 110 });
    st.replay.step();
    expect(st.portfolio.getState().position).not.toBeNull();
    st.replay.step();
    expect(st.portfolio.getState().position).toBeNull();
    expect(st.portfolio.getState().realizedPnl).toBeCloseTo(-10);
  });

  it("exits via TP on a subsequent candle", () => {
    const st = stack([candle(0, 100, 101, 99, 100), candle(1, 100, 101, 99, 100), candle(2, 100, 115, 99, 112)]);
    st.replay.reset(0);
    st.submitManual({ id: "m1", side: "buy", quantity: 1, fillMode: "close", stopLoss: 90, takeProfit: 110 });
    st.replay.step();
    st.replay.step();
    expect(st.portfolio.getState().position).toBeNull();
    expect(st.portfolio.getState().realizedPnl).toBeCloseTo(10);
  });

  it("prefers SL when both are reachable in one candle", () => {
    const st = stack([candle(0, 100, 101, 99, 100), candle(1, 100, 120, 80, 100)]);
    st.replay.reset(0);
    st.submitManual({ id: "m1", side: "buy", quantity: 1, fillMode: "close", stopLoss: 90, takeProfit: 110 });
    st.replay.step();
    expect(st.portfolio.getState().realizedPnl).toBeCloseTo(-10);
    expect(st.portfolio.getState().position).toBeNull();
  });

  it("supports a partial close", () => {
    const st = stack([candle(0, 100, 101, 99, 100), candle(1, 100, 101, 99, 110)]);
    st.replay.reset(0);
    st.submitManual({ id: "m1", side: "buy", quantity: 2, fillMode: "close" });
    st.replay.step();
    st.submitManual({ id: "m2", side: "sell", quantity: 1, fillMode: "close", reduceOnly: true });
    expect(st.portfolio.getState().position).toMatchObject({ side: "long", quantity: 1 });
    expect(st.portfolio.getState().realizedPnl).toBeCloseTo(10);
  });

  it("supports a position flip", () => {
    const st = stack([candle(0, 100, 101, 99, 100), candle(1, 100, 101, 99, 110)]);
    st.replay.reset(0);
    st.submitManual({ id: "m1", side: "buy", quantity: 1, fillMode: "close" });
    st.replay.step();
    st.submitManual({ id: "m2", side: "sell", quantity: 2, fillMode: "close" });
    expect(st.portfolio.getState().position).toMatchObject({ side: "short", quantity: 1, entryPrice: 110 });
    expect(st.portfolio.getState().realizedPnl).toBeCloseTo(10);
  });

  it("tracks realized and unrealized P&L", () => {
    const st = stack([candle(0, 100, 101, 99, 100), candle(1, 100, 101, 99, 110)]);
    st.replay.reset(0);
    st.submitManual({ id: "m1", side: "buy", quantity: 1, fillMode: "close" });
    st.replay.step();
    expect(st.portfolio.unrealizedAt(110)).toBeCloseTo(10);
    expect(st.portfolio.getState().equity).toBeCloseTo(1010);
  });

  it("deducts fees from equity", () => {
    const st = stack([candle(0, 100, 101, 99, 100), candle(1, 100, 101, 99, 110)], 2);
    st.replay.reset(0);
    st.submitManual({ id: "m1", side: "buy", quantity: 1, fillMode: "close" });
    st.replay.step();
    st.submitManual({ id: "m2", side: "sell", quantity: 1, fillMode: "close", reduceOnly: true });
    expect(st.portfolio.getState().feesPaid).toBeCloseTo(4);
    expect(st.portfolio.getState().equity).toBeCloseTo(1006);
  });

  it("resets to an identical resulting state", () => {
    const candles = [candle(0, 100, 101, 99, 100), candle(1, 100, 101, 99, 110)];
    const run = () => {
      const st = stack(candles);
      st.replay.reset(0);
      st.submitManual({ id: "m1", side: "buy", quantity: 1, fillMode: "close" });
      st.replay.step();
      st.submitManual({ id: "m2", side: "sell", quantity: 1, fillMode: "close", reduceOnly: true });
      return st.portfolio.getState();
    };
    expect(run()).toEqual(run());
  });
});
