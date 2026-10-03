# Live Forex Market Dashboard

Streams live Forex quotes from Tiingo into a Go backend and shows them on a real-time React dashboard (WebSocket + PostgreSQL).

For architecture, API, design decisions and more, see **[PROJECT_DETAILS.md](PROJECT_DETAILS.md)**.

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- A free Tiingo API key: sign up at https://www.tiingo.com and copy your token from the API section of your account.

## Run with Docker

```bash
cp .env.example .env        # then set MARKET_DATA_API_KEY in .env
docker compose up --build
```

| What | URL |
|---|---|
| Dashboard | http://localhost:3000 |
| API health | http://localhost:8080/api/v1/health |

Stop it with `Ctrl+C` or `docker compose down`. Add `-v` to also delete the database.

## Run locally (without Docker for the app)

Requires Go 1.25+ and Node.js 20+.

```bash
# 1. Database
docker compose up postgres

# 2. Backend (new terminal)
cd backend
export MARKET_DATA_API_KEY=your-key
export DATABASE_URL="postgres://forex:forex@localhost:5433/forex?sslmode=disable"
go run ./cmd/server

# 3. Frontend (new terminal)
cd frontend
npm install
npm run dev                 # http://localhost:5173
```

On Windows PowerShell, set variables with `$env:MARKET_DATA_API_KEY = "your-key"`.

## Tests

```bash
cd backend
go test ./...
go test -race ./...         # needs cgo; on Windows run inside Docker or WSL
```

## Notes

- Forex markets are closed at weekends, so few or no live quotes arrive then.
- The free Tiingo plan is limited to 1 GB of bandwidth per month and personal use only.
