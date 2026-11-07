package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"volun-data/internal/config"
	"volun-data/internal/dto"
	"volun-data/internal/errhandler"
	"volun-data/internal/model"
	"volun-data/internal/sso"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

const cookieName = "volun_session"

type Service struct {
	DB     *gorm.DB
	Config config.Auth
	HTTP   *http.Client
}

func frontendURL(base, path string) string {
	if !strings.HasPrefix(path, "/") || strings.HasPrefix(path, "//") || strings.ContainsAny(path, "\\\r\n") {
		path = "/"
	}
	return strings.TrimRight(base, "/") + path
}

func (s *Service) SeedDev() error {
	if s.Config.DevPassword == "" {
		return nil
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(s.Config.DevPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	var user model.User
	err = s.DB.Where("username = ? AND password_hash <> ?", s.Config.DevUsername, "").First(&user).Error
	if err == nil {
		return s.DB.Model(&model.User{}).Where("sub = ?", user.Sub).Updates(map[string]any{"password_hash": string(hash), "status": "active"}).Error
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	return s.DB.Create(&model.User{Sub: "local:" + mustToken(16), ID: s.Config.DevUsername, Name: "开发管理员", Username: s.Config.DevUsername, PasswordHash: string(hash), Status: "active", Groups: "super_admin"}).Error
}
func randomToken(n int) (string, error) {
	b := make([]byte, n)
	_, err := rand.Read(b)
	return hex.EncodeToString(b), err
}
func digest(v string) string { b := sha256.Sum256([]byte(v)); return hex.EncodeToString(b[:]) }
func userJSON(u model.User) dto.UserResponse {
	groups := []string{}
	if u.Groups != "" {
		groups = strings.Split(u.Groups, ",")
	}
	return dto.UserResponse{Sub: u.Sub, ID: u.ID, Name: u.Name, Username: u.Username, Groups: groups}
}

func (s *Service) issue(c *gin.Context, u model.User) error {
	token, err := randomToken(32)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	if err = s.DB.Create(&model.Session{ID: token[:32], TokenDigest: digest(token), UserID: u.Sub, ExpiresAt: now.Add(s.Config.SessionTTL), CreatedAt: now}).Error; err != nil {
		return err
	}
	http.SetCookie(c.Writer, &http.Cookie{Name: cookieName, Value: token, Path: "/", HttpOnly: true, Secure: s.Config.CookieSecure, SameSite: http.SameSiteLaxMode, MaxAge: int(s.Config.SessionTTL.Seconds())})
	return nil
}
func (s *Service) current(c *gin.Context) (model.User, error) {
	ck, err := c.Request.Cookie(cookieName)
	if err != nil {
		return model.User{}, gorm.ErrRecordNotFound
	}
	var sess model.Session
	if err = s.DB.Where("token_digest = ? AND revoked_at IS NULL AND expires_at > ?", digest(ck.Value), time.Now().UTC()).First(&sess).Error; err != nil {
		return model.User{}, err
	}
	var u model.User
	err = s.DB.Where("sub = ? AND status = ?", sess.UserID, "active").First(&u).Error
	return u, err
}

func (s *Service) Login(c *gin.Context) {
	var req dto.LoginRequest
	if c.ShouldBindJSON(&req) != nil || req.Username == "" || req.Password == "" {
		errhandler.Fail(c, errhandler.InvalidArgument)
		return
	}
	var u model.User
	if s.DB.Where("username = ? AND status = ? AND password_hash <> ?", strings.TrimSpace(req.Username), "active", "").First(&u).Error != nil || bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(req.Password)) != nil {
		errhandler.Fail(c, errhandler.InvalidCredentials)
		return
	}
	if err := s.issue(c, u); err != nil {
		errhandler.Fail(c, errhandler.InternalError)
		return
	}
	errhandler.OK(c, dto.AuthResponse{User: userJSON(u), AuthMethod: "password"})
}
func (s *Service) Me(c *gin.Context) {
	u, err := s.current(c)
	if err != nil {
		errhandler.Fail(c, errhandler.Unauthenticated)
		return
	}
	errhandler.OK(c, dto.AuthResponse{User: userJSON(u), AuthMethod: "session"})
}
func (s *Service) Logout(c *gin.Context) {
	if ck, err := c.Request.Cookie(cookieName); err == nil {
		now := time.Now().UTC()
		s.DB.Model(&model.Session{}).Where("token_digest = ?", digest(ck.Value)).Update("revoked_at", now)
	}
	http.SetCookie(c.Writer, &http.Cookie{Name: cookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: s.Config.CookieSecure, SameSite: http.SameSiteLaxMode})
	errhandler.OK(c, nil)
}

func (s *Service) SSOStart(c *gin.Context) {
	if s.Config.SSOClientID == "" || s.Config.SSOClientSecret == "" {
		slog.Warn("SSO unavailable: missing server configuration", "request_id", c.GetString("request_id"), "client_id_configured", s.Config.SSOClientID != "", "client_secret_configured", s.Config.SSOClientSecret != "")
		c.Redirect(303, frontendURL(s.Config.FrontendURL, "/login?sso=unavailable"))
		return
	}
	state, err := randomToken(24)
	if err != nil {
		slog.Error("SSO start failed: cannot create login state", "request_id", c.GetString("request_id"))
		c.Redirect(303, frontendURL(s.Config.FrontendURL, "/login?sso=error"))
		return
	}
	ret := c.Query("return_to")
	if !strings.HasPrefix(ret, "/") || strings.HasPrefix(ret, "//") {
		ret = "/"
	}
	if err = s.DB.Create(&model.LoginTransaction{ID: state[:32], StateDigest: digest(state), ReturnTo: ret, ExpiresAt: time.Now().UTC().Add(5 * time.Minute)}).Error; err != nil {
		slog.Error("SSO start failed: cannot save login transaction", "request_id", c.GetString("request_id"))
		c.Redirect(303, frontendURL(s.Config.FrontendURL, "/login?sso=error"))
		return
	}

	nonce, err := randomToken(24)
	if err != nil {
		c.Redirect(303, frontendURL(s.Config.FrontendURL, "/login?sso=error"))
		return
	}

	q := url.Values{
		"response_type": {"code"},
		"client_id":     {s.Config.SSOClientID},
		"redirect_uri":  {s.Config.SSORedirectURI},
		"scope":         {s.Config.SSOScopes},
		"state":         {state},
		"nonce":         {nonce},
	}

	// Authentication uses userinfo, not id_token. If ID Token authentication is
	// added, its nonce must also be persisted and verified with the signed claims.
	slog.Debug("SSO authorization redirect", "request_id", c.GetString("request_id"), "endpoint", sso.SafeEndpoint(s.Config.SSOAuthorizeURL), "client_id", s.Config.SSOClientID, "redirect_uri", s.Config.SSORedirectURI, "scope", s.Config.SSOScopes)
	c.Redirect(302, s.Config.SSOAuthorizeURL+"?"+strings.ReplaceAll(q.Encode(), "+", "%20"))
}
func (s *Service) SSOCallback(c *gin.Context) {
	slog.Debug("SSO callback received", "request_id", c.GetString("request_id"), "code_present", c.Query("code") != "", "state_present", c.Query("state") != "")
	fail := func() {
		slog.Warn("SSO callback failed", "request_id", c.GetString("request_id"))
		c.Redirect(303, frontendURL(s.Config.FrontendURL, "/login?sso=failed"))
	}
	state, code := c.Query("state"), c.Query("code")
	if state == "" || code == "" {
		fail()
		return
	}
	var tx model.LoginTransaction
	if s.DB.Where("state_digest = ? AND consumed_at IS NULL AND expires_at > ?", digest(state), time.Now().UTC()).First(&tx).Error != nil {
		fail()
		return
	}
	now := time.Now().UTC()
	if s.DB.Model(&tx).Where("consumed_at IS NULL").Update("consumed_at", now).RowsAffected != 1 {
		fail()
		return
	}
	slog.Debug("SSO state validated and consumed", "request_id", c.GetString("request_id"))
	form := url.Values{"grant_type": {"authorization_code"}, "code": {code}, "redirect_uri": {s.Config.SSORedirectURI}, "client_id": {s.Config.SSOClientID}, "client_secret": {s.Config.SSOClientSecret}}
	req, err := http.NewRequestWithContext(c.Request.Context(), "POST", s.Config.SSOTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		fail()
		return
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	var tok dto.SSOTokenResponse
	if !sso.Upstream(c, s.HTTP, "token", req, &tok) || tok.AccessToken == "" {
		fail()
		return
	}
	req, err = http.NewRequestWithContext(c.Request.Context(), "GET", s.Config.SSOUserInfoURL, nil)
	if err != nil {
		fail()
		return
	}
	req.Header.Set("Authorization", "Bearer "+tok.AccessToken)
	var info dto.SSOUserInfoResponse
	if !sso.Upstream(c, s.HTTP, "userinfo", req, &info) || info.Sub == "" {
		fail()
		return
	}
	slog.Debug("SSO identity received", "request_id", c.GetString("request_id"), "sub", info.Sub, "student_number_present", info.StudentNumber != "")
	username := info.Username
	if username == "" {
		username = "sso_" + info.Sub
	}
	var u model.User
	err = s.DB.Where("sub = ?", info.Sub).First(&u).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		u = model.User{Sub: info.Sub, ID: info.StudentNumber, Name: info.Name, Username: username, Status: "active", Groups: "formal_user"}
		if s.DB.Create(&u).Error != nil {
			fail()
			return
		}
	} else if err != nil {
		fail()
		return
	}
	slog.Debug("SSO local identity resolved", "request_id", c.GetString("request_id"), "sub", u.Sub)
	if u.Status != "active" {
		fail()
		return
	}
	if s.issue(c, u) != nil {
		fail()
		return
	}
	slog.Debug("SSO login completed", "request_id", c.GetString("request_id"), "destination", frontendURL(s.Config.FrontendURL, tx.ReturnTo))
	c.Redirect(303, frontendURL(s.Config.FrontendURL, tx.ReturnTo))
}
func mustToken(n int) string { v, _ := randomToken(n); return v }

func (s *Service) Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		u, err := s.current(c)
		if err != nil {
			errhandler.Fail(c, errhandler.Unauthenticated)
			c.Abort()
			return
		}
		c.Set("user", u)
		c.Next()
	}
}
func CSRF(c *gin.Context) {
	if c.Request.Method == "POST" && c.GetHeader("X-CSRF-Token") == "" {
		errhandler.Fail(c, errhandler.CSRFValidationFailed)
		c.Abort()
		return
	}
	c.Next()
}
