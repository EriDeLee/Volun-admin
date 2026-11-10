package activity

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"volun-data/internal/errhandler"
	"volun-data/internal/model"
)

func capabilities(u model.User, p model.Project, state State) []string {
	result := []string{"read", "members.read"}
	staff := hasGroup(u, "activity_admin") && p.CreatedBy == u.Sub || hasGroup(u, "super_admin")
	if staff || dataManager(u) {
		result = append(result, "basics.edit")
	}
	if staff {
		result = append(result, "proposal.submit")
	}
	if dataManager(u) {
		result = append(result, "proposal.review")
	}
	if p.Approval == "approved" {
		result = append(result, "materials.read")
		if dataManager(u) {
			result = append(result, "workflow.write", "export")
		}
		if p.Status != "审核" && p.Status != "通过" && p.Status != "驳回" {
			if preparationConfirmed(p) {
				result = append(result, "attendance.manage")
			}
			if dataManager(u) {
				result = append(result, "members.write", "forms.write", "materials.write")
				if hoursAvailable(p, state.Basics, time.Now()) {
					result = append(result, "hours.write")
				}
			}
		}
	}
	return result
}

func dataEditable(p *model.Project, u model.User) error {
	if !dataManager(u) {
		return errPermission
	}
	if p.Approval != "approved" {
		return errInvalid
	}
	if p.Status == "通过" || p.Status == "驳回" || p.Status == "审核" {
		return errConflict
	}
	return nil
}

func validMember(m Member, b Basics) bool {
	return strings.TrimSpace(m.Name) != "" && len([]rune(m.Name)) <= 80 && strings.TrimSpace(m.Number) != "" && len(m.Number) <= 120 && len([]rune(m.Department)) <= 100 && len(m.Phone) <= 50 && len([]rune(m.Notes)) <= 1000 && assignmentsValid(m, b)
}

// memberCandidates exposes only volunteer fields within an editable project.
func (s *Service) memberCandidates(c *gin.Context) {
	p, err := s.getProject(c, true)
	if err == nil {
		err = dataEditable(&p, actor(c))
	}
	if err != nil {
		failWorkflow(c, err)
		return
	}
	q := strings.TrimSpace(c.Query("q"))
	if utf8.RuneCountInString(q) > 160 {
		failWorkflow(c, errInvalid)
		return
	}
	type candidate struct {
		Username string `json:"username"`
		Name     string `json:"name"`
		Number   string `json:"number" gorm:"column:id"`
		Phone    string `json:"phone"`
	}
	items := []candidate{}
	if q != "" {
		like := "%" + strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(q) + "%"
		err = s.DB.WithContext(c.Request.Context()).Model(&model.User{}).
			Select("username, name, id, phone").Where("status = ? AND name <> '' AND id <> ''", "active").
			Where("(name LIKE ? ESCAPE '!' OR id LIKE ? ESCAPE '!' OR username LIKE ? ESCAPE '!')", like, like, like).
			Order("id, username").Limit(20).Scan(&items).Error
		if err != nil {
			failWorkflow(c, err)
			return
		}
	}
	c.Header("Cache-Control", "no-store")
	errhandler.OK(c, gin.H{"items": items})
}

