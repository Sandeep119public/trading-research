import type { MarketEngine, MarketState } from "@trading-research/shared";

export type ReplaySpeed = 1 | 2 | 5 | 10;
export type ReplayListener = (state: MarketState) => void;

export class ReplayController {
  private readonly engine: MarketEngine;
  private timer: ReturnType<typeof setInterval> | null = null;
  private _speed: ReplaySpeed = 1;
  private _playing = false;
  private listener: ReplayListener | null = null;

  constructor(engine: MarketEngine) {
    this.engine = engine;
  }

  get speed(): ReplaySpeed { return this._speed; }
  get playing(): boolean { return this._playing; }

  subscribe(listener: ReplayListener): () => void {
    this.listener = listener;
    return () => {
      if (this.listener === listener) this.listener = null;
    };
  }

  reset(startIndex: number): void {
    this.pause();
    this.engine.reset(startIndex);
    this.step();
  }

  step(): MarketState | null {
    if (this.engine.finished()) return null;
    const state = this.engine.step().state;
    this.listener?.(state);
    if (this.engine.finished()) this.pause();
    return state;
  }

  play(): void {
    if (this._playing || this.engine.finished()) return;
    this._playing = true;
    this.schedule();
  }

  pause(): void {
    this._playing = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  setSpeed(speed: ReplaySpeed): void {
    this._speed = speed;
    if (this._playing) {
      this.schedule();
    }
  }

  private schedule(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = setInterval(() => this.step(), 1000 / this._speed);
  }
}
