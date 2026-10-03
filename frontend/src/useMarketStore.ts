import { useReducer } from 'react'
import type { Tick } from './api'

export type Direction = 'up' | 'down' | null

export interface FeedItem {
  id: number
  tick: Tick
  dir: Direction
}

export interface SparkPoint {
  t: number // start of the minute (ms)
  v: number // last mid price in that minute
}

export interface SymbolView {
  tick?: Tick
  dir: Direction
  flash: number // incremented on every price move to replay the flash animation
  spark: SparkPoint[] // last 60 one-minute closes
  feed: FeedItem[] // most recent ticks, newest first
}

type Action =
  | { type: 'init'; symbol: string; tick: Tick | null; spark: SparkPoint[] }
  | { type: 'ticks'; ticks: Tick[] }

export type MarketStore = Record<string, SymbolView>

const SPARK_POINTS = 60
const FEED_SIZE = 30
let feedId = 0

const empty = (): SymbolView => ({ dir: null, flash: 0, spark: [], feed: [] })

function reducer(state: MarketStore, action: Action): MarketStore {
  switch (action.type) {
    case 'init': {
      const view = state[action.symbol] ?? empty()
      return {
        ...state,
        // Keep a live tick if one already arrived while we were loading.
        [action.symbol]: { ...view, tick: view.tick ?? action.tick ?? undefined, spark: action.spark },
      }
    }
    case 'ticks': {
      const next = { ...state }
      for (const tick of action.ticks) {
        const view = next[tick.symbol] ?? empty()
        const prev = view.tick
        if (prev && tick.timestamp < prev.timestamp) continue // out of order

        const dir: Direction = !prev ? null : tick.price > prev.price ? 'up' : tick.price < prev.price ? 'down' : view.dir
        const moved = !prev || tick.price !== prev.price

        const minute = Math.floor(Date.parse(tick.timestamp) / 60000) * 60000
        const spark = [...view.spark]
        const last = spark[spark.length - 1]
        if (last && last.t === minute) spark[spark.length - 1] = { t: minute, v: tick.price }
        else if (!last || minute > last.t) spark.push({ t: minute, v: tick.price })

        next[tick.symbol] = {
          tick,
          dir,
          flash: moved ? view.flash + 1 : view.flash,
          spark: spark.slice(-SPARK_POINTS),
          feed: [{ id: ++feedId, tick, dir }, ...view.feed].slice(0, FEED_SIZE),
        }
      }
      return next
    }
  }
}

export const useMarketStore = () => useReducer(reducer, {})

// Percentage change across the sparkline window (up to one hour).
export function sparkChange(view?: SymbolView): number | null {
  if (!view || view.spark.length < 2) return null
  const first = view.spark[0].v
  return ((view.spark[view.spark.length - 1].v - first) / first) * 100
}