func (s *Service) saveMembers(c *gin.Context) {
	var req struct {
		Members []struct {
			Member
			AccountUsername string `json:"account_username"`
		} `json:"members"`
		Reason string `json:"reason"`
	}
	if !decodeBody(c, &req) {
		return
	}
	if len(req.Members) == 0 || len(req.Members) > 500 {
		failWorkflow(c, errInvalid)
		return
	}
	for i := range req.Members {
		normalizeMember(&req.Members[i].Member)
	}
	s.mutate(c, "members.save", func(tx *gorm.DB, p *model.Project, row model.Workflow, state *State, u model.User) (string, error) {
		if err := dataEditable(p, u); err != nil {
			return "", err
		}
		seen := map[string]bool{}
		accountSubs := map[int]string{}
		for i := range req.Members {
			input := &req.Members[i]
			if input.AccountUsername != "" {
				if input.ID != "" {
					return "", errInvalid
				}
				var users []model.User
				if err := tx.Where("username=? AND status=?", input.AccountUsername, "active").Limit(2).Find(&users).Error; err != nil {
					return "", err
				}
				if len(users) != 1 || users[0].Name == "" || users[0].ID == "" {
					return "", errInvalid
				}
				u := users[0]
				input.Name, input.Number, input.Phone = u.Name, u.ID, u.Phone
				accountSubs[i] = u.Sub
				for _, sub := range state.Bindings {
					if sub == u.Sub {
						return "", errConflict
					}
				}
			}
			m := input.Member
			if !validMember(m, state.Basics) || seen[m.Number] {
				return "", errInvalid
			}
			seen[m.Number] = true
			for _, old := range state.Members {
				if old.Number == m.Number && old.ID != m.ID {
					return "", errConflict
				}
			}
		}
		for index, input := range req.Members {
			m := input.Member
			found := false
			for i, old := range state.Members {
				if old.ID == m.ID && m.ID != "" {
					if old.IdentityVerified && (old.Name != m.Name || old.Number != m.Number) {
						return "", errInvalid
					}
					// An attendance/hour fact may never be moved to another identity or assignment.
					if old.Number != m.Number || !sameAssignments(old, m) {
						for _, a := range state.Attendance {
							if a.MemberID == m.ID {
								return "", errConflict
							}
						}
						for _, h := range state.Hours {
							if h.MemberID == m.ID {
								return "", errConflict
							}
						}
						if state.Bindings[m.ID] != "" {
							return "", errConflict
						}
					}
					m.Source = old.Source
					m.IdentitySource = old.IdentitySource
					m.IdentityVerified = old.IdentityVerified
					m.Intent = old.Intent
					m.Platform = old.Platform
					state.Members[i] = m
					found = true
					break
				}
			}
			if !found {
				if m.ID != "" {
					return "", errInvalid
				}
				m.ID = newID()
				m.Source = "manual"
				m.IdentitySource = "manual"
				m.IdentityVerified = false
				if sub := accountSubs[index]; sub != "" {
					m.IdentitySource = "account"
					m.IdentityVerified = true
					state.Bindings[m.ID] = sub
				}
				m.Intent = "未填写"
				state.Members = append(state.Members, m)
			}
		}
		return req.Reason, nil
	})
}

func (s *Service) deleteMember(c *gin.Context) {
	var req struct{}
	if !decodeBody(c, &req) {
		return
	}
	s.mutate(c, "members.delete", func(tx *gorm.DB, p *model.Project, row model.Workflow, state *State, u model.User) (string, error) {
		if err := dataEditable(p, u); err != nil {
			return "", err
		}
		id := c.Param("memberID")
		for i, m := range state.Members {
			if m.ID != id {
				continue
			}
			for _, a := range state.Attendance {
				if a.MemberID == id {
					return "", errMemberHasRecords
				}
			}
			for _, h := range state.Hours {
				if h.MemberID == id {
					return "", errMemberHasRecords
				}
			}
			if err := tx.Model(&model.ParticipantGrant{}).Where("project_id=? AND member_id=? AND revoked_at IS NULL", p.ID, id).Update("revoked_at", time.Now().UTC()).Error; err != nil {
				return "", err
			}
			state.Members = append(state.Members[:i], state.Members[i+1:]...)
			delete(state.Bindings, id)
			return fmt.Sprintf("删除成员：%s（%s），成员ID：%s", m.Name, m.Number, id), nil
		}
		return "", gorm.ErrRecordNotFound
	})
}

func (s *Service) saveForm(c *gin.Context) {
	var req struct {
		Kind        string `json:"kind"`
		Published   bool   `json:"published"`
		Title       string `json:"title"`
		Description string `json:"description"`
		Deadline    string `json:"deadline"`
		Rotate      bool   `json:"rotate"`
	}
	if !decodeBody(c, &req) {
		return
	}
	s.mutate(c, "form.configure", func(tx *gorm.DB, p *model.Project, row model.Workflow, state *State, u model.User) (string, error) {
		if err := dataEditable(p, u); err != nil {
			return "", err
		}
		if req.Kind != "recruit" && req.Kind != "intent" || len([]rune(req.Title)) > 100 || len([]rune(req.Description)) > 2000 {
			return "", errInvalid
		}
		if req.Deadline != "" {
			if _, err := time.Parse(time.RFC3339, req.Deadline); err != nil {
				return "", errInvalid
			}
		}
		form := &state.Form
		if req.Kind == "intent" {
			form = &state.IntentForm
		}
		if form.ID == "" || req.Rotate {
			form.ID = newID()
		}
		form.Published = req.Published
		form.Title = req.Title
		form.Description = req.Description
		form.Deadline = req.Deadline
		return "", nil
	})
}

