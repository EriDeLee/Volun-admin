package httpapi

import "github.com/gin-gonic/gin"

type ErrCode int

const (
	Success             ErrCode = 0
	InvalidArgument     ErrCode = 100001
	ResourceNotFound    ErrCode = 100002
	MethodNotAllowed    ErrCode = 100006
	InternalError       ErrCode = 900001
	DatabaseUnavailable ErrCode = 900002
)

type Response struct {
	ErrCode   ErrCode `json:"errcode"`
	Message   string  `json:"message"`
	Data      any     `json:"data"`
	RequestID string  `json:"request_id"`
}

func respond(c *gin.Context, status int, code ErrCode, message string, data any) {
	c.JSON(status, Response{ErrCode: code, Message: message, Data: data, RequestID: c.GetString("request_id")})
}
