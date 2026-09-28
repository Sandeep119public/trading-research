/**
 * Pure viewport math for centering the chart on a jump target.
 *
 * `centeredRange` preserves the current visible span and clamps the result to
 * the data bounds. It returns null for a degenerate span so callers no-op:
 * a zero-width setVisibleRange would freeze the chart on a single candle.
 */
export interface TimeRange {
  from: number;
  to: number;
}

export function centeredRange(time: number, first: number, last: number, span: number): TimeRange | null {
  if (!(span > 0) || first > last) return null;
  const half = span / 2;
  const from = Math.min(Math.max(time - half, first), last);
  const to = Math.min(Math.max(time + half, first), last);
  if (to <= from) return null;
  return { from, to };
}

/**
 * Whether the viewport should scroll to the newest bar after data lands:
 * true only when the engine's current candle is strictly beyond the visible
 * range. Equal (already at the right edge) or inside means leave the view
 * alone — a paused user pan or a fresh jump center must never be yanked away.
 */
export function shouldFollowEngine(engineTime: number, range: TimeRange | null): boolean {
  return range !== null && engineTime > range.to;
}
