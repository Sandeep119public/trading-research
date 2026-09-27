import { useState, type Ref } from "react";
import type { BacktestResult } from "@trading-research/backtest";
import type { Candle } from "@trading-research/shared";
import { analyzeFills, sortFills, type FillRow, type FillSortKey, type SortDirection } from "./fill-analysis";
import { ConfigInputs } from "./config-inputs";
import type { TradeConfigDraft, TradeConfigField } from "./trade-config";

export interface BacktestView {
  result: BacktestResult;
  candles: readonly Candle[];
  symbol: string;
  timeframe: string;
}

export function formatFillTime(timestampSeconds: number): string {
  return new Date(timestampSeconds * 1000).toISOString().slice(0, 16).replace("T", " ");
}

function money(value: number): string {
  return value.toFixed(2);
}

/**
 * Profit factor's representation contract, decided once here: null (nothing
 * to ratio) -> "—" like win rate's no-data dash; "infinite" (wins, no
 * losing trade) -> "∞"; a raw Infinity never reaches toFixed (it would
 * render the string "Infinity") and maps to the same symbols; an exact 0
 * renders as "0", not "0.00", so it cannot read as a rounded near-zero.
 * NaN falls through to toFixed and renders "NaN" — loud, never silent.
 */
export function formatProfitFactor(value: number | "infinite" | null): string {
  if (value === null) return "—";
  if (value === "infinite") return "∞";
  if (value === Infinity) return "∞";
  if (value === -Infinity) return "-∞";
  return value === 0 ? "0" : value.toFixed(2);
}

function signClass(value: number): string | undefined {
  return value < 0 ? "neg" : value > 0 ? "pos" : undefined;
}

const COLUMNS: ReadonlyArray<{ key: FillSortKey; label: string }> = [
  { key: "time", label: "Time" },
  { key: "side", label: "Side" },
  { key: "price", label: "Price" },
  { key: "quantity", label: "Qty" },
  { key: "fee", label: "Fee" },
  { key: "realized", label: "Realized P&L" }
];

export function FillTable({ rows }: { rows: readonly FillRow[] }) {
  const [sort, setSort] = useState<{ key: FillSortKey; direction: SortDirection }>({
    key: "time",
    direction: "asc"
  });
  const sorted = sortFills(rows, sort.key, sort.direction);
  const toggle = (key: FillSortKey) =>
    setSort(previous =>
      previous.key === key
        ? { key, direction: previous.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" }
    );

  return (
    <table className="fills-table">
      <thead>
        <tr>
          {COLUMNS.map(column => (
            <th
              key={column.key}
              aria-sort={sort.key === column.key ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
            >
              <button
                type="button"
                className={sort.key === column.key ? "sorted" : undefined}
                onClick={() => toggle(column.key)}
              >
                {column.label}
                {sort.key === column.key ? (sort.direction === "asc" ? " ▲" : " ▼") : ""}
              </button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map(row => (
          <tr key={`${row.fill.orderId}#${row.fill.timestamp}`}>
            <td>{formatFillTime(row.fill.timestamp)}</td>
            <td className={row.fill.side === "buy" ? "side-buy" : "side-sell"}>{row.fill.side}</td>
            <td>{money(row.fill.price)}</td>
            <td>{row.fill.quantity}</td>
            <td>{money(row.fill.fee)}</td>
            <td className={signClass(row.realizedPnl)}>{money(row.realizedPnl)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The backtest report: summary stats, the equity curve's chart container, and
 * the sortable fill table — presentation only. Every number except the fields
 * already on BacktestResult (finalEquity, realizedPnl, feesPaid, maxDrawdown)
 * is derived from Fill[] by analyzeFills, so the panel never asks the engine
 * for state it does not already own. Four states, all explicit: a run that
 * failed (runError), no run yet, a run with no fills ("No trades in this
 * run"), and a run with results — a failure is never rendered as a no-run or
 * empty state.
 */
export function ResultsPanel({
  view,
  loaded,
  onRun,
  chartRef,
  draft,
  configErrors,
  configValid,
  runError,
  onDraftChange
}: {
  view: BacktestView | null;
  loaded: boolean;
  onRun: () => void;
  chartRef?: Ref<HTMLDivElement>;
  draft: TradeConfigDraft;
  configErrors: string[];
  configValid: boolean;
  runError: string | null;
  onDraftChange: (field: TradeConfigField, value: string) => void;
}) {
  const stats = view === null ? null : analyzeFills(view.result.fills);

  return (
    <section className="results-panel" aria-label="Backtest results">
      <div className="results-header">
        <h2>Backtest results</h2>
        {view !== null && (
          <span className="results-meta">
            EMA(20)/EMA(50) · {view.symbol} · {view.timeframe} ·{" "}
            {formatFillTime(view.candles[0].timestamp)} → {formatFillTime(view.candles[view.candles.length - 1].timestamp)}
          </span>
        )}
        <button type="button" className="results-run" disabled={!loaded || !configValid} onClick={onRun}>
          Run backtest
        </button>
      </div>
      <ConfigInputs draft={draft} errors={configErrors} onChange={onDraftChange} />
      {view === null || stats === null ? (
        runError !== null ? (
          <p className="results-error" role="alert">Backtest failed: {runError}</p>
        ) : (
          <p className="results-hint">No backtest run yet — press Run backtest for a full-range EMA(20)/EMA(50) report.</p>
        )
      ) : (
        <>
          <dl className="results-stats">
            <div>
              <dt>Final equity</dt>
              <dd>{money(view.result.finalEquity)}</dd>
            </div>
            <div>
              <dt>Realized P&L</dt>
              <dd className={signClass(view.result.realizedPnl)}>{money(view.result.realizedPnl)}</dd>
            </div>
            <div>
              <dt>Max drawdown</dt>
              <dd>{money(view.result.maxDrawdown)}</dd>
            </div>
            <div>
              <dt>Fees paid</dt>
              <dd>{money(view.result.feesPaid)}</dd>
            </div>
            <div>
              <dt>Win rate</dt>
              <dd>{stats.winRate === null ? "—" : `${(stats.winRate * 100).toFixed(1)}%`}</dd>
            </div>
            <div>
              <dt>Profit factor</dt>
              <dd>{formatProfitFactor(stats.profitFactor)}</dd>
            </div>
            <div>
              <dt>Trades</dt>
              <dd>{stats.trades}</dd>
            </div>
            <div>
              <dt>Fills</dt>
              <dd>{view.result.fills.length}</dd>
            </div>
          </dl>
          <div className="results-chart" ref={chartRef} />
          {view.result.fills.length === 0 ? (
            <p className="results-empty">No trades in this run.</p>
          ) : (
            <div className="results-table-wrap">
              <FillTable rows={stats.rows} />
            </div>
          )}
        </>
      )}
    </section>
  );
}
