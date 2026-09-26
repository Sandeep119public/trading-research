import { describe, expect, it } from "vitest";
import type { Fill } from "@trading-research/shared";
import { analyzeFills, sortFills } from "./fill-analysis";

function fill(overrides: Partial<Fill>): Fill {
  return {
    orderId: "o-1",
    side: "buy",
    quantity: 1,
    price: 100,
    index: 0,
    timestamp: 1700000000,
    fee: 0,
    kind: "market",
    ...overrides
  };
}

describe("analyzeFills", () => {
  it("returns empty stats for no fills", () => {
    expect(analyzeFills([])).toEqual({ rows: [], trades: 0, wins: 0, losses: 0, winRate: null });
  });

  it("keeps an opening fill unrealized and excludes it from win stats", () => {
    const stats = analyzeFills([fill({})]);
    expect(stats.rows).toEqual([{ fill: fill({}), realizedPnl: 0 }]);
    expect(stats.trades).toBe(0);
    expect(stats.winRate).toBeNull();
  });

  it("scores a winning round trip after fees", () => {
    const buy = fill({ orderId: "b", side: "buy", price: 100, fee: 1, timestamp: 1700000000 });
    const sell = fill({ orderId: "s", side: "sell", price: 110, fee: 1, index: 1, timestamp: 1700000300 });
    const stats = analyzeFills([buy, sell]);
    expect(stats.rows.map(r => r.realizedPnl)).toEqual([0, 10]);
    expect(stats.trades).toBe(1);
    expect(stats.wins).toBe(1);
    expect(stats.losses).toBe(0);
    expect(stats.winRate).toBe(1);
  });

  it("counts a losing round trip as a loss even when the exit price is higher than the entry", () => {
    // Price gained 1, fees ate 5: Portfolio realizes +1 and subtracts the 5 in
    // feesPaid, so the trade is a net loss. Win stats must follow the net, not
    // the raw price move.
    const buy = fill({ side: "buy", price: 100, fee: 1 });
    const sell = fill({ side: "sell", price: 101, fee: 4, index: 1 });
    const stats = analyzeFills([buy, sell]);
    expect(stats.rows.map(r => r.realizedPnl)).toEqual([0, 1]);
    expect(stats.trades).toBe(1);
    expect(stats.wins).toBe(0);
    expect(stats.losses).toBe(1);
    expect(stats.winRate).toBe(0);
  });

  it("averages same-direction entries the way Portfolio does", () => {
    const first = fill({ orderId: "a", side: "buy", price: 100 });
    const second = fill({ orderId: "b", side: "buy", price: 110, index: 1 });
    const exit = fill({ orderId: "c", side: "sell", price: 110, quantity: 2, index: 2 });
    const stats = analyzeFills([first, second, exit]);
    expect(stats.rows.map(r => r.realizedPnl)).toEqual([0, 0, 10]);
    expect(stats.trades).toBe(1);
    expect(stats.wins).toBe(1);
  });

  it("does not close a trade on a partial exit", () => {
    const buy = fill({ side: "buy", quantity: 2, price: 100 });
    const partial = fill({ side: "sell", quantity: 1, price: 110, index: 1 });
    const rest = fill({ side: "sell", quantity: 1, price: 120, index: 2 });
    const stats = analyzeFills([buy, partial, rest]);
    expect(stats.rows.map(r => r.realizedPnl)).toEqual([0, 10, 20]);
    expect(stats.trades).toBe(1);
    expect(stats.wins).toBe(1);
    expect(stats.winRate).toBe(1);
  });

  it("scores each leg of a flip as its own trade", () => {
    // Long 1 @ 100, then sell 2 @ 110 closes the long and opens a short.
    // The flipping fill's fee charges the trade it closed; the new short trade
    // starts fee-free and is settled by the buy-back below.
    const buy = fill({ side: "buy", price: 100 });
    const flip = fill({ side: "sell", quantity: 2, price: 110, index: 1, fee: 3 });
    const cover = fill({ side: "buy", price: 105, index: 2, fee: 2 });
    const stats = analyzeFills([buy, flip, cover]);
    expect(stats.rows.map(r => r.realizedPnl)).toEqual([0, 10, 5]);
    expect(stats.trades).toBe(2);
    expect(stats.wins).toBe(2);
    expect(stats.winRate).toBe(1);
  });

  it("leaves a trade still open on the last fill out of the win rate", () => {
    const win = fill({ orderId: "w1", side: "buy", price: 100 });
    const winExit = fill({ orderId: "w2", side: "sell", price: 110, index: 1 });
    const open = fill({ orderId: "w3", side: "buy", price: 120, index: 2 });
    const stats = analyzeFills([win, winExit, open]);
    expect(stats.rows).toHaveLength(3);
    expect(stats.trades).toBe(1);
    expect(stats.wins).toBe(1);
    expect(stats.winRate).toBe(1);
  });

  it("counts wins over all completed round trips, with losses and breakeven against them", () => {
    const fills = [
      fill({ orderId: "1", side: "buy", price: 100 }),
      fill({ orderId: "2", side: "sell", price: 110, index: 1 }),
      fill({ orderId: "3", side: "buy", price: 110, index: 2 }),
      fill({ orderId: "4", side: "sell", price: 100, index: 3 }),
      fill({ orderId: "5", side: "buy", price: 50, index: 4 }),
      fill({ orderId: "6", side: "sell", price: 50, index: 5 }),
      fill({ orderId: "7", side: "buy", price: 60, index: 6 }),
      fill({ orderId: "8", side: "sell", price: 70, index: 7 })
    ];
    const stats = analyzeFills(fills);
    expect(stats.trades).toBe(4);
    expect(stats.wins).toBe(2);
    expect(stats.losses).toBe(1);
    expect(stats.winRate).toBe(0.5);
  });

  it("sells in a short round trip exactly like Portfolio would", () => {
    const short = fill({ side: "sell", price: 100 });
    const cover = fill({ side: "buy", price: 90, index: 1 });
    const stats = analyzeFills([short, cover]);
    expect(stats.rows.map(r => r.realizedPnl)).toEqual([0, 10]);
    expect(stats.trades).toBe(1);
    expect(stats.wins).toBe(1);
  });
});

