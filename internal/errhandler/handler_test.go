package errhandler

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"volun-data/internal/dto"
)

func TestFailAbortsAndNormalizesUnknownCodes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		code   Code
		want   Code
		status int
	}{
		{Unauthenticated, Unauthenticated, 401},
		{InvalidCredentials, InvalidCredentials, 401},
		{CSRFValidationFailed, CSRFValidationFailed, 403},
		{Code(123456), InternalError, 500},
	} {
		r := gin.New()
		r.Use(func(c *gin.Context) {
			c.Set("request_id", "test-request")
			Fail(c, tc.code)
		})
		r.GET("/", func(c *gin.Context) { t.Fatal("error response did not abort handler chain") })
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("GET", "/", nil))
		var body dto.Response
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if w.Code != tc.status || body.ErrCode != int(tc.want) || body.RequestID != "test-request" || body.Data != nil {
			t.Fatalf("unexpected error response: status=%d body=%+v", w.Code, body)
		}
	}
}
