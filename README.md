# Live Forex Market Dashboard

A small full-stack app that streams live Forex quotes from a real provider (Tiingo) into a Go backend. The backend keeps the latest price per pair in memory, stores sampled history in PostgreSQL, and pushes updates to a React dashboard over WebSocket.

Pairs: **EUR/USD, GBP/USD, USD/JPY, USD/INR** (configurable).

## Dashboard features

- **Watchlist cards:** live mid price with emphasised pip digits, a green/red flash on every up/down tick, bid/ask, spread in pips, 1-hour change and a 60-minute sparkline. Press `1`–`4` to switch pairs.
- **Candlestick chart** (TradingView lightweight-charts):
  - 1m / 5m / 15m / 1h intervals and a candles/area toggle
  - an OHLC legend that follows the crosshair
  - a tick-activity histogram (FX has no central volume, so this counts stored quotes, not traded volume)
  - the current bar is updated live from the WebSocket
- **Quote panel:** bid/ask, spread, the price's position in the window's high–low range, change since the window's open, and how old the last quote is.
- **Live tick feed:** the last 30 quotes for the selected pair, with up/down arrows.
- **Markets table:** all pairs at once.
- **Trading sessions:** Sydney, Tokyo, London and New York, with open/closed status and countdowns, plus a weekend-close notice. This explains why quotes are quiet at times.
- **Header status:** WebSocket, provider and database, ticks per second, and a UTC clock. The live price also appears in the browser tab title.

## Architecture

```
Tiingo FX WebSocket (wss://api.tiingo.com/fx)
        │
        ▼
Go provider client  (goroutine, reconnects with backoff)
        │  chan MarketTick
        ▼
Processor           (goroutine)
   ├──► Latest state (map + RWMutex) ──► REST API ──┐
   ├──► WebSocket hub (goroutine) ─────────────────┼──► React dashboard
   └──► Save queue ──► DB writer (goroutine) ──► PostgreSQL ──► /history
```

| Folder | Responsibility |
|---|---|
| `backend/internal/market` | Tiingo connection, message parsing, reconnect |
| `backend/internal/service` | Latest-state store and tick processor |
| `backend/internal/websocket` | Hub that fans updates out to browsers |
| `backend/internal/repository` | PostgreSQL pool, insert and history query |
| `backend/internal/handler` | REST endpoints |
| `backend/cmd/server` | Wiring and graceful shutdown |
| `frontend/` | React + Vite + TypeScript dashboard |

## Market data provider: Tiingo

- Docs: https://www.tiingo.com/documentation/websockets/forex
- **Auth:** API token, sent in the WebSocket subscribe message. It is read from `MARKET_DATA_API_KEY` and never logged.
- **Data:** top-of-book bid/ask/mid quotes. Tiingo says these come from tier-1 banks and FX dark pools. This is an aggregated feed, not exchange-grade data. Latency is not measured in this project.
- **Free tier:** Tiingo says WebSocket access is included. Limits are **1 GB bandwidth per month** and **personal/internal use only**. The FX stream can be very chatty, so leaving the backend running for days can use up the monthly bandwidth.
- **Symbols:** `EUR/USD` → `eurusd`. Tiingo's FX docs don't list a ticker filter, so the backend also drops any pair it didn't ask for. If a pair (e.g. USD/INR) gets no quotes, the dashboard shows "—" for it.
- **Market hours:** FX is closed at weekends, so no new quotes arrive then.

## Setup (Docker)

```bash
cp .env.example .env          # then put your Tiingo key in MARKET_DATA_API_KEY
docker compose up --build
```

- Dashboard: http://localhost:3000
- API: http://localhost:8080/api/v1/health

On first start, Postgres runs `backend/migrations/001_create_market_ticks.sql` automatically.

## Local development

