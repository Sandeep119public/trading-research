import { describe, expect, it } from "vitest";
import { MemoryCacheStore } from "../src/cache";
import { createWorkerHandler } from "../src/worker";

function deps() {
  return { fetchKlines: async () => [], cache: new MemoryCacheStore() };
}

describe("worker entry", () => {
  it("answers an unexpected failure with a JSON 500, never an opaque platform error", async () => {
    const handler = createWorkerHandler(() => {
      throw new Error("cache unavailable");
    });
    const response = await handler(
      new Request("http://test/klines?symbol=BTCUSDT&timeframe=1m&start=1000&end=1000"),
      {}
    );
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "internal error: cache unavailable" });
  });

  it("leaves the handler's own responses untouched on the normal path", async () => {
    const handler = createWorkerHandler(deps);
    const response = await handler(new Request("http://test/klines?symbol=NOPE"), {});
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("unsupported symbol");
  });
});
