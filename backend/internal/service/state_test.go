package service

import (
	"sync"
	"testing"

	"live-market-dashboard/internal/model"
)

// Run with `go test -race ./...` to check for data races.
func TestMarketStateConcurrentAccess(t *testing.T) {
	s := NewMarketState()
	var wg sync.WaitGroup

	wg.Go(func() { // one writer, like the processor
		for i := range 1000 {
			s.Update(model.MarketTick{Symbol: "EUR/USD", Bid: float64(i)})
		}
	})
	for range 5 { // many readers, like HTTP handlers
		wg.Go(func() {
			for range 1000 {
				s.Get("EUR/USD")
			}
		})
	}
	wg.Wait()

	tick, ok := s.Get("EUR/USD")
	if !ok || tick.Bid != 999 {
		t.Errorf("got %+v, want last update (bid 999)", tick)
	}
}
