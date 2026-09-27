import { describe, expect, it } from "vitest";
import {
  formatFillTime,
  formatMoney,
  formatProfitFactor,
  formatWinRate
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
