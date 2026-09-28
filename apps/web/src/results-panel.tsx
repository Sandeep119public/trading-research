import { useState, type Ref } from "react";
import type { BacktestResult } from "@trading-research/backtest";
import type { Candle } from "@trading-research/shared";
import { analyzeFills, sortFills, type FillRow, type FillSortKey, type SortDirection } from "./fill-analysis";
import { formatFillTime, formatMoney, formatProfitFactor, formatSignedMoney, formatWinRate, pnlSignClass } from "./report-format";
import { exportReport } from "./report-export";
import { ConfigInputs } from "./config-inputs";
import { jumpLegend, planJump } from "./jump-plan";
import { configValidationMessages, type TradeConfigDraft, type TradeConfigField } from "./trade-config";

export interface BacktestView {
  result: BacktestResult;
  candles: readonly Candle[];
  symbol: string;
  timeframe: string;
}

const COLUMNS: ReadonlyArray<{ key: FillSortKey; label: string }> = [
  { key: "time", label: "Time (UTC)" },
  { key: "side", label: "Side" },
  { key: "price", label: "Price" },
  { key: "quantity", label: "Qty" },
  { key: "fee", label: "Fee" },
  { key: "realized", label: "Realized P&L" }
];

const SCROLL_TITLE = "Scroll the charts to this time";
const SEEK_TITLE = "Fast-forwards replay to this time — every candle in between is processed";

/**
 * The sortable fill table. With `onJumpToTime` wired, each time cell becomes a
 * button: click jumps both charts to that fill, fast-forwarding replay first
 * when the time is ahead of T (planJump decides, so the pre-click look —
 * `fill-jump--view` free scroll versus `fill-jump--seek` advancing the live
 * session — states exactly what the click will do). Without the callback the
 * cells stay plain text. `activeTime` marks the most recently jumped-to row
 * so the landing stays visible while reading.
 */
export function FillTable({
  rows,
  replayTime,
  onJumpToTime,
  activeTime = null
}: {
  rows: readonly FillRow[];
  replayTime?: number | null;
  onJumpToTime?: (timestamp: number) => void;
  activeTime?: number | null;
}) {
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
        {sorted.map(row => {
          const plan = planJump(replayTime ?? null, row.fill.timestamp);
          const time = formatFillTime(row.fill.timestamp);
          return (
            <tr
              key={`${row.fill.orderId}#${row.fill.timestamp}`}
              className={activeTime === row.fill.timestamp ? "fill-current" : undefined}
            >
              <td>
                {onJumpToTime === undefined ? (
                  time
                ) : (
                  <button
                    type="button"
                    className={plan === "seek+scroll" ? "fill-jump fill-jump--seek" : "fill-jump fill-jump--view"}
                    aria-label={`Jump to ${time}`}
                    title={plan === "seek+scroll" ? SEEK_TITLE : SCROLL_TITLE}
                    onClick={() => onJumpToTime(row.fill.timestamp)}
                  >
                    {time}
                  </button>
                )}
              </td>
              <td className={row.fill.side === "buy" ? "side-buy" : "side-sell"}>{row.fill.side}</td>
              <td>{formatMoney(row.fill.price)}</td>
              <td>{row.fill.quantity}</td>
              <td>{formatMoney(row.fill.fee)}</td>
              <td className={pnlSignClass(row.realizedPnl)}>{formatSignedMoney(row.realizedPnl)}</td>
            </tr>
          );
        })}
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
 * empty state. The config controls sit in one row with the Run action so the
 * validation message (with `hasPosition` adding the close notice) renders at
 * exactly one place, beside the button it gates. The fill table's optional
 * `onJumpToTime` makes each time cell a jump affordance (with `replayTime`
 * telling a free scroll from a fast-forward); unwired, the table is exactly
 * as before.
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
  onDraftChange,
  replayTime,
  onJumpToTime,
  hasPosition = false,
  activeTime = null
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
  replayTime?: number | null;
  onJumpToTime?: (timestamp: number) => void;
  hasPosition?: boolean;
  activeTime?: number | null;
}) {
  const stats = view === null ? null : analyzeFills(view.result.fills);
  const messages = configValidationMessages(configErrors, hasPosition);

  return (
    <section className="results-panel" aria-label="Backtest results">
      <div className="results-header">
        <h2>Backtest results</h2>
        {view !== null && (
          <span className="results-meta">
            Backtest range · EMA(20)/EMA(50) · {view.symbol} · {view.timeframe} ·{" "}
            {formatFillTime(view.candles[0].timestamp)} → {formatFillTime(view.candles[view.candles.length - 1].timestamp)} UTC
          </span>
        )}
      </div>
      <div className="results-controls">
        <ConfigInputs draft={draft} errors={messages} onChange={onDraftChange} />
        <div className="results-actions">
          {view !== null && (
            <button type="button" className="results-export btn-secondary" onClick={() => exportReport(view)}>
              Export CSV
            </button>
          )}
          <button type="button" className="results-run btn-primary" disabled={!loaded || !configValid} onClick={onRun}>
            Run backtest
          </button>
        </div>
      </div>
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
              <dd>{formatMoney(view.result.finalEquity)}</dd>
            </div>
            <div>
              <dt>Realized P&L</dt>
              <dd className={pnlSignClass(view.result.realizedPnl)}>{formatSignedMoney(view.result.realizedPnl)}</dd>
            </div>
            <div>
              <dt>Max drawdown</dt>
              <dd>{formatMoney(view.result.maxDrawdown)}</dd>
            </div>
            <div>
              <dt>Fees paid</dt>
              <dd>{formatMoney(view.result.feesPaid)}</dd>
            </div>
            <div>
              <dt>Win rate</dt>
              <dd>{formatWinRate(stats.winRate)}</dd>
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
            <>
              {onJumpToTime !== undefined && (
                <div className="jump-legend">
                  {jumpLegend().map(entry => (
                    <span className="jump-legend-item" key={entry.plan}>
                      <span className={`jump-swatch ${entry.rowClass}`} aria-hidden="true" />
                      {entry.text}
                    </span>
                  ))}
                </div>
              )}
              <div className="results-table-wrap">
                <FillTable
                  rows={stats.rows}
                  replayTime={replayTime}
                  onJumpToTime={onJumpToTime}
                  activeTime={activeTime}
                />
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
