package service

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"live-market-dashboard/internal/model"
)

type Broadcaster interface {
	Broadcast(msg []byte)
}

type TickSaver interface {
	Save(ctx context.Context, t model.MarketTick) error
}

// Processor reads ticks from the provider channel and fans them out:
// latest state, WebSocket clients, and (sampled) PostgreSQL.
type Processor struct {
	state *MarketState
	hub   Broadcaster
	db    TickSaver
}

func NewProcessor(state *MarketState, hub Broadcaster, db TickSaver) *Processor {
	return &Processor{state: state, hub: hub, db: db}
}

// Run processes ticks until the input channel is closed.
func (p *Processor) Run(in <-chan model.MarketTick) {
	// Database writes happen on their own goroutine so a slow database
	// never delays live prices. The buffer absorbs short stalls.
	toSave := make(chan model.MarketTick, 1000)
	saverDone := make(chan struct{})
	go func() {
		defer close(saverDone)
		for t := range toSave {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			if err := p.db.Save(ctx, t); err != nil {
				slog.Error("failed to save tick", "symbol", t.Symbol, "error", err)
			}
			cancel()
		}
	}()

	// Store at most one tick per symbol per second; the feed can send many
	// updates per second and the chart doesn't need them all.
	lastSaved := make(map[string]time.Time)

	for tick := range in {
		p.state.Update(tick)

		msg, _ := json.Marshal(map[string]any{"type": "market_update", "data": tick})
		p.hub.Broadcast(msg)

		if tick.Timestamp.Sub(lastSaved[tick.Symbol]) >= time.Second {
			lastSaved[tick.Symbol] = tick.Timestamp
			select {
			case toSave <- tick:
			default:
				slog.Warn("save queue full, dropping tick", "symbol", tick.Symbol)
			}
		}
	}

	// Input closed (shutdown): let the saver finish what's queued.
	close(toSave)
	<-saverDone
	slog.Info("processor stopped")
}
