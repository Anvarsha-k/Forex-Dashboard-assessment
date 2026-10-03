import type { Health } from '../api'
import type { SocketStatus } from '../useMarketSocket'

interface Props {
  socket: SocketStatus
  health: Health | null
  backendDown: boolean
  ticksPerSec: number
  now: number
}

export default function Header({ socket, health, backendDown, ticksPerSec, now }: Props) {
  const socketTone = socket === 'CONNECTED' ? 'ok' : socket === 'CONNECTING' ? 'warn' : 'bad'
  const feedTone = backendDown ? 'bad' : health?.provider_connected ? 'ok' : 'bad'
  const dbTone = backendDown ? 'bad' : health?.database === 'up' ? 'ok' : 'bad'

  return (
    <header className="topbar">
      <div className="brand">
        <div className="logo">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 17 9 11 13 15 21 7" />
            <polyline points="15 7 21 7 21 13" />
          </svg>
        </div>
        <div>
          <h1>FX<span>Pulse</span></h1>
          <p className="muted">Live Forex market data · Go + WebSocket</p>
        </div>
      </div>

      <div className="status-row">
        <Status tone={socketTone} label="Stream" value={socket === 'DISCONNECTED' ? 'Reconnecting…' : socket.toLowerCase()} />
        <Status tone={feedTone} label="Provider" value={feedTone === 'ok' ? 'Tiingo' : 'offline'} />
        <Status tone={dbTone} label="Database" value={dbTone === 'ok' ? 'up' : 'down'} />
        <div className="status mono"><span className="label">Rate</span>{ticksPerSec} ticks/s</div>
        <div className="status mono clock">
          <span className="label">UTC</span>{new Date(now).toISOString().slice(11, 19)}
        </div>
      </div>
    </header>
  )
}

function Status({ tone, label, value }: { tone: 'ok' | 'warn' | 'bad'; label: string; value: string }) {
  return (
    <div className={`status status-${tone}`}>
      <span className="dot" />
      <span className="label">{label}</span>
      <span className="value">{value}</span>
    </div>
  )
}
