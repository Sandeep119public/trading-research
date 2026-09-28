// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ResultsPanel, type BacktestView } from "./results-panel";
import { DEFAULT_TRADE_DRAFT, type TradeConfigField } from "./trade-config";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function view(): BacktestView {
  return {
    result: {
      fills: [
        {
          orderId: "b1",
          side: "buy",
          quantity: 1,
          price: 100,
          index: 0,
          timestamp: 1700000000,
          fee: 0,
          kind: "market"
        }
      ],
      equityCurve: [10000, 10010],
      finalEquity: 10010,
      realizedPnl: 0,
      feesPaid: 0,
      maxDrawdown: 0
    },
    candles: [
      { timestamp: 1700000000, open: 100, high: 101, low: 99, close: 100, volume: 10 },
      { timestamp: 1700000600, open: 100, high: 101, low: 99, close: 100, volume: 10 }
    ],
    symbol: "BTCUSDT",
    timeframe: "5m"
  };
}

// F33: focus is navigation, not state. A keyboard probe once left an action
// disabled with no visible cause; this pins the boundary on the real
// component — a full focus/blur sweep across every control must leave
// disabled-ness, validation errors, and alerts exactly as they were.
describe("focus/blur cycles", () => {
  it("never leaves the panel's actions disabled or trips validation", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(
        <ResultsPanel
          view={view()}
          loaded
          onRun={() => {}}
          draft={DEFAULT_TRADE_DRAFT}
          configErrors={[]}
          configValid
          runError={null}
          onDraftChange={(_: TradeConfigField, __: string) => {}}
        />
      );
    });

    const runButton = [...container.querySelectorAll("button")].find(b =>
      (b.textContent ?? "").includes("Run backtest")
    );
    expect(runButton).toBeDefined();
    const before = runButton!.disabled;
    expect(before).toBe(false);

    const controls = [...container.querySelectorAll("button, input")];
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      act(() => {
        control.dispatchEvent(new window.FocusEvent("focusin", { bubbles: true }));
        control.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true }));
      });
    }

    const after = [...container.querySelectorAll("button")].find(b =>
      (b.textContent ?? "").includes("Run backtest")
    )!.disabled;
    expect(after).toBe(before);
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
    expect(container.querySelector(".config-error")).toBeNull();

    act(() => root!.unmount());
    container.remove();
  });
});
