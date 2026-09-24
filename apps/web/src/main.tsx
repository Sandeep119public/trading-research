import React from "react";
import { createRoot } from "react-dom/client";
import { createChart, CandlestickSeries, HistogramSeries, type IChartApi, type ISeriesApi } from "lightweight-charts";
import { CandleMarketEngine } from "@trading-research/engine";
import { ExecutionEngine } from "@trading-research/execution";
import { Portfolio, type PortfolioState } from "@trading-research/portfolio";
import { ReplayController, type ReplaySpeed } from "@trading-research/replay";
import type { Candle, MarketState } from "@trading-research/shared";
import "./styles.css";

const candles: Candle[] = Array.from({ length: 240 }, (_, i) => {
  const base = 100 + Math.sin(i / 13) * 4 + i * 0.025;
  const open = base + Math.sin(i * 1.7) * 0.7;
  const close = base + Math.cos(i * 1.3) * 0.8;
  const high = Math.max(open, close) + 0.6 + (i % 7) * 0.08;
  const low = Math.min(open, close) - 0.6 - (i % 5) * 0.07;
  return { timestamp: 1700000000 + i * 300, open, high, low, close, volume: 100 + (i % 23) * 8 };
});

const engine = new CandleMarketEngine(candles);
const replay = new ReplayController(engine);
const execution = new ExecutionEngine({ feePerUnit: 0, slippagePerUnit: 0 });
const portfolio = new Portfolio(10000);
replay.reset(0);
const initialState = engine.getState();
const initialPortfolio = portfolio.getState();
portfolio.markToMarket(initialState.candle.close);

function App() {
  const chartRef = React.useRef<HTMLDivElement>(null);
  const chartApi = React.useRef<IChartApi | null>(null);
  const candleSeries = React.useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeries = React.useRef<ISeriesApi<"Histogram"> | null>(null);
  const [playing, setPlaying] = React.useState(replay.playing);
  const [speed, setSpeed] = React.useState<ReplaySpeed>(1);
  const [state, setState] = React.useState<MarketState>(initialState);
  const [portfolioState, setPortfolioState] = React.useState<PortfolioState>(() => portfolio.getState());
  const orderSeq = React.useRef(1);

  const handleMarket = React.useCallback((s: MarketState) => {
    setState(s);
    for (const fill of execution.process(s)) portfolio.applyFill(fill);
    portfolio.markToMarket(s.candle.close);
    setPortfolioState(portfolio.getState());
  }, []);

  React.useEffect(() => replay.subscribe(handleMarket), [handleMarket]);
  React.useEffect(() => replay.subscribePlaying(setPlaying), []);

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
    if (!series || !volume) return;
    series.setData(state.visibleCandles.map(c => ({ time: c.timestamp as any, open: c.open, high: c.high, low: c.low, close: c.close })));
    volume.setData(state.visibleCandles.map(c => ({ time: c.timestamp as any, value: c.volume })));
  }, [state]);

  React.useEffect(() => {
    replay.setSpeed(speed);
  }, [speed]);

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
    const position = portfolioState.position;
    if (position !== null) return;
    const id = `manual-${orderSeq.current++}`;
    execution.submit({ id, side, quantity: 1, fillMode: "close" }, engine.getState().index);
    const current = engine.getState();
    for (const fill of execution.process(current)) portfolio.applyFill(fill);
    portfolio.markToMarket(current.candle.close);
    setPortfolioState(portfolio.getState());
  };

  const closePosition = () => {
    const position = portfolioState.position;
    if (position === null) return;
    const id = `manual-${orderSeq.current++}`;
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
      <div className="symbol">SYNTH / 5m</div>
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
