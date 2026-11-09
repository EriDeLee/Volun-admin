package activity

import (
	"crypto/subtle"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"volun-data/internal/errhandler"
	"volun-data/internal/model"
)

type publicBucket struct {
	At    time.Time
	Count int
}

var publicLimits = struct {
	sync.Mutex
	Entries map[string]publicBucket
}{Entries: map[string]publicBucket{}}

// PublicLimit bounds both request rate and limiter memory. Protected business
// operations still enforce their own version and identity checks.
func PublicLimit(c *gin.Context) {
	publicLimits.Lock()
	now := time.Now()
	key := c.RemoteIP()
	bucket := publicLimits.Entries[key]
	if now.Sub(bucket.At) > time.Minute {
		bucket = publicBucket{At: now}
	}
	bucket.Count++
	blocked := bucket.Count > 120
	if len(publicLimits.Entries) > 10000 {
		for k, v := range publicLimits.Entries {
			if now.Sub(v.At) > time.Minute {
				delete(publicLimits.Entries, k)
			}
		}
		if len(publicLimits.Entries) > 10000 {
			blocked = true
		}
	}
	publicLimits.Entries[key] = bucket
	publicLimits.Unlock()
	c.Header("Cache-Control", "no-store")
	c.Header("Referrer-Policy", "no-referrer")
	if blocked {
		c.AbortWithStatusJSON(429, gin.H{"errcode": 100005, "message": "请求过于频繁，请稍后重试", "data": nil})
		return
	}
	c.Next()
}

