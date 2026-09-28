/**
 * Which footer buttons are disabled, from the three facts that gate them.
 *
 * Close is deliberately NOT gated on draft validity: closing an open position
 * carries no draft-derived values (the intent uses the live position's own
 * quantity, and the ExecutionEngine runs on its last valid config), so an
 * invalid Size edit must never trap a trader in a position. Buy and Sell stay
 * gated — opening with a bad size must not reach an engine.
 */
export interface FooterGateInput {
  loaded: boolean;
  tradeValid: boolean;
  hasPosition: boolean;
}

export interface FooterGates {
  reset: boolean;
  play: boolean;
  step: boolean;
  buy: boolean;
  sell: boolean;
  close: boolean;
}

export function footerGates(input: FooterGateInput): FooterGates {
  const blocked = !input.loaded || !input.tradeValid;
  return {
    reset: !input.loaded,
    play: !input.loaded,
    step: !input.loaded,
    buy: blocked || input.hasPosition,
    sell: blocked || input.hasPosition,
    close: !input.loaded || !input.hasPosition
  };
}
