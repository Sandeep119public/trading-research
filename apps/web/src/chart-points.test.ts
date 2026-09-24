import { describe, expect, it } from "vitest";
import type { Candle } from "@trading-research/shared";
import { toChartPoints } from "./chart-points";

function candle(timestamp: number, open: number, high: number, low: number, close: number, volume: number): Candle {
  return { timestamp, open, high, low, close, volume };
}

describe("toChartPoints", () => {
  it("maps empty input to empty output", () => {
    expect(toChartPoints([])).toEqual({ candles: [], volumes: [] });
  });

  it("maps one candle to one candle point and one volume point", () => {
    const points = toChartPoints([candle(1700000000, 100, 101, 99, 100.5, 10)]);
    expect(points.candles).toEqual([{ time: 1700000000, open: 100, high: 101, low: 99, close: 100.5 }]);
    expect(points.volumes).toEqual([{ time: 1700000000, value: 10 }]);
  });

  it("preserves chronological order across multiple candles", () => {
    const points = toChartPoints([
      candle(1700000000, 100, 101, 99, 100.5, 10),
      candle(1700000300, 100.5, 102, 100, 101.5, 12),
      candle(1700000600, 101.5, 103, 101, 102.5, 14)
    ]);
    expect(points.candles.map(p => p.time)).toEqual([1700000000, 1700000300, 1700000600]);
    expect(points.volumes.map(p => p.time)).toEqual([1700000000, 1700000300, 1700000600]);
    expect(points.candles[2]).toMatchObject({ open: 101.5, high: 103, low: 101, close: 102.5 });
    expect(points.volumes[2]).toMatchObject({ value: 14 });
  });

  it("derives every output point from its input candle only", () => {
    const input = [
      candle(1700000000, 100, 101, 99, 100.5, 10),
      candle(1700000300, 100.5, 102, 100, 101.5, 12)
    ];
    const points = toChartPoints(input);
    expect(points.candles).toHaveLength(input.length);
    expect(points.volumes).toHaveLength(input.length);
    input.forEach((c, i) => {
      expect(points.candles[i]).toEqual({ time: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close });
      expect(points.volumes[i]).toEqual({ time: c.timestamp, value: c.volume });
    });
  });
});
