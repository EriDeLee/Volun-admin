//go:build integration

package activity_test

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"

	"volun-data/internal/activity"
	"volun-data/internal/dto"
	"volun-data/internal/model"
)

func TestProjectWorkflowAndAttendance(t *testing.T) {
	f := setup(t)
	owner := f.identity(t, "activity_admin", false)
	data := f.identity(t, "data_admin", false)
	p := decode[dto.ProjectResponse](t, f.request("POST", "/api/v1/activity/projects", validProject, owner, true))
	base := "/api/v1/activity/projects/" + p.ID
	if w := f.request("GET", base, "", data, false); w.Code != 404 {
		t.Fatalf("draft visible: %d", w.Code)
	}
	version := 0
	call := func(method, path string, body any, token string) map[string]json.RawMessage {
		t.Helper()
		payload, _ := json.Marshal(body)
		req := httptest.NewRequest(method, base+path, strings.NewReader(string(payload)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Requested-With", "XMLHttpRequest")
		req.Header.Set("X-Workflow-Version", strconv.Itoa(version))
		req.Header.Set("Cookie", "volun_session="+token)
		w := httptest.NewRecorder()
		f.router.ServeHTTP(w, req)
		result := decode[map[string]json.RawMessage](t, w)
		if raw, ok := result["version"]; ok {
			_ = json.Unmarshal(raw, &version)
		}
		return result
	}
	basics := activity.Basics{Name: "项目", Department: "学院", StartsOn: "2026-11-08", EndsOn: "2026-11-09", Location: "广场", Sessions: []activity.Session{{ID: "s1", Name: "上午", Start: "2026-11-09T08:00:00+08:00", End: "2026-11-09T12:00:00+08:00", Positions: []activity.Position{{ID: "pos1", Name: "引导", Capacity: 10}}}}}
	call("PUT", "/basics", map[string]any{"version": version, "basics": basics}, owner)
	call("POST", "/submit", map[string]any{"version": version}, owner)
	queue := decode[struct{ Total int }](t, f.request("GET", "/api/v1/activity/approvals", "", data, false))
	if queue.Total != 1 {
		t.Fatalf("missing initial approval: %+v", queue)
	}
	if w := f.request("GET", "/api/v1/activity/approvals", "", owner, false); w.Code != 403 {
		t.Fatal("activity administrator can access approval pool")
	}
	if w := f.request("GET", base, "", data, false); w.Code != 200 {
		t.Fatalf("submitted invisible: %s", w.Body.String())
	}
	var state activity.State
	result := call("GET", "/workflow", nil, data)
	_ = json.Unmarshal(result["state"], &state)
	app := state.Applications[0].ID
	call("POST", "/applications/"+app+"/decision", map[string]any{"version": version, "decision": "returned", "reason": "请补充安排"}, data)
	returned := decode[dto.ProjectResponse](t, f.request("GET", base, "", owner, false))
	if returned.Approval != "returned" {
		t.Fatal("proposal return was not persisted")
	}
	call("POST", "/submit", map[string]any{"version": version}, owner)
	result = call("GET", "/workflow", nil, data)
	_ = json.Unmarshal(result["state"], &state)
	app = state.Applications[len(state.Applications)-1].ID
	call("POST", "/applications/"+app+"/decision", map[string]any{"version": version, "decision": "approved", "reason": "符合立项条件"}, data)
	stored := decode[dto.ProjectResponse](t, f.request("GET", base, "", owner, false))
	if stored.Approval != "approved" || stored.Status != "筹备" {
		t.Fatalf("approval did not persist: %+v", stored)
	}
	call("PUT", "/members", map[string]any{"members": []activity.Member{{Name: "甲", Number: "001", SessionID: "s1", PositionID: "pos1"}}, "reason": "登记"}, data)
	result = call("GET", "/workflow", nil, data)
	_ = json.Unmarshal(result["state"], &state)
	member := state.Members[0]
	call("PUT", "/windows", activity.Window{SessionID: "s1", Action: "checkin", Mode: "manual", Open: true}, owner)
	call("POST", "/sessions/s1/attendance", map[string]any{"member_id": member.ID, "action": "checkin", "reason": "", "correction": false}, owner)
	call("POST", "/sessions/s1/attendance", map[string]any{"member_id": member.ID, "action": "checkin", "reason": "", "correction": false}, owner)
	result = call("GET", "/workflow", nil, data)
	_ = json.Unmarshal(result["state"], &state)
	if len(state.Attendance) != 1 || len(state.Hours) != 0 {
		t.Fatalf("attendance repeated or generated hours: %+v", state)
	}
	call("PUT", "/material", activity.Material{Team: "志愿队", Audience: "青少年", Description: "服务内容<&>", ContactName: "负责人", ContactMobile: "13800000000", Guarantees: []string{"提供饮水"}}, data)
	call("POST", "/material/generate", map[string]any{}, data)
	var files []model.MaterialVersion
	if err := f.db.Find(&files).Error; err != nil || len(files) != 1 || len(files[0].Data) < 1000 {
		t.Fatalf("material missing: %v %+v", err, files)
	}
	archive, err := zip.NewReader(bytes.NewReader(files[0].Data), int64(len(files[0].Data)))
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range archive.File {
		if file.Name == "word/document.xml" {
			r, _ := file.Open()
			xml, _ := io.ReadAll(r)
			_ = r.Close()
			if !bytes.Contains(xml, []byte("服务内容&lt;&amp;&gt;")) || !bytes.Contains(xml, []byte("引导")) {
				t.Fatal("material mapping missing or XML not escaped")
			}
		}
	}
	if path := os.Getenv("WORKFLOW_SAMPLE_DOCX"); path != "" {
		if err := os.WriteFile(path, files[0].Data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	changed := basics
	changed.Name = "新名称"
	call("POST", "/changes", map[string]any{"version": version, "basics": changed, "reason": "活动更名"}, owner)
	queue = decode[struct{ Total int }](t, f.request("GET", "/api/v1/activity/approvals?q=新名称", "", data, false))
	if queue.Total != 1 {
		t.Fatal("change missing from approval pool")
	}
	current := decode[dto.ProjectResponse](t, f.request("GET", base, "", owner, false))
	if current.Name != "项目" {
		t.Fatal("unapproved change became active")
	}
	result = call("GET", "/workflow", nil, data)
	_ = json.Unmarshal(result["state"], &state)
	app = state.Applications[len(state.Applications)-1].ID
	call("POST", "/applications/"+app+"/decision", map[string]any{"version": version, "decision": "approved", "reason": "同意变更"}, data)
	result = call("GET", "/workflow", nil, data)
	_ = json.Unmarshal(result["state"], &state)
	decision := state.Applications[len(state.Applications)-1]
	if decision.Reason != "活动更名" || decision.ReviewReason != "同意变更" || decision.ReviewedAt == nil {
		t.Fatal("application reason overwritten or decision missing")
	}
	queue = decode[struct{ Total int }](t, f.request("GET", "/api/v1/activity/approvals", "", data, false))
	if queue.Total != 0 {
		t.Fatal("decided application still pending")
	}
	current = decode[dto.ProjectResponse](t, f.request("GET", base, "", owner, false))
	if current.Name != "新名称" {
		t.Fatal("approved change not active")
	}
	changed.Name = "数据管理员变更"
	call("POST", "/changes", map[string]any{"version": version, "basics": changed, "reason": "核实名称"}, data)
	result = call("GET", "/workflow", nil, data)
	_ = json.Unmarshal(result["state"], &state)
	app = state.Applications[len(state.Applications)-1].ID
	call("POST", "/applications/"+app+"/decision", map[string]any{"version": version, "decision": "approved", "reason": "核实通过"}, data)
}

func TestPublicIdentityPermissionsAndReview(t *testing.T) {
	f := setup(t)
	owner := f.identity(t, "activity_admin", false)
	data := f.identity(t, "data_admin", false)
	formal := f.identity(t, "formal_user", false)
	other := f.identity(t, "activity_admin,formal_user", false)
	p := decode[dto.ProjectResponse](t, f.request("POST", "/api/v1/activity/projects", validProject, owner, true))
	if err := f.db.Model(&model.Project{}).Where("id=?", p.ID).Updates(map[string]any{"approval": "approved", "status": "筹备"}).Error; err != nil {
		t.Fatal(err)
	}
	state := activity.State{Basics: activity.Basics{Name: p.Name, Department: p.Department, StartsOn: p.StartsOn, EndsOn: p.EndsOn, Location: p.Location, Sessions: []activity.Session{{ID: "s", Name: "上午", Start: "2026-11-08T08:00:00+08:00", End: "2026-11-08T12:00:00+08:00", Positions: []activity.Position{{ID: "pos", Name: "引导", Capacity: 2}}}}}, Form: activity.Form{ID: "form", Published: true}, IntentForm: activity.Form{ID: "intent", Published: true}}
	encoded, _ := json.Marshal(state)
	if err := f.db.Create(&model.Workflow{ProjectID: p.ID, Version: 1, State: string(encoded)}).Error; err != nil {
		t.Fatal(err)
	}
	base := "/api/v1/activity/projects/" + p.ID
	public := "/api/v1/public/projects/" + p.ID
	version := 1
	call := func(method, path string, body any, token string, cookie *http.Cookie, want int) *httptest.ResponseRecorder {
		t.Helper()
		payload, _ := json.Marshal(body)
		req := httptest.NewRequest(method, path, bytes.NewReader(payload))
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
			t.Fatalf("%s %s = %d want %d: %s", method, path, w.Code, want, w.Body.String())
		}
		var row model.Workflow
		_ = f.db.First(&row, "project_id=?", p.ID).Error
		version = row.Version
		return w
	}
	call("POST", "/api/v1/activity/projects", json.RawMessage(validProject), data, nil, 403)
	call("GET", base+"/workflow", nil, formal, nil, 403)
	call("GET", base+"/workflow", nil, other, nil, 403)
	for _, path := range []string{"/members", "/forms", "/hours", "/material"} {
		var body any = map[string]any{}
		if path == "/members" {
			body = map[string]any{"members": []activity.Member{{Name: "甲", Number: "1", SessionID: "s", PositionID: "pos"}}}
		}
		if path == "/hours" {
			body = map[string]any{"rows": []map[string]any{{"member_id": "m", "hours": 1}}}
		}
		call("PUT", base+path, body, owner, nil, 403)
	}
	member := activity.Member{Name: "同学", Number: "001", Phone: "13800000000", SessionID: "s", PositionID: "pos"}
	registration := map[string]any{"key": "random-registration-key-123456", "member": member}
	w := call("POST", public+"/forms/form/responses", registration, "", nil, 200)
	var cookie *http.Cookie
	for _, c := range w.Result().Cookies() {
		if strings.HasPrefix(c.Name, "participant_") {
			cookie = c
		}
	}
	if cookie == nil || !cookie.HttpOnly {
		t.Fatal("missing private member cookie")
	}
	result := decode[struct {
		Member     activity.Member
		Credential string
	}](t, w)
	call("GET", public+"/me", nil, "", nil, 403)
	call("GET", public+"/me?number=001", nil, formal, nil, 403)
	call("GET", public+"/me", nil, "", cookie, 200)
	call("POST", public+"/forms/form/responses", registration, "", nil, 200)
	call("PUT", base+"/windows", activity.Window{SessionID: "s", Action: "checkin", Mode: "manual", Open: true}, owner, nil, 200)
	readState := func() activity.State {
		var row model.Workflow
		_ = f.db.First(&row, "project_id=?", p.ID).Error
		var value activity.State
		_ = json.Unmarshal([]byte(row.State), &value)
		return value
	}
	current := readState()
	scan := map[string]any{"token": current.Windows[0].Token}
	call("POST", public+"/sessions/s/scan", scan, "", nil, 403)
	call("POST", public+"/sessions/s/scan", scan, "", cookie, 200)
	before := version
	call("POST", public+"/sessions/s/scan", scan, "", cookie, 200)
	if version != before {
		t.Fatal("duplicate scan wrote another version")
	}
	if current = readState(); len(current.Attendance) != 1 || len(current.Hours) != 0 {
		t.Fatal("attendance must not generate hours")
	}
	call("PUT", base+"/windows", activity.Window{SessionID: "s", Action: "checkin", Mode: "manual", Open: false}, owner, nil, 200)
	call("POST", public+"/sessions/s/scan", scan, "", cookie, 409)
	call("PUT", public+"/me", map[string]any{"intent": "申请录入", "platform": "学校"}, "", cookie, 200)
	for _, hours := range []any{-1, 1.5, nil} {
		call("PUT", base+"/hours", map[string]any{"rows": []map[string]any{{"member_id": result.Member.ID, "hours": hours, "source": "登记"}}}, data, nil, 400)
	}
	call("PUT", base+"/hours", map[string]any{"rows": []map[string]any{{"member_id": result.Member.ID, "hours": 0, "source": "登记"}}}, data, nil, 200)
	call("POST", base+"/members/access", map[string]any{"member_id": result.Member.ID, "revoke": true, "reason": "本人凭证丢失"}, data, nil, 200)
	call("GET", public+"/me", nil, "", cookie, 403)
	call("POST", public+"/forms/form/responses", registration, "", nil, 403)
	for _, stage := range []string{"招募", "进行", "结项", "意向", "统计", "数据", "录入", "审核", "通过"} {
		call("POST", base+"/transition", map[string]any{"status": stage, "reason": "业务处理完成", "external_result": "学校录入回执"}, data, nil, 200)
	}
	current = readState()
	if !current.Review.Published || current.Hours[0].Recognized == nil || *current.Hours[0].Recognized != 0 {
		t.Fatal("zero hours lost in approval")
	}
	visible := decode[struct{ State activity.State }](t, call("GET", base+"/workflow", nil, owner, nil, 200))
	if len(visible.State.Hours) != 1 || visible.State.Hours[0].Recognized == nil || visible.State.Hours[0].Hours != nil || visible.State.Bindings != nil {
		t.Fatal("published activity view exposed drafts or omitted result")
	}
	call("PUT", base+"/hours", map[string]any{"rows": []map[string]any{{"member_id": result.Member.ID, "hours": 2, "source": "更正", "reason": "核实"}}}, data, nil, 409)
	call("POST", base+"/transition", map[string]any{"status": "数据", "reason": "更正重开"}, data, nil, 200)
	current = readState()
	if current.Review.Published || current.Hours[0].Recognized != nil {
		t.Fatal("reopen retained publication")
	}
	version--
	call("PUT", base+"/forms", map[string]any{"kind": "recruit", "title": "过期版本"}, data, nil, 409)
}
