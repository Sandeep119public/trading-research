import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Fill } from "@trading-research/shared";
import { FillTable, ResultsPanel, type BacktestView } from "./results-panel";
import { DEFAULT_TRADE_DRAFT, type TradeConfigDraft, type TradeConfigField } from "./trade-config";

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
      equityCurve: [10000],
      finalEquity: 10000,
      realizedPnl: 0,
      feesPaid: 0,
      maxDrawdown: 0,
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

describe("ResultsPanel", () => {
  function configProps(
    overrides: { draft?: TradeConfigDraft; configErrors?: string[]; configValid?: boolean } = {}
  ) {
    return {
      draft: DEFAULT_TRADE_DRAFT,
      configErrors: [] as string[],
      configValid: true,
      onDraftChange: (() => {}) as (field: TradeConfigField, value: string) => void,
      ...overrides
    };
  }

  it("shows the no-run state with a run button, no stats and no table", () => {
    const markup = renderToStaticMarkup(
      <ResultsPanel view={null} loaded={false} onRun={() => {}} {...configProps()} />
    );
    expect(markup).toContain('aria-label="Backtest results"');
    expect(markup).toContain("No backtest run yet");
    expect(markup).toContain("Run backtest");
    expect(markup).toContain("disabled");
    expect(markup).not.toContain("Final equity");
    expect(markup).not.toContain("<table");
  });

  it("enables the run button when a dataset is loaded", () => {
    const markup = renderToStaticMarkup(
      <ResultsPanel view={null} loaded onRun={() => {}} {...configProps()} />
    );
    expect(markup).toContain("Run backtest");
    expect(markup).not.toContain("disabled");
  });

  it("disables Run and shows the error when the config is invalid", () => {
    const markup = renderToStaticMarkup(
      <ResultsPanel
        view={null}
        loaded
        onRun={() => {}}
        {...configProps({
          draft: { fee: "-1", slippage: "0", size: "0.01" },
          configErrors: ["Fee must be a finite number >= 0"],
          configValid: false
        })}
      />
    );
    expect(markup).toContain("disabled");
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Fee must be a finite number &gt;= 0");
    expect(markup).toContain('value="-1"');
  });

  it("renders the config inputs with the current values", () => {
    const markup = renderToStaticMarkup(
      <ResultsPanel view={view([])} loaded onRun={() => {}} {...configProps()} />
    );
    expect(markup).toContain('aria-label="Fee per unit"');
    expect(markup).toContain('aria-label="Slippage per unit"');
    expect(markup).toContain('aria-label="Position size"');
    expect(markup).toContain('value="0.01"');
  });

  it("renders an explicit zero-trade state after a run with no fills", () => {
    const markup = renderToStaticMarkup(
      <ResultsPanel view={view([])} loaded onRun={() => {}} {...configProps()} />
    );
    expect(markup).toContain("No trades in this run.");
    expect(markup).toContain("<dd>10000.00</dd>");
    expect(markup).toContain("<dd>—</dd>");
    expect(markup).toContain("<dd>0</dd>");
    expect(markup).toContain("EMA(20)/EMA(50)");
    expect(markup).toContain("BTCUSDT");
    expect(markup).not.toContain("<table");
  });

  it("renders summary stats, meta, and the fill rows of a real run", () => {
    const fills = [
      fill({ orderId: "b1", side: "buy", price: 100, fee: 1, timestamp: 1700000000, index: 0 }),
      fill({ orderId: "s1", side: "sell", price: 110, fee: 1, timestamp: 1700000300, index: 1 }),
      fill({ orderId: "b2", side: "buy", price: 120, fee: 1, timestamp: 1700000600, index: 2 })
    ];
    const markup = renderToStaticMarkup(
      <ResultsPanel
        view={view(fills, { finalEquity: 10005.5, realizedPnl: 10, feesPaid: 3, maxDrawdown: 12.34 })}
        loaded
        onRun={() => {}}
        {...configProps()}
      />
    );

    expect(markup).toContain("<dd>10005.50</dd>");
    expect(markup).toContain('<dd class="pos">10.00</dd>');
    expect(markup).toContain("<dd>12.34</dd>");
    expect(markup).toContain("<dd>3.00</dd>");
    expect(markup).toContain("<dd>100.0%</dd>");
    expect(markup).toContain("<dd>1</dd>");
    expect(markup).toContain("<dd>3</dd>");
    expect(markup).toContain("2023-11-14 22:13 → 2023-11-14 22:23");
    expect(markup).toContain("Realized P&amp;L");
    expect(markup).toContain('<td class="side-buy">buy</td>');
    expect(markup).toContain('<td class="side-sell">sell</td>');
    expect(markup).toContain('<td class="pos">10.00</td>');
    expect(markup).toContain("<td>0.00</td>");
    expect(markup).toContain("2023-11-14 22:13");
    expect(markup).toContain("2023-11-14 22:18");
    expect(markup).toContain("2023-11-14 22:23");
    expect(markup).toContain('aria-sort="ascending"');
  });

  it("marks a losing fill's realized P&L negative", () => {
    const rows = [{ fill: fill({ side: "sell" as const }), realizedPnl: -5 }];
    const markup = renderToStaticMarkup(<FillTable rows={rows} />);
    expect(markup).toContain('<td class="neg">-5.00</td>');
  });
});

describe("FillTable", () => {
  it("defaults to chronological order regardless of input order", () => {
    const rows = [
      { fill: fill({ orderId: "later", timestamp: 1700000200 }), realizedPnl: 0 },
      { fill: fill({ orderId: "earliest", timestamp: 1700000000 }), realizedPnl: 0 },
      { fill: fill({ orderId: "middle", timestamp: 1700000100 }), realizedPnl: 0 }
    ];
    const markup = renderToStaticMarkup(<FillTable rows={rows} />);
    const earliest = markup.indexOf("2023-11-14 22:13");
    const middle = markup.indexOf("2023-11-14 22:15");
    const latest = markup.indexOf("2023-11-14 22:16");
    expect(earliest).toBeGreaterThan(-1);
    expect(earliest).toBeLessThan(middle);
    expect(middle).toBeLessThan(latest);
  });

  it("marks the default sort column in the header", () => {
    const markup = renderToStaticMarkup(<FillTable rows={[]} />);
    expect(markup).toContain('aria-sort="ascending"');
    expect(markup).toContain("Time ▲");
    expect(markup).toContain('aria-sort="none"');
  });
});
