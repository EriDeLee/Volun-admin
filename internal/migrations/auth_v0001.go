package migrations

import (
	"gorm.io/gorm"
	"volun-data/internal/auth"
	"volun-data/internal/migration"
)

func All() []migration.Step {
	return []migration.Step{{Version: 0, Name: "auth_initial_schema", Up: authV0}, {Version: 1, Name: "auth_sub_primary_key", Up: authV1}}
}

func authV1(db *gorm.DB) error {
	if db.Migrator().HasTable(&auth.User{}) && !db.Migrator().HasColumn(&auth.User{}, "sub") {
		if err := db.Migrator().RenameColumn(&auth.User{}, "id", "sub"); err != nil {
			return err
		}
	}
	if db.Migrator().HasIndex(&auth.User{}, "idx_users_username") {
		if err := db.Migrator().DropIndex(&auth.User{}, "idx_users_username"); err != nil {
			return err
		}
	}
	return db.AutoMigrate(&auth.User{}, &auth.Session{}, &auth.LoginTransaction{})
}
