import React from "react";
import { createRoot } from "react-dom/client";
import { createChart, CandlestickSeries, HistogramSeries, type ISeriesApi } from "lightweight-charts";
import { BinanceDataManager } from "@trading-research/data";
import { CandleMarketEngine } from "@trading-research/engine";
import { ExecutionEngine } from "@trading-research/execution";
import { Portfolio, type PortfolioState } from "@trading-research/portfolio";
import { ReplayController, type ReplaySpeed } from "@trading-research/replay";
import type { MarketState } from "@trading-research/shared";
import { BTCUSDT_5M_KLINES, BTCUSDT_5M_META } from "./btcusdt-5m-sample";
import { toChartPoints } from "./chart-points";
import { syncFromMarket } from "./replay-sync";
import "./styles.css";

const STARTING_CAPITAL = 10000;

const RANGE = {
  startTime: BTCUSDT_5M_KLINES[0][0],
  endTime: BTCUSDT_5M_KLINES[BTCUSDT_5M_KLINES.length - 1][0]
};

// Static snapshot transport: same DataManager code path as live data, but the
// browser performs zero exchange calls. Live fetching arrives with the Data
// Service; the replay machinery underneath stays identical.
async function fetchStaticKlines({ startTime, endTime }: { startTime: number; endTime: number }) {
  return BTCUSDT_5M_KLINES.filter(r => r[0] >= startTime && r[0] <= endTime);
}

const dataManager = new BinanceDataManager({
  symbol: BTCUSDT_5M_META.symbol,
  timeframe: BTCUSDT_5M_META.timeframe,
  fetchKlines: fetchStaticKlines
});

interface Stack {
  engine: CandleMarketEngine;
  replay: ReplayController;
  execution: ExecutionEngine;
  portfolio: Portfolio;
}

function rangeLabel(): string {
  const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return `${fmt(RANGE.startTime)} → ${fmt(RANGE.endTime)}`;
}

function App() {
  const chartRef = React.useRef<HTMLDivElement>(null);
  const candleSeries = React.useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeries = React.useRef<ISeriesApi<"Histogram"> | null>(null);
  const [stack, setStack] = React.useState<Stack | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [playing, setPlaying] = React.useState(false);
  const [speed, setSpeed] = React.useState<ReplaySpeed>(1);
  const [state, setState] = React.useState<MarketState | null>(null);
  const [portfolioState, setPortfolioState] = React.useState<PortfolioState | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    let replay: ReplayController | null = null;
    dataManager
      .loadRange(RANGE)
      .then(candles => {
        if (cancelled) return;
        const engine = new CandleMarketEngine(candles);
        replay = new ReplayController(engine);
        const execution = new ExecutionEngine({ feePerUnit: 0, slippagePerUnit: 0 });
        const portfolio = new Portfolio(STARTING_CAPITAL);
        replay.subscribe((s: MarketState) => {
          setState(s);
          syncFromMarket(execution, portfolio, s);
          setPortfolioState(portfolio.getState());
        });
        replay.subscribePlaying(setPlaying);
        replay.reset(0);
        portfolio.markToMarket(engine.getState().candle.close);
        setPortfolioState(portfolio.getState());
        setStack({ engine, replay, execution, portfolio });
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
      replay?.pause();
    };
  }, []);

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
    candleSeries.current = series;
    volumeSeries.current = volume;
    const resize = () => chart.applyOptions({ width: chartRef.current?.clientWidth ?? 0, height: chartRef.current?.clientHeight ?? 0 });
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(chartRef.current);
    return () => { observer.disconnect(); chart.remove(); };
  }, [stack]);

  React.useEffect(() => {
    const series = candleSeries.current;
    const volume = volumeSeries.current;
    if (!series || !volume || !state) return;
    const points = toChartPoints(state.visibleCandles);
    series.setData(points.candles);
    volume.setData(points.volumes);
  }, [state]);

  React.useEffect(() => {
    stack?.replay.setSpeed(speed);
  }, [speed, stack]);

  if (error) {
    return <div className="app"><header><div><strong>Trading Research</strong></div></header><main><p>Data failed to load: {error}</p></main></div>;
  }

  if (!stack || !state || !portfolioState) {
    return <div className="app"><header><div><strong>Trading Research</strong></div></header><main><p>Loading {BTCUSDT_5M_META.symbol} {BTCUSDT_5M_META.timeframe}…</p></main></div>;
  }

  const { engine, replay, execution, portfolio } = stack;

  const reset = () => {
    execution.reset();
    portfolio.reset(STARTING_CAPITAL);
    replay.reset(0);
    setState(engine.getState());
    setPortfolioState(portfolio.getState());
  };

  const togglePlaying = () => {
    if (playing) replay.pause();
    else replay.play();
  };

  const submitIntent = (side: "buy" | "sell") => {
    if (portfolioState.position !== null) return;
    const id = execution.nextOrderId("manual");
    execution.submit({ id, side, quantity: 1, fillMode: "close" }, engine.getState().index);
    syncFromMarket(execution, portfolio, engine.getState());
    setPortfolioState(portfolio.getState());
  };

  const closePosition = () => {
    const position = portfolioState.position;
    if (position === null) return;
    const id = execution.nextOrderId("manual");
    execution.submit(
      { id, side: position.side === "long" ? "sell" : "buy", quantity: position.quantity, fillMode: "close", reduceOnly: true },
      engine.getState().index
    );
    syncFromMarket(execution, portfolio, engine.getState());
    setPortfolioState(portfolio.getState());
  };

  const position = portfolioState.position;
  const unrealized = position === null ? 0 : portfolio.unrealizedAt(state.candle.close);

  return <div className="app">
    <header>
      <div><strong>Trading Research</strong><span className="badge">REPLAY</span></div>
      <div className="symbol">{BTCUSDT_5M_META.symbol} / {BTCUSDT_5M_META.timeframe} · {rangeLabel()}</div>
    </header>
    <main><section className="chart-shell"><div ref={chartRef} className="chart" /></section></main>
    <footer>
      <button onClick={reset}>↺ Reset</button>
      <button onClick={togglePlaying}>{playing ? "Pause" : "Play"}</button>
      <button onClick={() => replay.step()}>Step</button>
      <button onClick={() => submitIntent("buy")} disabled={position !== null}>Buy</button>
      <button onClick={() => submitIntent("sell")} disabled={position !== null}>Sell</button>
      <button onClick={closePosition} disabled={position === null}>Close</button>
      <div className="speeds">{([1, 2, 5, 10] as const).map(s => <button className={speed === s ? "active" : ""} key={s} onClick={() => setSpeed(s)}>{s}x</button>)}</div>
      <div className="time">{new Date(state.candle.timestamp * 1000).toISOString().slice(0, 16).replace("T", " ")}</div>
      <div className="time">Pos {position === null ? "flat" : `${position.side} ${position.quantity} @ ${position.entryPrice.toFixed(2)}`} | R {portfolioState.realizedPnl.toFixed(2)} | U {unrealized.toFixed(2)} | Eq {portfolioState.equity.toFixed(2)}</div>
    </footer>
  </div>;
}

createRoot(document.getElementById("root")!).render(<App />);
