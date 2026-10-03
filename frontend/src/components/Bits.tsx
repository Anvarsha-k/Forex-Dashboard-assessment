import { decimals } from '../lib/format'
import type { SparkPoint } from '../useMarketStore'

const CURRENCY_SIGNS: Record<string, string> = {
  EUR: '€', USD: '$', GBP: '£', JPY: '¥', INR: '₹', CHF: '₣', AUD: 'A$', CAD: 'C$', NZD: 'N$',
}

// Overlapping currency "coins", e.g. € + $ for EUR/USD.
export function PairBadge({ symbol, size = 28 }: { symbol: string; size?: number }) {
  const [base, quote] = symbol.split('/')
  const coin = (code: string, extra = '') => (
    <span className={`coin coin-${code.toLowerCase()} ${extra}`} title={code}
      style={{ width: size, height: size, fontSize: size * (CURRENCY_SIGNS[code]?.length > 1 ? 0.36 : 0.5) }}>
      {CURRENCY_SIGNS[code] ?? code[0]}
    </span>
  )
  return (
    <span className="pair-badge" style={{ width: size * 1.6, height: size }}>
      {coin(base)}
      {coin(quote, 'coin-back')}
    </span>
  )
}

// Trading-platform style price: the pip digits are emphasised and the
// fractional pip is shown smaller, e.g. 1.12|52|2.
export function Price({ value, symbol, className = '' }: { value: number; symbol: string; className?: string }) {
  const s = value.toFixed(decimals(symbol))
  return (
    <span className={`price mono ${className}`}>
      {s.slice(0, -3)}
      <span className="price-pips">{s.slice(-3, -1)}</span>
      <sup className="price-frac">{s.slice(-1)}</sup>
    </span>
  )
}

export function Sparkline({ points, height = 44 }: { points: SparkPoint[]; height?: number }) {
  if (points.length < 2) return <div className="spark-empty" style={{ height }}>collecting data…</div>
  const values = points.map((p) => p.v)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const w = 100
  const coords = values.map((v, i) => [(i / (values.length - 1)) * w, height - 4 - ((v - min) / range) * (height - 8)])
  const line = coords.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  const up = values[values.length - 1] >= values[0]
  const color = up ? 'var(--up)' : 'var(--down)'
  const id = `spark-${up ? 'up' : 'down'}`
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ height }}>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${line} ${w},${height}`} fill={`url(#${id})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function Change({ value }: { value: number | null }) {
  if (value === null) return <span className="chip muted">—</span>
  if (Math.abs(value) < 0.005) return <span className="chip muted">0.00%</span>
  return (
    <span className={`chip ${value > 0 ? 'chip-up' : 'chip-down'}`}>
      {value > 0 ? '▲' : '▼'} {Math.abs(value).toFixed(2)}%
    </span>
  )
}
