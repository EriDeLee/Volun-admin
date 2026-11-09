package activity

import (
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	qrcode "github.com/skip2/go-qrcode"
	"gorm.io/gorm"
	"volun-data/internal/errhandler"
	"volun-data/internal/model"
)

func windowOpen(w Window) bool {
	if w.Mode == "manual" {
		return w.Open
	}
	start, e1 := time.Parse(time.RFC3339, w.Start)
	end, e2 := time.Parse(time.RFC3339, w.End)
	return w.Mode == "scheduled" && e1 == nil && e2 == nil && !time.Now().Before(start) && time.Now().Before(end)
}
func findWindow(state State, sessionID, action string) (Window, bool) {
	for _, w := range state.Windows {
		if w.SessionID == sessionID && w.Action == action {
			return w, true
		}
	}
	return Window{}, false
}

func (s *Service) manageWindow(c *gin.Context) {
	var req Window
	if !decodeBody(c, &req) {
		return
	}
	s.mutate(c, "attendance.window", func(tx *gorm.DB, p *model.Project, row model.Workflow, state *State, u model.User) (string, error) {
		if p.Approval != "approved" || p.Status == "通过" || p.Status == "审核" || p.Status == "驳回" {
			return "", errConflict
		}
		if !sessionExists(state.Basics, req.SessionID) || req.Action != "checkin" && req.Action != "checkout" || req.Mode != "manual" && req.Mode != "scheduled" {
			return "", errInvalid
		}
		if req.Mode == "scheduled" {
			start, e1 := time.Parse(time.RFC3339, req.Start)
			end, e2 := time.Parse(time.RFC3339, req.End)
			if e1 != nil || e2 != nil || !end.After(start) {
				return "", errInvalid
			}
		}
		req.Token = newID() + newID() // Any reconfiguration revokes the previous QR.
		for i, w := range state.Windows {
			if w.SessionID == req.SessionID && w.Action == req.Action {
				state.Windows[i] = req
				return "", nil
			}
		}
		state.Windows = append(state.Windows, req)
		return "", nil
	})
}

func recordFact(state *State, m Member, action, source, reason, actorName string, correction bool) (Attendance, bool, error) {
	if action != "checkin" && action != "checkout" && action != "absent" {
		return Attendance{}, false, errInvalid
	}
	latest := ""
	var previous Attendance
	for _, a := range state.Attendance {
		if a.MemberID == m.ID && a.SessionID == m.SessionID {
			latest = a.Action
			if a.Action == action {
				previous = a
			}
		}
	}
	if !correction && previous.ID != "" {
		return previous, false, nil
	}
	if action == "checkout" && latest != "checkin" {
		return Attendance{}, false, errInvalid
	}
	if action == "absent" && latest != "" && !correction {
		return Attendance{}, false, errConflict
	}
	if correction && strings.TrimSpace(reason) == "" {
		return Attendance{}, false, errInvalid
	}
	entry := Attendance{ID: newID(), MemberID: m.ID, SessionID: m.SessionID, Action: action, Source: source, Reason: reason, Actor: actorName, At: time.Now().UTC()}
	state.Attendance = append(state.Attendance, entry)
	return entry, true, nil
}

func (s *Service) staffAttendance(c *gin.Context) {
	var req struct {
		MemberID   string `json:"member_id"`
		Action     string `json:"action"`
		Reason     string `json:"reason"`
		Correction bool   `json:"correction"`
	}
	if !decodeBody(c, &req) {
		return
	}
	s.mutate(c, "attendance.staff", func(tx *gorm.DB, p *model.Project, row model.Workflow, state *State, u model.User) (string, error) {
		if p.Approval != "approved" || p.Status == "通过" || p.Status == "审核" || p.Status == "驳回" {
			return "", errConflict
		}
		var member Member
		for _, m := range state.Members {
			if m.ID == req.MemberID {
				member = m
			}
		}
		if member.ID == "" || !memberAssigned(member, c.Param("sessionID")) {
			return "", errInvalid
		}
		member.SessionID = c.Param("sessionID")
		w, ok := findWindow(*state, member.SessionID, req.Action)
		if req.Action == "absent" {
			w, ok = findWindow(*state, member.SessionID, "checkin")
		}
		if req.Correction || !ok || !windowOpen(w) {
			if !dataManager(u) {
				return "", errPermission
			}
			if strings.TrimSpace(req.Reason) == "" {
				return "", errInvalid
			}
			req.Correction = true
		}
		_, _, err := recordFact(state, member, req.Action, "staff", req.Reason, u.Name, req.Correction)
		return req.Reason, err
	})
}

