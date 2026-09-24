import React from "react";
import { createRoot } from "react-dom/client";
import { createChart, CandlestickSeries, HistogramSeries, type IChartApi, type ISeriesApi } from "lightweight-charts";
import { BinanceDataManager } from "@trading-research/data";
import { CandleMarketEngine } from "@trading-research/engine";
import { ExecutionEngine } from "@trading-research/execution";
import { Portfolio, type PortfolioState } from "@trading-research/portfolio";
import { ReplayController, type ReplaySpeed } from "@trading-research/replay";
import type { MarketState } from "@trading-research/shared";
import { BTCUSDT_5M_KLINES } from "./btcusdt-5m-sample";
import "./styles.css";

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
  symbol: "BTCUSDT",
  timeframe: "5m",
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
  const chartApi = React.useRef<IChartApi | null>(null);
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
        const portfolio = new Portfolio(10000);
        replay.subscribe((s: MarketState) => {
          setState(s);
          for (const fill of execution.process(s)) portfolio.applyFill(fill);
          portfolio.markToMarket(s.candle.close);
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
    if (!chartRef.current) return;
    const chart = createChart(chartRef.current, {
      layout: { background: { color: "#09090b" }, textColor: "#a1a1aa" },
      grid: { vertLines: { color: "#18181b" }, horzLines: { color: "#18181b" } },
      rightPriceScale: { borderColor: "#27272a" },
      timeScale: { borderColor: "#27272a", timeVisible: true }
    });
    const series = chart.addSeries(CandlestickSeries, {});
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "" });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chartApi.current = chart;
    candleSeries.current = series;
    volumeSeries.current = volume;
    const resize = () => chart.applyOptions({ width: chartRef.current?.clientWidth ?? 0, height: chartRef.current?.clientHeight ?? 0 });
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(chartRef.current);
    return () => { observer.disconnect(); chart.remove(); chartApi.current = null; };
  }, []);

  React.useEffect(() => {
    const series = candleSeries.current;
    const volume = volumeSeries.current;
    if (!series || !volume || !state) return;
    series.setData(state.visibleCandles.map(c => ({ time: c.timestamp as any, open: c.open, high: c.high, low: c.low, close: c.close })));
    volume.setData(state.visibleCandles.map(c => ({ time: c.timestamp as any, value: c.volume })));
  }, [state]);

  React.useEffect(() => {
    stack?.replay.setSpeed(speed);
  }, [speed, stack]);

  if (error) {
    return <div className="app"><header><div><strong>Trading Research</strong></div></header><main><p>Data failed to load: {error}</p></main></div>;
  }

  if (!stack || !state || !portfolioState) {
    return <div className="app"><header><div><strong>Trading Research</strong></div></header><main><p>Loading BTCUSDT 5m…</p></main></div>;
  }

  const { engine, replay, execution, portfolio } = stack;

  const reset = () => {
    execution.reset();
    portfolio.reset(10000);
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
    const current = engine.getState();
    for (const fill of execution.process(current)) portfolio.applyFill(fill);
    portfolio.markToMarket(current.candle.close);
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
    const current = engine.getState();
    for (const fill of execution.process(current)) portfolio.applyFill(fill);
    portfolio.markToMarket(current.candle.close);
    setPortfolioState(portfolio.getState());
  };

  const position = portfolioState.position;
  const unrealized = position === null ? 0 : portfolio.unrealizedAt(state.candle.close);

  return <div className="app">
    <header>
      <div><strong>Trading Research</strong><span className="badge">REPLAY</span></div>
      <div className="symbol">BTCUSDT / 5m · {rangeLabel()}</div>
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
