package migrations

import (
	"gorm.io/gorm"
	"volun-data/internal/model"
)

// authV0 initializes authentication tables for a new database. Legacy tables
// must remain intact until v1 converts their primary key.
func authV0(db *gorm.DB) error {
	if db.Migrator().HasTable(&model.User{}) && !db.Migrator().HasColumn(&model.User{}, "sub") {
		return nil
	}
	return db.AutoMigrate(&model.User{}, &model.Session{}, &model.LoginTransaction{})
}