func (s *Service) saveHours(c *gin.Context) {
	var req struct {
		Rows []Hour `json:"rows"`
	}
	if !decodeBody(c, &req) {
		return
	}
	if len(req.Rows) == 0 || len(req.Rows) > 500 {
		failWorkflow(c, errInvalid)
		return
	}
	s.mutate(c, "hours.save", func(tx *gorm.DB, p *model.Project, row model.Workflow, state *State, u model.User) (string, error) {
		if err := dataEditable(p, u); err != nil {
			return "", err
		}
		if !hoursAvailable(*p, state.Basics, time.Now()) {
			return "", errHoursNotReady
		}
		seen := map[string]bool{}
		for _, h := range req.Rows {
			if h.Hours == nil || *h.Hours < 0 || *h.Hours > 100000 || seen[h.MemberID] || h.Recognized != nil {
				return "", errInvalid
			}
			seen[h.MemberID] = true
			found := false
			for _, m := range state.Members {
				if m.ID == h.MemberID {
					found = true
				}
			}
			if !found {
				return "", errInvalid
			}
			if h.Source != "登记" && h.Source != "补录" && h.Source != "更正" {
				return "", errInvalid
			}
			if h.Source != "登记" && strings.TrimSpace(h.Reason) == "" {
				return "", errInvalid
			}
		}
		for _, h := range req.Rows {
			found := false
			for i, old := range state.Hours {
				if old.MemberID == h.MemberID {
					if strings.TrimSpace(h.Reason) == "" {
						return "", errInvalid
					}
					state.Hours[i] = h
					found = true
					break
				}
			}
			if !found {
				state.Hours = append(state.Hours, h)
			}
		}
		state.Review.Published = false
		state.Review.Snapshot = ""
		return "", nil
	})
}

func (s *Service) transition(c *gin.Context) {
	var req struct {
		Status         string `json:"status"`
		Reason         string `json:"reason"`
		ExternalResult string `json:"external_result"`
	}
	if !decodeBody(c, &req) {
		return
	}
	s.mutate(c, "workflow.transition", func(tx *gorm.DB, p *model.Project, row model.Workflow, state *State, u model.User) (string, error) {
		if !dataManager(u) {
			return "", errPermission
		}
		if p.Approval != "approved" || strings.TrimSpace(req.Reason) == "" || len([]rune(req.Reason)) > 1000 {
			return "", errInvalid
		}
		current, target := -1, -1
		for i, v := range statuses {
			if p.Status == v {
				current = i
			}
			if req.Status == v {
				target = i
			}
		}
		if current < 0 || target < 1 {
			return "", errInvalid
		}
		reopen := (p.Status == "通过" || p.Status == "驳回") && (req.Status == "统计" || req.Status == "数据")
		back := p.Status == "审核" && (req.Status == "统计" || req.Status == "数据" || req.Status == "录入")
		confirmPreparation := (p.Status == "筹备" || p.Status == "招募") && req.Status == "进行"
		if !reopen && !back && !confirmPreparation && !(target == current+1 && current < 10) && !(p.Status == "审核" && req.Status == "驳回") {
			return "", errInvalid
		}
		if confirmPreparation {
			if len(state.Members) == 0 || !basicsValid(state.Basics) {
				return "", errInvalid
			}
			var generated int64
			if err := tx.Model(&model.MaterialVersion{}).Where("project_id=?", p.ID).Count(&generated).Error; err != nil {
				return "", err
			}
			if generated == 0 {
				return "", errInvalid
			}
		}
		if req.Status == "统计" || req.Status == "审核" || req.Status == "通过" {
			for _, m := range state.Members {
				if m.Intent == "申请录入" {
					found := false
					for _, h := range state.Hours {
						if h.MemberID == m.ID && h.Hours != nil {
							found = true
						}
					}
					if !found {
						return "", errInvalid
					}
				}
			}
		}
		if req.Status == "审核" {
			if strings.TrimSpace(req.ExternalResult) == "" && state.Review.ExternalResult == "" {
				return "", errInvalid
			}
			if req.ExternalResult != "" {
				state.Review.ExternalResult = req.ExternalResult
			}
		}
		if req.Status == "通过" {
			for i := range state.Hours {
				for _, m := range state.Members {
					if m.ID == state.Hours[i].MemberID && m.Intent == "申请录入" {
						hours := *state.Hours[i].Hours
						state.Hours[i].Recognized = &hours
					}
				}
			}
			now := time.Now().UTC()
			state.Review.ApprovedAt = &now
			state.Review.Published = true
		}
		if reopen {
			state.Review.Published = false
			for i := range state.Hours {
				state.Hours[i].Recognized = nil
			}
		}
		if req.Status == "统计" || req.Status == "审核" || req.Status == "通过" {
			snapshot, _ := json.Marshal(struct {
				Members []Member `json:"members"`
				Hours   []Hour   `json:"hours"`
			}{Members: state.Members, Hours: state.Hours})
			state.Review.Snapshot = string(snapshot)
		}
		state.Review.Opinion = req.Reason
		p.Status = req.Status
		return req.Reason, nil
	})
}

