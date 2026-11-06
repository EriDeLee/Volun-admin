package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"volun-data/internal/config"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

const cookieName = "volun_session"

type User struct {
	Sub          string `gorm:"primaryKey;size:128"`
	ID           string `gorm:"size:120;index"`
	Name         string
	Username     string `gorm:"index;size:120"`
	PasswordHash string
	Status       string `gorm:"size:20;index"`
	Groups       string
	CreatedAt    time.Time
	UpdatedAt    time.Time
}
type Session struct {
	ID          string    `gorm:"primaryKey;size:64"`
	TokenDigest string    `gorm:"uniqueIndex;size:64"`
	UserID      string    `gorm:"index;size:128"` // References User.Sub, never the student number.
	ExpiresAt   time.Time `gorm:"index"`
	RevokedAt   *time.Time
	CreatedAt   time.Time
}
type LoginTransaction struct {
	ID          string `gorm:"primaryKey;size:64"`
	StateDigest string `gorm:"uniqueIndex;size:64"`
	ReturnTo    string
	ExpiresAt   time.Time
	ConsumedAt  *time.Time
}
type Service struct {
	DB     *gorm.DB
	Config config.Auth
	HTTP   *http.Client
}

type apiResponse struct {
	ErrCode   int    `json:"errcode"`
	Message   string `json:"message"`
	Data      any    `json:"data"`
	RequestID string `json:"request_id"`
}

func respond(c *gin.Context, status, code int, message string, data any) {
	c.JSON(status, apiResponse{ErrCode: code, Message: message, Data: data, RequestID: c.GetString("request_id")})
}

