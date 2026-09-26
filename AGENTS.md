# Coding Agent Instructions

Read ARCHITECTURE.md before touching code and re-check it before any module-boundary change.

## Priorities
1. Accurate, delightful market replay.
2. Accurate backtesting using the same engine as replay.
3. Clean chart UX.
4. Mobile-responsive PWA.
5. Small architecture over feature count.

## Hard rules
- Replay and backtest MUST share the same MarketEngine and ExecutionEngine.
- Never expose future data beyond the engine's current time.
- UI sends trading intents; it never mutates trading state.
- Never invent execution behavior. Follow ARCHITECTURE.md, including signal/fill timing and conservative SL-first candle ambiguity.
- One module owns each mutable concern.
- New top-level packages/services require an ARCHITECTURE.md update in the same change.
- When a code change invalidates documentation, update the documentation in the same commit and review the changed behavior against it before reporting completion.
- Every reset API must reset all mutable state owned by that subsystem. Test reset behavior directly rather than relying on a later operation to reinitialize the state.
- When something looks like an inherent limitation ("library behavior", "can't be changed", "reset already covers it"), check for an uncalled API or an unreset field before accepting it. On this codebase that pattern has hit three times: `BacktestDriver` missing engine/execution/portfolio resets, UI `orderSeq` surviving `ExecutionEngine.reset()`, and chart viewport scroll retained across `setData` when `ITimeScaleApi.resetTimeScale()` existed but nothing called it.
- Do not add a dependency when small local code is sufficient.
- Do not build deferred features before V1 is solid.
- Prefer deleting obsolete code over layering patches.

## Working style
Build vertical slices in architecture order. Before changing a boundary, identify the owning module and fix the interface there. After non-trivial changes, run tests and build before reporting completion. Never report a build, test, or CI result without showing the actual command and relevant output that proves it.

## Testing
Engine, execution, and portfolio logic require unit tests. Replay/backtest must be deterministic across repeated runs. UI tests can lag behind engine tests during V1.

The opt-in live data suite (`DATA_API_URL=... npm test --workspace @trading-research/backtest`) is skipped in CI; rerun it by hand when strategy or BacktestDriver logic changes.
