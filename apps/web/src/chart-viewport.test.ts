import { describe, expect, it } from "vitest";
import { centeredRange, shouldFollowEngine } from "./chart-viewport";

describe("centeredRange", () => {
  it("keeps the current span and centers on the target mid-data", () => {
    const span = 3600;
    const r = centeredRange(1790066700, 1790000400, 1790604600, span);
    expect(r).toEqual({ from: 1790066700 - span / 2, to: 1790066700 + span / 2 });
  });

  it("clamps the range to the data end instead of reaching past it", () => {
    const last = 1790066700;
    const r = centeredRange(last, 1790000400, last, 7200);
    expect(r).not.toBeNull();
    expect(r!.to).toBe(last);
    // the half beyond the end clamps away: only [time - half, last] remains
    expect(r!.from).toBe(last - 3600);
  });

  it("clamps the range to the data start instead of reaching before it", () => {
    const first = 1790000400;
    const r = centeredRange(first, first, 1790604600, 7200);
    expect(r).not.toBeNull();
    expect(r!.from).toBe(first);
    expect(r!.to).toBe(first + 3600);
  });

  it("returns null for a degenerate span so callers no-op instead of freezing", () => {
    expect(centeredRange(1790066700, 1790000400, 1790604600, 0)).toBeNull();
    expect(centeredRange(1790066700, 1790000400, 1790604600, -300)).toBeNull();
  });

  it("returns null when the clamped bounds collapse (target pinned at an edge with zero span)", () => {
    expect(centeredRange(5, 0, 5, 0)).toBeNull();
  });
});

describe("shouldFollowEngine", () => {
  const engine = 1790604600;

  it("follows when the newest bar is beyond the visible range", () => {
    expect(shouldFollowEngine(engine, { from: 1790066400, to: 1790066700 })).toBe(true);
  });

  it("does not follow while the newest bar is inside the visible range", () => {
    expect(shouldFollowEngine(engine, { from: 1790000400, to: 1790604600 })).toBe(false);
    expect(shouldFollowEngine(engine, { from: 1790066700, to: 1790604600 })).toBe(false);
  });

  it("does not follow when the newest bar is exactly the visible right edge", () => {
    expect(shouldFollowEngine(engine, { from: 1790066700, to: engine })).toBe(false);
  });

  it("does not follow without a visible range", () => {
    expect(shouldFollowEngine(engine, null)).toBe(false);
  });
});
