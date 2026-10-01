import React from "react";
import { createRoot } from "react-dom/client";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp
} from "lightweight-charts";
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
import { replayCaption } from "./chart-captions";
import { dataErrorDetail, friendlyDataError } from "./data-copy";
import { ErrorBoundary } from "./error-boundary";
import { footerGates } from "./footer-gates";
import { jumpMarker, type ChartMarker } from "./fill-markers";
import { executeManualIntent } from "./intents";
import { EmptyState } from "./empty-state";
import { nameAttribution } from "./attribution";
import { keyToAction, type ShortcutAction } from "./key-to-action";
import { planJump, type JumpPlan } from "./jump-plan";
import { pnlSignClass } from "./report-format";
import { syncFromMarketSafe } from "./replay-sync";
import { mountResultsChart } from "./results-chart";
import { ResultsPanel, type BacktestView } from "./results-panel";
import { tryRunEmaCrossBacktest } from "./run-backtest";
import { RuntimeErrorBanner } from "./runtime-error";
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

/**
 * The footer stat blocks, as labeled values: same numbers the old
 * pipe-separated readout showed, but each in its own slot. Null (no stack
 * yet) renders dashes so the slots keep their shape. Pure formatting.
 */
function portfolioStats(stack: Stack | null, state: MarketState | null, portfolioState: PortfolioState | null): {
  position: string;
  realized: string;
  unrealized: string;
  equity: string;
  realizedValue: number;
  unrealizedValue: number;
} {
  if (!stack || !state || !portfolioState) {
    return { position: "—", realized: "—", unrealized: "—", equity: "—", realizedValue: 0, unrealizedValue: 0 };
  }
  const position = portfolioState.position;
  const unrealized = position === null ? 0 : stack.portfolio.unrealizedAt(state.candle.close);
  return {
    position: position === null ? "flat" : `${position.side} ${position.quantity} @ ${position.entryPrice.toFixed(2)}`,
    realized: portfolioState.realizedPnl.toFixed(2),
    unrealized: unrealized.toFixed(2),
    equity: portfolioState.equity.toFixed(2),
    realizedValue: portfolioState.realizedPnl,
    unrealizedValue: unrealized
  };
}

