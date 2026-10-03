import { useEffect, useRef, useState } from 'react'
import { isTick, type Tick } from './api'

export type SocketStatus = 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED'

// Connects to the backend WebSocket and calls onTick for every update.
// Reconnects with exponential backoff (1s, 2s, 4s ... max 30s).
export function useMarketSocket(onTick: (tick: Tick) => void): SocketStatus {
  const [status, setStatus] = useState<SocketStatus>('CONNECTING')
  const onTickRef = useRef(onTick)
  onTickRef.current = onTick

  useEffect(() => {
    let ws: WebSocket | null = null
    let retryTimer: ReturnType<typeof setTimeout>
    let delay = 1000
    let stopped = false

    const connect = () => {
      setStatus('CONNECTING')
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${proto}://${window.location.host}/api/v1/ws`)

      ws.onopen = () => {
        setStatus('CONNECTED')
        delay = 1000
      }
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'market_update' && isTick(msg.data)) {
            onTickRef.current(msg.data)
          } else {
            console.warn('Ignoring unexpected message', msg)
          }
        } catch {
          console.warn('Ignoring malformed message', event.data)
        }
      }
      ws.onclose = () => {
        if (stopped) return
        setStatus('DISCONNECTED')
        retryTimer = setTimeout(connect, delay)
        delay = Math.min(delay * 2, 30000)
      }
    }

    connect()
    return () => {
      stopped = true
      clearTimeout(retryTimer)
      ws?.close()
    }
  }, [])

  return status
}
