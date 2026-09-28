import { describe, expect, it, vi } from "vitest";
import type { IChartApi } from "lightweight-charts";
import type { Candle, Fill } from "@trading-research/shared";
import { equityAxisTag, populateEquityChart, reportMarkers } from "./results-chart";
import { jumpMarker } from "./fill-markers";

function candle(timestamp: number, close: number): Candle {
  return { timestamp, open: close, high: close + 1, low: close - 1, close, volume: 10 };
}

function fakeChart() {
  const setData = vi.fn();
  const createPriceLine = vi.fn();
  const addSeries = vi.fn((_series: unknown, _options?: Record<string, unknown>) => ({ setData, createPriceLine }));
  const chart = { addSeries } as unknown as Pick<IChartApi, "addSeries">;
  return { chart, addSeries, setData, createPriceLine };
}

describe("populateEquityChart", () => {
  it("hands the series exactly one point per bar of the equity curve", () => {
    const { chart, setData } = fakeChart();
    const candles = [candle(1700000000, 100), candle(1700000300, 101), candle(1700000600, 102)];
    populateEquityChart(chart, candles, [10000, 10025.5, 9987.25]);
    expect(setData).toHaveBeenCalledTimes(1);
    expect(setData).toHaveBeenCalledWith([
      { time: 1700000000, value: 10000 },
      { time: 1700000300, value: 10025.5 },
      { time: 1700000600, value: 9987.25 }
    ]);
  });

  it("adds exactly one line series for the curve", () => {
    const { chart, addSeries, setData } = fakeChart();
    populateEquityChart(chart, [candle(1700000000, 100)], [10000]);
    expect(addSeries).toHaveBeenCalledTimes(1);
    expect(setData).toHaveBeenCalledTimes(1);
  });

  it("rejects a curve that does not belong to the candles", () => {
    const { chart } = fakeChart();
    expect(() => populateEquityChart(chart, [candle(1700000000, 100)], [10000, 10001])).toThrow(RangeError);
  });
});

// Phase 3 F22: after a fill-row jump scrolls the report chart, the axis tag
// used to show the last VISIBLE value (e.g. 10000.25) while the FINAL EQUITY
// card read 9984.43 — contradictory numbers side by side. The tag must be
// pinned to the series' FINAL value; the crosshair carries hovered values.
describe("equityAxisTag", () => {
  it("is the curve's final value — the tag can never drift from FINAL EQUITY", () => {
    const finalEquity = 9984.43;
    const curve = [10000, 10010, 9990, finalEquity];
    expect(equityAxisTag(curve)).toBe(finalEquity);
    expect(equityAxisTag(curve)).toBe(curve[curve.length - 1]);
  });

  it("rejects an empty curve rather than inventing a tag", () => {
    expect(() => equityAxisTag([])).toThrow(RangeError);
  });
});

describe("pinned final-value axis tag", () => {
  it("turns off the scroll-dependent last-value label and the built-in price line", () => {
    const { chart, addSeries } = fakeChart();
    populateEquityChart(chart, [candle(1700000000, 100)], [10000]);
    const options = addSeries.mock.calls[0][1] as Record<string, unknown>;
    expect(options.lastValueVisible).toBe(false);
    expect(options.priceLineVisible).toBe(false);
  });

  it("pins a price line at the curve's final value with its axis label visible", () => {
    const { chart, createPriceLine } = fakeChart();
    const curve = [10000, 10025.5, 9987.25];
    populateEquityChart(
      chart,
      [candle(1700000000, 100), candle(1700000300, 101), candle(1700000600, 102)],
      curve
    );
    expect(createPriceLine).toHaveBeenCalledTimes(1);
    const line = createPriceLine.mock.calls[0][0];
    expect(line.price).toBe(equityAxisTag(curve));
    expect(line.price).toBe(curve[curve.length - 1]);
    expect(line.axisLabelVisible).toBe(true);
  });

  it("keeps the whole curve — and the pinned final value — inside every y-window", () => {
    const { chart, addSeries } = fakeChart();
    const curve = [10000, 10025.5, 9984.43, 9990];
    populateEquityChart(
      chart,
      [candle(1700000000, 100), candle(1700000300, 101), candle(1700000600, 102), candle(1700000900, 103)],
      curve
    );
    const options = addSeries.mock.calls[0][1] as {
      autoscaleInfoProvider?: () => { priceRange: { minValue: number; maxValue: number } };
    };
    expect(options.autoscaleInfoProvider).toBeTypeOf("function");
    const range = options.autoscaleInfoProvider!().priceRange;
    expect(range.minValue).toBe(9984.43); // the final tag can never fall off-screen
    expect(range.maxValue).toBe(10025.5); // and the curve itself stays fully visible
  });
});

function fillAt(timestamp: number, side: "buy" | "sell"): Fill {
  return { orderId: `o${timestamp}`, side, quantity: 0.01, price: 100, index: 0, timestamp, fee: 0, kind: "market" };
}

// F29: the report chart carries the report's own buy/sell arrows, and a
// jump-landing marker layers ON TOP of them — setting or clearing a jump can
// never silently drop the arrows the fills table describes.
describe("reportMarkers", () => {
  const candles = [candle(1700000000, 100), candle(1700000300, 101), candle(1700000600, 102)];
  const fills = [fillAt(1700000000, "buy"), fillAt(1700000600, "sell")];

  it("holds every fill arrow with no jump set", () => {
    const markers = reportMarkers(candles, fills, null);
    expect(markers).toHaveLength(2);
    expect(markers.map(m => m.shape)).toEqual(["arrowUp", "arrowDown"]);
    expect(markers.map(m => m.color)).toEqual(["#4ade80", "#f87171"]);
  });

  it("keeps every arrow when a jump marker is layered on", () => {
    const jump = jumpMarker(1700000300, "seek+scroll");
    const markers = reportMarkers(candles, fills, jump);
    expect(markers).toHaveLength(3);
    expect(markers.filter(m => m.shape === "arrowUp" || m.shape === "arrowDown")).toHaveLength(2);
    expect(markers).toContainEqual(jump);
  });

  it("clearing the jump restores exactly the arrows, sorted by time", () => {
    const jump = jumpMarker(1700000300, "scroll");
    const withJump = reportMarkers(candles, fills, jump);
    const without = reportMarkers(candles, fills, null);
    expect(withJump).toHaveLength(without.length + 1);
    expect(reportMarkers(candles, fills, null)).toEqual(without);
    const times = without.map(m => Number(m.time));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});
