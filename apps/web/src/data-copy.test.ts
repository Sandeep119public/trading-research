import { describe, expect, it } from "vitest";
import { dataErrorDetail, friendlyDataError } from "./data-copy";

// Phase 2 F18: the top-level message a user sees must be actionable English,
// not the browser's raw "Failed to fetch". The http layer already prefixes
// unreachable errors with its own sentence and glues the transport detail on
// the end — split that apart so the UI can show the sentence everywhere and
// keep the transport detail as secondary copy in the Data Manager only.
describe("friendlyDataError", () => {
  it("extracts the sentence from an unreachable-service error", () => {
    expect(friendlyDataError("Data service unreachable: Failed to fetch")).toBe(
      "Data service unreachable."
    );
  });

  it("keeps specific, already-friendly messages intact", () => {
    expect(friendlyDataError("Data service timed out after 10000ms")).toBe(
      "Data service timed out after 10000ms"
    );
    expect(friendlyDataError("Data service responded 404: not found")).toBe(
      "Data service responded 404: not found"
    );
    expect(friendlyDataError("Malformed kline at position 3: expected at least 7 fields")).toBe(
      "Malformed kline at position 3: expected at least 7 fields"
    );
  });

  it("never renders an empty message when the error is missing", () => {
    expect(friendlyDataError(null)).toBe("Data service unreachable.");
    expect(friendlyDataError("")).toBe("Data service unreachable.");
  });
});

describe("dataErrorDetail", () => {
  it("keeps the transport detail as secondary copy for unreachable errors", () => {
    expect(dataErrorDetail("Data service unreachable: Failed to fetch")).toBe("Failed to fetch");
  });

  it("has nothing secondary to say for messages that stand on their own", () => {
    expect(dataErrorDetail("Data service timed out after 10000ms")).toBeNull();
    expect(dataErrorDetail("Data service responded 500: boom")).toBeNull();
    expect(dataErrorDetail(null)).toBeNull();
  });
});
