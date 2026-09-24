import { describe, expect, it } from "vitest";
import type { Fill } from "@trading-research/shared";
import { Portfolio } from "../src/index";

function fill(orderId: string, side: "buy" | "sell", quantity: number, price: number, index = 0, fee = 0): Fill {
  return { orderId, side, quantity, price, index, timestamp: 1000 + index, fee, kind: "market" };
}

describe("Portfolio", () => {
  it("opens a long and tracks unrealized equity", () => {
    const portfolio = new Portfolio(1000);
    portfolio.applyFill(fill("a", "buy", 2, 100));
    expect(portfolio.getState().position).toMatchObject({ side: "long", quantity: 2, entryPrice: 100 });
    expect(portfolio.markToMarket(110)).toBeCloseTo(1020);
  });

  it("closes a long and realizes PnL net of fees", () => {
    const portfolio = new Portfolio(1000);
    portfolio.applyFill(fill("a", "buy", 1, 100, 0, 1));
    portfolio.applyFill(fill("b", "sell", 1, 110, 1, 1));
    const state = portfolio.getState();
    expect(state.position).toBeNull();
    expect(state.realizedPnl).toBeCloseTo(10);
    expect(state.feesPaid).toBeCloseTo(2);
    expect(state.equity).toBeCloseTo(1008);
  });

  it("opens and closes a short", () => {
    const portfolio = new Portfolio(500);
    portfolio.applyFill(fill("a", "sell", 1, 100));
    portfolio.applyFill(fill("b", "buy", 1, 90, 1));
    const state = portfolio.getState();
    expect(state.position).toBeNull();
    expect(state.realizedPnl).toBeCloseTo(10);
    expect(state.equity).toBeCloseTo(510);
  });

  it("supports partial closes and flips", () => {
    const portfolio = new Portfolio(1000);
    portfolio.applyFill(fill("a", "buy", 2, 100));
    portfolio.applyFill(fill("b", "sell", 1, 110));
    expect(portfolio.getState().position).toMatchObject({ side: "long", quantity: 1 });
    expect(portfolio.getState().realizedPnl).toBeCloseTo(10);
    portfolio.applyFill(fill("c", "sell", 2, 90, 2));
    const state = portfolio.getState();
    expect(state.position).toMatchObject({ side: "short", quantity: 1, entryPrice: 90 });
    expect(state.realizedPnl).toBeCloseTo(0);
  });

  it("is deterministic after reset", () => {
    const portfolio = new Portfolio(1000);
    portfolio.applyFill(fill("a", "buy", 1, 100, 0, 1));
    portfolio.applyFill(fill("b", "sell", 1, 110, 1, 1));
    const first = portfolio.getState();
    portfolio.reset(1000);
    portfolio.applyFill(fill("a", "buy", 1, 100, 0, 1));
    portfolio.applyFill(fill("b", "sell", 1, 110, 1, 1));
    expect(portfolio.getState()).toEqual(first);
  });
});
