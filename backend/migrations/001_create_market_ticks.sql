CREATE TABLE IF NOT EXISTS market_ticks (
    id          BIGSERIAL PRIMARY KEY,
    symbol      VARCHAR(10)     NOT NULL,
    -- NUMERIC stores decimal prices exactly (no float rounding in the DB).
    bid         NUMERIC(18, 8)  NOT NULL,
    ask         NUMERIC(18, 8)  NOT NULL,
    price       NUMERIC(18, 8)  NOT NULL,
    event_time  TIMESTAMPTZ     NOT NULL,
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- History queries filter by symbol and a time range, newest first.
CREATE INDEX IF NOT EXISTS idx_market_ticks_symbol_time
    ON market_ticks (symbol, event_time DESC);
