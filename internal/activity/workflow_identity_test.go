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

func TestRecruitmentIdentity(t *testing.T) {
	f := setup(t)
	owner := f.identity(t, "activity_admin", false)
	manager := f.identity(t, "data_admin", false)
	account := f.identity(t, "formal_user", false)
	phone := "130" + strings.Repeat("0", 7) + "1"
	if err := f.db.Model(&model.User{}).Where("username=?", "formal_user").Updates(map[string]any{"id": "001234", "name": "账号姓名", "phone": phone}).Error; err != nil {
		t.Fatal(err)
	}
	p := decode[dto.ProjectResponse](t, f.request("POST", "/api/v1/activity/projects", validProject, owner, true))
	if err := f.db.Model(&model.Project{}).Where("id=?", p.ID).Updates(map[string]any{"approval": "approved", "status": "招募"}).Error; err != nil {
		t.Fatal(err)
	}
	state := activity.State{Basics: activity.Basics{Sessions: []activity.Session{{ID: "s", Positions: []activity.Position{{ID: "p", Capacity: 10}}}}}, Form: activity.Form{ID: "f", Published: true}}
	raw, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.db.Create(&model.Workflow{ProjectID: p.ID, Version: 1, State: string(raw)}).Error; err != nil {
		t.Fatal(err)
	}
	public := "/api/v1/public/projects/" + p.ID
	managed := "/api/v1/activity/projects/" + p.ID
	call := func(method, path string, body any, token string, want int) *httptest.ResponseRecorder {
		t.Helper()
		var row model.Workflow
		if err := f.db.First(&row, "project_id=?", p.ID).Error; err != nil {
			t.Fatal(err)
		}
		payload, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(method, path, strings.NewReader(string(payload)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Requested-With", "XMLHttpRequest")
		req.Header.Set("X-Workflow-Version", strconv.Itoa(row.Version))
		if token != "" {
			req.AddCookie(&http.Cookie{Name: "volun_session", Value: token})
		}
		w := httptest.NewRecorder()
		f.router.ServeHTTP(w, req)
		if w.Code != want {
			t.Fatalf("%s %s: %d want %d: %s", method, path, w.Code, want, w.Body.String())
		}
		return w
	}
	member := activity.Member{Name: "手填姓名", Number: "009999", Phone: "13800000000", SessionID: "s", PositionID: "p", IdentitySource: "account", IdentityVerified: true}
	manual := decode[struct{ Member activity.Member }](t, call("POST", public+"/forms/f/responses", map[string]any{"key": "synthetic-manual-key", "member": member}, "", 200)).Member
	if manual.IdentityVerified || manual.IdentitySource != "manual" {
		t.Fatalf("client forged verified identity: %+v", manual)
	}
	verified := decode[struct{ Member activity.Member }](t, call("POST", public+"/forms/f/responses", map[string]any{"key": "synthetic-account-key", "member": member}, account, 200)).Member
	if !verified.IdentityVerified || verified.IdentitySource != "account" || verified.Name != "账号姓名" || verified.Number != "001234" || verified.Phone != phone {
		t.Fatalf("account identity not authoritative: %+v", verified)
	}
	call("GET", public+"/me", nil, account, 200)
	call("PUT", public+"/me", map[string]any{"name": "冒用他人", "phone": member.Phone}, account, 400)
	call("POST", managed+"/members/access", map[string]any{"member_id": verified.ID, "reason": "账号无需人工核实"}, manager, 400)
	call("POST", managed+"/members/access", map[string]any{"member_id": manual.ID, "username": "formal_user", "reason": "身份不匹配"}, manager, 400)
	call("POST", managed+"/members/access", map[string]any{"member_id": manual.ID, "reason": "线下核实手动填写身份"}, manager, 200)
	var row model.Workflow
	if err := f.db.First(&row, "project_id=?", p.ID).Error; err != nil {
		t.Fatal(err)
	}
	state = activity.State{}
	if err := json.Unmarshal([]byte(row.State), &state); err != nil {
		t.Fatal(err)
	}
	if !state.Members[0].IdentityVerified || state.Members[0].IdentitySource != "manual" {
		t.Fatal("manual verification not persisted")
	}
	manual.IdentityVerified = false
	manual.IdentitySource = "account"
	call("PUT", managed+"/members", map[string]any{"members": []activity.Member{manual}}, manager, 200)
	var saved model.Workflow
	if err := f.db.First(&saved, "project_id=?", p.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(saved.State), &state); err != nil {
		t.Fatal(err)
	}
	if state.Members[0].IdentitySource != "manual" || !state.Members[0].IdentityVerified {
		t.Fatal("editing member overwrote server identity status")
	}
	candidateToken := f.identity(t, "candidate_user", false)
	if err := f.db.Model(&model.User{}).Where("username=?", "candidate_user").Updates(map[string]any{"id": "001235", "name": "待选志愿者", "status": "active"}).Error; err != nil {
		t.Fatal(err)
	}
	candidates := call("GET", managed+"/members/candidates?q=001235", nil, manager, 200)
	if !strings.Contains(candidates.Body.String(), "待选志愿者") || strings.Contains(candidates.Body.String(), "password_hash") || strings.Contains(candidates.Body.String(), "groups") {
		t.Fatal("candidate search did not return minimal volunteer fields")
	}
	call("GET", managed+"/members/candidates?q=001235", nil, owner, 403)
	call("GET", managed+"/members/candidates?q=001235", nil, account, 403)
	selected := map[string]any{"account_username": "candidate_user", "name": "伪造姓名", "number": "伪造学号", "session_id": "s", "position_id": "p"}
	call("PUT", managed+"/members", map[string]any{"members": []any{selected}}, manager, 200)
	own := decode[struct{ Member activity.Member }](t, call("GET", public+"/me", nil, candidateToken, 200)).Member
	if own.Name != "待选志愿者" || own.Number != "001235" || !own.IdentityVerified || own.IdentitySource != "account" {
		t.Fatal("selected account identity was not bound authoritatively")
	}
	call("PUT", managed+"/members", map[string]any{"members": []any{selected}}, manager, 409)
	if err := f.db.Model(&model.Project{}).Where("id=?", p.ID).Update("status", "通过").Error; err != nil {
		t.Fatal(err)
	}
	call("GET", managed+"/members/candidates?q=001235", nil, manager, 409)
}
