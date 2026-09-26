import type { UTCTimestamp } from "lightweight-charts";
import type { Candle } from "@trading-research/shared";

export interface CandlestickPoint {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface VolumePoint {
  time: UTCTimestamp;
  value: number;
}

export interface ChartPoints {
  candles: CandlestickPoint[];
  volumes: VolumePoint[];
}

/**
 * Pure adapter from engine-visible candles to chart-ready points. The only
 * input is MarketState.visibleCandles, so the chart can never observe a
 * candle the engine has not exposed. No React, no engine, no DOM, no clock.
 */
export function toChartPoints(visibleCandles: readonly Candle[]): ChartPoints {
  return {
    candles: visibleCandles.map(c => ({
      time: c.timestamp as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close
    })),
    volumes: visibleCandles.map(c => ({
      time: c.timestamp as UTCTimestamp,
      value: c.volume
    }))
  };
}

export interface EquityPoint {
  time: UTCTimestamp;
  value: number;
}

/**
 * Pure adapter from a BacktestResult equity curve to chart-ready points. The
 * curve is produced by BacktestDriver with exactly one entry per stepped bar,
 * so it pairs 1:1 with the run's candles; a length mismatch means the two
 * inputs come from different runs and is rejected rather than silently
 * truncated to a chart that lies about its timeline.
 */
export function toEquityPoints(candles: readonly Candle[], equityCurve: readonly number[]): EquityPoint[] {
  if (candles.length !== equityCurve.length) {
    throw new RangeError("candles and equityCurve must have the same length");
  }
  return equityCurve.map((value, i) => ({ time: candles[i].timestamp as UTCTimestamp, value }));
}
