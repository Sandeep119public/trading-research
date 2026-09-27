import type { ExecutionEngine } from "@trading-research/execution";
import type { Portfolio } from "@trading-research/portfolio";
import type { MarketState } from "@trading-research/shared";

/**
 * The single drain path for market states: process fills through the owning
 * ExecutionEngine, apply them to the owning Portfolio, and mark to the
 * current candle close. Used by the replay subscription and by manual order
 * intents alike. No React, no chart, no timing, no duplicated accounting.
 */
export function syncFromMarket(execution: ExecutionEngine, portfolio: Portfolio, state: MarketState): void {
  for (const fill of execution.process(state)) portfolio.applyFill(fill);
  portfolio.markToMarket(state.candle.close);
}

/**
 * Subscription-facing wrapper: same drain, but an engine failure (e.g. a
 * non-positive fill price) is returned as a message for the replay UI to
 * surface and pause on, instead of escaping into a timer tick where it would
 * surface as an unhandled error.
 */
export function syncFromMarketSafe(
  execution: ExecutionEngine,
  portfolio: Portfolio,
  state: MarketState
): string | null {
  try {
    syncFromMarket(execution, portfolio, state);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
