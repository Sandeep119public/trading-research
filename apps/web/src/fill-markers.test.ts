import { describe, expect, it } from "vitest";
import type { Candle, Fill } from "@trading-research/shared";
import { FILL_MARKER_COLORS, JUMP_MARKER_COLORS, jumpMarker, toFillMarkers } from "./fill-markers";

function candle(timestamp: number): Candle {
  return { timestamp, open: 100, high: 101, low: 99, close: 100, volume: 10 };
}

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

const CANDLES = [candle(1700000000), candle(1700000300), candle(1700000600)];

describe("toFillMarkers", () => {
  it("marks buys below the bar with an up arrow and sells above with a down arrow", () => {
    const markers = toFillMarkers(CANDLES, [
      fill({ orderId: "b1", side: "buy", timestamp: 1700000000 }),
      fill({ orderId: "s1", side: "sell", timestamp: 1700000600 })
    ]);
    expect(markers).toEqual([
      { time: 1700000000, position: "belowBar", shape: "arrowUp", color: FILL_MARKER_COLORS.buy },
      { time: 1700000600, position: "aboveBar", shape: "arrowDown", color: FILL_MARKER_COLORS.sell }
    ]);
  });

  it("snaps a fill between candles to the carrying candle and drops fills before the data", () => {
    const markers = toFillMarkers(CANDLES, [
      fill({ timestamp: 1699999000 }),
      fill({ side: "sell", timestamp: 1700000350 }),
      fill({ side: "buy", timestamp: 1700099999 })
    ]);
    expect(markers.map(m => m.time)).toEqual([1700000300, 1700000600]);
  });

  it("outputs markers sorted by time, keeping input order for fills on one candle", () => {
    const markers = toFillMarkers(CANDLES, [
      fill({ orderId: "s1", side: "sell", timestamp: 1700000600 }),
      fill({ orderId: "b1", side: "buy", timestamp: 1700000000 }),
      fill({ orderId: "b2", side: "buy", timestamp: 1700000000 })
    ]);
    expect(markers.map(m => m.time)).toEqual([1700000000, 1700000000, 1700000600]);
    expect(markers[0].color).toBe(FILL_MARKER_COLORS.buy);
    expect(markers[1].color).toBe(FILL_MARKER_COLORS.buy);
    expect(markers[2].color).toBe(FILL_MARKER_COLORS.sell);
  });

  it("produces nothing for a run without fills or candles", () => {
    expect(toFillMarkers(CANDLES, [])).toEqual([]);
    expect(toFillMarkers([], [fill({})])).toEqual([]);
  });
});

describe("jumpMarker", () => {
  it("colors the landed marker by the plan the row promised", () => {
    expect(jumpMarker(1700000300, "seek+scroll")).toEqual({
      time: 1700000300,
      position: "aboveBar",
      shape: "circle",
      color: JUMP_MARKER_COLORS.seek
    });
    expect(jumpMarker(1700000300, "scroll")).toEqual({
      time: 1700000300,
      position: "aboveBar",
      shape: "circle",
      color: JUMP_MARKER_COLORS.scroll
    });
  });

  it("keeps the seek color distinct from the scroll color", () => {
    expect(JUMP_MARKER_COLORS.seek).not.toBe(JUMP_MARKER_COLORS.scroll);
  });
});
