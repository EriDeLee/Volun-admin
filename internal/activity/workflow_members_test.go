//go:build integration

package activity_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"volun-data/internal/activity"
	"volun-data/internal/dto"
	"volun-data/internal/model"
)

func TestDeleteProjectMember(t *testing.T) {
	f := setup(t)
	owner := f.identity(t, "activity_admin", false)
	manager := f.identity(t, "data_admin", false)
	p := decode[dto.ProjectResponse](t, f.request("POST", "/api/v1/activity/projects", validProject, owner, true))
	if err := f.db.Model(&model.Project{}).Where("id=?", p.ID).Updates(map[string]any{"approval": "approved", "status": "招募"}).Error; err != nil {
		t.Fatal(err)
	}
	state := activity.State{
		Members:    []activity.Member{{ID: "removable", Name: "测试成员", Number: "001"}, {ID: "attended"}, {ID: "hours"}},
		Bindings:   map[string]string{"removable": "synthetic-user"},
		Attendance: []activity.Attendance{{MemberID: "attended"}},
		Hours:      []activity.Hour{{MemberID: "hours"}},
	}
	raw, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.db.Create(&model.Workflow{ProjectID: p.ID, Version: 1, State: string(raw)}).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.db.Create(&model.ParticipantGrant{Digest: "synthetic-delete-grant", ProjectID: p.ID, MemberID: "removable", ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
		t.Fatal(err)
	}
	call := func(id, token string, version, want int) {
		t.Helper()
		req := httptest.NewRequest("DELETE", "/api/v1/activity/projects/"+p.ID+"/members/"+id, strings.NewReader("{}"))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Requested-With", "XMLHttpRequest")
		req.Header.Set("X-Workflow-Version", strconv.Itoa(version))
		req.AddCookie(&http.Cookie{Name: "volun_session", Value: token})
		w := httptest.NewRecorder()
		f.router.ServeHTTP(w, req)
		if w.Code != want {
			t.Fatalf("delete %s: %d want %d: %s", id, w.Code, want, w.Body.String())
		}
		if (id == "attended" || id == "hours") && !strings.Contains(w.Body.String(), "300004") {
			t.Fatalf("missing record-specific error: %s", w.Body.String())
		}
	}
	call("removable", owner, 1, 403)
	call("removable", manager, 0, 409)
	call("attended", manager, 1, 409)
	call("hours", manager, 1, 409)
	call("missing", manager, 1, 404)
	if err := f.db.Model(&model.Project{}).Where("id=?", p.ID).Update("status", "审核").Error; err != nil {
		t.Fatal(err)
	}
	call("removable", manager, 1, 409)
	if err := f.db.Model(&model.Project{}).Where("id=?", p.ID).Update("status", "招募").Error; err != nil {
		t.Fatal(err)
	}
	call("removable", manager, 1, 200)
	var row model.Workflow
	if err := f.db.First(&row, "project_id=?", p.ID).Error; err != nil {
		t.Fatal(err)
	}
	state = activity.State{}
	if err := json.Unmarshal([]byte(row.State), &state); err != nil {
		t.Fatal(err)
	}
	if row.Version != 2 || len(state.Members) != 2 || state.Bindings["removable"] != "" || len(state.Attendance) != 1 || len(state.Hours) != 1 {
		t.Fatalf("unexpected state after deletion: %+v", state)
	}
	var grant model.ParticipantGrant
	if err := f.db.First(&grant, "digest=?", "synthetic-delete-grant").Error; err != nil || grant.RevokedAt == nil {
		t.Fatalf("grant not revoked: %v", err)
	}
	call("removable", manager, 2, 404)
	var events []model.WorkflowEvent
	if err := f.db.Where("project_id=? AND action=?", p.ID, "members.delete").Find(&events).Error; err != nil || len(events) != 1 || !strings.Contains(events[0].Reason, "001") {
		t.Fatalf("deletion audit missing: %v %+v", err, events)
	}
}
