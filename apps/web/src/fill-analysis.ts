import { Portfolio } from "@trading-research/portfolio";
import type { Fill } from "@trading-research/shared";

export interface FillRow {
  fill: Fill;
  /** Realized P&L contributed by this fill alone: the delta Portfolio's
   * realizedPnl advances by on this fill — 0 when it opens or adds to a
   * position, the close amount when it closes one. Fees never enter it
   * because Portfolio keeps them out (BacktestResult.feesPaid sums them). */
  realizedPnl: number;
}

export interface FillStats {
  rows: FillRow[];
  /** Completed round trips: a position that opened and returned to flat.
   * A trade still open on the last fill is not counted — it has no outcome. */
  trades: number;
  wins: number;
  losses: number;
  /** wins / trades, or null when no round trip completed (rendered as "—",
   * never as a fabricated 0%). Breakeven trades count in trades but in
   * neither wins nor losses. */
  winRate: number | null;
}

export type FillSortKey = "time" | "side" | "price" | "quantity" | "fee" | "realized";
export type SortDirection = "asc" | "desc";

const SORT_ACCESSORS: Record<FillSortKey, (row: FillRow) => number | string> = {
  time: row => row.fill.timestamp,
  side: row => row.fill.side,
  price: row => row.fill.price,
  quantity: row => row.fill.quantity,
  fee: row => row.fill.fee,
  realized: row => row.realizedPnl
};

/**
 * Derive display stats by walking a throwaway Portfolio — position
 * accounting has exactly one owner: the netting rules (same-direction
 * averaging, partial closes, over-close flips) and the fee-excluded
 * realized P&L are Portfolio's, not a second copy maintained in the UI that
 * could silently drift when Portfolio changes. Per-fill realized P&L is the
 * delta of realizedPnl, so the table column telescopes back to
 * BacktestResult's own metric; a trade ends where Portfolio says the
 * position ends — flat, or its side flipped by an over-close (the remainder
 * starts the next trade). On top of that sit only report semantics: a fill's
 * fee charges the trade it acted on, and a trade still open on the last fill
 * is not a completed round trip. Pure: input fills are never mutated, and
 * BacktestResult itself carries no win statistics.
 */
export function analyzeFills(fills: readonly Fill[]): FillStats {
  // Starting capital never enters realizedPnl or position math; it only has
  // to satisfy Portfolio's constructor.
  const scratch = new Portfolio(1);
  const rows: FillRow[] = [];
  let previousRealized = 0;
  let tradePnl = 0;
  let tradeFees = 0;
  let trades = 0;
  let wins = 0;
  let losses = 0;

  const closeRoundTrip = () => {
    trades += 1;
    const net = tradePnl - tradeFees;
    if (net > 0) wins += 1;
    else if (net < 0) losses += 1;
    tradePnl = 0;
    tradeFees = 0;
  };

  for (const fill of fills) {
    const sideBefore = scratch.getState().position?.side ?? null;
    scratch.applyFill(fill);
    const state = scratch.getState();
    const realizedPnl = state.realizedPnl - previousRealized;
    previousRealized = state.realizedPnl;
    const sideAfter = state.position?.side ?? null;

    if (sideBefore === null) {
      // An opening fill starts the (fresh) trade; its fee belongs to it.
      tradeFees += fill.fee;
    } else {
      tradePnl += realizedPnl;
      // The fill's fee charges the trade it acted on — including a flip
      // fill, which closes the old trade; the remainder starts fee-free.
      tradeFees += fill.fee;
      if (sideAfter === null || sideAfter !== sideBefore) {
        closeRoundTrip();
      }
    }
    rows.push({ fill, realizedPnl });
  }

  return {
    rows,
    trades,
    wins,
    losses,
    winRate: trades === 0 ? null : wins / trades
  };
}

/** Stable, non-mutating sort: rows with equal values keep their input order,
 * so sorting by a column that ties (two fills in one candle) never shuffles
 * the chronological order the fills arrived in. */
export function sortFills(rows: readonly FillRow[], key: FillSortKey, direction: SortDirection): FillRow[] {
  const accessor = SORT_ACCESSORS[key];
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = accessor(a);
    const right = accessor(b);
    if (typeof left === "number" && typeof right === "number") return sign * (left - right);
    return sign * String(left).localeCompare(String(right));
  });
}
