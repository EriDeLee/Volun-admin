package model

import "time"

// Project is the initial project ledger. Recruitment, hours and workflow history
// will be introduced separately; creating a project never invents those records.
type Project struct {
	ID          string `gorm:"primaryKey;size:32"`
	Code        string `gorm:"uniqueIndex;size:40"`
	Name        string `gorm:"size:80"`
	Department  string `gorm:"size:80"`
	StartsOn    string `gorm:"size:10"`
	EndsOn      string `gorm:"size:10"`
	Location    string `gorm:"size:160"`
	Description string `gorm:"size:2000"`
	Status      string `gorm:"size:20;index"`
	Approval    string `gorm:"size:20;index"`
	CreatedBy   string `gorm:"size:128;index"` // Internal User.Sub; not a public response field.
	OwnerName   string
	CreatedAt   time.Time
	UpdatedAt   time.Time `gorm:"index"`
}
