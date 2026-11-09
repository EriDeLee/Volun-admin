package auth

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"volun-data/internal/dto"
	"volun-data/internal/errhandler"
	"volun-data/internal/model"
)

func (s *Service) BindPhone(c *gin.Context) {
	if c.GetHeader("X-Requested-With") != "XMLHttpRequest" {
		errhandler.Fail(c, errhandler.CSRFValidationFailed)
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
	var req struct {
		Phone string `json:"phone"`
	}
	if c.ShouldBindJSON(&req) != nil {
		errhandler.Fail(c, errhandler.InvalidArgument)
		return
	}
	phone, ok := model.NormalizePhone(req.Phone)
	if !ok || phone == "" {
		errhandler.Fail(c, errhandler.InvalidArgument)
		return
	}
	u := c.MustGet("user").(model.User)
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var count int64
		if err := tx.Model(&model.User{}).Where("phone=? AND sub<>?", phone, u.Sub).Count(&count).Error; err != nil {
			return err
		}
		if count != 0 {
			return gorm.ErrDuplicatedKey
		}
		return tx.Model(&model.User{}).Where("sub=?", u.Sub).Update("phone", phone).Error
	})
	if err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			errhandler.Fail(c, errhandler.PhoneAlreadyBound)
		} else {
			errhandler.Fail(c, errhandler.InternalError)
		}
		return
	}
	u.Phone = phone
	errhandler.OK(c, dto.AuthResponse{User: userJSON(u), AuthMethod: "session", PasswordSetupRequired: u.PasswordSetupRequired})
}
