package auth

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"volun-data/internal/config"
	"volun-data/internal/migration"
	"volun-data/internal/migrations"
	"volun-data/internal/model"
)

func testService(t *testing.T, transport http.RoundTripper) *Service {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"))
	if err != nil {
		t.Fatal(err)
	}
	pool, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	pool.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = pool.Close() })
	s := &Service{DB: db, Config: config.Auth{SessionTTL: time.Hour, SSOClientID: "client-test", SSOClientSecret: "secret-test", SSORedirectURI: "http://localhost:8080/auth/sso/callback", SSOScopes: "openid profile email", SSOAuthorizeURL: "https://issuer.test/authorize", SSOTokenURL: "https://issuer.test/token", SSOUserInfoURL: "https://issuer.test/userinfo"}, HTTP: &http.Client{Transport: transport}}
	if err := migration.Run(s.DB, migrations.All()); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestSSOStartUsesExactConfiguredRedirectURI(t *testing.T) {
	s := testService(t, roundTripFunc(func(*http.Request) (*http.Response, error) { return nil, context.Canceled }))
	r := gin.New()
	r.GET("/sso/start", s.SSOStart)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/sso/start?return_to=/", nil))
	if w.Code != http.StatusFound {
		t.Fatalf("status = %d", w.Code)
	}
	u, err := url.Parse(w.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if got := u.Query().Get("redirect_uri"); got != s.Config.SSORedirectURI {
		t.Fatalf("redirect_uri = %q", got)
	}
	if u.Query().Get("state") == "" {
		t.Fatal("missing state")
	}
	if u.Query().Get("nonce") == "" {
		t.Fatal("missing nonce")
	}
	if !strings.Contains(u.RawQuery, "scope=openid%20profile%20email") {
		t.Fatal("scope must match documentation encoding")
	}
}

func TestSSOCallbackExchangesTokenAndCreatesSession(t *testing.T) {
	transport := roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path == "/token" {
			body, err := io.ReadAll(req.Body)
			if err != nil {
				t.Fatal(err)
			}
			form, err := url.ParseQuery(string(body))
			if err != nil {
				t.Fatal(err)
			}
			for key, want := range map[string]string{"code": "one-time", "redirect_uri": "http://localhost:8080/auth/sso/callback", "client_id": "client-test", "client_secret": "secret-test", "grant_type": "authorization_code"} {
				if form.Get(key) != want {
					t.Fatalf("token form %s = %q, want %q", key, form.Get(key), want)
				}
			}
			return response(200, `{"access_token":"access-test"}`), nil
		}
		if req.URL.Path == "/userinfo" && req.Header.Get("Authorization") == "Bearer access-test" {
			return response(200, `{"sub":"sub-1","username":"student1","name":"Student One","student_number":"00123456"}`), nil
		}
		return response(404, `{}`), nil
	})
	s := testService(t, transport)
	s.Config.FrontendURL = "http://localhost:5173"
	var logs bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(previous) })
	state := "state-test"
	if err := s.DB.Create(&model.LoginTransaction{ID: "tx", StateDigest: digest(state), ReturnTo: "/", ExpiresAt: time.Now().Add(time.Minute)}).Error; err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	r.GET("/sso/callback", s.SSOCallback)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/sso/callback?code=one-time&state="+state, nil))
	if w.Code != http.StatusSeeOther || w.Header().Get("Location") != "http://localhost:5173/set-password" {
		t.Fatalf("status/location = %d/%q", w.Code, w.Header().Get("Location"))
	}
	if w.Header().Get("Set-Cookie") == "" {
		t.Fatal("missing session cookie")
	}
	r.GET("/me", s.Me)
	meRequest := httptest.NewRequest("GET", "/me", nil)
	for _, cookie := range w.Result().Cookies() {
		meRequest.AddCookie(cookie)
	}
	me := httptest.NewRecorder()
	r.ServeHTTP(me, meRequest)
	if me.Code != http.StatusOK || !strings.Contains(me.Body.String(), "student1") || !strings.Contains(me.Body.String(), `"password_setup_required":true`) {
		t.Fatalf("session lookup: %d %s", me.Code, me.Body.String())
	}
	if strings.Contains(me.Body.String(), `"sub"`) {
		t.Fatalf("public user response exposed sub: %s", me.Body.String())
	}
	var count int64
	s.DB.Model(&model.User{}).Where("username = ?", "student1").Count(&count)
	if count != 1 {
		t.Fatalf("users = %d", count)
	}
	var user model.User
	if err := s.DB.First(&user, "sub = ?", "sub-1").Error; err != nil {
		t.Fatal(err)
	}
	if user.ID != "00123456" || user.Groups != "formal_user" {
		t.Fatalf("incorrect student identity: %+v", userJSON(user))
	}
	var session model.Session
	if err := s.DB.First(&session).Error; err != nil {
		t.Fatal(err)
	}
	if session.UserID != "sub-1" {
		t.Fatal("session must reference sub")
	}
	var tx model.LoginTransaction
	s.DB.First(&tx, "id = ?", "tx")
	if tx.ConsumedAt == nil {
		t.Fatal("transaction was not consumed")
	}
	for _, stage := range []string{"SSO callback received", "SSO upstream request", "SSO upstream response", "SSO identity received", "SSO login completed"} {
		if !strings.Contains(logs.String(), stage) {
			t.Fatalf("missing log stage %s", stage)
		}
	}
	for _, secret := range []string{"access-test", "secret-test", "one-time", "state-test"} {
		if strings.Contains(logs.String(), secret) {
			t.Fatalf("secret leaked: %s", secret)
		}
	}
}

