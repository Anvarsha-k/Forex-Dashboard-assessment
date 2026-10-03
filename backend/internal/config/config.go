// Package config reads settings from environment variables.
package config

import (
	"errors"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port           string
	APIKey         string
	ProviderURL    string
	Symbols        []string
	DatabaseURL    string
	DBMaxConns     int32
	DBMinConns     int32
	AllowedOrigins []string
}

func Load() (Config, error) {
	cfg := Config{
		Port:        getEnv("PORT", "8080"),
		APIKey:      os.Getenv("MARKET_DATA_API_KEY"),
		ProviderURL: getEnv("MARKET_DATA_WS_URL", "wss://api.tiingo.com/fx"),
		Symbols:     strings.Split(getEnv("MARKET_SYMBOLS", "EUR/USD,GBP/USD,USD/JPY,USD/INR"), ","),
		DatabaseURL: os.Getenv("DATABASE_URL"),
		DBMaxConns:  int32(getInt("DB_MAX_CONNS", 10)),
		DBMinConns:  int32(getInt("DB_MIN_CONNS", 2)),
		// Comma-separated: Vite dev server (5173) and the Docker frontend (3000).
		AllowedOrigins: strings.Split(getEnv("CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:3000"), ","),
	}
	if cfg.APIKey == "" {
		return cfg, errors.New("MARKET_DATA_API_KEY is required")
	}
	if cfg.DatabaseURL == "" {
		return cfg, errors.New("DATABASE_URL is required")
	}
	return cfg, nil
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func getInt(key string, def int) int {
	if n, err := strconv.Atoi(os.Getenv(key)); err == nil {
		return n
	}
	return def
}
