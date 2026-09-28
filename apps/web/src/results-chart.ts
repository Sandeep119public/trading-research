import {
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi
} from "lightweight-charts";
import { nameAttribution } from "./attribution";
import type { Candle, Fill } from "@trading-research/shared";
import { toEquityPoints } from "./chart-points";
import { toFillMarkers, type ChartMarker } from "./fill-markers";

/** Same theme as the replay chart: a report view belongs to the same app.
 * The price scale reserves room for its widest label and the time scale a few
 * bars past the end, so axis labels are never clipped by the panel edge. */
const REPORT_OPTIONS = {
  layout: { background: { color: "#09090b" }, textColor: "#a1a1aa" },
  grid: { vertLines: { color: "#18181b" }, horzLines: { color: "#18181b" } },
  rightPriceScale: { borderColor: "#27272a", minimumWidth: 60 },
  timeScale: { borderColor: "#27272a", timeVisible: true, rightOffset: 4 }
};

/**
 * The value the equity chart's axis tag shows: the curve's final point — the
 * same number the FINAL EQUITY stat prints (BacktestResult.finalEquity is the
 * curve's last entry). The built-in last-value label tracks the last VISIBLE
 * value instead, which after a fill-row jump contradicted the card; the tag
 * is pinned to this value so the two can never disagree. Rejects an empty
 * curve rather than inventing a tag.
 */
export function equityAxisTag(equityCurve: readonly number[]): number {
  if (equityCurve.length === 0) throw new RangeError("equity curve is empty");
  return equityCurve[equityCurve.length - 1];
}

/**
 * Put the equity curve on an existing chart. The chart is the results
 * section's own instance — never the replay chart — so backtest-derived
 * series can never appear on the canvas the replay position is stepping
 * through. Returns the series so the caller can attach markers (jump landings).
 * Separated from mounting so tests can assert the series actually receives
 * the curve, and the pinned tag options, without a DOM.
 */
export function populateEquityChart(
  chart: Pick<IChartApi, "addSeries">,
  candles: readonly Candle[],
  equityCurve: readonly number[]
): ISeriesApi<"Line"> {
  const tag = equityAxisTag(equityCurve);
  let curveMin = Infinity;
  let curveMax = -Infinity;
  for (const value of equityCurve) {
    if (value < curveMin) curveMin = value;
    if (value > curveMax) curveMax = value;
  }
  const equity = chart.addSeries(LineSeries, {
    color: "#60a5fa",
    lineWidth: 2,
    priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    // F22: the scroll-dependent label contradicts the FINAL EQUITY card after
    // a jump scrolls the report chart. Pin the tag with a price line at the
    // series' final value; the crosshair still carries hovered values.
    lastValueVisible: false,
    priceLineVisible: false,
    // The y-range spans the whole curve at every window: the pinned final
    // value stays visible when a jump scrolls it out of the local range, and
    // panning the x-axis never rescales y under the reader.
    autoscaleInfoProvider: () => ({
      priceRange: { minValue: Math.min(curveMin, tag), maxValue: Math.max(curveMax, tag) }
    })
  });
  equity.setData(toEquityPoints(candles, equityCurve));
  equity.createPriceLine({
    price: tag,
    color: "#60a5fa",
    lineWidth: 1,
    lineStyle: LineStyle.Dashed,
    axisLabelVisible: true,
    title: "FINAL"
  });
  return equity;
}

/**
 * The report chart's marker set: the fill arrows (a fixed part of the
 * report — buy/sell arrows next to the candles they filled) plus the current
 * jump-landing marker, if any. Sorting keeps every marker plottable; a
 * replacement jump marker can never drop the report's own arrows — that
 * invariant is pinned by test.
 */
export function reportMarkers(
  candles: readonly Candle[],
  fills: readonly Fill[],
  jump: ChartMarker | null
): ChartMarker[] {
  const markers: ChartMarker[] = [...toFillMarkers(candles, fills)];
  if (jump !== null) markers.push(jump);
  markers.sort((a, b) => a.time - b.time);
  return markers;
}

/** The mounted results chart: the caller can move its time scale (a fill-row
 * jump scrolls every chart), set or clear the jump-landing marker without
 * touching the fill arrows, and must run the disposer on unmount. */
export interface MountedResultsChart {
  chart: IChartApi;
  setJumpMarker: (marker: ChartMarker | null) => void;
  dispose: () => void;
}

/**
 * Create the results section's chart with its equity curve sized to the
 * container. Returns the chart, a jump-marker setter, and a disposer; the
 * caller owns the lifecycle (the effect that mounts on a new result). Mirrors
 * the replay chart's resize handling.
 */
export function mountResultsChart(
  container: HTMLElement,
  candles: readonly Candle[],
  fills: readonly Fill[],
  equityCurve: readonly number[]
): MountedResultsChart {
  const chart = createChart(container, {
    ...REPORT_OPTIONS,
    width: container.clientWidth,
    height: container.clientHeight
  });
  const stopAttribution = nameAttribution(container);
  const equity = populateEquityChart(chart, candles, equityCurve);
  let jump: ChartMarker | null = null;
  const markers = createSeriesMarkers(equity, reportMarkers(candles, fills, null));
  const resize = () => chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  return {
    chart,
    setJumpMarker: marker => {
      jump = marker;
      markers.setMarkers(reportMarkers(candles, fills, jump));
    },
    dispose: () => {
      observer.disconnect();
      stopAttribution();
      chart.remove();
    }
  };
}