func TestPasswordLoginAndLogout(t *testing.T) {
	s := testService(t, nil)
	s.Config.DevUsername = "local-test"
	s.Config.DevPassword = "isolated-test-password"
	if err := s.SeedDev(); err != nil {
		t.Fatal(err)
	}
	if err := s.SeedDev(); err != nil {
		t.Fatal(err)
	}
	var adminCount int64
	if err := s.DB.Model(&model.User{}).Where("username = ?", s.Config.DevUsername).Count(&adminCount).Error; err != nil {
		t.Fatal(err)
	}
	if adminCount != 1 {
		t.Fatal("development administrator duplicated")
	}
	r := gin.New()
	r.POST("/login", s.Login)
	r.GET("/me", s.Me)
	r.POST("/logout", s.Logout)
	login := httptest.NewRecorder()
	request := httptest.NewRequest("POST", "/login", strings.NewReader(`{"username":"local-test","password":"isolated-test-password"}`))
	request.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(login, request)
	if login.Code != http.StatusOK {
		t.Fatalf("login: %d %s", login.Code, login.Body.String())
	}
	cookies := login.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("missing session cookie")
	}
	for _, path := range []string{"/me", "/logout"} {
		method := "GET"
		if path == "/logout" {
			method = "POST"
		}
		req := httptest.NewRequest(method, path, nil)
		for _, cookie := range cookies {
			req.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("%s: %d %s", path, w.Code, w.Body.String())
		}
	}
	var count int64
	if err := s.DB.Model(&model.Session{}).Where("revoked_at IS NOT NULL").Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("revoked sessions = %d, want 1", count)
	}
}