func (s *Service) scanContext(c *gin.Context) {
	p, _, state, err := s.publicContext(c)
	if err != nil {
		failWorkflow(c, err)
		return
	}
	var w Window
	found := false
	for _, candidate := range state.Windows {
		if sameToken(candidate.Token, c.Query("token")) && candidate.SessionID == c.Param("sessionID") {
			w = candidate
			found = true
		}
	}
	if !found || !windowOpen(w) {
		failWorkflow(c, errClosed)
		return
	}
	var member *Member
	if i, e := identifyMember(s.DB, c, p, &state); e == nil && memberAssigned(state.Members[i], w.SessionID) {
		value := state.Members[i]
		member = &value
	}
	errhandler.OK(c, gin.H{"project": p.Name, "session_id": w.SessionID, "action": w.Action, "member": member})
}

func (s *Service) scanAttendance(c *gin.Context) {
	var req struct {
		Token string `json:"token"`
	}
	if !decodeBody(c, &req) {
		return
	}
	result := Attendance{}
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var p model.Project
		if err := tx.Where("id=? AND approval=?", c.Param("id"), "approved").First(&p).Error; err != nil {
			return err
		}
		row, state, err := loadState(tx, p)
		if err != nil {
			return err
		}
		if p.Status == "审核" || p.Status == "通过" || p.Status == "驳回" {
			return errClosed
		}
		index, err := identifyMember(tx, c, p, &state)
		if err != nil {
			return err
		}
		m := state.Members[index]
		if !memberAssigned(m, c.Param("sessionID")) {
			return errPermission
		}
		m.SessionID = c.Param("sessionID")
		for _, w := range state.Windows {
			if w.SessionID == m.SessionID && sameToken(w.Token, req.Token) && windowOpen(w) {
				entry, changed, err := recordFact(&state, m, w.Action, "scan", "", "本人", false)
				if err != nil {
					return err
				}
				result = entry
				if !changed {
					return nil
				}
				return saveState(tx, p, row, state, model.User{Name: "本人扫码"}, "attendance."+w.Action, "")
			}
		}
		return errClosed
	})
	if err != nil {
		failWorkflow(c, err)
		return
	}
	errhandler.OK(c, result)
}

func (s *Service) qrCode(c *gin.Context) {
	p, err := s.getProject(c, false)
	if err != nil {
		failWorkflow(c, err)
		return
	}
	_, state, err := loadState(s.DB, p)
	if err != nil {
		failWorkflow(c, err)
		return
	}
	query := url.Values{"project": {p.ID}}
	if c.Param("sessionID") != "" {
		w, ok := findWindow(state, c.Param("sessionID"), c.Param("action"))
		if !ok {
			failWorkflow(c, errClosed)
			return
		}
		query.Set("attendance", w.SessionID)
		query.Set("token", w.Token)
	} else {
		if !dataManager(actor(c)) {
			failWorkflow(c, errPermission)
			return
		}
		form := state.Form
		if c.Query("kind") == "intent" {
			form = state.IntentForm
		}
		if form.ID == "" {
			failWorkflow(c, errInvalid)
			return
		}
		query.Set("form", form.ID)
	}
	// Public origin is configured by the reverse proxy/host, never supplied in a URL parameter.
	scheme := "http"
	if c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	host := c.Request.Host
	if strings.ContainsAny(host, "\r\n/\\") {
		failWorkflow(c, errInvalid)
		return
	}
	link := fmt.Sprintf("%s://%s/signup?%s", scheme, host, query.Encode())
	data, err := qrcode.Encode(link, qrcode.Medium, 512)
	if err != nil {
		failWorkflow(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.Data(200, "image/png", data)
}
