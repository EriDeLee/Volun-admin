package config

import "testing"

func TestLoad(t *testing.T) {
	for _, tc := range []struct {
		name       string
		env        map[string]string
		wantError  bool
		wantDriver string
	}{
		{"dev defaults", nil, false, "sqlite"},
		{"prod requires URL", map[string]string{"APP_ENV": "prod"}, true, ""},
		{"prod rejects sqlite", map[string]string{"APP_ENV": "prod", "DB_DRIVER": "sqlite"}, true, ""},
		{"postgres", map[string]string{"APP_ENV": "prod", "DATABASE_URL": "postgres://localhost/example"}, false, "postgres"},
		{"invalid environment", map[string]string{"APP_ENV": "production-typo"}, true, ""},
		{"invalid timeout", map[string]string{"DB_CONNECT_TIMEOUT": "0s"}, true, ""},
		{"invalid pool", map[string]string{"DB_MAX_OPEN_CONNS": "1", "DB_MAX_IDLE_CONNS": "2"}, true, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg, err := load(func(key string) string { return tc.env[key] })
			if (err != nil) != tc.wantError {
				t.Fatalf("load error = %v, wantError = %v", err, tc.wantError)
			}
			if err == nil && cfg.Database.Driver != tc.wantDriver {
				t.Fatalf("driver = %q, want %q", cfg.Database.Driver, tc.wantDriver)
			}
		})
	}
}
