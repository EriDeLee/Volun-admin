package activity

import (
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"volun-data/internal/errhandler"
	"volun-data/internal/model"
)

func (s *Service) getProject(c *gin.Context, write bool) (model.Project, error) {
	u := actor(c)
	var p model.Project
	if err := s.DB.WithContext(c.Request.Context()).Where("id = ?", c.Param("id")).First(&p).Error; err != nil {
		return p, err
	}
	if hasGroup(u, "super_admin") || dataManager(u) && p.Approval != "draft" {
		return p, nil
	}
	if hasGroup(u, "activity_admin") && p.CreatedBy == u.Sub {
		return p, nil
	}
	return p, errPermission
}

func (s *Service) workflowState(c *gin.Context, write bool) {
	p, err := s.getProject(c, write)
	if err != nil {
		failWorkflow(c, err)
		return
	}
	row, state, err := loadState(s.DB.WithContext(c.Request.Context()), p)
	if err != nil {
		failWorkflow(c, err)
		return
	}
	state.Bindings = nil
	if !dataManager(actor(c)) {
		published := []Hour{}
		if state.Review.Published {
			for _, h := range state.Hours {
				if h.Recognized != nil {
					published = append(published, Hour{MemberID: h.MemberID, Recognized: h.Recognized})
				}
			}
		}
		state.Hours = published
		state.Material.Password = ""
		state.Review.Snapshot = ""
		if !state.Review.Published {
			state.Review = Review{}
		}
	}
	errhandler.OK(c, map[string]any{"project": projectJSON(p), "version": row.Version, "approval": p.Approval, "state": state, "capabilities": capabilities(actor(c), p)})
}

func (s *Service) mutate(c *gin.Context, action string, operation func(*gorm.DB, *model.Project, model.Workflow, *State, model.User) (string, error)) {
	u := actor(c)
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var p model.Project
		if err := tx.Where("id = ?", c.Param("id")).First(&p).Error; err != nil {
			return err
		}
		if !(hasGroup(u, "super_admin") || dataManager(u) && p.Approval != "draft" || (hasGroup(u, "activity_admin") && p.CreatedBy == u.Sub)) {
			return errPermission
		}
		row, state, err := loadState(tx, p)
		if err != nil {
			return err
		}
		version, parseErr := strconv.Atoi(c.GetHeader("X-Workflow-Version"))
		if parseErr != nil || version != row.Version {
			return errConflict
		}
		reason, err := operation(tx, &p, row, &state, u)
		if err != nil {
			return err
		}
		return saveState(tx, p, row, state, u, action, reason)
	})
	if err != nil {
		failWorkflow(c, err)
		return
	}
	s.workflowState(c, true)
}

func (s *Service) submitProject(c *gin.Context) {
	var req struct {
		Version int `json:"version"`
	}
	if !decodeBody(c, &req) {
		return
	}
	s.mutate(c, "project.submit", func(tx *gorm.DB, p *model.Project, row model.Workflow, state *State, u model.User) (string, error) {
		if row.Version != req.Version || p.Approval != "draft" && p.Approval != "returned" {
			return "", errConflict
		}
		if !hasGroup(u, "super_admin") && !hasGroup(u, "activity_admin") {
			return "", errPermission
		}
		if !basicsValid(state.Basics) {
			return "", errInvalid
		}
		state.Draft = nil
		p.Approval = "pending"
		state.Applications = append(state.Applications, Application{ID: newID(), Kind: "initial", Status: "pending", Basics: state.Basics, Applicant: u.Sub, ApplicantName: u.Name, CreatedAt: time.Now().UTC()})
		return "", nil
	})
}

func (s *Service) updateBasics(c *gin.Context) {
	var req struct {
		Version int    `json:"version"`
		Basics  Basics `json:"basics"`
	}
	if !decodeBody(c, &req) {
		return
	}
	s.mutate(c, "project.basics.edit", func(tx *gorm.DB, p *model.Project, row model.Workflow, state *State, u model.User) (string, error) {
		if row.Version != req.Version || (p.Approval != "draft" && p.Approval != "returned") {
			return "", errConflict
		}
		if !(hasGroup(u, "activity_admin") && p.CreatedBy == u.Sub || dataManager(u) || hasGroup(u, "super_admin")) {
			return "", errPermission
		}
		if !basicsValid(req.Basics) {
			return "", errInvalid
		}
		state.Basics = req.Basics
		applyBasics(p, req.Basics)
		return "", nil
	})
}

func (s *Service) requestChange(c *gin.Context) {
	var req struct {
		Version int    `json:"version"`
		Basics  Basics `json:"basics"`
		Reason  string `json:"reason"`
	}
	if !decodeBody(c, &req) {
		return
	}
	s.mutate(c, "project.change.request", func(tx *gorm.DB, p *model.Project, row model.Workflow, state *State, u model.User) (string, error) {
		if row.Version != req.Version || p.Approval != "approved" || state.Draft != nil {
			return "", errConflict
		}
		if !basicsValid(req.Basics) || len([]rune(strings.TrimSpace(req.Reason))) < 2 || len([]rune(req.Reason)) > 300 {
			return "", errInvalid
		}
		state.Draft = &req.Basics
		state.Applications = append(state.Applications, Application{ID: newID(), Kind: "change", Status: "pending", Basics: req.Basics, Applicant: u.Sub, ApplicantName: u.Name, Reason: req.Reason, CreatedAt: time.Now().UTC()})
		return req.Reason, nil
	})
}

func (s *Service) decideApplication(c *gin.Context) {
	var req struct {
		Version  int    `json:"version"`
		Decision string `json:"decision"`
		Reason   string `json:"reason"`
	}
	if !decodeBody(c, &req) {
		return
	}
	s.mutate(c, "project.application.decide", func(tx *gorm.DB, p *model.Project, row model.Workflow, state *State, u model.User) (string, error) {
		if !dataManager(u) {
			return "", errPermission
		}
		if row.Version != req.Version {
			return "", errConflict
		}
		if (req.Decision != "approved" && req.Decision != "returned") || len([]rune(strings.TrimSpace(req.Reason))) < 2 || len([]rune(req.Reason)) > 300 {
			return "", errInvalid
		}
		index := -1
		for i := len(state.Applications) - 1; i >= 0; i-- {
			if state.Applications[i].ID == c.Param("applicationID") && state.Applications[i].Status == "pending" {
				index = i
				break
			}
		}
		if index < 0 {
			return "", gorm.ErrRecordNotFound
		}
		app := &state.Applications[index]
		if app.Kind == "initial" && p.Approval != "pending" || app.Kind == "change" && state.Draft == nil {
			return "", errConflict
		}
		app.Status = req.Decision
		app.Reviewer = u.Name
		app.ReviewReason = strings.TrimSpace(req.Reason)
		now := time.Now().UTC()
		app.ReviewedAt = &now
		if req.Decision == "approved" {
			for _, m := range state.Members {
				if !assigned(app.Basics, m.SessionID, m.PositionID) {
					return "", errInvalid
				}
			}
			state.Basics = app.Basics
			applyBasics(p, app.Basics)
			if app.Kind == "initial" {
				p.Approval = "approved"
				p.Status = "筹备"
			}
		}
		if app.Kind == "initial" && req.Decision == "returned" {
			p.Approval = "returned"
		}
		state.Draft = nil
		return req.Reason, nil
	})
}
