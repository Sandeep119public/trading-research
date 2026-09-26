import type { BacktestConfig } from "@trading-research/backtest";
import type { ExecutionConfig } from "@trading-research/execution";

/**
 * The session's simulation assumptions, owned by the UI. Both drivers derive
 * their configs from this single value — the replay stack's ExecutionEngine
 * and every BacktestDriver run read the same numbers — so replay and
 * backtest can never silently disagree about fees, slippage, or size.
 */
export interface TradeConfig {
  feePerUnit: number;
  slippagePerUnit: number;
  size: number;
}

/** Zero-cost defaults: behavior is unchanged until the user edits a field. */
export const DEFAULT_TRADE_CONFIG: TradeConfig = { feePerUnit: 0, slippagePerUnit: 0, size: 0.01 };

export type TradeConfigField = "fee" | "slippage" | "size";

/** Raw input strings, as typed. Parsed by parseTradeConfig, never coerced. */
export interface TradeConfigDraft {
  fee: string;
  slippage: string;
  size: string;
}

export const DEFAULT_TRADE_DRAFT: TradeConfigDraft = { fee: "0", slippage: "0", size: "0.01" };

export interface ParsedTradeConfig {
  /**
   * The validated config, or null when errors is non-empty. Invalid input
   * blocks the action — it is never silently clamped to zero, and NaN never
   * reaches an engine.
   */
  config: TradeConfig | null;
  errors: string[];
}

function parseField(raw: string, label: string, kind: "nonNegative" | "positive", errors: string[]): number | null {
  // Number("") is 0 — an empty input must fail, not silently become free trading.
  if (raw.trim() === "") {
    errors.push(`${label} must be a finite number ${kind === "positive" ? "> 0" : ">= 0"}`);
    return null;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || (kind === "positive" ? value <= 0 : value < 0)) {
    errors.push(`${label} must be a finite number ${kind === "positive" ? "> 0" : ">= 0"}`);
    return null;
  }
  return value;
}

/** Validate the draft at the UI boundary. Pure: no React, no engine, no DOM. */
export function parseTradeConfig(draft: TradeConfigDraft): ParsedTradeConfig {
  const errors: string[] = [];
  const feePerUnit = parseField(draft.fee, "Fee", "nonNegative", errors);
  const slippagePerUnit = parseField(draft.slippage, "Slippage", "nonNegative", errors);
  const size = parseField(draft.size, "Size", "positive", errors);
  if (errors.length > 0 || feePerUnit === null || slippagePerUnit === null || size === null) {
    return { config: null, errors };
  }
  return { config: { feePerUnit, slippagePerUnit, size }, errors };
}

/** Derive the replay engine's config from the session value. Fresh object
 * every call: mutating a derived config can never leak back into the
 * session state or into the other driver's derivation. */
export function toExecutionConfig(trade: TradeConfig): ExecutionConfig {
  return { feePerUnit: trade.feePerUnit, slippagePerUnit: trade.slippagePerUnit };
}

/** Derive a backtest run's config from the session value. Same freshness
 * guarantee as toExecutionConfig. */
export function toBacktestConfig(trade: TradeConfig, startingCapital: number): BacktestConfig {
  return {
    startingCapital,
    feePerUnit: trade.feePerUnit,
    slippagePerUnit: trade.slippagePerUnit,
    size: trade.size
  };
}
