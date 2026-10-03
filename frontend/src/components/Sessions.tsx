import { fmtDuration } from '../lib/format'
import { isMarketOpen, nextMarketOpen, sessionStatus } from '../lib/sessions'

export default function Sessions({ now }: { now: number }) {
  const date = new Date(now)
  const open = isMarketOpen(date)
  const sessions = sessionStatus(date)

  return (
    <div className="card sessions">
      <div className="card-head">
        <h3>Trading sessions</h3>
        <span className={`chip ${open ? 'chip-up' : 'chip-down'}`}>{open ? 'FX OPEN' : 'FX CLOSED'}</span>
      </div>
      {!open && (
        <p className="weekend muted">
          Weekend close. Quotes are sparse until the market reopens in{' '}
          <b>{fmtDuration(nextMarketOpen(date).getTime() - now)}</b>.
        </p>
      )}
      <ul>
        {sessions.map((s) => (
          <li key={s.name}>
            <div className="session-top">
              <span className={`dot ${s.open ? 'dot-on' : ''}`} />
              <strong>{s.name}</strong>
              <span className="muted mono">{s.hours} UTC</span>
              <span className={`session-state ${s.open ? 'up' : 'muted'}`}>
                {s.open ? `closes in ${fmtDuration(s.changeInMs)}` : open ? `opens in ${fmtDuration(s.changeInMs)}` : 'closed'}
              </span>
            </div>
            <div className="session-bar"><div style={{ width: `${s.progress * 100}%` }} /></div>
          </li>
        ))}
      </ul>
      <p className="muted small">Approximate hours; they shift by one hour with daylight saving time.</p>
    </div>
  )
}
