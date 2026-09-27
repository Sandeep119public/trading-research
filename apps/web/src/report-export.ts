import type { BacktestView } from "./results-panel";
import { analyzeFills } from "./fill-analysis";
import { toEquityPoints } from "./chart-points";
import { formatFillTime, formatMoney, formatProfitFactor, formatWinRate } from "./report-format";

/**
 * Quote a field per RFC 4180 whenever it could otherwise break the file's
 * structure (separator, quote, or embedded newline).
 */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function row(cells: readonly string[]): string {
  return cells.map(csvField).join(",");
}

/**
 * CSV export of the completed report. Three sections, records separated by
 * CRLF (RFC 4180): a metric,value summary of run meta and the same derived
 * stats the panel renders — win rate and profit factor go through
 * report-format's shared formatters, so "—", "∞", and "0" carry through
 * and the string "Infinity" can never appear — then the fill rows (same
 * analyzeFills walk, same per-fill realized P&L the table shows), then the
 * equity curve paired 1:1 with the run's candles via toEquityPoints, which
 * throws on a length mismatch rather than exporting a timeline that lies.
 * Presentation only: same BacktestResult the panel reads, no engine access.
 */
export function buildReportCsv(view: BacktestView): string {
  const stats = analyzeFills(view.result.fills);
  const summary = row(["metric", "value"]);
  const meta = [
    row(["Symbol", view.symbol]),
    row(["Timeframe", view.timeframe]),
    row(["Range start", formatFillTime(view.candles[0].timestamp)]),
    row(["Range end", formatFillTime(view.candles[view.candles.length - 1].timestamp)]),
    row(["Final equity", formatMoney(view.result.finalEquity)]),
    row(["Realized P&L", formatMoney(view.result.realizedPnl)]),
    row(["Max drawdown", formatMoney(view.result.maxDrawdown)]),
    row(["Fees paid", formatMoney(view.result.feesPaid)]),
    row(["Win rate", formatWinRate(stats.winRate)]),
    row(["Profit factor", formatProfitFactor(stats.profitFactor)]),
    row(["Trades", String(stats.trades)]),
    row(["Fills", String(view.result.fills.length)])
  ];
  const fills = [
    row(["Time", "Side", "Price", "Qty", "Fee", "Realized P&L"]),
    ...stats.rows.map(r =>
      row([
        formatFillTime(r.fill.timestamp),
        r.fill.side,
        formatMoney(r.fill.price),
        String(r.fill.quantity),
        formatMoney(r.fill.fee),
        formatMoney(r.realizedPnl)
      ])
    )
  ];
  const equity = [
    row(["Time", "Equity"]),
    ...toEquityPoints(view.candles, view.result.equityCurve).map(point =>
      row([formatFillTime(point.time), formatMoney(point.value)])
    )
  ];
  return [[summary, ...meta].join("\r\n"), fills.join("\r\n"), equity.join("\r\n")].join("\r\n\r\n");
}

/**
 * Deterministic filename from run meta (symbol and timeframe come from the
 * fixed selector sets, so they are already filesystem-safe).
 */
export function reportFilename(view: BacktestView): string {
  const start = formatFillTime(view.candles[0].timestamp).replace(/[-: ]/g, "");
  return `backtest-${view.symbol}-${view.timeframe}-${start}.csv`;
}

/**
 * Browser download glue: a UTF-8 CSV with BOM (Excel reads the report's ∞,
 * —, and · correctly instead of mojibake), triggered by a detached anchor.
 */
export function downloadReport(filename: string, csv: string): void {
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function exportReport(view: BacktestView): void {
  downloadReport(reportFilename(view), buildReportCsv(view));
}
