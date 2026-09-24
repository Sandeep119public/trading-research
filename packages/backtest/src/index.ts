import { CandleMarketEngine } from "@trading-research/engine";
import { ExecutionEngine } from "@trading-research/execution";
import { Portfolio } from "@trading-research/portfolio";
import type { Candle, Fill, MarketState, OrderSide } from "@trading-research/shared";

export interface StrategySignal {
  side: OrderSide;
  quantity: number;
  stopLoss?: number;
  takeProfit?: number;
  reduceOnly?: boolean;
}

export interface Strategy {
  onBar(state: MarketState): StrategySignal[];
}

export interface BacktestConfig {
  startingCapital: number;
  feePerUnit: number;
  slippagePerUnit: number;
}

export interface BacktestResult {
  fills: Fill[];
  equityCurve: number[];
  finalEquity: number;
  realizedPnl: number;
  feesPaid: number;
  maxDrawdown: number;
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be a finite number > 0`);
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a finite number >= 0`);
}

export class BacktestDriver {
  private readonly candles: readonly Candle[];
  private readonly config: BacktestConfig;
  private readonly engine: CandleMarketEngine;
  private readonly execution: ExecutionEngine;
  private readonly portfolio: Portfolio;

  constructor(candles: readonly Candle[], config: BacktestConfig) {
    if (candles.length === 0) throw new Error("BacktestDriver requires at least one candle");
    assertPositiveFinite(config.startingCapital, "startingCapital");
    assertNonNegativeFinite(config.feePerUnit, "feePerUnit");
    assertNonNegativeFinite(config.slippagePerUnit, "slippagePerUnit");
    this.candles = candles;
    this.config = { ...config };
    this.engine = new CandleMarketEngine(candles);
    this.execution = new ExecutionEngine({ feePerUnit: config.feePerUnit, slippagePerUnit: config.slippagePerUnit });
    this.portfolio = new Portfolio(config.startingCapital);
  }

  reset(startIndex = 0): void {
    this.execution.reset();
    this.portfolio.reset(this.config.startingCapital);
    this.engine.reset(startIndex);
  }

  run(strategy: Strategy, startIndex = 0): BacktestResult {
    this.reset(startIndex);
    const fills: Fill[] = [];
    const equityCurve: number[] = [];
    while (!this.engine.finished()) {
      const state = this.engine.step().state;
      for (const fill of this.execution.process(state)) {
        this.portfolio.applyFill(fill);
        fills.push(fill);
      }
      this.portfolio.markToMarket(state.candle.close);
      equityCurve.push(this.portfolio.getEquity());
      const signals = strategy.onBar(state);
      if (signals.length > 1) {
        throw new Error("V1 strategies may return at most one signal per bar");
      }
      const signal = signals[0];
      if (signal !== undefined) {
        this.execution.submit(
          {
            id: this.execution.nextOrderId("backtest"),
            side: signal.side,
            quantity: signal.quantity,
            fillMode: "nextOpen",
            stopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit,
            reduceOnly: signal.reduceOnly
          },
          state.index
        );
      }
    }
    const snap = this.portfolio.getState();
    return {
      fills,
      equityCurve,
      finalEquity: snap.equity,
      realizedPnl: snap.realizedPnl,
      feesPaid: snap.feesPaid,
      maxDrawdown: computeMaxDrawdown(equityCurve)
    };
  }
}

function computeMaxDrawdown(curve: number[]): number {
  let peak = -Infinity;
  let maxDd = 0;
  for (const value of curve) {
    if (value > peak) peak = value;
    maxDd = Math.max(maxDd, peak - value);
  }
  return maxDd;
}
