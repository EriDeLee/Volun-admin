// Package dto defines HTTP request and response payloads, separate from database models.
package dto

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

type HealthResponse struct {
	Status string `json:"status"`
}

type PingResponse struct {
	Message string `json:"message"`
}
