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

/**
 * Upper bound for every user-entered field. Finite is not enough, and
 * neither is merely dodging IEEE-754 overflow: the report chart refuses
 * line-series values outside ±90,071,992,547,409.91 (~9.007e13) by throwing
 * inside setData, which takes the whole app — replay session included —
 * into the error boundary (B4-1: fee=size=1e9 is IEEE-finite yet produced a
 * ~1e18 equity curve and crashed a valid run). So the cap is derived from
 * the rendering bound, not the float bound.
 *
 * Per-fill fee is size × feePerUnit ≤ M² for cap M, and a run can hold tens
 * of fills (strategy-driven; observed ≤54) — adversarially, one per candle
 * over the largest servable ranges (~3k candles). At M=1e5 the per-fill
 * ceiling is 1e10: a hundred fills total 1e12 (~90× below the chart bound),
 * and even an every-candle fill pattern stays under ~3e13. M=1e6 fails that
 * arithmetic (100 fills × 1e12 already exceeds the bound), so 1e5 is the
 * largest power-of-ten cap that stays renderable with margin.
 *
 * It is also economically sane as an upper fence: 1e5 units is ~$8.6B at
 * BTC prices and a 1e5 per-unit fee is on the order of the asset price
 * itself — anything beyond is an exponent typo, and this boundary rejects
 * it instead of passing it to an engine. The engines' own finite checks
 * remain as the last line of defense for non-UI callers; the UI never has
 * to reach them.
 */
export const MAX_TRADE_CONFIG_VALUE = 1e5;

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
  if (value > MAX_TRADE_CONFIG_VALUE) {
    errors.push(`${label} must be <= ${MAX_TRADE_CONFIG_VALUE}`);
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

/**
 * Shown alongside the field errors whenever the draft is invalid while a
 * position is open: a close fill executes under the last valid config, so
 * fee/slippage/size typed in the box are NOT what the close will use. Without
 * this notice a fill can land with numbers the user never saw applied.
 */
export const CLOSE_NOTICE = "Closing uses your last valid settings.";

/**
 * The single validation message list the UI renders (F7: exactly one place,
 * never duplicated across control groups). Field errors always pass through;
 * the close notice joins them only when the config is invalid AND a position
 * can be closed under the last valid settings.
 */
export function configValidationMessages(errors: readonly string[], hasPosition: boolean): string[] {
  return hasPosition && errors.length > 0 ? [...errors, CLOSE_NOTICE] : [...errors];
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
