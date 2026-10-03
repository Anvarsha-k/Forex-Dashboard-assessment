import { fmtPrice } from '../lib/format'
import type { FeedItem } from '../useMarketStore'

export default function TickFeed({ symbol, feed }: { symbol: string; feed: FeedItem[] }) {
  return (
    <div className="card feed">
      <div className="card-head">
        <h3>Live ticks</h3>
        <span className="muted">{symbol} · since page load</span>
      </div>
      <div className="feed-row feed-header mono">
        <span>Time</span><span>Bid</span><span>Ask</span><span>Mid</span>
      </div>
      <div className="feed-body">
        {feed.length === 0 && <div className="feed-empty muted">Ticks appear here as they stream in.</div>}
        {feed.map(({ id, tick, dir }) => (
          <div key={id} className={`feed-row mono feed-${dir ?? 'none'}`}>
            <span className="muted">
              {new Date(tick.timestamp).toLocaleTimeString([], { hour12: false })}
              .{String(new Date(tick.timestamp).getMilliseconds()).padStart(3, '0')}
            </span>
            <span>{fmtPrice(tick.bid, symbol)}</span>
            <span>{fmtPrice(tick.ask, symbol)}</span>
            <span className={dir ?? ''}>{dir === 'up' ? '▲' : dir === 'down' ? '▼' : '•'} {fmtPrice(tick.price, symbol)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
