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
	"volun-data/internal/migration"
	"volun-data/internal/migrations"
	"volun-data/internal/model"
	"volun-data/internal/observability"
)

func main() {
	log, err := observability.NewLogger("info")
	if err != nil {
		panic(err)
	}
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
	log, err = observability.NewLogger(cfg.LogLevel)
	if err != nil {
		return err
	}
	slog.SetDefault(log)
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
	authService := &auth.Service{DB: db, Config: cfg.Auth, MaterialDefaults: cfg.Attachment1, HTTP: &http.Client{Timeout: 10 * time.Second}}
	log.Info("SSO configuration", "client_id_configured", cfg.Auth.SSOClientID != "", "client_secret_configured", cfg.Auth.SSOClientSecret != "")
	if err := migration.Run(db, migrations.All()); err != nil {
		return fmt.Errorf("authentication migration: %w", err)
	}
	log.Info("database ready", "driver", cfg.Database.Driver, "schema_version", 1)
	if cfg.Database.Driver == "sqlite" {
		log.Info("local database", "path", cfg.Database.SQLitePath, "user_primary_key", "sub")
	}
	if cfg.Env == "dev" {
		if err := authService.SeedDev(); err != nil {
			return fmt.Errorf("seed development account: %w", err)
		}
		var devUser model.User
		if err := db.Where("username = ?", cfg.Auth.DevUsername).First(&devUser).Error; err != nil {
			return fmt.Errorf("load development account: %w", err)
		}
		log.Info("development account ready", "sub", devUser.Sub, "id", devUser.ID, "username", devUser.Username, "password", cfg.Auth.DevPassword, "groups", devUser.Groups)
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
