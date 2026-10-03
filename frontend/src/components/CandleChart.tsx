import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import type { Candle, Tick } from '../api'
import { decimals, fmtPrice } from '../lib/format'

export type ChartType = 'candles' | 'area'

export interface ChartHandle {
  applyTick: (tick: Tick) => void
}

interface Bar {
  time: number // bucket start, unix seconds
  open: number
  high: number
  low: number
  close: number
  ticks: number
  lastSecond: number // for counting ticks the same way the backend samples them
}

interface Props {
  ref?: Ref<ChartHandle>
  symbol: string
  candles: Candle[]
  intervalSec: number
  type: ChartType
}

const VISIBLE_BARS = 120
const UP = '#16c784'
const DOWN = '#ea3943'
const toLocalTime = (t: Time) => new Date((t as number) * 1000)

export default function CandleChart({ ref, symbol, candles, intervalSec, type }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const areaRef = useRef<ISeriesApi<'Area'> | null>(null)
  const ticksRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const lastBar = useRef<Bar | null>(null)
  const intervalRef = useRef(intervalSec)
  intervalRef.current = intervalSec

  const [legend, setLegend] = useState<Bar | null>(null) // bar under the crosshair
  const [latest, setLatest] = useState<Bar | null>(null) // newest bar
  const hasData = latest !== null

  // Create the chart once.
  useEffect(() => {
    const chart = createChart(containerRef.current!, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8b95a7',
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (t: Time) =>
          toLocalTime(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
      },
      localization: { timeFormatter: (t: Time) => toLocalTime(t).toLocaleString([], { hour12: false }) },
    })
    candleRef.current = chart.addSeries(CandlestickSeries, {
      upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, borderVisible: false,
    })
    areaRef.current = chart.addSeries(AreaSeries, {
      lineColor: '#4f8cff', topColor: 'rgba(79,140,255,0.35)', bottomColor: 'rgba(79,140,255,0)', lineWidth: 2,
    })
    // Tick activity in its own scale at the bottom. FX has no central volume,
    // so this is the number of stored quotes per bar, not traded volume.
    ticksRef.current = chart.addSeries(HistogramSeries, {
      priceScaleId: 'ticks', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false,
    })
    chart.priceScale('ticks').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } })

    chart.subscribeCrosshairMove((param) => {
      const c = param.time ? (param.seriesData.get(candleRef.current!) as CandlestickData | undefined) : undefined
      const v = param.time ? (param.seriesData.get(ticksRef.current!) as HistogramData | undefined) : undefined
      if (c && 'open' in c) {
        setLegend({ time: param.time as number, open: c.open, high: c.high, low: c.low, close: c.close,
          ticks: v?.value ?? 0, lastSecond: 0 })
      } else {
        setLegend(null) // fall back to the latest bar
      }
    })

    chartRef.current = chart
    return () => {
      chart.remove()
      chartRef.current = null
    }
  }, [])

  // Show the selected chart type.
  useEffect(() => {
    candleRef.current?.applyOptions({ visible: type === 'candles' })
    areaRef.current?.applyOptions({ visible: type === 'area' })
  }, [type])

  // Load historical candles whenever the symbol or interval changes.
  useEffect(() => {
    const d = decimals(symbol)
    const priceFormat = { type: 'price' as const, precision: d, minMove: 10 ** -d }
    candleRef.current?.applyOptions({ priceFormat })
    areaRef.current?.applyOptions({ priceFormat })

    const bars: Bar[] = candles.map((c) => ({
      time: Math.floor(Date.parse(c.time) / 1000), open: c.open, high: c.high, low: c.low, close: c.close,
      ticks: c.ticks, lastSecond: 0,
    }))
    candleRef.current?.setData(bars.map(toCandle))
    areaRef.current?.setData(bars.map((b) => ({ time: b.time as UTCTimestamp, value: b.close })))
    ticksRef.current?.setData(bars.map(toVolume))
    // Show the latest ~120 bars at a readable width rather than stretching
    // a handful of bars across the whole chart.
    chartRef.current?.timeScale().setVisibleLogicalRange({ from: bars.length - VISIBLE_BARS, to: bars.length + 3 })
    lastBar.current = bars[bars.length - 1] ?? null
    setLatest(lastBar.current)
  }, [candles, symbol])

  // Live updates: extend the current bar or start a new one.
  useImperativeHandle(ref, () => ({
    applyTick(tick: Tick) {
      const ms = Date.parse(tick.timestamp)
      const second = Math.floor(ms / 1000)
      const time = Math.floor(second / intervalRef.current) * intervalRef.current
      const p = tick.price
      let bar = lastBar.current
      if (bar && time < bar.time) return // older than the chart's last bar

      if (!bar || time > bar.time) {
        bar = { time, open: p, high: p, low: p, close: p, ticks: 1, lastSecond: second }
      } else {
        bar = {
          ...bar, high: Math.max(bar.high, p), low: Math.min(bar.low, p), close: p,
          // The backend stores at most one tick per second; count the same way.
          ticks: second > bar.lastSecond ? bar.ticks + 1 : bar.ticks,
          lastSecond: Math.max(second, bar.lastSecond),
        }
      }
      lastBar.current = bar
      candleRef.current?.update(toCandle(bar))
      areaRef.current?.update({ time: bar.time as UTCTimestamp, value: bar.close })
      ticksRef.current?.update(toVolume(bar))
      setLatest(bar)
    },
  }), [])

  const shown = legend ?? latest
  const change = shown ? shown.close - shown.open : 0

  return (
    <div className="chart-wrap">
      {shown && (
        <div className="chart-legend mono">
          <span>O <b>{fmtPrice(shown.open, symbol)}</b></span>
          <span>H <b>{fmtPrice(shown.high, symbol)}</b></span>
          <span>L <b>{fmtPrice(shown.low, symbol)}</b></span>
          <span>C <b className={change >= 0 ? 'up' : 'down'}>{fmtPrice(shown.close, symbol)}</b></span>
          <span className="muted">Ticks {shown.ticks}</span>
        </div>
      )}
      <div ref={containerRef} className="chart" />
      {!hasData && (
        <div className="chart-empty">
          <div className="pulse-dot" />
          <p>No candles in this window yet</p>
          <span className="muted">History builds up while the backend runs. Try a larger interval.</span>
        </div>
      )}
    </div>
  )
}

const toCandle = (b: Bar) => ({ time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close })

const toVolume = (b: Bar) => ({
  time: b.time as UTCTimestamp,
  value: b.ticks,
  color: b.close >= b.open ? 'rgba(22,199,132,0.35)' : 'rgba(234,57,67,0.35)',
})
