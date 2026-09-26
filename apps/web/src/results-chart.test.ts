import { describe, expect, it, vi } from "vitest";
import type { IChartApi } from "lightweight-charts";
import type { Candle } from "@trading-research/shared";
import { populateEquityChart } from "./results-chart";

function candle(timestamp: number, close: number): Candle {
  return { timestamp, open: close, high: close + 1, low: close - 1, close, volume: 10 };
}

function fakeChart() {
  const setData = vi.fn();
  const addSeries = vi.fn(() => ({ setData }));
  const chart = { addSeries } as unknown as Pick<IChartApi, "addSeries">;
  return { chart, addSeries, setData };
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
