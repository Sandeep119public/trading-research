import { describe, expect, it } from "vitest";
import type { Fill } from "@trading-research/shared";
import { buildReportCsv, reportFilename } from "./report-export";
import type { BacktestView } from "./results-panel";

function fill(overrides: Partial<Fill>): Fill {
  return {
    orderId: "o-1",
    side: "buy",
    quantity: 1,
    price: 100,
    index: 0,
    timestamp: 1700000000,
    fee: 0,
    kind: "market",
    ...overrides
  };
}

function view(fills: Fill[], overrides: Partial<BacktestView["result"]> = {}): BacktestView {
  return {
    result: {
      fills,
      equityCurve: [10000, 10010],
      finalEquity: 10005.5,
      realizedPnl: 10,
      feesPaid: 3,
      maxDrawdown: 12.34,
      ...overrides
    },
    candles: [
      { timestamp: 1700000000, open: 100, high: 101, low: 99, close: 100, volume: 10 },
      { timestamp: 1700000600, open: 100, high: 101, low: 99, close: 100, volume: 10 }
    ],
    symbol: "BTCUSDT",
    timeframe: "5m"
  };
}

const WIN_RUN = [
  fill({ orderId: "b1", side: "buy", price: 100, fee: 1, timestamp: 1700000000, index: 0 }),
  fill({ orderId: "s1", side: "sell", price: 110, fee: 1, timestamp: 1700000300, index: 1 }),
  fill({ orderId: "b2", side: "buy", price: 120, fee: 1, timestamp: 1700000600, index: 2 })
];

function metricLines(csv: string, metric: string): string[] {
  return csv.split("\r\n").filter(line => line.startsWith(`${metric},`));
}

describe("buildReportCsv", () => {
  it("exports the summary as metric,value rows using the panel's display representations", () => {
    const csv = buildReportCsv(view(WIN_RUN));
    expect(csv.split("\r\n").slice(0, 13)).toEqual([
      "metric,value",
      "Symbol,BTCUSDT",
      "Timeframe,5m",
      "Range start,2023-11-14 22:13",
      "Range end,2023-11-14 22:23",
      "Final equity,10005.50",
      "Realized P&L,10.00",
      "Max drawdown,12.34",
      "Fees paid,3.00",
      "Win rate,100.0%",
      "Profit factor,∞",
      "Trades,1",
      "Fills,3"
    ]);
    expect(csv).not.toContain("Infinity");
  });

  it("carries the profit factor representations: 0 (not 0.00) and — when nothing is to ratio", () => {
    const allLoss = buildReportCsv(
      view([
        fill({ orderId: "b1", side: "buy", price: 100, index: 0 }),
        fill({ orderId: "s1", side: "sell", price: 90, index: 1 })
      ])
    );
    expect(metricLines(allLoss, "Profit factor")).toEqual(["Profit factor,0"]);
    expect(metricLines(allLoss, "Win rate")).toEqual(["Win rate,0.0%"]);

    const empty = buildReportCsv(view([]));
    expect(metricLines(empty, "Profit factor")).toEqual(["Profit factor,—"]);
    expect(metricLines(empty, "Win rate")).toEqual(["Win rate,—"]);
    expect(metricLines(empty, "Trades")).toEqual(["Trades,0"]);
    expect(metricLines(empty, "Fills")).toEqual(["Fills,0"]);
  });

  it("exports every fill row in chronological order with the table's formatting", () => {
    const lines = buildReportCsv(view(WIN_RUN)).split("\r\n");
    const header = lines.indexOf("Time,Side,Price,Qty,Fee,Realized P&L");
    expect(header).toBeGreaterThan(-1);
    expect(lines.slice(header + 1, header + 4)).toEqual([
      "2023-11-14 22:13,buy,100.00,1,1.00,0.00",
      "2023-11-14 22:18,sell,110.00,1,1.00,10.00",
      "2023-11-14 22:23,buy,120.00,1,1.00,0.00"
    ]);
  });

  it("exports the equity curve paired 1:1 with the run's candles", () => {
    const lines = buildReportCsv(view(WIN_RUN)).split("\r\n");
    const header = lines.indexOf("Time,Equity");
    expect(header).toBeGreaterThan(-1);
    expect(lines.slice(header + 1)).toEqual([
      "2023-11-14 22:13,10000.00",
      "2023-11-14 22:23,10010.00"
    ]);
  });

  it("rejects a curve that does not pair with the candles instead of exporting a timeline that lies", () => {
    const bad = view(WIN_RUN, { equityCurve: [10000] });
    expect(() => buildReportCsv(bad)).toThrow(RangeError);
  });

  it("quotes CSV metacharacters so data can never break the file's structure", () => {
    const csv = buildReportCsv({ ...view([]), symbol: 'A,"B' });
    expect(csv.split("\r\n")).toContain('Symbol,"A,""B"');
  });

  it("separates records with CRLF and sections with exactly one blank line", () => {
    const csv = buildReportCsv(view(WIN_RUN));
    const bare = csv.replace(/\r\n/g, "");
    expect(bare).not.toContain("\n");
    expect(bare).not.toContain("\r");
    expect(csv.split("\r\n\r\n")).toHaveLength(3);
  });
});

describe("reportFilename", () => {
  it("builds a deterministic name from the run's meta", () => {
    expect(reportFilename(view([]))).toBe("backtest-BTCUSDT-5m-202311142213.csv");
  });
});
