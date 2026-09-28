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
  private seeking = false;
  private seekAborted = false;

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

  /**
   * Step forward until the engine's current candle reaches `timestamp` or the
   * data runs out, then return the state replay is at. Pauses first. Never
   * moves backward: a target at or behind the current time is a no-op, and a
   * target past the last candle stops at the last candle.
   *
   * Every intermediate state goes through step(), so seek-to-X is exactly N
   * individual steps — same listener emissions, same execution/portfolio
   * sync — with no second time-advancement mechanism. A listener that calls
   * pause() mid-seek (the way the UI reacts to a failure: pause + banner)
   * aborts the loop at that candle instead of marching past a broken one.
   */
  fastForwardTo(timestamp: number): MarketState {
    this.pause();
    this.seeking = true;
    this.seekAborted = false;
    try {
      while (
        !this.seekAborted &&
        !this.engine.finished() &&
        this.engine.getState().candle.timestamp < timestamp
      ) {
        this.step();
      }
      return this.engine.getState();
    } finally {
      this.seeking = false;
      this.seekAborted = false;
    }
  }

  play(): void {
    if (this._playing || this.engine.finished()) return;
    this.setPlaying(true);
    this.schedule();
  }

  pause(): void {
    // An external pause during a fast-forward (the failure path's existing
    // "pause + Replay stopped banner" reaction) must stop the seek loop too,
    // not just the play timer. The seek's own initial pause runs before the
    // loop flags are set, so it never self-aborts.
    if (this.seeking) this.seekAborted = true;
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
