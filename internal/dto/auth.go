package dto

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type UserResponse struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Username string   `json:"username"`
	Groups   []string `json:"groups"`
}

type AuthResponse struct {
	User                  UserResponse `json:"user"`
	AuthMethod            string       `json:"auth_method"`
	PasswordSetupRequired bool         `json:"password_setup_required"`
}

type SetPasswordRequest struct {
	Password string `json:"password"`
}