describe("sortFills", () => {
  const rows = [
    { fill: fill({ orderId: "a", timestamp: 300, price: 100, quantity: 1, fee: 1, side: "buy" as const }), realizedPnl: 0 },
    { fill: fill({ orderId: "b", timestamp: 100, price: 300, quantity: 3, fee: 3, side: "sell" as const, index: 1 }), realizedPnl: -5 },
    { fill: fill({ orderId: "c", timestamp: 200, price: 200, quantity: 2, fee: 2, side: "buy" as const, index: 2 }), realizedPnl: 5 }
  ];

  it("sorts by time ascending by default pattern and descending", () => {
    expect(sortFills(rows, "time", "asc").map(r => r.fill.orderId)).toEqual(["b", "c", "a"]);
    expect(sortFills(rows, "time", "desc").map(r => r.fill.orderId)).toEqual(["a", "c", "b"]);
  });

  it("sorts numerically by price, quantity, fee, and realized P&L", () => {
    expect(sortFills(rows, "price", "asc").map(r => r.fill.orderId)).toEqual(["a", "c", "b"]);
    expect(sortFills(rows, "price", "desc").map(r => r.fill.orderId)).toEqual(["b", "c", "a"]);
    expect(sortFills(rows, "quantity", "asc").map(r => r.fill.orderId)).toEqual(["a", "c", "b"]);
    expect(sortFills(rows, "fee", "desc").map(r => r.fill.orderId)).toEqual(["b", "c", "a"]);
    expect(sortFills(rows, "realized", "asc").map(r => r.fill.orderId)).toEqual(["b", "a", "c"]);
    expect(sortFills(rows, "realized", "desc").map(r => r.fill.orderId)).toEqual(["c", "a", "b"]);
  });

  it("sorts sides alphabetically: buy before sell", () => {
    expect(sortFills(rows, "side", "asc").map(r => r.fill.orderId)).toEqual(["a", "c", "b"]);
    expect(sortFills(rows, "side", "desc").map(r => r.fill.orderId)).toEqual(["b", "a", "c"]);
  });

  it("keeps tied rows in input order", () => {
    const tied = [
      { fill: fill({ orderId: "first", price: 100, timestamp: 900 }), realizedPnl: 0 },
      { fill: fill({ orderId: "second", price: 100, timestamp: 800 }), realizedPnl: 0 },
      { fill: fill({ orderId: "third", price: 100, timestamp: 700 }), realizedPnl: 0 }
    ];
    expect(sortFills(tied, "price", "asc").map(r => r.fill.orderId)).toEqual(["first", "second", "third"]);
    expect(sortFills(tied, "price", "desc").map(r => r.fill.orderId)).toEqual(["first", "second", "third"]);
  });

  it("does not mutate the input array", () => {
    const before = rows.map(r => r.fill.orderId);
    const sorted = sortFills(rows, "price", "desc");
    expect(sorted).not.toBe(rows);
    expect(rows.map(r => r.fill.orderId)).toEqual(before);
  });
});
