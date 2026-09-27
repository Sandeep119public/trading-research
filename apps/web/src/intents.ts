import type { ExecutionEngine } from "@trading-research/execution";
import type { Portfolio } from "@trading-research/portfolio";
import type { MarketEngine } from "@trading-research/shared";
import { syncFromMarket } from "./replay-sync";

export type ManualIntent =
  | { kind: "open"; side: "buy" | "sell"; quantity: number }
  | { kind: "close" };

/**
 * The UI's trading-intent boundary: decide against the LIVE Portfolio, submit
 * through the owning ExecutionEngine, and drain at the engine's current
 * candle. The live position is read here (not from the React render snapshot)
 * because the snapshot can lag the tick that just opened a position — a stale
 * "flat" would submit a second open that the engine rejects as pyramiding.
 * No-ops return false without touching the order-id allocator; callers may
 * also let engine rejections throw so they can surface them as banner text.
 */
export function executeManualIntent(
  execution: ExecutionEngine,
  portfolio: Portfolio,
  engine: MarketEngine,
  intent: ManualIntent
): boolean {
  const market = engine.getState();
  const position = portfolio.getState().position;

  if (intent.kind === "open") {
    if (position !== null) return false;
    execution.submit(
      { id: execution.nextOrderId("manual"), side: intent.side, quantity: intent.quantity, fillMode: "close" },
      market.index
    );
  } else {
    if (position === null) return false;
    execution.submit(
      {
        id: execution.nextOrderId("manual"),
        side: position.side === "long" ? "sell" : "buy",
        quantity: position.quantity,
        fillMode: "close",
        reduceOnly: true
      },
      market.index
    );
  }

  syncFromMarket(execution, portfolio, market);
  return true;
}
