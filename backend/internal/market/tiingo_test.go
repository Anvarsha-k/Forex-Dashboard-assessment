package market

import (
	"testing"
	"time"
)

func TestParseQuote(t *testing.T) {
	c := NewClient("", "", []string{"EUR/USD"})

	// Sample message from the Tiingo FX docs.
	raw := `{"messageType":"A","service":"fx","data":["Q","eurusd","2019-07-05T15:49:15.157000+00:00",5000000.0,1.12079,1.120795,1000000.0,1.1208]}`
	tick, ok, err := c.parse([]byte(raw))
	if err != nil || !ok {
		t.Fatalf("parse failed: ok=%v err=%v", ok, err)
	}
	if tick.Symbol != "EUR/USD" || tick.Bid != 1.12079 || tick.Ask != 1.1208 {
		t.Errorf("unexpected tick: %+v", tick)
	}
	want := time.Date(2019, 7, 5, 15, 49, 15, 157_000_000, time.UTC)
	if !tick.Timestamp.Equal(want) {
		t.Errorf("timestamp = %v, want %v", tick.Timestamp, want)
	}
}

func TestParseIgnoresNonQuotes(t *testing.T) {
	c := NewClient("", "", []string{"EUR/USD"})
	for _, raw := range []string{
		`{"messageType":"H","response":{"code":200,"message":"HeartBeat"}}`,
		`{"messageType":"I","data":{"subscriptionId":61}}`,
		`{"messageType":"A","data":["Q","gbpaud","2019-07-05T15:49:15Z",1,1.79,1.79,1,1.80]}`, // not subscribed
	} {
		if _, ok, err := c.parse([]byte(raw)); ok || err != nil {
			t.Errorf("%s: expected ignored, got ok=%v err=%v", raw, ok, err)
		}
	}
}

func TestParseRejectsBadQuote(t *testing.T) {
	c := NewClient("", "", []string{"EUR/USD"})
	raw := `{"messageType":"A","data":["Q","eurusd","2019-07-05T15:49:15Z",1,null,null,1,1.12]}`
	if _, _, err := c.parse([]byte(raw)); err == nil {
		t.Error("expected error for quote without bid")
	}
}
