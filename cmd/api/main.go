package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"

	"volun-data/internal/auth"
	"volun-data/internal/config"
	"volun-data/internal/database"
	"volun-data/internal/httpapi"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(log); err != nil {
		// Driver errors can contain connection details; keep them out of default logs.
		log.Error("API stopped", "error", err.Error())
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	gin.SetMode(gin.ReleaseMode)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	db, err := database.Open(ctx, cfg.Database)
	if err != nil {
		return errors.New("database initialization failed; check database configuration and availability")
	}
	pool, err := db.DB()
	if err != nil {
		return errors.New("database pool unavailable")
	}
	defer pool.Close()
	authService := &auth.Service{DB: db, Config: cfg.Auth, HTTP: &http.Client{Timeout: 10 * time.Second}}
	log.Info("SSO configuration", "client_id_configured", cfg.Auth.SSOClientID != "", "client_secret_configured", cfg.Auth.SSOClientSecret != "")
	if err := authService.Migrate(); err != nil {
		return fmt.Errorf("authentication migration: %w", err)
	}
	if cfg.Env == "dev" {
		if err := authService.SeedDev(); err != nil {
			return fmt.Errorf("seed development account: %w", err)
		}
		log.Info("development login credentials", "username", cfg.Auth.DevUsername, "password", cfg.Auth.DevPassword)
	}
	router := httpapi.NewRouter(pool, log, authService)
	if err := router.SetTrustedProxies(nil); err != nil {
		return fmt.Errorf("configure trusted proxies: %w", err)
	}
	server := &http.Server{
		Addr: cfg.HTTPAddr, Handler: router,
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second,
		WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second,
		MaxHeaderBytes: 1 << 20,
	}
	serverErrors := make(chan error, 1)
	go func() { serverErrors <- server.ListenAndServe() }()
	log.Info("API starting", "address", cfg.HTTPAddr, "environment", cfg.Env, "database_driver", cfg.Database.Driver)
	select {
	case err := <-serverErrors:
		if !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("HTTP server: %w", err)
		}
		return nil
	case <-ctx.Done():
		stop()
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		_ = server.Close()
		return fmt.Errorf("HTTP shutdown: %w", err)
	}
	log.Info("API stopped gracefully")
	return nil
}
