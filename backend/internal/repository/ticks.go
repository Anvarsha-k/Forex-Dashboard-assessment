// Package repository stores and reads ticks in PostgreSQL.
package repository

import (
	"context"
	"fmt"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"live-market-dashboard/internal/model"
)

// NewPool opens a shared connection pool (connections are reused, not
// opened per request).
func NewPool(ctx context.Context, url string, maxConns, minConns int32) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	cfg.MaxConns = maxConns
	cfg.MinConns = minConns
	cfg.MaxConnLifetime = time.Hour
	cfg.MaxConnIdleTime = 15 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("connect to database: %w", err)
	}
	return pool, nil
}

type TickRepo struct {
	pool *pgxpool.Pool
}

func NewTickRepo(pool *pgxpool.Pool) *TickRepo {
	return &TickRepo{pool: pool}
}

func (r *TickRepo) Save(ctx context.Context, t model.MarketTick) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO market_ticks (symbol, bid, ask, price, event_time) VALUES ($1, $2, $3, $4, $5)`,
		t.Symbol, t.Bid, t.Ask, t.Price, t.Timestamp)
	if err != nil {
		return fmt.Errorf("insert tick: %w", err)
	}
	return nil
}

// History returns the newest `limit` ticks between from and to, oldest first.
func (r *TickRepo) History(ctx context.Context, symbol string, from, to time.Time, limit int) ([]model.MarketTick, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT symbol, bid, ask, price, event_time
		FROM market_ticks
		WHERE symbol = $1 AND event_time BETWEEN $2 AND $3
		ORDER BY event_time DESC
		LIMIT $4`, symbol, from, to, limit)
	if err != nil {
		return nil, fmt.Errorf("query history: %w", err)
	}
	ticks, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (model.MarketTick, error) {
		var t model.MarketTick
		err := row.Scan(&t.Symbol, &t.Bid, &t.Ask, &t.Price, &t.Timestamp)
		return t, err
	})
	if err != nil {
		return nil, fmt.Errorf("scan history: %w", err)
	}
	slices.Reverse(ticks) // oldest first for the chart
	return ticks, nil
}

// Candles groups ticks into OHLC bars of the given size, newest `limit`
// bars, oldest first. date_bin (PostgreSQL 14+) rounds each event_time down
// to the start of its bucket; the WHERE clause uses the (symbol, event_time)
// index.
func (r *TickRepo) Candles(ctx context.Context, symbol string, bucket time.Duration, limit int) ([]model.Candle, error) {
	from := time.Now().Add(-bucket * time.Duration(limit))
	rows, err := r.pool.Query(ctx, `
		SELECT date_bin($2::interval, event_time, TIMESTAMPTZ '2000-01-01') AS bucket,
		       (array_agg(price ORDER BY event_time))[1]      AS open,
		       max(price)                                    AS high,
		       min(price)                                    AS low,
		       (array_agg(price ORDER BY event_time DESC))[1] AS close,
		       count(*)                                      AS ticks
		FROM market_ticks
		WHERE symbol = $1 AND event_time >= $3
		GROUP BY bucket
		ORDER BY bucket DESC
		LIMIT $4`, symbol, bucket, from, limit)
	if err != nil {
		return nil, fmt.Errorf("query candles: %w", err)
	}
	candles, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (model.Candle, error) {
		var c model.Candle
		err := row.Scan(&c.Time, &c.Open, &c.High, &c.Low, &c.Close, &c.Ticks)
		return c, err
	})
	if err != nil {
		return nil, fmt.Errorf("scan candles: %w", err)
	}
	slices.Reverse(candles)
	return candles, nil
}

// Latest returns the most recent stored tick for each symbol. It is used at
// startup so the dashboard shows the last known prices even before the first
// live quote arrives (e.g. on a weekend). The LATERAL subquery reads one row
// per symbol from the (symbol, event_time) index instead of scanning the table.
func (r *TickRepo) Latest(ctx context.Context, symbols []string) ([]model.MarketTick, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT t.symbol, t.bid, t.ask, t.price, t.event_time
		FROM unnest($1::text[]) AS s(symbol)
		CROSS JOIN LATERAL (
			SELECT symbol, bid, ask, price, event_time FROM market_ticks
			WHERE symbol = s.symbol ORDER BY event_time DESC LIMIT 1
		) t`, symbols)
	if err != nil {
		return nil, fmt.Errorf("query latest: %w", err)
	}
	ticks, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (model.MarketTick, error) {
		var t model.MarketTick
		err := row.Scan(&t.Symbol, &t.Bid, &t.Ask, &t.Price, &t.Timestamp)
		return t, err
	})
	if err != nil {
		return nil, fmt.Errorf("scan latest: %w", err)
	}
	return ticks, nil
}

func (r *TickRepo) Ping(ctx context.Context) error {
	return r.pool.Ping(ctx)
}
