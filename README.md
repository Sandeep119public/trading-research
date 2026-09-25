# Trading Research Engine

A replay-first trading research workstation.

## Current V1

The current foundation is implemented and verified in local development and GitHub Actions:

- Binance kline normalization, validation, pagination, and in-memory caching
- `services/data-api`, a Cloudflare Worker serving historical OHLCV over HTTP: fetch, cache, fail loud
- data-backed replay through the same MarketEngine used by backtesting
- symbol (BTCUSDT, ETHUSDT, SOLUSDT) and timeframe (1m, 5m, 15m, 1h) selectors, both limited to what the service can actually serve
- read-only Data Manager panel: symbol, timeframe, loaded range, candle count, and cached/fetching/error status
- single-owner MarketEngine with the Future Data Rule
- ReplayController with play/pause/step and 1x/2x/5x/10x speeds
- ExecutionEngine with deterministic candle-mode fills, SL/TP, fees, and slippage
- Portfolio with netting, realized/unrealized P&L, fees, and equity
- BacktestDriver reusing the same MarketEngine, ExecutionEngine, and Portfolio
- `EmaCrossStrategy`, an EMA(20)/EMA(50) crossover on the Strategy contract: long-only, no lookahead, at most one signal per bar
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

## Development

Requirements: Node.js 20.19+.

```bash
npm install
npm run dev
npm test
npm run typecheck
npm run build
```

The repository pins npm 10.8.2 through `packageManager` and includes `package-lock.json`.

Read ARCHITECTURE.md and AGENTS.md before changing the system.
