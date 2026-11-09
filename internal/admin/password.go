package admin

import (
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"volun-data/internal/errhandler"
	"volun-data/internal/model"
)

// ResetPassword sets a temporary credential and revokes every current session.
func (s *Service) ResetPassword(c *gin.Context) {
	var req struct {
		Password string `json:"password"`
	}
	if !readRequest(c, &req, 8<<10) {
		return
	}
	username := strings.TrimSpace(c.Param("username"))
	if username == "" || utf8.RuneCountInString(username) > 120 || strings.ContainsAny(username, "/\\") || len(req.Password) < 12 || len(req.Password) > 72 {
		errhandler.Fail(c, errhandler.InvalidArgument)
		return
	}
	actor := c.MustGet("user").(model.User)
	var target model.User
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		// A username can map to multiple SSO identities; never reset an ambiguous account.
		var users []model.User
		if err := tx.Where("username = ?", username).Limit(2).Find(&users).Error; err != nil {
			return err
		}
		if len(users) == 0 {
			return gorm.ErrRecordNotFound
		}
		if len(users) != 1 || users[0].Sub == actor.Sub {
			return errInvalidPasswordTarget
		}
		target = users[0]
		hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			return err
		}
		now := time.Now().UTC()
		if err := tx.Model(&model.User{}).Where("sub = ?", target.Sub).Updates(map[string]any{"password_hash": string(hash), "password_setup_required": true, "updated_at": now}).Error; err != nil {
			return err
		}
		if err := tx.Model(&model.Session{}).Where("user_id = ? AND revoked_at IS NULL", target.Sub).Update("revoked_at", now).Error; err != nil {
			return err
		}
		return tx.Where("sub = ?", target.Sub).First(&target).Error
	})
	if err != nil {
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			errhandler.Fail(c, errhandler.ResourceNotFound)
		case errors.Is(err, errInvalidPasswordTarget):
			errhandler.Fail(c, errhandler.InvalidArgument)
		default:
			errhandler.Fail(c, errhandler.InternalError)
		}
		return
	}
	errhandler.OK(c, userJSON(target))
}

var errInvalidPasswordTarget = errors.New("invalid password reset target")
