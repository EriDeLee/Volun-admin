package activity

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"volun-data/internal/errhandler"
	"volun-data/internal/model"
)

type Basics struct {
	Name        string    `json:"name"`
	Department  string    `json:"department"`
	StartsOn    string    `json:"starts_on"`
	EndsOn      string    `json:"ends_on"`
	Location    string    `json:"location"`
	Description string    `json:"description"`
	Sessions    []Session `json:"sessions"`
}

type Session struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Start     string     `json:"start"`
	End       string     `json:"end"`
	Positions []Position `json:"positions"`
}

type Position struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Capacity    int    `json:"capacity"`
	Description string `json:"description"`
	Hours       *int   `json:"hours"`
}

type Application struct {
	ID            string     `json:"id"`
	Kind          string     `json:"kind"`
	Status        string     `json:"status"`
	Basics        Basics     `json:"basics"`
	Applicant     string     `json:"-"`
	ApplicantName string     `json:"applicant"`
	Reviewer      string     `json:"reviewer"`
	Reason        string     `json:"reason"`
	ReviewReason  string     `json:"review_reason,omitempty"`
	ReviewedAt    *time.Time `json:"reviewed_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
}

type Assignment struct {
	SessionID  string `json:"session_id"`
	PositionID string `json:"position_id"`
}

type Member struct {
	ID          string       `json:"id"`
	UserSub     string       `json:"-"`
	Name        string       `json:"name"`
	Number      string       `json:"number"`
	Department  string       `json:"department"`
	Phone       string       `json:"phone"`
	SessionID   string       `json:"session_id"`
	PositionID  string       `json:"position_id"`
	Source      string       `json:"source"`
	Intent      string       `json:"intent"`
	Platform    string       `json:"platform"`
	Notes       string       `json:"notes"`
	Assignments []Assignment `json:"assignments,omitempty"`
}

// Internal bindings use a separate map so JSON responses never expose SSO subjects.
type State struct {
	Basics       Basics            `json:"basics"`
	Draft        *Basics           `json:"draft"`
	Applications []Application     `json:"applications"`
	Members      []Member          `json:"members"`
	Bindings     map[string]string `json:"bindings,omitempty"`
	Windows      []Window          `json:"windows"`
	Attendance   []Attendance      `json:"attendance"`
	Hours        []Hour            `json:"hours"`
	Form         Form              `json:"form"`
	IntentForm   Form              `json:"intent_form"`
	Material     Material          `json:"material"`
	Review       Review            `json:"review"`
	Legacy       bool              `json:"legacy"`
}

type Form struct {
	ID          string `json:"id"`
	Published   bool   `json:"published"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Deadline    string `json:"deadline"`
}

type Window struct {
	SessionID string `json:"session_id"`
	Action    string `json:"action"`
	Mode      string `json:"mode"`
	Open      bool   `json:"open"`
	Start     string `json:"start"`
	End       string `json:"end"`
	Token     string `json:"token"`
}

type Attendance struct {
	ID        string    `json:"id"`
	MemberID  string    `json:"member_id"`
	SessionID string    `json:"session_id"`
	Action    string    `json:"action"`
	Source    string    `json:"source"`
	Reason    string    `json:"reason"`
	Actor     string    `json:"actor"`
	At        time.Time `json:"at"`
}

type Hour struct {
	MemberID   string `json:"member_id"`
	Hours      *int   `json:"hours"`
	Recognized *int   `json:"recognized"`
	Reason     string `json:"reason"`
	Source     string `json:"source"`
}

type Review struct {
	ExternalResult string     `json:"external_result"`
	Opinion        string     `json:"opinion"`
	Published      bool       `json:"published"`
	Snapshot       string     `json:"snapshot"`
	ApprovedAt     *time.Time `json:"approved_at"`
}

type Material struct {
	Team              string   `json:"team"`
	Audience          string   `json:"audience"`
	RegistrationStart string   `json:"registration_start"`
	RegistrationEnd   string   `json:"registration_end"`
	CheckinRule       string   `json:"checkin_rule"`
	CheckinStart      string   `json:"checkin_start"`
	CheckinEnd        string   `json:"checkin_end"`
	MaxDailyHours     *int     `json:"max_daily_hours"`
	Recruitment       string   `json:"recruitment"`
	Password          string   `json:"password"`
	Guarantees        []string `json:"guarantees"`
	OtherGuarantee    string   `json:"other_guarantee"`
	Description       string   `json:"description"`
	ContactName       string   `json:"contact_name"`
	ContactPhone      string   `json:"contact_phone"`
	ContactMobile     string   `json:"contact_mobile"`
	ContactEmail      string   `json:"contact_email"`
	Notes             string   `json:"notes"`
	Training          string   `json:"training"`
}

var errConflict = errors.New("workflow: version conflict")
var errInvalid = errors.New("workflow: invalid operation")
var errPermission = errors.New("workflow: permission denied")
var errClosed = errors.New("workflow: window closed")

func newID() string {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(value[:])
}

func tokenDigest(value string) string {
	v := sha256.Sum256([]byte(value))
	return hex.EncodeToString(v[:])
}

func dataManager(u model.User) bool { return hasGroup(u, "super_admin") || hasGroup(u, "data_admin") }

func actor(c *gin.Context) model.User {
	u, _ := c.Get("user")
	value, _ := u.(model.User)
	return value
}

