/**
 * Display formatting shared by the results panel and the CSV export, so a
 * stat's rendered representation has exactly one definition and the export
 * can never drift from what the panel shows. Pure strings, no DOM.
 */

export function formatFillTime(timestampSeconds: number): string {
  return new Date(timestampSeconds * 1000).toISOString().slice(0, 16).replace("T", " ");
}

export function formatMoney(value: number): string {
  return value.toFixed(2);
}

/**
 * P&L figures state their own sign: gains get an explicit "+", losses keep
 * "-", zero stays bare. Color alone must never be the only carrier of
 * gain/loss, and a reader must not have to infer the sign from context.
 */
export function formatSignedMoney(value: number): string {
  const fixed = value.toFixed(2);
  return value > 0 ? `+${fixed}` : fixed;
}

/** The color class for a P&L figure: "neg"/"pos", nothing for exactly zero. */
export function pnlSignClass(value: number): "neg" | "pos" | undefined {
  return value < 0 ? "neg" : value > 0 ? "pos" : undefined;
}

export function formatWinRate(rate: number | null): string {
  return rate === null ? "—" : `${(rate * 100).toFixed(1)}%`;
}

/**
 * Profit factor's representation contract, decided once here: null (nothing
 * to ratio) -> "—" like win rate's no-data dash; "infinite" (wins, no
 * losing trade) -> "∞"; a raw Infinity never reaches toFixed (it would
 * render the string "Infinity") and maps to the same symbols; an exact 0
 * renders as "0", not "0.00", so it cannot read as a rounded near-zero.
 * NaN falls through to toFixed and renders "NaN" — loud, never silent.
 */
export function formatProfitFactor(value: number | "infinite" | null): string {
  if (value === null) return "—";
  if (value === "infinite") return "∞";
  if (value === Infinity) return "∞";
  if (value === -Infinity) return "-∞";
  return value === 0 ? "0" : value.toFixed(2);
}
