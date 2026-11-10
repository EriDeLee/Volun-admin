package activity

import (
	"encoding/json"

	"github.com/gin-gonic/gin"
	"volun-data/internal/dto"
	"volun-data/internal/errhandler"
	"volun-data/internal/model"
)

type volunteerProject struct {
	Project         dto.ProjectResponse `json:"project"`
	FormID          string              `json:"form_id"`
	Deadline        string              `json:"deadline"`
	Registered      bool                `json:"registered"`
	Participated    bool                `json:"participated"`
	RecognizedHours *int                `json:"recognized_hours"`
}

// VolunteerProjects only exposes published recruitment and the caller's bound records.
func (s *Service) VolunteerProjects(c *gin.Context) {
	u := actor(c)
	items := []volunteerProject{}
	var rows []struct {
		model.Project `gorm:"embedded"`
		WorkflowState string
	}
	err := s.DB.WithContext(c.Request.Context()).Table("projects").
		Select("projects.*, workflows.state AS workflow_state").
		Joins("JOIN workflows ON workflows.project_id = projects.id").
		Where("projects.approval = ?", "approved").
		Order("projects.starts_on DESC, projects.id").Scan(&rows).Error
	if err != nil {
		failWorkflow(c, err)
		return
	}
	for _, row := range rows {
		var state State
		if err := json.Unmarshal([]byte(row.WorkflowState), &state); err != nil {
			failWorkflow(c, err)
			return
		}
		item := volunteerProject{Project: projectJSON(row.Project)}
		for _, m := range state.Members {
			if state.Bindings[m.ID] != u.Sub {
				continue
			}
			item.Registered = true
			for _, a := range state.Attendance {
				if a.MemberID == m.ID {
					item.Participated = true
				}
			}
			for _, h := range state.Hours {
				if h.MemberID != m.ID {
					continue
				}
				if h.Hours != nil && *h.Hours > 0 {
					item.Participated = true
				}
				if state.Review.Published {
					item.RecognizedHours = h.Recognized
				}
			}
		}
		if formOpen(state.Form) && (row.Status == "筹备" || row.Status == "招募") {
			item.FormID = state.Form.ID
			item.Deadline = state.Form.Deadline
		}
		if item.Registered || item.FormID != "" {
			items = append(items, item)
		}
	}
	c.Header("Cache-Control", "no-store")
	errhandler.OK(c, gin.H{"items": items})
}
