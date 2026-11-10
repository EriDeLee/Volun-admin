//go:build integration

package activity_test

import (
	"encoding/json"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"volun-data/internal/activity"
	"volun-data/internal/model"
)

func TestChangeRequestRejectsApprovedContent(t *testing.T) {
	f := setup(t)
	owner := f.identity(t, "activity_admin", false)
	reviewer := f.identity(t, "data_admin", false)
	p := model.Project{ID: "change-test", Code: "CHANGE-TEST", CreatedBy: "private-activity_admin", Approval: "approved", Status: "筹备"}
	if err := f.db.Create(&p).Error; err != nil {
		t.Fatal(err)
	}
	basics := activity.Basics{Name: "项目", Department: "学院", StartsOn: "2026-11-10", EndsOn: "2026-11-10", Location: "广场", Sessions: []activity.Session{{ID: "s", Name: "上午", Start: "2026-11-10T08:00:00+08:00", End: "2026-11-10T12:00:00+08:00", Positions: []activity.Position{{ID: "p", Name: "引导", Capacity: 5}}}}}
	raw, err := json.Marshal(activity.State{Basics: basics})
	if err != nil {
		t.Fatal(err)
	}
	if err := f.db.Create(&model.Workflow{ProjectID: p.ID, Version: 1, State: string(raw)}).Error; err != nil {
		t.Fatal(err)
	}
	version := 1
	call := func(path string, body any, token string, want int) activity.State {
		t.Helper()
		payload, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest("POST", "/api/v1/activity/projects/"+p.ID+path, strings.NewReader(string(payload)))
		req.Header.Set("Cookie", "volun_session="+token)
		req.Header.Set("X-Requested-With", "XMLHttpRequest")
		req.Header.Set("X-Workflow-Version", strconv.Itoa(version))
		w := httptest.NewRecorder()
		f.router.ServeHTTP(w, req)
		if w.Code != want {
			t.Fatalf("%s: got %d want %d: %s", path, w.Code, want, w.Body.String())
		}
		var row model.Workflow
		if err := f.db.First(&row, "project_id=?", p.ID).Error; err != nil {
			t.Fatal(err)
		}
		version = row.Version
		var state activity.State
		if err := json.Unmarshal([]byte(row.State), &state); err != nil {
			t.Fatal(err)
		}
		return state
	}
	change := func(b activity.Basics, want int) activity.State {
		return call("/changes", map[string]any{"version": version, "basics": b, "reason": "更新安排"}, owner, want)
	}
	change(basics, 400)
	basics.Name = "变更后项目"
	state := change(basics, 200)
	change(basics, 409) // A pending change still blocks another submission.
	state = call("/applications/"+state.Applications[0].ID+"/decision", map[string]any{"version": version, "decision": "approved", "reason": "同意变更"}, reviewer, 200)
	approvedVersion := version
	state = change(basics, 400)
	if version != approvedVersion || len(state.Applications) != 1 || state.Draft != nil {
		t.Fatal("duplicate created a draft, application or version")
	}
	// Merely changing the timezone notation is not a new schedule.
	basics.Sessions[0].Start = "2026-11-10T00:00:00Z"
	basics.Sessions[0].End = "2026-11-10T04:00:00Z"
	change(basics, 400)
	basics.Location = "新广场"
	state = change(basics, 200)
	if len(state.Applications) != 2 || state.Draft == nil {
		t.Fatal("a later real change must remain possible")
	}
}
