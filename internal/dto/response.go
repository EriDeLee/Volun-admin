// Package dto defines HTTP request and response payloads, separate from database models.
package dto

type Response struct {
	ErrCode   int    `json:"errcode"`
	Message   string `json:"message"`
	Data      any    `json:"data"`
	RequestID string `json:"request_id"`
}

type HealthResponse struct {
	Status string `json:"status"`
}

type PingResponse struct {
	Message string `json:"message"`
}
