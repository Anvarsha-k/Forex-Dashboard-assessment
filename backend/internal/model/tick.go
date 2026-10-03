// Package model holds the provider-independent types used by the app.
package model

import "time"

// MarketTick is a normalized top-of-book quote for one currency pair.
type MarketTick struct {
	Symbol    string    `json:"symbol"` // e.g. "EUR/USD"
	Bid       float64   `json:"bid"`
	Ask       float64   `json:"ask"`
	Price     float64   `json:"price"` // mid price
	Timestamp time.Time `json:"timestamp"`
}

// Candle is an OHLC bar built from stored mid prices.
type Candle struct {
	Time  time.Time `json:"time"` // start of the bucket
	Open  float64   `json:"open"`
	High  float64   `json:"high"`
	Low   float64   `json:"low"`
	Close float64   `json:"close"`
	Ticks int64     `json:"ticks"` // number of stored ticks in the bucket
}
