package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"live-market-dashboard/internal/config"
	"live-market-dashboard/internal/handler"
	"live-market-dashboard/internal/market"
	"live-market-dashboard/internal/model"
	"live-market-dashboard/internal/repository"
	"live-market-dashboard/internal/service"
	"live-market-dashboard/internal/websocket"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if err := run(); err != nil {
		slog.Error("server failed", "error", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	// ctx is cancelled when we receive Ctrl+C or SIGTERM (docker stop).
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := repository.NewPool(ctx, cfg.DatabaseURL, cfg.DBMaxConns, cfg.DBMinConns)
	if err != nil {
		return err
	}
	defer pool.Close()
	repo := repository.NewTickRepo(pool)

	// Start with the last stored prices so the API isn't empty before the
	// first live quote (useful at weekends, when quotes are rare).
	state := service.NewMarketState()
	if latest, err := repo.Latest(ctx, cfg.Symbols); err != nil {
		slog.Warn("could not load last known prices", "error", err)
	} else {
		for _, t := range latest {
			state.Update(t)
		}
		slog.Info("loaded last known prices", "symbols", len(latest))
	}
	hub := websocket.NewHub(cfg.AllowedOrigins)
	provider := market.NewClient(cfg.ProviderURL, cfg.APIKey, cfg.Symbols)
	processor := service.NewProcessor(state, hub, repo)

	// Pipeline: provider --ticks channel--> processor --> state / hub / db
	ticks := make(chan model.MarketTick, 100)
	var wg sync.WaitGroup
	wg.Go(func() { provider.Run(ctx, ticks) }) // closes ticks when ctx is cancelled
	wg.Go(func() { processor.Run(ticks) })     // exits when ticks is closed
	wg.Go(func() { hub.Run(ctx) })             // closes all clients on cancel

	h := handler.New(cfg.Symbols, state, repo, provider.Connected, cfg.AllowedOrigins)
	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      h.Routes(hub),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		slog.Info("server listening", "port", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("http server error", "error", err)
			stop()
		}
	}()

	<-ctx.Done()
	slog.Info("shutting down")

	// Stop accepting requests and let in-flight ones finish.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("http shutdown", "error", err)
	}

	// Wait for the provider, processor and hub to finish. pool.Close runs
	// afterwards via defer.
	wg.Wait()
	slog.Info("shutdown complete")
	return nil
}
