package httpapi

import (
	"github.com/gin-gonic/gin"
	"volun-data/internal/dto"
)

func respond(c *gin.Context, status int, code dto.ErrCode, message string, data any) {
	c.JSON(status, dto.Response{ErrCode: code, Message: message, Data: data, RequestID: c.GetString("request_id")})
}