func sameToken(a, b string) bool {
	return len(a) == len(b) && subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
func formOpen(form Form) bool {
	if !form.Published || form.ID == "" {
		return false
	}
	if form.Deadline == "" {
		return true
	}
	end, err := time.Parse(time.RFC3339, form.Deadline)
	return err == nil && time.Now().Before(end)
}

func grantCookie(c *gin.Context, projectID, token string) {
	http.SetCookie(c.Writer, &http.Cookie{Name: "participant_" + projectID, Value: token, Path: "/api/v1/public/projects/" + projectID, HttpOnly: true, Secure: c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https", SameSite: http.SameSiteStrictMode, MaxAge: 180 * 24 * 3600})
}

func identifyMember(db *gorm.DB, c *gin.Context, p model.Project, state *State) (int, error) {
	u := actor(c)
	if u.Sub != "" {
		for i, m := range state.Members {
			if state.Bindings[m.ID] == u.Sub {
				return i, nil
			}
		}
	}
	if cookie, err := c.Cookie("participant_" + p.ID); err == nil {
		var grant model.ParticipantGrant
		if err := db.Where("digest=? AND project_id=? AND revoked_at IS NULL AND expires_at>?", tokenDigest(cookie), p.ID, time.Now().UTC()).First(&grant).Error; err == nil {
			for i, m := range state.Members {
				if m.ID == grant.MemberID {
					return i, nil
				}
			}
		}
	}
	return -1, errPermission
}

func (s *Service) publicContext(c *gin.Context) (model.Project, model.Workflow, State, error) {
	var p model.Project
	if err := s.DB.WithContext(c.Request.Context()).Where("id=? AND approval=?", c.Param("id"), "approved").First(&p).Error; err != nil {
		return p, model.Workflow{}, State{}, err
	}
	row, state, err := loadState(s.DB.WithContext(c.Request.Context()), p)
	return p, row, state, err
}

func (s *Service) publicForm(c *gin.Context) {
	p, _, state, err := s.publicContext(c)
	if err != nil {
		failWorkflow(c, err)
		return
	}
	form := state.Form
	kind := "recruit"
	if state.IntentForm.ID == c.Param("formID") {
		form = state.IntentForm
		kind = "intent"
	}
	if form.ID != c.Param("formID") || !formOpen(form) {
		failWorkflow(c, errClosed)
		return
	}
	errhandler.OK(c, gin.H{"project": p.Name, "form": form, "kind": kind, "sessions": state.Basics.Sessions})
}

func (s *Service) submitPublicForm(c *gin.Context) {
	var req struct {
		Member Member `json:"member"`
		Key    string `json:"key"`
	}
	if !decodeBody(c, &req) {
		return
	}
	if len(req.Key) < 16 || len(req.Key) > 80 {
		failWorkflow(c, errInvalid)
		return
	}
	normalizeMember(&req.Member)
	req.Member.Name = strings.TrimSpace(req.Member.Name)
	req.Member.Number = strings.TrimSpace(req.Member.Number)
	req.Member.Phone = strings.TrimSpace(req.Member.Phone)
	u := actor(c)
	// Authenticated identity comes exclusively from the server-side account.
	if u.Sub != "" {
		req.Member.Name = u.Name
		req.Member.Number = u.ID
	}
	var result Member
	credential := ""
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var p model.Project
		if err := tx.Where("id=? AND approval=?", c.Param("id"), "approved").First(&p).Error; err != nil {
			return err
		}
		row, state, err := loadState(tx, p)
		if err != nil {
			return err
		}
		if state.Form.ID != c.Param("formID") || !formOpen(state.Form) || p.Status != "筹备" && p.Status != "招募" {
			return errClosed
		}
		// The submission key grants retry access to this exact submission only.
		grantKey := tokenDigest("registration:" + p.ID + ":" + req.Key)
		var previous model.ParticipantGrant
		if err := tx.Where("digest=?", grantKey).First(&previous).Error; err == nil {
			if previous.RevokedAt != nil || !previous.ExpiresAt.After(time.Now()) {
				return errPermission
			}
			for _, m := range state.Members {
				if m.ID == previous.MemberID {
					if m.Name != req.Member.Name || m.Number != req.Member.Number || m.Department != req.Member.Department || m.Phone != req.Member.Phone || m.Notes != req.Member.Notes || !sameAssignments(m, req.Member) {
						return errConflict
					}
					result = m
					return nil
				}
			}
		}
		m := req.Member
		m.Name = strings.TrimSpace(m.Name)
		m.Number = strings.TrimSpace(m.Number)
		if m.Phone == "" || !validMember(m, state.Basics) || m.ID != "" || m.Intent != "" || m.Platform != "" {
			return errInvalid
		}
		for _, old := range state.Members {
			if old.Number == m.Number || u.Sub != "" && state.Bindings[old.ID] == u.Sub {
				return errConflict
			}
		}
		// All choices are validated and committed together under aggregate CAS.
		if !hasCapacity(m, state) {
			return errClosed
		}
		m.ID = newID()
		m.Source = "questionnaire"
		m.IdentitySource = "manual"
		m.IdentityVerified = false
		if u.Sub != "" {
			m.IdentitySource = "account"
			m.IdentityVerified = true
		}
		m.Intent = "未填写"
		state.Members = append(state.Members, m)
		if u.Sub != "" {
			state.Bindings[m.ID] = u.Sub
		}
		if err := tx.Create(&model.ParticipantGrant{Digest: grantKey, ProjectID: p.ID, MemberID: m.ID, ExpiresAt: time.Now().Add(180 * 24 * time.Hour)}).Error; err != nil {
			return errConflict
		}
		result = m
		return saveState(tx, p, row, state, model.User{Sub: u.Sub, Name: "本人登记"}, "form.response", "")
	})
	if err != nil {
		failWorkflow(c, err)
		return
	}
	// Derive the retry credential from a server-held seed-free random key chosen
	// by the client; the server stores only its scoped SHA-256 digest.
	credential = "registration:" + c.Param("id") + ":" + req.Key
	grantCookie(c, c.Param("id"), credential)
	errhandler.OK(c, gin.H{"member": result, "credential": credential})
}

func (s *Service) exchangeGrant(c *gin.Context) {
	var req struct {
		Credential string `json:"credential"`
	}
	if !decodeBody(c, &req) {
		return
	}
	var grant model.ParticipantGrant
	if len(req.Credential) > 256 || s.DB.WithContext(c.Request.Context()).Where("digest=? AND project_id=? AND revoked_at IS NULL AND expires_at>?", tokenDigest(req.Credential), c.Param("id"), time.Now().UTC()).First(&grant).Error != nil {
		failWorkflow(c, errPermission)
		return
	}
	grantCookie(c, c.Param("id"), req.Credential)
	errhandler.OK(c, gin.H{"verified": true})
}

func (s *Service) ownMember(c *gin.Context) {
	p, _, state, err := s.publicContext(c)
	if err != nil {
		failWorkflow(c, err)
		return
	}
	index, err := identifyMember(s.DB, c, p, &state)
	if err != nil {
		failWorkflow(c, err)
		return
	}
	m := state.Members[index]
	attendance := []Attendance{}
	hours := []Hour{}
	for _, a := range state.Attendance {
		if a.MemberID == m.ID {
			attendance = append(attendance, a)
		}
	}
	if state.Review.Published {
		for _, h := range state.Hours {
			if h.MemberID == m.ID {
				hours = append(hours, h)
			}
		}
	}
	errhandler.OK(c, gin.H{"member": m, "sessions": state.Basics.Sessions, "attendance": attendance, "hours": hours, "project": p.Name})
}

func (s *Service) updateOwnMember(c *gin.Context) {
	var req struct {
		Name        string        `json:"name"`
		Department  string        `json:"department"`
		Phone       string        `json:"phone"`
		Intent      string        `json:"intent"`
		Platform    string        `json:"platform"`
		Notes       string        `json:"notes"`
		Assignments *[]Assignment `json:"assignments"`
	}
	if !decodeBody(c, &req) {
		return
	}
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var p model.Project
		if err := tx.Where("id=? AND approval=?", c.Param("id"), "approved").First(&p).Error; err != nil {
			return err
		}
		row, state, err := loadState(tx, p)
		if err != nil {
			return err
		}
		i, err := identifyMember(tx, c, p, &state)
		if err != nil {
			return err
		}
		if p.Status == "审核" || p.Status == "通过" || p.Status == "驳回" {
			return errConflict
		}
		m := &state.Members[i]
		if req.Intent != "" {
			if !formOpen(state.IntentForm) {
				return errClosed
			}
			if req.Intent != "申请录入" && req.Intent != "不申请" && req.Intent != "待核实" || len([]rune(req.Platform)) > 120 {
				return errInvalid
			}
			m.Intent = req.Intent
			m.Platform = req.Platform
		} else {
			if !formOpen(state.Form) || p.Status != "招募" && p.Status != "筹备" {
				return errClosed
			}
			if m.IdentityVerified && req.Name != m.Name {
				return errInvalid
			}
			m.Name = req.Name
			m.Department = req.Department
			m.Phone = req.Phone
			m.Notes = req.Notes
			if req.Assignments != nil {
				if len(*req.Assignments) == 0 {
					return errInvalid
				}
				candidate := *m
				candidate.Assignments = *req.Assignments
				if !sameAssignments(*m, candidate) {
					for _, a := range state.Attendance {
						if a.MemberID == m.ID {
							return errConflict
						}
					}
					for _, h := range state.Hours {
						if h.MemberID == m.ID {
							return errConflict
						}
					}
					if !hasCapacity(candidate, state) {
						return errClosed
					}
				}
				m.Assignments = *req.Assignments
				normalizeMember(m)
			}
			if !validMember(*m, state.Basics) {
				return errInvalid
			}
		}
		return saveState(tx, p, row, state, model.User{Name: "本人修改"}, "member.self_update", "")
	})
	if err != nil {
		failWorkflow(c, err)
		return
	}
	s.ownMember(c)
}

