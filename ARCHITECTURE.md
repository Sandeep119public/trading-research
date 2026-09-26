# Trading Research Engine

## What this is
A replay-first trading research workstation. Backtesting is a second driver of the same engine that powers replay, not a separate system.

## Core primitive
```
MarketEngine.step() → MarketEvent
```
Replay calls `step()` on a timer, user-controlled (play/pause/step/speed). Backtest calls `step()` in a tight loop until exhausted. Same engine, same execution, same portfolio. No feature may bypass this.

## Module ownership
| Responsibility | Owner |
|---|---|
| Historical candles | DataManager |
| Current candle/time | MarketEngine |
| Advancing time | ReplayController / BacktestDriver |
| Strategy decisions | Strategy |
| Orders | ExecutionEngine |
| Positions, P&L | Portfolio |
| Chart rendering | Chart (UI) |
| Backtest results report view | UI (calls BacktestDriver on demand, renders BacktestResult) |
| UI-only state | React state/hooks (Zustand only if app-wide state later requires it) |
| Which symbol/timeframe is on screen | UI (view selection, not trading state) |
| Load status shown in the Data Manager panel | DataManager |
| Fetching/caching raw data | Data Service (Worker) |

If two modules can both mutate the same trading state, that is a design bug. The UI never updates a position directly; it sends intents to ExecutionEngine.

## The Future Data Rule
At replay time T, no component may expose data with timestamp > T. Loading a full dataset and merely rendering the first N candles is a violation if an indicator or strategy can read the future array. The engine must make this structurally hard. The Future Data Rule governs the **replay view**: the replay chart and everything rendered alongside it. The backtest results report is a separate view over a completed run — see "Backtest results view" for that boundary. Dataset candles are frozen at the engine/data boundary, so no consumer holding a state reference can mutate history either.

## Repo layout
```
apps/web/
packages/
  backtest/
  chart/
  data/
  engine/
  execution/
  portfolio/
  replay/
  strategy/
  shared/
services/data-api/
```

## V1 interfaces
```ts
interface MarketEngine {
  reset(startIndex: number): void
  step(): MarketEvent
  getState(): MarketState
  finished(): boolean
}

interface Strategy {
  onBar(context: StrategyContext): StrategySignal[]
  reset?(): void
}

interface ExecutionEngine {
  nextOrderId(prefix: string): string
  submit(order: OrderIntent, currentIndex: number): void
  process(market: MarketState): Fill[]
}
```

## Data path (implemented)
```
UI selection → BinanceDataManager.loadRange() → createHttpFetchKlines() → services/data-api → Binance
                                ↓
                    validated, frozen Candle[] → MarketEngine
```
- The UI owns which symbol/timeframe is on screen (view selection) and builds a fresh `BinanceDataManager` per selection, so candles from two datasets can never mix. Selection change goes through the existing reset path: new stack, new chart, replay reset.
- `BinanceDataManager` owns the candles and the load state the Data Manager panel reads: symbol, timeframe, loaded range, candle count, and status `idle | fetching | cached | error` (plus the error detail). `subscribe()` publishes transitions; `clear()` resets all of it.
- The transport is `createHttpFetchKlines()`, a drop-in `FetchKlinesFn`. MarketEngine, ReplayController, ExecutionEngine, and Portfolio are untouched by the swap.
- Loading and failure are real states: a failed range renders an explicit error, never an empty chart.

## Data service contract (implemented)
`services/data-api` is a Cloudflare Worker whose only job is serving historical OHLCV.

- `GET /klines?symbol&timeframe&start&end[&limit]` answers with the Binance kline rows covering the whole range. `limit` is the upstream page size, never a truncation of the answer.
- Supported universe: BTCUSDT, ETHUSDT, SOLUSDT and 1m, 5m, 15m, 1h. Declared once as `SUPPORTED_SYMBOLS` / `SUPPORTED_TIMEFRAMES` in `packages/data`, enforced by the service, and the only thing the UI offers. Anything else is a 400.
- Reuses the shared `packages/data` pipeline instead of reimplementing it: `fetchKlinesRange()` (pagination guard, live-edge `dropFormingCandles()`, range selection), `normalizeBinanceKlines()` (validation), `expectedSeconds()` (coverage), `rangeIsClosed()` (cacheability), `MAX_PAGE_LIMIT`.
- A candle that has not closed is never ingested, wherever the range came from: `fetchKlinesRange()` drops forming rows as of *now*, not as of the caller's `end`, so a request captured milliseconds ago still cannot smuggle in the current candle.
- Coverage is checked for **every** range, live or not: `expectedSeconds()` clamps the demanded set to candles that could have closed, so a live edge is judged against closed data only, and a range whose candles have not closed yet demands its own opens instead of nothing. A hole in closed candles is a 422, never a short 200; a range with nothing closed is a 422, never an empty 200. The client's `loadRange()` applies the identical rule on the same helpers, so both sides agree on what "covered" means.
- Caches only ranges made entirely of closed candles (`rangeIsClosed()`), in KV when bound and per-isolate memory otherwise: their answers can never change. A range that reaches the forming candle is refetched every time, because the closed set keeps growing.
- Failure is always a non-200 with an `error` body: bad request 400, unknown path 404, non-GET 405, range that cannot be fully covered 422, upstream failure or invalid rows 502. A truncated 200 is never an outcome.
- Explicitly out of scope, now and later: trading/simulation logic, auth, symbols/timeframes outside the universe above.

