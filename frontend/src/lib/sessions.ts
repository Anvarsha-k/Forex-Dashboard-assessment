// Approximate FX trading sessions in UTC (they shift by an hour with
// daylight saving time). The market is closed from Friday 22:00 UTC to
// Sunday 22:00 UTC, which is why quotes stop at weekends.
export const SESSIONS = [
  { name: 'Sydney', open: 22, close: 7 },
  { name: 'Tokyo', open: 0, close: 9 },
  { name: 'London', open: 8, close: 17 },
  { name: 'New York', open: 13, close: 22 },
]

const HOUR = 3600_000

export function isMarketOpen(now: Date): boolean {
  const day = now.getUTCDay() // 0 = Sunday
  const hour = now.getUTCHours()
  if (day === 6) return false
  if (day === 5 && hour >= 22) return false
  if (day === 0 && hour < 22) return false
  return true
}

// Next Sunday 22:00 UTC.
export function nextMarketOpen(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 22))
  d.setUTCDate(d.getUTCDate() + ((7 - now.getUTCDay()) % 7))
  if (d <= now) d.setUTCDate(d.getUTCDate() + 7)
  return d
}

export interface SessionStatus {
  name: string
  hours: string
  open: boolean
  progress: number // 0..1 of the session elapsed, when open
  changeInMs: number // until it closes (if open) or opens (if closed)
}

export function sessionStatus(now: Date): SessionStatus[] {
  const marketOpen = isMarketOpen(now)
  const h = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600
  return SESSIONS.map((s) => {
    const length = (s.close - s.open + 24) % 24
    const sinceOpen = (h - s.open + 24) % 24
    const inHours = sinceOpen < length
    const open = marketOpen && inHours
    return {
      name: s.name,
      hours: `${pad(s.open)}:00–${pad(s.close)}:00`,
      open,
      progress: open ? sinceOpen / length : 0,
      changeInMs: (inHours ? length - sinceOpen : 24 - sinceOpen) * HOUR,
    }
  })
}

const pad = (n: number) => String(n).padStart(2, '0')
