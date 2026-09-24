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
