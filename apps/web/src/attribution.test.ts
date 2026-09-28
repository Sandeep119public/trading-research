// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { ATTRIBUTION_LABEL, nameAttribution } from "./attribution";

describe("nameAttribution", () => {
  it("labels an anchor that already exists at call time", () => {
    const root = document.createElement("div");
    root.innerHTML = '<a id="tv-attr-logo" href="https://www.tradingview.com/"></a>';
    nameAttribution(root);
    expect(root.querySelector("a#tv-attr-logo")?.getAttribute("aria-label")).toBe(ATTRIBUTION_LABEL);
  });

  it("labels an anchor that appears after the call (the replay-chart timing)", async () => {
    const root = document.createElement("div");
    nameAttribution(root);
    expect(root.querySelector("a#tv-attr-logo")).toBeNull();
    const anchor = document.createElement("a");
    anchor.id = "tv-attr-logo";
    anchor.href = "https://www.tradingview.com/";
    root.appendChild(anchor);
    await Promise.resolve(); // MutationObserver callbacks are microtasks
    expect(anchor.getAttribute("aria-label")).toBe(ATTRIBUTION_LABEL);
  });

  it("keeps watching past unrelated DOM additions until the anchor lands", async () => {
    const root = document.createElement("div");
    nameAttribution(root);
    root.appendChild(document.createElement("canvas"));
    await Promise.resolve();
    expect(root.querySelector("a#tv-attr-logo")).toBeNull();
    const anchor = document.createElement("a");
    anchor.id = "tv-attr-logo";
    root.appendChild(anchor);
    await Promise.resolve();
    expect(anchor.getAttribute("aria-label")).toBe(ATTRIBUTION_LABEL);
  });

  it("relabels a replacement anchor (the library's own DOM churn)", async () => {
    const root = document.createElement("div");
    const first = document.createElement("a");
    first.id = "tv-attr-logo";
    root.appendChild(first);
    const stop = nameAttribution(root);
    expect(first.getAttribute("aria-label")).toBe(ATTRIBUTION_LABEL);
    first.remove();
    const second = document.createElement("a");
    second.id = "tv-attr-logo";
    root.appendChild(second);
    await Promise.resolve();
    expect(second.getAttribute("aria-label")).toBe(ATTRIBUTION_LABEL);
    stop();
    second.remove();
    const third = document.createElement("a");
    third.id = "tv-attr-logo";
    root.appendChild(third);
    await Promise.resolve();
    expect(third.getAttribute("aria-label")).toBeNull(); // disposed
  });
});
