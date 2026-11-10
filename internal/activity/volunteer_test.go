//go:build integration

package activity_test

import (
	"encoding/json"
	"testing"

	"volun-data/internal/activity"
	"volun-data/internal/dto"
	"volun-data/internal/model"
)

func TestVolunteerProjectsPrivacyAndRecruitment(t *testing.T) {
	f := setup(t)
	token := f.identity(t, "formal_user", false)
	for _, id := range []string{"own", "open", "closed", "expired", "draft", "other"} {
		p := model.Project{ID: id, Code: id, Name: id, Approval: "approved", Status: "招募"}
		state := activity.State{Basics: activity.Basics{Guarantees: []string{"提供饮水"}, OtherGuarantee: "往返接送"}, Draft: &activity.Basics{Guarantees: []string{"专项培训"}}, Bindings: map[string]string{}, Form: activity.Form{ID: "form", Published: true}}
		switch id {
		case "own":
			p.Status = "通过"
			state.Members = []activity.Member{{ID: "mine"}, {ID: "other"}}
			state.Bindings["mine"] = "private-formal_user"
			state.Bindings["other"] = "someone-else"
			state.Attendance = []activity.Attendance{{MemberID: "mine", Action: "checkin"}}
			hours := 7
			state.Hours = []activity.Hour{{MemberID: "mine", Recognized: &hours}}
		case "closed":
			state.Form.Published = false
		case "expired":
			state.Form.Deadline = "2000-01-01T00:00:00Z"
		case "draft":
			p.Approval = "draft"
		case "other":
			p.Status = "通过"
			state.Members = []activity.Member{{ID: "other"}}
			state.Bindings["other"] = "someone-else"
		}
		if err := f.db.Create(&p).Error; err != nil {
			t.Fatal(err)
		}
		raw, err := json.Marshal(state)
		if err != nil {
			t.Fatal(err)
		}
		if err := f.db.Create(&model.Workflow{ProjectID: id, State: string(raw)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if w := f.request("GET", "/api/v1/volunteer/projects", "", "", false); w.Code != 401 {
		t.Fatalf("anonymous status: %d", w.Code)
	}
	type item struct {
		Guarantees     []string            `json:"guarantees"`
		OtherGuarantee string              `json:"other_guarantee"`
		Project        dto.ProjectResponse `json:"project"`
		FormID         string              `json:"form_id"`
		Registered     bool                `json:"registered"`
		Participated   bool                `json:"participated"`
		Hours          *int                `json:"recognized_hours"`
	}
	result := decode[struct {
		Items []item `json:"items"`
	}](t, f.request("GET", "/api/v1/volunteer/projects", "", token, false))
	if len(result.Items) != 2 {
		t.Fatalf("unexpected projects: %+v", result)
	}
	for _, i := range result.Items {
		if len(i.Guarantees) != 1 || i.Guarantees[0] != "提供饮水" || i.OtherGuarantee != "往返接送" {
			t.Fatalf("approved guarantees not exposed: %+v", i)
		}

		if i.Project.ID == "own" && (!i.Registered || !i.Participated || i.Hours != nil || i.FormID != "") {
			t.Fatalf("private record: %+v", i)
		}
		if i.Project.ID == "open" && (i.Registered || i.FormID != "form") {
			t.Fatalf("recruitment: %+v", i)
		}
	}
}

func TestAccountRegistrationRequiresCompleteProfile(t *testing.T) {
	f := setup(t)
	token := f.identity(t, "formal_user", false)
	w := f.request("POST", "/api/v1/public/projects/p/forms/f/responses", `{"key":"synthetic-profile-test","member":{"name":"伪造姓名","number":"123","phone":"13800138000"}}`, token, true)
	if w.Code != 400 {
		t.Fatalf("incomplete profile accepted: %d %s", w.Code, w.Body.String())
	}
}
