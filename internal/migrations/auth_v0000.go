package migrations

import (
	"gorm.io/gorm"
	"volun-data/internal/auth"
)

// authV0 initializes authentication tables for a new database. Legacy tables
// must remain intact until v1 converts their primary key.
func authV0(db *gorm.DB) error {
	if db.Migrator().HasTable(&auth.User{}) && !db.Migrator().HasColumn(&auth.User{}, "sub") {
		return nil
	}
	return db.AutoMigrate(&auth.User{}, &auth.Session{}, &auth.LoginTransaction{})
}
