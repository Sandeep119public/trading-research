import type { Fill } from "@trading-research/shared";

export interface FillRow {
  fill: Fill;
  /** Realized P&L contributed by this fill alone: 0 when it opens or adds to
   * a position, (exit - entry) * closedQty when it closes one. Mirrors
   * Portfolio.applyFill exactly, including its rule that fees never enter
   * realized P&L (fees are summed separately in BacktestResult.feesPaid). */
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
 * Walk fills the way Portfolio.applyFill does — same-direction fills average
 * the entry, closing fills realize (exit - entry) * closedQty, an over-close
 * flips with the remainder — so every per-fill number in the results table and
 * every round-trip outcome is guaranteed to sum back to BacktestResult's
 * realizedPnl. Pure: the input fills are never mutated. Presentation-only
 * derivation; BacktestResult itself carries no win statistics.
 */
export function analyzeFills(fills: readonly Fill[]): FillStats {
  const rows: FillRow[] = [];
  let side: "long" | "short" | null = null;
  let quantity = 0;
  let entryPrice = 0;
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
    let realizedPnl = 0;
    if (side === null) {
      side = fill.side === "buy" ? "long" : "short";
      quantity = fill.quantity;
      entryPrice = fill.price;
      tradeFees += fill.fee;
    } else {
      const sameDirection =
        (side === "long" && fill.side === "buy") || (side === "short" && fill.side === "sell");
      if (sameDirection) {
        const total = quantity + fill.quantity;
        entryPrice = (entryPrice * quantity + fill.price * fill.quantity) / total;
        quantity = total;
        tradeFees += fill.fee;
      } else {
        const closeQuantity = Math.min(fill.quantity, quantity);
        const unit = side === "long" ? fill.price - entryPrice : entryPrice - fill.price;
        realizedPnl = unit * closeQuantity;
        tradePnl += realizedPnl;
        // The closing fill's fee belongs to the trade it closes. On a flip
        // (fill larger than the position) the new trade starts fee-free.
        tradeFees += fill.fee;
        if (fill.quantity < quantity) {
          quantity -= fill.quantity;
        } else if (fill.quantity === quantity) {
          closeRoundTrip();
          side = null;
          quantity = 0;
          entryPrice = 0;
        } else {
          closeRoundTrip();
          side = fill.side === "buy" ? "long" : "short";
          quantity = fill.quantity - closeQuantity;
          entryPrice = fill.price;
        }
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
