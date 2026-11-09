//go:build integration

package activity_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"volun-data/internal/activity"
	"volun-data/internal/dto"
	"volun-data/internal/model"
)

func TestHoursRemainClosedBeforeFirstSessionEnd(t *testing.T) {
	f := setup(t)
	owner := f.identity(t, "activity_admin", false)
	data := f.identity(t, "data_admin", false)
	p := decode[dto.ProjectResponse](t, f.request("POST", "/api/v1/activity/projects", validProject, owner, true))
	if err := f.db.Model(&model.Project{}).Where("id=?", p.ID).Updates(map[string]any{"approval": "approved", "status": "进行"}).Error; err != nil {
		t.Fatal(err)
	}
	state := activity.State{Basics: activity.Basics{Sessions: []activity.Session{{ID: "s", Start: time.Now().Add(-time.Hour).Format(time.RFC3339), End: time.Now().Add(time.Hour).Format(time.RFC3339)}}}, Members: []activity.Member{{ID: "m", Name: "synthetic", Number: "001"}}}
	encoded, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.db.Create(&model.Workflow{ProjectID: p.ID, Version: 1, State: string(encoded)}).Error; err != nil {
		t.Fatal(err)
	}
	base := "/api/v1/activity/projects/" + p.ID
	view := decode[struct{ Capabilities []string }](t, f.request("GET", base+"/workflow", "", data, false))
	if slices.Contains(view.Capabilities, "hours.write") || !slices.Contains(view.Capabilities, "attendance.manage") {
		t.Fatalf("unexpected capabilities: %v", view.Capabilities)
	}
	req := httptest.NewRequest("PUT", base+"/hours", strings.NewReader(`{"rows":[{"member_id":"m","hours":1,"source":"登记"}]}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Requested-With", "XMLHttpRequest")
	req.Header.Set("X-Workflow-Version", "1")
	req.AddCookie(&http.Cookie{Name: "volun_session", Value: data})
	w := httptest.NewRecorder()
	f.router.ServeHTTP(w, req)
	var response dto.Response
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if w.Code != 409 || response.ErrCode != 300003 {
		t.Fatalf("hours opened too early: %d %s", w.Code, w.Body.String())
	}
	var stored model.Workflow
	if err := f.db.First(&stored, "project_id=?", p.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Version != 1 || stored.State != string(encoded) {
		t.Fatal("early hours submission changed saved state")
	}
}
