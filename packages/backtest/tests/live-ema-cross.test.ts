import { describe, expect, it } from "vitest";
import { BinanceDataManager, createHttpFetchKlines } from "@trading-research/data";
import { EmaCrossStrategy } from "@trading-research/strategy";
import { BacktestDriver } from "../src/index";

/**
 * The whole path on real market data: data service → HTTP transport →
 * BinanceDataManager → frozen candles → BacktestDriver + EmaCrossStrategy.
 *
 * Opt-in, because the CI runner has no data service: point DATA_API_URL at one
 * (`npm run dev --workspace @trading-research/data-api`) and run the suite. It
 * is skipped otherwise, so the default `npm test` stays deterministic.
 *
 * The range is fully closed (January 2024), so the service answers it from
 * closed candles only and the numbers below never change.
 */
// Opt-in switch. This workspace has no @types/node, and the runner is Node, so
// read it off globalThis instead of pulling in a dependency for one field.
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
const baseUrl = env?.DATA_API_URL;

describe.runIf(baseUrl)("EMA cross backtest over BTCUSDT served by the data service", () => {
  it("loads BTCUSDT 15m and trades the crossover identically on repeated runs", async () => {
    const manager = new BinanceDataManager({
      symbol: "BTCUSDT",
      timeframe: "15m",
      fetchKlines: createHttpFetchKlines({ baseUrl: baseUrl as string })
    });
    const candles = await manager.loadRange({
      startTime: Date.UTC(2024, 0, 1),
      endTime: Date.UTC(2024, 0, 31, 23, 59)
    });
    expect(candles.length).toBe(2976);
    expect(manager.getState().status).toBe("cached");

    const driver = new BacktestDriver(candles, {
      startingCapital: 10_000,
      feePerUnit: 5,
      slippagePerUnit: 2
    });
    const strategy = new EmaCrossStrategy({ quantity: 0.01 });
    const first = driver.run(strategy);
    const second = driver.run(strategy);

    expect(second).toEqual(first);
    expect(first.fills.length).toBeGreaterThan(0);
    expect(first.equityCurve).toHaveLength(candles.length);
    // Long-only crossover: entries and exits alternate, and nothing can open
    // the sequence with an exit.
    const sides = first.fills.map(fill => fill.side);
    expect(sides[0]).toBe("buy");
    for (let i = 1; i < sides.length; i++) {
      expect(sides[i]).not.toBe(sides[i - 1]);
    }
    expect(Number.isFinite(first.finalEquity)).toBe(true);
    expect(first.maxDrawdown).toBeGreaterThanOrEqual(0);
  }, 60_000);
});
