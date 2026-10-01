import { vi } from "vitest";

/**
 * Shared setup for tests that mount the full App: synthetic klines behind a
 * stubbed fetch, a polling waiter, and a ResizeObserver stand-in. The
 * lightweight-charts mock itself must stay file-local (vi.mock is per test
 * file), so each suite declares that part and imports the rest from here.
 */

export const STEP_MS = 300_000;

function candleRow(openTime: number, close: number): number[] {
  return [openTime, close, close + 1, close - 1, close, 10, openTime + STEP_MS - 1];
}

/** Grid-aligned rows with an up/down/up shape: three fills for the sample strategy. */
export function buildRows(nowMs: number): number[][] {
  const rows: number[][] = [];
  const first = Math.ceil((nowMs - 7 * 86_400_000) / STEP_MS) * STEP_MS;
  let i = 0;
  for (let t = first; t <= nowMs + STEP_MS; t += STEP_MS, i++) {
    let close: number;
    if (i < 1500) close = 100;
    else if (i < 1700) close = 100 + (i - 1500) * 0.15;
    else if (i < 1900) close = 130 - (i - 1700) * 0.2;
    else close = 90 + (i - 1900) * 0.3;
    rows.push(candleRow(t, close));
  }
  return rows;
}

/** Answer every klines page from the generated rows, Binance-paging style. */
export function stubKlinesFetch(rows: number[][]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = new URL(String(input));
      const start = Number(url.searchParams.get("start"));
      const end = Number(url.searchParams.get("end"));
      const limit = Number(url.searchParams.get("limit") ?? "1000");
      const page = rows.filter(r => r[0] >= start && r[0] <= end).slice(0, limit);
      return { ok: true, status: 200, json: async () => page };
    })
  );
}

export function ensureResizeObserver(): void {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
}

export async function waitFor(label: string, fn: () => boolean): Promise<void> {
  for (let i = 0; i < 300; i++) {
    if (fn()) return;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error(`timeout waiting for ${label}`);
}
