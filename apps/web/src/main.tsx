import React from "react";
import { createRoot } from "react-dom/client";
import { createChart, CandlestickSeries, HistogramSeries, type IChartApi, type ISeriesApi } from "lightweight-charts";
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
import { syncFromMarket } from "./replay-sync";
import { mountResultsChart } from "./results-chart";
import { ResultsPanel, type BacktestView } from "./results-panel";
import { runEmaCrossBacktest } from "./run-backtest";
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
  const pendingTimeScaleReset = React.useRef(false);

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
          syncFromMarket(execution, portfolio, s);
          setPortfolioState(portfolio.getState());
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
    return mountResultsChart(container, backtest.candles, backtest.result.equityCurve);
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
    const result = runEmaCrossBacktest(stack.candles, toBacktestConfig(trade.config, STARTING_CAPITAL));
    setBacktest({ result, candles: stack.candles, symbol, timeframe });
  };

  const updateDraft = (field: TradeConfigField, value: string) => {
    setDraft(previous => ({ ...previous, [field]: value }));
  };

  const submitIntent = (side: "buy" | "sell") => {
    if (!stack || !portfolioState || portfolioState.position !== null || trade.config === null) return;
    const id = stack.execution.nextOrderId("manual");
    stack.execution.submit({ id, side, quantity: trade.config.size, fillMode: "close" }, stack.engine.getState().index);
    syncFromMarket(stack.execution, stack.portfolio, stack.engine.getState());
    setPortfolioState(stack.portfolio.getState());
  };

  const closePosition = () => {
    if (!stack || !portfolioState || trade.config === null) return;
    const position = portfolioState.position;
    if (position === null) return;
    const id = stack.execution.nextOrderId("manual");
    stack.execution.submit(
      { id, side: position.side === "long" ? "sell" : "buy", quantity: position.quantity, fillMode: "close", reduceOnly: true },
      stack.engine.getState().index
    );
    syncFromMarket(stack.execution, stack.portfolio, stack.engine.getState());
    setPortfolioState(stack.portfolio.getState());
  };

  const position = portfolioState?.position ?? null;

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
        onDraftChange={updateDraft}
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
      <button onClick={reset} disabled={!loaded}>↺ Reset</button>
      <button onClick={togglePlaying} disabled={!loaded}>{playing ? "Pause" : "Play"}</button>
      <button onClick={() => stack?.replay.step()} disabled={!loaded}>Step</button>
      <button onClick={() => submitIntent("buy")} disabled={!loaded || !tradeValid || position !== null}>Buy</button>
      <button onClick={() => submitIntent("sell")} disabled={!loaded || !tradeValid || position !== null}>Sell</button>
      <button onClick={closePosition} disabled={!loaded || !tradeValid || position === null}>Close</button>
      <ConfigInputs draft={draft} errors={trade.errors} onChange={updateDraft} />
      <div className="speeds">{([1, 2, 5, 10] as const).map(s => <button className={speed === s ? "active" : ""} key={s} onClick={() => setSpeed(s)}>{s}x</button>)}</div>
      <div className="time">{state ? dateLabel(state.candle.timestamp * 1000) : "—"}</div>
      <div className="time">{portfolioLabel(stack, state, portfolioState)}</div>
    </footer>
  </div>;
}

createRoot(document.getElementById("root")!).render(<App />);
