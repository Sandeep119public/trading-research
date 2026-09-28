import { describe, expect, it } from "vitest";
import {
  CLOSE_NOTICE,
  DEFAULT_TRADE_CONFIG,
  DEFAULT_TRADE_DRAFT,
  configValidationMessages,
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

  it("rejects extreme finite values that would overflow engine math", () => {
    // 1e308 is finite and positive, so the generic checks pass it — yet
    // size * feePerUnit or size * price against it yields Infinity, which
    // reaches fills and equity as silent garbage. The bound must catch it.
    expect(parseTradeConfig(draft({ fee: "1e308" }))).toEqual({
      config: null,
      errors: ["Fee must be <= 1000000000"]
    });
    expect(parseTradeConfig(draft({ slippage: "1e308" }))).toEqual({
      config: null,
      errors: ["Slippage must be <= 1000000000"]
    });
    expect(parseTradeConfig(draft({ size: "1e308" }))).toEqual({
      config: null,
      errors: ["Size must be <= 1000000000"]
    });
  });

  it("accepts the bound itself and rejects just above it", () => {
    expect(parseTradeConfig(draft({ fee: "1000000000" })).config).not.toBeNull();
    expect(parseTradeConfig(draft({ fee: "1e9" })).config).not.toBeNull();
    expect(parseTradeConfig(draft({ size: "999999999.5" })).config).not.toBeNull();
    expect(parseTradeConfig(draft({ fee: "1000000001" }))).toEqual({
      config: null,
      errors: ["Fee must be <= 1000000000"]
    });
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

// Phase 2 F7: the message shown for an invalid draft must depend on whether
// an open position can still be closed, and must appear exactly once (the
// results panel instance renders it; the footer instance was removed).
describe("configValidationMessages", () => {
  it("passes field errors through unchanged when no position is open", () => {
    expect(configValidationMessages(["Size must be a finite number > 0"], false)).toEqual([
      "Size must be a finite number > 0"
    ]);
  });

  it("appends the close notice when an invalid draft coexists with an open position", () => {
    expect(configValidationMessages(["Size must be a finite number > 0"], true)).toEqual([
      "Size must be a finite number > 0",
      CLOSE_NOTICE
    ]);
    expect(CLOSE_NOTICE).toBe("Closing uses your last valid settings.");
  });

  it("stays silent when the draft is valid, even with a position open", () => {
    expect(configValidationMessages([], true)).toEqual([]);
    expect(configValidationMessages([], false)).toEqual([]);
  });

  it("never mutates the caller's error array", () => {
    const errors = ["Fee must be a finite number >= 0"];
    configValidationMessages(errors, true);
    expect(errors).toEqual(["Fee must be a finite number >= 0"]);
  });
});
