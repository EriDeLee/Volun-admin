package dto

// SSOTokenResponse and SSOUserInfoResponse contain the upstream fields used by
// this application. They are never returned directly to the browser.
type SSOTokenResponse struct {
	AccessToken string `json:"access_token"`
}

type SSOUserInfoResponse struct {
	Sub           string `json:"sub"`
	Username      string `json:"username"`
	Name          string `json:"name"`
	StudentNumber string `json:"student_number"`
}
