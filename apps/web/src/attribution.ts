/**
 * F32: the charting library injects its attribution anchor without a text
 * alternative, so it is a silent (unnamed) link in the tab order. The anchor
 * also lands asynchronously and can be replaced later (the replay chart's
 * first version survived a one-shot query but not the library's own DOM
 * churn), so labeling must follow every appearance — not just the first.
 */
export const ATTRIBUTION_LABEL = "TradingView charting library";

const ATTRIBUTION_SELECTOR = "a#tv-attr-logo";

/** Labels every (re)appearance of the anchor under `root`; returns a disposer. */
export function nameAttribution(root: HTMLElement): () => void {
  const apply = (): void => {
    const link = root.querySelector(ATTRIBUTION_SELECTOR);
    link?.setAttribute("aria-label", ATTRIBUTION_LABEL);
  };
  apply();
  const observer = new MutationObserver(apply);
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}