```bash
docker compose up postgres                 # DB on localhost:5433

cd backend
export MARKET_DATA_API_KEY=... DATABASE_URL=postgres://forex:forex@localhost:5433/forex?sslmode=disable
go run ./cmd/server                        # :8080

cd frontend
npm install && npm run dev                 # http://localhost:5173 (proxies /api to :8080)
```

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/health` | `{"status":"ok|degraded","database":"up|down","provider_connected":bool}` |
| GET | `/api/v1/markets` | `["EUR/USD","GBP/USD","USD/JPY","USD/INR"]` |
| GET | `/api/v1/markets/EURUSD` | Latest tick (from memory). 404 if unsupported or no data yet. |
| GET | `/api/v1/markets/EURUSD/history?limit=200&from=…&to=…` | Stored ticks, oldest first. `limit` is 1–1000 (default 200). `from`/`to` are RFC3339; the default is the last 24h. |
| GET | `/api/v1/markets/EURUSD/candles?interval=1m&limit=200` | OHLC candles built in PostgreSQL. `interval` is 1m, 5m, 15m or 1h. `limit` is 1–500. |
| GET | `/api/v1/ws` | WebSocket stream |

Write the symbol in the URL without the slash (`EURUSD`, `eurusd` or `EUR-USD`).

WebSocket message:

```json
{"type":"market_update","data":{"symbol":"EUR/USD","bid":1.0842,"ask":1.0844,"price":1.0843,"timestamp":"2026-01-02T10:00:00Z"}}
```

## Database

```sql
market_ticks(id BIGSERIAL, symbol VARCHAR(10), bid/ask/price NUMERIC(18,8), event_time TIMESTAMPTZ, created_at TIMESTAMPTZ)
INDEX (symbol, event_time DESC)
```

- **NUMERIC** stores decimal prices exactly. **TIMESTAMPTZ** avoids timezone mistakes.
- **The index:** history queries are always `WHERE symbol = ? AND event_time BETWEEN ? AND ? ORDER BY event_time DESC LIMIT ?`. A composite index with symbol first and time second answers that with one index range scan, which stops after `LIMIT` rows and needs no sort.
- **Sampling:** at most **one tick per symbol per second** is stored. The feed can send many updates per second, and the chart doesn't need them all.
- **Pool:** `pgxpool` with max/min connections from env (`DB_MAX_CONNS`, `DB_MIN_CONNS`), plus connection lifetime and idle-time limits.
- **Candles:** these are aggregated in SQL rather than in Go:
  ```sql
  SELECT date_bin('1 minute', event_time, TIMESTAMPTZ '2000-01-01') AS bucket,
         (array_agg(price ORDER BY event_time))[1] AS open, max(price) AS high,
         min(price) AS low, (array_agg(price ORDER BY event_time DESC))[1] AS close, count(*) AS ticks
  FROM market_ticks WHERE symbol = $1 AND event_time >= $3
  GROUP BY bucket ORDER BY bucket DESC LIMIT $4
  ```
  `date_bin` rounds each timestamp down to the start of its bucket. The WHERE clause uses the same composite index.
- **Startup warm-up:** on start, the backend loads each pair's last stored tick (one `LATERAL ... LIMIT 1` index lookup per symbol). The dashboard therefore shows the last known prices even before a live quote arrives.

## Concurrency design

| Goroutine | Job |
|---|---|
| Provider client | Reads the Tiingo socket and sends ticks into a channel |
| Processor | Only reader of that channel: updates state, broadcasts, queues saves |
| DB writer | Inserts sampled ticks, so a slow DB never delays live prices |
| Hub | Only owner of the clients map: register, unregister, broadcast |
| Per client: write loop + read loop | The write loop is the only writer to its connection; the read loop detects disconnects |

- **Channels** connect stages that run at different speeds (network → processing → DB). The hub uses channels because exactly one goroutine owns the clients map.
- **RWMutex** guards the latest-state map. It's simple shared data with one writer and many readers (HTTP handlers), and a lock is simpler than a channel round-trip there.
- **atomic.Bool** holds the provider-connected flag that the health endpoint reads.
- **Cancellation:** one `context` (cancelled on SIGINT/SIGTERM) stops the provider client. The client then closes the tick channel, so the processor's `range` loop ends and it drains the DB queue. The hub closes all clients.
- `go test -race ./...` passes (on Windows, run it in Docker or WSL: the race detector needs cgo).

## Failure handling

- **Provider disconnects / goes silent:**
  - **Keepalive:** the client sends a WebSocket ping every 25s. Each pong, or any message, extends a 60s read deadline, so a dead (half-open) connection is detected within about a minute. The pings are needed because Tiingo can send nothing for minutes on a quiet weekend market. Relying on its 30-second heartbeat alone caused needless reconnects every 60s.
  - **Reconnect:** after 1s, 2s, 4s … up to 30s. The delay resets after a connection that delivered data or stayed up for more than a minute. Shutdown can interrupt the wait.
- **Bad provider message:** logged and skipped.
- **Database down:** the failed insert is logged and dropped, `/history` returns 503, and live prices keep working.
- **Slow WebSocket client:** each client has a 64-message buffer. If it fills, that client is disconnected so it can't block the others.
- **Browser disconnect:** the read loop errors, and the client is unregistered and cleaned up.
- **Frontend:** shows CONNECTED / CONNECTING / DISCONNECTED. It reconnects with backoff, shows an error banner if the API is unreachable, and ignores malformed messages.

## Testing

```bash
cd backend
go test ./...
go test -race ./...
```

The tests cover Tiingo message parsing and concurrent access to the latest-state store.

## Design decisions

- **No Redis:** this is a single backend process, so an in-memory map is faster and simpler. Redis would make sense with several backend instances that need a shared latest-price cache or Pub/Sub fan-out.
- **No Kafka:** one producer and one consumer in one process are handled fine by a Go channel. Kafka is for durable, replayable streams shared between many services.
- **gorilla/websocket** is used for both the provider connection and the browser connections. **pgx** is used for PostgreSQL. The router is Go's standard library.
- **TradingView lightweight-charts** draws the chart. It draws on a canvas and has an incremental `series.update()`. Live ticks go straight into the chart without a React re-render, while the rest of the UI batches ticks into one state update every 100 ms. This keeps a busy feed smooth.

---

## Interview explanation

**1. 60-second explanation**
"I built a live Forex dashboard. A Go service holds a WebSocket connection to Tiingo's FX feed. It parses each quote into my own `MarketTick` type and sends it through a channel to a processor goroutine. The processor updates an in-memory latest-price map, broadcasts the tick to browsers through a WebSocket hub, and saves one tick per second per pair to PostgreSQL. A REST API serves the latest prices and the history. The React frontend loads history for the chart, then appends live WebSocket updates. The backend reconnects to the provider with exponential backoff and shuts down cleanly on SIGTERM."

**2. 3-minute architecture explanation**
Walk through the diagram from top to bottom:
1. **Provider client:** dial, subscribe, read loop, read deadline, reconnect loop.
2. **The channel:** decouples network reads from processing.
3. **The processor:** the single consumer, so ticks stay in order.
4. **The three outputs:**
   - state (RWMutex)
   - hub (channels, one writer goroutine per client)
   - DB (separate goroutine, sampled, indexed)
5. **REST** for initial and on-demand data. **WebSocket** for pushes.
6. **Shutdown:** cancelling the context ripples through the pipeline.

**3. Why Go?**
Goroutines and channels make "many connections, many concurrent streams" code straightforward. It compiles to a single static binary and has a strong standard library (HTTP, JSON, context).

**4. Why goroutines?**
Each blocking job gets its own goroutine: reading the provider socket, writing to the DB, writing to each browser. A slow job then can't stall the others. Goroutines are cheap, so one per WebSocket client is fine.

**5. Why channels?**
They pass ownership of data between stages and give buffering between stages that run at different speeds. The hub's clients map is touched by only one goroutine, so it needs no lock.

**6. Why WebSocket?**
The server pushes each update as it happens over one long-lived connection. There's no polling delay and no repeated HTTP overhead.

**7. Why REST?**
For request/response data: the symbol list, a one-off latest price, and history with query parameters. It's easy to cache, test with curl, and document.

**8. Why PostgreSQL?**
Reliable, and good at indexed time-range queries. NUMERIC stores prices exactly. Its features cover this workload without extra infrastructure.

**9. Why not just poll the API?**
Polling adds delay (up to the poll interval) and wastes requests when nothing changes. Tiingo's free REST tier is also limited to 50 requests per hour, which is far too few for live prices.

**10. What if the provider disconnects?**
`ReadMessage` returns an error, or the 60s read deadline fires if the connection silently died. We ping every 25s, so a healthy but quiet connection keeps extending the deadline through pongs. The client marks itself disconnected (health shows `degraded`), waits, and reconnects. The dashboard keeps showing the last prices.

**11. How does reconnection work?**
A loop in `Client.Run` waits 1s, 2s, 4s, 8s … capped at 30s, and resets to 1s after a connection that delivered data or stayed up for over a minute. The wait is a `select` on a timer and `ctx.Done()`, so shutdown never waits for a backoff to finish.

**12. How do you prevent race conditions?**
- Shared state is either owned by one goroutine (the hub's map, the processor's `lastSaved` map) or protected by an RWMutex (latest prices) or an atomic (the connected flag).
- Each WebSocket connection has exactly one writer goroutine.
- I run `go test -race`.

**13. How do you handle multiple WebSocket clients?**
The hub keeps a set of clients. Register and unregister happen through channels. A broadcast marshals the JSON once and puts the same bytes into every client's buffered `send` channel. Each client's write goroutine sends them.

**14. What if one WebSocket client is slow?**
Its `send` buffer fills. The hub uses a non-blocking send, so when the buffer is full it disconnects that client instead of waiting. Other clients are unaffected, and the browser's reconnect logic can bring the slow client back.

**15. How does graceful shutdown work?**
`signal.NotifyContext` cancels the context on SIGINT/SIGTERM, then:
1. `http.Server.Shutdown` stops new requests and finishes in-flight ones.
2. The provider client closes its socket and the tick channel.
3. The processor drains and flushes the DB queue.
4. The hub sends close frames to clients.
5. A `WaitGroup` waits for all of these, and the DB pool is closed last via `defer`.

**16. How would you scale this?**
- Run several backend instances behind a load balancer. Only one (or a dedicated ingester service) should hold the provider connection, and it publishes ticks to Redis Pub/Sub or Kafka. Each API instance subscribes and serves its own WebSocket clients.
- Store history in TimescaleDB or a partitioned table, with downsampled candles.

**17. Where would Kafka fit?**
Between the ingester and its consumers: a `fx.ticks` topic partitioned by symbol (which keeps per-pair ordering). The consumers would be storage writers, WebSocket gateways and analytics. It gives durability, replay and independent consumers. That's overkill for one process.

**18. Where would Redis fit?**
- As a shared latest-price snapshot for multiple API instances.
- As Pub/Sub fan-out to WebSocket gateways.
- Not needed with a single instance.

**19. Limitations**
- The free-tier Tiingo feed has bandwidth and usage limits.
- Single instance.
- Ticks are dropped if the DB is down.
- No auth.
- Prices are `float64` in Go. That's fine for display but not for accounting.
- No candles or aggregation.
- Minimal test coverage.

**20. Production improvements**
- A paid or licensed data feed.
- A decimal type for prices.
- Batched inserts or COPY.
- Retry or buffer for DB outages.
- Metrics (Prometheus) and alerts.
- Auth and rate limiting.
- A migration tool (golang-migrate).
- More tests (handlers, hub, reconnect against a fake server).
- Horizontal scaling as described in point 16.
