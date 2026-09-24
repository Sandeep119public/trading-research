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
| UI-only state | Zustand |
| Fetching/caching raw data | Data Service (Worker) |

If two modules can both mutate the same trading state, that is a design bug. The UI never updates a position directly; it sends intents to ExecutionEngine.

## The Future Data Rule
At replay time T, no component may expose data with timestamp > T. Loading a full dataset and merely rendering the first N candles is a violation if an indicator or strategy can read the future array. The engine must make this structurally hard.

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
  onBar(context: StrategyContext): Signal[]
}

interface ExecutionEngine {
  submit(order: Order): void
  process(market: MarketState): Fill[]
}
```

## Data service contract
The server does exactly one thing: give historical market data. It fetches from Binance, caches to Parquet, and serves over HTTP. It contains no trading logic, authentication, or portfolio state.

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
Identical symbol/date-range/strategy inputs must produce identical trades, equity, and metrics unless seeded randomness is explicitly enabled.

## Build order
1. Synthetic OHLCV fixture → MarketEngine → Replay → Chart, no network.
2. Real data service → DataManager.
3. Replay proven solid → BacktestDriver using the same engine.
4. Responsive/touch layout → PWA.
