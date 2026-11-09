package model

import "time"

// Workflow holds a project aggregate. Every mutation compares Version in the
// same transaction as its audit event, including public form and attendance writes.
type Workflow struct {
	ProjectID string `gorm:"primaryKey;size:32"`
	Version   int    `gorm:"not null"`
	State     string `gorm:"type:text;not null"`
}

type WorkflowEvent struct {
	ID        string    `gorm:"primaryKey;size:32" json:"id"`
	ProjectID string    `gorm:"size:32;index" json:"-"`
	Version   int       `json:"version"`
	Action    string    `json:"action"`
	Actor     string    `json:"-"`
	ActorName string    `json:"actor"`
	Reason    string    `json:"reason"`
	Snapshot  string    `gorm:"type:text" json:"-"`
	CreatedAt time.Time `json:"created_at"`
}

// Generated files are private immutable database objects, never public paths.
type MaterialVersion struct {
	ID               string    `gorm:"primaryKey;size:32" json:"id"`
	ProjectID        string    `gorm:"size:32;index" json:"-"`
	Version          int       `json:"version"`
	Filename         string    `json:"filename"`
	Checksum         string    `json:"checksum"`
	TemplateChecksum string    `json:"template_checksum"`
	Data             []byte    `json:"-"`
	CreatedAt        time.Time `json:"created_at"`
}

type ParticipantGrant struct {
	Digest    string `gorm:"primaryKey;size:64"`
	ProjectID string `gorm:"size:32;index"`
	MemberID  string `gorm:"size:32;index"`
	ExpiresAt time.Time
	RevokedAt *time.Time
}
