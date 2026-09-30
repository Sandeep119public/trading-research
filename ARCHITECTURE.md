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
| Session trade config (fee/slippage/size inputs) | UI (single session state; execution and backtest configs derive from it) |
| UI-only state | React state/hooks (Zustand only if app-wide state later requires it) |
| Which symbol/timeframe is on screen | UI (view selection, not trading state) |
| Load status shown in the Data Manager panel | DataManager |
| Fetching/caching raw data | Data Service (Worker) |

If two modules can both mutate the same trading state, that is a design bug. The UI never updates a position directly; it sends intents to ExecutionEngine.

## The Future Data Rule
At replay time T, no component may expose data with timestamp > T. Loading a full dataset and merely rendering the first N candles is a violation if an indicator or strategy can read the future array. The engine must make this structurally hard. The Future Data Rule governs the **replay view**: the replay chart and everything rendered alongside it. The backtest results report is a separate view over a completed run — see "Backtest results view" for that boundary. Dataset candles are frozen at the engine/data boundary, so no consumer holding a state reference can mutate history either.

A fill-row jump (click-to-jump) moves the replay view by advancing T itself: `ReplayController.fastForwardTo` steps every candle in between through the existing `step()` path, and the chart's series still only ever receives `state.visibleCandles`. The rule therefore holds by construction — the jump code never touches candle data at all. Scrolling the results report's own chart moves only that report view (over a completed run), never replay state.

## Repo layout
```
apps/web/
packages/
  backtest/
  data/
  engine/
  execution/
  portfolio/
  replay/
  strategy/
  shared/
scripts/
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
  updateConfig(config: ExecutionConfig): void
  reset(): void
  pendingCount(): number
  hasOpenRisk(): boolean
}

interface ReplayController {
  play(): void
  pause(): void
  step(): MarketState | null
  reset(startIndex: number): void
  fastForwardTo(timestamp: number): MarketState
  setSpeed(speed: ReplaySpeed): void
  subscribe(listener: (state: MarketState) => void): () => void
  subscribePlaying(listener: (playing: boolean) => void): () => void
  readonly playing: boolean
  readonly speed: ReplaySpeed
}
```

## Data path (implemented)
```
UI selection → BinanceDataManager.loadRange() → createHttpFetchKlines() → services/data-api → Binance
                                ↓
                    validated, frozen Candle[] → MarketEngine
```
- The UI owns which symbol/timeframe is on screen (view selection) and builds a fresh `BinanceDataManager` per selection, so candles from two datasets can never mix. Selection change goes through the existing reset path: new stack, new chart, replay reset.
- `BinanceDataManager` owns the candles and the load state the Data Manager panel reads: symbol, timeframe, loaded range, candle count, and status `idle | fetching | ready | error` (plus the error detail). `ready` covers any locally available answer — freshly fetched or served from cache — because what matters to the panel is that the candles exist, not how they arrived. `subscribe()` publishes transitions; `clear()` resets all of it.
- The transport is `createHttpFetchKlines()`, a drop-in `FetchKlinesFn`. MarketEngine, ReplayController, ExecutionEngine, and Portfolio are untouched by the swap.
- Both HTTP hops have deadlines (`AbortSignal.timeout`): the UI→service call aborts after `timeoutMs` (default 30s) and the service→Binance call after its own (default 10s). A dead endpoint becomes a visible `… timed out after …` error, never a request that hangs and leaves the UI on "Loading…" forever.
- Loading and failure are real states: a failed range renders an explicit error, never an empty chart.

## Data service contract (implemented)
`services/data-api` is a Cloudflare Worker whose only job is serving historical OHLCV.

