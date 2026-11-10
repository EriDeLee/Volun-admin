package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"volun-data/internal/activity"
	"volun-data/internal/admin"
	"volun-data/internal/auth"
	"volun-data/internal/dto"
	"volun-data/internal/errhandler"

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
					errhandler.Fail(c, errhandler.InternalError)
				}
			}
		}()
		c.Next()
	})
	r.GET("/healthz", func(c *gin.Context) {
		errhandler.OK(c, dto.HealthResponse{Status: "alive"})
	})
	r.GET("/readyz", func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 3*time.Second)
		defer cancel()
		if err := db.PingContext(ctx); err != nil {
			log.Error("database readiness failed", "request_id", c.GetString("request_id"))
			errhandler.Fail(c, errhandler.DatabaseUnavailable)
			return
		}
		errhandler.OK(c, dto.HealthResponse{Status: "ready"})
	})
	// Register business and auth routes under this versioned group.
	api := r.Group("/api/v1")
	authRoutes := api.Group("/auth")
	authRoutes.POST("/login", authService.Login)
	authRoutes.GET("/me", authService.Me)
	authRoutes.PUT("/phone", authService.Middleware(), authService.BindPhone)
	authRoutes.POST("/logout", authService.Logout)
	authRoutes.POST("/setup-password", authService.SetInitialPassword)
	authRoutes.GET("/sso/start", authService.SSOStart)
	defaults := authService.MaterialDefaults
	frontend := strings.TrimRight(authService.Config.FrontendURL, "/")
	if frontend == "" {
		frontend = "http://localhost:5173"
	}
	// Keep previously shared API-host links usable after correcting QR origins.
	r.GET("/signup", func(c *gin.Context) {
		target, err := url.Parse(frontend)
		if err != nil || target.Host == "" || target.Host == c.Request.Host {
			errhandler.Fail(c, errhandler.ResourceNotFound)
			return
		}
		target.Path = "/signup"
		target.RawQuery = c.Request.URL.RawQuery
		c.Header("Cache-Control", "no-store")
		c.Header("Referrer-Policy", "no-referrer")
		c.Redirect(http.StatusTemporaryRedirect, target.String())
	})
	activityService := &activity.Service{DB: authService.DB, FrontendURL: frontend, MaterialDefaults: activity.Material{
		Team: defaults.Team, ContactName: defaults.ContactName, ContactPhone: defaults.ContactPhone,
		ContactMobile: defaults.ContactMobile, ContactEmail: defaults.ContactEmail, Notes: defaults.Notes, Training: defaults.Training,
	}}
	activityRoutes := api.Group("/activity", authService.Middleware(), activity.RequireManager)
	api.GET("/volunteer/projects", authService.Middleware(), activityService.VolunteerProjects)
	activityRoutes.GET("/dashboard", activityService.Dashboard)
	activityRoutes.GET("/approvals", activityService.ListApprovals)
	activityRoutes.GET("/projects", activityService.ListProjects)
	activityRoutes.POST("/projects", activityService.CreateProject)
	activityRoutes.GET("/projects/:id", activityService.GetProject)
	activityService.RegisterWorkflow(activityRoutes, api.Group("/public", authService.OptionalIdentity()))
	adminService := &admin.Service{DB: authService.DB}
	adminRoutes := api.Group("/admin", authService.Middleware(), admin.RequireSuperAdmin)
	adminRoutes.GET("/users", adminService.ListUsers)
	adminRoutes.POST("/users", adminService.CreateUser)
	adminRoutes.POST("/users/:username/reset-password", adminService.ResetPassword)
	adminRoutes.POST("/users/import", adminService.ImportUsers)
	adminRoutes.PATCH("/users/:username", adminService.UpdateUser)
	r.GET("/auth/sso/callback", authService.SSOCallback)
	api.GET("/ping", func(c *gin.Context) {
		errhandler.OK(c, dto.PingResponse{Message: "pong"})
	})
	r.NoRoute(func(c *gin.Context) {
		errhandler.Fail(c, errhandler.ResourceNotFound)
	})
	r.NoMethod(func(c *gin.Context) {
		errhandler.Fail(c, errhandler.MethodNotAllowed)
	})
	return r
}
