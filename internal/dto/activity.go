package dto

import "time"

type CreateProjectRequest struct {
	Name        string `json:"name"`
	Department  string `json:"department"`
	StartsOn    string `json:"starts_on"`
	EndsOn      string `json:"ends_on"`
	Location    string `json:"location"`
	Description string `json:"description"`
}

type ProjectResponse struct {
	ID          string    `json:"id"`
	Code        string    `json:"code"`
	Name        string    `json:"name"`
	Department  string    `json:"department"`
	StartsOn    string    `json:"starts_on"`
	EndsOn      string    `json:"ends_on"`
	Location    string    `json:"location"`
	Description string    `json:"description"`
	Status      string    `json:"status"`
	OwnerName   string    `json:"owner_name"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type ActivitySummary struct {
	ProjectCount    int64  `json:"project_count"`
	RecruitingCount int64  `json:"recruiting_count"`
	PendingCount    int64  `json:"pending_count"`
	RecognizedHours *int64 `json:"recognized_hours"`
}

type ActivityTask struct {
	ProjectID   string `json:"project_id"`
	ProjectName string `json:"project_name"`
	Status      string `json:"status"`
	Instruction string `json:"instruction"`
}

type ActivityStage struct {
	Status string `json:"status"`
	Count  int64  `json:"count"`
}

type ActivityDashboard struct {
	Scope          string            `json:"scope"`
	GeneratedAt    time.Time         `json:"generated_at"`
	Summary        ActivitySummary   `json:"summary"`
	Tasks          []ActivityTask    `json:"tasks"`
	RecentProjects []ProjectResponse `json:"recent_projects"`
	Stages         []ActivityStage   `json:"stages"`
}

type ProjectListResponse struct {
	Items       []ProjectResponse `json:"items"`
	Total       int64             `json:"total"`
	Page        int               `json:"page"`
	PageSize    int               `json:"page_size"`
	Summary     ActivitySummary   `json:"summary"`
	Departments []string          `json:"departments"`
	Scope       string            `json:"scope"`
}