func (s *Service) manageGrant(c *gin.Context) {
	var req struct {
		MemberID string `json:"member_id"`
		Username string `json:"username"`
		Revoke   bool   `json:"revoke"`
		Reason   string `json:"reason"`
	}
	if !decodeBody(c, &req) {
		return
	}
	credential := ""
	u := actor(c)
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		if !dataManager(u) {
			return errPermission
		}
		var p model.Project
		if err := tx.Where("id=?", c.Param("id")).First(&p).Error; err != nil {
			return err
		}
		if p.Approval == "draft" && !hasGroup(u, "super_admin") {
			return errPermission
		}
		row, state, err := loadState(tx, p)
		if err != nil {
			return err
		}
		if strings.TrimSpace(req.Reason) == "" {
			return errInvalid
		}
		version, parseErr := strconv.Atoi(c.GetHeader("X-Workflow-Version"))
		if parseErr != nil || version != row.Version {
			return errConflict
		}
		var member *Member
		for i, m := range state.Members {
			if m.ID == req.MemberID {
				member = &state.Members[i]
			}
		}
		if member == nil || member.IdentitySource == "account" {
			return errInvalid
		}
		if err := tx.Model(&model.ParticipantGrant{}).Where("project_id=? AND member_id=?", p.ID, req.MemberID).Update("revoked_at", time.Now().UTC()).Error; err != nil {
			return err
		}
		if req.Username != "" {
			var target model.User
			if err := tx.Where("username=? AND status=?", req.Username, "active").First(&target).Error; err != nil {
				return err
			}
			if member.Number != target.ID || member.Name != target.Name {
				return errInvalid
			}
			for memberID, subject := range state.Bindings {
				if subject == target.Sub && memberID != req.MemberID {
					return errConflict
				}
			}
			state.Bindings[req.MemberID] = target.Sub
		} else if req.Revoke {
			delete(state.Bindings, req.MemberID)
		} else if !req.Revoke {
			credential = newID() + newID()
			if err := tx.Create(&model.ParticipantGrant{Digest: tokenDigest(credential), ProjectID: p.ID, MemberID: req.MemberID, ExpiresAt: time.Now().Add(180 * 24 * time.Hour)}).Error; err != nil {
				return err
			}
		}
		member.IdentitySource = "manual"
		member.IdentityVerified = !req.Revoke
		return saveState(tx, p, row, state, u, "member.access", req.Reason)
	})
	if err != nil {
		failWorkflow(c, err)
		return
	}
	errhandler.OK(c, gin.H{"credential": credential})
}

func (s *Service) bindOwn(c *gin.Context) {
	var req struct{}
	if !decodeBody(c, &req) {
		return
	}
	u := actor(c)
	if u.Sub == "" {
		failWorkflow(c, errPermission)
		return
	}
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var p model.Project
		if err := tx.Where("id=? AND approval=?", c.Param("id"), "approved").First(&p).Error; err != nil {
			return err
		}
		row, state, err := loadState(tx, p)
		if err != nil {
			return err
		}
		i, err := identifyMember(tx, c, p, &state)
		if err != nil {
			return err
		}
		m := state.Members[i]
		if u.ID == "" || m.Number != u.ID || m.Name != u.Name {
			return errPermission
		}
		if bound := state.Bindings[m.ID]; bound != "" && bound != u.Sub {
			return errPermission
		}
		for id, sub := range state.Bindings {
			if sub == u.Sub && id != m.ID {
				return errConflict
			}
		}
		state.Bindings[m.ID] = u.Sub
		state.Members[i].IdentitySource = "account"
		state.Members[i].IdentityVerified = true
		return saveState(tx, p, row, state, u, "member.bind", "")
	})
	if err != nil {
		failWorkflow(c, err)
		return
	}
	s.ownMember(c)
}
