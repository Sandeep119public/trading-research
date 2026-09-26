import type { TradeConfigDraft, TradeConfigField } from "./trade-config";

/**
 * The session trade-config inputs: fee and slippage per unit (the
 * ExecutionEngine model — fee = quantity × feePerUnit), and size in base-asset
 * units per order. Rendered twice, once near the replay trading controls and
 * once near the backtest Run control, both bound to the same App state — two
 * views of one stored value, never two stored values. Presentational only:
 * validation lives in parseTradeConfig, and an invalid draft disables every
 * action instead of reaching an engine.
 */
export function ConfigInputs({
  draft,
  errors,
  onChange
}: {
  draft: TradeConfigDraft;
  errors: string[];
  onChange: (field: TradeConfigField, value: string) => void;
}) {
  return (
    <div className="config-inputs">
      <label>
        Fee
        <input
          type="number"
          step="any"
          aria-label="Fee per unit"
          value={draft.fee}
          onChange={e => onChange("fee", e.target.value)}
        />
      </label>
      <label>
        Slippage
        <input
          type="number"
          step="any"
          aria-label="Slippage per unit"
          value={draft.slippage}
          onChange={e => onChange("slippage", e.target.value)}
        />
      </label>
      <label>
        Size
        <input
          type="number"
          step="any"
          aria-label="Position size"
          value={draft.size}
          onChange={e => onChange("size", e.target.value)}
        />
      </label>
      {errors.length > 0 && (
        <span className="config-error" role="alert">
          {errors.join(" · ")}
        </span>
      )}
    </div>
  );
}
