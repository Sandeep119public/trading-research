# Trading Research Engine

A replay-first trading research workstation.

## Current V1

The current foundation is implemented and verified in local development and GitHub Actions:

- Binance kline normalization, validation, pagination, and in-memory caching
- `services/data-api`, a Cloudflare Worker serving historical OHLCV over HTTP: fetch, cache, fail loud
- data-backed replay through the same MarketEngine used by backtesting
- symbol (BTCUSDT, ETHUSDT, SOLUSDT) and timeframe (1m, 5m, 15m, 1h) selectors, both limited to what the service can actually serve
- read-only Data Manager panel: symbol, timeframe, loaded range, candle count, and ready/fetching/error status
- single-owner MarketEngine with the Future Data Rule
- ReplayController with play/pause/step, 1x/2x/5x/10x speeds, and `fastForwardTo` (seek by stepping every candle in between)
- ExecutionEngine with deterministic candle-mode fills, SL/TP, fees, and slippage
- Portfolio with netting, realized/unrealized P&L, fees, and equity
- BacktestDriver reusing the same MarketEngine, ExecutionEngine, and Portfolio
- `EmaCrossStrategy`, an EMA(20)/EMA(50) crossover on the Strategy contract: long-only, no lookahead, at most one signal per bar
- backtest results panel: summary stats (final equity, realized P&L, max drawdown, fees, win rate, profit factor, trades, fills), the equity curve on its own chart, and a sortable fill table — with an explicit "No trades in this run" state
- one-click CSV export of the backtest report: the same summary stats, fill rows, and equity curve as three RFC 4180 sections
- click-to-jump from the fill table: click a fill's time to center both charts on it — replay is paused first, and a fill ahead of the current position fast-forwards through every candle in between (those rows are marked amber before the click)
- fee/slippage/size configuration shared by replay and backtest from one session config: plain number inputs beside both control groups, validated, zero-cost defaults preserved
- deterministic engine, strategy, replay, execution, portfolio, backtest, and data tests
- Lightweight Charts web UI

## Data service

The browser never talks to an exchange. It calls `GET /klines?symbol&timeframe&start&end` on the data service, which fetches from Binance, caches fully historical ranges, and answers with an error body instead of partial data.

```bash
npm run dev --workspace @trading-research/data-api     # wrangler dev, http://127.0.0.1:8787
npm run deploy --workspace @trading-research/data-api  # wrangler deploy
```

Point the web app at it with `VITE_DATA_API_URL` (defaults to `http://127.0.0.1:8787`):

```bash
VITE_DATA_API_URL=http://127.0.0.1:8787 npm run dev
```

Without a bound KV namespace the worker still caches, just per isolate; add the `kv_namespaces` block in `wrangler.toml` to share one cache across isolates.

`wrangler` is pinned to `4.86.0` and `compatibility_date` to `2026-05-03`: every newer wrangler requires Node 22, and that pinned version's `workerd` knows dates up to `2026-05-03`. Deploy and local `wrangler dev` therefore run under the same date; raise both together when Node moves to 22 (the reasoning is recorded in `wrangler.toml`).

## Sample strategy

`packages/strategy` owns the Strategy contract — `onBar(context: StrategyContext): StrategySignal[]`, at most one signal per bar — and ships `EmaCrossStrategy`: EMA(20) crossing EMA(50), long-only (cross above enters long, cross below exits long). Both EMAs are computed from `context.visibleCandles` only, so the Future Data Rule holds by construction.

With the data service running, the same strategy can be driven over real BTCUSDT candles end to end: data service → HTTP transport → `BinanceDataManager` → `BacktestDriver`. That suite is opt-in (CI has no service) and is skipped unless `DATA_API_URL` is set:

```bash
DATA_API_URL=http://127.0.0.1:8787 npm test --workspace @trading-research/backtest
```

## Not yet built

- Replay start-date selection (in V1 scope) — replay currently opens at the oldest candle of the loaded lookback range.
- Strategy choice in the UI - the panel runs the EMA(20)/EMA(50) sample; fee, slippage, and size are configurable.
- More derived report metrics (Sharpe, Sortino, expectancy) beyond win rate, trade count, and profit factor.
- Side-by-side run comparison of two runs.

## Development

Requirements: Node.js 20.19+.

```bash
npm install
npm run dev:all
npm test
npm run typecheck
npm run build
```

`npm run dev:all` runs `scripts/dev.mjs`, the one command for local development: it pre-flight-checks the Node version, install state, git tree (a dirty tree is surfaced as a possible second session per AGENTS.md), ports, and local config, then starts both services with labeled output, waits until each actually answers HTTP, and supervises them. If a port is taken by a process from this repository it offers kill/reuse/abort; a foreign owner is never touched. Ctrl+C stops both services and verifies both ports are released; if either service crashes, the other is shut down too. Use `npm run dev` to start only the web app (then start the data service separately as above).

On Windows, if `npm` fails with "npm.ps1 cannot be loaded because running scripts is disabled", use `npm.cmd` instead (e.g. `npm.cmd run dev:all`), or run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.

The repository pins npm 10.8.2 through `packageManager` and includes `package-lock.json`.

Read ARCHITECTURE.md and AGENTS.md before changing the system.
