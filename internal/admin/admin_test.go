//go:build integration

package admin_test

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"volun-data/internal/auth"
	"volun-data/internal/config"
	"volun-data/internal/dto"
	"volun-data/internal/httpapi"
	"volun-data/internal/migration"
	"volun-data/internal/migrations"
	"volun-data/internal/model"
)

type fixture struct {
	db     *gorm.DB
	router http.Handler
}

func setup(t *testing.T) fixture {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	pool, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	pool.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = pool.Close() })
	if err := migration.Run(db, migrations.All()); err != nil {
		t.Fatal(err)
	}
	return fixture{db, httpapi.NewRouter(pool, slog.New(slog.NewTextHandler(io.Discard, nil)), &auth.Service{DB: db, Config: config.Auth{SessionTTL: time.Hour}})}
}

func (f fixture) identity(t *testing.T, sub, username, groups string, needsPassword bool) string {
	t.Helper()
	u := model.User{
		Sub: sub, Username: username, Name: username + "姓名", ID: "ID-" + username,
		Status: "active", Groups: groups, PasswordSetupRequired: needsPassword,
		CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}
	if err := f.db.Create(&u).Error; err != nil {
		t.Fatal(err)
	}
	token := "cookie-" + username
	hash := sha256.Sum256([]byte(token))
	if err := f.db.Create(&model.Session{
		ID: username, UserID: u.Sub, TokenDigest: hex.EncodeToString(hash[:]),
		ExpiresAt: time.Now().Add(time.Hour),
	}).Error; err != nil {
		t.Fatal(err)
	}
	return token
}

func (f fixture) request(method, path, body, token string, header bool) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if token != "" {
		req.AddCookie(&http.Cookie{Name: "volun_session", Value: token})
	}
	if header {
		req.Header.Set("X-Requested-With", "XMLHttpRequest")
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	f.router.ServeHTTP(w, req)
	return w
}

