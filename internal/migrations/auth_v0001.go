package migrations

import (
	"gorm.io/gorm"
	"volun-data/internal/migration"
	"volun-data/internal/model"
)

func All() []migration.Step {
	return []migration.Step{
		{Version: 0, Name: "auth_initial_schema", Up: authV0},
		{Version: 1, Name: "auth_sub_primary_key", Up: authV1},
		{Version: 2, Name: "sso_initial_password_setup", Up: authV2},
		{Version: 3, Name: "activity_project_ledger", Up: activityV3},
		{Version: 4, Name: "project_workflow_and_attendance", Up: workflowV4},
		{Version: 5, Name: "unique_user_phone", Up: userPhoneV5},
	}
}

func authV2(db *gorm.DB) error {
	return db.AutoMigrate(&model.User{})
}

func authV1(db *gorm.DB) error {
	if db.Migrator().HasTable(&model.User{}) && !db.Migrator().HasColumn(&model.User{}, "sub") {
		if err := db.Migrator().RenameColumn(&model.User{}, "id", "sub"); err != nil {
			return err
		}
	}
	if db.Migrator().HasIndex(&model.User{}, "idx_users_username") {
		if err := db.Migrator().DropIndex(&model.User{}, "idx_users_username"); err != nil {
			return err
		}
	}
	return db.AutoMigrate(&model.User{}, &model.Session{}, &model.LoginTransaction{})
}
