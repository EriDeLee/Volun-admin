//go:build integration

package activity_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"volun-data/internal/activity"
	"volun-data/internal/dto"
	"volun-data/internal/model"
)

func TestRecruitmentMultipleAssignments(t *testing.T) {
	f := setup(t)
	owner := f.identity(t, "activity_admin", false)
	data := f.identity(t, "data_admin", false)
	p := decode[dto.ProjectResponse](t, f.request("POST", "/api/v1/activity/projects", validProject, owner, true))
	if err := f.db.Model(&model.Project{}).Where("id=?", p.ID).Updates(map[string]any{"approval": "approved", "status": "招募"}).Error; err != nil {
		t.Fatal(err)
	}
	state := activity.State{Basics: activity.Basics{Sessions: []activity.Session{
		{ID: "s1", Name: "上午", Positions: []activity.Position{{ID: "p1", Name: "引导", Capacity: 10}}},
		{ID: "s2", Name: "下午", Positions: []activity.Position{{ID: "p2", Name: "服务", Capacity: 1}}},
	}}, Form: activity.Form{ID: "form", Published: true}}
	raw, _ := json.Marshal(state)
	if err := f.db.Create(&model.Workflow{ProjectID: p.ID, Version: 1, State: string(raw)}).Error; err != nil {
		t.Fatal(err)
	}
	base := "/api/v1/activity/projects/" + p.ID
	public := "/api/v1/public/projects/" + p.ID
	version := 1
	call := func(method, path string, body any, token string, cookie *http.Cookie, want int) *httptest.ResponseRecorder {
		t.Helper()
		payload, _ := json.Marshal(body)
		req := httptest.NewRequest(method, path, strings.NewReader(string(payload)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Requested-With", "XMLHttpRequest")
		req.Header.Set("X-Workflow-Version", strconv.Itoa(version))
		if token != "" {
			req.AddCookie(&http.Cookie{Name: "volun_session", Value: token})
		}
		if cookie != nil {
			req.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		f.router.ServeHTTP(w, req)
		if w.Code != want {
			t.Fatalf("%s %s: %d want %d: %s", method, path, w.Code, want, w.Body.String())
		}
		var row model.Workflow
		if err := f.db.First(&row, "project_id=?", p.ID).Error; err != nil {
			t.Fatal(err)
		}
		version = row.Version
		if err := json.Unmarshal([]byte(row.State), &state); err != nil {
			t.Fatal(err)
		}
		return w
	}
	choices := []activity.Assignment{{SessionID: "s1", PositionID: "p1"}, {SessionID: "s2", PositionID: "p2"}}
	m := activity.Member{Name: "测试成员", Number: "001", Phone: "13800000000", Notes: "可协助布场", Assignments: choices}
	registration := map[string]any{"key": "synthetic-registration-0001", "member": m}
	w := call("POST", public+"/forms/form/responses", registration, "", nil, 200)
	if len(state.Members) != 1 || len(state.Members[0].Assignments) != 2 || state.Members[0].Notes != m.Notes || state.Members[0].SessionID != "s1" {
		t.Fatalf("registration: %+v", state.Members)
	}
	var cookie *http.Cookie
	for _, c := range w.Result().Cookies() {
		if strings.HasPrefix(c.Name, "participant_") {
			cookie = c
		}
	}
	if cookie == nil {
		t.Fatal("no participant cookie")
	}
	before := version
	call("POST", public+"/forms/form/responses", registration, "", nil, 200)
	if version != before || len(state.Members) != 1 {
		t.Fatal("retry duplicated registration")
	}
	m.Number = "002"
	call("POST", public+"/forms/form/responses", map[string]any{"key": "synthetic-registration-0002", "member": m}, "", nil, 409)
	if len(state.Members) != 1 {
		t.Fatal("full second assignment partially registered")
	}
	call("PUT", public+"/me", map[string]any{"name": "测试成员", "phone": m.Phone, "notes": "更新备注", "assignments": choices}, "", cookie, 200)
	if state.Members[0].Notes != "更新备注" {
		t.Fatal("notes not saved")
	}
	call("PUT", base+"/windows", activity.Window{SessionID: "s2", Action: "checkin", Mode: "manual", Open: true}, owner, nil, 200)
	memberID := state.Members[0].ID
	call("POST", base+"/sessions/s2/attendance", map[string]any{"member_id": memberID, "action": "checkin"}, owner, nil, 200)
	if len(state.Attendance) != 1 || state.Attendance[0].SessionID != "s2" {
		t.Fatal("second session attendance missing")
	}
	csv := call("GET", base+"/members/export", nil, data, nil, 200).Body.String()
	for _, text := range []string{"备注", "上午 / 引导", "下午 / 服务", "更新备注"} {
		if !strings.Contains(csv, text) {
			t.Fatalf("CSV missing %s: %s", text, csv)
		}
	}
}
