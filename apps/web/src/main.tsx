import React from "react";
import { createRoot } from "react-dom/client";
import { createChart, CandlestickSeries, HistogramSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import {
  BinanceDataManager,
  SUPPORTED_SYMBOLS,
  SUPPORTED_TIMEFRAMES,
  createHttpFetchKlines,
  type DataManagerState,
  type SupportedSymbol,
  type SupportedTimeframe
} from "@trading-research/data";
import { CandleMarketEngine } from "@trading-research/engine";
import { ExecutionEngine } from "@trading-research/execution";
import { Portfolio, type PortfolioState } from "@trading-research/portfolio";
import { ReplayController, type ReplaySpeed } from "@trading-research/replay";
import type { Candle, MarketState } from "@trading-research/shared";
import { toChartPoints } from "./chart-points";
import { centeredRange, shouldFollowEngine } from "./chart-viewport";
import { ErrorBoundary } from "./error-boundary";
import { footerGates } from "./footer-gates";
import { executeManualIntent } from "./intents";
import { planJump } from "./jump-plan";
import { syncFromMarketSafe } from "./replay-sync";
import { mountResultsChart } from "./results-chart";
import { ResultsPanel, type BacktestView } from "./results-panel";
import { tryRunEmaCrossBacktest } from "./run-backtest";
import { RuntimeErrorBanner } from "./runtime-error";
import { ConfigInputs } from "./config-inputs";
import {
  DEFAULT_TRADE_CONFIG,
  DEFAULT_TRADE_DRAFT,
  parseTradeConfig,
  toBacktestConfig,
  toExecutionConfig,
  type TradeConfigDraft,
  type TradeConfigField
} from "./trade-config";
import "./styles.css";

const STARTING_CAPITAL = 10000;
const DAY_MS = 86_400_000;

/** History loaded per timeframe, sized so every timeframe opens on a chart
 * with a readable number of candles. */
const LOOKBACK_MS: Record<SupportedTimeframe, number> = {
  "1m": 2 * DAY_MS,
  "5m": 7 * DAY_MS,
  "15m": 21 * DAY_MS,
  "1h": 90 * DAY_MS
};

const DATA_API_URL = (import.meta.env.VITE_DATA_API_URL as string | undefined) || "http://127.0.0.1:8787";
const fetchKlines = createHttpFetchKlines({ baseUrl: DATA_API_URL });

interface Stack {
  engine: CandleMarketEngine;
  replay: ReplayController;
  execution: ExecutionEngine;
  portfolio: Portfolio;
  /** The full loaded dataset, kept so a backtest report can run over the
   * whole range — visibleCandles only ever reaches the replay position. */
  candles: readonly Candle[];
}

function emptyDataState(symbol: SupportedSymbol, timeframe: SupportedTimeframe): DataManagerState {
  return { symbol, timeframe, status: "idle", error: null, loadedRange: null, candleCount: 0 };
}

function rangeFor(timeframe: SupportedTimeframe, nowMs: number) {
  return { startTime: nowMs - LOOKBACK_MS[timeframe], endTime: nowMs };
}

function dateLabel(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function portfolioLabel(stack: Stack | null, state: MarketState | null, portfolioState: PortfolioState | null): string {
  if (!stack || !state || !portfolioState) return "—";
  const position = portfolioState.position;
  const unrealized = position === null ? 0 : stack.portfolio.unrealizedAt(state.candle.close);
  const held = position === null ? "flat" : `${position.side} ${position.quantity} @ ${position.entryPrice.toFixed(2)}`;
  return `Pos ${held} | R ${portfolioState.realizedPnl.toFixed(2)} | U ${unrealized.toFixed(2)} | Eq ${portfolioState.equity.toFixed(2)}`;
}

function App() {
  const chartRef = React.useRef<HTMLDivElement>(null);
  const chartApi = React.useRef<IChartApi | null>(null);
  const candleSeries = React.useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeries = React.useRef<ISeriesApi<"Histogram"> | null>(null);
  const resultsChartRef = React.useRef<HTMLDivElement>(null);
  const resultsChartApi = React.useRef<IChartApi | null>(null);
  const pendingTimeScaleReset = React.useRef(false);
  // A seek-jump's center target, held until the post-seek data lands (see the
  // data effect below): centering inside the click handler aims at a series
  // that still ends before the seek, and lightweight-charts clamps such a
  // range to a degenerate one-bar viewport that setData then preserves forever.
  const pendingCenter = React.useRef<number | null>(null);

  const [symbol, setSymbol] = React.useState<SupportedSymbol>(SUPPORTED_SYMBOLS[0]);
  const [timeframe, setTimeframe] = React.useState<SupportedTimeframe>("5m");
  const [dataState, setDataState] = React.useState<DataManagerState>(() =>
    emptyDataState(SUPPORTED_SYMBOLS[0], "5m")
  );
  const [stack, setStack] = React.useState<Stack | null>(null);
  const [backtest, setBacktest] = React.useState<BacktestView | null>(null);
  // The session trade config, edited in both config input groups below.
  // One stored value: replay and backtest derive from it, so they can never
  // silently disagree. Invalid input blocks actions; it never reaches an engine.
  const [draft, setDraft] = React.useState<TradeConfigDraft>(DEFAULT_TRADE_DRAFT);
  const trade = parseTradeConfig(draft);
  const tradeValid = trade.config !== null;
  const [playing, setPlaying] = React.useState(false);
  const [speed, setSpeed] = React.useState<ReplaySpeed>(1);
  const [state, setState] = React.useState<MarketState | null>(null);
  const [portfolioState, setPortfolioState] = React.useState<PortfolioState | null>(null);
  // Surfaced engine failures: runError renders inside the results panel as
  // "Backtest failed: …", runtimeError as the dismissible banner (replay stop
  // reason, rejected order intent). Neither is ever swallowed silently.
  const [runError, setRunError] = React.useState<string | null>(null);
  const [runtimeError, setRuntimeError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    let replay: ReplayController | null = null;
    const range = rangeFor(timeframe, Date.now());

    // A new selection means a new dataset: drop the previous stack so the
    // chart, replay, and portfolio can never show candles from two datasets.
    // The backtest report belongs to the previous dataset too, so it goes
    // with them.
    setStack(null);
    setState(null);
    setPortfolioState(null);
    setBacktest(null);
    setRunError(null);
    setRuntimeError(null);
    setPlaying(false);

    const manager = new BinanceDataManager({ symbol, timeframe, fetchKlines });
    const unsubscribe = manager.subscribe(setDataState);
    setDataState(manager.getState());

    manager
      .loadRange(range)
      .then(candles => {
        if (cancelled) return;
        const engine = new CandleMarketEngine(candles);
        const nextReplay = new ReplayController(engine);
        replay = nextReplay;
        // A stack created while the draft is invalid gets the zero-cost
        // defaults; trading stays disabled and the error stays visible until
        // the draft parses, at which point the effect below applies it live.
        const execution = new ExecutionEngine(toExecutionConfig(trade.config ?? DEFAULT_TRADE_CONFIG));
        const portfolio = new Portfolio(STARTING_CAPITAL);
        nextReplay.subscribe((s: MarketState) => {
          setState(s);
          const failure = syncFromMarketSafe(execution, portfolio, s);
          setPortfolioState(portfolio.getState());
          if (failure !== null) {
            // A drain failure would otherwise repeat silently on every tick.
            // Stop replay at the broken candle and say why; Reset recovers.
            nextReplay.pause();
            setRuntimeError(`Replay stopped: ${failure}`);
          }
        });
        nextReplay.subscribePlaying(setPlaying);
        nextReplay.reset(0);
        portfolio.markToMarket(engine.getState().candle.close);
        setPortfolioState(portfolio.getState());
        setStack({ engine, replay: nextReplay, execution, portfolio, candles });
      })
      .catch(() => {
        // The manager has already published status "error" plus its message;
        // the panel and chart placeholder read that state.
      });

    return () => {
      cancelled = true;
      unsubscribe();
      replay?.pause();
    };
  }, [symbol, timeframe]);

  React.useEffect(() => {
    if (!stack || !chartRef.current) return;
    const chart = createChart(chartRef.current, {
      layout: { background: { color: "#09090b" }, textColor: "#a1a1aa" },
      grid: { vertLines: { color: "#18181b" }, horzLines: { color: "#18181b" } },
      rightPriceScale: { borderColor: "#27272a" },
      timeScale: { borderColor: "#27272a", timeVisible: true }
    });
    const series = chart.addSeries(CandlestickSeries, {});
    // Volume gets its own pane: overlay scaleMargins are not honored for
    // overlay series in lightweight-charts v5, which left full-height volume
    // bars hiding the candles. A stretched pane confines volume structurally.
    const volumePane = chart.addPane();
    volumePane.setStretchFactor(0.18);
    const volume = volumePane.addSeries(HistogramSeries, { priceFormat: { type: "volume" } });
    chartApi.current = chart;
    candleSeries.current = series;
    volumeSeries.current = volume;
    const resize = () => chart.applyOptions({ width: chartRef.current?.clientWidth ?? 0, height: chartRef.current?.clientHeight ?? 0 });
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(chartRef.current);
    return () => {
      observer.disconnect();
      chartApi.current = null;
      candleSeries.current = null;
      volumeSeries.current = null;
      chart.remove();
    };
  }, [stack]);

  React.useEffect(() => {
    const series = candleSeries.current;
    const volume = volumeSeries.current;
    if (!series || !volume || !state) return;
    const points = toChartPoints(state.visibleCandles);
    series.setData(points.candles);
    volume.setData(points.volumes);
    // setData retains the prior viewport (library default). Reset must restore
    // zoom/scroll after the shrunk dataset lands, not before.
    if (pendingTimeScaleReset.current) {
      pendingTimeScaleReset.current = false;
      chartApi.current?.timeScale().resetTimeScale();
    }
    const chart = chartApi.current;
    if (chart !== null) {
      // A deferred seek-jump centers here, on the just-landed data.
      const target = pendingCenter.current;
      if (target !== null) {
        pendingCenter.current = null;
        centerTimeScale(chart, target, state.visibleCandles);
      }
      // Playback (or stepping) that has run past the view — e.g. after a jump
      // moved the viewport away from the right edge — follows the newest bar
      // again. Equal to or inside the range leaves the view untouched, so a
      // paused pan or a fresh jump center is never yanked away.
      const range = chart.timeScale().getVisibleRange();
      const pure = range === null ? null : { from: Number(range.from), to: Number(range.to) };
      if (shouldFollowEngine(state.candle.timestamp, pure)) chart.timeScale().scrollToRealTime();
    }
  }, [state]);

  React.useEffect(() => {
    stack?.replay.setSpeed(speed);
  }, [speed, stack]);

  // A valid edit applies to the running replay engine immediately; an
  // invalid one leaves the last valid config in place and disables every
  // action, so NaN or a negative can never reach the engine. Deps are the
  // raw draft strings — the parsed object is rebuilt every render.
  React.useEffect(() => {
    if (!stack || trade.config === null) return;
    stack.execution.updateConfig(toExecutionConfig(trade.config));
  }, [stack, draft.fee, draft.slippage, draft.size]);

  // The report chart lives in the results section's own container — its own
  // canvas, never the replay chart's — and remounts per run so each report
  // opens with a fresh time scale.
  React.useEffect(() => {
    if (backtest === null) return;
    const container = resultsChartRef.current;
    if (container === null) return;
    const mounted = mountResultsChart(container, backtest.candles, backtest.result.equityCurve);
    resultsChartApi.current = mounted.chart;
    return () => {
      resultsChartApi.current = null;
      mounted.dispose();
    };
  }, [backtest]);

  const changeSymbol = (next: SupportedSymbol) => {
    setSymbol(next);
    setDataState(emptyDataState(next, timeframe));
  };

  const changeTimeframe = (next: SupportedTimeframe) => {
    setTimeframe(next);
    setDataState(emptyDataState(symbol, next));
  };

  const loaded = stack !== null;
  const placeholder =
    dataState.status === "error"
      ? `Data failed to load: ${dataState.error ?? "unknown error"}`
      : `Loading ${symbol} ${timeframe} from ${DATA_API_URL}…`;
  const rangeLabel = dataState.loadedRange
    ? `${dateLabel(dataState.loadedRange.startTime)} → ${dateLabel(dataState.loadedRange.endTime)}`
    : "no range loaded";

  const reset = () => {
    if (!stack) return;
    // A deterministic restart recovers from a paused-by-failure replay; the
    // banner must not claim the fresh session is broken.
    setRuntimeError(null);
    stack.execution.reset();
    stack.portfolio.reset(STARTING_CAPITAL);
    pendingTimeScaleReset.current = true;
    stack.replay.reset(0);
    setState(stack.engine.getState());
    setPortfolioState(stack.portfolio.getState());
  };

  const togglePlaying = () => {
    if (!stack) return;
    if (playing) stack.replay.pause();
    else stack.replay.play();
  };

  const runBacktest = () => {
    if (!stack || trade.config === null) return;
    const outcome = tryRunEmaCrossBacktest(stack.candles, toBacktestConfig(trade.config, STARTING_CAPITAL));
    if (outcome.ok) {
      setRunError(null);
      setBacktest({ result: outcome.result, candles: stack.candles, symbol, timeframe });
    } else {
      // A failed run must never leave a stale report up or read as a
      // successful empty one: clear the view and show the reason in place.
      setBacktest(null);
      setRunError(outcome.message);
    }
  };

  const updateDraft = (field: TradeConfigField, value: string) => {
    setDraft(previous => ({ ...previous, [field]: value }));
  };

  const submitIntent = (side: "buy" | "sell") => {
    if (!stack || trade.config === null) return;
    try {
      executeManualIntent(stack.execution, stack.portfolio, stack.engine, {
        kind: "open",
        side,
        quantity: trade.config.size
      });
    } catch (error) {
      setRuntimeError(`Order failed: ${errorText(error)}`);
    } finally {
      // Always republish the live portfolio, so the footer can never keep
      // showing a pre-intent snapshot after a rejected intent.
      setPortfolioState(stack.portfolio.getState());
    }
  };

  const closePosition = () => {
    // Close never consults the draft: the intent uses the position's own
    // quantity, and the engine keeps its last valid config — an invalid Size
    // edit must not trap an open position (footer-gates keeps the button on).
    if (!stack) return;
    try {
      executeManualIntent(stack.execution, stack.portfolio, stack.engine, { kind: "close" });
    } catch (error) {
      setRuntimeError(`Order failed: ${errorText(error)}`);
    } finally {
      setPortfolioState(stack.portfolio.getState());
    }
  };

  const position = portfolioState?.position ?? null;
  const gates = footerGates({ loaded, tradeValid, hasPosition: position !== null });

  // Center `time` in a chart's viewport, keeping the current zoom (the visible
  // span) and never claiming time outside that chart's own data: a target past
  // the end clamps to the last candle, where a seek would land too.
  const centerTimeScale = (api: IChartApi, time: number, data: readonly Candle[]) => {
    if (data.length === 0) return;
    const first = data[0].timestamp;
    const last = data[data.length - 1].timestamp;
    const range = api.timeScale().getVisibleRange();
    const span = range === null ? last - first : Number(range.to) - Number(range.from);
    const target = centeredRange(time, first, last, span);
    if (target === null) return;
    api.timeScale().setVisibleRange({ from: target.from as UTCTimestamp, to: target.to as UTCTimestamp });
  };

  // A fill-row jump: pause first — a jump never plays — then per planJump
  // either scroll only (fill at or behind T, engine untouched) or fast-forward
  // every candle in between via fastForwardTo (stepped, so a failure mid-seek
  // pauses through the subscriber's existing "Replay stopped" path). T only
  // ever moves forward. Then center both charts on the fill.
  const jumpReplayTo = (time: number) => {
    if (!stack) return;
    stack.replay.pause();
    if (planJump(state?.candle.timestamp ?? null, time) === "seek+scroll") {
      stack.replay.fastForwardTo(time);
    }
    const after = stack.engine.getState();
    const chart = chartApi.current;
    if (chart !== null) {
      // Centering aims at the chart's series data: that data is current after
      // a scroll (engine untouched) but stale after a seek until the data
      // effect below lands the new candles — defer in that case.
      const dataCurrent = state !== null && state.candle.timestamp === after.candle.timestamp;
      if (dataCurrent) centerTimeScale(chart, time, after.visibleCandles);
      else pendingCenter.current = time;
    }
    if (resultsChartApi.current !== null && backtest !== null) {
      centerTimeScale(resultsChartApi.current, time, backtest.candles);
    }
  };

  return <div className="app">
    <header>
      <div><strong>Trading Research</strong><span className="badge">REPLAY</span></div>
      <div className="selectors">
        <select aria-label="Symbol" value={symbol} onChange={e => changeSymbol(e.target.value as SupportedSymbol)}>
          {SUPPORTED_SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          aria-label="Timeframe"
          value={timeframe}
          onChange={e => changeTimeframe(e.target.value as SupportedTimeframe)}
        >
          {SUPPORTED_TIMEFRAMES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="symbol">{symbol} / {timeframe} · {rangeLabel}</div>
    </header>
    <div className="runtime-error-slot">
      {runtimeError !== null && (
        <RuntimeErrorBanner message={runtimeError} onDismiss={() => setRuntimeError(null)} />
      )}
    </div>
    <main>
      <section className="chart-shell">
        <div ref={chartRef} className="chart" />
        {!loaded && <div className="chart-placeholder">{placeholder}</div>}
      </section>
      <ResultsPanel
        view={backtest}
        loaded={loaded}
        onRun={runBacktest}
        chartRef={resultsChartRef}
        draft={draft}
        configErrors={trade.errors}
        configValid={tradeValid}
        runError={runError}
        onDraftChange={updateDraft}
        replayTime={state?.candle.timestamp ?? null}
        onJumpToTime={stack !== null ? jumpReplayTo : undefined}
      />
      <aside className="data-panel">
        <h2>Data Manager</h2>
        <dl>
          <dt>Symbol</dt><dd>{dataState.symbol}</dd>
          <dt>Timeframe</dt><dd>{dataState.timeframe}</dd>
          <dt>Range</dt><dd>{rangeLabel}</dd>
          <dt>Candles</dt><dd>{dataState.loadedRange ? dataState.candleCount : "—"}</dd>
          <dt>Status</dt><dd className={`status status-${dataState.status}`}>{dataState.status}</dd>
          {dataState.error !== null && <>
            <dt>Error</dt><dd className="status status-error">{dataState.error}</dd>
          </>}
        </dl>
      </aside>
    </main>
    <footer>
      <button onClick={reset} disabled={gates.reset} className="btn-danger">↺ Reset</button>
      <button onClick={togglePlaying} disabled={gates.play}>{playing ? "Pause" : "Play"}</button>
      <button onClick={() => stack?.replay.step()} disabled={gates.step}>Step</button>
      <button onClick={() => submitIntent("buy")} disabled={gates.buy}>Buy</button>
      <button onClick={() => submitIntent("sell")} disabled={gates.sell}>Sell</button>
      <button onClick={closePosition} disabled={gates.close}>Close</button>
      <ConfigInputs draft={draft} errors={trade.errors} onChange={updateDraft} />
      <div className="speeds">{([1, 2, 5, 10] as const).map(s => <button className={speed === s ? "active" : ""} key={s} onClick={() => setSpeed(s)}>{s}x</button>)}</div>
      <div className="time">{state ? dateLabel(state.candle.timestamp * 1000) : "—"}</div>
      <div className="time">{portfolioLabel(stack, state, portfolioState)}</div>
    </footer>
  </div>;
}

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
