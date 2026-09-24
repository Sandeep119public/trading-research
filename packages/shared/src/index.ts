export type Timestamp = number;

export interface Candle {
  timestamp: Timestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketState {
  candle: Candle;
  index: number;
  visibleCandles: readonly Candle[];
}

export interface MarketEvent {
  type: "bar";
  state: MarketState;
}

export type OrderSide = "buy" | "sell";

export interface MarketOrder {
  id: string;
  side: OrderSide;
  quantity: number;
  createdAtIndex: number;
}

export interface Position {
  side: "long" | "short";
  quantity: number;
  entryPrice: number;
  entryIndex: number;
}

export interface MarketEngine {
  reset(startIndex: number): void;
  step(): MarketEvent;
  getState(): MarketState;
  finished(): boolean;
}