func (s *Service) history(c *gin.Context) {
	p, err := s.getProject(c, false)
	if err != nil {
		failWorkflow(c, err)
		return
	}
	events := []model.WorkflowEvent{}
	files := []model.MaterialVersion{}
	if err := s.DB.WithContext(c.Request.Context()).Where("project_id=?", p.ID).Order("version DESC").Find(&events).Error; err != nil {
		failWorkflow(c, err)
		return
	}
	if err := s.DB.WithContext(c.Request.Context()).Omit("data").Where("project_id=?", p.ID).Order("created_at DESC").Find(&files).Error; err != nil {
		failWorkflow(c, err)
		return
	}
	errhandler.OK(c, map[string]any{"events": events, "materials": files})
}

func (s *Service) exportMembers(c *gin.Context) {
	p, err := s.getProject(c, false)
	if err != nil {
		failWorkflow(c, err)
		return
	}
	u := actor(c)
	if !dataManager(u) {
		failWorkflow(c, errPermission)
		return
	}
	row, state, err := loadState(s.DB, p)
	if err != nil {
		failWorkflow(c, err)
		return
	}
	var out strings.Builder
	out.WriteString("\ufeff")
	writer := csv.NewWriter(&out)
	_ = writer.Write([]string{"姓名", "人员编号", "部门", "电话", "场次", "岗位", "备注", "登记小时", "认定小时"})
	for _, m := range state.Members {
		hours, recognized := "", ""
		for _, h := range state.Hours {
			if h.MemberID == m.ID {
				if h.Hours != nil {
					hours = fmt.Sprint(*h.Hours)
				}
				if h.Recognized != nil {
					recognized = fmt.Sprint(*h.Recognized)
				}
			}
		}
		sessionNames, positionNames := []string{}, []string{}
		seen := map[string]bool{}
		for _, choice := range memberAssignments(m) {
			for _, session := range state.Basics.Sessions {
				if session.ID != choice.SessionID {
					continue
				}
				if !seen[session.ID] {
					sessionNames = append(sessionNames, session.Name)
					seen[session.ID] = true
				}
				for _, position := range session.Positions {
					if position.ID == choice.PositionID {
						positionNames = append(positionNames, session.Name+" / "+position.Name)
					}
				}
			}
		}
		values := []string{m.Name, m.Number, m.Department, m.Phone, strings.Join(sessionNames, "、"), strings.Join(positionNames, "；"), m.Notes, hours, recognized}
		for i, v := range values {
			if strings.HasPrefix(strings.TrimSpace(v), "=") || strings.HasPrefix(strings.TrimSpace(v), "+") || strings.HasPrefix(strings.TrimSpace(v), "-") || strings.HasPrefix(strings.TrimSpace(v), "@") {
				values[i] = "'" + v
			}
		}
		_ = writer.Write(values)
	}
	writer.Flush()
	if err := s.DB.Create(&model.WorkflowEvent{ID: newID(), ProjectID: p.ID, Version: row.Version, Action: "members.export", Actor: u.Sub, ActorName: u.Name, CreatedAt: time.Now().UTC()}).Error; err != nil {
		failWorkflow(c, err)
		return
	}
	c.Header("Content-Disposition", "attachment; filename=members.csv")
	c.Data(200, "text/csv; charset=utf-8", []byte(out.String()))
}