- `GET /klines?symbol&timeframe&start&end[&limit]` answers with the Binance kline rows covering the whole range. `limit` is the upstream page size, never a truncation of the answer.
- Supported universe: BTCUSDT, ETHUSDT, SOLUSDT and 1m, 5m, 15m, 1h. Declared once as `SUPPORTED_SYMBOLS` / `SUPPORTED_TIMEFRAMES` in `packages/data`, enforced by the service, and the only thing the UI offers. Anything else is a 400.
- Reuses the shared `packages/data` pipeline instead of reimplementing it: `fetchKlinesRange()` (pagination guard, live-edge `dropFormingCandles()`, range selection), `normalizeBinanceKlines()` (validation), `expectedSeconds()` (coverage), `rangeIsClosed()` (cacheability), `MAX_PAGE_LIMIT`.
- A candle that has not closed is never ingested, wherever the range came from: `fetchKlinesRange()` drops forming rows as of *now*, not as of the caller's `end`, so a request captured milliseconds ago still cannot smuggle in the current candle.
- Coverage is checked for **every** range, live or not: `expectedSeconds()` clamps the demanded set to candles that could have closed, so a live edge is judged against closed data only, and a range whose candles have not closed yet demands its own opens instead of nothing. A hole in closed candles is a 422, never a short 200; a range with nothing closed is a 422, never an empty 200. The client's `loadRange()` applies the identical rule on the same helpers, so both sides agree on what "covered" means.
- Caches only ranges made entirely of closed candles (`rangeIsClosed()`), in KV when bound and per-isolate memory otherwise: their answers can never change. A range that reaches the forming candle is refetched every time, because the closed set keeps growing. Entries live 7 days (`CACHE_TTL_SECONDS`); the memory store's TTL expiry check is the only production wall-clock use outside the live-edge rules above.
- Failure is always a non-200 with an `error` body: bad request 400, unknown path 404, non-GET 405, range that cannot be fully covered 422, upstream failure or invalid rows 502 (including an upstream that timed out), unexpected internal failure 500 from the worker entry's catch-all (`unexpectedErrorResponse`). The `{error}` JSON contract holds for every failure — the platform's opaque error response is never the answer. A truncated 200 is never an outcome.
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
- The report renders in its own section with its own Lightweight Charts instance carrying the equity curve and the report's fill arrows (`toFillMarkers`: buy arrow below its candle, sell arrow above, snapped to the candle that carried the fill). Backtest-derived series and markers are never written to the replay chart's canvas — replay gets no fill arrows at all (V1 decision: replay fills surface live through position, price-line, and readout as they execute; historical fill arrows on the replay canvas would need `syncFromMarket` to expose fills, a contract change left deferred) — so the two views may be visible at once, but they never share a canvas, a series, or a marker set. That is what keeps the Future Data Rule true for the replay view while whole-run statistics stay available at any time.
- Trade assumptions are user-set, not hardcoded: the UI owns one session `TradeConfig` (fee/slippage/size, plain number inputs beside the replay trading controls and the backtest Run control, two views of one stored value). Each backtest run maps it to `BacktestConfig` — which extends `ExecutionConfig` with `startingCapital` and `size`, so fee/slippage have one type shared with ExecutionEngine — and the replay stack's ExecutionEngine is created from it and live-updated on every valid edit (`updateConfig`, which never touches pending orders, open risk, or the order-id allocator — reconfiguration is not a reset). `size` feeds the strategy's quantity through the run wiring; the driver validates it at the config boundary but never interprets strategy params. Invalid input shows a visible error and disables new entries and Run instead of clamping or leaking NaN into an engine, while Close of an open position stays available — the close intent carries no draft-derived values (it uses the position's own quantity) and the engine keeps its last valid config, so a bad Size edit can never trap a trader (`footer-gates.ts`) — and the same boundary rejects extreme-but-finite values (over `MAX_TRADE_CONFIG_VALUE`) that would otherwise overflow engine math into Infinity/NaN. Defaults are zero-cost (fee 0, slippage 0, size 0.01), so existing behavior is unchanged until the user edits a field.
- Derived display stats — per-fill realized P&L, trade count, win rate, profit factor — are computed in `apps/web/src/fill-analysis.ts` by walking a throwaway `Portfolio` instance, so position accounting has exactly one owner and the UI holds no second copy of the netting rules that could drift when Portfolio changes. Per-fill realized P&L is the delta of `realizedPnl` (fees stay out because Portfolio keeps them out), and on top of that sit only report semantics: round-trip boundaries (position flat, or side flipped by an over-close), per-trade fee attribution, and win/loss classification — so the numbers sum back to BacktestResult's own metrics. `BacktestResult` itself is unchanged: no new fields. Win rate counts completed round trips only (a still-open trade has no outcome) and renders "—" when there are none; a run with zero fills renders an explicit "No trades in this run" state, never an empty table that looks broken. Profit factor is gross profit over gross loss of those same completed round trips (per-trade net after fees — win rate's unit, not a second one), with its representation decided explicitly rather than left to arithmetic: a ratio (0 when every completed trade lost, rendered "0" and not "0.00"), the literal `"infinite"` rendered "∞" when wins exist but no losing trade does — never raw `Infinity`, which `.toFixed()` would render as the string "Infinity" — and `null` rendered "—" when nothing completed or all trades were breakeven (0/0, nothing to ratio). Display formatting for these stats lives in `apps/web/src/report-format.ts`, shared with the CSV export below, so each representation has exactly one definition.
- CSV export: the header's `Export CSV` button (rendered only when a report is on screen) downloads `buildReportCsv(view)` (`apps/web/src/report-export.ts`) — three RFC 4180 sections separated by one blank line, records CRLF: a `metric,value` summary of run meta and the same derived stats, the fill rows from the same `analyzeFills` walk (same per-fill realized P&L the table shows), and the equity curve paired through `toEquityPoints`, which throws on a length mismatch rather than exporting a timeline that lies. Because it serializes the same `BacktestResult` through the same `report-format.ts` formatters, the file cannot show different numbers than the panel — "—", "∞", and "0" carry through and the string "Infinity" cannot appear — and the download is UTF-8 with BOM so Excel reads the symbols. Presentation only: no engine access, no new state, no `BacktestResult` fields.
- Fill-row jump (click-to-jump): each fill's time cell is a button when `onJumpToTime` is wired. The click always pauses replay first, then follows `planJump(replayTime, fillTime)` — one pure definition behind both the pre-click affordance and the action, so what the row promises is what the click does. `planJump` is `"scroll"` for a fill at or behind T and `"seek+scroll"` ahead of T (or when T is unknown): scroll-only centers both charts on the fill's time with the engine untouched; a seek runs `ReplayController.fastForwardTo` first, then centers both viewports on that time. T never moves backward — a fill behind T is always a scroll, and a target past the end of data stops at the last candle. Before the click the two read differently: `fill-jump--view` (free scroll) versus `fill-jump--seek` (amber — advances the live session). **Accepted side effect** (accepted explicitly, with no "only while flat" guard): seeking replays every candle in between through `step()`, so SL/TP may evaluate and fills, position, and P&L change exactly as they would have if replay had played there — that is what the amber affordance warns about. Seek pauses reuse the existing failure path: a subscriber's `pause()` (the drain-failure reaction) aborts the seek loop mid-candle, and the banner shows `Replay stopped: <message>` as usual. Scope is pause-aborts only: a *thrown* exception inside the loop propagates out of `fastForwardTo` (`jumpReplayTo` has no catch, so it would reach the crash boundary) — unreachable in production because the drain is wrapped by `syncFromMarketSafe` and `step()`/`getState()` refuse to run past the end. The two row colors are decoded by a legend above the fills table (`jumpLegend()` in `apps/web/src/jump-plan.ts`): each entry's swatch reuses the exact row class it explains, so caption and rows cannot drift apart. The landed fill stays marked: the clicked row keeps a highlight plus an amber left bar (`activeTime` prop), and both charts show a landing marker on the target candle (`jumpMarker` in `apps/web/src/fill-markers.ts`, amber for a seek that advanced replay, white for a scroll that did not). The replay chart's marker is re-applied in the data-landing effect (a seek's marker time only becomes plottable once the data lands, and `setData` may repaint it); the results chart's arrives with its mount and is replaced through `setJumpMarker`, which layers it over the report's fill arrows — never instead of them (`reportMarkers`, pinned by test). Forward seeks end right-aligned by construction: T becomes the newest visible candle and the Future Data Rule leaves nothing to the right of the target, so the marker, not the centring, carries the legibility; a backward jump lands its target at the viewport centre (verified in-browser).
- Replay chart viewport: series data and viewport update together in the data-landing effect. A seek's center runs there — centering earlier would aim at a series that still ends before the seek and lightweight-charts would clamp it to a stale one-bar view (`pendingCenter` holds the target until the data lands; scroll-only jumps center immediately because their data is already current) — and after every landing, if the engine's candle has run past the visible range, the viewport scrolls to real time, so playback after a jump stays watchable and the end-of-data view shows the end of data. A range that already contains the newest bar is never moved: a paused pan or a fresh center survives. The pure math (`centeredRange`, `shouldFollowEngine`) lives in `apps/web/src/chart-viewport.ts`.
- Replay state captions: the chart says what a paused chart cannot — `replayCaption` (`apps/web/src/chart-captions.ts`) renders "At start of data — press Play" at a fresh step-0 session and "End of data" when playback has run out, and nothing while playing or paused mid-session. Pure function over `{index, playing, finished}`; the caption never covers the footer controls or the attribution logo (top-centre overlay).
- Equity axis tag: the report chart's axis tag is pinned to the curve's final value (`equityAxisTag`, equal to `BacktestResult.finalEquity`) on a dashed price line, with the scroll-dependent last-value label turned off — so after a jump scrolls the report the tag and the FINAL EQUITY card can never show different numbers, while the crosshair still carries hovered values. A full-curve `autoscaleInfoProvider` keeps that final value inside the y-range at every x-window, so the tag cannot fall off the scale when a jump scrolls it out of the local data.
- Failure state: `tryRunEmaCrossBacktest()` converts the driver's throw contract into an explicit outcome; a failed run clears the previous report and renders `Backtest failed: <message>` (alert role) in place of the no-run hint, so an engine or config failure is never read as a completed run or an empty one.
- Determinism: same candles + config → identical `BacktestResult` (BacktestDriver's guarantee), so repeated runs render identical panels.

## Playback keyboard shortcuts (implemented)
The footer's replay controls are reachable from the keyboard, through a pure adapter and the same gates the buttons use:

- `keyToAction` (`apps/web/src/key-to-action.ts`) turns a key event into `"toggle"` | `"step"` | null: Space toggles play/pause, ArrowRight steps one candle. It is side-effect free — deciding what a key means and performing it are separate concerns. A focused INPUT/SELECT/TEXTAREA/editable region keeps every key (typing a fee never steps the replay), Space stays native on focused buttons/links so it cannot fire twice, and modified chords (Ctrl/Meta/Alt) are ignored.
- One window `keydown` listener performs the action through the same `togglePlaying`/`stepReplay` handlers the footer buttons call, with the `footer-gates` conditions inside them — a shortcut can never do what a disabled button refuses. `preventDefault` runs only when a shortcut actually acts.
- ArrowLeft is deliberately inert. No back-step exists anywhere in the engine surface (`ReplayController` is reset/step/fastForwardTo/play/pause/setSpeed only; nothing in `packages/*` steps backward), and stepping backward would have to rewind MarketEngine plus the execution and portfolio state derived from it — behavior the UI may not invent. The adapter therefore maps no key to it; the browser probe pins ArrowLeft inert. This is a recorded deviation from the audit finding, which had assumed a step-back existed.
- Accessibility companions: every keyboard stop shows the Phase 1 focus-visible ring, and both charting-library attribution links carry `aria-label` via `attribution.ts nameAttribution` — the library injects and later replaces that anchor asynchronously, so the naming follows every appearance and is disposed with its chart.

## Execution model
- V1 is candle mode only.
- Backtest strategy signals use a completed candle; market entries fill at the next candle open.
- Replay manual market orders fill at the current candle close.
- SL/TP become active after fill and are evaluated on subsequent candles.
- If SL and TP are both reachable inside one candle, **SL is considered hit first** for both long and short positions.
- Exact boundary ambiguity uses the outcome worse for the trader.
- Fees and slippage are per-fill configuration, never strategy constants.

## Failure surfacing (implemented)
Engine and UI failures are visible where the user acts, never swallowed or rendered as empty states:

- Crash boundary: `ErrorBoundary` wraps the app root; any render-time error shows a visible alert with the message and a Reload control instead of an empty screen (`error-boundary.tsx`).
- Backtest run: `tryRunEmaCrossBacktest` returns `{ok:true,result} | {ok:false,message}`; the results panel renders failures as `Backtest failed: <message>` and clears any stale report (see Backtest results view).
- Replay drain: the subscription uses `syncFromMarketSafe`; on an engine failure (e.g. a non-positive fill price) it pauses replay at the broken candle and shows `Replay stopped: <message>` in a dismissible alert banner. Reset clears the banner and re-enters the deterministic path. A `fastForwardTo` seek honors that same pause: it aborts the seek loop at that candle instead of marching past a broken one.
- Manual intents: `executeManualIntent` (`intents.ts`) reads the LIVE Portfolio, never the render snapshot, so a stale "flat" can never submit a rejected second open; no-op intents return false without touching the order-id allocator, and any engine rejection surfaces as `Order failed: <message>` in the banner while the footer republishes the actual portfolio state.

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
