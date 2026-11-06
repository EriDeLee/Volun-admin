// Package database owns GORM connections. Business schema changes belong in
// explicit migrations; opening a connection never runs AutoMigrate.
package database

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/glebarez/sqlite"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"volun-data/internal/config"
)

func Open(ctx context.Context, cfg config.Database) (*gorm.DB, error) {
	var dialector gorm.Dialector
	switch cfg.Driver {
	case "sqlite":
		path := cfg.SQLitePath
		if strings.TrimSpace(path) == "" || strings.ContainsAny(path, "?#") || strings.HasPrefix(path, "file:") {
			return nil, fmt.Errorf("SQLITE_PATH must be a local file path or :memory:")
		}
		if path != ":memory:" {
			if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
				return nil, fmt.Errorf("create sqlite directory: %w", err)
			}
		}
		// These pragmas apply to every newly opened underlying connection.
		dialector = sqlite.Open(filepath.ToSlash(path) + "?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)")
	case "postgres":
		if cfg.URL == "" {
			return nil, fmt.Errorf("DATABASE_URL is required for postgres")
		}
		dialector = postgres.Open(cfg.URL)
	default:
		return nil, fmt.Errorf("unsupported database driver")
	}
	// Do not log SQL or connection strings: future auth queries may contain secrets.
	db, err := gorm.Open(dialector, &gorm.Config{
		Logger:               logger.Default.LogMode(logger.Silent),
		DisableAutomaticPing: true,
		TranslateError:       true,
	})
	if err != nil {
		return nil, fmt.Errorf("initialize database driver: %w", err)
	}
	pool, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("get database pool: %w", err)
	}
	if cfg.Driver == "sqlite" {
		// One connection serializes local writes and keeps :memory: databases alive.
		pool.SetMaxOpenConns(1)
		pool.SetMaxIdleConns(1)
		pool.SetConnMaxLifetime(0)
	} else {
		pool.SetMaxOpenConns(cfg.MaxOpenConns)
		pool.SetMaxIdleConns(cfg.MaxIdleConns)
		pool.SetConnMaxLifetime(cfg.ConnMaxLifetime)
	}
	pingCtx, cancel := context.WithTimeout(ctx, cfg.ConnectTimeout)
	defer cancel()
	if err := pool.PingContext(pingCtx); err != nil {
		_ = pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}
	return db, nil
}
