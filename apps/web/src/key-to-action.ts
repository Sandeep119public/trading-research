/**
 * What a playback key means — pure key-to-intent mapping, no side effects.
 *
 * The adapter owns two rules the wiring must not re-decide:
 * 1. Fields own their keys. A focused input/select/textarea/editable region
 *    swallows every shortcut, so typing a fee never steps the replay.
 * 2. Native controls own Space. A focused button activates Space itself (on
 *    keyup); handling it here would toggle twice. Arrows are not natively
 *    claimed by buttons or links, so they still step.
 *
 * ArrowLeft maps to nothing on purpose: stepping backward would need an
 * engine-owned back-step (rewinding MarketEngine plus the execution and
 * portfolio state derived from it), which does not exist and must not be
 * invented in the UI.
 */
export type ShortcutAction = "toggle" | "step";

export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
}

const FIELD_TAGS = new Set(["INPUT", "SELECT", "TEXTAREA"]);

function ownsItsKeys(element: HTMLElement): boolean {
  if (FIELD_TAGS.has(element.tagName)) return true;
  if (element.isContentEditable) return true;
  const editable = element.getAttribute("contenteditable");
  return editable !== null && editable !== "false";
}

export function keyToAction(event: KeyEventLike): ShortcutAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const element = event.target instanceof HTMLElement ? event.target : null;
  if (element !== null && ownsItsKeys(element)) return null;
  if (event.key === " ") {
    if (element !== null && (element.tagName === "BUTTON" || element.tagName === "A")) return null;
    return "toggle";
  }
  if (event.key === "ArrowRight") return "step";
  return null;
}