func TestSSOUserMustSetPasswordBeforeUsingPasswordLogin(t *testing.T) {
	s := testService(t, nil)
	u := model.User{Sub: "sso-initial", ID: "00123", Name: "SSO User", Username: "student", Status: "active", Groups: "formal_user", PasswordSetupRequired: true}
	if err := s.DB.Create(&u).Error; err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	r.POST("/login", s.Login)
	r.POST("/setup-password", s.SetInitialPassword)
	r.GET("/protected", s.Middleware(), func(c *gin.Context) { c.Status(http.StatusNoContent) })
	request := func(method, path, body string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		if method == http.MethodPost && path == "/setup-password" {
			req.Header.Set("X-Requested-With", "XMLHttpRequest")
		}
		for _, cookie := range cookies {
			req.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}
	login := request("POST", "/login", `{"username":"student","password":"not-set-yet"}`)
	if login.Code != http.StatusUnauthorized {
		t.Fatalf("password login status = %d", login.Code)
	}
	ctxWriter := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(ctxWriter)
	ctx.Request = httptest.NewRequest("GET", "/", nil)
	if err := s.issue(ctx, u); err != nil {
		t.Fatal(err)
	}
	cookies := ctxWriter.Result().Cookies()
	if got := request("GET", "/protected", "", cookies...).Code; got != http.StatusForbidden {
		t.Fatalf("protected status before setup = %d", got)
	}
	if got := request("POST", "/setup-password", `{"password":"short"}`, cookies...).Code; got != http.StatusBadRequest {
		t.Fatalf("short password status = %d", got)
	}
	csrfRequest := httptest.NewRequest(http.MethodPost, "/setup-password", strings.NewReader(`{"password":"a-valid-long-password"}`))
	csrfRequest.Header.Set("Content-Type", "application/json")
	for _, cookie := range cookies {
		csrfRequest.AddCookie(cookie)
	}
	csrfResponse := httptest.NewRecorder()
	r.ServeHTTP(csrfResponse, csrfRequest)
	if csrfResponse.Code != http.StatusForbidden {
		t.Fatalf("setup without same-origin marker = %d", csrfResponse.Code)
	}
	setup := request("POST", "/setup-password", `{"password":"a-secure-password-123"}`, cookies...)
	if setup.Code != http.StatusOK || strings.Contains(setup.Body.String(), `"password_setup_required":true`) {
		t.Fatalf("setup password: %d %s", setup.Code, setup.Body.String())
	}
	if got := request("GET", "/protected", "", cookies...).Code; got != http.StatusNoContent {
		t.Fatalf("protected status after setup = %d", got)
	}
	login = request("POST", "/login", `{"username":"student","password":"a-secure-password-123"}`)
	if login.Code != http.StatusOK {
		t.Fatalf("password login after setup: %d %s", login.Code, login.Body.String())
	}
	if got := request("POST", "/setup-password", `{"password":"another-secure-password"}`, cookies...).Code; got != http.StatusConflict {
		t.Fatalf("second setup status = %d", got)
	}
	var saved model.User
	if err := s.DB.First(&saved, "sub = ?", u.Sub).Error; err != nil {
		t.Fatal(err)
	}
	if saved.PasswordSetupRequired || bcrypt.CompareHashAndPassword([]byte(saved.PasswordHash), []byte("a-secure-password-123")) != nil {
		t.Fatal("initial password was not saved correctly")
	}
	if !strings.Contains(setup.Body.String(), "student") || strings.Contains(setup.Body.String(), `"sub"`) {
		t.Fatalf("unexpected public response: %s", setup.Body.String())
	}
}

func TestMigrateLegacyUserPrimaryKey(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"))
	if err != nil {
		t.Fatal(err)
	}
	pool, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	pool.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = pool.Close() })
	if err := db.Exec("CREATE TABLE users (id text PRIMARY KEY, username text, password_hash text, status text)").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE UNIQUE INDEX idx_users_username ON users(username)").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO users (id, username, password_hash, status) VALUES ('legacy-key', 'admin', 'hash', 'active')").Error; err != nil {
		t.Fatal(err)
	}
	s := &Service{DB: db}
	for range 2 {
		if err := migration.Run(s.DB, migrations.All()); err != nil {
			t.Fatal(err)
		}
	}
	var versions int64
	if err := db.Model(&migration.Record{}).Count(&versions).Error; err != nil {
		t.Fatal(err)
	}
	if versions != 4 {
		t.Fatalf("migration versions = %d, want 4", versions)
	}
	var user model.User
	if err := db.First(&user, "sub = ?", "legacy-key").Error; err != nil {
		t.Fatal(err)
	}
	if user.Username != "admin" {
		t.Fatal("legacy user lost")
	}
	columns, err := db.Migrator().ColumnTypes(&model.User{})
	if err != nil {
		t.Fatal(err)
	}
	for _, column := range columns {
		primary, _ := column.PrimaryKey()
		if column.Name() == "sub" && !primary {
			t.Fatal("sub must be primary key")
		}
		if column.Name() == "id" && primary {
			t.Fatal("student id must not be primary key")
		}
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func response(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Body: nopCloser{Reader: strings.NewReader(body)}, Header: make(http.Header)}
}

type nopCloser struct{ *strings.Reader }

func (nopCloser) Close() error { return nil }
