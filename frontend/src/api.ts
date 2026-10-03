export interface Tick {
  symbol: string
  bid: number
  ask: number
  price: number
  timestamp: string
}

export interface Candle {
  time: string
  open: number
  high: number
  low: number
  close: number
  ticks: number
}

export interface Health {
  status: 'ok' | 'degraded'
  database: 'up' | 'down'
  provider_connected: boolean
}

export type Interval = '1m' | '5m' | '15m' | '1h'

export const INTERVAL_SECONDS: Record<Interval, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600 }

// "EUR/USD" -> "EURUSD" for use in URLs.
const toPath = (symbol: string) => symbol.replace('/', '')

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} failed with ${res.status}`)
  return res.json() as Promise<T>
}

export const fetchMarkets = () => getJSON<string[]>('/api/v1/markets')

export const fetchHealth = () => getJSON<Health>('/api/v1/health')

export const fetchCandles = (symbol: string, interval: Interval, limit: number) =>
  getJSON<Candle[]>(`/api/v1/markets/${toPath(symbol)}/candles?interval=${interval}&limit=${limit}`)

// Returns null when the backend has no price yet for this symbol (404).
export async function fetchLatest(symbol: string): Promise<Tick | null> {
  const res = await fetch(`/api/v1/markets/${toPath(symbol)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`latest ${symbol} failed with ${res.status}`)
  return res.json()
}

// Guards against malformed WebSocket messages.
export function isTick(v: unknown): v is Tick {
  const t = v as Tick
  return (
    typeof t === 'object' && t !== null &&
    typeof t.symbol === 'string' &&
    typeof t.bid === 'number' &&
    typeof t.ask === 'number' &&
    typeof t.price === 'number' &&
    typeof t.timestamp === 'string'
  )
}
