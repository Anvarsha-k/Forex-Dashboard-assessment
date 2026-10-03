// Package handler implements the REST API.
package handler

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"live-market-dashboard/internal/model"
	"live-market-dashboard/internal/service"
)

type HistoryStore interface {
	History(ctx context.Context, symbol string, from, to time.Time, limit int) ([]model.MarketTick, error)
	Candles(ctx context.Context, symbol string, bucket time.Duration, limit int) ([]model.Candle, error)
	Ping(ctx context.Context) error
}

// candleIntervals are the bar sizes the candles endpoint accepts.
var candleIntervals = map[string]time.Duration{
	"1m":  time.Minute,
	"5m":  5 * time.Minute,
	"15m": 15 * time.Minute,
	"1h":  time.Hour,
}

type Handler struct {
	symbols        []string
	state          *service.MarketState
	db             HistoryStore
	providerUp     func() bool
	allowedOrigins []string
}

func New(symbols []string, state *service.MarketState, db HistoryStore, providerUp func() bool, allowedOrigins []string) *Handler {
	return &Handler{symbols: symbols, state: state, db: db, providerUp: providerUp, allowedOrigins: allowedOrigins}
}

// Routes registers all endpoints. {symbol} is written without the slash,
// e.g. /api/v1/markets/EURUSD.
func (h *Handler) Routes(ws http.Handler) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/health", h.health)
	mux.HandleFunc("GET /api/v1/markets", h.listMarkets)
	mux.HandleFunc("GET /api/v1/markets/{symbol}", h.getMarket)
	mux.HandleFunc("GET /api/v1/markets/{symbol}/history", h.getHistory)
	mux.HandleFunc("GET /api/v1/markets/{symbol}/candles", h.getCandles)
	mux.Handle("GET /api/v1/ws", ws)
	return h.cors(mux)
}

func (h *Handler) listMarkets(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, h.symbols)
}

func (h *Handler) getMarket(w http.ResponseWriter, r *http.Request) {
	symbol, ok := h.resolveSymbol(r.PathValue("symbol"))
	if !ok {
		writeError(w, http.StatusNotFound, "unsupported symbol")
		return
	}
	tick, ok := h.state.Get(symbol)
	if !ok {
		writeError(w, http.StatusNotFound, "no data received yet for "+symbol)
		return
	}
	writeJSON(w, http.StatusOK, tick)
}

// getHistory supports ?limit= (1-1000, default 200), ?from= and ?to=
// (RFC3339, default: last 24 hours).
func (h *Handler) getHistory(w http.ResponseWriter, r *http.Request) {
	symbol, ok := h.resolveSymbol(r.PathValue("symbol"))
	if !ok {
		writeError(w, http.StatusNotFound, "unsupported symbol")
		return
	}

	q := r.URL.Query()
	limit := 200
	if s := q.Get("limit"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 1 || n > 1000 {
			writeError(w, http.StatusBadRequest, "limit must be between 1 and 1000")
			return
		}
		limit = n
	}
	to, err := parseTime(q.Get("to"), time.Now())
	if err != nil {
		writeError(w, http.StatusBadRequest, "to must be RFC3339, e.g. 2026-01-02T15:04:05Z")
		return
	}
	from, err := parseTime(q.Get("from"), to.Add(-24*time.Hour))
	if err != nil {
		writeError(w, http.StatusBadRequest, "from must be RFC3339, e.g. 2026-01-02T15:04:05Z")
		return
	}
	if !from.Before(to) {
		writeError(w, http.StatusBadRequest, "from must be before to")
		return
	}

	ticks, err := h.db.History(r.Context(), symbol, from, to, limit)
	if err != nil {
		slog.Error("history query failed", "error", err)
		writeError(w, http.StatusServiceUnavailable, "history unavailable")
		return
	}
	writeJSON(w, http.StatusOK, ticks)
}

// getCandles supports ?interval= (1m, 5m, 15m, 1h; default 1m) and
// ?limit= (1-500, default 200).
func (h *Handler) getCandles(w http.ResponseWriter, r *http.Request) {
	symbol, ok := h.resolveSymbol(r.PathValue("symbol"))
	if !ok {
		writeError(w, http.StatusNotFound, "unsupported symbol")
		return
	}

	q := r.URL.Query()
	interval := q.Get("interval")
	if interval == "" {
		interval = "1m"
	}
	bucket, ok := candleIntervals[interval]
	if !ok {
		writeError(w, http.StatusBadRequest, "interval must be one of 1m, 5m, 15m, 1h")
		return
	}
	limit := 200
	if s := q.Get("limit"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 1 || n > 500 {
			writeError(w, http.StatusBadRequest, "limit must be between 1 and 500")
			return
		}
		limit = n
	}

	candles, err := h.db.Candles(r.Context(), symbol, bucket, limit)
	if err != nil {
		slog.Error("candles query failed", "error", err)
		writeError(w, http.StatusServiceUnavailable, "candles unavailable")
		return
	}
	writeJSON(w, http.StatusOK, candles)
}

func (h *Handler) health(w http.ResponseWriter, r *http.Request) {
	dbStatus := "up"
	if err := h.db.Ping(r.Context()); err != nil {
		dbStatus = "down"
	}
	status := "ok"
	if dbStatus == "down" || !h.providerUp() {
		status = "degraded"
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":             status,
		"database":           dbStatus,
		"provider_connected": h.providerUp(),
	})
}

// resolveSymbol turns "eurusd" / "EUR-USD" into "EUR/USD" if it's supported.
func (h *Handler) resolveSymbol(raw string) (string, bool) {
	s := strings.ToUpper(strings.NewReplacer("/", "", "-", "").Replace(raw))
	if len(s) != 6 {
		return "", false
	}
	s = s[:3] + "/" + s[3:]
	for _, sym := range h.symbols {
		if sym == s {
			return s, true
		}
	}
	return "", false
}

func (h *Handler) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); slices.Contains(h.allowedOrigins, origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func parseTime(s string, def time.Time) (time.Time, error) {
	if s == "" {
		return def, nil
	}
	return time.Parse(time.RFC3339, s)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
