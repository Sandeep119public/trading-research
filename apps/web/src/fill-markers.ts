import type { UTCTimestamp } from "lightweight-charts";
import type { Candle, Fill } from "@trading-research/shared";
import type { JumpPlan } from "./jump-plan";

/**
 * Chart markers for trade and jump events. Marker colors live here because a
 * canvas cannot read CSS custom properties; they mirror the styles.css tokens
 * in one place (buy ~ --success, sell ~ --danger, seek ~ --warn-strong,
 * scroll ~ --text-2) so the palette restates, never invents.
 */
export const FILL_MARKER_COLORS = { buy: "#4ade80", sell: "#f87171" } as const;
export const JUMP_MARKER_COLORS = { seek: "#fbbf24", scroll: "#e4e4e7" } as const;

export interface ChartMarker {
  time: UTCTimestamp;
  position: "aboveBar" | "belowBar";
  color: string;
  shape: "arrowUp" | "arrowDown" | "circle";
}

/** Greatest candle timestamp at or before `target`, or null before the data. */
function candleFloor(times: readonly number[], target: number): number | null {
  let low = 0;
  let high = times.length - 1;
  let best = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (times[mid] <= target) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best === -1 ? null : times[best];
}

/**
 * Arrows for fills on a chart series: buys below the bar pointing up, sells
 * above pointing down — the same green/red the fills table paints. A fill's
 * timestamp equals its candle's timestamp when stamped by ExecutionEngine,
 * but a marker time must exist on the series, so anything between candles
 * snaps down to the candle that carried it (fills before the data are
 * dropped; fills past the end snap to the last candle). Output is sorted by
 * time and stable for fills sharing a candle.
 */
export function toFillMarkers(candles: readonly Candle[], fills: readonly Fill[]): ChartMarker[] {
  if (candles.length === 0 || fills.length === 0) return [];
  const times = candles.map(c => c.timestamp);
  const markers: ChartMarker[] = [];
  for (const fill of fills) {
    const time = candleFloor(times, fill.timestamp);
    if (time === null) continue;
    const buy = fill.side === "buy";
    markers.push({
      time: time as UTCTimestamp,
      position: buy ? "belowBar" : "aboveBar",
      shape: buy ? "arrowUp" : "arrowDown",
      color: buy ? FILL_MARKER_COLORS.buy : FILL_MARKER_COLORS.sell
    });
  }
  markers.sort((a, b) => a.time - b.time);
  return markers;
}

/**
 * The landed marker for a fill-row jump, colored by the plan the row
 * promised before the click: amber when replay advanced (seek), white when
 * the charts only scrolled. One marker vocabulary for every chart the jump
 * centers.
 */
export function jumpMarker(time: number, plan: JumpPlan): ChartMarker {
  return {
    time: time as UTCTimestamp,
    position: "aboveBar",
    shape: "circle",
    color: plan === "seek+scroll" ? JUMP_MARKER_COLORS.seek : JUMP_MARKER_COLORS.scroll
  };
}
