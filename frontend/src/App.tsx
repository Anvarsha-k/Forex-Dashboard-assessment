import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchCandles, fetchHealth, fetchLatest, fetchMarkets,
  INTERVAL_SECONDS, type Candle, type Health, type Interval, type Tick,
} from './api'
import { useMarketSocket } from './useMarketSocket'
import { useMarketStore } from './useMarketStore'
import { fmtPrice } from './lib/format'
import Header from './components/Header'
import WatchCard from './components/WatchCard'
import CandleChart, { type ChartHandle, type ChartType } from './components/CandleChart'
import StatsPanel from './components/StatsPanel'
import TickFeed from './components/TickFeed'
import MarketTable from './components/MarketTable'
import Sessions from './components/Sessions'
import { PairBadge, Price } from './components/Bits'

const CHART_BARS = 300
const INTERVALS: Interval[] = ['1m', '5m', '15m', '1h']

export default function App() {
  const [symbols, setSymbols] = useState<string[]>([])
  const [selected, setSelected] = useState('')
  const [interval, setInterval_] = useState<Interval>('1m')
  const [chartType, setChartType] = useState<ChartType>('candles')
  const [candles, setCandles] = useState<Candle[]>([])
  const [store, dispatch] = useMarketStore()
  const [health, setHealth] = useState<Health | null>(null)
  const [backendDown, setBackendDown] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())
  const [ticksPerSec, setTicksPerSec] = useState(0)

  const chartRef = useRef<ChartHandle>(null)
  const selectedRef = useRef(selected)
  selectedRef.current = selected

  // Load the symbol list, last prices and 1-hour sparklines.
  useEffect(() => {
    fetchMarkets()
      .then((list) => {
        setSymbols(list)
        setSelected((s) => s || list[0] || '')
        list.forEach(async (symbol) => {
          const [tick, spark] = await Promise.all([
            fetchLatest(symbol).catch(() => null),
            fetchCandles(symbol, '1m', 60).catch(() => []),
          ])
          dispatch({ type: 'init', symbol, tick, spark: spark.map((c) => ({ t: Date.parse(c.time), v: c.close })) })
        })
      })
      .catch(() => setError('Cannot reach the backend. Is the Go server running on :8080?'))
  }, [dispatch])

  // Load chart candles when the pair or interval changes.
  useEffect(() => {
    if (!selected) return
    let cancelled = false
    setCandles([]) // don't show the previous pair's bars under the new symbol
    fetchCandles(selected, interval, CHART_BARS)
      .then((c) => {
        if (cancelled) return
        setCandles(c)
        setError('')
      })
      .catch(() => !cancelled && setError(`Could not load price history for ${selected}.`))
    return () => {
      cancelled = true
    }
  }, [selected, interval])

  // Poll dependency health (connection status only, not market data).
  useEffect(() => {
    const check = () =>
      fetchHealth()
        .then((h) => {
          setHealth(h)
          setBackendDown(false)
        })
        .catch(() => setBackendDown(true))
    check()
    const id = window.setInterval(check, 10_000)
    return () => window.clearInterval(id)
  }, [])

  // Live updates. The chart is updated immediately (it draws on a canvas
  // outside React); everything else is batched into one state update every
  // 100 ms so a busy feed doesn't re-render the page hundreds of times a second.
  const queue = useRef<Tick[]>([])
  const flushTimer = useRef<number | undefined>(undefined)
  const tickCount = useRef(0)
  const onTick = useCallback((tick: Tick) => {
    tickCount.current++
    if (tick.symbol === selectedRef.current) chartRef.current?.applyTick(tick)
    queue.current.push(tick)
    if (flushTimer.current === undefined) {
      flushTimer.current = window.setTimeout(() => {
        flushTimer.current = undefined
        const ticks = queue.current
        queue.current = []
        dispatch({ type: 'ticks', ticks })
      }, 100)
    }
  }, [dispatch])
  const socket = useMarketSocket(onTick)

  // One-second clock for "updated Xs ago", sessions and the tick rate.
  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now())
      setTicksPerSec(tickCount.current)
      tickCount.current = 0
    }, 1000)
    return () => window.clearInterval(id)
  }, [])

  // Keyboard shortcuts: 1-9 select a pair.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      const i = Number(e.key) - 1
      if (i >= 0 && i < symbols.length) setSelected(symbols[i])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [symbols])

  const view = store[selected]
  const tick = view?.tick

  // Show the live price in the browser tab.
  useEffect(() => {
    document.title = tick ? `${fmtPrice(tick.price, selected)} ${selected} · FXPulse` : 'FXPulse · Live Forex'
  }, [tick, selected])

  const windowLabel = `${CHART_BARS}×${interval}`

  return (
    <div className="app">
      <Header socket={socket} health={health} backendDown={backendDown} ticksPerSec={ticksPerSec} now={now} />

      {error && <div className="banner banner-error">⚠ {error}</div>}
      {socket === 'DISCONNECTED' && !error && (
        <div className="banner banner-warn">Live stream disconnected. Reconnecting automatically…</div>
      )}

      <section className="watchlist">
        {symbols.map((s, i) => (
          <WatchCard key={s} symbol={s} view={store[s]} selected={s === selected} hotkey={i + 1} onSelect={() => setSelected(s)} />
        ))}
      </section>

      <section className="main-grid">
        <div className="card chart-card">
          <div className="chart-toolbar">
            <div className="chart-title">
              {selected && <PairBadge symbol={selected} size={32} />}
              <div>
                <select value={selected} onChange={(e) => setSelected(e.target.value)} aria-label="Currency pair">
                  {symbols.map((s) => <option key={s}>{s}</option>)}
                </select>
                <div className="chart-price">
                  {tick ? <Price key={view.flash} value={tick.price} symbol={selected} className={`flash-text-${view.dir ?? 'none'}`} /> : <span className="muted">—</span>}
                  <span className="muted small">mid</span>
                </div>
              </div>
            </div>
            <div className="toolbar-controls">
              <div className="segmented">
                {INTERVALS.map((iv) => (
                  <button key={iv} className={iv === interval ? 'active' : ''} onClick={() => setInterval_(iv)}>{iv}</button>
                ))}
              </div>
              <div className="segmented">
                <button className={chartType === 'candles' ? 'active' : ''} onClick={() => setChartType('candles')}>Candles</button>
                <button className={chartType === 'area' ? 'active' : ''} onClick={() => setChartType('area')}>Area</button>
              </div>
            </div>
          </div>
          {selected && (
            <CandleChart ref={chartRef} symbol={selected} candles={candles} intervalSec={INTERVAL_SECONDS[interval]} type={chartType} />
          )}
        </div>

        <aside className="side-col">
          <StatsPanel symbol={selected} tick={tick} candles={candles} windowLabel={windowLabel} now={now} />
          <TickFeed symbol={selected} feed={view?.feed ?? []} />
        </aside>
      </section>

      <section className="bottom-grid">
        <MarketTable symbols={symbols} store={store} selected={selected} now={now} onSelect={setSelected} />
        <Sessions now={now} />
      </section>

      <footer className="muted small">
        Data: Tiingo FX top-of-book via WebSocket (free tier, personal use). Candles are built from stored mid prices,
        sampled at most once per second. Not investment advice, not for trading.
      </footer>
    </div>
  )
}