## V1 strategy constraint
- A strategy may return at most one signal per bar. The ExecutionEngine holds a single pending order, so a second signal in the same bar could never be honored.
- BacktestDriver rejects multiple signals **before submitting any of them**: it throws, it does not silently take the first.
- `StrategyContext` is the engine's `MarketState` at bar T (`candle`, `index`, `visibleCandles`), where `visibleCandles` is bars 0..T by construction. That slice is the Future Data Rule made structural, so a strategy that computes from `visibleCandles` cannot read past T.
- A strategy may remember state across bars (position flags, indicator state). `BacktestDriver.run()` calls `strategy.reset?.()` before every run, alongside its own resets, so one strategy instance can be reused and still produce identical results. A strategy with no cross-bar state need not define `reset`.

## Sample strategy: EMA(20)/EMA(50) cross (implemented)
`packages/strategy` owns the contract and the one sample strategy that exercises it, `EmaCrossStrategy`:

- Long-only: fast crosses above slow → enter long; fast crosses below slow → **exit long (flatten)**. It never opens a short, so a first cross below while flat emits nothing, and an up-cross while already long is ignored (V1 forbids pyramiding).
- Size is strategy config (`quantity`): V1 has no sizing model, and fees/slippage stay in BacktestConfig, never in the strategy.
- Both EMAs are recomputed from `context.visibleCandles` on every bar — pure, idempotent when a bar is seen twice, and structurally unable to see past T. The only remembered state is whether the strategy is in a position, cleared by `reset()`.
- Wiring costs nothing from the engine side: BacktestDriver hands it the same bar view as any other strategy (`StrategyContext`), and MarketEngine, ExecutionEngine, and Portfolio are untouched.
- Determinism: identical candles + params produce identical fills, equity curve, and metrics, including when the same instance is run twice on the same driver.

## Backtest results view (implemented)
The results panel is a report over a completed BacktestDriver run, kept structurally separate from replay:

- Run is never gated on replay progress: `runEmaCrossBacktest()` builds its own BacktestDriver (its own MarketEngine, ExecutionEngine, and Portfolio instances) over the full loaded candle set, so a report run cannot touch replay state. Same engine/execution/portfolio classes as replay, per the core primitive.
- The report renders in its own section with its own Lightweight Charts instance carrying the equity curve. Backtest-derived series are never written to the replay chart's canvas: the two views may be visible at once, but they never share a canvas or a series. That is what keeps the Future Data Rule true for the replay view while whole-run statistics stay available at any time.
- Config mirrors the UI's replay stack: the same starting-capital constant, fee/slippage 0/0 (the UI has no fee inputs — a report must not invent numbers), and size fixed at 0.01 base units (V1 has no sizing model, so size is strategy config).
- Derived display stats — per-fill realized P&L, trade count, win rate — are computed in `apps/web/src/fill-analysis.ts` by walking a throwaway `Portfolio` instance, so position accounting has exactly one owner and the UI holds no second copy of the netting rules that could drift when Portfolio changes. Per-fill realized P&L is the delta of `realizedPnl` (fees stay out because Portfolio keeps them out), and on top of that sit only report semantics: round-trip boundaries (position flat, or side flipped by an over-close), per-trade fee attribution, and win/loss classification — so the numbers sum back to BacktestResult's own metrics. `BacktestResult` itself is unchanged: no new fields. Win rate counts completed round trips only (a still-open trade has no outcome) and renders "—" when there are none; a run with zero fills renders an explicit "No trades in this run" state, never an empty table that looks broken.
- Determinism: same candles + config → identical `BacktestResult` (BacktestDriver's guarantee), so repeated runs render identical panels.

## Execution model
- V1 is candle mode only.
- Backtest strategy signals use a completed candle; market entries fill at the next candle open.
- Replay manual market orders fill at the current candle close.
- SL/TP become active after fill and are evaluated on subsequent candles.
- If SL and TP are both reachable inside one candle, **SL is considered hit first** for both long and short positions.
- Exact boundary ambiguity uses the outcome worse for the trader.
- Fees and slippage are per-fill configuration, never strategy constants.

## V1 scope
Replay: symbol/timeframe, start date, play/pause/step, 1x/2x/5x/10x speed, reset, candles, volume, crosshair, zoom/pan, simulated market buy/sell, live position and P&L.

Backtest: same engine auto-driven, strategy, entry/exit, SL/TP, fees, slippage, starting capital, net return, win rate, profit factor, max drawdown, equity curve.

## Explicitly deferred
Multi-timeframe alignment, walk-forward/optimization, live trading, ML strategies, tick data, multi-asset portfolios, social/marketplace features, and native mobile app. PWA only.

## Determinism
Identical symbol/date-range/strategy inputs must produce identical trades, fill IDs, equity, and metrics unless seeded randomness is explicitly enabled. ExecutionEngine owns deterministic order-ID allocation and resets that allocator with its other mutable state.

## Build order
1. Synthetic OHLCV fixture → MarketEngine → Replay → Chart, no network.
2. Real data service → DataManager.
3. Replay proven solid → BacktestDriver using the same engine.
4. Responsive/touch layout → PWA.
