// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { keyToAction } from "./key-to-action";

function press(
  key: string,
  target: EventTarget | null,
  mods: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {}
) {
  return keyToAction({
    key,
    ctrlKey: mods.ctrlKey ?? false,
    metaKey: mods.metaKey ?? false,
    altKey: mods.altKey ?? false,
    target
  });
}

describe("keyToAction", () => {
  it("maps Space to the play/pause toggle when no widget owns the key", () => {
    expect(press(" ", document.body)).toBe("toggle");
    expect(press(" ", null)).toBe("toggle");
  });

  it("maps ArrowRight to a single step", () => {
    expect(press("ArrowRight", document.body)).toBe("step");
  });

  it("leaves ArrowLeft alone — the engine has no back-step to call", () => {
    expect(press("ArrowLeft", document.body)).toBeNull();
  });

  it("never fires inside a text field (the mutation this pins)", () => {
    for (const tag of ["input", "select", "textarea"] as const) {
      const el = document.createElement(tag);
      expect(press(" ", el)).toBeNull();
      expect(press("ArrowRight", el)).toBeNull();
    }
  });

  it("never fires inside an editable region", () => {
    const el = document.createElement("div");
    el.setAttribute("contenteditable", "");
    expect(press(" ", el)).toBeNull();
    expect(press("ArrowRight", el)).toBeNull();
  });

  it("leaves Space to a focused button's own activation (no double-fire)", () => {
    const button = document.createElement("button");
    expect(press(" ", button)).toBeNull();
    // arrows are not natively claimed by buttons, so stepping still works
    expect(press("ArrowRight", button)).toBe("step");
  });

  it("leaves Space to a focused link as well", () => {
    const link = document.createElement("a");
    link.setAttribute("href", "https://www.tradingview.com/");
    expect(press(" ", link)).toBeNull();
    expect(press("ArrowRight", link)).toBe("step");
  });

  it("ignores modified keys (browser chords stay untouched)", () => {
    expect(press(" ", document.body, { ctrlKey: true })).toBeNull();
    expect(press("ArrowRight", document.body, { metaKey: true })).toBeNull();
    expect(press("ArrowRight", document.body, { altKey: true })).toBeNull();
  });

  it("ignores every other key", () => {
    expect(press("Enter", document.body)).toBeNull();
    expect(press("s", document.body)).toBeNull();
    expect(press("Escape", document.body)).toBeNull();
  });
});
