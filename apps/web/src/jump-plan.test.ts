import { describe, expect, it } from "vitest";
import { jumpLegend, planJump, type JumpPlan } from "./jump-plan";

describe("planJump", () => {
  it("scrolls only for a fill at or behind replay time", () => {
    expect(planJump(100, 40)).toBe("scroll");
    expect(planJump(100, 100)).toBe("scroll");
  });

  it("seeks for a fill ahead of replay time", () => {
    expect(planJump(100, 160)).toBe("seek+scroll");
  });

  it("seeks when replay time is unknown, the conservative reading", () => {
    expect(planJump(null, 160)).toBe("seek+scroll");
  });

  it("plans a seek for a target past the end of data; fastForwardTo stops at the last candle", () => {
    expect(planJump(100, 999999)).toBe("seek+scroll");
  });
});

// Phase 3 F23: the legend's values must be SELECTED from the same definition
// the rows render from — one entry per JumpPlan, carrying the exact class the
// row uses — so the caption can never describe colors the table no longer
// paints (or vice versa).
describe("jumpLegend value selection", () => {
  it("selects exactly one entry per jump plan", () => {
    const plans: JumpPlan[] = jumpLegend().map(entry => entry.plan);
    expect([...plans].sort()).toEqual(["scroll", "seek+scroll"]);
    expect(jumpLegend()).toHaveLength(2);
  });

  it("carries the row class each plan actually renders", () => {
    const byPlan = new Map(jumpLegend().map(entry => [entry.plan, entry.rowClass]));
    expect(byPlan.get("seek+scroll")).toBe("fill-jump--seek");
    expect(byPlan.get("scroll")).toBe("fill-jump--view");
  });

  it("spells out the semantics: seek advances replay, view scrolls only", () => {
    const seek = jumpLegend().find(entry => entry.plan === "seek+scroll");
    const view = jumpLegend().find(entry => entry.plan === "scroll");
    expect(seek?.text).toMatch(/advance/i);
    expect(view?.text).toMatch(/scroll/i);
    expect(view?.text).toMatch(/only/i);
    // The two captions must not read the same.
    expect(seek?.text).not.toBe(view?.text);
  });
});
