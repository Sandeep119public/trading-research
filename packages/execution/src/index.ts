import type { Fill, FillKind, MarketState, OrderSide } from "@trading-research/shared";

export interface ExecutionConfig {
  feePerUnit: number;
  slippagePerUnit: number;
}

export type FillMode = "close" | "nextOpen";

export interface OrderIntent {
  id: string;
  side: OrderSide;
  quantity: number;
  fillMode: FillMode;
  stopLoss?: number;
  takeProfit?: number;
  reduceOnly?: boolean;
}

interface PendingOrder extends OrderIntent {
  submittedAtIndex: number;
}

interface OpenRisk {
  side: "long" | "short";
  quantity: number;
  stopLoss?: number;
  takeProfit?: number;
  entryIndex: number;
}

function assertFinitePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be a finite number > 0`);
}

function assertFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a finite number >= 0`);
}

export class ExecutionEngine {
  private readonly config: ExecutionConfig;
  private pending: PendingOrder | null = null;
  private risk: OpenRisk | null = null;
  private orderSeq = 1;
  private readonly usedIds = new Set<string>();

  constructor(config: ExecutionConfig) {
    assertFiniteNonNegative(config.feePerUnit, "feePerUnit");
    assertFiniteNonNegative(config.slippagePerUnit, "slippagePerUnit");
    this.config = { ...config };
  }

  reset(): void {
    this.pending = null;
    this.risk = null;
    this.orderSeq = 1;
    this.usedIds.clear();
  }

  nextOrderId(prefix: string): string {
    if (!prefix) throw new Error("order id prefix is required");
    return prefix + "-" + this.orderSeq++;
  }

  submit(order: OrderIntent, currentIndex: number): void {
    if (!order.id) throw new Error("Order id is required");
    if (this.usedIds.has(order.id)) throw new Error(`Duplicate order id: ${order.id}`);
    if (order.side !== "buy" && order.side !== "sell") throw new RangeError("Order side must be buy or sell");
    assertFinitePositive(order.quantity, "quantity");
    if (!Number.isInteger(currentIndex) || currentIndex < 0) throw new RangeError("currentIndex must be an integer >= 0");
    if (order.fillMode !== "close" && order.fillMode !== "nextOpen") throw new RangeError("fillMode must be close or nextOpen");
    if (order.stopLoss !== undefined) assertFinitePositive(order.stopLoss, "stopLoss");
    if (order.takeProfit !== undefined) assertFinitePositive(order.takeProfit, "takeProfit");
    if (this.pending !== null) throw new Error("ExecutionEngine supports a single pending order (V1)");
    if (this.risk === null) {
      if (order.reduceOnly === true) throw new Error("reduceOnly close requires an open position");
      if (order.stopLoss !== undefined && order.takeProfit !== undefined) {
        if (order.side === "buy" && !(order.stopLoss < order.takeProfit)) {
          throw new RangeError("Long orders require stopLoss < takeProfit");
        }
        if (order.side === "sell" && !(order.stopLoss > order.takeProfit)) {
          throw new RangeError("Short orders require stopLoss > takeProfit");
        }
      }
    } else {
      const riskSide: OrderSide = this.risk.side === "long" ? "sell" : "buy";
      if (order.side !== riskSide) throw new Error("ExecutionEngine V1 forbids pyramiding; submit the opposite side to close/flip");
      if (order.stopLoss !== undefined || order.takeProfit !== undefined) {
        throw new Error("Closing orders cannot attach stopLoss/takeProfit (V1)");
      }
      if (order.reduceOnly === true && order.quantity > this.risk.quantity) {
        throw new RangeError("reduceOnly close quantity exceeds open risk");
      }
    }
    this.usedIds.add(order.id);
    this.pending = { ...order, submittedAtIndex: currentIndex };
  }

  pendingCount(): number {
    return this.pending === null ? 0 : 1;
  }

  hasOpenRisk(): boolean {
    return this.risk !== null;
  }

  process(market: MarketState): Fill[] {
    const fills: Fill[] = [];
    const manual = this.evaluateManual(market);
    if (manual !== null) {
      fills.push(manual.fill);
      this.risk = manual.risk;
      this.pending = null;
    }
    const exit = this.evaluateStops(market);
    if (exit !== null) {
      fills.push(exit);
      this.risk = null;
    }
    return fills;
  }

  private evaluateManual(market: MarketState): { fill: Fill; risk: OpenRisk | null } | null {
    if (this.pending === null) return null;
    const order = this.pending;
    let base: number | null = null;
    if (order.fillMode === "close") {
      base = market.candle.close;
    } else if (market.index > order.submittedAtIndex) {
      base = market.candle.open;
    } else {
      return null;
    }
    const price = this.applySlippage(base, order.side);
    assertFinitePositive(price, "execution price");
    const fill: Fill = {
      orderId: order.id,
      side: order.side,
      quantity: order.quantity,
      price,
      index: market.index,
      timestamp: market.candle.timestamp,
      fee: order.quantity * this.config.feePerUnit,
      kind: "market"
    };
    if (this.risk === null) {
      return {
        fill,
        risk: {
          side: order.side === "buy" ? "long" : "short",
          quantity: order.quantity,
          stopLoss: order.stopLoss,
          takeProfit: order.takeProfit,
          entryIndex: market.index
        }
      };
    }
    const risk = this.risk;
    if (order.quantity < risk.quantity) {
      return { fill, risk: { ...risk, quantity: risk.quantity - order.quantity } };
    }
    if (order.quantity === risk.quantity) {
      return { fill, risk: null };
    }
    const remainder = order.quantity - risk.quantity;
    return {
      fill,
      risk: {
        side: order.side === "buy" ? "long" : "short",
        quantity: remainder,
        stopLoss: undefined,
        takeProfit: undefined,
        entryIndex: market.index
      }
    };
  }

  private evaluateStops(market: MarketState): Fill | null {
    if (this.risk === null || market.index <= this.risk.entryIndex) return null;
    const { side, quantity, stopLoss, takeProfit } = this.risk;
    if (stopLoss === undefined && takeProfit === undefined) return null;
    const { high, low } = market.candle;
    let kind: FillKind | null = null;
    let level: number | null = null;
    if (side === "long") {
      const slHit = stopLoss !== undefined && low <= stopLoss;
      const tpHit = takeProfit !== undefined && high > takeProfit;
      if (slHit) {
        kind = "stop";
        level = stopLoss as number;
      } else if (tpHit) {
        kind = "take";
        level = takeProfit as number;
      }
    } else {
      const slHit = stopLoss !== undefined && high >= stopLoss;
      const tpHit = takeProfit !== undefined && low < takeProfit;
      if (slHit) {
        kind = "stop";
        level = stopLoss as number;
      } else if (tpHit) {
        kind = "take";
        level = takeProfit as number;
      }
    }
    if (kind === null || level === null) return null;
    const exitSide: OrderSide = side === "long" ? "sell" : "buy";
    const price = this.applySlippage(level, exitSide);
    return {
      orderId: `${side}-protective@${market.index}`,
      side: exitSide,
      quantity,
      price,
      index: market.index,
      timestamp: market.candle.timestamp,
      fee: quantity * this.config.feePerUnit,
      kind
    };
  }

  private applySlippage(price: number, side: OrderSide): number {
    if (side === "buy") return price + this.config.slippagePerUnit;
    return price - this.config.slippagePerUnit;
  }
}
