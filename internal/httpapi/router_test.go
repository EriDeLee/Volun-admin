package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
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
	"volun-data/internal/errhandler"
)

type stubPinger struct{ err error }

func (s stubPinger) PingContext(context.Context) error { return s.err }

func TestLegacySignupRedirectsToFrontend(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		frontend, host string
		status         int
	}{
		{"http://127.0.0.1:5173", "127.0.0.1:8080", 307},
		{"https://volunteer.example.test", "api.example.test", 307},
		{"http://127.0.0.1:8080", "127.0.0.1:8080", 404},
	} {
		service := &auth.Service{Config: config.Auth{FrontendURL: tc.frontend}}
		r := NewRouter(stubPinger{}, slog.New(slog.NewTextHandler(io.Discard, nil)), service)
		query := "attendance=session&project=project&token=synthetic%2Dtoken"
		req := httptest.NewRequest("GET", "http://"+tc.host+"/signup?"+query, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != tc.status {
			t.Fatalf("got %d want %d", w.Code, tc.status)
		}
		if tc.status == 307 && w.Header().Get("Location") != tc.frontend+"/signup?"+query {
			t.Fatalf("lost signup parameters: %s", w.Header().Get("Location"))
		}
	}
}

func TestRouterResponsesAndLogRedaction(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		name, method, path string
		dbError            error
		status             int
		code               errhandler.Code
	}{
		{"liveness ignores database outage", "GET", "/healthz", errors.New("offline"), 200, errhandler.Success},
		{"ready", "GET", "/readyz", nil, 200, errhandler.Success},
		{"database unavailable", "GET", "/readyz", errors.New("private database detail"), 503, errhandler.DatabaseUnavailable},
		{"versioned route", "GET", "/api/v1/ping", nil, 200, errhandler.Success},
		{"missing route", "GET", "/missing?code=secret-value", nil, 404, errhandler.ResourceNotFound},
		{"wrong method", "POST", "/healthz", nil, 405, errhandler.MethodNotAllowed},
		{"recovery", "GET", "/panic", nil, 500, errhandler.InternalError},
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
			if response.ErrCode != int(tc.code) || response.RequestID == "" || response.RequestID != w.Header().Get("X-Request-ID") {
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
