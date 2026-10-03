import { fmtPrice, spreadPips } from '../lib/format'
import { sparkChange, type SymbolView } from '../useMarketStore'
import { Change, PairBadge, Price, Sparkline } from './Bits'

interface Props {
  symbol: string
  view?: SymbolView
  selected: boolean
  hotkey: number
  onSelect: () => void
}

export default function WatchCard({ symbol, view, selected, hotkey, onSelect }: Props) {
  const tick = view?.tick
  return (
    <button className={`card watch ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <div className="watch-head">
        <PairBadge symbol={symbol} />
        <div className="watch-title">
          <strong>{symbol}</strong>
          <span className="muted">Spot · key {hotkey}</span>
        </div>
        <Change value={sparkChange(view)} />
      </div>

      {tick ? (
        <>
          <div key={view.flash} className={`watch-price flash-${view.dir ?? 'none'}`}>
            <Price value={tick.price} symbol={symbol} />
            {view.dir && <span className={`arrow ${view.dir}`}>{view.dir === 'up' ? '▲' : '▼'}</span>}
          </div>
          <div className="watch-meta mono">
            <span><em>B</em> {fmtPrice(tick.bid, symbol)}</span>
            <span><em>A</em> {fmtPrice(tick.ask, symbol)}</span>
            <span><em>SPR</em> {spreadPips(tick).toFixed(1)}</span>
          </div>
        </>
      ) : (
        <div className="watch-price muted waiting">Waiting for quotes…</div>
      )}

      <Sparkline points={view?.spark ?? []} />
    </button>
  )
}
