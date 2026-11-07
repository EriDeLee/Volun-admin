package errhandler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"volun-data/internal/dto"
)

// Fail writes a public error response and stops the remaining Gin handlers.
// Internal errors must be logged separately, never sent as the public message.
func Fail(c *gin.Context, code Code) {
	status, message := code.details()
	if status == http.StatusInternalServerError {
		code = InternalError
	}
	c.AbortWithStatusJSON(status, dto.Response{
		ErrCode: int(code), Message: message, Data: nil,
		RequestID: c.GetString("request_id"),
	})
}

func OK(c *gin.Context, data any) {
	c.JSON(http.StatusOK, dto.Response{
		ErrCode: int(Success), Message: "ok", Data: data,
		RequestID: c.GetString("request_id"),
	})
}
