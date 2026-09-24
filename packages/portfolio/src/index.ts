import type { Fill, Position } from "@trading-research/shared";

export interface PortfolioState {
  startingCapital: number;
  position: Position | null;
  realizedPnl: number;
  feesPaid: number;
  lastPrice: number | null;
  equity: number;
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be a finite number > 0`);
}

export class Portfolio {
  private startingCapital: number;
  private position: Position | null = null;
  private realizedPnl = 0;
  private feesPaid = 0;
  private lastPrice: number | null = null;

  constructor(startingCapital: number) {
    assertPositiveFinite(startingCapital, "startingCapital");
    this.startingCapital = startingCapital;
  }

  reset(startingCapital?: number): void {
    if (startingCapital !== undefined) {
      assertPositiveFinite(startingCapital, "startingCapital");
      this.startingCapital = startingCapital;
    }
    this.position = null;
    this.realizedPnl = 0;
    this.feesPaid = 0;
    this.lastPrice = null;
  }

  applyFill(fill: Fill): void {
    assertPositiveFinite(fill.quantity, "fill.quantity");
    assertPositiveFinite(fill.price, "fill.price");
    if (!Number.isFinite(fill.fee) || fill.fee < 0) throw new RangeError("fill.fee must be >= 0");
    if (fill.side !== "buy" && fill.side !== "sell") throw new RangeError("fill.side must be buy or sell");
    this.feesPaid += fill.fee;
    this.lastPrice = fill.price;
    if (this.position === null) {
      this.position = {
        side: fill.side === "buy" ? "long" : "short",
        quantity: fill.quantity,
        entryPrice: fill.price,
        entryIndex: fill.index
      };
      return;
    }
    const pos = this.position;
    const sameDirection =
      (pos.side === "long" && fill.side === "buy") || (pos.side === "short" && fill.side === "sell");
    if (sameDirection) {
      const total = pos.quantity + fill.quantity;
      pos.entryPrice = (pos.entryPrice * pos.quantity + fill.price * fill.quantity) / total;
      pos.quantity = total;
      return;
    }
    const closeQty = Math.min(fill.quantity, pos.quantity);
    const unit = pos.side === "long" ? fill.price - pos.entryPrice : pos.entryPrice - fill.price;
    this.realizedPnl += unit * closeQty;
    if (fill.quantity < pos.quantity) {
      pos.quantity -= fill.quantity;
      return;
    }
    if (fill.quantity === pos.quantity) {
      this.position = null;
      return;
    }
    const remainder = fill.quantity - pos.quantity;
    this.position = {
      side: fill.side === "buy" ? "long" : "short",
      quantity: remainder,
      entryPrice: fill.price,
      entryIndex: fill.index
    };
  }

  markToMarket(price: number): number {
    assertPositiveFinite(price, "price");
    this.lastPrice = price;
    return this.getEquity();
  }

  unrealizedAt(price: number): number {
    if (this.position === null) return 0;
    assertPositiveFinite(price, "price");
    const { side, quantity, entryPrice } = this.position;
    return side === "long" ? (price - entryPrice) * quantity : (entryPrice - price) * quantity;
  }

  getEquity(): number {
    const unrealized = this.lastPrice === null ? 0 : this.unrealizedAt(this.lastPrice);
    return this.startingCapital + this.realizedPnl - this.feesPaid + unrealized;
  }

  getState(): PortfolioState {
    return {
      startingCapital: this.startingCapital,
      position: this.position === null ? null : { ...this.position },
      realizedPnl: this.realizedPnl,
      feesPaid: this.feesPaid,
      lastPrice: this.lastPrice,
      equity: this.getEquity()
    };
  }
}
