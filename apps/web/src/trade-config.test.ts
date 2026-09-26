import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRADE_CONFIG,
  DEFAULT_TRADE_DRAFT,
  parseTradeConfig,
  toBacktestConfig,
  toExecutionConfig,
  type TradeConfigDraft
} from "./trade-config";

function draft(overrides: Partial<TradeConfigDraft>): TradeConfigDraft {
  return { ...DEFAULT_TRADE_DRAFT, ...overrides };
}

describe("parseTradeConfig", () => {
  it("parses the zero-cost defaults to the default config", () => {
    expect(DEFAULT_TRADE_CONFIG).toEqual({ feePerUnit: 0, slippagePerUnit: 0, size: 0.01 });
    expect(parseTradeConfig(DEFAULT_TRADE_DRAFT)).toEqual({ config: DEFAULT_TRADE_CONFIG, errors: [] });
  });

  it("parses valid decimal inputs exactly", () => {
    expect(parseTradeConfig(draft({ fee: "2.5", slippage: "0.1", size: "1.5" }))).toEqual({
      config: { feePerUnit: 2.5, slippagePerUnit: 0.1, size: 1.5 },
      errors: []
    });
  });

  it("rejects a negative fee or slippage with a visible message", () => {
    expect(parseTradeConfig(draft({ fee: "-1" }))).toEqual({
      config: null,
      errors: ["Fee must be a finite number >= 0"]
    });
    expect(parseTradeConfig(draft({ slippage: "-0.5" }))).toEqual({
      config: null,
      errors: ["Slippage must be a finite number >= 0"]
    });
  });

  it("rejects a zero or negative size", () => {
    expect(parseTradeConfig(draft({ size: "0" }))).toEqual({
      config: null,
      errors: ["Size must be a finite number > 0"]
    });
    expect(parseTradeConfig(draft({ size: "-2" }))).toEqual({
      config: null,
      errors: ["Size must be a finite number > 0"]
    });
  });

  it("rejects empty, non-numeric, and non-finite input instead of coercing it", () => {
    // Number("") is 0 — the empty case is the silent-clamp trap this guards.
    expect(parseTradeConfig(draft({ fee: "" })).errors).toEqual(["Fee must be a finite number >= 0"]);
    expect(parseTradeConfig(draft({ fee: "   " })).errors).toEqual(["Fee must be a finite number >= 0"]);
    expect(parseTradeConfig(draft({ slippage: "abc" })).errors).toEqual(["Slippage must be a finite number >= 0"]);
    expect(parseTradeConfig(draft({ size: "NaN" })).errors).toEqual(["Size must be a finite number > 0"]);
    expect(parseTradeConfig(draft({ fee: "Infinity" })).errors).toEqual(["Fee must be a finite number >= 0"]);
    expect(parseTradeConfig(draft({ fee: "" })).config).toBeNull();
  });

  it("collects every field error, not just the first", () => {
    const parsed = parseTradeConfig({ fee: "-1", slippage: "nope", size: "0" });
    expect(parsed.config).toBeNull();
    expect(parsed.errors).toEqual([
      "Fee must be a finite number >= 0",
      "Slippage must be a finite number >= 0",
      "Size must be a finite number > 0"
    ]);
  });
});

describe("config derivation", () => {
  it("derives both driver configs from the same stored value", () => {
    const stored = { feePerUnit: 2, slippagePerUnit: 0.5, size: 0.25 };
    expect(toExecutionConfig(stored)).toEqual({ feePerUnit: 2, slippagePerUnit: 0.5 });
    expect(toBacktestConfig(stored, 1000)).toEqual({
      startingCapital: 1000,
      feePerUnit: 2,
      slippagePerUnit: 0.5,
      size: 0.25
    });
    // A change to the stored value reaches both derivations.
    stored.feePerUnit = 9;
    expect(toExecutionConfig(stored).feePerUnit).toBe(9);
    expect(toBacktestConfig(stored, 1000).feePerUnit).toBe(9);
  });

  it("hands each driver an independent value, so one cannot corrupt the other", () => {
    const stored = { feePerUnit: 2, slippagePerUnit: 0.5, size: 0.25 };
    const execution = toExecutionConfig(stored);
    const backtest = toBacktestConfig(stored, 1000);
    // Mutating a derived config touches neither the source nor a fresh
    // derivation for the other driver.
    execution.feePerUnit = 999;
    backtest.size = 999;
    expect(stored).toEqual({ feePerUnit: 2, slippagePerUnit: 0.5, size: 0.25 });
    expect(toExecutionConfig(stored)).toEqual({ feePerUnit: 2, slippagePerUnit: 0.5 });
    expect(toBacktestConfig(stored, 1000).size).toBe(0.25);
    expect(toExecutionConfig(stored)).not.toBe(toExecutionConfig(stored));
  });
});
