import { BacktestDriver, type BacktestConfig, type BacktestResult } from "@trading-research/backtest";
import { EmaCrossStrategy } from "@trading-research/strategy";
import type { Candle } from "@trading-research/shared";

/** V1 has no sizing model: entries and exits are a fixed base-asset quantity
 * (strategy config, never a fee/slippage constant). */
export const BACKTEST_QUANTITY = 0.01;

/**
 * The UI's backtest action: run the EMA(20)/EMA(50) sample strategy over the
 * whole candle set through BacktestDriver — same MarketEngine,
 * ExecutionEngine, and Portfolio classes as replay, in the driver's own
 * instances, so a report run never touches the replay stack. Pure with
 * respect to its inputs: the same candles and config produce an identical
 * BacktestResult every time (BacktestDriver's determinism guarantee).
 */
export function runEmaCrossBacktest(candles: readonly Candle[], config: BacktestConfig): BacktestResult {
  const driver = new BacktestDriver(candles, config);
  return driver.run(new EmaCrossStrategy({ quantity: BACKTEST_QUANTITY }));
}
