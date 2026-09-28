// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import type { Fill } from "@trading-research/shared";
import { FillTable, ResultsPanel, type BacktestView } from "./results-panel";
import { DEFAULT_TRADE_DRAFT, type TradeConfigField } from "./trade-config";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const ROWS = [
  { fill: fill({ orderId: "b1", timestamp: 1700000000 }), realizedPnl: 0 },
  { fill: fill({ orderId: "s1", timestamp: 1700000300 }), realizedPnl: 10 },
  { fill: fill({ orderId: "b2", timestamp: 1700000600 }), realizedPnl: 0 }
];

const T = 1700000300;

function view(): BacktestView {
  return {
    result: {
      fills: ROWS.map(r => r.fill),
      equityCurve: [10000, 10010, 10020],
      finalEquity: 10020,
      realizedPnl: 10,
      feesPaid: 0,
      maxDrawdown: 0
    },
    candles: [
      { timestamp: 1700000000, open: 100, high: 101, low: 99, close: 100, volume: 10 },
      { timestamp: 1700000300, open: 100, high: 101, low: 99, close: 100, volume: 10 },
      { timestamp: 1700000600, open: 100, high: 101, low: 99, close: 100, volume: 10 }
    ],
    symbol: "BTCUSDT",
    timeframe: "5m"
  };
}

async function render(node: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
  return {
    container,
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  };
}

describe("fill table jump affordance", () => {
  it("renders the plain table when no callback is wired", () => {
    const markup = renderToStaticMarkup(<FillTable rows={ROWS} />);
    expect(markup).not.toContain('aria-label="Jump');
    expect(markup).toContain("<td>2023-11-14 22:13</td>");
  });

  it("turns each time cell into a button labelled Jump to <time>", () => {
    const markup = renderToStaticMarkup(
      <FillTable rows={ROWS} onJumpToTime={() => {}} replayTime={T} />
    );
    expect(markup).toContain('aria-label="Jump to 2023-11-14 22:13"');
    expect(markup).toContain('aria-label="Jump to 2023-11-14 22:18"');
    expect(markup).toContain('aria-label="Jump to 2023-11-14 22:23"');
  });

  it("reads differently before the click: at/behind T is a view, ahead of T advances replay", () => {
    const markup = renderToStaticMarkup(
      <FillTable rows={ROWS} onJumpToTime={() => {}} replayTime={T} />
    );
    expect(markup.match(/fill-jump--view/g)).toHaveLength(2);
    expect(markup.match(/fill-jump--seek/g)).toHaveLength(1);
    expect(markup).toContain('title="Scroll the charts to this time"');
    expect(markup).toContain('title="Fast-forwards replay to this time — every candle in between is processed"');
  });

  it("fires the callback with the clicked fill's timestamp", async () => {
    const onJump = vi.fn();
    const r = await render(<FillTable rows={ROWS} onJumpToTime={onJump} replayTime={T} />);
    const rows = Array.from(r.container.querySelectorAll("tbody tr"));
    expect(rows).toHaveLength(3);
    const timeButtons = rows.map(row => row.querySelector<HTMLButtonElement>("td:first-child button"));
    if (timeButtons.some(button => button === null)) throw new Error("missing jump button");

    await act(async () => {
      (timeButtons[0] as HTMLButtonElement).click();
    });
    expect(onJump).toHaveBeenLastCalledWith(1700000000);
    await act(async () => {
      (timeButtons[2] as HTMLButtonElement).click();
    });
    expect(onJump).toHaveBeenLastCalledWith(1700000600);
    expect(onJump).toHaveBeenCalledTimes(2);
    await r.unmount();
  });

  it("ResultsPanel passes the affordance through only when wired", () => {
    const configProps = {
      draft: DEFAULT_TRADE_DRAFT,
      configErrors: [] as string[],
      configValid: true,
      runError: null as string | null,
      onDraftChange: (() => {}) as (field: TradeConfigField, value: string) => void,
      loaded: true,
      onRun: () => {}
    };
    const wired = renderToStaticMarkup(
      <ResultsPanel view={view()} onJumpToTime={() => {}} replayTime={T} {...configProps} />
    );
    expect(wired).toContain('aria-label="Jump to 2023-11-14 22:13"');

    const plain = renderToStaticMarkup(<ResultsPanel view={view()} {...configProps} />);
    expect(plain).not.toContain('aria-label="Jump');
  });

  it("shows the jump legend with the row classes, only when jumps are wired", () => {
    const configProps = {
      draft: DEFAULT_TRADE_DRAFT,
      configErrors: [] as string[],
      configValid: true,
      runError: null as string | null,
      onDraftChange: (() => {}) as (field: TradeConfigField, value: string) => void,
      loaded: true,
      onRun: () => {}
    };
    const wired = renderToStaticMarkup(
      <ResultsPanel view={view()} onJumpToTime={() => {}} replayTime={T} {...configProps} />
    );
    expect(wired).toContain('class="jump-legend"');
    expect(wired).toContain("jump-swatch fill-jump--seek");
    expect(wired).toContain("jump-swatch fill-jump--view");
    // Legend semantics reach the screen, not just the module.
    expect(wired).toMatch(/advance/i);
    expect(wired).toMatch(/scroll.*only/i);
    // Rows really carry the classes the legend swatches show.
    expect((wired.match(/fill-jump--seek/g) ?? []).length).toBeGreaterThan(1);
    expect((wired.match(/fill-jump--view/g) ?? []).length).toBeGreaterThan(1);

    const plain = renderToStaticMarkup(<ResultsPanel view={view()} {...configProps} />);
    expect(plain).not.toContain("jump-legend");
  });

  it("marks exactly the jumped-to row as current", () => {
    const markup = renderToStaticMarkup(
      <FillTable rows={ROWS} onJumpToTime={() => {}} replayTime={T} activeTime={1700000300} />
    );
    expect(markup.match(/fill-current/g)).toHaveLength(1);
    const start = markup.indexOf('class="fill-current"');
    const end = markup.indexOf("</tr>", start);
    const rowHtml = markup.slice(start, end);
    expect(rowHtml).toContain("2023-11-14 22:18");
    expect(rowHtml).not.toContain("2023-11-14 22:13");
  });

  it("leaves no row current when nothing has been jumped to", () => {
    const markup = renderToStaticMarkup(
      <FillTable rows={ROWS} onJumpToTime={() => {}} replayTime={T} activeTime={null} />
    );
    expect(markup).not.toContain("fill-current");
  });
});
