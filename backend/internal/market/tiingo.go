// Package market connects to the Tiingo FX WebSocket and turns its messages
// into model.MarketTick values. Nothing Tiingo-specific leaves this package.
//
// Docs: https://www.tiingo.com/documentation/websockets/forex
package market

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"

	"live-market-dashboard/internal/model"
)

// Client streams quotes from Tiingo and reconnects when the connection drops.
type Client struct {
	url       string
	apiKey    string
	symbols   map[string]string // "eurusd" -> "EUR/USD"
	connected atomic.Bool       // read by the health endpoint
}

func NewClient(url, apiKey string, symbols []string) *Client {
	m := make(map[string]string)
	for _, s := range symbols {
		m[toTicker(s)] = s
	}
	return &Client{url: url, apiKey: apiKey, symbols: m}
}

func (c *Client) Connected() bool { return c.connected.Load() }

// Run sends ticks to out until ctx is cancelled, reconnecting with
// exponential backoff (1s, 2s, 4s ... max 30s). It closes out when it
// returns so the consumer knows no more ticks are coming.
func (c *Client) Run(ctx context.Context, out chan<- model.MarketTick) {
	defer close(out)
	backoff := time.Second
	for {
		start := time.Now()
		gotData, err := c.connectAndRead(ctx, out)
		c.connected.Store(false)
		if ctx.Err() != nil {
			return // shutting down
		}
		if gotData || time.Since(start) > time.Minute {
			backoff = time.Second // the connection worked, start over
		}
		slog.Warn("provider disconnected, reconnecting", "error", err, "retry_in", backoff.String())

		select {
		case <-time.After(backoff):
		case <-ctx.Done():
			return
		}
		backoff = min(backoff*2, 30*time.Second)
	}
}

func (c *Client) connectAndRead(ctx context.Context, out chan<- model.MarketTick) (bool, error) {
	conn, _, err := websocket.DefaultDialer.DialContext(ctx, c.url, nil)
	if err != nil {
		return false, fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()

	// ReadMessage blocks, so on shutdown we close the connection to unblock it.
	stop := context.AfterFunc(ctx, func() { conn.Close() })
	defer stop()

	tickers := make([]string, 0, len(c.symbols))
	for t := range c.symbols {
		tickers = append(tickers, t)
	}
	sub := map[string]any{
		"eventName":     "subscribe",
		"authorization": c.apiKey,
		"eventData":     map[string]any{"thresholdLevel": 5, "tickers": tickers},
	}
	if err := conn.WriteJSON(sub); err != nil {
		return false, fmt.Errorf("subscribe: %w", err)
	}
	slog.Info("connected to provider, subscription sent", "tickers", tickers)
	c.connected.Store(true)

	// Keepalive: when the market is quiet (e.g. weekends) Tiingo may send
	// nothing for minutes. We ping every 25s; each pong (or any message)
	// pushes the read deadline forward, so 60s with no answer at all means
	// the connection is dead even if TCP hasn't noticed.
	const readTimeout = 60 * time.Second
	conn.SetReadDeadline(time.Now().Add(readTimeout))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(readTimeout))
	})
	pingDone := make(chan struct{})
	defer close(pingDone)
	go func() {
		ticker := time.NewTicker(25 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				// WriteControl is safe to call alongside ReadMessage.
				if err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)); err != nil {
					return
				}
			case <-pingDone:
				return
			}
		}
	}()

	gotData := false
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return gotData, fmt.Errorf("read: %w", err)
		}
		conn.SetReadDeadline(time.Now().Add(readTimeout))

		tick, ok, err := c.parse(raw)
		if err != nil {
			slog.Warn("skipping bad provider message", "error", err)
			continue
		}
		if !ok {
			continue // heartbeat, info or a pair we don't track
		}
		gotData = true
		select {
		case out <- tick:
		case <-ctx.Done():
			return gotData, ctx.Err()
		}
	}
}

// parse decodes one Tiingo message. ok is false for messages that are not
// quotes. A quote looks like:
//
//	{"messageType":"A","service":"fx",
//	 "data":["Q","eurusd","2019-07-05T15:49:15.157000+00:00",5000000.0,1.12079,1.120795,1000000.0,1.1208]}
//
// data = [type, ticker, date, bidSize, bidPrice, midPrice, askSize, askPrice]
func (c *Client) parse(raw []byte) (tick model.MarketTick, ok bool, err error) {
	var msg struct {
		MessageType string                   `json:"messageType"`
		Data        json.RawMessage          `json:"data"`
		Response    struct{ Message string } `json:"response"`
	}
	if err := json.Unmarshal(raw, &msg); err != nil {
		return tick, false, err
	}
	switch msg.MessageType {
	case "A":
	case "E":
		return tick, false, fmt.Errorf("provider error: %s", msg.Response.Message)
	default:
		return tick, false, nil // "H" heartbeat, "I" info
	}

	var data []any
	if err := json.Unmarshal(msg.Data, &data); err != nil {
		return tick, false, err
	}
	if len(data) < 8 || data[0] != "Q" {
		return tick, false, nil
	}
	ticker, _ := data[1].(string)
	symbol, tracked := c.symbols[strings.ToLower(ticker)]
	if !tracked {
		return tick, false, nil
	}
	date, _ := data[2].(string)
	ts, err := time.Parse(time.RFC3339Nano, date)
	if err != nil {
		return tick, false, fmt.Errorf("bad date %q", date)
	}
	bid, bidOK := data[4].(float64)
	ask, askOK := data[7].(float64)
	if !bidOK || !askOK || bid <= 0 || ask <= 0 {
		return tick, false, errors.New("quote is missing bid or ask")
	}

	return model.MarketTick{
		Symbol:    symbol,
		Bid:       bid,
		Ask:       ask,
		Price:     (bid + ask) / 2,
		Timestamp: ts.UTC(),
	}, true, nil
}

// toTicker converts "EUR/USD" to Tiingo's "eurusd".
func toTicker(symbol string) string {
	return strings.ToLower(strings.ReplaceAll(symbol, "/", ""))
}
