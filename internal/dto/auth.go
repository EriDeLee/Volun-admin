package dto

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type UserResponse struct {
	Sub      string   `json:"sub"`
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Username string   `json:"username"`
	Groups   []string `json:"groups"`
}

type AuthResponse struct {
	User       UserResponse `json:"user"`
	AuthMethod string       `json:"auth_method"`
}
