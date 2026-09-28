import { describe, expect, it } from "vitest";
import {
  formatFillTime,
  formatMoney,
  formatProfitFactor,
  formatSignedMoney,
  formatWinRate,
  pnlSignClass
} from "./report-format";

describe("formatFillTime", () => {
  it("renders a timestamp the way the fill table does: YYYY-MM-DD HH:MM", () => {
    expect(formatFillTime(1700000000)).toBe("2023-11-14 22:13");
  });
});

describe("formatMoney", () => {
  it("renders two decimals and preserves the sign", () => {
    expect(formatMoney(1005.5)).toBe("1005.50");
    expect(formatMoney(-5)).toBe("-5.00");
    expect(formatMoney(0)).toBe("0.00");
  });
});

// Phase 2 F15: a P&L figure must announce its sign itself, not rely on the
// reader inferring it from color or from neighboring numbers.
describe("formatSignedMoney", () => {
  it("renders an explicit + for gains, - for losses, plain zero", () => {
    expect(formatSignedMoney(10)).toBe("+10.00");
    expect(formatSignedMoney(-5)).toBe("-5.00");
    expect(formatSignedMoney(0)).toBe("0.00");
    expect(formatSignedMoney(10.5)).toBe("+10.50");
    expect(formatSignedMoney(-10.5)).toBe("-10.50");
  });

  it("keeps a sub-cent loss signed rather than rounding it to a bare 0.00", () => {
    expect(formatSignedMoney(-0.001)).toBe("-0.00");
    expect(pnlSignClass(-0.001)).toBe("neg");
  });
});

describe("pnlSignClass", () => {
  it("maps negative/positive/zero P&L to neg/pos/no class", () => {
    expect(pnlSignClass(-1)).toBe("neg");
    expect(pnlSignClass(1)).toBe("pos");
    expect(pnlSignClass(0)).toBeUndefined();
  });
});

describe("formatWinRate", () => {
  it("renders one-decimal percentages and the shared no-data dash", () => {
    expect(formatWinRate(null)).toBe("—");
    expect(formatWinRate(1)).toBe("100.0%");
    expect(formatWinRate(0.5)).toBe("50.0%");
    expect(formatWinRate(0)).toBe("0.0%");
  });
});

describe("formatProfitFactor", () => {
  it("renders the defined representations for every case of the union", () => {
    expect(formatProfitFactor(null)).toBe("—");
    expect(formatProfitFactor("infinite")).toBe("∞");
    expect(formatProfitFactor(0)).toBe("0");
    expect(formatProfitFactor(1.5)).toBe("1.50");
    expect(formatProfitFactor(2)).toBe("2.00");
  });

  it("never sends a non-finite number into number formatting", () => {
    // Defensive: if a raw Infinity ever slipped past analyzeFills, toFixed
    // would render the string "Infinity" into the panel. Non-finite values
    // take the symbol branch instead; the sign is preserved rather than
    // hidden, because a negative ratio would itself be a bug worth seeing.
    expect(formatProfitFactor(Infinity)).toBe("∞");
    expect(formatProfitFactor(-Infinity)).toBe("-∞");
  });
});
