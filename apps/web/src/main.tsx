import React from "react";
import { createRoot } from "react-dom/client";
import { createChart, CandlestickSeries, HistogramSeries, type IChartApi, type ISeriesApi } from "lightweight-charts";
import { CandleMarketEngine } from "@trading-research/engine";
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
replay.reset(0);
const initialState = engine.getState();

function App() {
  const chartRef = React.useRef<HTMLDivElement>(null);
  const chartApi = React.useRef<IChartApi | null>(null);
  const candleSeries = React.useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeries = React.useRef<ISeriesApi<"Histogram"> | null>(null);
  const [playing, setPlaying] = React.useState(false);
  const [speed, setSpeed] = React.useState<ReplaySpeed>(1);
  const [state, setState] = React.useState<MarketState>(initialState);

  React.useEffect(() => replay.subscribe(setState), []);

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
    if (playing) replay.play();
    else replay.pause();
  }, [playing]);

  React.useEffect(() => {
    replay.setSpeed(speed);
  }, [speed]);

  const reset = () => {
    replay.reset(0);
    setPlaying(false);
    setState(engine.getState());
  };

  return <div className="app">
    <header>
      <div><strong>Trading Research</strong><span className="badge">REPLAY</span></div>
      <div className="symbol">SYNTH / 5m</div>
    </header>
    <main><section className="chart-shell"><div ref={chartRef} className="chart" /></section></main>
    <footer>
      <button onClick={reset}>↺ Reset</button>
      <button onClick={() => setPlaying(v => !v)}>{playing ? "Pause" : "Play"}</button>
      <button onClick={() => replay.step()}>Step</button>
      <div className="speeds">{([1, 2, 5, 10] as const).map(s => <button className={speed === s ? "active" : ""} key={s} onClick={() => setSpeed(s)}>{s}x</button>)}</div>
      <div className="time">{new Date(state.candle.timestamp * 1000).toISOString().slice(0, 16).replace("T", " ")}</div>
    </footer>
  </div>;
}

createRoot(document.getElementById("root")!).render(<App />);
