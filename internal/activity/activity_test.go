//go:build integration

package activity_test

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"volun-data/internal/auth"
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
	return fixture{db, httpapi.NewRouter(pool, slog.New(slog.NewTextHandler(io.Discard, nil)), &auth.Service{DB: db})}
}

func (f fixture) identity(t *testing.T, group string, needsPassword bool) string {
	t.Helper()
	u := model.User{Sub: "private-" + group, Username: group, Name: "活动负责人", Status: "active", Groups: group, PasswordSetupRequired: needsPassword}
	if err := f.db.Create(&u).Error; err != nil {
		t.Fatal(err)
	}
	token := "cookie-" + group
	hash := sha256.Sum256([]byte(token))
	if err := f.db.Create(&model.Session{ID: group, UserID: u.Sub, TokenDigest: hex.EncodeToString(hash[:]), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
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
	if strings.Contains(w.Body.String(), "private-") || strings.Contains(w.Body.String(), "created_by") {
		t.Fatal("internal identity leaked")
	}
	return envelope.Data
}

func TestAuthorization(t *testing.T) {
	for _, tc := range []struct {
		name, group  string
		setup        bool
		code, status int
	}{
		{"anonymous", "", false, 200001, 401},
		{"formal user", "formal_user", false, 200002, 403},
		{"similar role is not accepted", "other_activity_admin", false, 200002, 403},
		{"password setup gate", "activity_admin", true, 200009, 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := setup(t)
			token := ""
			if tc.group != "" {
				token = f.identity(t, tc.group, tc.setup)
			}
			for _, route := range []struct{ method, path, body string }{
				{"GET", "/api/v1/activity/dashboard", ""}, {"GET", "/api/v1/activity/projects", ""}, {"POST", "/api/v1/activity/projects", `{}`}, {"GET", "/api/v1/activity/projects/other", ""},
			} {
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

func TestDashboardScopeCountsAndLimits(t *testing.T) {
	f := setup(t)
	token := f.identity(t, "activity_admin", false)
	super := f.identity(t, "super_admin", false)
	empty := decode[dto.ActivityDashboard](t, f.request("GET", "/api/v1/activity/dashboard", "", token, false))
	if empty.Summary.ProjectCount != 0 || empty.Summary.RecognizedHours != nil || empty.Tasks == nil || empty.RecentProjects == nil || len(empty.Stages) != 12 {
		t.Fatalf("bad empty state: %+v", empty)
	}
	for i := range 15 {
		p := model.Project{ID: fmt.Sprintf("p-%02d", i), Code: fmt.Sprintf("ZY-%02d", i), Name: fmt.Sprintf("项目%d", i), CreatedBy: "private-activity_admin", Status: "立项", UpdatedAt: time.Now().Add(time.Duration(i) * time.Minute)}
		if i == 14 {
			p.Status = "招募"
		}
		if err := f.db.Create(&p).Error; err != nil {
			t.Fatal(err)
		}
	}
	other := model.Project{ID: "other", Code: "ZY-OTHER", Name: "他人项目", CreatedBy: "private-other", Status: "通过"}
	if err := f.db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	w := f.request("GET", "/api/v1/activity/dashboard", "", token, false)
	d := decode[dto.ActivityDashboard](t, w)
	if w.Header().Get("Cache-Control") != "no-store" || d.Scope != "owned" || d.Summary.ProjectCount != 15 || d.Summary.PendingCount != 15 || d.Summary.RecruitingCount != 1 || len(d.RecentProjects) != 12 || len(d.Tasks) != 5 || d.RecentProjects[0].ID != "p-14" || d.Tasks[0].ProjectID != "p-14" {
		t.Fatalf("bad dashboard: %+v", d)
	}
	var sum int64
	for _, s := range d.Stages {
		sum += s.Count
	}
	if sum != 15 {
		t.Fatal("stage total mismatch")
	}
	for _, id := range []string{"other", "missing"} {
		if w := f.request("GET", "/api/v1/activity/projects/"+id, "", token, false); w.Code != 404 {
			t.Fatalf("out of scope: %d", w.Code)
		}
	}
	all := decode[dto.ActivityDashboard](t, f.request("GET", "/api/v1/activity/dashboard", "", super, false))
	if all.Scope != "all" || all.Summary.ProjectCount != 16 {
		t.Fatalf("super scope: %+v", all)
	}
	p := decode[dto.ProjectResponse](t, f.request("GET", "/api/v1/activity/projects/other", "", super, false))
	if p.ID != "other" {
		t.Fatal("wrong project")
	}
}

const validProject = `{"name":" 校园志愿服务 ","department":" 学院团委 ","starts_on":"2026-11-08","ends_on":"2026-11-09","location":" 校园 ","description":" 说明 ","status":"通过","created_by":"someone-else"}`

func TestCreateProject(t *testing.T) {
	f := setup(t)
	token := f.identity(t, "activity_admin", false)
	if w := f.request("POST", "/api/v1/activity/projects", validProject, token, false); w.Code != 403 {
		t.Fatalf("missing header accepted: %d", w.Code)
	}
	p := decode[dto.ProjectResponse](t, f.request("POST", "/api/v1/activity/projects", validProject, token, true))
	if p.Name != "校园志愿服务" || p.Department != "学院团委" || p.Location != "校园" || p.Description != "说明" || p.Status != "立项" || p.OwnerName != "活动负责人" || p.ID == "" || p.Code == "" {
		t.Fatalf("bad project: %+v", p)
	}
	var stored model.Project
	if err := f.db.First(&stored, "id = ?", p.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.CreatedBy != "private-activity_admin" || stored.Status != "立项" {
		t.Fatal("caller changed ownership or status")
	}
	loaded := decode[dto.ProjectResponse](t, f.request("GET", "/api/v1/activity/projects/"+p.ID, "", token, false))
	if loaded.Code != p.Code {
		t.Fatal("project not persisted")
	}
	d := decode[dto.ActivityDashboard](t, f.request("GET", "/api/v1/activity/dashboard", "", token, false))
	if d.Summary.ProjectCount != 1 || d.Summary.PendingCount != 1 {
		t.Fatal("create not reflected on dashboard")
	}
}

func TestCreateProjectValidation(t *testing.T) {
	for _, tc := range []struct{ name, body string }{
		{"invalid JSON", "{"}, {"missing fields", "{}"},
		{"trailing JSON", validProject + `{}`},
		{"oversized padding", validProject + strings.Repeat(" ", 17<<10)},
		{"blank name", strings.Replace(validProject, " 校园志愿服务 ", "  ", 1)},
		{"invalid date", strings.Replace(validProject, "2026-11-08", "2026-02-30", 1)},
		{"reversed dates", strings.Replace(validProject, "2026-11-09", "2026-11-07", 1)},
		{"name too long", strings.Replace(validProject, " 校园志愿服务 ", strings.Repeat("志", 81), 1)},
		{"oversized body", `{"description":"` + strings.Repeat("a", 17<<10) + `"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := setup(t)
			token := f.identity(t, "activity_admin", false)
			w := f.request("POST", "/api/v1/activity/projects", tc.body, token, true)
			if w.Code != 400 {
				t.Fatalf("expected validation error: %d %s", w.Code, w.Body.String())
			}
			var count int64
			if err := f.db.Model(&model.Project{}).Count(&count).Error; err != nil {
				t.Fatal(err)
			}
			if count != 0 {
				t.Fatal("invalid project persisted")
			}
		})
	}
}

func TestListProjects(t *testing.T) {
	f := setup(t)
	token := f.identity(t, "activity_admin", false)
	empty := decode[dto.ProjectListResponse](t, f.request("GET", "/api/v1/activity/projects", "", token, false))
	if empty.Total != 0 || empty.Items == nil || empty.Summary.ProjectCount != 0 {
		t.Fatalf("bad empty list: %+v", empty)
	}
	for i := range 5 {
		status := "立项"
		if i == 4 {
			status = "招募"
		}
		dept := "学院团委"
		if i%2 == 0 {
			dept = "计算机学院"
		}
		p := model.Project{ID: fmt.Sprintf("l-%d", i), Code: fmt.Sprintf("ZY-L-%d", i), Name: fmt.Sprintf("台账项目%d", i), Department: dept, CreatedBy: "private-activity_admin", Status: status, UpdatedAt: time.Now().Add(time.Duration(i) * time.Minute)}
		if err := f.db.Create(&p).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := f.db.Create(&model.Project{ID: "hidden", Code: "ZY-H", Name: "他人", CreatedBy: "private-other", Status: "通过"}).Error; err != nil {
		t.Fatal(err)
	}
	all := decode[dto.ProjectListResponse](t, f.request("GET", "/api/v1/activity/projects?page_size=2", "", token, false))
	if all.Total != 5 || len(all.Items) != 2 || all.Summary.ProjectCount != 5 || all.Summary.RecruitingCount != 1 || all.Items[0].ID != "l-4" {
		t.Fatalf("bad list page: %+v", all)
	}
	pending := decode[dto.ProjectListResponse](t, f.request("GET", "/api/v1/activity/projects?view=pending", "", token, false))
	if pending.Total != 5 {
		t.Fatalf("pending view: %+v", pending)
	}
	filtered := decode[dto.ProjectListResponse](t, f.request("GET", "/api/v1/activity/projects?status=%E6%8B%9B%E5%8B%9F&department=%E8%AE%A1%E7%AE%97%E6%9C%BA%E5%AD%A6%E9%99%A2", "", token, false))
	if filtered.Total != 1 || filtered.Items[0].Status != "招募" {
		t.Fatalf("status/dept filter: %+v", filtered)
	}
	search := decode[dto.ProjectListResponse](t, f.request("GET", "/api/v1/activity/projects?q=ZY-L-3", "", token, false))
	if search.Total != 1 || search.Items[0].Code != "ZY-L-3" {
		t.Fatalf("search: %+v", search)
	}
	if w := f.request("GET", "/api/v1/activity/projects?view=nope", "", token, false); w.Code != 400 {
		t.Fatalf("invalid view: %d", w.Code)
	}
}

func TestListProjectsScopeAndPagination(t *testing.T) {
	f := setup(t)
	token := f.identity(t, "activity_admin", false)
	super := f.identity(t, "super_admin", false)
	for i := range 5 {
		status := "立项"
		if i == 4 {
			status = "通过"
		}
		p := model.Project{ID: fmt.Sprintf("scope-%d", i), Code: fmt.Sprintf("S-%d", i), Name: fmt.Sprintf("Owned%d", i), Department: "Owned department", CreatedBy: "private-activity_admin", Status: status, UpdatedAt: time.Now().Add(time.Duration(i) * time.Minute)}
		if err := f.db.Create(&p).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := f.db.Create(&model.Project{ID: "hidden", Code: "HIDDEN-CODE", Name: "Hidden", Department: "Hidden department", CreatedBy: "someone-else", Status: "立项"}).Error; err != nil {
		t.Fatal(err)
	}
	for _, query := range []string{"HIDDEN-CODE", "Hidden"} {
		d := decode[dto.ProjectListResponse](t, f.request("GET", "/api/v1/activity/projects?q="+query, "", token, false))
		if d.Total != 0 || len(d.Items) != 0 || len(d.Departments) != 1 || d.Summary.ProjectCount != 5 {
			t.Fatalf("out-of-scope search leaked: %+v", d)
		}
	}
	all := decode[dto.ProjectListResponse](t, f.request("GET", "/api/v1/activity/projects?page=2&page_size=2", "", token, false))
	if all.Total != 5 || len(all.Items) != 2 || all.Items[0].ID != "scope-2" || all.Items[1].ID != "scope-1" {
		t.Fatalf("bad page 2: %+v", all)
	}
	empty := decode[dto.ProjectListResponse](t, f.request("GET", "/api/v1/activity/projects?page=100&page_size=2", "", token, false))
	if empty.Total != 5 || len(empty.Items) != 0 || empty.Items == nil {
		t.Fatalf("bad page beyond total: %+v", empty)
	}
	pending := decode[dto.ProjectListResponse](t, f.request("GET", "/api/v1/activity/projects?view=pending", "", token, false))
	if pending.Total != 4 || pending.Summary.ProjectCount != 5 || pending.Summary.PendingCount != 4 {
		t.Fatalf("bad pending counts: %+v", pending)
	}
	superList := decode[dto.ProjectListResponse](t, f.request("GET", "/api/v1/activity/projects?q=HIDDEN-CODE", "", super, false))
	if superList.Total != 1 || superList.Items[0].ID != "hidden" || superList.Scope != "all" || len(superList.Departments) != 2 {
		t.Fatalf("bad super scope: %+v", superList)
	}
	wildcard := decode[dto.ProjectListResponse](t, f.request("GET", "/api/v1/activity/projects?q=%25", "", token, false))
	if wildcard.Total != 0 {
		t.Fatalf("wildcard treated as SQL: %+v", wildcard)
	}
}

func TestListProjectsInvalidArguments(t *testing.T) {
	for _, tc := range []struct{ name, query string }{
		{"zero page", "page=0"}, {"negative page", "page=-2"}, {"invalid page", "page=wrong"},
		{"page overflow", "page=9223372036854775807"}, {"page over limit", "page=1000001"},
		{"zero size", "page_size=0"}, {"size over limit", "page_size=101"}, {"invalid size", "page_size=1.5"},
		{"invalid status", "status=unknown"}, {"invalid view", "view=mine"},
		{"long search", "q=" + strings.Repeat("x", 161)}, {"long department", "department=" + strings.Repeat("x", 81)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := setup(t)
			token := f.identity(t, "activity_admin", false)
			w := f.request("GET", "/api/v1/activity/projects?"+tc.query, "", token, false)
			if w.Code != 400 {
				t.Fatalf("expected 400: %d %s", w.Code, w.Body.String())
			}
		})
	}
}