func decode[T any](t *testing.T, w *httptest.ResponseRecorder) T {
	t.Helper()
	if w.Code != 200 {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	var envelope struct {
		Data      T      `json:"data"`
		Code      int    `json:"errcode"`
		RequestID string `json:"request_id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Code != 0 || envelope.RequestID == "" {
		t.Fatalf("bad envelope: %s", w.Body.String())
	}
	raw := w.Body.String()
	if strings.Contains(raw, "private-") || strings.Contains(raw, `"sub"`) {
		t.Fatal("internal identity leaked")
	}
	return envelope.Data
}

func TestAdminAuthorization(t *testing.T) {
	for _, tc := range []struct {
		name, group  string
		setup        bool
		code, status int
	}{
		{"anonymous", "", false, 200001, 401},
		{"formal user", "formal_user", false, 200002, 403},
		{"activity administrator", "activity_admin", false, 200002, 403},
		{"data administrator", "data_admin", false, 200002, 403},
		{"password setup gate", "super_admin", true, 200009, 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := setup(t)
			token := ""
			if tc.group != "" {
				token = f.identity(t, "private-"+tc.group, tc.group, tc.group, tc.setup)
			}
			for _, route := range []struct{ method, path, body string }{
				{"GET", "/api/v1/admin/users", ""},
				{"PATCH", "/api/v1/admin/users/someone", `{"status":"disabled"}`},
				{"POST", "/api/v1/admin/users/import", `{"csv":""}`},
				{"POST", "/api/v1/admin/users", `{"username":"new"}`},
				{"POST", "/api/v1/admin/users/someone/reset-password", `{"password":"temporary-secret-123"}`},
			} {
				if tc.group == "data_admin" && route.method == "GET" {
					result := decode[struct{ Total int }](t, f.request("GET", route.path+"?q=data_admin", "", token, true))
					if result.Total != 1 {
						t.Fatalf("directory search: %+v", result)
					}
					continue
				}
				w := f.request(route.method, route.path, route.body, token, true)
				var response dto.Response
				if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
					t.Fatal(err)
				}
				if w.Code != tc.status || response.ErrCode != tc.code {
					t.Fatalf("authorization mismatch: %d %s", w.Code, w.Body.String())
				}
			}
		})
	}
}

func TestImportUsersAtomicValidationAndInitialLogin(t *testing.T) {
	f := setup(t)
	super := f.identity(t, "private-super", "super", "super_admin", false)
	csv := "\ufeff账号,姓名,学号,初始密码,用户组\r\nnewuser,新成员,00123,unique-secret-123,formal_user\r\n"
	call := func(content string, commit bool) *httptest.ResponseRecorder {
		t.Helper()
		body, err := json.Marshal(map[string]any{"csv": content, "commit": commit})
		if err != nil {
			t.Fatal(err)
		}
		return f.request("POST", "/api/v1/admin/users/import", string(body), super, true)
	}
	type result struct {
		Valid    bool
		Imported int
		Rows     []struct{ Error string }
	}
	preview := decode[result](t, call(csv, false))
	if !preview.Valid || preview.Imported != 0 {
		t.Fatalf("preview: %+v", preview)
	}
	var count int64
	f.db.Model(&model.User{}).Where("username = ?", "newuser").Count(&count)
	if count != 0 {
		t.Fatal("preview wrote a user")
	}
	bad := csv + "other,其他,00002,short,formal_user\n"
	invalid := decode[result](t, call(bad, true))
	if invalid.Valid || invalid.Imported != 0 || invalid.Rows[1].Error == "" {
		t.Fatalf("invalid batch: %+v", invalid)
	}
	f.db.Model(&model.User{}).Where("username IN ?", []string{"newuser", "other"}).Count(&count)
	if count != 0 {
		t.Fatal("invalid batch partially committed")
	}
	w := call(csv, true)
	created := decode[result](t, w)
	if created.Imported != 1 || strings.Contains(w.Body.String(), "unique-secret") {
		t.Fatal("import failed or leaked password")
	}
	var stored model.User
	if err := f.db.Where("username = ?", "newuser").First(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if stored.ID != "00123" || !stored.PasswordSetupRequired || bcrypt.CompareHashAndPassword([]byte(stored.PasswordHash), []byte("unique-secret-123")) != nil {
		t.Fatal("credentials or leading zeros lost")
	}
	duplicate := decode[result](t, call(csv, true))
	if duplicate.Valid || duplicate.Imported != 0 {
		t.Fatal("duplicate imported")
	}
	login := f.request("POST", "/api/v1/auth/login", `{"username":"newuser","password":"unique-secret-123"}`, "", true)
	if login.Code != 200 || !strings.Contains(login.Body.String(), `"password_setup_required":true`) {
		t.Fatalf("initial login: %s", login.Body.String())
	}
	cookies := login.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("no initial session")
	}
	if protected := f.request("GET", "/api/v1/activity/projects", "", cookies[0].Value, false); protected.Code != 403 {
		t.Fatal("password gate bypassed")
	}
	setupPassword := f.request("POST", "/api/v1/auth/setup-password", `{"password":"replacement-secret-456"}`, cookies[0].Value, true)
	if setupPassword.Code != 200 {
		t.Fatalf("password setup: %s", setupPassword.Body.String())
	}
}

func TestCreateMemberAndResetPassword(t *testing.T) {
	f := setup(t)
	super := f.identity(t, "private-super", "super", "super_admin", false)
	oldSession := f.identity(t, "school-identity", "alice", "formal_user", false)
	created := f.request("POST", "/api/v1/admin/users", `{"username":"new-member","name":"新成员","id":"00071","password":"first-secret-123","groups":["activity_admin"]}`, super, true)
	var result struct {
		Imported int
		Valid    bool
	}
	result = decode[struct {
		Imported int
		Valid    bool
	}](t, created)
	if result.Imported != 1 || !result.Valid {
		t.Fatalf("manual create: %s", created.Body.String())
	}
	var user model.User
	if err := f.db.Where("username = ?", "new-member").First(&user).Error; err != nil {
		t.Fatal(err)
	}
	if user.ID != "00071" || user.Groups != "activity_admin" || !user.PasswordSetupRequired {
		t.Fatalf("manual create fields: %+v", user)
	}
	reset := f.request("POST", "/api/v1/admin/users/alice/reset-password", `{"password":"temporary-secret-123"}`, super, true)
	updated := decode[dto.AdminUserResponse](t, reset)
	if !updated.PasswordSetupRequired || !updated.HasPassword || updated.Status != "active" || updated.Groups[0] != "formal_user" {
		t.Fatalf("reset fields: %+v", updated)
	}
	if strings.Contains(reset.Body.String(), "temporary-secret") {
		t.Fatal("reset response contains password")
	}
	if previous := f.request("GET", "/api/v1/auth/me", "", oldSession, false); previous.Code != 401 {
		t.Fatalf("previous session still valid: %s", previous.Body.String())
	}
	login := f.request("POST", "/api/v1/auth/login", `{"username":"alice","password":"temporary-secret-123"}`, "", true)
	if login.Code != 200 || !strings.Contains(login.Body.String(), `"password_setup_required":true`) {
		t.Fatalf("reset credential login: %s", login.Body.String())
	}
	cookies := login.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("missing temporary session")
	}
	newToken := cookies[0].Value
	if w := f.request("GET", "/api/v1/admin/users", "", newToken, false); w.Code != 403 {
		t.Fatal("initial password gate missing")
	}
	if w := f.request("POST", "/api/v1/auth/setup-password", `{"password":"replacement-secret-456"}`, newToken, true); w.Code != 200 {
		t.Fatalf("reset password setup: %s", w.Body.String())
	}
	if w := f.request("POST", "/api/v1/auth/login", `{"username":"alice","password":"temporary-secret-123"}`, "", true); w.Code != 401 {
		t.Fatal("temporary password was not replaced")
	}
	if w := f.request("POST", "/api/v1/auth/login", `{"username":"alice","password":"replacement-secret-456"}`, "", true); w.Code != 200 {
		t.Fatal("new password login failed")
	}
}

func TestListAndUpdateUsers(t *testing.T) {
	f := setup(t)
	super := f.identity(t, "private-super", "super", "super_admin", false)
	_ = f.identity(t, "private-a", "alice", "formal_user", false)
	_ = f.identity(t, "private-b", "bob", "activity_admin,formal_user", false)
	disabled := model.User{
		Sub: "private-c", Username: "carol", Name: "Carol", ID: "C1",
		Status: "disabled", Groups: "formal_user",
		CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}
	if err := f.db.Create(&disabled).Error; err != nil {
		t.Fatal(err)
	}

	emptyish := decode[dto.AdminUserListResponse](t, f.request("GET", "/api/v1/admin/users?page=1&page_size=20", "", super, false))
	if emptyish.Summary.UserCount != 4 || emptyish.Summary.ActiveCount != 3 || emptyish.Summary.DisabledCount != 1 || emptyish.Summary.ManagerCount != 2 {
		t.Fatalf("bad summary: %+v", emptyish.Summary)
	}
	if emptyish.Total != 4 || len(emptyish.Items) != 4 {
		t.Fatalf("bad list: %+v", emptyish)
	}

	filtered := decode[dto.AdminUserListResponse](t, f.request("GET", "/api/v1/admin/users?group=activity_admin", "", super, false))
	if filtered.Total != 1 || filtered.Items[0].Username != "bob" {
		t.Fatalf("group filter: %+v", filtered)
	}
	search := decode[dto.AdminUserListResponse](t, f.request("GET", "/api/v1/admin/users?q=ali", "", super, false))
	if search.Total != 1 || search.Items[0].Username != "alice" {
		t.Fatalf("search: %+v", search)
	}
	if w := f.request("GET", "/api/v1/admin/users?status=bogus", "", super, false); w.Code != 400 {
		t.Fatalf("invalid status accepted: %d", w.Code)
	}

	if w := f.request("PATCH", "/api/v1/admin/users/alice", `{"groups":["activity_admin","formal_user"],"status":"active"}`, super, false); w.Code != 403 {
		t.Fatalf("missing header accepted: %d", w.Code)
	}
	updated := decode[dto.AdminUserResponse](t, f.request("PATCH", "/api/v1/admin/users/alice", `{"groups":["activity_admin","formal_user"],"status":"active"}`, super, true))
	if updated.Username != "alice" || len(updated.Groups) != 2 || updated.Groups[0] != "activity_admin" {
		t.Fatalf("bad update: %+v", updated)
	}
	var stored model.User
	if err := f.db.Where("username = ?", "alice").First(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Groups != "activity_admin,formal_user" || stored.Sub != "private-a" {
		t.Fatalf("storage changed identity: %+v", stored)
	}

	// Disable bob and revoke session.
	bobToken := "cookie-bob"
	disabledUser := decode[dto.AdminUserResponse](t, f.request("PATCH", "/api/v1/admin/users/bob", `{"status":"disabled"}`, super, true))
	if disabledUser.Status != "disabled" {
		t.Fatalf("not disabled: %+v", disabledUser)
	}
	var sess model.Session
	if err := f.db.Where("user_id = ?", "private-b").First(&sess).Error; err != nil {
		t.Fatal(err)
	}
	if sess.RevokedAt == nil {
		t.Fatal("session not revoked")
	}
	_ = bobToken

	// Cannot disable self or drop own super_admin.
	if w := f.request("PATCH", "/api/v1/admin/users/super", `{"status":"disabled"}`, super, true); w.Code != 400 {
		t.Fatalf("self disable accepted: %d %s", w.Code, w.Body.String())
	}
	if w := f.request("PATCH", "/api/v1/admin/users/super", `{"groups":["formal_user"]}`, super, true); w.Code != 400 {
		t.Fatalf("self demotion accepted: %d %s", w.Code, w.Body.String())
	}
	if w := f.request("PATCH", "/api/v1/admin/users/missing", `{"status":"active"}`, super, true); w.Code != 404 {
		t.Fatalf("missing user: %d", w.Code)
	}
	if w := f.request("PATCH", "/api/v1/admin/users/alice", `{"groups":["not_a_group"]}`, super, true); w.Code != 400 {
		t.Fatalf("invalid group accepted: %d", w.Code)
	}
}
