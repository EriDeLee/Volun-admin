package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Env             string
	HTTPAddr        string
	ShutdownTimeout time.Duration
	Database        Database
}

type Database struct {
	Driver          string
	SQLitePath      string
	URL             string
	MaxOpenConns    int
	MaxIdleConns    int
	ConnMaxLifetime time.Duration
	ConnectTimeout  time.Duration
}

func Load() (Config, error) {
	return load(os.Getenv)
}

func load(getenv func(string) string) (Config, error) {
	value := func(key, fallback string) string {
		if v := strings.TrimSpace(getenv(key)); v != "" {
			return v
		}
		return fallback
	}
	c := Config{Env: value("APP_ENV", "dev"), HTTPAddr: value("HTTP_ADDR", ":8080")}
	if c.Env != "dev" && c.Env != "test" && c.Env != "prod" {
		return Config{}, fmt.Errorf("APP_ENV must be dev, test or prod")
	}
	defaultDriver := "sqlite"
	if c.Env == "prod" {
		defaultDriver = "postgres"
	}
	c.Database = Database{
		Driver:     value("DB_DRIVER", defaultDriver),
		SQLitePath: value("SQLITE_PATH", "data/volun-data.db"),
		URL:        strings.TrimSpace(getenv("DATABASE_URL")),
	}
	if c.Database.Driver != "sqlite" && c.Database.Driver != "postgres" {
		return Config{}, fmt.Errorf("DB_DRIVER must be sqlite or postgres")
	}
	if c.Env == "prod" && c.Database.Driver != "postgres" {
		return Config{}, fmt.Errorf("production requires postgres")
	}
	if c.Database.Driver == "postgres" && c.Database.URL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL is required for postgres")
	}
	for _, field := range []struct {
		key      string
		fallback string
		target   *int
	}{
		{"DB_MAX_OPEN_CONNS", "10", &c.Database.MaxOpenConns},
		{"DB_MAX_IDLE_CONNS", "5", &c.Database.MaxIdleConns},
	} {
		n, err := strconv.Atoi(value(field.key, field.fallback))
		if err != nil || n < 0 || (field.key == "DB_MAX_OPEN_CONNS" && n == 0) {
			return Config{}, fmt.Errorf("%s must be a valid connection count", field.key)
		}
		*field.target = n
	}
	if c.Database.MaxIdleConns > c.Database.MaxOpenConns {
		return Config{}, fmt.Errorf("DB_MAX_IDLE_CONNS cannot exceed DB_MAX_OPEN_CONNS")
	}
	for _, field := range []struct {
		key      string
		fallback string
		target   *time.Duration
	}{
		{"DB_CONN_MAX_LIFETIME", "30m", &c.Database.ConnMaxLifetime},
		{"DB_CONNECT_TIMEOUT", "5s", &c.Database.ConnectTimeout},
		{"HTTP_SHUTDOWN_TIMEOUT", "10s", &c.ShutdownTimeout},
	} {
		d, err := time.ParseDuration(value(field.key, field.fallback))
		if err != nil || d <= 0 {
			return Config{}, fmt.Errorf("%s must be a positive duration", field.key)
		}
		*field.target = d
	}
	return c, nil
}
