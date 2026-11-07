package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"volun-data/internal/auth"
	"volun-data/internal/config"
	"volun-data/internal/dto"
)

type stubPinger struct{ err error }

func (s stubPinger) PingContext(context.Context) error { return s.err }

func TestRouterResponsesAndLogRedaction(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		name, method, path string
		dbError            error
		status             int
		code               dto.ErrCode
	}{
		{"liveness ignores database outage", "GET", "/healthz", errors.New("offline"), 200, dto.Success},
		{"ready", "GET", "/readyz", nil, 200, dto.Success},
		{"database unavailable", "GET", "/readyz", errors.New("private database detail"), 503, dto.DatabaseUnavailable},
		{"versioned route", "GET", "/api/v1/ping", nil, 200, dto.Success},
		{"missing route", "GET", "/missing?code=secret-value", nil, 404, dto.ResourceNotFound},
		{"wrong method", "POST", "/healthz", nil, 405, dto.MethodNotAllowed},
		{"recovery", "GET", "/panic", nil, 500, dto.InternalError},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var logs bytes.Buffer
			db, err := gorm.Open(sqlite.Open(":memory:"))
			if err != nil {
				t.Fatal(err)
			}
			pool, err := db.DB()
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = pool.Close() })
			service := &auth.Service{DB: db, Config: config.Auth{SessionTTL: time.Hour}}
			r := NewRouter(stubPinger{tc.dbError}, slog.New(slog.NewJSONHandler(&logs, nil)), service)
			r.GET("/panic", func(c *gin.Context) { panic("private panic detail") })
			w := httptest.NewRecorder()
			r.ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, nil))
			if w.Code != tc.status {
				t.Fatalf("status = %d, want %d: %s", w.Code, tc.status, w.Body.String())
			}
			var response dto.Response
			if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if response.ErrCode != tc.code || response.RequestID == "" || response.RequestID != w.Header().Get("X-Request-ID") {
				t.Fatalf("unexpected response: %+v", response)
			}
			for _, secret := range []string{"secret-value", "private database detail", "private panic detail"} {
				if strings.Contains(logs.String()+w.Body.String(), secret) {
					t.Fatalf("leaked %q", secret)
				}
			}
		})
	}
}
