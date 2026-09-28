import { describe, expect, it } from "vitest";
import { replayCaption } from "./chart-captions";

// Phase 3 F26/F30: the chart must say where playback sits when it is NOT
// moving — a step-0 chart and an end-of-data chart both otherwise read as
// "nothing works" / "manual pause". The captions are a pure read of state.
describe("replayCaption", () => {
  it("invites Play only at the start of data while paused", () => {
    expect(replayCaption({ index: 0, playing: false, finished: false })).toBe(
      "At start of data — press Play"
    );
    expect(replayCaption({ index: 0, playing: true, finished: false })).toBeNull();
  });

  it("announces the end of data when playback stopped at the last candle", () => {
    expect(replayCaption({ index: 100, playing: false, finished: true })).toBe("End of data");
    expect(replayCaption({ index: 100, playing: true, finished: true })).toBeNull();
  });

  it("says nothing mid-session or before any data arrived", () => {
    expect(replayCaption({ index: 42, playing: false, finished: false })).toBeNull();
    expect(replayCaption({ index: null, playing: false, finished: false })).toBeNull();
  });
});
