export type ReplaySpeed = 1 | 2 | 5 | 10;

export interface ReplayClock {
  readonly speed: ReplaySpeed;
  readonly playing: boolean;
  play(): void;
  pause(): void;
  setSpeed(speed: ReplaySpeed): void;
}

export class ManualReplayClock implements ReplayClock {
  private _speed: ReplaySpeed = 1;
  private _playing = false;

  get speed(): ReplaySpeed { return this._speed; }
  get playing(): boolean { return this._playing; }

  play(): void { this._playing = true; }
  pause(): void { this._playing = false; }
  setSpeed(speed: ReplaySpeed): void { this._speed = speed; }
}
