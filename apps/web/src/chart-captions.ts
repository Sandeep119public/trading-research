/**
 * What the chart says when playback is not moving. A paused step-0 chart and
 * a paused end-of-data chart otherwise look like a broken or manually paused
 * session; the caption names the state instead. Pure: reads the moment, owns
 * no timing.
 */
export interface ReplayMoment {
  /** MarketState.index, or null before any data arrived. */
  index: number | null;
  playing: boolean;
  finished: boolean;
}

export function replayCaption(moment: ReplayMoment): string | null {
  if (moment.playing || moment.index === null) return null;
  if (moment.index === 0) return "At start of data — press Play";
  if (moment.finished) return "End of data";
  return null;
}