func decodeBody(c *gin.Context, target any) bool {
	if c.GetHeader("X-Requested-With") != "XMLHttpRequest" {
		errhandler.Fail(c, errhandler.CSRFValidationFailed)
		return false
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
	d := json.NewDecoder(c.Request.Body)
	d.DisallowUnknownFields()
	if d.Decode(target) != nil || d.Decode(new(any)) != io.EOF {
		errhandler.Fail(c, errhandler.InvalidArgument)
		return false
	}
	return true
}

func failWorkflow(c *gin.Context, err error) {
	code := errhandler.InternalError
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		code = errhandler.ResourceNotFound
	case errors.Is(err, errConflict):
		code = errhandler.VersionConflict
	case errors.Is(err, errPermission):
		code = errhandler.PermissionDenied
	case errors.Is(err, errInvalid):
		code = errhandler.InvalidArgument
	case errors.Is(err, errClosed):
		code = errhandler.QuestionnaireClosed
	}
	errhandler.Fail(c, code)
}

func initialState(p model.Project) State {
	return State{
		Basics:       Basics{Name: p.Name, Department: p.Department, StartsOn: p.StartsOn, EndsOn: p.EndsOn, Location: p.Location, Description: p.Description, Sessions: []Session{}},
		Applications: []Application{}, Members: []Member{}, Bindings: map[string]string{}, Windows: []Window{}, Attendance: []Attendance{}, Hours: []Hour{},
		Legacy: p.Status != "立项", Material: Material{Guarantees: []string{}},
	}
}

func loadState(db *gorm.DB, p model.Project) (model.Workflow, State, error) {
	row := model.Workflow{}
	err := db.Where("project_id = ?", p.ID).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.Workflow{ProjectID: p.ID}, initialState(p), nil
	}
	state := State{}
	if err == nil {
		err = json.Unmarshal([]byte(row.State), &state)
	}
	if state.Bindings == nil {
		state.Bindings = map[string]string{}
	}
	return row, state, err
}

func saveState(db *gorm.DB, p model.Project, row model.Workflow, state State, u model.User, action, reason string) error {
	encoded, err := json.Marshal(state)
	if err != nil {
		return err
	}
	if row.Version == 0 {
		if err := db.Create(&model.Workflow{ProjectID: p.ID, Version: 1, State: string(encoded)}).Error; err != nil {
			return errConflict
		}
	} else {
		result := db.Model(&model.Workflow{}).Where("project_id = ? AND version = ?", p.ID, row.Version).Updates(map[string]any{"state": string(encoded), "version": row.Version + 1})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errConflict
		}
	}
	if err := db.Model(&model.Project{}).Where("id = ?", p.ID).Updates(map[string]any{
		"name": p.Name, "department": p.Department, "starts_on": p.StartsOn, "ends_on": p.EndsOn, "location": p.Location,
		"description": p.Description, "status": p.Status, "approval": p.Approval, "updated_at": time.Now().UTC(),
	}).Error; err != nil {
		return err
	}
	return db.Create(&model.WorkflowEvent{ID: newID(), ProjectID: p.ID, Version: row.Version + 1, Action: action, Actor: u.Sub, ActorName: u.Name, Reason: reason, Snapshot: string(encoded), CreatedAt: time.Now().UTC()}).Error
}

// Project dates are Beijing calendar dates, independent of RFC3339 offsets.
var projectTimezone = time.FixedZone("Asia/Shanghai", 8*60*60)

func basicsValid(b Basics) bool {
	start, e1 := time.Parse(time.DateOnly, b.StartsOn)
	end, e2 := time.Parse(time.DateOnly, b.EndsOn)
	if strings.TrimSpace(b.Name) == "" || len([]rune(b.Name)) > 80 || strings.TrimSpace(b.Department) == "" || len([]rune(b.Department)) > 80 || strings.TrimSpace(b.Location) == "" || len([]rune(b.Location)) > 160 || len([]rune(b.Description)) > 2000 || e1 != nil || e2 != nil || end.Before(start) || len(b.Sessions) == 0 || len(b.Sessions) > 100 {
		return false
	}
	seen := map[string]bool{}
	for _, s := range b.Sessions {
		from, e1 := time.Parse(time.RFC3339, s.Start)
		to, e2 := time.Parse(time.RFC3339, s.End)
		if s.ID == "" || seen[s.ID] || len(s.ID) > 64 || strings.TrimSpace(s.Name) == "" || len([]rune(s.Name)) > 100 || e1 != nil || e2 != nil || !to.After(from) || from.In(projectTimezone).Format(time.DateOnly) < b.StartsOn || to.In(projectTimezone).Format(time.DateOnly) > b.EndsOn || len(s.Positions) == 0 || len(s.Positions) > 100 {
			return false
		}
		seen[s.ID] = true
		for _, pos := range s.Positions {
			if pos.ID == "" || len(pos.ID) > 64 || seen[pos.ID] || strings.TrimSpace(pos.Name) == "" || len([]rune(pos.Name)) > 100 || len([]rune(pos.Description)) > 2000 || pos.Capacity < 1 || pos.Capacity > 100000 || (pos.Hours != nil && (*pos.Hours < 0 || *pos.Hours > 100000)) {
				return false
			}
			seen[pos.ID] = true
		}
	}
	return true
}

func assigned(b Basics, sessionID, positionID string) bool {
	for _, s := range b.Sessions {
		if s.ID == sessionID {
			for _, p := range s.Positions {
				if p.ID == positionID {
					return true
				}
			}
		}
	}
	return false
}

func sessionExists(b Basics, id string) bool {
	for _, s := range b.Sessions {
		if s.ID == id {
			return true
		}
	}
	return false
}

func applyBasics(p *model.Project, b Basics) {
	p.Name = b.Name
	p.Department = b.Department
	p.StartsOn = b.StartsOn
	p.EndsOn = b.EndsOn
	p.Location = b.Location
	p.Description = b.Description
}
