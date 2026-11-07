package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net/http"
	"time"

	"volun-data/internal/auth"
	"volun-data/internal/dto"

	"github.com/gin-gonic/gin"
)

type Pinger interface {
	PingContext(context.Context) error
}

func NewRouter(db Pinger, log *slog.Logger, authService *auth.Service) *gin.Engine {
	r := gin.New()
	r.HandleMethodNotAllowed = true
	r.Use(func(c *gin.Context) {
		var id [16]byte
		if _, err := rand.Read(id[:]); err != nil {
			c.AbortWithStatus(http.StatusInternalServerError)
			return
		}
		requestID := hex.EncodeToString(id[:])
		c.Set("request_id", requestID)
		c.Header("X-Request-ID", requestID)
		start := time.Now()
		c.Next()
		// Path only: SSO callback query parameters must never enter access logs.
		log.Info("http request", "request_id", requestID, "method", c.Request.Method,
			"path", c.Request.URL.Path, "status", c.Writer.Status(), "duration", time.Since(start))
	})
	r.Use(func(c *gin.Context) {
		defer func() {
			if recover() != nil {
				log.Error("http panic recovered", "request_id", c.GetString("request_id"))
				c.Abort()
				if !c.Writer.Written() {
					respond(c, http.StatusInternalServerError, dto.InternalError, "服务暂时不可用", nil)
				}
			}
		}()
		c.Next()
	})
	r.GET("/healthz", func(c *gin.Context) {
		respond(c, http.StatusOK, dto.Success, "ok", dto.HealthResponse{Status: "alive"})
	})
	r.GET("/readyz", func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 3*time.Second)
		defer cancel()
		if err := db.PingContext(ctx); err != nil {
			log.Error("database readiness failed", "request_id", c.GetString("request_id"))
			respond(c, http.StatusServiceUnavailable, dto.DatabaseUnavailable, "数据库暂时不可用", nil)
			return
		}
		respond(c, http.StatusOK, dto.Success, "ok", dto.HealthResponse{Status: "ready"})
	})
	// Register business and auth routes under this versioned group.
	api := r.Group("/api/v1")
	authRoutes := api.Group("/auth")
	authRoutes.POST("/login", authService.Login)
	authRoutes.GET("/me", authService.Me)
	authRoutes.POST("/logout", authService.Logout)
	authRoutes.GET("/sso/start", authService.SSOStart)
	r.GET("/auth/sso/callback", authService.SSOCallback)
	api.GET("/ping", func(c *gin.Context) {
		respond(c, http.StatusOK, dto.Success, "ok", dto.PingResponse{Message: "pong"})
	})
	r.NoRoute(func(c *gin.Context) {
		respond(c, http.StatusNotFound, dto.ResourceNotFound, "接口不存在", nil)
	})
	r.NoMethod(func(c *gin.Context) {
		respond(c, http.StatusMethodNotAllowed, dto.MethodNotAllowed, "请求方法不支持", nil)
	})
	return r
}
