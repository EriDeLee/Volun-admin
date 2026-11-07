// Package model defines persistent entities shared by services and migrations.
package model

import "time"

type User struct {
	Sub                   string `gorm:"primaryKey;size:128"`
	ID                    string `gorm:"size:120;index"`
	Name                  string
	Username              string `gorm:"index;size:120"`
	PasswordHash          string
	PasswordSetupRequired bool   `gorm:"not null;default:false"`
	Status                string `gorm:"size:20;index"`
	Groups                string
	CreatedAt             time.Time
	UpdatedAt             time.Time
}

type Session struct {
	ID          string    `gorm:"primaryKey;size:64"`
	TokenDigest string    `gorm:"uniqueIndex;size:64"`
	UserID      string    `gorm:"index;size:128"` // References User.Sub, never the student number.
	ExpiresAt   time.Time `gorm:"index"`
	RevokedAt   *time.Time
	CreatedAt   time.Time
}

type LoginTransaction struct {
	ID          string `gorm:"primaryKey;size:64"`
	StateDigest string `gorm:"uniqueIndex;size:64"`
	ReturnTo    string
	ExpiresAt   time.Time
	ConsumedAt  *time.Time
}
