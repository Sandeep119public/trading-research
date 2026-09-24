import { describe, expect, it } from "vitest";
import type { Candle, Fill, MarketState } from "@trading-research/shared";
import { CandleMarketEngine } from "@trading-research/engine";
import { ExecutionEngine, type OrderIntent } from "@trading-research/execution";
import { Portfolio } from "@trading-research/portfolio";
import { ReplayController } from "@trading-research/replay";
import { BacktestDriver } from "../src/index";

// Gapless opens (each open equals the previous close) so a replay manual fill
// at candle T's close and a backtest strategy fill at candle T+1's open land
// on the SAME price. That isolates the shared execution/protective logic from
// the intentional timing difference (current-close vs next-open), which is the
// only behavioral difference the two drivers are allowed to have.
const candles: Candle[] = [
  { timestamp: 1, open: 100, high: 101, low: 99, close: 100, volume: 10 },
  { timestamp: 2, open: 100, high: 101, low: 99, close: 100, volume: 10 },
  { timestamp: 3, open: 100, high: 101, low: 99, close: 100, volume: 10 },
  { timestamp: 4, open: 100, high: 120, low: 80, close: 100, volume: 10 }
];

const config = { startingCapital: 1000, feePerUnit: 1, slippagePerUnit: 0.5 };

function runReplay() {
  const engine = new CandleMarketEngine(candles);
  const replay = new ReplayController(engine);
  const execution = new ExecutionEngine({ feePerUnit: config.feePerUnit, slippagePerUnit: config.slippagePerUnit });
  const portfolio = new Portfolio(config.startingCapital);
  const fills: Fill[] = [];
  replay.subscribe((s: MarketState) => {
    for (const fill of execution.process(s)) {
      portfolio.applyFill(fill);
      fills.push(fill);
    }
    portfolio.markToMarket(s.candle.close);
  });
  const submitManual = (order: OrderIntent) => {
    execution.submit(order, engine.getState().index);
    const current = engine.getState();
    for (const fill of execution.process(current)) {
      portfolio.applyFill(fill);
      fills.push(fill);
    }
    portfolio.markToMarket(current.candle.close);
  };
  replay.reset(0);
  submitManual({ id: "m1", side: "buy", quantity: 1, fillMode: "close", stopLoss: 95, takeProfit: 105 });
  replay.step();
  replay.step();
  replay.step();
  return { fills, state: portfolio.getState() };
}

function runBacktest() {
  const driver = new BacktestDriver(candles, config);
  const result = driver.run({
    onBar(state) {
      return state.index === 0 ? [{ side: "buy", quantity: 1, stopLoss: 95, takeProfit: 105 }] : [];
    }
  });
  return result;
}

describe("cross-path replay/backtest equivalence", () => {
  it("produces identical fills, fees, and P&L on gapless opens", () => {
    const replay = runReplay();
    const backtest = runBacktest();
    expect(backtest.fills.map(f => [f.kind, f.side, f.price, f.fee])).toEqual(
      replay.fills.map(f => [f.kind, f.side, f.price, f.fee])
    );
    expect(backtest.fills.map(f => f.kind)).toEqual(["market", "stop"]);
    expect(backtest.realizedPnl).toBe(replay.state.realizedPnl);
    expect(backtest.feesPaid).toBe(replay.state.feesPaid);
    expect(backtest.finalEquity).toBe(replay.state.equity);
    expect(replay.state.position).toBeNull();
  });
});
