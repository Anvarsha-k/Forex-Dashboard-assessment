import type { Tick } from '../api'

// A pip is 0.01 for JPY and INR pairs and 0.0001 for most others.
export const pipSize = (symbol: string) => (/JPY|INR/.test(symbol) ? 0.01 : 0.0001)

// Quotes show one digit beyond the pip ("fractional pip").
export const decimals = (symbol: string) => (pipSize(symbol) === 0.01 ? 3 : 5)

export const fmtPrice = (n: number, symbol: string) => n.toFixed(decimals(symbol))

export const spreadPips = (t: Tick) => (t.ask - t.bid) / pipSize(t.symbol)

export const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour12: false })

export function fmtAgo(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function fmtDuration(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000))
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m % 60}m`
  return `${m}m`
}
