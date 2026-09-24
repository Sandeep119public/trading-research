import { describe, expect, it, vi } from "vitest";
import type { Fill, MarketState } from "@trading-research/shared";
import { CandleMarketEngine } from "@trading-research/engine";
import { ExecutionEngine, type OrderIntent } from "@trading-research/execution";
import { Portfolio } from "@trading-research/portfolio";
import { ReplayController } from "@trading-research/replay";
import {
  BinanceDataManager,
  normalizeBinanceKlines,
  type BinanceKline,
  type FetchKlinesParams
} from "../src/index";

const MIN = 60_000;
const T0 = 1_700_000_000_000;

function kline(
  openTime: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 10,
  closeTime = openTime + MIN - 1
): BinanceKline {
  return [
    openTime,
    String(open),
    String(high),
    String(low),
    String(close),
    String(volume),
    closeTime,
    "0",
    0,
    "0",
    "0",
    "0"
  ];
}

const rows = [
  kline(T0, 100, 101, 99, 100.5),
  kline(T0 + MIN, 100.5, 102, 100, 101.5),
  kline(T0 + 2 * MIN, 101.5, 103, 101, 102.5),
  kline(T0 + 3 * MIN, 102.5, 110, 90, 100)
];

function serverTransport(source: BinanceKline[]) {
  return vi.fn(async ({ startTime, endTime }: FetchKlinesParams) =>
    source.filter(r => r[0] >= startTime && r[0] <= endTime)
  );
}

async function loadStack(source: BinanceKline[], startTime: number, endTime: number) {
  const fetch = serverTransport(source);
  const manager = new BinanceDataManager({ symbol: "BTCUSDT", timeframe: "1m", fetchKlines: fetch });
  const candles = await manager.loadRange({ startTime, endTime });
  const engine = new CandleMarketEngine(candles);
  const replay = new ReplayController(engine);
  const execution = new ExecutionEngine({ feePerUnit: 0, slippagePerUnit: 0 });
  const portfolio = new Portfolio(1000);
  const seen: MarketState[] = [];
  const fills: Fill[] = [];
  replay.subscribe(state => {
    seen.push(state);
    expect(state.visibleCandles.some(c => c.timestamp > state.candle.timestamp)).toBe(false);
    for (const fill of execution.process(state)) {
      portfolio.applyFill(fill);
      fills.push(fill);
    }
    portfolio.markToMarket(state.candle.close);
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
  return { manager, engine, replay, execution, portfolio, candles, seen, fills, fetch, submitManual };
}

describe("data-backed replay", () => {
  it("normalizes Binance rows to simulation candles", () => {
    expect(normalizeBinanceKlines(rows.slice(0, 3))).toEqual([
      { timestamp: T0 / 1000, open: 100, high: 101, low: 99, close: 100.5, volume: 10 },
      { timestamp: (T0 + MIN) / 1000, open: 100.5, high: 102, low: 100, close: 101.5, volume: 10 },
      { timestamp: (T0 + 2 * MIN) / 1000, open: 101.5, high: 103, low: 101, close: 102.5, volume: 10 }
    ]);
  });

  it("returns the requested range", async () => {
    const stack = await loadStack(rows, T0 + MIN, T0 + 2 * MIN);
    expect(stack.candles.map(c => c.timestamp)).toEqual([(T0 + MIN) / 1000, (T0 + 2 * MIN) / 1000]);
  });

  it("excludes the forming candle at the live edge", async () => {
    const now = Date.now();
    const live = [
      kline(now - 2 * MIN, 100, 101, 99, 100),
      kline(now - MIN, 100, 101, 99, 100),
      kline(now, 100, 101, 99, 100, 10, now + MIN)
    ];
    const stack = await loadStack(live, now - 2 * MIN, now + MIN);
    expect(stack.candles).toHaveLength(2);
  });

  it("enters MarketEngine unchanged and replays one candle at a time", async () => {
    const stack = await loadStack(rows.slice(0, 3), T0, T0 + 2 * MIN);
    stack.replay.reset(0);
    stack.replay.step();
    stack.replay.step();
    expect(stack.seen.map(s => s.candle.timestamp)).toEqual([T0 / 1000, (T0 + MIN) / 1000, (T0 + 2 * MIN) / 1000]);
    expect(stack.seen[2].candle).toEqual(stack.candles[2]);
  });

  it("executes manual close orders identically to synthetic replay", async () => {
    const stack = await loadStack(rows.slice(0, 3), T0, T0 + 2 * MIN);
    stack.replay.reset(0);
    stack.submitManual({ id: "m1", side: "buy", quantity: 1, fillMode: "close" });
    expect(stack.portfolio.getState().position).toMatchObject({ side: "long", quantity: 1, entryPrice: 100.5 });
  });

  it("keeps SL/TP behavior identical (SL first)", async () => {
    const stack = await loadStack(rows, T0, T0 + 3 * MIN);
    stack.replay.reset(0);
    stack.submitManual({ id: "m1", side: "buy", quantity: 1, fillMode: "close", stopLoss: 95, takeProfit: 105 });
    stack.replay.step();
    stack.replay.step();
    stack.replay.step();
    expect(stack.fills.map(f => f.kind)).toEqual(["market", "stop"]);
    expect(stack.portfolio.getState().position).toBeNull();
    expect(stack.portfolio.getState().realizedPnl).toBeCloseTo(95 - 100.5);
  });

  it("tracks identical portfolio P&L", async () => {
    const stack = await loadStack(rows.slice(0, 3), T0, T0 + 2 * MIN);
    stack.replay.reset(0);
    stack.submitManual({ id: "m1", side: "buy", quantity: 1, fillMode: "close" });
    stack.replay.step();
    stack.submitManual({ id: "m2", side: "sell", quantity: 1, fillMode: "close", reduceOnly: true });
    expect(stack.portfolio.getState().realizedPnl).toBeCloseTo(101.5 - 100.5);
    expect(stack.portfolio.getState().equity).toBeCloseTo(1001);
  });

  it("reproduces identical results from the same dataset and actions", async () => {
    const run = async () => {
      const stack = await loadStack(rows.slice(0, 3), T0, T0 + 2 * MIN);
      stack.replay.reset(0);
      stack.submitManual({ id: "m1", side: "buy", quantity: 1, fillMode: "close" });
      stack.replay.step();
      stack.submitManual({ id: "m2", side: "sell", quantity: 1, fillMode: "close", reduceOnly: true });
      return { portfolio: stack.portfolio.getState(), fills: stack.fills };
    };
    expect(await run()).toEqual(await run());
  });

  it("never fetches from ReplayController.step()", async () => {
    const stack = await loadStack(rows.slice(0, 3), T0, T0 + 2 * MIN);
    const calls = (stack.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    stack.replay.reset(0);
    stack.replay.step();
    stack.replay.step();
    expect((stack.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);
  });
});
