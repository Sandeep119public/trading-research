import type { Candle, MarketEngine, MarketEvent, MarketState } from "@trading-research/shared";

export class CandleMarketEngine implements MarketEngine {
  private readonly candles: readonly Candle[];
  private index = -1;

  constructor(candles: readonly Candle[]) {
    if (candles.length === 0) throw new Error("MarketEngine requires at least one candle");
    for (let i = 1; i < candles.length; i++) {
      if (candles[i].timestamp <= candles[i - 1].timestamp) {
        throw new Error("Candles must have strictly increasing timestamps");
      }
    }
    // Defensive copy plus freeze: consumers receive live references through
    // getState(), so the stored dataset must be immune to outside mutation.
    this.candles = candles.map(c => Object.freeze({ ...c }) as Candle);
  }

  reset(startIndex: number): void {
    if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= this.candles.length) {
      throw new RangeError("startIndex is outside the dataset");
    }
    this.index = startIndex - 1;
  }

  step(): MarketEvent {
    if (this.finished()) throw new Error("Cannot step: market engine is finished");
    this.index += 1;
    return { type: "bar", state: this.getState() };
  }

  getState(): MarketState {
    if (this.index < 0 || this.index >= this.candles.length) {
      throw new Error("MarketEngine has no current candle");
    }
    return {
      candle: this.candles[this.index],
      index: this.index,
      visibleCandles: this.candles.slice(0, this.index + 1)
    };
  }

  finished(): boolean {
    return this.index >= this.candles.length - 1;
  }
}
