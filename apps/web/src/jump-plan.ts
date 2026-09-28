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

export interface JumpLegendEntry {
  plan: JumpPlan;
  /** The exact class FillTable paints rows of this plan with — the legend's
   * swatch reuses it, so caption and rows cannot drift apart. */
  rowClass: string;
  text: string;
}

/**
 * The caption that decodes the row colors (F23): rows differ only by
 * amber(advance)/white(scroll) with no legend, so the semantics of a click
 * were invisible. One entry per JumpPlan, selected from the same definition
 * the rows render from.
 */
export function jumpLegend(): JumpLegendEntry[] {
  return [
    { plan: "seek+scroll", rowClass: "fill-jump--seek", text: "Amber time advances replay to this fill" },
    { plan: "scroll", rowClass: "fill-jump--view", text: "White time scrolls the charts only — replay untouched" }
  ];
}
