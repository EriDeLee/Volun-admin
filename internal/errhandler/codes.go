// Package errhandler centralizes public API error codes and HTTP error responses.
package errhandler

import "net/http"

type Code int

const (
	Success               Code = 0
	InvalidArgument       Code = 100001
	ResourceNotFound      Code = 100002
	MethodNotAllowed      Code = 100006
	Unauthenticated       Code = 200001
	InvalidCredentials    Code = 200003
	CSRFValidationFailed  Code = 200008
	PasswordSetupRequired Code = 200009
	PasswordSetupConflict Code = 200010
	InternalError         Code = 900001
	DatabaseUnavailable   Code = 900002
)

func (code Code) details() (int, string) {
	switch code {
	case InvalidArgument:
		return http.StatusBadRequest, "参数不合法"
	case ResourceNotFound:
		return http.StatusNotFound, "接口不存在"
	case MethodNotAllowed:
		return http.StatusMethodNotAllowed, "请求方法不支持"
	case Unauthenticated:
		return http.StatusUnauthorized, "请先登录"
	case InvalidCredentials:
		return http.StatusUnauthorized, "账号或密码错误"
	case CSRFValidationFailed:
		return http.StatusForbidden, "请求校验失败"
	case PasswordSetupRequired:
		return http.StatusForbidden, "请先设置登录密码"
	case PasswordSetupConflict:
		return http.StatusConflict, "登录密码已设置，请重新登录"
	case DatabaseUnavailable:
		return http.StatusServiceUnavailable, "数据库暂时不可用"
	default:
		return http.StatusInternalServerError, "服务暂时不可用"
	}
}
