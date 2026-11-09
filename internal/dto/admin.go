package dto

import "time"

type AdminUserResponse struct {
	Username              string    `json:"username"`
	Name                  string    `json:"name"`
	ID                    string    `json:"id"`
	Phone                 string    `json:"phone"`
	Groups                []string  `json:"groups"`
	Status                string    `json:"status"`
	PasswordSetupRequired bool      `json:"password_setup_required"`
	HasPassword           bool      `json:"has_password"`
	CreatedAt             time.Time `json:"created_at"`
	UpdatedAt             time.Time `json:"updated_at"`
}

type AdminUserListResponse struct {
	Items    []AdminUserResponse `json:"items"`
	Total    int64               `json:"total"`
	Page     int                 `json:"page"`
	PageSize int                 `json:"page_size"`
	Summary  AdminUserSummary    `json:"summary"`
}

type AdminUserSummary struct {
	UserCount     int64 `json:"user_count"`
	ActiveCount   int64 `json:"active_count"`
	DisabledCount int64 `json:"disabled_count"`
	ManagerCount  int64 `json:"manager_count"`
}

type UpdateAdminUserRequest struct {
	Phone  *string  `json:"phone"`
	Status *string  `json:"status"`
	Groups []string `json:"groups"`
}
