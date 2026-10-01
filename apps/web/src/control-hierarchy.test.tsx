// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { buildRows, ensureResizeObserver, stubKlinesFetch, waitFor } from "./app-test-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Phase 2: primary / secondary / destructive must be applied, not just
// defined. The variant classes exist since the token milestone, but nothing
// pins which control carries which — Play shipped the base gray look next
// to a primary Run, and Reset's danger treatment had no coverage.
vi.mock("lightweight-charts", () => {
  const seriesStub = () => ({
    setData: vi.fn(),
    createPriceLine: vi.fn(),
    priceScale: () => ({ applyOptions: vi.fn() })
  });
  return {
    CandlestickSeries: "Candlestick",
    HistogramSeries: "Histogram",
    LineSeries: "Line",
    LineStyle: { Dashed: 2 },
    createSeriesMarkers: () => ({ setMarkers: vi.fn() }),
    createChart: () => ({
      addSeries: () => seriesStub(),
      addPane: () => ({ setStretchFactor: () => {}, addSeries: () => seriesStub() }),
      timeScale: () => ({
        getVisibleRange: () => null,
        setVisibleRange: vi.fn(),
        resetTimeScale: vi.fn(),
        scrollToRealTime: vi.fn()
      }),
      applyOptions: () => {},
      remove: () => {}
    })
  };
});

ensureResizeObserver();

describe("control hierarchy", () => {
  it("marks primary actions primary, destructive danger, and the rest secondary", async () => {
    stubKlinesFetch(buildRows(Date.now()));
    document.body.innerHTML = '<div id="root"></div>';
    await import("./main");
    await waitFor("dataset ready", () => document.querySelector(".status-ready") !== null);
    await act(async () => {});

    const footerButton = (name: string) =>
      [...document.querySelectorAll("footer button")].find(b => (b.textContent ?? "").includes(name))!;
    // Primary: the two actions that move the session or the report forward.
    expect(footerButton("Play").className).toContain("btn-primary");
    const run = [...document.querySelectorAll("button")].find(
      b => (b.textContent ?? "").trim() === "Run backtest"
    )!;
    expect(run.className).toContain("btn-primary");
    // Destructive: the session wipe, and only it.
    expect(footerButton("Reset").className).toContain("btn-danger");
    // Secondary: everything else stays on the base look — never primary,
    // never danger.
    for (const name of ["Step", "Buy", "Sell", "Close", "1x", "2x", "5x", "10x"]) {
      const cls = footerButton(name).className;
      expect(cls).not.toContain("btn-primary");
      expect(cls).not.toContain("btn-danger");
    }
    vi.unstubAllGlobals();
  });
});
