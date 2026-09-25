import { describe, expect, it } from "vitest";
import { ema } from "../src/index";

describe("ema", () => {
  it("seeds with the simple average of the first `period` values", () => {
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out[0]).toBeUndefined();
    expect(out[1]).toBeUndefined();
    expect(out[2]).toBeCloseTo(2, 10); // (1 + 2 + 3) / 3
  });

  it("blends each new value with the previous EMA", () => {
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out[3]).toBeCloseTo(3, 10); // 4 * 0.5 + 2 * 0.5
    expect(out[4]).toBeCloseTo(4, 10); // 5 * 0.5 + 3 * 0.5
  });

  it("stays on the constant when every value is the same", () => {
    expect(ema([7, 7, 7, 7], 2)).toEqual([undefined, 7, 7, 7]);
  });

  it("answers undefined everywhere when there are not enough values", () => {
    expect(ema([1, 2], 3)).toEqual([undefined, undefined]);
    expect(ema([], 3)).toEqual([]);
  });

  it("never rewrites an earlier value when later values are appended", () => {
    const closes = [10, 11, 9.5, 12, 13.5, 11, 14, 15, 13, 16];
    const full = ema(closes, 3);
    for (let i = 0; i < closes.length; i++) {
      const prefix = ema(closes.slice(0, i + 1), 3);
      expect(prefix[i]).toEqual(full[i]);
    }
  });

  it("rejects a period that is not a positive integer", () => {
    expect(() => ema([1, 2], 0)).toThrow(RangeError);
    expect(() => ema([1, 2], -1)).toThrow(RangeError);
    expect(() => ema([1, 2], 2.5)).toThrow(RangeError);
  });

  it("rejects a non-finite value instead of silently propagating NaN", () => {
    expect(() => ema([1, Number.NaN, 3], 2)).toThrow(/values\[1\] must be a finite number/);
    expect(() => ema([1, Infinity], 2)).toThrow(RangeError);
  });
});
