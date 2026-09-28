import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const rootBlock = css.match(/:root\s*{([^}]*)}/)?.[1] ?? "";
const tokens = new Map<string, string>();
for (const m of rootBlock.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens.set(m[1], m[2].trim());

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const channel = (i: number): number => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function contrast(fg: string, bg: string): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

function tok(name: string): string {
  const v = tokens.get(name);
  if (v === undefined) throw new Error(`missing token ${name}`);
  expect(v, `token ${name} must be a hex color`).toMatch(/^#[0-9a-fA-F]{6}$/);
  return v;
}

describe("design tokens", () => {
  it("defines the Phase 1 token set in :root", () => {
    for (const name of [
      "--bg", "--surface", "--surface-hover", "--btn-bg", "--btn-bg-hover",
      "--border", "--border-strong",
      "--text", "--text-2", "--text-3", "--label", "--muted",
      "--disabled-bg", "--disabled-text", "--disabled-border",
      "--accent", "--accent-hover", "--on-accent",
      "--success", "--danger", "--warn", "--warn-strong",
      "--danger-bg", "--danger-border", "--danger-text",
      "--radius", "--radius-sm", "--gap",
      "--focus-color", "--focus-width", "--focus-offset",
    ]) {
      expect(tokens.has(name), `missing token ${name}`).toBe(true);
    }
    expect(tokens.get("--focus-width")).toMatch(/^\d+px$/);
    expect(tokens.get("--focus-offset")).toMatch(/^\d+px$/);
  });

  it("migrates every hardcoded color out of rules (hex only lives in :root)", () => {
    const outsideRoot = css.replace(/:root\s*{[^}]*}/, "");
    expect(outsideRoot.match(/#[0-9a-fA-F]{6}/g) ?? []).toEqual([]);
  });

  it("replaces opacity-based disabled styling with explicit disabled tokens", () => {
    expect(css).not.toMatch(/button:disabled\s*{[^}]*opacity/);
    expect(css).toMatch(/button:disabled\s*{[^}]*var\(--disabled-text\)[^}]*}/);
    expect(css).toMatch(/button:disabled\s*{[^}]*var\(--disabled-bg\)[^}]*}/);
    expect(css).toMatch(/button:disabled\s*{[^}]*var\(--disabled-border\)[^}]*}/);
  });

  it("defines the button variant classes", () => {
    for (const cls of ["btn-primary", "btn-secondary", "btn-ghost", "btn-danger"]) {
      expect(css, `missing .${cls}`).toMatch(new RegExp(`\\.${cls}\\s*{`));
    }
  });

  it("has one tokenized :focus-visible ring for every interactive element kind", () => {
    expect(css).toMatch(
      /:focus-visible\s*{[^}]*outline:var\(--focus-width\) solid var\(--focus-color\);outline-offset:var\(--focus-offset\)/,
    );
    for (const sel of ["button:focus-visible", "select:focus-visible", "input:focus-visible", "a:focus-visible"]) {
      expect(css, `missing ${sel}`).toContain(sel);
    }
    expect(css).not.toMatch(/select:focus\s*{[^}]*outline:1px/);
    expect(css).not.toMatch(/input:focus\s*{[^}]*outline:1px/);
  });

  it("applies tabular-nums to the remaining number-bearing classes", () => {
    expect(css).toMatch(/\.results-meta\s*{[^}]*tabular-nums/);
    expect(css).toMatch(/\.symbol\s*{[^}]*tabular-nums/);
  });
});

describe("WCAG contrast (text >= 4.5, focus ring >= 3.0)", () => {
  const textPairs: ReadonlyArray<readonly [string, string]> = [
    // F1/F3: every muted and disabled text combination on every background it sits on
    ["--muted", "--bg"], ["--muted", "--surface"], ["--muted", "--surface-hover"], ["--muted", "--btn-bg"],
    ["--disabled-text", "--disabled-bg"], ["--disabled-text", "--surface"],
    // surrounding text classes, pinned so a token edit cannot silently regress them
    ["--text", "--bg"], ["--text", "--surface"],
    ["--text-2", "--btn-bg"], ["--text-2", "--surface"],
    ["--text-3", "--surface"],
    ["--label", "--surface"], ["--label", "--bg"], ["--label", "--btn-bg-hover"], ["--label", "--danger-bg"],
    ["--on-accent", "--accent"], ["--on-accent", "--accent-hover"],
    ["--bg", "--text-2"], // active speed chip (inverted)
    ["--success", "--surface"], ["--danger", "--surface"], ["--warn", "--surface"], ["--warn-strong", "--surface"],
    ["--danger-text", "--danger-bg"], ["--danger-text", "--danger-border"],
  ];
  const ringPairs: ReadonlyArray<readonly [string, string]> = [
    ["--focus-color", "--bg"], ["--focus-color", "--surface"], ["--focus-color", "--btn-bg"],
  ];

  it.each(textPairs)("meets AA: %s on %s", (fg, bg) => {
    const ratio = contrast(tok(fg), tok(bg));
    console.log(`[contrast] ${fg} on ${bg} = ${ratio.toFixed(2)}`);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it.each(ringPairs)("non-text UI contrast >= 3.0: %s on %s", (fg, bg) => {
    const ratio = contrast(tok(fg), tok(bg));
    console.log(`[contrast] ${fg} on ${bg} = ${ratio.toFixed(2)}`);
    expect(ratio).toBeGreaterThanOrEqual(3);
  });
});
