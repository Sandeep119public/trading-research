/**
 * Which kind of jump a fill-row click means: "scroll" when the fill's time is
 * at or behind replay time T (viewport only, the engine is untouched) versus
 * "seek+scroll" when it is ahead of T — or when T is unknown, the
 * conservative reading. Pure so the panel can render the promise (the
 * affordance's look) and App can perform the action from the one definition:
 * what the row says before the click is exactly what the click does.
 *
 * A target past the end of the data is still a "seek": fastForwardTo stops
 * cleanly at the last candle.
 */
export type JumpPlan = "scroll" | "seek+scroll";

export function planJump(replayTime: number | null, fillTime: number): JumpPlan {
  return replayTime === null || fillTime > replayTime ? "seek+scroll" : "scroll";
}
