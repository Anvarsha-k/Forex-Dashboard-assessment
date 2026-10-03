import type { Candle, Tick } from '../api'
import { fmtAgo, fmtPct, fmtPrice, spreadPips } from '../lib/format'
import { Price } from './Bits'

interface Props {
  symbol: string
  tick?: Tick
  candles: Candle[]
  windowLabel: string
  now: number
}

export default function StatsPanel({ symbol, tick, candles, windowLabel, now }: Props) {
  // Range statistics for the chart window, extended with the live price.
  const open = candles[0]?.open
  const highs = candles.map((c) => c.high)
  const lows = candles.map((c) => c.low)
  if (tick) {
    highs.push(tick.price)
    lows.push(tick.price)
  }
  const high = highs.length ? Math.max(...highs) : undefined
  const low = lows.length ? Math.min(...lows) : undefined
  const last = tick?.price ?? candles[candles.length - 1]?.close
  const change = open !== undefined && last !== undefined ? ((last - open) / open) * 100 : null
  const position = high !== undefined && low !== undefined && last !== undefined && high > low
    ? ((last - low) / (high - low)) * 100 : 50
  const age = tick ? now - Date.parse(tick.timestamp) : null

  return (
    <div className="card stats">
      <div className="card-head">
        <h3>Quote</h3>
        <span className={`chip ${age !== null && age < 10_000 ? 'chip-live' : 'muted'}`}>
          {age === null ? 'no data' : age < 10_000 ? '● LIVE' : `updated ${fmtAgo(age)}`}
        </span>
      </div>

      <div className="bidask">
        <div className="side bid">
          <label>BID</label>
          {tick ? <Price value={tick.bid} symbol={symbol} /> : <span className="price mono">—</span>}
        </div>
        <div className="spread-pill mono">{tick ? spreadPips(tick).toFixed(1) : '—'}<small>pips</small></div>
        <div className="side ask">
          <label>ASK</label>
          {tick ? <Price value={tick.ask} symbol={symbol} /> : <span className="price mono">—</span>}
        </div>
      </div>

      <div className="range">
        <div className="range-labels mono">
          <span>L {low !== undefined ? fmtPrice(low, symbol) : '—'}</span>
          <span>H {high !== undefined ? fmtPrice(high, symbol) : '—'}</span>
        </div>
        <div className="range-bar"><div className="range-marker" style={{ left: `${position}%` }} /></div>
      </div>

      <dl className="kv mono">
        <dt>Mid</dt><dd>{last !== undefined ? fmtPrice(last, symbol) : '—'}</dd>
        <dt>Open ({windowLabel})</dt><dd>{open !== undefined ? fmtPrice(open, symbol) : '—'}</dd>
        <dt>Change</dt>
        <dd className={change === null ? '' : change >= 0 ? 'up' : 'down'}>{change === null ? '—' : fmtPct(change)}</dd>
        <dt>Stored ticks</dt><dd>{candles.reduce((n, c) => n + c.ticks, 0).toLocaleString()}</dd>
        <dt>Last quote</dt><dd>{tick ? new Date(tick.timestamp).toLocaleTimeString([], { hour12: false }) : '—'}</dd>
      </dl>
    </div>
  )
}
