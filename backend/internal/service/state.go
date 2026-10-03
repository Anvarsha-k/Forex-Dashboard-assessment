// Package service holds the latest market state and the tick processor.
package service

import (
	"sync"

	"live-market-dashboard/internal/model"
)

// MarketState keeps the latest tick per symbol. One goroutine writes (the
// processor) and many read (HTTP handlers), so an RWMutex around a map is
// the simplest safe choice.
type MarketState struct {
	mu    sync.RWMutex
	ticks map[string]model.MarketTick
}

func NewMarketState() *MarketState {
	return &MarketState{ticks: make(map[string]model.MarketTick)}
}

func (s *MarketState) Update(t model.MarketTick) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ticks[t.Symbol] = t
}

func (s *MarketState) Get(symbol string) (model.MarketTick, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	t, ok := s.ticks[symbol]
	return t, ok
}