function App() {
  const chartRef = React.useRef<HTMLDivElement>(null);
  const chartApi = React.useRef<IChartApi | null>(null);
  const candleSeries = React.useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeries = React.useRef<ISeriesApi<"Histogram"> | null>(null);
  const resultsChartRef = React.useRef<HTMLDivElement>(null);
  const resultsChartApi = React.useRef<IChartApi | null>(null);
  // Jump-landing markers on both charts: the replay chart's marker plugin is
  // created with its series (and re-applied after every data landing, since
  // setData can repaint the series), the results chart's arrives with its
  // mount. Both are setters so a stale chart can never be marked into.
  const candleMarkers = React.useRef<((markers: readonly ChartMarker[]) => void) | null>(null);
  const resultsJumpMarker = React.useRef<((marker: ChartMarker | null) => void) | null>(null);
  /** The last fill-row jump: its marker and the current-row highlight. */
  const [lastJump, setLastJump] = React.useState<{ time: number; plan: JumpPlan } | null>(null);
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
  // The session trade config, edited in the results panel's config group.
  // One stored value: replay and backtest derive from it, so they can never
  // silently disagree. Invalid input blocks actions; it never reaches an engine.
  const [draft, setDraft] = React.useState<TradeConfigDraft>(DEFAULT_TRADE_DRAFT);
  const trade = parseTradeConfig(draft);
  const tradeValid = trade.config !== null;
  // Bumped by the placeholder's Retry button: re-runs the load effect for the
  // current symbol/timeframe after a failed fetch.
  const [reloadNonce, setReloadNonce] = React.useState(0);
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
    // with them — and so does any fill-row jump: a landing marker or a
    // deferred centre aimed at the old candle grid must not survive into the
    // new one.
    setStack(null);
    setState(null);
    setPortfolioState(null);
    setBacktest(null);
    setRunError(null);
    setRuntimeError(null);
    setLastJump(null);
    pendingCenter.current = null;
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
  }, [symbol, timeframe, reloadNonce]);

  React.useEffect(() => {
    if (!stack || !chartRef.current) return;
    const chart = createChart(chartRef.current, {
      layout: { background: { color: "#09090b" }, textColor: "#a1a1aa" },
      grid: { vertLines: { color: "#18181b" }, horzLines: { color: "#18181b" } },
      // F25: reserve width for the widest price label and a few bars past the
      // newest one, so the right-edge price and time labels are never clipped
      // by the panel border.
      rightPriceScale: { borderColor: "#27272a", minimumWidth: 60 },
      timeScale: { borderColor: "#27272a", timeVisible: true, rightOffset: 4 }
    });
    const stopAttribution = nameAttribution(chartRef.current);
    const series = chart.addSeries(CandlestickSeries, {});
    // Volume gets its own pane: overlay scaleMargins are not honored for
    // overlay series in lightweight-charts v5, which left full-height volume
    // bars hiding the candles. A stretched pane confines volume structurally.
    const volumePane = chart.addPane();
    volumePane.setStretchFactor(0.18);
    const volume = volumePane.addSeries(HistogramSeries, { priceFormat: { type: "volume" } });
    // F25: the volume axis label ("400") needs its own reserved width too.
    volume.priceScale().applyOptions({ minimumWidth: 44 });
    const markers = createSeriesMarkers(series, []);
    candleMarkers.current = next => {
      markers.setMarkers([...next]);
    };
    chartApi.current = chart;
    candleSeries.current = series;
    volumeSeries.current = volume;
    const resize = () => chart.applyOptions({ width: chartRef.current?.clientWidth ?? 0, height: chartRef.current?.clientHeight ?? 0 });
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(chartRef.current);
    return () => {
      observer.disconnect();
      stopAttribution();
      candleMarkers.current = null;
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
      // The jump marker is (re)applied after every landing: a seek's marker
      // only becomes plottable once the target candle is in the series, and
      // setData may repaint it away. Scroll-only jumps set theirs directly in
      // the click handler; this keeps either kind attached.
      if (lastJump !== null) candleMarkers.current?.([jumpMarker(lastJump.time, lastJump.plan)]);
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
  // opens with a fresh time scale and its fill arrows; the jump-marker setter
  // that arrives with the mount re-attaches the current landing (if any).
  React.useEffect(() => {
    if (backtest === null) return;
    const container = resultsChartRef.current;
    if (container === null) return;
    const mounted = mountResultsChart(container, backtest.candles, backtest.result.fills, backtest.result.equityCurve);
    resultsChartApi.current = mounted.chart;
    resultsJumpMarker.current = mounted.setJumpMarker;
    if (lastJump !== null) mounted.setJumpMarker(jumpMarker(lastJump.time, lastJump.plan));
    return () => {
      resultsJumpMarker.current = null;
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
  // F20: a data-consuming action is enabled only once the dataset has fully
  // landed — a stack mid-fetch or in error state never gates Run.
  const ready = loaded && dataState.status === "ready";
  const rangeLabel = dataState.loadedRange ? (
    <>
      <span className="nb">{dateLabel(dataState.loadedRange.startTime)}</span>
      {" → "}
      <span className="nb">{dateLabel(dataState.loadedRange.endTime)} UTC</span>
    </>
  ) : (
    "no range loaded"
  );

  const reset = () => {
    if (!stack) return;
    // A deterministic restart recovers from a paused-by-failure replay; the
    // banner must not claim the fresh session is broken.
    setRuntimeError(null);
    // The jump landing (marker + current row) belongs to the session that
    // made it; a restart clears both charts and the highlight — and any
    // center a seek staged but whose data never landed (A4-1).
    setLastJump(null);
    pendingCenter.current = null;
    candleMarkers.current?.([]);
    resultsJumpMarker.current?.(null);
    stack.execution.reset();
    stack.portfolio.reset(STARTING_CAPITAL);
    pendingTimeScaleReset.current = true;
    stack.replay.reset(0);
    setState(stack.engine.getState());
    setPortfolioState(stack.portfolio.getState());
  };

  const togglePlaying = () => {
    // Keyboard shortcuts call this too — the gate is inside, not on the
    // button, so a key can never do what the disabled control refuses.
    if (!stack || gates.play) return;
    if (playing) stack.replay.pause();
    else stack.replay.play();
  };

  const stepReplay = () => {
    if (!stack || gates.step) return;
    stack.replay.step();
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
  const gates = footerGates({ loaded: ready, tradeValid, hasPosition: position !== null });
  // F26/F30: name the two dead states a paused chart can't explain itself —
  // a fresh session and a finished one — so neither looks like a broken or
  // manually paused run.
  const caption = stack !== null && state !== null
    ? replayCaption({ index: state.index, playing, finished: stack.engine.finished() })
    : null;
  const footerStats = portfolioStats(stack, state, portfolioState);

  // F31: playback shortcuts. keyToAction decides which key means what — and
  // which the focused widget keeps for itself — while this effect only
  // performs the action, through the same gated handlers the footer buttons
  // use. The latest-handler ref keeps one stable listener with no stale
  // closure (client-only render, so assigning during render is safe).
  const performShortcut = React.useRef<(action: ShortcutAction) => void>(() => {});
  performShortcut.current = action => {
    if (action === "toggle") togglePlaying();
    else stepReplay();
  };
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = keyToAction(event);
      if (action === null) return;
      event.preventDefault();
      performShortcut.current(action);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
    const plan = planJump(state?.candle.timestamp ?? null, time);
    // Record the landing before acting: the data effect re-attaches this
    // marker once a seek's candles land, and the current-row highlight reads
    // the same state. Scroll-only jumps mark immediately (their data is
    // already there); a seek's marker waits for the effect so its time never
    // points at a series that does not contain it yet.
    setLastJump({ time, plan });
    if (plan === "seek+scroll") {
      stack.replay.fastForwardTo(time);
    } else if (state !== null) {
      candleMarkers.current?.([jumpMarker(time, plan)]);
    }
    resultsJumpMarker.current?.(jumpMarker(time, plan));
    const after = stack.engine.getState();
    const chart = chartApi.current;
    if (chart !== null) {
      // Centering aims at the chart's series data: that data is current after
      // a scroll (engine untouched) but stale after a seek until the data
      // effect below lands the new candles — defer in that case.
      const dataCurrentAfter = state !== null && state.candle.timestamp === after.candle.timestamp;
      if (dataCurrentAfter) centerTimeScale(chart, time, after.visibleCandles);
      else pendingCenter.current = time;
    }
    if (resultsChartApi.current !== null && backtest !== null) {
      centerTimeScale(resultsChartApi.current, time, backtest.candles);
    }
  };

  return <div className="app">
    <header className="card">
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
      <section className="chart-shell card">
        <div ref={chartRef} className="chart" />
        {caption !== null && state !== null && (
          <div className="chart-empty">
            <EmptyState
              icon="▶"
              title={caption}
              body={
                state.index === 0
                  ? "Press Play or Step to advance the replay one candle at a time."
                  : "The replay has run out of candles. Reset to start over, or scroll back to review."
              }
            />
          </div>
        )}
        {!loaded && (
          <div className="chart-placeholder">
            {dataState.status === "error" ? (
              <EmptyState
                icon="!"
                title="Data failed to load"
                body={friendlyDataError(dataState.error)}
                actions={
                  <button type="button" className="btn-secondary" onClick={() => setReloadNonce(n => n + 1)}>
                    Retry
                  </button>
                }
              />
            ) : (
              <EmptyState icon="…" title={`Loading ${symbol} ${timeframe}…`} />
            )}
          </div>
        )}
      </section>
      <ResultsPanel
        view={backtest}
        loaded={ready}
        onRun={runBacktest}
        chartRef={resultsChartRef}
        draft={draft}
        configErrors={trade.errors}
        configValid={tradeValid}
        runError={runError}
        onDraftChange={updateDraft}
        replayTime={state?.candle.timestamp ?? null}
        onJumpToTime={stack !== null ? jumpReplayTo : undefined}
        hasPosition={position !== null}
        activeTime={lastJump?.time ?? null}
      />
      <aside className="data-panel card">
        <h2>Data Manager</h2>
        <dl>
          <dt>Symbol</dt><dd>{dataState.symbol}</dd>
          <dt>Timeframe</dt><dd>{dataState.timeframe}</dd>
          <dt>Data window</dt><dd>{rangeLabel}</dd>
          <dt>Candles</dt><dd>{dataState.loadedRange ? dataState.candleCount : "—"}</dd>
          <dt>Status</dt><dd className={`status status-${dataState.status}`}>{dataState.status}</dd>
          {dataState.error !== null && <>
            <dt>Error</dt>
            <dd className="status status-error">
              {friendlyDataError(dataState.error)}
              {dataErrorDetail(dataState.error) !== null && (
                <span className="detail"> ({dataErrorDetail(dataState.error)})</span>
              )}
            </dd>
          </>}
        </dl>
      </aside>
    </main>
    <footer className="card">
      <button onClick={reset} disabled={gates.reset} className="btn-danger">↺ Reset</button>
      <button onClick={togglePlaying} disabled={gates.play} className="btn-primary">{playing ? "Pause" : "Play"}</button>
      <button onClick={stepReplay} disabled={gates.step}>Step</button>
      <button onClick={() => submitIntent("buy")} disabled={gates.buy}>Buy</button>
      <button onClick={() => submitIntent("sell")} disabled={gates.sell}>Sell</button>
      <button onClick={closePosition} disabled={gates.close}>Close</button>
      <div className="speeds">{([1, 2, 5, 10] as const).map(s => <button className={speed === s ? "active" : ""} key={s} onClick={() => setSpeed(s)}>{s}x</button>)}</div>
      <div className="time">{state ? `${dateLabel(state.candle.timestamp * 1000)} UTC` : "—"}</div>
      <div className="time readout footer-stats">
        <div className="stat"><span>Position</span><b className="nb">{footerStats.position}</b></div>
        <div className="stat"><span>Realized</span><b className={pnlSignClass(footerStats.realizedValue)}>{footerStats.realized}</b></div>
        <div className="stat"><span>Unrealized</span><b className={pnlSignClass(footerStats.unrealizedValue)}>{footerStats.unrealized}</b></div>
        <div className="stat"><span>Equity</span><b className="nb">{footerStats.equity}</b></div>
      </div>
    </footer>
  </div>;
}

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
