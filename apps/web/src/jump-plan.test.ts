import { describe, expect, it } from "vitest";
import { planJump } from "./jump-plan";

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
