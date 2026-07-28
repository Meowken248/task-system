package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/makeplane/plane/apps/go-api/internal/config"
	"github.com/makeplane/plane/apps/go-api/internal/database"
	"github.com/makeplane/plane/apps/go-api/internal/httpapi"
	"github.com/makeplane/plane/apps/go-api/internal/instance"
	"github.com/makeplane/plane/apps/go-api/internal/legacy"
)

var version = "dev"

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := config.Load()
	if err != nil {
		logger.Error("invalid configuration", "error", err)
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	db, err := database.NewChecker(cfg.DatabaseURL)
	if err != nil {
		logger.Error("database readiness configuration failed", "error", err)
		os.Exit(1)
	}
	var legacyHandler http.Handler
	var instanceHandler http.Handler
	if cfg.LegacyAPIURL != "" {
		legacyHandler, err = legacy.NewProxy(cfg.LegacyAPIURL)
		if err != nil {
			logger.Error("legacy proxy initialization failed", "error", err)
			os.Exit(1)
		}
		instanceHandler, err = instance.NewHandler(cfg.LegacyAPIURL, 2*time.Minute)
		if err != nil {
			logger.Error("instance handler initialization failed", "error", err)
			os.Exit(1)
		}
	}
	server := &http.Server{
		Addr: cfg.Address,
		Handler: httpapi.NewRouter(httpapi.Dependencies{
			Readiness: db, Legacy: legacyHandler, Instance: instanceHandler, Version: version,
		}),
		ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second,
		WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second,
	}
	go func() {
		logger.Info("Go API listening", "address", cfg.Address, "legacy_fallback", cfg.LegacyAPIURL != "")
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("HTTP server failed", "error", err)
			stop()
		}
	}()
	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
	}
}
