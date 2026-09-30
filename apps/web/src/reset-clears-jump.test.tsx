// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A4-1: Reset is a deterministic restart — it must leave no jump behind.
//
// Disclosure first: this test is green WITH and WITHOUT the one-line fix,
// and that is proven, not assumed. After `replay.reset(0)` the landing
// effect runs with a single-candle series, where `centeredRange` always
// returns null — so a stale `pendingCenter` can never visibly apply
// post-reset today. The fix (`pendingCenter.current = null` in `reset()`)
// is AGENTS.md:20 compliance (every reset API resets ALL owned mutable
// state), guarding against any future reset-to-nonzero or consumption
// change. This test pins the reset path end to end — a seek staged in the
// same tick as Reset never centers the fresh session, and replay restarts
// at the first candle — so such a change would have to answer to it.

const mocks = vi.hoisted(() => ({
  replaySetVisibleRange: vi.fn(),
  reportSetVisibleRange: vi.fn(),
  chartCount: 0
}));

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
    createChart: () => {
      mocks.chartCount += 1;
      const setVisibleRange = mocks.chartCount === 1 ? mocks.replaySetVisibleRange : mocks.reportSetVisibleRange;
      return {
        addSeries: () => seriesStub(),
        addPane: () => ({ setStretchFactor: () => {}, addSeries: () => seriesStub() }),
        timeScale: () => ({
          getVisibleRange: () => null,
          setVisibleRange,
          resetTimeScale: vi.fn(),
          scrollToRealTime: vi.fn()
        }),
        applyOptions: () => {},
        remove: () => {}
      };
    }
  };
});

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const STEP_MS = 300_000;

function buildRows(nowMs: number): number[][] {
  const rows: number[][] = [];
  // Aligned to the timeframe grid like real exchange rows (coverage is
  // checked against grid-aligned closed candles), with one spare row past
  // `now` that dropFormingCandles removes if still forming.
  const first = Math.ceil((nowMs - 7 * 86_400_000) / STEP_MS) * STEP_MS;
  let i = 0;
  for (let t = first; t <= nowMs + STEP_MS; t += STEP_MS, i++) {
    // Flat, up, down, up: EMA(20)/EMA(50) crosses up (buy), down (flatten),
    // up (buy) — three fills, all ahead of the fresh replay position.
    let close: number;
    if (i < 1500) close = 100;
    else if (i < 1700) close = 100 + (i - 1500) * 0.15;
    else if (i < 1900) close = 130 - (i - 1700) * 0.2;
    else close = 90 + (i - 1900) * 0.3;
    rows.push([t, close, close + 1, close - 1, close, 10, t + STEP_MS - 1]);
  }
  return rows;
}

async function waitFor(label: string, fn: () => boolean): Promise<void> {
  for (let i = 0; i < 300; i++) {
    if (fn()) return;
    await new Promise(r => setTimeout(r, 10));
  }
  const placeholder = document.querySelector(".chart-placeholder")?.textContent ?? "<none>";
  const status = document.querySelector(".status")?.textContent ?? "<none>";
  throw new Error(`timeout waiting for ${label}; placeholder=${placeholder} status=${status}`);
}

describe("reset clears a staged jump", () => {
  it("a seek staged in the same tick as Reset never centers the fresh session", async () => {
    const rows = buildRows(Date.now());
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = new URL(String(input));
        const start = Number(url.searchParams.get("start"));
        const end = Number(url.searchParams.get("end"));
        const limit = Number(url.searchParams.get("limit") ?? "1000");
        const page = rows.filter(r => r[0] >= start && r[0] <= end).slice(0, limit);
        return { ok: true, status: 200, json: async () => page };
      })
    );
    document.body.innerHTML = '<div id="root"></div>';
    await import("./main");
    await waitFor("dataset ready", () => document.querySelector(".status-ready") !== null);
    await act(async () => {});

    const run = [...document.querySelectorAll("button")].find(b =>
      (b.textContent ?? "").includes("Run backtest")
    )!;
    act(() => {
      run.click();
    });
    await waitFor("fills table", () => document.querySelector(".fills-table") !== null);
    await act(async () => {});

    const seeks = () => [...document.querySelectorAll("button.fill-jump--seek")] as HTMLButtonElement[];
    expect(seeks().length).toBeGreaterThan(1);
    // Prove the clicks reach React first: a solo jump marks its row.
    const firstTarget = (seeks()[0].textContent ?? "").trim();
    act(() => {
      seeks()[0].click();
    });
    await act(async () => {});
    const landed = (document.querySelector(".fills-table tbody tr.fill-current")?.textContent ?? "").trim();
    expect(landed).toContain(firstTarget);

    // Now stage a second seek in the same tick as Reset: the staged center
    // belongs to the abandoned session and must die with it.
    const reset = [...document.querySelectorAll("button")].find(b =>
      (b.textContent ?? "").includes("Reset")
    )!;
    mocks.replaySetVisibleRange.mockClear();
    act(() => {
      seeks()[seeks().length - 1].click();
      reset.click();
    });
    await act(async () => {});

    // The staged seek target must die with the old session: the fresh chart
    // gets its timescale reset, never a center on the abandoned jump.
    expect(mocks.replaySetVisibleRange).not.toHaveBeenCalled();
    // And the reset itself happened: replay is back at the first candle.
    const firstLabel = `${new Date(rows[0][0]).toISOString().slice(0, 16).replace("T", " ")} UTC`;
    expect(document.querySelector(".time")?.textContent).toContain(firstLabel);
    vi.unstubAllGlobals();
  });
});
