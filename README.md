# Trading Research Engine

A replay-first trading research workstation.

## V1

The first slice is intentionally narrow:

- deterministic synthetic OHLCV
- single-owner MarketEngine
- ReplayController
- TradingView Lightweight Charts
- play/pause/step
- 1x/2x/5x/10x replay speed
- mobile-friendly chart shell
- engine/replay determinism tests

Backtesting is deliberately not implemented yet. It will reuse the exact same MarketEngine and ExecutionEngine after replay is proven solid.

## Development

Requirements: Node.js 20+.

```bash
npm install
npm run dev
npm test
npm run typecheck
npm run build
```

Read ARCHITECTURE.md and AGENTS.md before changing the system.
