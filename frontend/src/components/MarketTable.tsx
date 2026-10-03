import { fmtAgo, fmtPrice, spreadPips } from '../lib/format'
import { sparkChange, type MarketStore } from '../useMarketStore'
import { Change, PairBadge } from './Bits'

interface Props {
  symbols: string[]
  store: MarketStore
  selected: string
  now: number
  onSelect: (s: string) => void
}

export default function MarketTable({ symbols, store, selected, now, onSelect }: Props) {
  return (
    <div className="card table-card">
      <div className="card-head">
        <h3>Markets</h3>
        <span className="muted">{symbols.length} pairs</span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Symbol</th><th>Bid</th><th>Ask</th><th>Spread</th><th>Mid</th><th>1H</th><th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {symbols.map((s) => {
              const view = store[s]
              const t = view?.tick
              return (
                <tr key={s} className={s === selected ? 'selected' : ''} onClick={() => onSelect(s)}>
                  <td><span className="sym"><PairBadge symbol={s} size={20} /> {s}</span></td>
                  <td className="mono">{t ? fmtPrice(t.bid, s) : '—'}</td>
                  <td className="mono">{t ? fmtPrice(t.ask, s) : '—'}</td>
                  <td className="mono">{t ? spreadPips(t).toFixed(1) : '—'}</td>
                  <td key={view?.flash} className={`mono flash-text-${view?.dir ?? 'none'}`}>{t ? fmtPrice(t.price, s) : '—'}</td>
                  <td><Change value={sparkChange(view)} /></td>
                  <td className="muted">{t ? fmtAgo(now - Date.parse(t.timestamp)) : 'no data'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
