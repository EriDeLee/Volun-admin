// Package admin implements account directory and super-admin account operations.
package admin

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"volun-data/internal/dto"
	"volun-data/internal/errhandler"
	"volun-data/internal/model"
)

type Service struct{ DB *gorm.DB }

var allowedGroups = []string{"super_admin", "data_admin", "activity_admin", "formal_user"}
var allowedStatus = []string{"active", "disabled"}

func hasGroup(u model.User, group string) bool {
	for _, g := range strings.Split(u.Groups, ",") {
		if g == group {
			return true
		}
	}
	return false
}

func parseGroups(raw string) []string {
	if raw == "" {
		return []string{}
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func normalizeGroups(groups []string) ([]string, bool) {
	seen := map[string]bool{}
	out := make([]string, 0, len(groups))
	for _, g := range groups {
		g = strings.TrimSpace(g)
		if g == "" {
			continue
		}
		valid := false
		for _, known := range allowedGroups {
			if g == known {
				valid = true
				break
			}
		}
		if !valid {
			return nil, false
		}
		if !seen[g] {
			seen[g] = true
			out = append(out, g)
		}
	}
	if len(out) == 0 {
		return nil, false
	}
	// Stable order matching the fixed group dictionary.
	ordered := make([]string, 0, len(out))
	for _, known := range allowedGroups {
		if seen[known] {
			ordered = append(ordered, known)
		}
	}
	return ordered, true
}

func userJSON(u model.User) dto.AdminUserResponse {
	return dto.AdminUserResponse{
		Username:              u.Username,
		Name:                  u.Name,
		ID:                    u.ID,
		Phone:                 u.Phone,
		Groups:                parseGroups(u.Groups),
		Status:                u.Status,
		PasswordSetupRequired: u.PasswordSetupRequired,
		HasPassword:           u.PasswordHash != "",
		CreatedAt:             u.CreatedAt,
		UpdatedAt:             u.UpdatedAt,
	}
}

// RequireDirectory allows administrators to read the account directory.
func RequireDirectory(c *gin.Context) {
	u, ok := c.MustGet("user").(model.User)
	if !ok || !hasGroup(u, "super_admin") && !hasGroup(u, "data_admin") {
		errhandler.Fail(c, errhandler.PermissionDenied)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.Next()
}

// RequireSuperAdmin runs after authentication and initial-password enforcement.
func RequireSuperAdmin(c *gin.Context) {
	u, ok := c.MustGet("user").(model.User)
	if !ok || !hasGroup(u, "super_admin") {
		errhandler.Fail(c, errhandler.PermissionDenied)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.Next()
}

func (s *Service) ListUsers(c *gin.Context) {
	qText := strings.TrimSpace(c.Query("q"))
	status := strings.TrimSpace(c.Query("status"))
	group := strings.TrimSpace(c.Query("group"))
	page, pageErr := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, sizeErr := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if pageErr != nil || sizeErr != nil || page < 1 || page > 1_000_000 || pageSize < 1 || pageSize > 100 || utf8.RuneCountInString(qText) > 160 {
		errhandler.Fail(c, errhandler.InvalidArgument)
		return
	}
	if status != "" {
		ok := false
		for _, known := range allowedStatus {
			if status == known {
				ok = true
				break
			}
		}
		if !ok {
			errhandler.Fail(c, errhandler.InvalidArgument)
			return
		}
	}
	if group != "" {
		ok := false
		for _, known := range allowedGroups {
			if group == known {
				ok = true
				break
			}
		}
		if !ok {
			errhandler.Fail(c, errhandler.InvalidArgument)
			return
		}
	}

	data := dto.AdminUserListResponse{
		Items: []dto.AdminUserResponse{}, Page: page, PageSize: pageSize,
	}
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		base := tx.Model(&model.User{})
		var statusCounts []struct {
			Status string
			Count  int64
		}
		if err := base.Select("status, COUNT(*) AS count").Group("status").Scan(&statusCounts).Error; err != nil {
			return err
		}
		for _, row := range statusCounts {
			data.Summary.UserCount += row.Count
			switch row.Status {
			case "active":
				data.Summary.ActiveCount = row.Count
			case "disabled":
				data.Summary.DisabledCount = row.Count
			}
		}
		var managerUsers []model.User
		if err := tx.Model(&model.User{}).Select("groups").Find(&managerUsers).Error; err != nil {
			return err
		}
		managerCount := int64(0)
		for _, user := range managerUsers {
			for _, group := range parseGroups(user.Groups) {
				if group == "super_admin" || group == "data_admin" || group == "activity_admin" {
					managerCount++
					break
				}
			}
		}
		data.Summary.ManagerCount = managerCount

		filtered := tx.Model(&model.User{})
		if qText != "" {
			text := strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(qText)
			like := "%" + text + "%"
			filtered = filtered.Where("(username LIKE ? ESCAPE '!' OR name LIKE ? ESCAPE '!' OR id LIKE ? ESCAPE '!' OR phone LIKE ? ESCAPE '!')", like, like, like, like)
		}
		if status != "" {
			filtered = filtered.Where("status = ?", status)
		}
		if group != "" {
			filtered = filtered.Where("(',' || groups || ',') LIKE ?", "%,"+group+",%")
		}
		if err := filtered.Count(&data.Total).Error; err != nil {
			return err
		}
		var rows []model.User
		if err := filtered.
			Order("updated_at DESC, username ASC").
			Offset((page - 1) * pageSize).
			Limit(pageSize).
			Find(&rows).Error; err != nil {
			return err
		}
		for _, u := range rows {
			data.Items = append(data.Items, userJSON(u))
		}
		return nil
	})
	if err != nil {
		errhandler.Fail(c, errhandler.InternalError)
		return
	}
	errhandler.OK(c, data)
}

func (s *Service) UpdateUser(c *gin.Context) {
	if c.GetHeader("X-Requested-With") != "XMLHttpRequest" {
		errhandler.Fail(c, errhandler.CSRFValidationFailed)
		return
	}
	username := strings.TrimSpace(c.Param("username"))
	if username == "" || utf8.RuneCountInString(username) > 120 || strings.ContainsAny(username, "/\\") {
		errhandler.Fail(c, errhandler.InvalidArgument)
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
	var req dto.UpdateAdminUserRequest
	decoder := json.NewDecoder(c.Request.Body)
	if decoder.Decode(&req) != nil {
		errhandler.Fail(c, errhandler.InvalidArgument)
		return
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		errhandler.Fail(c, errhandler.InvalidArgument)
		return
	}
	if req.Status == nil && req.Groups == nil && req.Phone == nil {
		errhandler.Fail(c, errhandler.InvalidArgument)
		return
	}

	actor := c.MustGet("user").(model.User)
	var target model.User
	if err := s.DB.WithContext(c.Request.Context()).Where("username = ?", username).First(&target).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			errhandler.Fail(c, errhandler.ResourceNotFound)
		} else {
			errhandler.Fail(c, errhandler.InternalError)
		}
		return
	}

	updates := map[string]any{}
	if req.Phone != nil {
		phone, ok := model.NormalizePhone(*req.Phone)
		if !ok {
			errhandler.Fail(c, errhandler.InvalidArgument)
			return
		}
		updates["phone"] = phone
	}
	if req.Status != nil {
		status := strings.TrimSpace(*req.Status)
		ok := false
		for _, known := range allowedStatus {
			if status == known {
				ok = true
				break
			}
		}
		if !ok {
			errhandler.Fail(c, errhandler.InvalidArgument)
			return
		}
		if target.Sub == actor.Sub && status == "disabled" {
			errhandler.Fail(c, errhandler.InvalidArgument)
			return
		}
		updates["status"] = status
	}
	if req.Groups != nil {
		groups, ok := normalizeGroups(req.Groups)
		if !ok {
			errhandler.Fail(c, errhandler.InvalidArgument)
			return
		}
		if target.Sub == actor.Sub {
			keepSuper := false
			for _, g := range groups {
				if g == "super_admin" {
					keepSuper = true
					break
				}
			}
			if !keepSuper {
				errhandler.Fail(c, errhandler.InvalidArgument)
				return
			}
		}
		updates["groups"] = strings.Join(groups, ",")
	}
	if len(updates) == 0 {
		errhandler.Fail(c, errhandler.InvalidArgument)
		return
	}
	updates["updated_at"] = time.Now().UTC()

	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		if phone, ok := updates["phone"].(string); ok && phone != "" {
			var count int64
			if err := tx.Model(&model.User{}).Where("phone=? AND sub<>?", phone, target.Sub).Count(&count).Error; err != nil {
				return err
			}
			if count != 0 {
				return gorm.ErrDuplicatedKey
			}
		}
		result := tx.Model(&model.User{}).Where("username = ?", username).Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		if status, ok := updates["status"].(string); ok && status == "disabled" {
			now := time.Now().UTC()
			if err := tx.Model(&model.Session{}).
				Where("user_id = ? AND revoked_at IS NULL", target.Sub).
				Update("revoked_at", now).Error; err != nil {
				return err
			}
		}
		return tx.Where("username = ?", username).First(&target).Error
	})
	if err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			errhandler.Fail(c, errhandler.PhoneAlreadyBound)
			return
		}
		if errors.Is(err, gorm.ErrRecordNotFound) {
			errhandler.Fail(c, errhandler.ResourceNotFound)
			return
		}
		errhandler.Fail(c, errhandler.InternalError)
		return
	}
	errhandler.OK(c, userJSON(target))
}
