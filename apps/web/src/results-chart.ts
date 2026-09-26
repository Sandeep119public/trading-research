import { LineSeries, createChart, type IChartApi } from "lightweight-charts";
import type { Candle } from "@trading-research/shared";
import { toEquityPoints } from "./chart-points";

/** Same theme as the replay chart: a report view belongs to the same app. */
const REPORT_OPTIONS = {
  layout: { background: { color: "#09090b" }, textColor: "#a1a1aa" },
  grid: { vertLines: { color: "#18181b" }, horzLines: { color: "#18181b" } },
  rightPriceScale: { borderColor: "#27272a" },
  timeScale: { borderColor: "#27272a", timeVisible: true }
};

/**
 * Put the equity curve on an existing chart. The chart is the results
 * section's own instance — never the replay chart — so backtest-derived
 * series can never appear on the canvas the replay position is stepping
 * through. Separated from mounting so tests can assert the series actually
 * receives the curve without a DOM.
 */
export function populateEquityChart(
  chart: Pick<IChartApi, "addSeries">,
  candles: readonly Candle[],
  equityCurve: readonly number[]
): void {
  const equity = chart.addSeries(LineSeries, {
    color: "#60a5fa",
    lineWidth: 2,
    priceFormat: { type: "price", precision: 2, minMove: 0.01 }
  });
  equity.setData(toEquityPoints(candles, equityCurve));
}

/**
 * Create the results section's chart with its equity curve sized to the
 * container. Returns a disposer; the caller owns the lifecycle (the effect
 * that mounts on a new result). Mirrors the replay chart's resize handling.
 */
export function mountResultsChart(
  container: HTMLElement,
  candles: readonly Candle[],
  equityCurve: readonly number[]
): () => void {
  const chart = createChart(container, {
    ...REPORT_OPTIONS,
    width: container.clientWidth,
    height: container.clientHeight
  });
  populateEquityChart(chart, candles, equityCurve);
  const resize = () => chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  return () => {
    observer.disconnect();
    chart.remove();
  };
}