func (s *Service) Migrate() error {
	// Preserve old primary keys and existing session references when upgrading.
	if s.DB.Migrator().HasTable(&User{}) && !s.DB.Migrator().HasColumn(&User{}, "sub") {
		if err := s.DB.Migrator().RenameColumn(&User{}, "id", "sub"); err != nil {
			return err
		}
	}
	if s.DB.Migrator().HasIndex(&User{}, "idx_users_username") {
		if err := s.DB.Migrator().DropIndex(&User{}, "idx_users_username"); err != nil {
			return err
		}
	}
	return s.DB.AutoMigrate(&User{}, &Session{}, &LoginTransaction{})
}
func (s *Service) SeedDev() error {
	if s.Config.DevPassword == "" {
		return nil
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(s.Config.DevPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	var user User
	err = s.DB.Where("username = ? AND password_hash <> ?", s.Config.DevUsername, "").First(&user).Error
	if err == nil {
		return s.DB.Model(&User{}).Where("sub = ?", user.Sub).Updates(map[string]any{"password_hash": string(hash), "status": "active"}).Error
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	return s.DB.Create(&User{Sub: "local:" + mustToken(16), ID: s.Config.DevUsername, Name: "开发管理员", Username: s.Config.DevUsername, PasswordHash: string(hash), Status: "active", Groups: "super_admin"}).Error
}
func randomToken(n int) (string, error) {
	b := make([]byte, n)
	_, err := rand.Read(b)
	return hex.EncodeToString(b), err
}
func digest(v string) string { b := sha256.Sum256([]byte(v)); return hex.EncodeToString(b[:]) }
func userJSON(u User) gin.H {
	groups := []string{}
	if u.Groups != "" {
		groups = strings.Split(u.Groups, ",")
	}
	return gin.H{"sub": u.Sub, "id": u.ID, "name": u.Name, "username": u.Username, "groups": groups}
}

func (s *Service) issue(c *gin.Context, u User) error {
	token, err := randomToken(32)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	if err = s.DB.Create(&Session{ID: token[:32], TokenDigest: digest(token), UserID: u.Sub, ExpiresAt: now.Add(s.Config.SessionTTL), CreatedAt: now}).Error; err != nil {
		return err
	}
	http.SetCookie(c.Writer, &http.Cookie{Name: cookieName, Value: token, Path: "/", HttpOnly: true, Secure: s.Config.CookieSecure, SameSite: http.SameSiteLaxMode, MaxAge: int(s.Config.SessionTTL.Seconds())})
	return nil
}
func (s *Service) current(c *gin.Context) (User, error) {
	ck, err := c.Request.Cookie(cookieName)
	if err != nil {
		return User{}, gorm.ErrRecordNotFound
	}
	var sess Session
	if err = s.DB.Where("token_digest = ? AND revoked_at IS NULL AND expires_at > ?", digest(ck.Value), time.Now().UTC()).First(&sess).Error; err != nil {
		return User{}, err
	}
	var u User
	err = s.DB.Where("sub = ? AND status = ?", sess.UserID, "active").First(&u).Error
	return u, err
}

func (s *Service) Login(c *gin.Context) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if c.ShouldBindJSON(&req) != nil || req.Username == "" || req.Password == "" {
		respond(c, 400, 100001, "参数不合法", nil)
		return
	}
	var u User
	if s.DB.Where("username = ? AND status = ? AND password_hash <> ?", strings.TrimSpace(req.Username), "active", "").First(&u).Error != nil || bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(req.Password)) != nil {
		respond(c, 401, 200003, "账号或密码错误", nil)
		return
	}
	if err := s.issue(c, u); err != nil {
		respond(c, 500, 900001, "服务暂时不可用", nil)
		return
	}
	respond(c, 200, 0, "ok", gin.H{"user": userJSON(u), "auth_method": "password"})
}
func (s *Service) Me(c *gin.Context) {
	u, err := s.current(c)
	if err != nil {
		respond(c, 401, 200001, "请先登录", nil)
		return
	}
	respond(c, 200, 0, "ok", gin.H{"user": userJSON(u), "auth_method": "session"})
}
func (s *Service) Logout(c *gin.Context) {
	if ck, err := c.Request.Cookie(cookieName); err == nil {
		now := time.Now().UTC()
		s.DB.Model(&Session{}).Where("token_digest = ?", digest(ck.Value)).Update("revoked_at", now)
	}
	http.SetCookie(c.Writer, &http.Cookie{Name: cookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: s.Config.CookieSecure, SameSite: http.SameSiteLaxMode})
	respond(c, 200, 0, "ok", nil)
}

func (s *Service) SSOStart(c *gin.Context) {
	if s.Config.SSOClientID == "" || s.Config.SSOClientSecret == "" {
		slog.Warn("SSO unavailable: missing server configuration", "request_id", c.GetString("request_id"), "client_id_configured", s.Config.SSOClientID != "", "client_secret_configured", s.Config.SSOClientSecret != "")
		c.Redirect(303, "/login?sso=unavailable")
		return
	}
	state, err := randomToken(24)
	if err != nil {
		slog.Error("SSO start failed: cannot create login state", "request_id", c.GetString("request_id"))
		c.Redirect(303, "/login?sso=error")
		return
	}
	ret := c.Query("return_to")
	if !strings.HasPrefix(ret, "/") || strings.HasPrefix(ret, "//") {
		ret = "/"
	}
	if err = s.DB.Create(&LoginTransaction{ID: state[:32], StateDigest: digest(state), ReturnTo: ret, ExpiresAt: time.Now().UTC().Add(5 * time.Minute)}).Error; err != nil {
		slog.Error("SSO start failed: cannot save login transaction", "request_id", c.GetString("request_id"))
		c.Redirect(303, "/login?sso=error")
		return
	}

	nonce, err := randomToken(24)
	if err != nil {
		c.Redirect(303, "/login?sso=error")
		return
	}

	q := url.Values{
		"response_type": {"code"},
		"client_id":     {s.Config.SSOClientID},
		"redirect_uri":  {s.Config.SSORedirectURI},
		"scope":         {s.Config.SSOScopes},
		"state":         {state},
		"nonce":         {nonce}, // Placeholder; will be set below.
	}

	// Authentication uses userinfo, not id_token. If ID Token authentication is
	// added, its nonce must also be persisted and verified with the signed claims.
	c.Redirect(302, s.Config.SSOAuthorizeURL+"?"+strings.ReplaceAll(q.Encode(), "+", "%20"))
}
func (s *Service) SSOCallback(c *gin.Context) {
	fail := func() { c.Redirect(303, "/login?sso=failed") }
	state, code := c.Query("state"), c.Query("code")
	if state == "" || code == "" {
		fail()
		return
	}
	var tx LoginTransaction
	if s.DB.Where("state_digest = ? AND consumed_at IS NULL AND expires_at > ?", digest(state), time.Now().UTC()).First(&tx).Error != nil {
		fail()
		return
	}
	now := time.Now().UTC()
	if s.DB.Model(&tx).Where("consumed_at IS NULL").Update("consumed_at", now).RowsAffected != 1 {
		fail()
		return
	}
	form := url.Values{"grant_type": {"authorization_code"}, "code": {code}, "redirect_uri": {s.Config.SSORedirectURI}, "client_id": {s.Config.SSOClientID}, "client_secret": {s.Config.SSOClientSecret}}
	req, _ := http.NewRequestWithContext(c.Request.Context(), "POST", s.Config.SSOTokenURL, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := s.HTTP.Do(req)
	if err != nil || resp.StatusCode/100 != 2 {
		fail()
		return
	}
	defer resp.Body.Close()
	var tok struct {
		AccessToken string `json:"access_token"`
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&tok) != nil || tok.AccessToken == "" {
		fail()
		return
	}
	req, _ = http.NewRequestWithContext(c.Request.Context(), "GET", s.Config.SSOUserInfoURL, nil)
	req.Header.Set("Authorization", "Bearer "+tok.AccessToken)
	resp, err = s.HTTP.Do(req)
	if err != nil || resp.StatusCode/100 != 2 {
		fail()
		return
	}
	defer resp.Body.Close()
	var info struct {
		Sub           string `json:"sub"`
		Username      string `json:"username"`
		Name          string `json:"name"`
		StudentNumber string `json:"student_number"`
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&info) != nil || info.Sub == "" {
		fail()
		return
	}
	username := info.Username
	if username == "" {
		username = "sso_" + info.Sub
	}
	var u User
	err = s.DB.Where("sub = ?", info.Sub).First(&u).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		u = User{Sub: info.Sub, ID: info.StudentNumber, Name: info.Name, Username: username, Status: "active", Groups: "formal_user"}
		if s.DB.Create(&u).Error != nil {
			fail()
			return
		}
	} else if err != nil {
		fail()
		return
	}
	if u.Status != "active" {
		fail()
		return
	}
	if s.issue(c, u) != nil {
		fail()
		return
	}
	c.Redirect(303, tx.ReturnTo)
}
func mustToken(n int) string { v, _ := randomToken(n); return v }

func (s *Service) Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		u, err := s.current(c)
		if err != nil {
			respond(c, 401, 200001, "请先登录", nil)
			c.Abort()
			return
		}
		c.Set("user", u)
		c.Next()
	}
}
func CSRF(c *gin.Context) {
	if c.Request.Method == "POST" && c.GetHeader("X-CSRF-Token") == "" {
		respond(c, 403, 200008, "请求校验失败", nil)
		c.Abort()
		return
	}
	c.Next()
}
