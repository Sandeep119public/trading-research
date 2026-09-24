import type { MarketEngine, MarketState } from "@trading-research/shared";

export type ReplaySpeed = 1 | 2 | 5 | 10;
export type ReplayListener = (state: MarketState) => void;
export type ReplayPlayingListener = (playing: boolean) => void;

export class ReplayController {
  private readonly engine: MarketEngine;
  private timer: ReturnType<typeof setInterval> | null = null;
  private _speed: ReplaySpeed = 1;
  private _playing = false;
  private listener: ReplayListener | null = null;
  private readonly playingListeners = new Set<ReplayPlayingListener>();

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

  subscribePlaying(listener: ReplayPlayingListener): () => void {
    this.playingListeners.add(listener);
    return () => {
      this.playingListeners.delete(listener);
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
    this.setPlaying(true);
    this.schedule();
  }

  pause(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.setPlaying(false);
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

  private setPlaying(value: boolean): void {
    if (this._playing === value) return;
    this._playing = value;
    for (const listener of [...this.playingListeners]) listener(value);
  }
}
