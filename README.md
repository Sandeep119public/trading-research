# Trading Research Engine

A replay-first trading research workstation.

## Current V1

The current foundation is implemented and verified in local development and GitHub Actions:

- Binance kline normalization, validation, pagination, and in-memory caching
- data-backed BTCUSDT 5m replay through the same MarketEngine used by backtesting
- single-owner MarketEngine with the Future Data Rule
- ReplayController with play/pause/step and 1x/2x/5x/10x speeds
- ExecutionEngine with deterministic candle-mode fills, SL/TP, fees, and slippage
- Portfolio with netting, realized/unrealized P&L, fees, and equity
- BacktestDriver reusing the same MarketEngine, ExecutionEngine, and Portfolio
- deterministic engine, replay, execution, portfolio, backtest, and data tests
- Lightweight Charts web UI

The browser currently uses a static BTCUSDT snapshot transport. Live exchange fetching remains outside the browser and will arrive through the dedicated data service.

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
