package sso

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"sort"
	"time"

	"github.com/gin-gonic/gin"
)

func SafeEndpoint(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return "invalid"
	}
	return u.Scheme + "://" + u.Host + u.Path
}

func Upstream(c *gin.Context, client *http.Client, stage string, req *http.Request, target any) bool {
	start := time.Now()
	endpoint := req.URL.Scheme + "://" + req.URL.Host + req.URL.Path
	slog.Debug("SSO upstream request", "request_id", c.GetString("request_id"), "stage", stage, "method", req.Method, "endpoint", endpoint)
	resp, err := client.Do(req)
	if err != nil {
		slog.Warn("SSO upstream transport failed", "request_id", c.GetString("request_id"), "stage", stage, "endpoint", endpoint)
		return false
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, (1<<20)+1))
	fields := []string{}
	var values map[string]json.RawMessage
	if json.Unmarshal(body, &values) == nil {
		for key := range values {
			fields = append(fields, key)
		}
		sort.Strings(fields)
	}
	slog.Debug("SSO upstream response", "request_id", c.GetString("request_id"), "stage", stage, "endpoint", endpoint, "status", resp.StatusCode, "duration", time.Since(start), "fields", fields)
	if err != nil || len(body) > 1<<20 || resp.StatusCode/100 != 2 || json.Unmarshal(body, target) != nil {
		slog.Warn("SSO upstream response rejected", "request_id", c.GetString("request_id"), "stage", stage, "status", resp.StatusCode)
		return false
	}
	return true
}
