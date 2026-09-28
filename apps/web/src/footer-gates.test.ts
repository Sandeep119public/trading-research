import { describe, expect, it } from "vitest";
import { footerGates } from "./footer-gates";

describe("footerGates", () => {
  it("disables only Close while flat and loaded with a valid draft", () => {
    const g = footerGates({ loaded: true, tradeValid: true, hasPosition: false });
    expect(g).toEqual({ reset: false, play: false, step: false, buy: false, sell: false, close: true });
  });

  it("disables Buy and Sell while a position is open", () => {
    const g = footerGates({ loaded: true, tradeValid: true, hasPosition: true });
    expect(g).toEqual({ reset: false, play: false, step: false, buy: true, sell: true, close: false });
  });

  it("keeps Close enabled with an open position even when the draft is invalid (exit trap)", () => {
    const g = footerGates({ loaded: true, tradeValid: false, hasPosition: true });
    expect(g.close).toBe(false);
    expect(g.buy).toBe(true);
    expect(g.sell).toBe(true);
  });

  it("disables every action while flat with an invalid draft", () => {
    const g = footerGates({ loaded: true, tradeValid: false, hasPosition: false });
    expect(g).toEqual({ reset: false, play: false, step: false, buy: true, sell: true, close: true });
  });

  it("disables everything while no data is loaded", () => {
    const g = footerGates({ loaded: false, tradeValid: true, hasPosition: false });
    expect(g).toEqual({ reset: true, play: true, step: true, buy: true, sell: true, close: true });
  });
});
