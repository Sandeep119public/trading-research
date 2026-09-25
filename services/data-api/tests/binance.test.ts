import { describe, expect, it, vi } from "vitest";
import { createBinanceKlinesFetcher } from "../src/binance";

const T0 = 1_700_000_040_000;
const MIN = 60_000;

describe("Binance kline fetcher", () => {
  it("asks the documented REST endpoint with the requested window", async () => {
    const rows = [[T0, "100", "101", "99", "100.5", "10", T0 + MIN - 1]];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify(rows), { status: 200 }));
    const fetchKlines = createBinanceKlinesFetcher(fetchImpl);

    const out = await fetchKlines({ symbol: "ETHUSDT", interval: "15m", startTime: T0, endTime: T0 + 2 * MIN, limit: 500 });

    expect(out).toEqual(rows);
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(`${url.origin}${url.pathname}`).toBe("https://api.binance.com/api/v3/klines");
    expect(url.searchParams.get("symbol")).toBe("ETHUSDT");
    expect(url.searchParams.get("interval")).toBe("15m");
    expect(url.searchParams.get("startTime")).toBe(String(T0));
    expect(url.searchParams.get("endTime")).toBe(String(T0 + 2 * MIN));
    expect(url.searchParams.get("limit")).toBe("500");
  });

  it("throws instead of passing an error response through", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: -1121, msg: "Invalid symbol." }), {
          status: 400,
          statusText: "Bad Request"
        })
    );
    const fetchKlines = createBinanceKlinesFetcher(fetchImpl);
    await expect(
      fetchKlines({ symbol: "NOPEUSDT", interval: "1m", startTime: T0, endTime: T0 })
    ).rejects.toThrow(/Binance responded 400 Bad Request/);
  });

  it("throws when the payload is not a kline array", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ rows: [] }), { status: 200 }));
    const fetchKlines = createBinanceKlinesFetcher(fetchImpl);
    await expect(
      fetchKlines({ symbol: "BTCUSDT", interval: "1m", startTime: T0, endTime: T0 })
    ).rejects.toThrow(/not an array/);
  });
});
